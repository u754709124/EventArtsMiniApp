import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AdminRole } from "@event-arts/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminResetTokenRevokeReasons, adminSessionRevokeReasons } from "../src/admin-sessions";
import { buildApp } from "../src/app";
import { createPrismaClient, type AppPrismaClient } from "../src/db";
import { hashAdminPasswordResetToken } from "../src/admin-password-reset";
import { hashPassword } from "../src/security";
import { ensureDatabaseSchema } from "../src/sqlite-schema";
import { resetTestAdmin, testAdminCredentials } from "./fixtures";

let root: string;
let uploadDir: string;
let prisma: AppPrismaClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let clockNow: Date;

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

function linkToken(link: string) {
  return decodeURIComponent(new URL(link).hash.replace(/^#token=/, ""));
}

async function login(username: string = testAdminCredentials.username, password: string = testAdminCredentials.password) {
  const response = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: { username, password }
  });
  expect(response.statusCode).toBe(200);
  return String(response.json().data.token);
}

async function createAccount(input: {
  role: AdminRole;
  status?: "pending_activation" | "enabled" | "disabled";
  username?: string;
  password?: string;
}) {
  const password = input.password ?? `Password-${randomUUID()}-Aa1!`;
  const account = await prisma.adminUser.create({
    data: {
      username: input.username ?? `reset-${input.role.toLowerCase()}-${randomUUID()}`,
      passwordHash: hashPassword(password),
      role: input.role,
      status: input.status ?? "enabled",
      activatedAt: input.status === "pending_activation" ? null : clockNow
    }
  });
  return { account, password };
}

async function issueLink(issuerToken: string, targetPublicId: string, currentPassword: string, purpose = "recovery") {
  return app.inject({
    method: "POST",
    url: `/api/admin/users/${targetPublicId}/reset-links`,
    headers: auth(issuerToken),
    payload: { purpose, currentPassword, confirmation: true }
  });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "event-arts-admin-reset-"));
  uploadDir = path.join(root, "uploads");
  await mkdir(uploadDir, { recursive: true });
  clockNow = new Date("2026-07-19T04:00:00.000Z");
  prisma = createPrismaClient(`file:${path.join(root, "test.db")}`);
  await ensureDatabaseSchema(prisma, { uploadDir });
  await resetTestAdmin(prisma);
  app = await buildApp({
    prisma,
    jwtSecret: "admin-password-reset-test-secret",
    uploadDir,
    publicBaseUrl: "http://127.0.0.1:3001",
    now: () => clockNow,
    rateLimit: {
      login: { windowMs: 10_000, maxFailures: 10 },
      adminPasswordReset: { windowMs: 10_000, maxRequests: 20, tokenTtlMinutes: 30 },
      analytics: { windowMs: 10_000, maxRequests: 20 }
    }
  });
});

afterEach(async () => {
  await app.close();
  await prisma.$disconnect();
  await rm(root, { recursive: true, force: true });
});

