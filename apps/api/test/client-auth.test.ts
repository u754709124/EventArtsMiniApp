import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import {
  clientSessionRevokeReasons,
  createFakeWeChatLoginCodeVerifier,
  createWeChatLoginCodeVerifier,
  hashClientSessionToken,
  revokeClientSession,
  type WeChatLoginCodeVerifier
} from "../src/client-auth";
import type { ApiConfig } from "../src/config";
import { createPrismaClient, type AppPrismaClient } from "../src/db";
import { createInMemoryRateLimitStore } from "../src/rate-limit";
import { seedDatabase } from "../src/seed";
import { ensureDatabaseSchema } from "../src/sqlite-schema";
import { clientAuthHeaders, resetTestAdmin, testAdminCredentials, testWechatAppId } from "./fixtures";

let root: string;
let uploadDir: string;
let prisma: AppPrismaClient;
let app: Awaited<ReturnType<typeof buildApp>> | null;
let clockNow: Date;

const clientAuthConfig = {
  sessionTtlSeconds: 60,
  wechat: {
    appId: testWechatAppId,
    appSecret: "",
    verifierMode: "fake",
    code2SessionTimeoutMs: 50
  }
} satisfies ApiConfig["clientAuth"];

function advanceClock(ms: number) {
  clockNow = new Date(clockNow.getTime() + ms);
}

async function rebuildApp(input: {
  verifier?: WeChatLoginCodeVerifier;
  loginMaxFailures?: number;
} = {}) {
  await app?.close();
  app = await buildApp({
    prisma,
    jwtSecret: "client-auth-test-secret",
    uploadDir,
    publicBaseUrl: "http://127.0.0.1:3001",
    now: () => clockNow,
    clientAuth: clientAuthConfig,
    weChatLoginCodeVerifier: input.verifier ?? createFakeWeChatLoginCodeVerifier({
      appId: testWechatAppId,
      acceptAnyCode: true,
      singleUse: false
    }),
    rateLimit: {
      login: { windowMs: 10_000, maxFailures: input.loginMaxFailures ?? 5 },
      analytics: { windowMs: 10_000, maxRequests: 10 }
    },
    rateLimitStore: createInMemoryRateLimitStore(),
    analytics: { sampleRate: 1, retentionDays: 90, dedupeWindowSeconds: 30 },
    cors: {
      allowedOrigins: ["https://miniapp.example.com"],
      allowRequestsWithoutOrigin: true
    }
  });
}

async function loginClient(code = `client-code-${randomUUID()}`) {
  if (!app) throw new Error("app not ready");
  const response = await app.inject({
    method: "POST",
    url: "/api/client/auth/wechat",
    payload: { code }
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().success).toBe(true);
  return String(response.json().data.token);
}

async function loginAdmin() {
  if (!app) throw new Error("app not ready");
  const response = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: testAdminCredentials
  });
  expect(response.statusCode).toBe(200);
  return String(response.json().data.token);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "event-arts-client-auth-"));
  uploadDir = path.join(root, "uploads");
  await mkdir(uploadDir, { recursive: true });
  clockNow = new Date("2026-07-12T12:00:00.000Z");
  prisma = createPrismaClient(`file:${path.join(root, "test.db")}`);
  await ensureDatabaseSchema(prisma, { uploadDir });
  await seedDatabase(prisma, { uploadDir, publicBaseUrl: "http://127.0.0.1:3001", reset: true });
  await resetTestAdmin(prisma);
  await rebuildApp();
});

afterEach(async () => {
  await app?.close();
  app = null;
  await prisma.$disconnect();
  await rm(root, { recursive: true, force: true });
});

