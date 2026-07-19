import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AdminGrantableMenuKey, AdminRole } from "@event-arts/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createPrismaClient, type AppPrismaClient } from "../src/db";
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
  const hash = new URL(link).hash;
  return decodeURIComponent(hash.replace(/^#token=/, ""));
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
  permissions?: AdminGrantableMenuKey[];
  username?: string;
  password?: string;
}) {
  const password = input.password ?? `Password-${randomUUID()}-Aa1!`;
  const account = await prisma.adminUser.create({
    data: {
      username: input.username ?? `account-${input.role.toLowerCase()}-${randomUUID()}`,
      passwordHash: hashPassword(password),
      role: input.role,
      status: input.status ?? "enabled",
      activatedAt: input.status === "pending_activation" ? null : clockNow,
      menuPermissions: {
        create: (input.permissions ?? []).map((menuKey) => ({ menuKey }))
      }
    },
    include: { menuPermissions: true }
  });
  return { account, password };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "event-arts-admin-users-"));
  uploadDir = path.join(root, "uploads");
  await mkdir(uploadDir, { recursive: true });
  clockNow = new Date("2026-07-19T03:00:00.000Z");
  prisma = createPrismaClient(`file:${path.join(root, "test.db")}`);
  await ensureDatabaseSchema(prisma, { uploadDir });
  await resetTestAdmin(prisma);
  app = await buildApp({
    prisma,
    jwtSecret: "admin-users-test-secret",
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

describe("admin user management", () => {
  it("lets a SUPER_ADMIN create pending ADMIN and USER accounts with one-time activation links", async () => {
    const token = await login();

    const createdAdmin = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      headers: auth(token),
      payload: {
        username: "new-admin",
        role: "ADMIN",
        permissions: ["media-assets"],
        currentPassword: testAdminCredentials.password,
        confirmation: true
      }
    });
    expect(createdAdmin.statusCode).toBe(200);
    const adminData = createdAdmin.json().data;
    expect(adminData.user).toMatchObject({
      username: "new-admin",
      role: "ADMIN",
      status: "pending_activation",
      permissions: ["media-assets", "user-management", "change-password"],
      delegablePermissions: ["media-assets"]
    });
    expect(adminData.activationLink).toContain("/admin/reset-password#token=");
    expect(linkToken(adminData.activationLink)).toHaveLength(43);

    const storedToken = await prisma.adminPasswordResetToken.findFirstOrThrow({
      where: { adminId: adminData.user.id, purpose: "activation" }
    });
    expect(storedToken.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(storedToken.tokenHash).not.toContain(linkToken(adminData.activationLink));

    const createdUser = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      headers: auth(token),
      payload: {
        username: "new-user",
        role: "USER",
        permissions: ["home"],
        currentPassword: testAdminCredentials.password,
        confirmation: true
      }
    });
    expect(createdUser.statusCode).toBe(200);
    expect(createdUser.json().data.user.permissions).toEqual([
      "site-config",
      "announcements",
      "banners",
      "menu-items",
      "change-password"
    ]);

    const rejectedSuper = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      headers: auth(token),
      payload: {
        username: "new-super",
        role: "SUPER_ADMIN",
        currentPassword: testAdminCredentials.password,
        confirmation: true
      }
    });
    expect(rejectedSuper.statusCode).toBe(403);
    expect(await prisma.adminUser.findUnique({ where: { username: "new-super" } })).toBeNull();
  });

  it("allows editing a pending account without implicitly activating it", async () => {
    const token = await login();
    for (const role of ["ADMIN", "USER"] as const) {
      const roleName = role.toLowerCase();
      const create = await app.inject({
        method: "POST",
        url: "/api/admin/users",
        headers: auth(token),
        payload: {
          username: `pending-${roleName}-before-edit`,
          role,
          permissions: [],
          currentPassword: testAdminCredentials.password,
          confirmation: true
        }
      });
      expect(create.statusCode).toBe(200);
      const created = create.json().data;
      const activationToken = linkToken(created.activationLink);
      const tokenBefore = await prisma.adminPasswordResetToken.findFirstOrThrow({
        where: { adminId: created.user.id, purpose: "activation" }
      });

      const response = await app.inject({
        method: "PATCH",
        url: `/api/admin/users/${created.user.publicId}`,
        headers: auth(token),
        payload: {
          username: `pending-${roleName}-after-edit`
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toMatchObject({
        revokedSessionCount: 0,
        revokedResetTokenCount: 0,
        user: {
          username: `pending-${roleName}-after-edit`,
          role,
          status: "pending_activation",
          activatedAt: null
        }
      });
      const tokenAfter = await prisma.adminPasswordResetToken.findUniqueOrThrow({
        where: { id: tokenBefore.id }
      });
      expect(tokenAfter).toMatchObject({
        tokenHash: tokenBefore.tokenHash,
        expiresAt: tokenBefore.expiresAt,
        usedAt: null,
        revokedAt: null
      });

      const nextPassword = `Activated-${role}-${randomUUID()}-Aa1!`;
      const activate = await app.inject({
        method: "POST",
        url: "/api/admin/auth/reset-password",
        payload: {
          token: activationToken,
          newPassword: nextPassword,
          confirmPassword: nextPassword
        }
      });
      expect(activate.statusCode).toBe(200);
      await expect(prisma.adminUser.findUniqueOrThrow({ where: { id: created.user.id } }))
        .resolves.toMatchObject({
          username: `pending-${roleName}-after-edit`,
          status: "enabled",
          activatedAt: clockNow
        });
    }
  });

  it("limits ADMIN management to USER targets and delegable permission subsets without side effects", async () => {
    const admin = await createAccount({ role: "ADMIN", permissions: ["media-assets", "backups"] });
    const user = await createAccount({ role: "USER" });
    const peerAdmin = await createAccount({ role: "ADMIN" });
    await login(user.account.username, user.password);
    const adminToken = await login(admin.account.username, admin.password);

    const allowed = await app.inject({
      method: "PUT",
      url: `/api/admin/users/${user.account.publicId}/permissions`,
      headers: auth(adminToken),
      payload: { permissions: ["media-assets"], confirmation: true }
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().data).toMatchObject({ revokedSessionCount: 1 });
    expect(allowed.json().data.user.permissions).toEqual(["media-assets", "change-password"]);

    const reloginUserToken = await login(user.account.username, user.password);
    const deniedPermission = await app.inject({
      method: "PUT",
      url: `/api/admin/users/${user.account.publicId}/permissions`,
      headers: auth(adminToken),
      payload: { permissions: ["dashboard"], confirmation: true }
    });
    expect(deniedPermission.statusCode).toBe(403);
    expect(await prisma.adminSession.count({
      where: { adminId: user.account.id, revokedAt: null }
    })).toBe(1);
    const me = await app.inject({
      method: "GET",
      url: "/api/admin/auth/me",
      headers: auth(reloginUserToken)
    });
    expect(me.statusCode).toBe(200);

    const deniedSensitivePermission = await app.inject({
      method: "PUT",
      url: `/api/admin/users/${user.account.publicId}/permissions`,
      headers: auth(adminToken),
      payload: { permissions: ["backups"], confirmation: true }
    });
    expect(deniedSensitivePermission.statusCode).toBe(403);
    expect(await prisma.adminMenuPermission.findMany({
      where: { adminId: user.account.id },
      orderBy: { menuKey: "asc" }
    })).toMatchObject([{ menuKey: "media-assets" }]);

    const deniedPeer = await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${peerAdmin.account.publicId}`,
      headers: auth(adminToken),
      payload: { status: "disabled" }
    });
    expect(deniedPeer.statusCode).toBe(403);
    await expect(prisma.adminUser.findUniqueOrThrow({ where: { id: peerAdmin.account.id } }))
      .resolves.toMatchObject({ status: "enabled" });
  });

  it("rejects self-management and lets a SUPER_ADMIN disable and re-enable another SUPER_ADMIN", async () => {
    const token = await login();
    const currentSuper = await prisma.adminUser.findFirstOrThrow({
      where: { username: testAdminCredentials.username }
    });

    const rejectedSelfEdit = await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${currentSuper.publicId}`,
      headers: auth(token),
      payload: {
        status: "disabled",
        currentPassword: testAdminCredentials.password,
        confirmation: true
      }
    });
    expect(rejectedSelfEdit.statusCode).toBe(403);
    await expect(prisma.adminUser.findUniqueOrThrow({ where: { id: currentSuper.id } }))
      .resolves.toMatchObject({ role: "SUPER_ADMIN", status: "enabled" });

    const otherSuper = await createAccount({ role: "SUPER_ADMIN" });
    await login(otherSuper.account.username, otherSuper.password);
    const acceptedDisablePeer = await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${otherSuper.account.publicId}`,
      headers: auth(token),
      payload: {
        status: "disabled",
        currentPassword: testAdminCredentials.password,
        confirmation: true
      }
    });
    expect(acceptedDisablePeer.statusCode).toBe(200);
    expect(acceptedDisablePeer.json().data).toMatchObject({ revokedSessionCount: 1 });
    await expect(prisma.adminUser.findUniqueOrThrow({ where: { id: currentSuper.id } }))
      .resolves.toMatchObject({ role: "SUPER_ADMIN", status: "enabled" });
    await expect(prisma.adminUser.findUniqueOrThrow({ where: { id: otherSuper.account.id } }))
      .resolves.toMatchObject({ role: "SUPER_ADMIN", status: "disabled" });

    const acceptedEnablePeer = await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${otherSuper.account.publicId}`,
      headers: auth(token),
      payload: {
        role: "SUPER_ADMIN",
        status: "enabled",
        currentPassword: testAdminCredentials.password,
        confirmation: true
      }
    });
    expect(acceptedEnablePeer.statusCode).toBe(200);
    await expect(prisma.adminUser.findUniqueOrThrow({ where: { id: otherSuper.account.id } }))
      .resolves.toMatchObject({ role: "SUPER_ADMIN", status: "enabled" });
  });

  it("keeps at least one enabled SUPER_ADMIN after concurrent cross-disable attempts", async () => {
    const currentSuper = await prisma.adminUser.findFirstOrThrow({
      where: { username: testAdminCredentials.username }
    });
    const otherSuper = await createAccount({ role: "SUPER_ADMIN" });
    const currentToken = await login();
    const otherToken = await login(otherSuper.account.username, otherSuper.password);

    const responses = await Promise.all([
      app.inject({
        method: "PATCH",
        url: `/api/admin/users/${otherSuper.account.publicId}`,
        headers: auth(currentToken),
        payload: {
          status: "disabled",
          currentPassword: testAdminCredentials.password,
          confirmation: true
        }
      }),
      app.inject({
        method: "PATCH",
        url: `/api/admin/users/${currentSuper.publicId}`,
        headers: auth(otherToken),
        payload: {
          role: "ADMIN",
          currentPassword: otherSuper.password,
          confirmation: true
        }
      })
    ]);

    const statusCodes = responses.map((response) => response.statusCode);
    expect(statusCodes).toContain(200);
    expect(statusCodes.some((statusCode) => statusCode !== 200)).toBe(true);
    expect(await prisma.adminUser.count({
      where: { role: "SUPER_ADMIN", status: "enabled" }
    })).toBeGreaterThanOrEqual(1);
  });
});
