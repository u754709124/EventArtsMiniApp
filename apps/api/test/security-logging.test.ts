import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ok } from "@event-arts/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createPrismaClient, type AppPrismaClient } from "../src/db";
import { createApiLoggerOptions, logSecurityEvent, redactedValue } from "../src/logging";
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

type LogEntry = Record<string, unknown>;

let root: string;
let uploadDir: string;
let prisma: AppPrismaClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let logs: LogEntry[];
let clockNow: Date;

function logText() {
  return logs.map((entry) => JSON.stringify(entry)).join("\n");
}

function securityEvents() {
  return logs
    .filter((entry) => entry.event === "security")
    .map((entry) => entry.securityEvent);
}

function createLogCapture() {
  logs = [];
  return {
    write(message: string) {
      for (const line of message.split("\n")) {
        if (!line.trim()) continue;
        logs.push(JSON.parse(line) as LogEntry);
      }
    }
  };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function login(password: string = testAdminCredentials.password) {
  const response = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: { username: testAdminCredentials.username, password }
  });
  expect(response.statusCode).toBe(200);
  return String(response.json().data.token);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "event-arts-g06-"));
  uploadDir = path.join(root, "uploads");
  await mkdir(uploadDir, { recursive: true });
  clockNow = new Date("2026-07-12T12:00:00.000Z");
  prisma = createPrismaClient(`file:${path.join(root, "test.db")}`);
  await ensureDatabaseSchema(prisma, { uploadDir });
  await resetTestAdmin(prisma);
  app = await buildApp({
    prisma,
    jwtSecret: "security-logging-test-secret",
    uploadDir,
    publicBaseUrl: "http://127.0.0.1:3001",
    now: () => clockNow,
    logger: createApiLoggerOptions({ stream: createLogCapture(), level: "info" }),
    clientAuth: testClientAuthConfig,
    weChatLoginCodeVerifier: createTestWeChatLoginCodeVerifier(),
    rateLimit: {
      login: { windowMs: 10_000, maxFailures: 1 },
      analytics: { windowMs: 10_000, maxRequests: 1 }
    },
    rateLimitStore: createInMemoryRateLimitStore(),
    analytics: { sampleRate: 1, retentionDays: 90, dedupeWindowSeconds: 30 }
  });
});

afterEach(async () => {
  await app.close();
  await prisma.$disconnect();
  await rm(root, { recursive: true, force: true });
});

describe("public error wrapping", () => {
  it("does not expose unknown 5xx internals to clients and redacts request secrets in logs", async () => {
    app.post("/__test/unknown-error", async () => {
      throw new Error(
        "SQLITE_ERROR: SELECT * FROM admin_users WHERE password='OpenSesame' " +
          "AND token=header-token at /private/tmp/event-arts/prod.db JWT_SECRET=top-secret " +
          "secretId=edgeone-error-secret-id secretKey=edgeone-error-secret-key " +
          "EDGEONE_CREDENTIAL_ENCRYPTION_KEY=edgeone-error-master-key"
      );
    });

    const response = await app.inject({
      method: "POST",
      url: "/__test/unknown-error",
      headers: {
        authorization: "Bearer live-header-token",
        cookie: "admin_session=cookie-secret",
        "x-request-id": "leak-test-1"
      },
      payload: {
        password: "body-password-secret",
        nested: { token: "nested-body-token", visible: "kept" }
      }
    });

    expect(response.statusCode).toBe(500);
    expect(response.headers["x-request-id"]).toBe("leak-test-1");
    expect(response.json()).toEqual({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "服务异常，请稍后再试",
        requestId: "leak-test-1"
      }
    });
    expect(response.body).not.toContain("SQLITE_ERROR");
    expect(response.body).not.toContain("/private/tmp");
    expect(response.body).not.toContain("OpenSesame");
    expect(response.body).not.toContain("top-secret");

    const text = logText();
    expect(text).toContain("request_error");
    expect(text).toContain("SQLITE_ERROR");
    expect(text).toContain("/private/tmp/event-arts/prod.db");
    expect(text).not.toContain("live-header-token");
    expect(text).not.toContain("cookie-secret");
    expect(text).not.toContain("body-password-secret");
    expect(text).not.toContain("nested-body-token");
    expect(text).not.toContain("OpenSesame");
    expect(text).not.toContain("top-secret");
    expect(text).not.toContain("edgeone-error-secret-id");
    expect(text).not.toContain("edgeone-error-secret-key");
    expect(text).not.toContain("edgeone-error-master-key");
    expect(text).toContain(redactedValue);
  });

  it("keeps recoverable media operation details in logs without exposing paths to clients", async () => {
    app.delete("/__test/media-recovery", async () => {
      const error = new Error("资源数据库已恢复但文件恢复失败，暂存文件已保留：/private/tmp/uploads/.trash/file-123");
      (error as Error & { code?: string }).code = "MEDIA_RECOVERY_FAILED";
      throw error;
    });

    const response = await app.inject({
      method: "DELETE",
      url: "/__test/media-recovery",
      headers: { "x-request-id": "media-recovery-1" }
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      success: false,
      error: {
        code: "MEDIA_RECOVERY_FAILED",
        message: "资源处理失败，请联系管理员并提供请求 ID",
        requestId: "media-recovery-1"
      }
    });
    expect(response.body).not.toContain("/private/tmp/uploads");
    expect(logText()).toContain("/private/tmp/uploads/.trash/file-123");
    expect(securityEvents()).toContain("media_recovery_failed");
  });
});

