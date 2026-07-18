import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ADMIN_NOTIFICATION_MAX_FUTURE_SKEW_MS,
  ADMIN_NOTIFICATION_RETENTION_MS,
  cleanupExpiredAdminNotifications
} from "../src/admin-notifications";
import { buildApp } from "../src/app";
import { createPrismaClient, type AppPrismaClient } from "../src/db";
import { hashPassword } from "../src/security";
import { ensureDatabaseSchema } from "../src/sqlite-schema";
import { resetTestAdmin, testAdminCredentials } from "./fixtures";

let root: string;
let uploadDir: string;
let prisma: AppPrismaClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let now: Date;

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function login(
  username: string = testAdminCredentials.username,
  password: string = testAdminCredentials.password
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: { username, password }
  });
  expect(response.statusCode).toBe(200);
  return String(response.json().data.token);
}

async function postNotification(
  token: string,
  input: Partial<{ clientEventId: string; level: string; message: string; occurredAt: string }> = {}
) {
  return app.inject({
    method: "POST",
    url: "/api/admin/notifications",
    headers: auth(token),
    payload: {
      clientEventId: randomUUID(),
      level: "success",
      message: "保存成功",
      occurredAt: now.toISOString(),
      ...input
    }
  });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "event-arts-admin-notifications-"));
  uploadDir = path.join(root, "uploads");
  await mkdir(uploadDir, { recursive: true });
  now = new Date("2026-07-17T12:00:00.000Z");
  prisma = createPrismaClient(`file:${path.join(root, "test.db")}`);
  await ensureDatabaseSchema(prisma, { uploadDir });
  await resetTestAdmin(prisma);
  app = await buildApp({
    prisma,
    jwtSecret: "admin-notification-test-secret",
    uploadDir,
    publicBaseUrl: "http://127.0.0.1:3001",
    now: () => now
  });
});

afterEach(async () => {
  await app.close();
  await prisma.$disconnect();
  await rm(root, { recursive: true, force: true });
});