describe("client WeChat login exchange", () => {
  it("issues an opaque client token and stores only hashes and derived subjects", async () => {
    const token = await loginClient("valid-code");
    const session = await prisma.clientSession.findFirstOrThrow();

    expect(token).toEqual(expect.any(String));
    expect(session.tokenHash).toBe(hashClientSessionToken(token));
    expect(session.tokenHash).not.toBe(token);
    expect(session.openidHash).toHaveLength(64);
    expect(session.openidHash).not.toContain("valid-code");
    expect(session.openidHash).not.toContain("fake-openid");
    expect(session.expiresAt.getTime() - session.createdAt.getTime()).toBe(60_000);

    const home = await app!.inject({
      method: "GET",
      url: "/api/client/home",
      headers: clientAuthHeaders(token)
    });
    expect(home.statusCode).toBe(200);
    expect(home.json().success).toBe(true);
  });

  it("treats POST /api/client/auth/wechat as the only unauthenticated client exception", async () => {
    const anonymousHome = await app!.inject({ method: "GET", url: "/api/client/home" });
    expect(anonymousHome.statusCode).toBe(401);
    expect(anonymousHome.json()).toEqual({
      success: false,
      error: { code: "CLIENT_AUTH_REQUIRED", message: "请先完成小程序登录" }
    });

    const login = await app!.inject({
      method: "POST",
      url: "/api/client/auth/wechat",
      payload: { code: "exception-code" }
    });
    expect(login.statusCode).toBe(200);

    const wrongMethod = await app!.inject({ method: "GET", url: "/api/client/auth/wechat" });
    expect(wrongMethod.statusCode).toBe(401);
    expect(wrongMethod.json().error.code).toBe("CLIENT_AUTH_REQUIRED");
  });

  it("rejects forged headers, unknown tokens, malformed tokens, and admin JWTs", async () => {
    const forgedHeaders = await app!.inject({
      method: "GET",
      url: "/api/client/home",
      headers: {
        origin: "https://miniapp.example.com",
        referer: "https://miniapp.example.com/pages/index",
        "user-agent": "MicroMessenger test",
        "x-wechat-code": "forged"
      }
    });
    expect(forgedHeaders.statusCode).toBe(401);
    expect(forgedHeaders.json().error.code).toBe("CLIENT_AUTH_REQUIRED");

    const unknown = await app!.inject({
      method: "GET",
      url: "/api/client/home",
      headers: clientAuthHeaders(`unknown-${"x".repeat(40)}`)
    });
    const malformed = await app!.inject({
      method: "GET",
      url: "/api/client/home",
      headers: clientAuthHeaders("short")
    });
    const adminToken = await loginAdmin();
    const adminAsClient = await app!.inject({
      method: "GET",
      url: "/api/client/home",
      headers: clientAuthHeaders(adminToken)
    });

    for (const response of [unknown, malformed, adminAsClient]) {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        success: false,
        error: { code: "CLIENT_AUTH_REQUIRED", message: "请先完成小程序登录" }
      });
    }
  });

  it("keeps admin and client tokens isolated", async () => {
    const clientToken = await loginClient("client-only-code");
    const adminToken = await loginAdmin();

    const clientAsAdmin = await app!.inject({
      method: "GET",
      url: "/api/admin/dashboard/overview",
      headers: clientAuthHeaders(clientToken)
    });
    const adminAsClient = await app!.inject({
      method: "GET",
      url: "/api/client/menu-items",
      headers: clientAuthHeaders(adminToken)
    });

    expect(clientAsAdmin.statusCode).toBe(401);
    expect(clientAsAdmin.json().error.code).toBe("UNAUTHORIZED");
    expect(adminAsClient.statusCode).toBe(401);
    expect(adminAsClient.json().error.code).toBe("CLIENT_AUTH_REQUIRED");
  });

  it("rejects expired and revoked client sessions with stable 401 envelopes", async () => {
    const expiredToken = await loginClient("expires");
    advanceClock(60_001);
    const expired = await app!.inject({
      method: "GET",
      url: "/api/client/home",
      headers: clientAuthHeaders(expiredToken)
    });
    expect(expired.statusCode).toBe(401);
    expect(expired.json()).toEqual({
      success: false,
      error: { code: "CLIENT_SESSION_EXPIRED", message: "小程序登录状态已过期，请重新登录" }
    });

    clockNow = new Date("2026-07-12T12:00:00.000Z");
    const revokedToken = await loginClient("revoked");
    await revokeClientSession(prisma, {
      tokenHash: hashClientSessionToken(revokedToken),
      reason: clientSessionRevokeReasons.manual,
      now: clockNow
    });
    const revoked = await app!.inject({
      method: "GET",
      url: "/api/client/home",
      headers: clientAuthHeaders(revokedToken)
    });
    expect(revoked.statusCode).toBe(401);
    expect(revoked.json()).toEqual({
      success: false,
      error: { code: "CLIENT_SESSION_REVOKED", message: "小程序登录状态已失效，请重新登录" }
    });
  });

  it("rate limits failed login exchanges and never creates sessions for invalid codes", async () => {
    await rebuildApp({
      loginMaxFailures: 1,
      verifier: createFakeWeChatLoginCodeVerifier({
        appId: testWechatAppId,
        acceptAnyCode: false
      })
    });

    const first = await app!.inject({
      method: "POST",
      url: "/api/client/auth/wechat",
      remoteAddress: "198.51.100.10",
      payload: { code: "bad-code" }
    });
    const second = await app!.inject({
      method: "POST",
      url: "/api/client/auth/wechat",
      remoteAddress: "198.51.100.10",
      payload: { code: "bad-code-again" }
    });

    expect(first.statusCode).toBe(401);
    expect(first.json().error.code).toBe("INVALID_WECHAT_CODE");
    expect(second.statusCode).toBe(429);
    expect(second.headers["retry-after"]).toBe("10");
    expect(second.json().error.code).toBe("RATE_LIMITED");
    expect(await prisma.clientSession.count()).toBe(0);
  });

  it("maps upstream timeout and upstream error without leaking upstream details", async () => {
    await rebuildApp({
      verifier: {
        mode: "fake",
        async verifyLoginCode() {
          return {
            ok: false,
            reason: "upstream_timeout",
            retryable: true,
            publicErrorCode: "WECHAT_AUTH_UNAVAILABLE",
            publicMessage: "微信登录服务暂不可用，请稍后再试"
          };
        }
      }
    });
    const timeout = await app!.inject({
      method: "POST",
      url: "/api/client/auth/wechat",
      payload: { code: "timeout-code" }
    });
    expect(timeout.statusCode).toBe(504);
    expect(timeout.json()).toEqual({
      success: false,
      error: { code: "WECHAT_AUTH_UNAVAILABLE", message: "微信登录服务暂不可用，请稍后再试" }
    });

    await rebuildApp({
      verifier: {
        mode: "fake",
        async verifyLoginCode() {
          return {
            ok: false,
            reason: "upstream_error",
            retryable: true,
            publicErrorCode: "WECHAT_AUTH_UNAVAILABLE",
            publicMessage: "微信登录服务暂不可用，请稍后再试",
            upstreamErrCode: -1
          };
        }
      }
    });
    const upstream = await app!.inject({
      method: "POST",
      url: "/api/client/auth/wechat",
      payload: { code: "upstream-code" }
    });
    expect(upstream.statusCode).toBe(502);
    expect(upstream.body).not.toContain("upstream-code");
    expect(upstream.json().error.code).toBe("WECHAT_AUTH_UNAVAILABLE");
  });
});

