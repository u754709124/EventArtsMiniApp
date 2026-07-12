import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyticsFieldLimits } from "@event-arts/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupExpiredPageViewEvents,
  countExpiredPageViewEvents,
  createAnonymousFingerprint,
  shouldSamplePageView,
  type PageViewAnalyticsConfig
} from "../src/analytics";
import { buildApp } from "../src/app";
import { createPrismaClient, type AppPrismaClient } from "../src/db";
import { ensureDatabaseSchema } from "../src/sqlite-schema";
import {
  clientAuthHeaders,
  createTestWeChatLoginCodeVerifier,
  loginClient,
  resetTestAdmin,
  testAdminCredentials,
  testClientAuthConfig
} from "./fixtures";

let root: string;
let uploadDir: string;
let prisma: AppPrismaClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let clockNow: Date;
let clientToken: string;

const jwtSecret = "analytics-test-secret-with-more-than-32-chars";
const defaultAnalyticsConfig: PageViewAnalyticsConfig = {
  sampleRate: 0.1,
  retentionDays: 90,
  dedupeWindowSeconds: 30
};

function advanceClock(ms: number) {
  clockNow = new Date(clockNow.getTime() + ms);
}

function sampleDecision(input: {
  ip: string;
  pagePath: string;
  scene?: string;
  userAgent?: string;
  sampleRate?: number;
}) {
  const anonymousFingerprint = createAnonymousFingerprint({
    clientIp: input.ip,
    userAgent: input.userAgent ?? null,
    now: clockNow,
    hmacSecret: jwtSecret
  });
  return shouldSamplePageView({
    anonymousFingerprint,
    pagePath: input.pagePath,
    scene: input.scene ?? null,
    sampleRate: input.sampleRate ?? defaultAnalyticsConfig.sampleRate,
    hmacSecret: jwtSecret
  });
}

function findIpForSampleDecision(sampled: boolean, input: { pagePath: string; scene?: string; userAgent?: string }) {
  for (let index = 1; index < 5000; index += 1) {
    const ip = `198.51.${Math.floor(index / 255)}.${index % 255}`;
    if (sampleDecision({ ip, ...input }) === sampled) return ip;
  }
  throw new Error(`Unable to find sampled=${sampled} IP`);
}

function postPageView(input: {
  pagePath: string;
  scene?: string;
  ip?: string;
  userAgent?: string;
}) {
  return app.inject({
    method: "POST",
    url: "/api/client/track/page-view",
    remoteAddress: input.ip ?? "198.51.100.10",
    headers: {
      ...clientAuthHeaders(clientToken),
      ...(input.userAgent ? { "user-agent": input.userAgent } : {})
    },
    payload: { pagePath: input.pagePath, scene: input.scene }
  });
}

async function login() {
  const response = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: testAdminCredentials
  });
  expect(response.statusCode).toBe(200);
  return response.json().data.token as string;
}

async function createApp(analytics: PageViewAnalyticsConfig = defaultAnalyticsConfig) {
  app = await buildApp({
    prisma,
    jwtSecret,
    uploadDir,
    publicBaseUrl: "http://127.0.0.1:3001",
    now: () => clockNow,
    clientAuth: testClientAuthConfig,
    weChatLoginCodeVerifier: createTestWeChatLoginCodeVerifier(),
    analytics
  });
  clientToken = await loginClient(app);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "event-arts-g05-"));
  uploadDir = path.join(root, "uploads");
  await mkdir(uploadDir, { recursive: true });
  clockNow = new Date("2026-07-12T08:30:00.000Z");
  prisma = createPrismaClient(`file:${path.join(root, "test.db")}`);
  await ensureDatabaseSchema(prisma, { uploadDir });
  await resetTestAdmin(prisma);
});

afterEach(async () => {
  await app?.close();
  await prisma.$disconnect();
  await rm(root, { recursive: true, force: true });
});

