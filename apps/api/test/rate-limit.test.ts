import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createPrismaClient, type AppPrismaClient } from "../src/db";
import { createInMemoryRateLimitStore } from "../src/rate-limit";
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

const windowMs = 10_000;
const loginMaxFailures = 2;
const analyticsMaxRequests = 1;

function advanceClock(ms: number) {
  clockNow = new Date(clockNow.getTime() + ms);
}

function loginRequest(input: {
  username?: string;
  password?: string;
  remoteAddress?: string;
  forwardedFor?: string;
}) {
  return app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    remoteAddress: input.remoteAddress ?? "203.0.113.10",
    headers: input.forwardedFor ? { "x-forwarded-for": input.forwardedFor } : undefined,
    payload: {
      username: input.username ?? testAdminCredentials.username,
      password: input.password ?? "wrong-password"
    }
  });
}

function pageViewRequest(input: { remoteAddress?: string; forwardedFor?: string } = {}) {
  return app.inject({
    method: "POST",
    url: "/api/client/track/page-view",
    remoteAddress: input.remoteAddress ?? "203.0.113.20",
    headers: {
      ...clientAuthHeaders(clientToken),
      ...(input.forwardedFor ? { "x-forwarded-for": input.forwardedFor } : {})
    },
    payload: { pagePath: "/pages/index/index", scene: "home" }
  });
}

function expectInvalidCredentials(response: Awaited<ReturnType<typeof app.inject>>) {
  expect(response.statusCode).toBe(401);
  expect(response.json()).toEqual({
    success: false,
    error: { code: "INVALID_CREDENTIALS", message: "用户名或密码错误" }
  });
}

function expectRateLimited(response: Awaited<ReturnType<typeof app.inject>>, retryAfter = "10") {
  expect(response.statusCode).toBe(429);
  expect(response.headers["retry-after"]).toBe(retryAfter);
  expect(response.json()).toEqual({
    success: false,
    error: { code: "RATE_LIMITED", message: "请求过于频繁，请稍后再试" }
  });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "event-arts-g04-"));
  uploadDir = path.join(root, "uploads");
  await mkdir(uploadDir, { recursive: true });
  clockNow = new Date("2026-07-12T00:00:00.000Z");
  prisma = createPrismaClient(`file:${path.join(root, "test.db")}`);
  await ensureDatabaseSchema(prisma, { uploadDir });
  await resetTestAdmin(prisma);
  app = await buildApp({
    prisma,
    jwtSecret: "rate-limit-test-secret",
    uploadDir,
    publicBaseUrl: "http://127.0.0.1:3001",
    now: () => clockNow,
    clientAuth: testClientAuthConfig,
    weChatLoginCodeVerifier: createTestWeChatLoginCodeVerifier(),
    rateLimit: {
      login: { windowMs, maxFailures: loginMaxFailures },
      analytics: { windowMs, maxRequests: analyticsMaxRequests }
    },
    rateLimitStore: createInMemoryRateLimitStore()
  });
  clientToken = await loginClient(app);
});

afterEach(async () => {
  await app.close();
  await prisma.$disconnect();
  await rm(root, { recursive: true, force: true });
});

describe("admin login rate limiting", () => {
  it("limits failed logins by trusted IP and normalized username", async () => {
    expectInvalidCredentials(await loginRequest({
      username: ` ${testAdminCredentials.username} `,
      remoteAddress: "203.0.113.30"
    }));
    expectInvalidCredentials(await loginRequest({
      username: testAdminCredentials.username.toLocaleUpperCase("en-US"),
      remoteAddress: "203.0.113.30"
    }));

    expectRateLimited(await loginRequest({ remoteAddress: "203.0.113.30" }));
    expectInvalidCredentials(await loginRequest({ remoteAddress: "203.0.113.31" }));
  });

  it("keeps invalid usernames and wrong passwords indistinguishable in public responses", async () => {
    const unknownUser = await loginRequest({
      username: "missing-admin",
      remoteAddress: "203.0.113.40"
    });
    const wrongPassword = await loginRequest({
      username: testAdminCredentials.username,
      remoteAddress: "203.0.113.41"
    });

    expectInvalidCredentials(unknownUser);
    expect(wrongPassword.statusCode).toBe(unknownUser.statusCode);
    expect(wrongPassword.json()).toEqual(unknownUser.json());
  });

  it("recovers after the fixed window without real sleeps", async () => {
    expectInvalidCredentials(await loginRequest({ remoteAddress: "203.0.113.50" }));
    expectInvalidCredentials(await loginRequest({ remoteAddress: "203.0.113.50" }));
    expectRateLimited(await loginRequest({ remoteAddress: "203.0.113.50" }));

    advanceClock(windowMs + 1);
    expectInvalidCredentials(await loginRequest({ remoteAddress: "203.0.113.50" }));
  });

  it("clears failed login attempts after a successful login", async () => {
    expectInvalidCredentials(await loginRequest({ remoteAddress: "203.0.113.60" }));
    expectInvalidCredentials(await loginRequest({ remoteAddress: "203.0.113.60" }));

    const success = await loginRequest({
      password: testAdminCredentials.password,
      remoteAddress: "203.0.113.60"
    });
    expect(success.statusCode).toBe(200);
    expect(success.json()).toMatchObject({
      success: true,
      data: { username: testAdminCredentials.username }
    });

    expectInvalidCredentials(await loginRequest({ remoteAddress: "203.0.113.60" }));
    expectInvalidCredentials(await loginRequest({ remoteAddress: "203.0.113.60" }));
    expectRateLimited(await loginRequest({ remoteAddress: "203.0.113.60" }));
  });
});

describe("anonymous page-view rate limiting", () => {
  it("limits page-view tracking by trusted IP and recovers after the window", async () => {
    const first = await pageViewRequest({ remoteAddress: "198.51.100.10" });
    expect(first.statusCode).toBe(200);
    expectRateLimited(await pageViewRequest({ remoteAddress: "198.51.100.10" }));

    advanceClock(windowMs + 1);
    const recovered = await pageViewRequest({ remoteAddress: "198.51.100.10" });
    expect(recovered.statusCode).toBe(200);
  });

  it("ignores spoofed X-Forwarded-For values from direct non-loopback clients", async () => {
    const first = await pageViewRequest({
      remoteAddress: "198.51.100.20",
      forwardedFor: "203.0.113.200"
    });
    expect(first.statusCode).toBe(200);

    expectRateLimited(await pageViewRequest({
      remoteAddress: "198.51.100.20",
      forwardedFor: "203.0.113.201"
    }));
  });

  it("uses the nearest non-trusted X-Forwarded-For address from loopback proxy chains", async () => {
    const first = await pageViewRequest({
      remoteAddress: "127.0.0.1",
      forwardedFor: "198.51.100.200, 203.0.113.70"
    });
    expect(first.statusCode).toBe(200);

    expectRateLimited(await pageViewRequest({
      remoteAddress: "127.0.0.1",
      forwardedFor: "198.51.100.201, 203.0.113.70"
    }));

    const otherClient = await pageViewRequest({
      remoteAddress: "127.0.0.1",
      forwardedFor: "203.0.113.71"
    });
    expect(otherClient.statusCode).toBe(200);
  });
});