describe("admin notification API", () => {
  it("requires an authenticated administrator and does not accept client adminId", async () => {
    const unauthorized = await app.inject({ method: "GET", url: "/api/admin/notifications" });
    expect(unauthorized.statusCode).toBe(401);

    const token = await login();
    const rejected = await postNotification(token, { adminId: 999 } as never);
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR" }
    });
  });

  it.each(["success", "error", "warning", "info"])("persists the %s theme", async (level) => {
    const token = await login();
    const response = await postNotification(token, { level, message: `${level} message` });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        persisted: true,
        reason: null,
        notification: { level, message: `${level} message` }
      }
    });
  });

  it("is idempotent per administrator and isolates histories between administrators", async () => {
    const firstToken = await login();
    const secondPassword = `Second-${randomUUID()}-Aa1!`;
    await prisma.adminUser.create({
      data: { username: "second-admin", passwordHash: hashPassword(secondPassword) }
    });
    const secondToken = await login("second-admin", secondPassword);
    const clientEventId = randomUUID();

    const first = await postNotification(firstToken, { clientEventId, message: "first" });
    const duplicate = await postNotification(firstToken, { clientEventId, message: "changed" });
    const second = await postNotification(secondToken, { clientEventId, message: "second" });

    expect(duplicate.json().data.notification.id).toBe(first.json().data.notification.id);
    expect(duplicate.json().data.notification.message).toBe("first");
    expect(second.json().data.notification.id).not.toBe(first.json().data.notification.id);

    const firstList = await app.inject({
      method: "GET",
      url: "/api/admin/notifications",
      headers: auth(firstToken)
    });
    const secondList = await app.inject({
      method: "GET",
      url: "/api/admin/notifications",
      headers: auth(secondToken)
    });
    expect(firstList.json().data.items.map((item: { message: string }) => item.message)).toEqual(["first"]);
    expect(secondList.json().data.items.map((item: { message: string }) => item.message)).toEqual(["second"]);
  });

  it("orders by occurrence time and paginates", async () => {
    const token = await login();
    await postNotification(token, { message: "old", occurredAt: new Date(now.getTime() - 2_000).toISOString() });
    await postNotification(token, { message: "new", occurredAt: new Date(now.getTime() - 1_000).toISOString() });
    await postNotification(token, { message: "newest", occurredAt: now.toISOString() });

    const response = await app.inject({
      method: "GET",
      url: "/api/admin/notifications?page=1&pageSize=2",
      headers: auth(token)
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      items: [{ message: "newest" }, { message: "new" }],
      pagination: { page: 1, pageSize: 2, total: 3, totalPages: 2 }
    });
  });

  it("filters a notification level before counting and paginating while preserving the default list", async () => {
    const token = await login();
    await postNotification(token, { level: "success", message: "saved", occurredAt: new Date(now.getTime() - 3_000).toISOString() });
    await postNotification(token, { level: "error", message: "older error", occurredAt: new Date(now.getTime() - 2_000).toISOString() });
    await postNotification(token, { level: "info", message: "hint", occurredAt: new Date(now.getTime() - 1_000).toISOString() });
    await postNotification(token, { level: "error", message: "newer error" });

    const filtered = await app.inject({
      method: "GET",
      url: "/api/admin/notifications?page=1&pageSize=1&level=error",
      headers: auth(token)
    });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().data).toMatchObject({
      items: [{ level: "error", message: "newer error" }],
      pagination: { page: 1, pageSize: 1, total: 2, totalPages: 2 }
    });

    const unfiltered = await app.inject({
      method: "GET",
      url: "/api/admin/notifications?page=1&pageSize=20",
      headers: auth(token)
    });
    expect(unfiltered.json().data.pagination.total).toBe(4);
  });

  it("retains the exact seven-day boundary, ignores older outbox events, and rejects excessive future skew", async () => {
    const token = await login();
    const boundary = new Date(now.getTime() - ADMIN_NOTIFICATION_RETENTION_MS);
    const accepted = await postNotification(token, { message: "boundary", occurredAt: boundary.toISOString() });
    expect(accepted.json().data.persisted).toBe(true);

    const expired = await postNotification(token, {
      message: "expired",
      occurredAt: new Date(boundary.getTime() - 1).toISOString()
    });
    expect(expired.statusCode).toBe(200);
    expect(expired.json().data).toEqual({ notification: null, persisted: false, reason: "expired" });

    const future = await postNotification(token, {
      occurredAt: new Date(now.getTime() + ADMIN_NOTIFICATION_MAX_FUTURE_SKEW_MS + 1).toISOString()
    });
    expect(future.statusCode).toBe(400);
    expect(future.json()).toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR" }
    });
  });

  it("cleans expired rows and cascades notifications when an administrator is deleted", async () => {
    const token = await login();
    await postNotification(token);
    const admin = await prisma.adminUser.findUniqueOrThrow({
      where: { username: testAdminCredentials.username }
    });
    await prisma.adminNotification.create({
      data: {
        adminId: admin.id,
        clientEventId: randomUUID(),
        level: "info",
        message: "expired",
        occurredAt: new Date(now.getTime() - ADMIN_NOTIFICATION_RETENTION_MS - 1)
      }
    });
    expect(await cleanupExpiredAdminNotifications(prisma, now)).toEqual({ deletedCount: 1 });
    expect(await prisma.adminNotification.count()).toBe(1);

    await prisma.adminSession.deleteMany({ where: { adminId: admin.id } });
    await prisma.adminUser.delete({ where: { id: admin.id } });
    expect(await prisma.adminNotification.count()).toBe(0);
  });

  it("validates message, level, time, and pagination on the server", async () => {
    const token = await login();
    for (const payload of [
      { message: "" },
      { level: "fatal" },
      { occurredAt: "not-a-date" }
    ]) {
      const response = await postNotification(token, payload);
      expect(response.statusCode).toBe(400);
    }
    const page = await app.inject({
      method: "GET",
      url: "/api/admin/notifications?page=0&pageSize=101",
      headers: auth(token)
    });
    expect(page.statusCode).toBe(400);
    const level = await app.inject({
      method: "GET",
      url: "/api/admin/notifications?level=fatal",
      headers: auth(token)
    });
    expect(level.statusCode).toBe(400);
    expect(level.json()).toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR" }
    });
  });
});