describe("WeChat code2Session provider adapter", () => {
  it("calls the jscode2session adapter through an injected fetch implementation", async () => {
    const calls: URL[] = [];
    const verifier = createWeChatLoginCodeVerifier({
      appId: testWechatAppId,
      appSecret: "fake-app-secret-for-provider-test",
      fetchImpl: async (input) => {
        const url = input instanceof URL ? input : new URL(String(input));
        calls.push(url);
        return new Response(JSON.stringify({
          openid: "provider-openid",
          session_key: "provider-session-key",
          unionid: "provider-unionid"
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });

    const result = await verifier.verifyLoginCode({
      code: "provider-code",
      expectedAppId: testWechatAppId,
      timeoutMs: 1_000,
      requestId: "provider-test"
    });

    expect(result).toEqual({
      ok: true,
      appId: testWechatAppId,
      openid: "provider-openid",
      sessionKey: "provider-session-key",
      unionid: "provider-unionid"
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].origin).toBe("https://api.weixin.qq.com");
    expect(calls[0].pathname).toBe("/sns/jscode2session");
    expect(calls[0].searchParams.get("appid")).toBe(testWechatAppId);
    expect(calls[0].searchParams.get("js_code")).toBe("provider-code");
    expect(calls[0].searchParams.get("grant_type")).toBe("authorization_code");
  });

  it("maps WeChat errcode responses to public verifier failures", async () => {
    const verifier = createWeChatLoginCodeVerifier({
      appId: testWechatAppId,
      appSecret: "fake-app-secret-for-provider-test",
      fetchImpl: async () => new Response(JSON.stringify({
        errcode: 40029,
        errmsg: "invalid code"
      }), { status: 200, headers: { "content-type": "application/json" } })
    });

    const result = await verifier.verifyLoginCode({
      code: "bad-provider-code",
      expectedAppId: testWechatAppId,
      timeoutMs: 1_000
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "invalid_code",
      publicErrorCode: "INVALID_WECHAT_CODE",
      upstreamErrCode: 40029
    });
  });
});
