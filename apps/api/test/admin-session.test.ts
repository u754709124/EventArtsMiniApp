import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ADMIN_SESSION_TTL_MS,
  ADMIN_SESSION_TTL_SECONDS,
  adminSessionRevokeReasons,
  cleanupExpiredAdminSessions
} from "../src/admin-sessions";
import { buildApp } from "../src/app";
import { createPrismaClient, type AppPrismaClient } from "../src/db";
import { hashPassword } from "../src/security";
import { ensureDatabaseSchema } from "../src/sqlite-schema";
import { resetTestAdmin, testAdminCredentials } from "./fixtures";

type JwtPayload = {
  id: number;
  username: string;
  jti: string;
  iat: number;
  exp: number;
};

let root: string;
let uploadDir: string;
let prisma: AppPrismaClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let clockNow: Date;

function decodeJwtPayload(token: string) {
  const [, payload] = token.split(".");
  if (!payload) throw new Error("missing JWT payload");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as JwtPayload;
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
  const body = response.json();
  expect(body.success).toBe(true);
  return String(body.data.token);
}

async function expectUnauthorized(token: string) {
  const response = await app.inject({
    method: "GET",
    url: "/api/admin/auth/me",
    headers: auth(token)
  });
  expect(response.statusCode).toBe(401);
  expect(response.json()).toMatchObject({
    success: false,
    error: { code: "UNAUTHORIZED" }
  });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "event-arts-g03-"));
  uploadDir = path.join(root, "uploads");
  await mkdir(uploadDir, { recursive: true });
  clockNow = new Date();
  prisma = createPrismaClient(`file:${path.join(root, "test.db")}`);
  await ensureDatabaseSchema(prisma, { uploadDir });
  await resetTestAdmin(prisma);
  app = await buildApp({
    prisma,
    jwtSecret: "admin-session-test-secret",
    uploadDir,
    publicBaseUrl: "http://127.0.0.1:3001",
    now: () => clockNow
  });
});

afterEach(async () => {
  await app.close();
  await prisma.$disconnect();
  await rm(root, { recursive: true, force: true });
});