describe("page-view sampling and anonymization", () => {
  it("uses deterministic 10% sampling and stores weighted anonymous events", async () => {
    await createApp();
    const pagePath = "/pages/index/index";
    const scene = "home";
    const userAgent = "  Test Browser   1.0  ";
    const sampledIp = findIpForSampleDecision(true, { pagePath, scene, userAgent: "Test Browser 1.0" });
    const unsampledIp = findIpForSampleDecision(false, { pagePath, scene, userAgent: "Test Browser 1.0" });

    expect(sampleDecision({ ip: sampledIp, pagePath, scene, userAgent: "Test Browser 1.0" })).toBe(true);
    expect(sampleDecision({ ip: sampledIp, pagePath, scene, userAgent: "Test Browser 1.0" })).toBe(true);
    expect(sampleDecision({ ip: unsampledIp, pagePath, scene, userAgent: "Test Browser 1.0" })).toBe(false);

    expect((await postPageView({ pagePath, scene, ip: sampledIp, userAgent })).statusCode).toBe(200);
    expect((await postPageView({ pagePath, scene, ip: unsampledIp, userAgent })).statusCode).toBe(200);

    const rows = await prisma.pageViewEvent.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      pagePath,
      scene,
      userAgent: "Test Browser 1.0",
      sampleWeight: 10
    });
    expect(rows[0].anonymousFingerprint).toHaveLength(64);
    expect(rows[0].anonymousFingerprint).not.toContain(sampledIp);

    const token = await login();
    const overview = await app.inject({
      method: "GET",
      url: "/api/admin/dashboard/overview",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json().data).toMatchObject({
      todayPv: 10,
      weekPv: 10,
      monthPv: 10,
      estimated: true,
      sampleRate: 0.1,
      sampleWeight: 10
    });
  });

  it("deduplicates the same anonymous fingerprint, page, and scene inside the configured window", async () => {
    await createApp({ sampleRate: 1, retentionDays: 90, dedupeWindowSeconds: 30 });

    expect((await postPageView({ pagePath: "/pages/index/index", scene: "home" })).statusCode).toBe(200);
    advanceClock(29_000);
    expect((await postPageView({ pagePath: "/pages/index/index", scene: "home" })).statusCode).toBe(200);
    expect(await prisma.pageViewEvent.count()).toBe(1);

    advanceClock(2_000);
    expect((await postPageView({ pagePath: "/pages/index/index", scene: "home" })).statusCode).toBe(200);
    expect(await prisma.pageViewEvent.count()).toBe(2);

    expect((await postPageView({ pagePath: "/pages/index/index", scene: "detail" })).statusCode).toBe(200);
    expect(await prisma.pageViewEvent.count()).toBe(3);
  });

  it("enforces page and scene boundaries and clamps normalized user-agent storage", async () => {
    await createApp({ sampleRate: 1, retentionDays: 90, dedupeWindowSeconds: 30 });
    const maxPagePath = `/${"p".repeat(analyticsFieldLimits.pagePathMaxLength - 1)}`;
    const maxScene = "s".repeat(analyticsFieldLimits.sceneMaxLength);
    const longUserAgent = `  ${"Browser ".repeat(80)}  `;

    const accepted = await postPageView({
      pagePath: maxPagePath,
      scene: maxScene,
      userAgent: longUserAgent
    });
    expect(accepted.statusCode).toBe(200);
    const row = await prisma.pageViewEvent.findFirstOrThrow();
    expect(row.pagePath).toBe(maxPagePath);
    expect(row.scene).toBe(maxScene);
    expect(row.userAgent).toHaveLength(analyticsFieldLimits.userAgentMaxLength);

    const tooLongPage = await postPageView({
      pagePath: `/${"p".repeat(analyticsFieldLimits.pagePathMaxLength)}`,
      scene: "home"
    });
    expect(tooLongPage.statusCode).toBe(400);
    expect(tooLongPage.json().error.code).toBe("VALIDATION_ERROR");

    const tooLongScene = await postPageView({
      pagePath: "/pages/index/index",
      scene: "s".repeat(analyticsFieldLimits.sceneMaxLength + 1)
    });
    expect(tooLongScene.statusCode).toBe(400);
    expect(tooLongScene.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("aggregates dashboard PV by sample weight", async () => {
    await createApp();
    await prisma.pageViewEvent.createMany({
      data: [
        {
          pagePath: "/today",
          anonymousFingerprint: "today-a",
          sampleWeight: 10,
          createdAt: new Date("2026-07-12T07:00:00.000Z")
        },
        {
          pagePath: "/today",
          anonymousFingerprint: "today-b",
          sampleWeight: 10,
          createdAt: new Date("2026-07-12T07:10:00.000Z")
        },
        {
          pagePath: "/week",
          anonymousFingerprint: "week-a",
          sampleWeight: 10,
          createdAt: new Date("2026-07-08T07:00:00.000Z")
        },
        {
          pagePath: "/month",
          anonymousFingerprint: "month-a",
          sampleWeight: 10,
          createdAt: new Date("2026-07-02T07:00:00.000Z")
        }
      ]
    });

    const token = await login();
    const overview = await app.inject({
      method: "GET",
      url: "/api/admin/dashboard/overview",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(overview.statusCode).toBe(200);
    expect(overview.json().data).toMatchObject({
      todayPv: 20,
      weekPv: 30,
      monthPv: 40
    });
  });

  it("keeps retention boundary records and deletes only events older than retention days", async () => {
    await createApp();
    const now = new Date("2026-07-12T00:00:00.000Z");
    await prisma.pageViewEvent.createMany({
      data: [
        {
          pagePath: "/expired",
          anonymousFingerprint: "expired",
          sampleWeight: 10,
          createdAt: new Date("2026-04-12T23:59:59.999Z")
        },
        {
          pagePath: "/boundary",
          anonymousFingerprint: "boundary",
          sampleWeight: 10,
          createdAt: new Date("2026-04-13T00:00:00.000Z")
        },
        {
          pagePath: "/inside",
          anonymousFingerprint: "inside",
          sampleWeight: 10,
          createdAt: new Date("2026-04-13T00:00:00.001Z")
        }
      ]
    });

    await expect(countExpiredPageViewEvents(prisma, { now, retentionDays: 90 })).resolves.toBe(1);
    await expect(cleanupExpiredPageViewEvents(prisma, { now, retentionDays: 90 })).resolves.toEqual({
      deletedCount: 1
    });
    await expect(prisma.pageViewEvent.findMany({ orderBy: { pagePath: "asc" } })).resolves.toEqual([
      expect.objectContaining({ pagePath: "/boundary" }),
      expect.objectContaining({ pagePath: "/inside" })
    ]);
  });
});
