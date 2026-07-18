import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { buildApp } from "../src/app";
import { createPrismaClient, type AppPrismaClient } from "../src/db";
import { seedDatabase } from "../src/seed";
import { ensureDatabaseSchema } from "../src/sqlite-schema";
import {
  clientAuthHeaders,
  createTestWeChatLoginCodeVerifier,
  loginClient,
  resetTestAdmin,
  testAdminCredentials,
  testClientAuthConfig
} from "./fixtures";

const runtimeRoot = path.join(process.cwd(), ".tmp/api-tests");
const databasePath = path.join(runtimeRoot, "test.db");
const uploadDir = path.join(runtimeRoot, "uploads");
const databaseUrl = `file:${databasePath}`;

let prisma: AppPrismaClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let clientToken: string;

type TestInjectOptions = InjectOptions & { headers?: Record<string, string> };

async function login() {
  const response = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: testAdminCredentials
  });
  const body = response.json();
  expect(response.statusCode).toBe(200);
  expect(body.success).toBe(true);
  return body.data.token as string;
}

function clientInject(options: TestInjectOptions): Promise<LightMyRequestResponse> {
  return app.inject({
    ...options,
    headers: {
      ...options.headers,
      ...clientAuthHeaders(clientToken)
    }
  } as InjectOptions) as Promise<LightMyRequestResponse>;
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

async function uploadMedia(
  token: string,
  file: Buffer,
  options: {
    resourceName: string;
    filename?: string;
    mimeType?: string;
    fieldKey?: string;
    tags?: string[];
    md5?: string;
  }
) {
  const boundary = `----test-${randomUUID()}`;
  const fields = [
    ["resourceName", options.resourceName],
    ["md5", options.md5 ?? createHash("md5").update(file).digest("hex")],
    ["tags", JSON.stringify(options.tags ?? [])],
    ...(options.fieldKey ? [["fieldKey", options.fieldKey]] : [])
  ];
  const chunks: Uint8Array[] = fields.flatMap(([name, value]) => [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
  ]);
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${options.filename ?? "asset.png"}"\r\nContent-Type: ${options.mimeType ?? "image/png"}\r\n\r\n`
    ),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  );
  return app.inject({
    method: "POST",
    url: "/api/admin/media-assets/upload",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": `multipart/form-data; boundary=${boundary}`
    },
    payload: Buffer.concat(chunks)
  });
}

async function uploadTwoFiles(token: string, first: Buffer, second: Buffer) {
  const boundary = `----test-${randomUUID()}`;
  const md5 = createHash("md5").update(first).digest("hex");
  const field = (name: string, value: string) =>
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  const file = (name: string, value: Buffer) => [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/png\r\n\r\n`),
    value,
    Buffer.from("\r\n")
  ];
  return app.inject({
    method: "POST",
    url: "/api/admin/media-assets/upload",
    headers: { authorization: `Bearer ${token}`, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      field("resourceName", "双文件非法上传"),
      field("md5", md5),
      field("tags", "[]"),
      ...file("one.png", first),
      ...file("two.png", second),
      Buffer.from(`--${boundary}--\r\n`)
    ])
  });
}

async function uploadUnexpectedFileField(token: string, value: Buffer) {
  const boundary = `----test-${randomUUID()}`;
  return app.inject({
    method: "POST",
    url: "/api/admin/media-assets/upload",
    headers: { authorization: `Bearer ${token}`, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="attachment"; filename="wrong.png"\r\nContent-Type: image/png\r\n\r\n`),
      value,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ])
  });
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
    publicBaseUrl: "http://127.0.0.1:3001",
    clientAuth: testClientAuthConfig,
    weChatLoginCodeVerifier: createTestWeChatLoginCodeVerifier(),
    analytics: { sampleRate: 1, retentionDays: 90, dedupeWindowSeconds: 30 }
  });
});

beforeEach(async () => {
  await seedDatabase(prisma, {
    uploadDir,
    publicBaseUrl: "http://127.0.0.1:3001",
    reset: true
  });
  await resetTestAdmin(prisma);
  clientToken = await loginClient(app);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  await rm(runtimeRoot, { recursive: true, force: true });
});

