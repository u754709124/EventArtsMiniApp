import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { menuTypeValues } from "@event-arts/shared";
import { buildApp } from "../src/app";
import { createPrismaClient, type AppPrismaClient } from "../src/db";
import { seedDatabase } from "../src/seed";
import { ensureDatabaseSchema } from "../src/sqlite-schema";

const runtimeRoot = path.join(process.cwd(), ".tmp/api-tests");
const databasePath = path.join(runtimeRoot, "test.db");
const uploadDir = path.join(runtimeRoot, "uploads");
const databaseUrl = `file:${databasePath}`;

let prisma: AppPrismaClient;
let app: Awaited<ReturnType<typeof buildApp>>;

async function login() {
  const response = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: { username: "admin", password: "admin123456" }
  });
  const body = response.json();
  expect(response.statusCode).toBe(200);
  expect(body.success).toBe(true);
  return body.data.token as string;
}

async function pngBuffer(width: number, height: number) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 180, g: 107, b: 42, alpha: 1 }
    }
  })
    .png()
    .toBuffer();
}

beforeAll(async () => {
  await rm(runtimeRoot, { recursive: true, force: true });
  await mkdir(uploadDir, { recursive: true });
  process.env.DATABASE_URL = databaseUrl;
  prisma = createPrismaClient(databaseUrl);
  await ensureDatabaseSchema(prisma);
  app = await buildApp({
    prisma,
    jwtSecret: "test-secret",
    uploadDir,
    publicBaseUrl: "http://127.0.0.1:3001"
  });
});

beforeEach(async () => {
  await seedDatabase(prisma, {
    uploadDir,
    publicBaseUrl: "http://127.0.0.1:3001",
    reset: true
  });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  await rm(runtimeRoot, { recursive: true, force: true });
});

describe("admin auth", () => {
  it("logs in with the seeded administrator", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      payload: { username: "admin", password: "admin123456" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: { username: "admin" },
      message: "ok"
    });
    expect(response.json().data.token).toEqual(expect.any(String));
  });

  it("rejects invalid administrator credentials", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      payload: { username: "admin", password: "wrong" }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      success: false,
      error: { code: "INVALID_CREDENTIALS", message: "用户名或密码错误" }
    });
  });

  it("rejects admin endpoints without a token", async () => {
    const response = await app.inject({ method: "GET", url: "/api/admin/dashboard/overview" });
    expect(response.statusCode).toBe(401);
    expect(response.json().success).toBe(false);
  });
});

describe("client home aggregation", () => {
  it("returns site, announcements, banners, menus, and featuredCases", async () => {
    const response = await app.inject({ method: "GET", url: "/api/client/home" });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(Object.keys(body.data)).toEqual([
      "site",
      "announcements",
      "banners",
      "menus",
      "featuredCases"
    ]);
    expect(body.data.site.appName).toBe("喜缘主持・演艺服务");
    expect(body.data.menus.map((menu: { type: string }) => menu.type)).toEqual(menuTypeValues);
    expect(body.data.featuredCases).toHaveLength(3);
  });

  it("hides disabled announcements, banners, and menu items", async () => {
    await prisma.announcement.updateMany({ data: { status: "disabled" } });
    await prisma.banner.updateMany({ data: { status: "disabled" } });
    await prisma.menuItem.updateMany({ data: { status: "disabled" } });

    const response = await app.inject({ method: "GET", url: "/api/client/home" });
    const data = response.json().data;

    expect(data.announcements).toEqual([]);
    expect(data.banners).toEqual([]);
    expect(data.menus).toEqual([]);
  });

  it("uses activity_cases as the shared source for featured cases", async () => {
    await prisma.activityCase.updateMany({ data: { isFeatured: false } });

    const response = await app.inject({ method: "GET", url: "/api/client/home" });

    expect(response.json().data.featuredCases).toEqual([]);
    expect(await prisma.activityCase.count()).toBeGreaterThanOrEqual(3);
  });

  it("validates menu type values on admin create", async () => {
    const token = await login();
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/menu-items",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        text: "错误类型",
        iconAssetId: 1,
        type: "bad",
        configJson: {},
        sortOrder: 99,
        status: "enabled"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });
});

describe("media upload and references", () => {
  it("rejects image uploads with incorrect fixed dimensions", async () => {
    const token = await login();
    const boundary = `----test-${randomUUID()}`;
    const file = await pngBuffer(100, 100);
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="usage"\r\n\r\nbanner\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="bad.png"\r\nContent-Type: image/png\r\n\r\n`
      ),
      file,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/api/admin/media-assets/upload",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": `multipart/form-data; boundary=${boundary}`
      },
      payload
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("1420x580");
  });

  it("accepts image uploads with correct fixed dimensions", async () => {
    const token = await login();
    const boundary = `----test-${randomUUID()}`;
    const file = await pngBuffer(1420, 580);
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="usage"\r\n\r\nbanner\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="ok.png"\r\nContent-Type: image/png\r\n\r\n`
      ),
      file,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/api/admin/media-assets/upload",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": `multipart/form-data; boundary=${boundary}`
      },
      payload
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      usage: "banner",
      width: 1420,
      height: 580,
      mediaType: "image"
    });
  });

  it("prevents deleting media used by CMS content", async () => {
    const token = await login();
    const usedAsset = await prisma.mediaAsset.findFirstOrThrow({
      where: { usage: "banner" }
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/api/admin/media-assets/${usedAsset.id}`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("MEDIA_IN_USE");
  });
});

describe("page-view analytics", () => {
  it("records page views and increases dashboard PV", async () => {
    const token = await login();
    const before = await app.inject({
      method: "GET",
      url: "/api/admin/dashboard/overview",
      headers: { authorization: `Bearer ${token}` }
    });

    await app.inject({
      method: "POST",
      url: "/api/client/track/page-view",
      payload: { pagePath: "/pages/index/index", scene: "home" }
    });

    const after = await app.inject({
      method: "GET",
      url: "/api/admin/dashboard/overview",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(after.json().data.todayPv).toBe(before.json().data.todayPv + 1);
    expect(after.json().data.weekPv).toBeGreaterThanOrEqual(after.json().data.todayPv);
    expect(after.json().data.monthPv).toBeGreaterThanOrEqual(after.json().data.weekPv);
  });
});
