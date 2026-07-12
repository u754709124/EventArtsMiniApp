import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createPrismaClient, type AppPrismaClient } from "../src/db";
import { ensureDatabaseSchema } from "../src/sqlite-schema";
import {
  clientAuthHeaders,
  createTestWeChatLoginCodeVerifier,
  loginClient,
  testClientAuthConfig
} from "./fixtures";

let root: string;
let uploadDir: string;
let prisma: AppPrismaClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let clientToken: string;

async function createApp(input: { allowRequestsWithoutOrigin: boolean }) {
  return buildApp({
    prisma,
    jwtSecret: "cors-test-secret",
    uploadDir,
    publicBaseUrl: "http://127.0.0.1:3001",
    clientAuth: testClientAuthConfig,
    weChatLoginCodeVerifier: createTestWeChatLoginCodeVerifier(),
    cors: {
      allowedOrigins: ["https://admin.example.com", "https://miniapp.example.com"],
      allowRequestsWithoutOrigin: input.allowRequestsWithoutOrigin
    }
  });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "event-arts-cors-"));
  uploadDir = path.join(root, "uploads");
  await mkdir(uploadDir, { recursive: true });
  prisma = createPrismaClient(`file:${path.join(root, "test.db")}`);
  await ensureDatabaseSchema(prisma, { uploadDir });
  app = await createApp({ allowRequestsWithoutOrigin: true });
  clientToken = await loginClient(app);
});

afterEach(async () => {
  await app.close();
  await prisma.$disconnect();
  await rm(root, { recursive: true, force: true });
});

describe("strict CORS allowlist", () => {
  it("allows only configured browser origins and exposes the request ID header", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/client/menu-items",
      headers: {
        ...clientAuthHeaders(clientToken),
        origin: "https://admin.example.com",
        "x-request-id": "cors-allowed-1"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("https://admin.example.com");
    expect(response.headers["access-control-expose-headers"]).toContain("X-Request-Id");
    expect(response.headers["x-request-id"]).toBe("cors-allowed-1");
  });

  it("rejects unknown, wildcard-like, and malformed origins instead of reflecting them", async () => {
    const origins = [
      "https://evil.example.com",
      "https://admin.example.com.evil.test",
      "null",
      "file://local-app"
    ];

    for (const origin of origins) {
      const response = await app.inject({
        method: "GET",
        url: "/api/client/menu-items",
        headers: { origin }
      });

      expect(response.statusCode).toBe(403);
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
      expect(response.json()).toEqual({
        success: false,
        error: { code: "FORBIDDEN", message: "请求来源不被允许" }
      });
    }
  });

  it("handles preflight through the same allowlist", async () => {
    const allowed = await app.inject({
      method: "OPTIONS",
      url: "/api/admin/auth/login",
      headers: {
        origin: "https://miniapp.example.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,authorization"
      }
    });
    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://miniapp.example.com");
    expect(allowed.headers["access-control-allow-headers"]).toContain("Authorization");

    const rejected = await app.inject({
      method: "OPTIONS",
      url: "/api/admin/auth/login",
      headers: {
        origin: "https://evil.example.com",
        "access-control-request-method": "POST"
      }
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("honors CORS_ALLOW_REQUESTS_WITHOUT_ORIGIN explicitly", async () => {
    const allowed = await app.inject({
      method: "GET",
      url: "/api/client/menu-items",
      headers: clientAuthHeaders(clientToken)
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers["access-control-allow-origin"]).toBeUndefined();

    await app.close();
    app = await createApp({ allowRequestsWithoutOrigin: false });

    const rejected = await app.inject({
      method: "GET",
      url: "/api/client/menu-items",
      headers: clientAuthHeaders(clientToken)
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json()).toEqual({
      success: false,
      error: { code: "FORBIDDEN", message: "请求来源不被允许" }
    });
  });
});