describe("admin password reset links", () => {
  it("enforces the issuer-target matrix and keeps forbidden attempts side-effect free", async () => {
    const superToken = await login();
    const admin = await createAccount({ role: "ADMIN" });
    const user = await createAccount({ role: "USER" });
    const peerAdmin = await createAccount({ role: "ADMIN" });
    const otherSuper = await createAccount({ role: "SUPER_ADMIN" });
    const adminToken = await login(admin.account.username, admin.password);

    await login(peerAdmin.account.username, peerAdmin.password);
    await login(peerAdmin.account.username, peerAdmin.password);
    await prisma.adminPasswordResetToken.create({
      data: {
        adminId: peerAdmin.account.id,
        purpose: "recovery",
        tokenHash: hashAdminPasswordResetToken(`old-${randomUUID()}`),
        createdBy: admin.account.id,
        targetRoleAtIssue: "ADMIN",
        expiresAt: new Date(clockNow.getTime() + 30 * 60_000)
      }
    });

    const superToAdmin = await issueLink(superToken, peerAdmin.account.publicId, testAdminCredentials.password);
    expect(superToAdmin.statusCode).toBe(200);
    expect(superToAdmin.json().data).toMatchObject({
      purpose: "recovery",
      revokedSessionCount: 2,
      revokedResetTokenCount: 1
    });
    expect(superToAdmin.json().data.resetLink).toContain("#token=");

    const superToUser = await issueLink(superToken, user.account.publicId, testAdminCredentials.password);
    expect(superToUser.statusCode).toBe(200);

    const adminToUser = await issueLink(adminToken, user.account.publicId, admin.password);
    expect(adminToUser.statusCode).toBe(200);
    const freshUserToken = await login(user.account.username, user.password);

    const forbiddenCases = [
      ["SUPER_ADMIN -> SUPER_ADMIN", superToken, otherSuper.account.publicId, testAdminCredentials.password],
      ["ADMIN -> ADMIN", adminToken, peerAdmin.account.publicId, admin.password],
      ["ADMIN -> SUPER_ADMIN", adminToken, otherSuper.account.publicId, admin.password],
      ["ADMIN -> self", adminToken, admin.account.publicId, admin.password],
      ["USER -> USER route", freshUserToken, user.account.publicId, user.password]
    ] as const;
    for (const [, token, targetPublicId, currentPassword] of forbiddenCases) {
      const beforeTokens = await prisma.adminPasswordResetToken.count();
      const beforeActiveSessions = await prisma.adminSession.count({ where: { revokedAt: null } });
      const response = await issueLink(token, targetPublicId, currentPassword);
      expect(response.statusCode).toBe(403);
      expect(await prisma.adminPasswordResetToken.count()).toBe(beforeTokens);
      expect(await prisma.adminSession.count({ where: { revokedAt: null } })).toBe(beforeActiveSessions);
    }
  });

  it("activates pending accounts, rejects replay, and allows recovery for enabled accounts", async () => {
    const superToken = await login();
    const create = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      headers: auth(superToken),
      payload: {
        username: "pending-user",
        role: "USER",
        permissions: ["media-assets"],
        currentPassword: testAdminCredentials.password,
        confirmation: true
      }
    });
    expect(create.statusCode).toBe(200);
    const activationToken = linkToken(create.json().data.activationLink);
    const activatedPassword = `Activated-${randomUUID()}-Aa1!`;
    const activate = await app.inject({
      method: "POST",
      url: "/api/admin/auth/reset-password",
      payload: {
        token: activationToken,
        newPassword: activatedPassword,
        confirmPassword: activatedPassword
      }
    });
    expect(activate.statusCode).toBe(200);
    expect(activate.json().data).toMatchObject({ purpose: "activation" });
    await expect(prisma.adminUser.findUniqueOrThrow({ where: { username: "pending-user" } }))
      .resolves.toMatchObject({ status: "enabled" });
    expect(await login("pending-user", activatedPassword)).toEqual(expect.any(String));

    const replayPassword = `Replay-${randomUUID()}-Aa1!`;
    const replay = await app.inject({
      method: "POST",
      url: "/api/admin/auth/reset-password",
      payload: {
        token: activationToken,
        newPassword: replayPassword,
        confirmPassword: replayPassword
      }
    });
    expect(replay.statusCode).toBe(400);
    expect(replay.json().error.code).toBe("PASSWORD_RESET_TOKEN_INVALID");

    const user = await prisma.adminUser.findUniqueOrThrow({ where: { username: "pending-user" } });
    const userToken = await login("pending-user", activatedPassword);
    const recovery = await issueLink(superToken, user.publicId, testAdminCredentials.password);
    expect(recovery.statusCode).toBe(200);
    expect(recovery.json().data.revokedSessionCount).toBeGreaterThanOrEqual(1);
    const recoveredPassword = `Recovered-${randomUUID()}-Aa1!`;
    const consumed = await app.inject({
      method: "POST",
      url: "/api/admin/auth/reset-password",
      payload: {
        token: linkToken(recovery.json().data.resetLink),
        newPassword: recoveredPassword,
        confirmPassword: recoveredPassword
      }
    });
    expect(consumed.statusCode).toBe(200);
    expect(consumed.json().data).toMatchObject({ purpose: "recovery" });
    const oldSession = await app.inject({
      method: "GET",
      url: "/api/admin/auth/me",
      headers: auth(userToken)
    });
    expect(oldSession.statusCode).toBe(401);
    expect(await login("pending-user", recoveredPassword)).toEqual(expect.any(String));
  });

  it("rejects expired, revoked, role-changed, and SUPER_ADMIN web reset tokens", async () => {
    const superToken = await login();
    const user = await createAccount({ role: "USER" });
    const admin = await createAccount({ role: "ADMIN" });
    const otherSuper = await createAccount({ role: "SUPER_ADMIN" });

    const roleLink = await issueLink(superToken, user.account.publicId, testAdminCredentials.password);
    expect(roleLink.statusCode).toBe(200);
    await prisma.adminUser.update({ where: { id: user.account.id }, data: { role: "ADMIN" } });
    const roleChangedPassword = `RoleChanged-${randomUUID()}-Aa1!`;
    const roleChanged = await app.inject({
      method: "POST",
      url: "/api/admin/auth/reset-password",
      payload: {
        token: linkToken(roleLink.json().data.resetLink),
        newPassword: roleChangedPassword,
        confirmPassword: roleChangedPassword
      }
    });
    expect(roleChanged.statusCode).toBe(400);

    const expiredLink = await issueLink(superToken, admin.account.publicId, testAdminCredentials.password);
    clockNow = new Date(clockNow.getTime() + 31 * 60_000);
    const expiredPassword = `Expired-${randomUUID()}-Aa1!`;
    const expired = await app.inject({
      method: "POST",
      url: "/api/admin/auth/reset-password",
      payload: {
        token: linkToken(expiredLink.json().data.resetLink),
        newPassword: expiredPassword,
        confirmPassword: expiredPassword
      }
    });
    expect(expired.statusCode).toBe(400);

    const superTokenValue = `super-${randomUUID()}-token-value`;
    await prisma.adminPasswordResetToken.create({
      data: {
        adminId: otherSuper.account.id,
        purpose: "recovery",
        tokenHash: hashAdminPasswordResetToken(superTokenValue),
        createdBy: (await prisma.adminUser.findFirstOrThrow({ where: { username: testAdminCredentials.username } })).id,
        targetRoleAtIssue: "SUPER_ADMIN",
        expiresAt: new Date(clockNow.getTime() + 30 * 60_000)
      }
    });
    const superWebResetPassword = `ForbiddenSuper-${randomUUID()}-Aa1!`;
    const superWebReset = await app.inject({
      method: "POST",
      url: "/api/admin/auth/reset-password",
      payload: {
        token: superTokenValue,
        newPassword: superWebResetPassword,
        confirmPassword: superWebResetPassword
      }
    });
    expect(superWebReset.statusCode).toBe(400);
    expect(superWebReset.json().error.code).toBe("PASSWORD_RESET_TOKEN_INVALID");

    const revokedTokenValue = `revoked-${randomUUID()}-token-value`;
    await prisma.adminPasswordResetToken.create({
      data: {
        adminId: user.account.id,
        purpose: "recovery",
        tokenHash: hashAdminPasswordResetToken(revokedTokenValue),
        createdBy: (await prisma.adminUser.findFirstOrThrow({ where: { username: testAdminCredentials.username } })).id,
        targetRoleAtIssue: "ADMIN",
        expiresAt: new Date(clockNow.getTime() + 30 * 60_000),
        revokedAt: clockNow,
        revokeReason: adminResetTokenRevokeReasons.newTokenIssued
      }
    });
    const revokedPassword = `Revoked-${randomUUID()}-Aa1!`;
    const revoked = await app.inject({
      method: "POST",
      url: "/api/admin/auth/reset-password",
      payload: {
        token: revokedTokenValue,
        newPassword: revokedPassword,
        confirmPassword: revokedPassword
      }
    });
    expect(revoked.statusCode).toBe(400);
  });

  it("allows only one concurrent token consumption to succeed", async () => {
    const superToken = await login();
    const user = await createAccount({ role: "USER" });
    await login(user.account.username, user.password);
    const link = await issueLink(superToken, user.account.publicId, testAdminCredentials.password);
    expect(link.statusCode).toBe(200);
    const token = linkToken(link.json().data.resetLink);

    const nextPassword = `Concurrent-${randomUUID()}-Aa1!`;
    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/admin/auth/reset-password",
        payload: { token, newPassword: nextPassword, confirmPassword: nextPassword }
      }),
      app.inject({
        method: "POST",
        url: "/api/admin/auth/reset-password",
        payload: { token, newPassword: nextPassword, confirmPassword: nextPassword }
      })
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 400]);
    const tokenRow = await prisma.adminPasswordResetToken.findUniqueOrThrow({
      where: { tokenHash: hashAdminPasswordResetToken(token) }
    });
    expect(tokenRow.usedAt).toBeInstanceOf(Date);
    expect(await prisma.adminSession.count({
      where: {
        adminId: user.account.id,
        revokeReason: adminSessionRevokeReasons.passwordChanged
      }
    })).toBeGreaterThanOrEqual(1);
  });
});