describe("revocable admin sessions", () => {
  it("creates a server session and issues a token that lasts no more than 2 hours", async () => {
    const token = await login();
    const payload = decodeJwtPayload(token);
    const session = await prisma.adminSession.findUniqueOrThrow({ where: { jti: payload.jti } });

    expect(payload.username).toBe(testAdminCredentials.username);
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(ADMIN_SESSION_TTL_SECONDS);
    expect(session.adminId).toBe(payload.id);
    expect(session.revokedAt).toBeNull();
    expect(session.revokeReason).toBeNull();
    expect(session.expiresAt.getTime() - session.createdAt.getTime()).toBe(ADMIN_SESSION_TTL_MS);

    const me = await app.inject({ method: "GET", url: "/api/admin/auth/me", headers: auth(token) });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      success: true,
      data: { id: payload.id, username: testAdminCredentials.username }
    });
  });

  it("rejects unknown, expired, revoked, and disabled administrator sessions", async () => {
    const token = await login();
    const payload = decodeJwtPayload(token);
    const unknownToken = app.jwt.sign(
      { id: payload.id, username: payload.username, jti: `missing-${randomUUID()}` },
      { expiresIn: "2h" }
    );
    await expectUnauthorized(unknownToken);

    clockNow = new Date(clockNow.getTime() + ADMIN_SESSION_TTL_MS + 1);
    await expectUnauthorized(token);

    clockNow = new Date();
    const revokedToken = await login();
    const revokedPayload = decodeJwtPayload(revokedToken);
    await prisma.adminSession.update({
      where: { jti: revokedPayload.jti },
      data: { revokedAt: clockNow, revokeReason: "manual_test" }
    });
    await expectUnauthorized(revokedToken);

    const disabledToken = await login();
    await prisma.adminUser.updateMany({ data: { status: "disabled" } });
    await expectUnauthorized(disabledToken);
  });

  it("revokes only the current session on logout", async () => {
    const firstToken = await login();
    const secondToken = await login();
    const firstPayload = decodeJwtPayload(firstToken);
    const secondPayload = decodeJwtPayload(secondToken);

    const logout = await app.inject({
      method: "POST",
      url: "/api/admin/auth/logout",
      headers: auth(firstToken)
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.json()).toEqual({ success: true, data: {}, message: "ok" });

    const firstSession = await prisma.adminSession.findUniqueOrThrow({ where: { jti: firstPayload.jti } });
    const secondSession = await prisma.adminSession.findUniqueOrThrow({ where: { jti: secondPayload.jti } });
    expect(firstSession.revokedAt).toBeInstanceOf(Date);
    expect(firstSession.revokeReason).toBe(adminSessionRevokeReasons.logout);
    expect(secondSession.revokedAt).toBeNull();

    await expectUnauthorized(firstToken);
    const stillActive = await app.inject({ method: "GET", url: "/api/admin/auth/me", headers: auth(secondToken) });
    expect(stillActive.statusCode).toBe(200);
  });

  it("changes the password, revokes all sessions, and rejects old credentials", async () => {
    const firstToken = await login();
    const secondToken = await login();
    const nextPassword = `Next-${randomUUID()}-Aa1!`;

    const response = await app.inject({
      method: "POST",
      url: "/api/admin/auth/change-password",
      headers: auth(firstToken),
      payload: {
        currentPassword: testAdminCredentials.password,
        newPassword: nextPassword,
        confirmPassword: nextPassword
      }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: { revokedSessionCount: 2 }
    });

    await expectUnauthorized(firstToken);
    await expectUnauthorized(secondToken);

    const oldPasswordLogin = await app.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      payload: testAdminCredentials
    });
    expect(oldPasswordLogin.statusCode).toBe(401);

    const newToken = await login(nextPassword);
    const newMe = await app.inject({ method: "GET", url: "/api/admin/auth/me", headers: auth(newToken) });
    expect(newMe.statusCode).toBe(200);

    const revokedSessions = await prisma.adminSession.findMany({
      where: { revokeReason: adminSessionRevokeReasons.passwordChanged }
    });
    expect(revokedSessions).toHaveLength(2);
  });

  it("rejects wrong current passwords and weak new passwords without revoking the active session", async () => {
    const token = await login();
    const weakPassword = await app.inject({
      method: "POST",
      url: "/api/admin/auth/change-password",
      headers: auth(token),
      payload: {
        currentPassword: testAdminCredentials.password,
        newPassword: "weak-password",
        confirmPassword: "weak-password"
      }
    });
    expect(weakPassword.statusCode).toBe(400);
    expect(weakPassword.json()).toMatchObject({
      success: false,
      error: { code: "WEAK_PASSWORD" }
    });

    const strongPassword = `WrongCurrent-${randomUUID()}-Aa1!`;
    const wrongCurrent = await app.inject({
      method: "POST",
      url: "/api/admin/auth/change-password",
      headers: auth(token),
      payload: {
        currentPassword: "wrong",
        newPassword: strongPassword,
        confirmPassword: strongPassword
      }
    });
    expect(wrongCurrent.statusCode).toBe(401);
    expect(wrongCurrent.json()).toMatchObject({
      success: false,
      error: { code: "INVALID_CREDENTIALS" }
    });

    const stillActive = await app.inject({ method: "GET", url: "/api/admin/auth/me", headers: auth(token) });
    expect(stillActive.statusCode).toBe(200);
  });

  it("does not revoke the active session when the stored password was changed concurrently", async () => {
    const token = await login();
    const admin = await prisma.adminUser.findFirstOrThrow({ where: { username: testAdminCredentials.username } });
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { passwordHash: hashPassword(`AlreadyChanged-${randomUUID()}-Aa1!`) }
    });

    const concurrentPassword = `Concurrent-${randomUUID()}-Aa1!`;
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/auth/change-password",
      headers: auth(token),
      payload: {
        currentPassword: testAdminCredentials.password,
        newPassword: concurrentPassword,
        confirmPassword: concurrentPassword
      }
    });

    expect(response.statusCode).toBe(401);
    const session = await prisma.adminSession.findFirstOrThrow();
    expect(session.revokedAt).toBeNull();
  });

  it("cleans up expired administrator session records without deleting active records", async () => {
    const token = await login();
    const activePayload = decodeJwtPayload(token);
    const admin = await prisma.adminUser.findFirstOrThrow({ where: { username: testAdminCredentials.username } });
    const expiredJti = `expired-${randomUUID()}`;
    await prisma.adminSession.create({
      data: {
        jti: expiredJti,
        adminId: admin.id,
        createdAt: new Date(clockNow.getTime() - ADMIN_SESSION_TTL_MS - 10_000),
        expiresAt: new Date(clockNow.getTime() - 10_000)
      }
    });

    const result = await cleanupExpiredAdminSessions(prisma, clockNow);
    expect(result.deletedCount).toBe(1);
    await expect(prisma.adminSession.findUnique({ where: { jti: expiredJti } })).resolves.toBeNull();
    await expect(prisma.adminSession.findUnique({ where: { jti: activePayload.jti } })).resolves.not.toBeNull();
  });
});
