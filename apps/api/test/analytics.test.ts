import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyticsFieldLimits } from "@event-arts/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupExpiredDailyUserVisits,
  cleanupExpiredPageViewEvents,
  countExpiredDailyUserVisits,
  countExpiredPageViewEvents,
  dailyUserVisitOverview,
  recordDailyUserVisit,
  shanghaiAnalyticsPeriod,
  shanghaiDateKey
} from "../src/analytics";
import { buildApp } from "../src/app";
import { hashClientSessionToken, revokeClientSession } from "../src/client-auth";
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

function advanceClock(ms: number) {
  clockNow = new Date(clockNow.getTime() + ms);
}

function postPageView(input: {
  token?: string;
  pagePath?: string;
  scene?: string;
  ip?: string;
  userAgent?: string;
}) {
  return app.inject({
    method: "POST",
    url: "/api/client/track/page-view",
    remoteAddress: input.ip ?? "198.51.100.10",
    headers: {
      ...(input.token ? clientAuthHeaders(input.token) : {}),
      ...(input.userAgent ? { "user-agent": input.userAgent } : {})
    },
    payload: { pagePath: input.pagePath ?? "/pages/index/index", scene: input.scene }
  });
}

async function loginAdmin() {
  const response = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: testAdminCredentials
  });
  expect(response.statusCode).toBe(200);
  return String(response.json().data.token);
}

async function getOverview() {
  const token = await loginAdmin();
  const response = await app.inject({
    method: "GET",
    url: "/api/admin/dashboard/overview",
    headers: { authorization: `Bearer ${token}` }
  });
  expect(response.statusCode).toBe(200);
  return response.json().data as {
    todayUniqueUsers: number;
    weekDailyUniqueUsers: number;
    monthDailyUniqueUsers: number;
  };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "event-arts-daily-users-"));
  uploadDir = path.join(root, "uploads");
  await mkdir(uploadDir, { recursive: true });
  clockNow = new Date("2026-07-12T08:30:00.000Z");
  prisma = createPrismaClient(`file:${path.join(root, "test.db")}`);
  await ensureDatabaseSchema(prisma, { uploadDir });
  await resetTestAdmin(prisma);
  app = await buildApp({
    prisma,
    jwtSecret,
    uploadDir,
    publicBaseUrl: "http://127.0.0.1:3001",
    now: () => clockNow,
    clientAuth: testClientAuthConfig,
    weChatLoginCodeVerifier: createTestWeChatLoginCodeVerifier()
  });
  clientToken = await loginClient(app, "same-wechat-user");
});

afterEach(async () => {
  await app?.close();
  await prisma.$disconnect();
  await rm(root, { recursive: true, force: true });
});