describe("admin auth", () => {
  it("logs in with the explicitly bootstrapped test administrator", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      payload: testAdminCredentials
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: { username: testAdminCredentials.username },
      message: "ok"
    });
    expect(response.json().data.token).toEqual(expect.any(String));
  });

  it("rejects invalid administrator credentials", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/auth/login",
      payload: { username: testAdminCredentials.username, password: "wrong" }
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
    const response = await clientInject({ method: "GET", url: "/api/client/home" });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(Object.keys(body.data)).toEqual([
      "site",
      "announcements",
      "banners",
      "menus",
      "featuredCases",
      "featuredArticles"
    ]);
    expect(body.data.site.appName).toBe("喜缘主持・演艺服务");
    expect(body.data.menus.map((menu: { type: string }) => menu.type)).toEqual([
      "artist",
      "activity_case",
      "article",
      "contact"
    ]);
    expect(body.data.menus.find((menu: { type: string }) => menu.type === "artist").configJson).toEqual({
      defaultSort: "sortOrder",
      pageSize: 10
    });
    expect(body.data.menus.every((menu: { showOnHome: boolean }) => menu.showOnHome)).toBe(true);
    expect(body.data.featuredCases).toHaveLength(3);
    expect(body.data.featuredArticles).toHaveLength(2);
    expect(body.data.featuredArticles.map((article: { featuredSortOrder: number }) => article.featuredSortOrder)).toEqual([1, 2]);
  });

  it("normalizes legacy local media URLs with the configured public base", async () => {
    const asset = await prisma.mediaAsset.findFirstOrThrow({ where: { resourceName: "placeholder-icon.png" } });
    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { url: `http://127.0.0.1:9999/uploads/${asset.filename}` }
    });

    const response = await clientInject({ method: "GET", url: "/api/client/home" });
    const data = response.json().data;

    expect(response.statusCode).toBe(200);
    expect(data.site.placeholderIconUrl).toBe(`http://127.0.0.1:3001/uploads/${asset.filename}`);
    expect(JSON.stringify(data)).not.toContain("127.0.0.1:9999");
  });

  it("hides disabled announcements, banners, and menu items from home", async () => {
    await prisma.announcement.updateMany({ data: { status: "disabled" } });
    await prisma.banner.updateMany({ data: { status: "disabled" } });
    await prisma.menuItem.updateMany({ data: { status: "disabled" } });

    const response = await clientInject({ method: "GET", url: "/api/client/home" });
    const data = response.json().data;

    expect(data.announcements).toEqual([]);
    expect(data.banners).toEqual([]);
    expect(data.menus).toEqual([]);
  });

  it("uses showOnHome only for home menus while client menu-items returns all enabled menus", async () => {
    const [homeHidden, disabled] = await prisma.menuItem.findMany({ orderBy: { sortOrder: "asc" }, take: 2 });
    await prisma.menuItem.update({ where: { id: homeHidden.id }, data: { showOnHome: false } });
    await prisma.menuItem.update({ where: { id: disabled.id }, data: { status: "disabled" } });

    const [homeResponse, menuResponse] = await Promise.all([
      clientInject({ method: "GET", url: "/api/client/home" }),
      clientInject({ method: "GET", url: "/api/client/menu-items" })
    ]);
    const homeMenus = homeResponse.json().data.menus as Array<{ id: number }>;
    const clientMenus = menuResponse.json().data as Array<{ id: number; showOnHome: boolean }>;

    expect(homeResponse.statusCode).toBe(200);
    expect(menuResponse.statusCode).toBe(200);
    expect(homeMenus.map((menu) => menu.id)).not.toContain(homeHidden.id);
    expect(homeMenus.map((menu) => menu.id)).not.toContain(disabled.id);
    expect(clientMenus.map((menu) => menu.id)).toContain(homeHidden.id);
    expect(clientMenus.find((menu) => menu.id === homeHidden.id)?.showOnHome).toBe(false);
    expect(clientMenus.map((menu) => menu.id)).not.toContain(disabled.id);
  });

  it("uses activity_cases as the shared source for featured cases", async () => {
    await prisma.activityCase.updateMany({ data: { isFeatured: false } });

    const response = await clientInject({ method: "GET", url: "/api/client/home" });

    expect(response.json().data.featuredCases).toEqual([]);
    expect(await prisma.activityCase.count()).toBeGreaterThanOrEqual(3);
  });

  it("lists client articles by category and always returns enabled categories", async () => {
    await prisma.article.updateMany({ where: { title: "品牌发布会现场节奏设计" }, data: { status: "disabled" } });

    const response = await clientInject({ method: "GET", url: "/api/client/articles?category=婚礼攻略&pageSize=1" });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.total).toBe(2);
    expect(body.data.items[0]).toMatchObject({ category: "婚礼攻略", hasDetailPage: true });
    expect(body.data.categories).toEqual(["婚礼攻略", "活动策划"]);
  });

  it("returns admin article categories with search and limit", async () => {
    const token = await login();
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/articles/categories?q=婚礼&limit=1",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ categories: ["婚礼攻略"] });
  });

  it("creates and updates admin articles with normalized category and reusable detail pages", async () => {
    const token = await login();
    const cover = await uploadMedia(token, await pngBuffer(320, 180), {
      resourceName: "文章测试封面",
      fieldKey: "article.cover"
    });
    const detailPage = await prisma.detailPageConfig.findFirstOrThrow({ where: { name: "婚礼流程筹备攻略" } });
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/articles",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: "  测试文章 ",
        category: " 婚礼   攻略 ",
        coverAssetId: cover.json().data.asset.id,
        summary: " 文章摘要 ",
        publishedAt: "2026-07-12T08:00:00.000Z",
        isFeatured: true,
        featuredSortOrder: 9,
        sortOrder: 9,
        status: "enabled",
        detailPageId: detailPage.id
      }
    });
    const updated = await app.inject({
      method: "PUT",
      url: `/api/admin/articles/${created.json().data.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { isFeatured: false, detailPageId: null }
    });
    const logs = await prisma.operationLog.findMany({
      where: { action: { in: ["CREATE_ARTICLE", "UPDATE_ARTICLE"] } },
      orderBy: { id: "asc" }
    });

    expect(created.statusCode).toBe(200);
    expect(created.json().data).toMatchObject({
      title: "测试文章",
      category: "婚礼 攻略",
      hasDetailPage: true
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data).toMatchObject({ isFeatured: false, detailPageId: null, hasDetailPage: false });
    expect(logs.map((log) => log.action)).toEqual(["CREATE_ARTICLE", "UPDATE_ARTICLE"]);
  });

  it("includes articles in detail page reference protection", async () => {
    const token = await login();
    const article = await prisma.article.findFirstOrThrow({ where: { detailPageId: { not: null } } });
    const refs = await app.inject({
      method: "GET",
      url: `/api/admin/detail-pages/${article.detailPageId}/references`,
      headers: { authorization: `Bearer ${token}` }
    });
    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/admin/detail-pages/${article.detailPageId}`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(refs.statusCode).toBe(200);
    expect(refs.json().data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceType: "article", sourceId: article.id, sourceName: article.title })
      ])
    );
    expect(deleted.statusCode).toBe(409);
    expect(deleted.json().error.code).toBe("DETAIL_PAGE_IN_USE");
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

  it("defaults menu showOnHome on create and preserves it on partial updates", async () => {
    const token = await login();
    const icon = await prisma.mediaAsset.findFirstOrThrow({ where: { resourceName: "placeholder-icon.png" } });
    const createDefault = await app.inject({
      method: "POST",
      url: "/api/admin/menu-items",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        text: "默认首页显示",
        iconAssetId: icon.id,
        type: "contact",
        configJson: {},
        sortOrder: 101,
        status: "enabled"
      }
    });
    const createHidden = await app.inject({
      method: "POST",
      url: "/api/admin/menu-items",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        text: "隐藏首页显示",
        iconAssetId: icon.id,
        type: "contact",
        configJson: {},
        showOnHome: false,
        sortOrder: 102,
        status: "enabled"
      }
    });

    expect(createDefault.statusCode).toBe(200);
    expect(createDefault.json().data.showOnHome).toBe(true);
    expect(createHidden.statusCode).toBe(200);
    expect(createHidden.json().data.showOnHome).toBe(false);

    const id = createHidden.json().data.id as number;
    const update = await app.inject({
      method: "PUT",
      url: `/api/admin/menu-items/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { text: "隐藏首页显示已更新" }
    });
    const get = await app.inject({
      method: "GET",
      url: `/api/admin/menu-items/${id}`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(update.statusCode).toBe(200);
    expect(update.json().data.showOnHome).toBe(false);
    expect(get.json().data.showOnHome).toBe(false);
  });

  it("updates an existing seeded menu with the complete editable payload", async () => {
    const token = await login();
    const existing = await prisma.menuItem.findFirstOrThrow({ where: { type: "artist" } });
    const response = await app.inject({
      method: "PUT",
      url: `/api/admin/menu-items/${existing.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        text: "人员服务",
        iconAssetId: existing.iconAssetId,
        type: existing.type,
        configJson: { category: "主持人", defaultSort: "newest", pageSize: 12 },
        showOnHome: false,
        sortOrder: 7,
        status: "enabled"
      }
    });
    const saved = await prisma.menuItem.findUniqueOrThrow({ where: { id: existing.id } });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      id: existing.id,
      text: "人员服务",
      type: "artist",
      showOnHome: false,
      sortOrder: 7,
      status: "enabled"
    });
    expect(JSON.parse(saved.configJson)).toEqual({ category: "主持人", defaultSort: "newest", pageSize: 12 });
  });

  it("keeps menu updates strict when response-only fields are submitted", async () => {
    const token = await login();
    const existing = await prisma.menuItem.findFirstOrThrow({ where: { type: "artist" } });
    const response = await app.inject({
      method: "PUT",
      url: `/api/admin/menu-items/${existing.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        text: existing.text,
        iconAssetId: existing.iconAssetId,
        iconUrl: "/uploads/placeholder-icon.png",
        type: existing.type,
        configJson: JSON.parse(existing.configJson),
        showOnHome: existing.showOnHome,
        sortOrder: existing.sortOrder,
        status: existing.status
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toEqual({
      code: "VALIDATION_ERROR",
      message: "菜单参数错误"
    });
  });

  it("creates direct detail-page menus, preserves partial updates, and protects only the current target", async () => {
    const token = await login();
    const icon = await prisma.mediaAsset.findFirstOrThrow({ where: { resourceName: "placeholder-icon.png" } });
    const richDetail = await prisma.detailPageConfig.create({
      data: { name: "菜单图文详情", pageType: "rich_text", richTextHtml: "<p>图文详情</p>" }
    });
    const bannerDetail = await prisma.detailPageConfig.create({
      data: { name: "菜单视觉详情", pageType: "banner_rich_text", richTextHtml: "<p>视觉详情</p>" }
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/menu-items",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        text: "品牌故事",
        iconAssetId: icon.id,
        type: "detail_page",
        configJson: { detailPageType: "rich_text", detailPageId: richDetail.id },
        sortOrder: 120,
        status: "enabled"
      }
    });
    const menuId = created.json().data.id as number;

    expect(created.statusCode).toBe(200);
    expect(created.json().data).toMatchObject({
      type: "detail_page",
      configJson: { detailPageType: "rich_text", detailPageId: richDetail.id }
    });
    expect(JSON.parse((await prisma.menuItem.findUniqueOrThrow({ where: { id: menuId } })).configJson)).toEqual({
      detailPageType: "rich_text",
      detailPageId: richDetail.id
    });

    const partialUpdate = await app.inject({
      method: "PUT",
      url: `/api/admin/menu-items/${menuId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { text: "品牌故事更新" }
    });
    expect(partialUpdate.statusCode).toBe(200);
    expect(partialUpdate.json().data.configJson).toEqual({ detailPageType: "rich_text", detailPageId: richDetail.id });

    const references = await app.inject({
      method: "GET",
      url: `/api/admin/detail-pages/${richDetail.id}/references`,
      headers: { authorization: `Bearer ${token}` }
    });
    const detailList = await app.inject({
      method: "GET",
      url: `/api/admin/detail-pages?q=${richDetail.id}`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(references.json().data.items).toContainEqual({ sourceType: "menu", sourceId: menuId, sourceName: "品牌故事更新" });
    expect(detailList.json().data.items.find((item: { id: number }) => item.id === richDetail.id).referenceCount).toBe(1);

    const blocked = await app.inject({
      method: "DELETE",
      url: `/api/admin/detail-pages/${richDetail.id}`,
      headers: { authorization: `Bearer ${token}` }
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("DETAIL_PAGE_IN_USE");

    const retargeted = await app.inject({
      method: "PUT",
      url: `/api/admin/menu-items/${menuId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { configJson: { detailPageType: "banner_rich_text", detailPageId: bannerDetail.id } }
    });
    expect(retargeted.statusCode).toBe(200);
    expect(retargeted.json().data.configJson).toEqual({
      detailPageType: "banner_rich_text",
      detailPageId: bannerDetail.id
    });
    expect((await app.inject({
      method: "DELETE",
      url: `/api/admin/detail-pages/${richDetail.id}`,
      headers: { authorization: `Bearer ${token}` }
    })).statusCode).toBe(200);

    const switchedAway = await app.inject({
      method: "PUT",
      url: `/api/admin/menu-items/${menuId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { type: "contact" }
    });
    expect(switchedAway.statusCode).toBe(200);
    expect(switchedAway.json().data).toMatchObject({ type: "contact", configJson: {} });
    expect((await app.inject({
      method: "DELETE",
      url: `/api/admin/detail-pages/${bannerDetail.id}`,
      headers: { authorization: `Bearer ${token}` }
    })).statusCode).toBe(200);
  });

  it("rejects incomplete, missing, or type-mismatched direct detail-page menu targets", async () => {
    const token = await login();
    const icon = await prisma.mediaAsset.findFirstOrThrow({ where: { resourceName: "placeholder-icon.png" } });
    const detail = await prisma.detailPageConfig.create({
      data: { name: "仅图文菜单详情", pageType: "rich_text", richTextHtml: "<p>正文</p>" }
    });
    const beforeCount = await prisma.menuItem.count();
    const payload = {
      text: "非法直达",
      iconAssetId: icon.id,
      type: "detail_page",
      sortOrder: 121,
      status: "enabled"
    };
    const [incomplete, missing, mismatched] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/admin/menu-items",
        headers: { authorization: `Bearer ${token}` },
        payload: { ...payload, configJson: { detailPageType: "rich_text" } }
      }),
      app.inject({
        method: "POST",
        url: "/api/admin/menu-items",
        headers: { authorization: `Bearer ${token}` },
        payload: { ...payload, configJson: { detailPageType: "rich_text", detailPageId: 999999 } }
      }),
      app.inject({
        method: "POST",
        url: "/api/admin/menu-items",
        headers: { authorization: `Bearer ${token}` },
        payload: { ...payload, configJson: { detailPageType: "banner_rich_text", detailPageId: detail.id } }
      })
    ]);

    expect(incomplete.statusCode).toBe(400);
    expect(incomplete.json().error.code).toBe("VALIDATION_ERROR");
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("DETAIL_PAGE_NOT_FOUND");
    expect(mismatched.statusCode).toBe(400);
    expect(mismatched.json().error.code).toBe("VALIDATION_ERROR");
    expect(await prisma.menuItem.count()).toBe(beforeCount);

    const existing = await prisma.menuItem.findFirstOrThrow({ where: { type: "artist" } });
    const switchedWithConfig = await app.inject({
      method: "PUT",
      url: `/api/admin/menu-items/${existing.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        type: "detail_page",
        configJson: { detailPageType: "rich_text", detailPageId: detail.id }
      }
    });
    expect(switchedWithConfig.statusCode).toBe(200);

    const mismatchedUpdate = await app.inject({
      method: "PUT",
      url: `/api/admin/menu-items/${existing.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { configJson: { detailPageType: "banner_rich_text", detailPageId: detail.id } }
    });
    expect(mismatchedUpdate.statusCode).toBe(400);
    expect(JSON.parse((await prisma.menuItem.findUniqueOrThrow({ where: { id: existing.id } })).configJson)).toEqual({
      detailPageType: "rich_text",
      detailPageId: detail.id
    });

    const anotherExisting = await prisma.menuItem.findFirstOrThrow({ where: { type: "contact" } });
    const switchedWithoutConfig = await app.inject({
      method: "PUT",
      url: `/api/admin/menu-items/${anotherExisting.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { type: "detail_page" }
    });
    expect(switchedWithoutConfig.statusCode).toBe(400);
    expect((await prisma.menuItem.findUniqueOrThrow({ where: { id: anotherExisting.id } })).type).toBe("contact");
  });

  it("degrades damaged direct detail-page configs without failing menu responses", async () => {
    const token = await login();
    const menu = await prisma.menuItem.findFirstOrThrow({ where: { type: "artist" } });
    await prisma.menuItem.update({
      where: { id: menu.id },
      data: { type: "detail_page", configJson: JSON.stringify({ detailPageType: "rich_text", detailPageId: 0 }) }
    });

    const [home, clientMenus, adminMenu] = await Promise.all([
      clientInject({ method: "GET", url: "/api/client/home" }),
      clientInject({ method: "GET", url: "/api/client/menu-items" }),
      app.inject({
        method: "GET",
        url: `/api/admin/menu-items/${menu.id}`,
        headers: { authorization: `Bearer ${token}` }
      })
    ]);

    expect(home.statusCode).toBe(200);
    expect(clientMenus.statusCode).toBe(200);
    expect(adminMenu.statusCode).toBe(200);
    expect(home.json().data.menus.find((item: { id: number }) => item.id === menu.id).configJson).toEqual({});
    expect(clientMenus.json().data.find((item: { id: number }) => item.id === menu.id).configJson).toEqual({});
    expect(adminMenu.json().data.configJson).toEqual({});
  });
});

describe("client case search", () => {
  it("filters enabled cases by keyword across public card fields", async () => {
    const byLocation = await clientInject({ method: "GET", url: "/api/client/cases?q=%E6%B5%A6%E4%B8%9C" });
    const byCategory = await clientInject({ method: "GET", url: "/api/client/cases?category=%E6%AD%8C%E6%89%8B%E6%BC%94%E5%87%BA" });
    const byCategoryAndKeyword = await clientInject({ method: "GET", url: "/api/client/cases?category=%E5%A9%9A%E7%A4%BC%E4%B8%BB%E6%8C%81&q=%E4%BC%81%E4%B8%9A" });
    const blank = await clientInject({ method: "GET", url: "/api/client/cases?q=%20%20" });

    expect(byLocation.statusCode).toBe(200);
    expect((byLocation.json().data as Array<{ title: string }>).map((item) => item.title)).toEqual(["企业年会歌手演出"]);
    expect(byCategory.statusCode).toBe(200);
    expect((byCategory.json().data as Array<{ title: string }>).map((item) => item.title)).toEqual(["企业年会歌手演出"]);
    expect(byCategoryAndKeyword.statusCode).toBe(200);
    expect(byCategoryAndKeyword.json().data).toEqual([]);
    expect(blank.statusCode).toBe(200);
    expect(blank.json().data).toHaveLength(3);
  });
});

describe("admin case category options", () => {
  it("requires admin auth and returns distinct existing case categories", async () => {
    const unauthorized = await app.inject({ method: "GET", url: "/api/admin/case-categories" });
    const token = await login();
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/case-categories",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(response.statusCode).toBe(200);
    expect(response.json().data.items).toEqual(expect.arrayContaining(["婚礼主持", "歌手演出", "杂技表演"]));
    expect(new Set(response.json().data.items).size).toBe(response.json().data.items.length);
  });
});

describe("artist client and admin contracts", () => {
  it("defaults the client artist list to all enabled personnel and serializes category cards", async () => {
    await prisma.artist.updateMany({ where: { type: "歌手" }, data: { status: "disabled" } });
    const response = await clientInject({ method: "GET", url: "/api/client/artists" });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "主持人",
        coverUrl: expect.any(String),
        avatarUrl: expect.any(String),
        location: expect.any(String),
        badge: expect.any(String),
        tags: expect.any(Array)
      })
    ]));
    expect(response.json().data).toHaveLength(12);
    expect(response.json().data.every((artist: { type: string; status: string }) => artist.type !== "歌手" && artist.status === "enabled")).toBe(true);
  });

  it("rejects conflicting client artist category aliases", async () => {
    const response = await clientInject({ method: "GET", url: "/api/client/artists?type=host&category=%E6%AD%8C%E6%89%8B" });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns six enabled records for each personnel category and supports legacy type aliases", async () => {
    const [host, singer, actor] = await Promise.all([
      clientInject({ method: "GET", url: "/api/client/artists?type=host" }),
      clientInject({ method: "GET", url: "/api/client/artists?category=%E6%AD%8C%E6%89%8B" }),
      clientInject({ method: "GET", url: "/api/client/artists?category=%E6%BC%94%E5%91%98" })
    ]);

    expect(host.json().data).toHaveLength(6);
    expect(singer.json().data).toHaveLength(6);
    expect(actor.json().data).toHaveLength(6);
    expect(host.json().data.map((artist: { name: string }) => artist.name)).toEqual(["林然", "Jessica", "陆安", "沈悦", "Kevin", "余薇"]);
    expect(host.json().data[0]).toMatchObject({
      location: "杭州",
      badge: "金牌主持",
      tags: ["10年经验", "婚礼主持", "高端晚宴", "控场力强"],
      summary: "风格大气沉稳，擅长情感共鸣，深受新人喜爱，让每一场仪式都温暖动人。"
    });
    expect(host.json().data.every((artist: { type: string }) => artist.type === "主持人")).toBe(true);
    expect(singer.json().data.every((artist: { type: string }) => artist.type === "歌手")).toBe(true);
    expect(actor.json().data.every((artist: { type: string }) => artist.type === "演员")).toBe(true);
  });

  it("filters artists by keyword, location and tag while keeping sort order stable", async () => {
    const hostArtists = await prisma.artist.findMany({ where: { type: "主持人" }, orderBy: { sortOrder: "asc" } });
    await prisma.artist.update({ where: { id: hostArtists[0].id }, data: { sortOrder: 5, location: "绍兴", summary: "独特风格描述" } });
    await prisma.artist.update({ where: { id: hostArtists[1].id }, data: { sortOrder: 5, location: "杭州", tagsJson: '["独特标签"]' } });

    const bySummary = await clientInject({ method: "GET", url: "/api/client/artists?category=%E4%B8%BB%E6%8C%81%E4%BA%BA&q=%E7%8B%AC%E7%89%B9%E9%A3%8E%E6%A0%BC" });
    const byName = await clientInject({ method: "GET", url: "/api/client/artists?category=%E4%B8%BB%E6%8C%81%E4%BA%BA&q=%E6%9E%97%E7%84%B6" });
    const byLocationKeyword = await clientInject({ method: "GET", url: "/api/client/artists?category=%E4%B8%BB%E6%8C%81%E4%BA%BA&q=%E6%9D%AD%E5%B7%9E" });
    const byTagKeyword = await clientInject({ method: "GET", url: "/api/client/artists?category=%E4%B8%BB%E6%8C%81%E4%BA%BA&q=%E7%8B%AC%E7%89%B9%E6%A0%87%E7%AD%BE" });
    const byLocationAndTag = await clientInject({ method: "GET", url: "/api/client/artists?category=%E4%B8%BB%E6%8C%81%E4%BA%BA&location=%E6%9D%AD%E5%B7%9E&tag=%E7%8B%AC%E7%89%B9%E6%A0%87%E7%AD%BE" });
    const ordered = await clientInject({ method: "GET", url: "/api/client/artists?category=%E4%B8%BB%E6%8C%81%E4%BA%BA" });

    expect(bySummary.json().data.map((artist: { id: number }) => artist.id)).toEqual([hostArtists[0].id]);
    expect(byName.json().data.map((artist: { id: number }) => artist.id)).toEqual([hostArtists[0].id]);
    expect(byLocationKeyword.json().data.map((artist: { id: number }) => artist.id)).toEqual([hostArtists[1].id]);
    expect(byTagKeyword.json().data.map((artist: { id: number }) => artist.id)).toEqual([hostArtists[1].id]);
    expect(byLocationAndTag.json().data.map((artist: { id: number }) => artist.id)).toEqual([hostArtists[1].id]);
    const tied = ordered.json().data.filter((artist: { sortOrder: number }) => artist.sortOrder === 5).map((artist: { id: number }) => artist.id);
    expect(tied).toEqual([...tied].sort((left, right) => left - right));
  });

  it("safely falls back from damaged tags JSON and never exposes it to client cards", async () => {
    const artist = await prisma.artist.findFirstOrThrow({ where: { type: "主持人" } });
    await prisma.artist.update({ where: { id: artist.id }, data: { tagsJson: "not-json" } });

    const response = await clientInject({ method: "GET", url: `/api/client/artists/${artist.id}` });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.tags).toEqual([]);
    expect(response.json().data).not.toHaveProperty("tagsJson");
  });

  it("requires all new artist fields on creation and serializes tags without double JSON encoding", async () => {
    const token = await login();
    const cover = await prisma.mediaAsset.findFirstOrThrow();
    const incomplete = await app.inject({
      method: "POST",
      url: "/api/admin/artists",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "缺字段人员", type: "host" }
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/artists",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "新建主持人",
        type: "  ＶＩＰ   主持 ",
        avatarAssetId: cover.id,
        location: "杭州",
        badge: "金牌主持",
        tags: ["婚礼主持", "婚礼主持", "高端晚宴"],
        summary: "专业稳重的主持人。",
        detailPageId: null,
        sortOrder: 99,
        status: "enabled"
      }
    });

    expect(incomplete.statusCode).toBe(400);
    expect(created.statusCode).toBe(200);
    expect(created.json().data.type).toBe("VIP 主持");
    expect(created.json().data.tags).toEqual(["婚礼主持", "高端晚宴"]);
    expect((await prisma.artist.findUniqueOrThrow({ where: { id: created.json().data.id } })).tagsJson).toBe('["婚礼主持","高端晚宴"]');

    const updated = await app.inject({
      method: "PUT",
      url: `/api/admin/artists/${created.json().data.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { tags: ["论坛主持", "论坛主持"] }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.tags).toEqual(["论坛主持"]);
    expect((await prisma.artist.findUniqueOrThrow({ where: { id: created.json().data.id } })).tagsJson).toBe('["论坛主持"]');
  });

  it("requires admin auth for artist category options and returns normalized distinct categories", async () => {
    await prisma.artist.create({
      data: {
        name: "重复分类人员",
        type: " host ",
        avatarAssetId: null,
        location: "杭州",
        badge: "主持",
        tagsJson: '["主持"]',
        summary: "分类去重测试",
        detail: "",
        sortOrder: 100,
        status: "enabled"
      }
    });
    const unauthorized = await app.inject({ method: "GET", url: "/api/admin/artist-categories" });
    const token = await login();
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/artist-categories",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(response.statusCode).toBe(200);
    expect(response.json().data.items).toEqual(["歌手", "演员", "主持人"]);
  });

  it("rejects empty and over-limit artist categories on admin writes", async () => {
    const token = await login();
    const cover = await prisma.mediaAsset.findFirstOrThrow();
    const empty = await app.inject({
      method: "POST",
      url: "/api/admin/artists",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "空分类人员",
        type: "   ",
        avatarAssetId: cover.id,
        location: "杭州",
        badge: "主持",
        tags: ["婚礼主持"],
        summary: "专业稳重的主持人。",
        detailPageId: null,
        sortOrder: 99,
        status: "enabled"
      }
    });
    const tooLong = await app.inject({
      method: "PUT",
      url: `/api/admin/artists/${(await prisma.artist.findFirstOrThrow()).id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { type: "很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长的人员分类" }
    });

    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.message).toContain("人员分类不能为空");
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json().error.message).toContain("人员分类不能超过 30 个字符");
  });

  it("returns full admin edit records by id and validates invalid ids", async () => {
    const token = await login();
    const artist = await prisma.artist.findFirstOrThrow({ include: { avatarAsset: true } });
    const foundArtist = await app.inject({
      method: "GET",
      url: `/api/admin/artists/${artist.id}`,
      headers: { authorization: `Bearer ${token}` }
    });
    const badAnnouncement = await app.inject({
      method: "GET",
      url: "/api/admin/announcements/not-a-number",
      headers: { authorization: `Bearer ${token}` }
    });
    const missingBanner = await app.inject({
      method: "GET",
      url: "/api/admin/banners/999999",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(foundArtist.statusCode).toBe(200);
    expect(foundArtist.json().data).toMatchObject({
      id: artist.id,
      avatarAssetId: artist.avatarAssetId,
      tags: expect.any(Array)
    });
    expect(badAnnouncement.statusCode).toBe(400);
    expect(badAnnouncement.json().error.code).toBe("VALIDATION_ERROR");
    expect(missingBanner.statusCode).toBe(404);
    expect(missingBanner.json().error.code).toBe("NOT_FOUND");
  });
});

describe("admin list reordering", () => {
  it("persists a complete reorder sequence", async () => {
    const token = await login();
    const banners = await prisma.banner.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true } });
    const ids = banners.map((banner) => banner.id).reverse();
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/banners/reorder",
      headers: { authorization: `Bearer ${token}` },
      payload: { ids }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.ids).toEqual(ids);
    const reordered = await prisma.banner.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, sortOrder: true } });
    expect(reordered.map((banner) => banner.id)).toEqual(ids);
    expect(reordered.map((banner) => banner.sortOrder)).toEqual(ids.map((_, index) => index + 1));
  });

  it("rejects incomplete and duplicate reorder sequences", async () => {
    const token = await login();
    const menus = await prisma.menuItem.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true } });
    const incomplete = await app.inject({
      method: "POST",
      url: "/api/admin/menu-items/reorder",
      headers: { authorization: `Bearer ${token}` },
      payload: { ids: menus.slice(1).map((menu) => menu.id) }
    });
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/admin/menu-items/reorder",
      headers: { authorization: `Bearer ${token}` },
      payload: { ids: [menus[0].id, menus[0].id] }
    });

    expect(incomplete.statusCode).toBe(400);
    expect(incomplete.json().error).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(duplicate.statusCode).toBe(400);
    expect(duplicate.json().error).toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("media upload and references", () => {
  it("rejects nested relation writes and only accepts whitelisted business fields", async () => {
    const token = await login();
    const banner = await prisma.banner.findFirstOrThrow();
    const wrongAsset = await uploadMedia(token, await pngBuffer(90, 90), { resourceName: "嵌套写入资源" });
    const response = await app.inject({
      method: "PUT",
      url: `/api/admin/banners/${banner.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { imageAsset: { connect: { id: wrongAsset.json().data.asset.id } } }
    });

    expect(response.statusCode).toBe(400);
    expect((await prisma.banner.findUniqueOrThrow({ where: { id: banner.id } })).imageAssetId).toBe(banner.imageAssetId);
  });

  it("persists null when an optional single media association is removed", async () => {
    const token = await login();
    const artist = await prisma.artist.findFirstOrThrow();
    const avatar = await uploadMedia(token, await pngBuffer(91, 91), { resourceName: "待解除头像" });
    await prisma.artist.update({ where: { id: artist.id }, data: { avatarAssetId: avatar.json().data.asset.id } });

    const response = await app.inject({
      method: "PUT",
      url: `/api/admin/artists/${artist.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { avatarAssetId: null }
    });

    expect(response.statusCode).toBe(200);
    expect((await prisma.artist.findUniqueOrThrow({ where: { id: artist.id } })).avatarAssetId).toBeNull();
  });

  it("rejects multiple file parts and removes all temporary files", async () => {
    const token = await login();
    const response = await uploadTwoFiles(token, await pngBuffer(92, 92), await pngBuffer(93, 93));
    const tempDir = path.join(uploadDir, ".tmp");

    expect(response.statusCode).toBe(400);
    expect(await readdir(tempDir).catch(() => [])).toEqual([]);
  });

  it("consumes and rejects file parts with an unexpected field name", async () => {
    const token = await login();
    const response = await uploadUnexpectedFileField(token, await pngBuffer(92, 92));

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
    expect(await readdir(path.join(uploadDir, ".tmp")).catch(() => [])).toEqual([]);
  });

  it("uses stable seed identities after seeded display text is edited", async () => {
    const seeded = await prisma.announcement.findFirstOrThrow({ where: { summary: "最新档期更新" } });
    await prisma.announcement.update({ where: { id: seeded.id }, data: { summary: "后台已编辑的种子公告" } });
    const userRecord = await prisma.announcement.create({
      data: {
        summary: "最新档期更新",
        content: "用户创建的同名公告",
        displayDurationMs: 5000,
        sortOrder: 99,
        status: "enabled"
      }
    });
    const before = await Promise.all([
      prisma.announcement.count(),
      prisma.banner.count(),
      prisma.menuItem.count(),
      prisma.activityCase.count(),
      prisma.artist.count()
    ]);
    await seedDatabase(prisma, { uploadDir, publicBaseUrl: "http://127.0.0.1:3001" });
    const after = await Promise.all([
      prisma.announcement.count(),
      prisma.banner.count(),
      prisma.menuItem.count(),
      prisma.activityCase.count(),
      prisma.artist.count()
    ]);

    expect(after).toEqual(before);
    expect((await prisma.announcement.findUniqueOrThrow({ where: { id: seeded.id } })).content).toBe("婚礼主持、商演主持、歌手演出可预约");
    expect((await prisma.announcement.findUniqueOrThrow({ where: { id: userRecord.id } })).content).toBe("用户创建的同名公告");
  });
  it("preserves media associations and structured fields on partial business updates", async () => {
    const token = await login();
    const banner = await prisma.banner.findFirstOrThrow();
    const menu = await prisma.menuItem.findFirstOrThrow();
    const activityCase = await prisma.activityCase.findFirstOrThrow();

    const [bannerResponse, menuResponse, caseResponse] = await Promise.all([
      app.inject({
        method: "PUT",
        url: `/api/admin/banners/${banner.id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { status: "disabled" }
      }),
      app.inject({
        method: "PUT",
        url: `/api/admin/menu-items/${menu.id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { status: "disabled" }
      }),
      app.inject({
        method: "PUT",
        url: `/api/admin/cases/${activityCase.id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { status: "disabled", isFeatured: false }
      })
    ]);

    expect([bannerResponse.statusCode, menuResponse.statusCode, caseResponse.statusCode]).toEqual([200, 200, 200]);
    expect(await prisma.banner.findUniqueOrThrow({ where: { id: banner.id } })).toMatchObject({ imageAssetId: banner.imageAssetId, status: "disabled" });
    expect(await prisma.menuItem.findUniqueOrThrow({ where: { id: menu.id } })).toMatchObject({
      iconAssetId: menu.iconAssetId,
      configJson: menu.configJson,
      status: "disabled"
    });
    expect(await prisma.activityCase.findUniqueOrThrow({ where: { id: activityCase.id } })).toMatchObject({
      coverAssetId: activityCase.coverAssetId,
      eventDate: activityCase.eventDate,
      status: "disabled",
      isFeatured: false
    });
  });

  it("extracts dimensions from MP4 video uploads without assigning the immutable image cache", async () => {
    const token = await login();
    const video = Buffer.from(
      "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAANebW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAHgAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAoh0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAHgAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAIAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAB4AAAEAAABAAAAAAIAbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAyAAAACABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABq21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAWtzdGJsAAAAv3N0c2QAAAAAAAAAAQAAAK9hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAACABIAAAASAAAAAAAAAABFUxhdmM2Mi4yOC4xMDEgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANWF2Y0MBZAAK/+EAGGdkAAqs2V/lwEQAAAMABAAAAwDIPEiWWAEABmjr48siwP34+AAAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAC+4gAAAAAAAAAYc3R0cwAAAAAAAAABAAAAAwAAAgAAAAAUc3RzcwAAAAAAAAABAAAAAQAAAChjdHRzAAAAAAAAAAMAAAABAAAEAAAAAAEAAAYAAAAAAQAAAgAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAMAAAABAAAAIHN0c3oAAAAAAAAAAAAAAAMAAALFAAAADAAAAAwAAAAUc3RjbwAAAAAAAAABAAADjgAAAGJ1ZHRhAAAAWm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALWlsc3QAAAAlqXRvbwAAAB1kYXRhAAAAAQAAAABMYXZmNjIuMTIuMTAxAAAACGZyZWUAAALlbWRhdAAAAq4GBf//qtxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjUgcjMyMjIgYjM1NjA1YSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjUgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0xIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDM6MHgxMTMgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMiBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTEgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0xIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MyBiX3B5cmFtaWQ9MiBiX2FkYXB0PTEgYl9iaWFzPTAgZGlyZWN0PTEgd2VpZ2h0Yj0xIG9wZW5fZ29wPTAgd2VpZ2h0cD0yIGtleWludD0yNTAga2V5aW50X21pbj0yNSBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAA9liIQAM//+9uy+BTYUyMEAAAAIQZoibEK//sAAAAAIAZ5BeQr/xIE=",
      "base64"
    );
    const response = await uploadMedia(token, video, {
      resourceName: "测试视频",
      filename: "sample.mp4",
      mimeType: "video/mp4"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.asset).toMatchObject({ mediaType: "video", width: 16, height: 8 });
    const served = await app.inject({
      method: "GET",
      url: new URL(response.json().data.asset.url).pathname
    });
    expect(served.statusCode).toBe(200);
    expect(served.headers["cache-control"]).toBe("public, max-age=0");
  });

  it("accepts form uploads with recommended dimensions only", async () => {
    const token = await login();
    const file = await pngBuffer(100, 100);
    const response = await uploadMedia(token, file, {
      resourceName: "非推荐尺寸 Banner",
      filename: "flexible.png",
      fieldKey: "banner.image"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.asset).toMatchObject({ width: 100, height: 100, mediaType: "image" });
  });

  it("accepts neutral resource uploads with names and tags", async () => {
    const token = await login();
    const file = await pngBuffer(100, 100);
    const response = await uploadMedia(token, file, {
      resourceName: "活动现场图",
      filename: "original.png",
      tags: ["婚礼", " 现场 ", "婚礼"]
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      reused: false,
      asset: {
        resourceName: "活动现场图",
        originalName: "original.png",
        width: 100,
        height: 100,
        mediaType: "image",
        tags: ["婚礼", "现场"],
        createdByName: testAdminCredentials.username,
        inUse: false,
        referenceCount: 0
      }
    });
    const asset = response.json().data.asset;
    const stored = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(stored.url).toBe(`/uploads/${stored.filename}`);
    expect(asset.url).toBe(`http://127.0.0.1:3001/uploads/${stored.filename}`);
  });

  it("serves uploaded images with a 30-day immutable client cache", async () => {
    const token = await login();
    const file = await pngBuffer(101, 101);
    const upload = await uploadMedia(token, file, {
      resourceName: "长缓存图片",
      filename: "cache-source.png"
    });
    const asset = upload.json().data.asset;

    const response = await app.inject({
      method: "GET",
      url: new URL(asset.url).pathname
    });

    expect(upload.statusCode).toBe(200);
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(file);
    expect(response.headers["cache-control"]).toBe("public, max-age=2592000, immutable");
    expect(response.headers.etag).toBeTruthy();
    expect(response.headers["last-modified"]).toBeTruthy();
    expect(response.headers["accept-ranges"]).toBe("bytes");
  });

  it("recomputes MD5 and rejects a mismatched client hash", async () => {
    const token = await login();
    const response = await uploadMedia(token, await pngBuffer(80, 80), {
      resourceName: "错误哈希资源",
      md5: "00000000000000000000000000000000"
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("MD5_MISMATCH");
  });

  it("uses the verified image format for MIME and storage extension", async () => {
    const token = await login();
    const response = await uploadMedia(token, await pngBuffer(81, 81), {
      resourceName: "真实格式资源",
      filename: "claimed.jpg",
      mimeType: "image/jpeg"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.asset.mimeType).toBe("image/png");
    expect(response.json().data.asset.url).toMatch(/\.png$/);
  });

  it("deduplicates concurrent uploads using the database unique index", async () => {
    const token = await login();
    const file = await pngBuffer(82, 82);
    const [first, second] = await Promise.all([
      uploadMedia(token, file, { resourceName: "并发资源一" }),
      uploadMedia(token, file, { resourceName: "并发资源二" })
    ]);

    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    expect([first.json().data.reused, second.json().data.reused].sort()).toEqual([false, true]);
    expect(first.json().data.asset.id).toBe(second.json().data.asset.id);
  });

  it("reuses an existing MD5 without changing its metadata", async () => {
    const token = await login();
    const file = await pngBuffer(120, 120);
    const first = await uploadMedia(token, file, { resourceName: "首次资源", tags: ["原标签"] });
    const second = await uploadMedia(token, file, { resourceName: "不会写入", tags: ["新标签"] });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().data).toMatchObject({
      reused: true,
      asset: { id: first.json().data.asset.id, resourceName: "首次资源", tags: ["原标签"] }
    });
  });

  it("enforces globally normalized resource names", async () => {
    const token = await login();
    const first = await uploadMedia(token, await pngBuffer(130, 130), { resourceName: "Demo资源" });
    const second = await uploadMedia(token, await pngBuffer(140, 140), { resourceName: "  ＤＥＭＯ资源  " });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("DUPLICATE_RESOURCE_NAME");
  });

  it("looks up duplicates and checks globally unique names", async () => {
    const token = await login();
    const file = await pngBuffer(150, 150);
    const upload = await uploadMedia(token, file, { resourceName: "查询资源" });
    const asset = upload.json().data.asset;

    const lookup = await app.inject({
      method: "POST",
      url: "/api/admin/media-assets/lookup",
      headers: { authorization: `Bearer ${token}` },
      payload: { md5: asset.md5, size: asset.size }
    });
    const unavailable = await app.inject({
      method: "POST",
      url: "/api/admin/media-assets/check-name",
      headers: { authorization: `Bearer ${token}` },
      payload: { resourceName: "  查询资源 " }
    });
    const ownName = await app.inject({
      method: "POST",
      url: "/api/admin/media-assets/check-name",
      headers: { authorization: `Bearer ${token}` },
      payload: { resourceName: "查询资源", excludeId: asset.id }
    });

    expect(lookup.statusCode).toBe(200);
    expect(lookup.json().data.asset.id).toBe(asset.id);
    expect(unavailable.json().data.available).toBe(false);
    expect(ownName.json().data.available).toBe(true);
  });

  it("filters media and edits resource metadata", async () => {
    const token = await login();
    const upload = await uploadMedia(token, await pngBuffer(160, 160), {
      resourceName: "筛选现场图",
      tags: ["待筛选"]
    });
    const asset = upload.json().data.asset;
    const filtered = await app.inject({
      method: "GET",
      url: "/api/admin/media-assets?mediaType=image&q=现场&tag=待筛选&referenceStatus=unused&page=1&pageSize=20",
      headers: { authorization: `Bearer ${token}` }
    });
    const updated = await app.inject({
      method: "PATCH",
      url: `/api/admin/media-assets/${asset.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { resourceName: "筛选现场图-更新", tags: ["更新", " 更新 "] }
    });
    const tags = await app.inject({
      method: "GET",
      url: "/api/admin/media-assets/tags",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().data.items.map((item: { id: number }) => item.id)).toContain(asset.id);
    expect(updated.json().data).toMatchObject({ resourceName: "筛选现场图-更新", tags: ["更新"] });
    expect(tags.json().data.items).toEqual(expect.arrayContaining([expect.objectContaining({ label: "更新", count: 1 })]));
  });

  it("scans and batch deletes only unused media", async () => {
    const token = await login();
    const unusedUpload = await uploadMedia(token, await pngBuffer(170, 170), { resourceName: "待清理资源" });
    const unusedId = unusedUpload.json().data.asset.id;
    const storedPath = path.join(uploadDir, new URL(unusedUpload.json().data.asset.url).pathname.split("/uploads/")[1]);
    const usedAsset = await prisma.mediaAsset.findFirstOrThrow({ where: { banners: { some: {} } } });
    const scan = await app.inject({
      method: "POST",
      url: "/api/admin/media-assets/scan-unused",
      headers: { authorization: `Bearer ${token}` }
    });
    const deleted = await app.inject({
      method: "POST",
      url: "/api/admin/media-assets/batch-delete",
      headers: { authorization: `Bearer ${token}` },
      payload: { ids: [unusedId, usedAsset.id] }
    });

    expect(scan.json().data.items.map((item: { id: number }) => item.id)).toContain(unusedId);
    expect(scan.json().data.items.map((item: { id: number }) => item.id)).not.toContain(usedAsset.id);
    expect(deleted.json().data.deletedIds).toEqual([unusedId]);
    expect(deleted.json().data.skipped).toEqual([{ id: usedAsset.id, reason: "MEDIA_IN_USE" }]);
    expect(await prisma.mediaAsset.findUnique({ where: { id: unusedId } })).toBeNull();
    await expect(stat(storedPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("saves ordered case detail media and protects the references", async () => {
    const token = await login();
    const first = await uploadMedia(token, await pngBuffer(180, 180), { resourceName: "案例详情一" });
    const second = await uploadMedia(token, await pngBuffer(190, 190), { resourceName: "案例详情二" });
    const cover = await prisma.mediaAsset.findFirstOrThrow({ where: { resourceName: "placeholder-case.png" } });
    const detailPage = await app.inject({
      method: "POST",
      url: "/api/admin/detail-pages",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "含详情媒体案例详情",
        type: "rich_text",
        richTextHtml: `<p>详情</p><img data-media-asset-id="${second.json().data.asset.id}"><img data-media-asset-id="${first.json().data.asset.id}">`
      }
    });
    expect(detailPage.statusCode).toBe(200);
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/cases",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: "含详情媒体案例",
        category: "测试",
        tag: "测试",
        coverAssetId: cover.id,
        summary: "简介",
        eventDate: "2026-07-10T00:00:00.000Z",
        location: "杭州",
        detailPageId: detailPage.json().data.id,
        isFeatured: false,
        featuredSortOrder: 0,
        sortOrder: 999,
        status: "enabled"
      }
    });
    const cases = await app.inject({
      method: "GET",
      url: "/api/admin/cases",
      headers: { authorization: `Bearer ${token}` }
    });
    const item = cases.json().data.items.find((candidate: { id: number }) => candidate.id === created.json().data.id);
    const blocked = await app.inject({
      method: "DELETE",
      url: `/api/admin/media-assets/${first.json().data.asset.id}`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(created.statusCode).toBe(200);
    expect(item.detailMediaAssetIds).toEqual([second.json().data.asset.id, first.json().data.asset.id]);
    expect(item.media.map((media: { id: number }) => media.id)).toEqual([second.json().data.asset.id, first.json().data.asset.id]);
    expect(blocked.statusCode).toBe(409);
  });

  it("accepts business associations with non-recommended image dimensions", async () => {
    const token = await login();
    const upload = await uploadMedia(token, await pngBuffer(200, 200), { resourceName: "可用于Banner" });
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/banners",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: "非法 Banner",
        imageAssetId: upload.json().data.asset.id,
        linkType: "none",
        switchDurationMs: 3000,
        sortOrder: 100,
        status: "enabled"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.imageAssetId).toBe(upload.json().data.asset.id);
  });

  it("prevents deleting media used by CMS content", async () => {
    const token = await login();
    const usedAsset = await prisma.mediaAsset.findFirstOrThrow({ where: { banners: { some: {} } } });

    const response = await app.inject({
      method: "DELETE",
      url: `/api/admin/media-assets/${usedAsset.id}`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("MEDIA_IN_USE");
  });

  it("reports article cover media as used", async () => {
    const token = await login();
    const article = await prisma.article.findFirstOrThrow({ include: { coverAsset: true } });
    const assetResponse = await app.inject({
      method: "GET",
      url: `/api/admin/media-assets/${article.coverAssetId}`,
      headers: { authorization: `Bearer ${token}` }
    });
    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/admin/media-assets/${article.coverAssetId}`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(assetResponse.statusCode).toBe(200);
    expect(assetResponse.json().data.referenceSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "article_cover",
          label: expect.stringContaining(`${article.title}（ID ${article.id}）`)
        })
      ])
    );
    expect(deleteResponse.json().error.message).toContain(`${article.title}（ID ${article.id}）`);
    expect(deleteResponse.statusCode).toBe(409);
  });
});

describe("daily WeChat user analytics", () => {
  it("records one valid client user and increases the daily unique-user overview", async () => {
    const token = await login();
    const before = await app.inject({
      method: "GET",
      url: "/api/admin/dashboard/overview",
      headers: { authorization: `Bearer ${token}` }
    });

    await clientInject({
      method: "POST",
      url: "/api/client/track/page-view",
      payload: { pagePath: "/pages/index/index", scene: "home" }
    });

    const after = await app.inject({
      method: "GET",
      url: "/api/admin/dashboard/overview",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(after.json().data.todayUniqueUsers).toBe(before.json().data.todayUniqueUsers + 1);
    expect(after.json().data.weekDailyUniqueUsers).toBeGreaterThanOrEqual(
      after.json().data.todayUniqueUsers
    );
    expect(after.json().data.monthDailyUniqueUsers).toBeGreaterThanOrEqual(
      after.json().data.weekDailyUniqueUsers
    );
  });
});
