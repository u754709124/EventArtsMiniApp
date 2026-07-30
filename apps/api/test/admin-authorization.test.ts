import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AdminGrantableMenuKey, AdminRole } from "@event-arts/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  adminRoutePolicies,
  assertAdminRoutePolicyCoverage
} from "../src/admin-authorization";
import { buildApp } from "../src/app";
import { createPrismaClient, type AppPrismaClient } from "../src/db";
import { hashPassword } from "../src/security";
import { ensureDatabaseSchema } from "../src/sqlite-schema";

type JwtPayload = {
  id: number;
  username: string;
  jti: string;
};

type LoginData = {
  token: string;
  id: number;
  publicId: string;
  username: string;
  role: AdminRole;
  status: "enabled";
  permissions: string[];
  delegablePermissions: string[];
};

let root: string;
let uploadDir: string;
let prisma: AppPrismaClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let clockNow: Date;

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

function decodeJwtPayload(token: string) {
  const [, payload] = token.split(".");
  if (!payload) throw new Error("missing JWT payload");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as JwtPayload;
}

async function createAdmin(input: {
  role: AdminRole;
  permissions?: AdminGrantableMenuKey[];
  username?: string;
  password?: string;
}) {
  const username = input.username ?? `admin-${input.role.toLowerCase()}-${randomUUID()}`;
  const password = input.password ?? `Password-${randomUUID()}-Aa1!`;
  const admin = await prisma.adminUser.create({
    data: {
      username,
      passwordHash: hashPassword(password),
      role: input.role,
      status: "enabled",
      activatedAt: clockNow,
      menuPermissions: {
        create: (input.permissions ?? []).map((menuKey) => ({ menuKey }))
      }
    },
    include: { menuPermissions: true }
  });
  return { admin, username, password };
}