describe("centralized security log redaction", () => {
  it("redacts sensitive headers, body fields, config values, and future backup hook payloads", async () => {
    app.post("/__test/security-event", async (request, reply) => {
      logSecurityEvent(request, "backup_restore_requested", {
        headers: request.headers,
        body: request.body as Record<string, unknown>,
        config: {
          jwt: { secret: "jwt-secret-value" },
          JWT_SECRET: "top-level-secret",
          edgeOne: { credentialEncryptionKey: "edgeone-master-key-value" },
          EDGEONE_CREDENTIAL_ENCRYPTION_KEY: "edgeone-env-master-key"
        },
        candidateCredentials: {
          secretId: "edgeone-secret-id-value",
          secretKey: "edgeone-secret-key-value"
        },
        backupArchive: "raw-backup-bytes-secret",
        visible: "kept"
      });
      return reply.send(ok({}));
    });

    const response = await app.inject({
      method: "POST",
      url: "/__test/security-event",
      headers: {
        authorization: "Bearer header-token-secret",
        cookie: "refresh_token=cookie-secret"
      },
      payload: {
        password: "password-secret",
        currentPassword: "current-secret",
        newPassword: "new-secret",
        confirmPassword: "confirm-secret",
        token: "body-token-secret",
        nested: { apiKey: "nested-api-key-secret", visible: "kept" }
      }
    });

    expect(response.statusCode).toBe(200);
    const text = logText();
    expect(text).toContain("backup_restore_requested");
    expect(text).toContain("kept");
    expect(text).toContain(redactedValue);
    for (const secret of [
      "header-token-secret",
      "cookie-secret",
      "password-secret",
      "current-secret",
      "new-secret",
      "confirm-secret",
      "body-token-secret",
      "nested-api-key-secret",
      "jwt-secret-value",
      "top-level-secret",
      "edgeone-master-key-value",
      "edgeone-env-master-key",
      "edgeone-secret-id-value",
      "edgeone-secret-key-value",
      "raw-backup-bytes-secret"
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe("security event coverage", () => {
  it("logs login failure, rate limits, logout revocation, and password changes", async () => {
    const clientToken = await loginClient(app);
    await app.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      remoteAddress: "198.51.100.10",
      payload: { username: testAdminCredentials.username, password: "wrong-password" }
    });
    await app.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      remoteAddress: "198.51.100.10",
      payload: { username: testAdminCredentials.username, password: "wrong-password" }
    });

    await app.inject({
      method: "POST",
      url: "/api/client/track/page-view",
      remoteAddress: "198.51.100.20",
      headers: clientAuthHeaders(clientToken),
      payload: { pagePath: "/pages/index/index", scene: "home" }
    });
    await app.inject({
      method: "POST",
      url: "/api/client/track/page-view",
      remoteAddress: "198.51.100.20",
      headers: clientAuthHeaders(clientToken),
      payload: { pagePath: "/pages/index/index", scene: "home" }
    });

    const logoutToken = await login();
    await app.inject({
      method: "POST",
      url: "/api/admin/auth/logout",
      headers: auth(logoutToken)
    });

    const passwordToken = await login();
    const nextPassword = `Next-${randomUUID()}-Aa1!`;
    await app.inject({
      method: "POST",
      url: "/api/admin/auth/change-password",
      headers: auth(passwordToken),
      payload: {
        currentPassword: testAdminCredentials.password,
        newPassword: nextPassword,
        confirmPassword: nextPassword
      }
    });

    expect(securityEvents()).toEqual(expect.arrayContaining([
      "admin_login_failed",
      "admin_login_rate_limited",
      "analytics_rate_limited",
      "admin_session_revoked",
      "admin_password_changed",
      "admin_sessions_revoked"
    ]));
  });
});