describe("daily WeChat user analytics", () => {
  it("counts one valid WeChat identity once per Beijing day across pages, scenes, sessions, IPs, and retries", async () => {
    const secondSessionToken = await loginClient(app, "same-wechat-user");

    const responses = await Promise.all([
      postPageView({ token: clientToken, pagePath: "/pages/index/index", scene: "home" }),
      postPageView({ token: clientToken, pagePath: "/pages/artists/list", scene: "menu", ip: "203.0.113.8" }),
      postPageView({ token: secondSessionToken, pagePath: "/pages/detail/index", scene: "detail", userAgent: "Other Browser" }),
      ...Array.from({ length: 12 }, () => postPageView({ token: secondSessionToken }))
    ]);

    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    expect(await prisma.dailyUserVisit.count()).toBe(1);
    expect(await prisma.pageViewEvent.count()).toBe(0);
    expect(await getOverview()).toEqual({
      todayUniqueUsers: 1,
      weekDailyUniqueUsers: 1,
      monthDailyUniqueUsers: 1
    });

    const row = await prisma.dailyUserVisit.findFirstOrThrow();
    expect(row).toMatchObject({ appId: testClientAuthConfig.wechat.appId, visitDate: "2026-07-12" });
    expect(row.openidHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(row)).not.toContain("same-wechat-user");
    expect(JSON.stringify(row)).not.toContain("198.51.100.10");
    expect(JSON.stringify(row)).not.toContain("Other Browser");
  });

  it("counts different valid identities separately and counts the same identity again after Beijing midnight", async () => {
    const otherUserToken = await loginClient(app, "different-wechat-user");
    expect((await postPageView({ token: clientToken })).statusCode).toBe(200);
    expect((await postPageView({ token: otherUserToken })).statusCode).toBe(200);
    expect(await prisma.dailyUserVisit.count()).toBe(2);

    clockNow = new Date("2026-07-12T15:59:59.999Z");
    const boundarySessionToken = await loginClient(app, "same-wechat-user");
    expect((await postPageView({ token: boundarySessionToken })).statusCode).toBe(200);
    expect(await prisma.dailyUserVisit.count()).toBe(2);

    clockNow = new Date("2026-07-12T16:00:00.000Z");
    expect((await postPageView({ token: boundarySessionToken })).statusCode).toBe(200);
    expect(await prisma.dailyUserVisit.count()).toBe(3);
    expect(await prisma.dailyUserVisit.findMany({ orderBy: { visitDate: "asc" } })).toEqual([
      expect.objectContaining({ visitDate: "2026-07-12" }),
      expect.objectContaining({ visitDate: "2026-07-12" }),
      expect.objectContaining({ visitDate: "2026-07-13" })
    ]);
  });

  it("rejects missing, invalid, administrator, expired, and revoked tokens without recording a user", async () => {
    const adminToken = await loginAdmin();
    const expiredToken = await loginClient(app, "expired-user");
    advanceClock(testClientAuthConfig.sessionTtlSeconds * 1000 + 1);

    const expired = await postPageView({ token: expiredToken });
    clockNow = new Date("2026-07-12T08:30:00.000Z");
    const revokedToken = await loginClient(app, "revoked-user");
    await revokeClientSession(prisma, {
      tokenHash: hashClientSessionToken(revokedToken),
      reason: "manual",
      now: clockNow
    });

    const responses = [
      await postPageView({}),
      await postPageView({ token: "invalid-client-token" }),
      await postPageView({ token: adminToken }),
      expired,
      await postPageView({ token: revokedToken })
    ];

    expect(responses.map((response) => response.statusCode)).toEqual([401, 401, 401, 401, 401]);
    expect(await prisma.dailyUserVisit.count()).toBe(0);
  });

  it("uses Beijing day, Monday week start, month start, and excludes future and legacy rows", async () => {
    expect(shanghaiDateKey(new Date("2026-07-12T15:59:59.999Z"))).toBe("2026-07-12");
    expect(shanghaiDateKey(new Date("2026-07-12T16:00:00.000Z"))).toBe("2026-07-13");
    expect(shanghaiAnalyticsPeriod(new Date("2026-07-15T12:00:00.000Z"))).toEqual({
      today: "2026-07-15",
      tomorrow: "2026-07-16",
      weekStart: "2026-07-13",
      monthStart: "2026-07-01"
    });

    for (const [visitDate, openidHash] of [
      ["2026-06-30", "previous-month"],
      ["2026-07-01", "month-start"],
      ["2026-07-12", "previous-week"],
      ["2026-07-13", "week-start"],
      ["2026-07-15", "today-a"],
      ["2026-07-15", "today-b"],
      ["2026-07-16", "future"]
    ] as const) {
      await prisma.dailyUserVisit.create({
        data: { appId: testClientAuthConfig.wechat.appId, openidHash, visitDate }
      });
    }
    await prisma.pageViewEvent.create({
      data: { pagePath: "/legacy", anonymousFingerprint: "legacy", sampleWeight: 999 }
    });

    expect(await dailyUserVisitOverview(prisma, new Date("2026-07-15T12:00:00.000Z"))).toEqual({
      todayUniqueUsers: 2,
      weekDailyUniqueUsers: 3,
      monthDailyUniqueUsers: 5
    });
  });

  it("keeps AppIDs separate and relies on the database unique key for concurrent idempotency", async () => {
    const now = new Date("2026-07-12T08:30:00.000Z");
    await Promise.all(
      Array.from({ length: 20 }, () =>
        recordDailyUserVisit(prisma, { appId: "wx-app-a", openidHash: "same-hash", now })
      )
    );
    await recordDailyUserVisit(prisma, { appId: "wx-app-b", openidHash: "same-hash", now });

    expect(await prisma.dailyUserVisit.count()).toBe(2);
    await expect(
      prisma.dailyUserVisit.create({
        data: { appId: "wx-app-a", openidHash: "same-hash", visitDate: "2026-07-12" }
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("keeps request validation compatibility without storing page, scene, IP, or User-Agent", async () => {
    const maxPagePath = `/${"p".repeat(analyticsFieldLimits.pagePathMaxLength - 1)}`;
    const maxScene = "s".repeat(analyticsFieldLimits.sceneMaxLength);
    expect((await postPageView({ token: clientToken, pagePath: maxPagePath, scene: maxScene })).statusCode).toBe(200);

    const tooLongPage = await postPageView({
      token: clientToken,
      pagePath: `/${"p".repeat(analyticsFieldLimits.pagePathMaxLength)}`
    });
    const tooLongScene = await postPageView({
      token: clientToken,
      scene: "s".repeat(analyticsFieldLimits.sceneMaxLength + 1)
    });
    expect(tooLongPage.statusCode).toBe(400);
    expect(tooLongScene.statusCode).toBe(400);
    expect(await prisma.dailyUserVisit.count()).toBe(1);
  });

  it("cleans expired daily and legacy analytics while preserving retention-boundary rows", async () => {
    const now = new Date("2026-07-12T12:00:00.000Z");
    await prisma.dailyUserVisit.createMany({
      data: [
        { appId: "wx", openidHash: "expired", visitDate: "2026-04-12" },
        { appId: "wx", openidHash: "boundary", visitDate: "2026-04-13" }
      ]
    });
    await prisma.pageViewEvent.createMany({
      data: [
        { pagePath: "/expired", anonymousFingerprint: "expired", createdAt: new Date("2026-04-12T11:59:59.999Z") },
        { pagePath: "/boundary", anonymousFingerprint: "boundary", createdAt: new Date("2026-04-13T12:00:00.000Z") }
      ]
    });

    await expect(countExpiredDailyUserVisits(prisma, { now, retentionDays: 90 })).resolves.toBe(1);
    await expect(countExpiredPageViewEvents(prisma, { now, retentionDays: 90 })).resolves.toBe(1);
    await expect(cleanupExpiredDailyUserVisits(prisma, { now, retentionDays: 90 })).resolves.toEqual({ deletedCount: 1 });
    await expect(cleanupExpiredPageViewEvents(prisma, { now, retentionDays: 90 })).resolves.toEqual({ deletedCount: 1 });
    await expect(prisma.dailyUserVisit.findMany()).resolves.toEqual([
      expect.objectContaining({ openidHash: "boundary" })
    ]);
    await expect(prisma.pageViewEvent.findMany()).resolves.toEqual([
      expect.objectContaining({ pagePath: "/boundary" })
    ]);
  });
});