async function login(username: string, password: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: { username, password }
  });
  expect(response.statusCode).toBe(200);
  const body = response.json();
  expect(body.success).toBe(true);
  return body.data as LoginData;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "event-arts-admin-authz-"));
  uploadDir = path.join(root, "uploads");
  await mkdir(uploadDir, { recursive: true });
  clockNow = new Date();
  prisma = createPrismaClient(`file:${path.join(root, "test.db")}`);
  await ensureDatabaseSchema(prisma, { uploadDir });
  app = await buildApp({
    prisma,
    jwtSecret: "admin-authorization-test-secret",
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

describe("admin authorization", () => {
  it("computes identity from live database grants and drops access after permission deletion", async () => {
    const account = await createAdmin({ role: "ADMIN", permissions: ["dashboard"] });
    const loginData = await login(account.username, account.password);

    expect(loginData).toMatchObject({
      id: account.admin.id,
      publicId: account.admin.publicId,
      username: account.username,
      role: "ADMIN",
      status: "enabled"
    });
    expect(loginData.permissions).toEqual(["dashboard", "user-management", "change-password"]);
    expect(loginData.delegablePermissions).toEqual(["dashboard"]);

    const allowed = await app.inject({
      method: "GET",
      url: "/api/admin/dashboard/overview",
      headers: auth(loginData.token)
    });
    expect(allowed.statusCode).toBe(200);

    await prisma.adminMenuPermission.deleteMany({
      where: { adminId: account.admin.id, menuKey: "dashboard" }
    });

    const denied = await app.inject({
      method: "GET",
      url: "/api/admin/dashboard/overview",
      headers: auth(loginData.token)
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({
      success: false,
      error: { code: "FORBIDDEN" }
    });

    const me = await app.inject({
      method: "GET",
      url: "/api/admin/auth/me",
      headers: auth(loginData.token)
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.permissions).toEqual(["user-management", "change-password"]);
    expect(me.json().data.delegablePermissions).toEqual([]);
  });

  it("enforces the SUPER_ADMIN, ADMIN, and USER menu matrix", async () => {
    const superAdmin = await createAdmin({ role: "SUPER_ADMIN" });
    const admin = await createAdmin({ role: "ADMIN", permissions: ["media-assets"] });
    const user = await createAdmin({ role: "USER", permissions: ["media-assets"] });

    const superLogin = await login(superAdmin.username, superAdmin.password);
    const adminLogin = await login(admin.username, admin.password);
    const userLogin = await login(user.username, user.password);

    expect(superLogin.permissions).toContain("scheduled-tasks");
    expect(superLogin.permissions).toContain("backups");
    expect(superLogin.delegablePermissions).toEqual([
      "dashboard",
      "site-config",
      "announcements",
      "banners",
      "menu-items",
      "artists",
      "cases",
      "recent-activities",
      "articles",
      "detail-pages",
      "media-assets",
      "backups",
      "scheduled-tasks",
      "system-config"
    ]);
    expect(adminLogin.permissions).toEqual(["media-assets", "user-management", "change-password"]);
    expect(adminLogin.delegablePermissions).toEqual(["media-assets"]);
    expect(userLogin.permissions).toEqual(["media-assets", "change-password"]);
    expect(userLogin.delegablePermissions).toEqual([]);

    const superScheduled = await app.inject({
      method: "GET",
      url: "/api/admin/scheduled-tasks",
      headers: auth(superLogin.token)
    });
    expect(superScheduled.statusCode).toBe(200);

    const adminMedia = await app.inject({
      method: "GET",
      url: "/api/admin/media-assets/upload-config",
      headers: auth(adminLogin.token)
    });
    expect(adminMedia.statusCode).toBe(200);

    const userMedia = await app.inject({
      method: "GET",
      url: "/api/admin/media-assets/upload-config",
      headers: auth(userLogin.token)
    });
    expect(userMedia.statusCode).toBe(200);

    const adminScheduled = await app.inject({
      method: "GET",
      url: "/api/admin/scheduled-tasks",
      headers: auth(adminLogin.token)
    });
    expect(adminScheduled.statusCode).toBe(403);

    const userDashboard = await app.inject({
      method: "GET",
      url: "/api/admin/dashboard/overview",
      headers: auth(userLogin.token)
    });
    expect(userDashboard.statusCode).toBe(403);
  });

  it("allows sensitive admin routes only through live explicit menu grants", async () => {
    const sensitiveAdmin = await createAdmin({
      role: "ADMIN",
      permissions: ["backups", "scheduled-tasks", "system-config"]
    });
    const plainAdmin = await createAdmin({ role: "ADMIN", permissions: ["media-assets"] });

    const sensitiveLogin = await login(sensitiveAdmin.username, sensitiveAdmin.password);
    const plainLogin = await login(plainAdmin.username, plainAdmin.password);

    expect(sensitiveLogin.permissions).toEqual([
      "user-management",
      "backups",
      "change-password",
      "scheduled-tasks",
      "system-config"
    ]);
    expect(sensitiveLogin.delegablePermissions).toEqual([]);

    for (const url of [
      "/api/admin/backups",
      "/api/admin/scheduled-tasks",
      "/api/admin/system-config/edgeone"
    ]) {
      const allowed = await app.inject({ method: "GET", url, headers: auth(sensitiveLogin.token) });
      expect(allowed.statusCode).toBe(200);

      const denied = await app.inject({ method: "GET", url, headers: auth(plainLogin.token) });
      expect(denied.statusCode).toBe(403);
      expect(denied.json()).toMatchObject({
        success: false,
        error: { code: "FORBIDDEN" }
      });
    }
  });

  it("ignores forged role and permission claims embedded in a JWT", async () => {
    const account = await createAdmin({ role: "USER", permissions: [] });
    const loginData = await login(account.username, account.password);
    const payload = decodeJwtPayload(loginData.token);
    const forgedToken = app.jwt.sign(
      {
        id: payload.id,
        username: payload.username,
        jti: payload.jti,
        role: "SUPER_ADMIN",
        permissions: ["dashboard", "scheduled-tasks", "backups"]
      },
      { expiresIn: "2h" }
    );

    const response = await app.inject({
      method: "GET",
      url: "/api/admin/scheduled-tasks",
      headers: auth(forgedToken)
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      success: false,
      error: { code: "FORBIDDEN" }
    });
  });

  it("fails closed when an admin route is registered without a policy", async () => {
    expect(() =>
      assertAdminRoutePolicyCoverage([
        ...adminRoutePolicies.map((entry) => ({ method: entry.method, url: entry.path })),
        { method: "GET", url: "/api/admin/unmapped-test-route" }
      ])
    ).toThrow(/未声明后台路由访问策略/);
  });
});
