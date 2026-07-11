import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { registerSeedAssets, seedAssetSpecs } from "../src/assets";
import { createPrismaClient, type AppPrismaClient } from "../src/db";
import { seedDatabase } from "../src/seed";
import { ensureDatabaseSchema } from "../src/sqlite-schema";

const root = path.join(process.cwd(), ".tmp/detail-page-api-tests", String(process.pid));
const databasePath = path.join(root, "api.db");
const uploadDir = path.join(root, "uploads");
let prisma: AppPrismaClient;
let app: Awaited<ReturnType<typeof buildApp>>;

async function token() {
  const response = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: { username: "admin", password: "admin123456" }
  });
  return response.json().data.token as string;
}

async function createAsset(id: number, mediaType: "image" | "video", dimensions?: { width: number; height: number }) {
  const extension = mediaType === "image" ? "png" : "mp4";
  return prisma.mediaAsset.create({
    data: {
      resourceName: `接口资源-${id}`,
      resourceNameKey: `api-detail-${id}`,
      originalName: `api-${id}.${extension}`,
      filename: `api-${id}.${extension}`,
      md5: (5000 + id).toString(16).padStart(32, "0"),
      mimeType: mediaType === "image" ? "image/png" : "video/mp4",
      mediaType,
      url: `/uploads/api-${id}.${extension}`,
      width: dimensions?.width ?? (mediaType === "image" ? 1500 : 1920),
      height: dimensions?.height ?? (mediaType === "image" ? 760 : 1080),
      size: 1024
    }
  });
}

function bannerDetailPagePayload(name: string, bannerAssetId: number, contentAssetId?: number) {
  return {
    name,
    type: "banner_rich_text" as const,
    hero: {
      title: name.replace("详情", ""),
      typeLabel: "测试详情",
      subtitle: "温暖・专业",
      badge: "推荐",
      tags: ["回归测试"],
      location: "杭州",
      metaItems: [{ label: "来源", value: "API" }]
    },
    bannerAssetIds: [bannerAssetId],
    richTextHtml: `<p>接口富文本</p>${contentAssetId ? `<video data-media-asset-id="${contentAssetId}"></video>` : ""}`
  };
}

function richDetailPagePayload(name: string, contentAssetId?: number) {
  return {
    name,
    type: "rich_text" as const,
    richTextHtml: `<p>接口富文本</p>${contentAssetId ? `<img data-media-asset-id="${contentAssetId}">` : ""}`
  };
}

function artistPayload(avatarAssetId: number, detailPageId: number | null) {
  return {
    name: "接口详情主持人",
    type: "host",
    avatarAssetId,
    location: "杭州",
    badge: "金牌主持",
    tags: ["婚礼主持", "控场力强"],
    summary: "接口测试人员简介",
    detailPageId,
    sortOrder: 91,
    status: "enabled"
  };
}

beforeAll(async () => {
  await rm(root, { recursive: true, force: true });
  await mkdir(uploadDir, { recursive: true });
  prisma = createPrismaClient(`file:${databasePath}`);
  await ensureDatabaseSchema(prisma, { uploadDir });
  app = await buildApp({ prisma, jwtSecret: "detail-test", uploadDir, publicBaseUrl: "http://127.0.0.1:3001" });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  await rm(root, { recursive: true, force: true });
});

describe("seed asset recovery commands", () => {
  async function expectMissingAssetCommand(relativePath: string, pattern: RegExp) {
    await expect(
      registerSeedAssets(prisma, {
        uploadDir,
        publicBaseUrl: "http://127.0.0.1:3001",
        assetRoot: path.join(root, "missing-seed-assets"),
        createdBy: 0,
        specs: [seedAssetSpecs.find((spec) => spec.relativePath === relativePath)!]
      })
    ).rejects.toThrow(pattern);
  }

  it("reports the core slicing command for a missing core seed asset", async () => {
    await expectMissingAssetCommand("banner-default.png", /种子资源文件不存在：.*banner-default\.png.*pnpm assets:slice(?:\s|$)/);
  });

  it("reports the artist slicing command for a missing artist cover seed asset", async () => {
    await expectMissingAssetCommand("artist-cover-01.png", /种子资源文件不存在：.*artist-cover-01\.png.*pnpm assets:slice:artists/);
  });

  it("reports the detail slicing command for a missing detail seed asset", async () => {
    await expectMissingAssetCommand(
      "artist-detail/banner-linran-balanced.png",
      /种子资源文件不存在：.*banner-linran-balanced\.png.*pnpm assets:slice:artist-detail/
    );
  });
});

describe("standalone detail page API integration", () => {
  beforeEach(async () => {
    await seedDatabase(prisma, { uploadDir, publicBaseUrl: "http://127.0.0.1:3001", reset: true });
  });

  it("seeds reusable detail pages and linked/unlinked business examples idempotently", async () => {
    const before = await Promise.all([
      prisma.mediaAsset.count(),
      prisma.seedRecord.count(),
      prisma.detailPageConfig.count(),
      prisma.detailPageBannerMedia.count(),
      prisma.detailPageContentMedia.count()
    ]);

    const linran = await prisma.artist.findFirstOrThrow({ where: { name: "林然" } });
    const linranDetail = await prisma.detailPageConfig.findFirstOrThrow({
      where: { name: "林然个人详情" },
      include: { banners: { include: { mediaAsset: true }, orderBy: { sortOrder: "asc" } }, contentMedia: true }
    });
    expect(linran.detailPageId).toBe(linranDetail.id);
    expect(linranDetail).toMatchObject({
      ownerType: null,
      ownerId: null,
      pageType: "banner_rich_text",
      heroTitle: "林然",
      heroSubtitle: "温暖・专业・掌控全场"
    });
    expect(linranDetail.banners.map((banner) => banner.mediaAsset.originalName)).toEqual([
      "banner-linran-balanced.png",
      "banner-linran-close.png",
      "banner-linran-wide.png"
    ]);

    const businessCounts = [
      [await prisma.announcement.count({ where: { detailPageId: { not: null } } }), await prisma.announcement.count({ where: { detailPageId: null } })],
      [await prisma.banner.count({ where: { detailPageId: { not: null } } }), await prisma.banner.count({ where: { detailPageId: null } })],
      [await prisma.artist.count({ where: { detailPageId: { not: null } } }), await prisma.artist.count({ where: { detailPageId: null } })],
      [await prisma.activityCase.count({ where: { detailPageId: { not: null } } }), await prisma.activityCase.count({ where: { detailPageId: null } })]
    ];
    for (const [linked, unlinked] of businessCounts) {
      expect(linked).toBeGreaterThan(0);
      expect(unlinked).toBeGreaterThan(0);
    }

    await seedDatabase(prisma, { uploadDir, publicBaseUrl: "http://127.0.0.1:3001" });
    expect(
      await Promise.all([
        prisma.mediaAsset.count(),
        prisma.seedRecord.count(),
        prisma.detailPageConfig.count(),
        prisma.detailPageBannerMedia.count(),
        prisma.detailPageContentMedia.count()
      ])
    ).toEqual(before);
  });

  it("previews with production validation without writing config rows", async () => {
    const auth = await token();
    const banner = await createAsset(100, "image");
    const configCount = await prisma.detailPageConfig.count();
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/detail-pages/preview",
      headers: { authorization: `Bearer ${auth}` },
      payload: { detailPage: bannerDetailPagePayload("预览详情", banner.id) }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      name: "预览详情",
      type: "banner_rich_text",
      rendererKey: "bannerRichText",
      hero: expect.objectContaining({ subtitle: "温暖・专业" })
    });
    expect(await prisma.detailPageConfig.count()).toBe(configCount);
  });

  it("creates a reusable detail page, links an artist, serves the public detail, and protects deletion", async () => {
    const auth = await token();
    const avatar = await createAsset(101, "image");
    const banner = await createAsset(102, "image");
    const video = await createAsset(103, "video");
    const detail = await app.inject({
      method: "POST",
      url: "/api/admin/detail-pages",
      headers: { authorization: `Bearer ${auth}` },
      payload: bannerDetailPagePayload("接口主持人详情", banner.id, video.id)
    });
    expect(detail.statusCode).toBe(200);
    const detailPage = detail.json().data;

    const response = await app.inject({
      method: "POST",
      url: "/api/admin/artists",
      headers: { authorization: `Bearer ${auth}` },
      payload: artistPayload(avatar.id, detailPage.id)
    });
    expect(response.statusCode).toBe(200);
    const created = response.json().data;
    expect(created).toMatchObject({
      detailPageId: detailPage.id,
      detailPageSummary: { id: detailPage.id, name: "接口主持人详情", type: "banner_rich_text" },
      bannerCount: 1,
      detailMediaCount: 1,
      hasRichText: true
    });

    const client = await app.inject({ method: "GET", url: `/api/client/detail-pages/${detailPage.id}` });
    expect(client.statusCode).toBe(200);
    expect(client.json().data.blocks.map((block: { type: string }) => block.type)).toEqual(["richText", "video"]);

    const artistDetail = await app.inject({ method: "GET", url: `/api/client/artists/${created.id}` });
    expect(artistDetail.json().data.detailPage.id).toBe(detailPage.id);

    const references = await app.inject({
      method: "GET",
      url: `/api/admin/detail-pages/${detailPage.id}/references`,
      headers: { authorization: `Bearer ${auth}` }
    });
    expect(references.json().data.items).toEqual([
      expect.objectContaining({ sourceType: "artist", sourceId: created.id, sourceName: "接口详情主持人" })
    ]);

    const blocked = await app.inject({
      method: "DELETE",
      url: `/api/admin/detail-pages/${detailPage.id}`,
      headers: { authorization: `Bearer ${auth}` }
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("DETAIL_PAGE_IN_USE");
  });

  it("lets business forms switch or clear a detailPageId without editing detail content", async () => {
    const auth = await token();
    const avatar = await createAsset(104, "image");
    const banner = await createAsset(105, "image");
    const content = await createAsset(106, "image");
    const bannerDetail = await app.inject({
      method: "POST",
      url: "/api/admin/detail-pages",
      headers: { authorization: `Bearer ${auth}` },
      payload: bannerDetailPagePayload("可视详情", banner.id)
    });
    const richDetail = await app.inject({
      method: "POST",
      url: "/api/admin/detail-pages",
      headers: { authorization: `Bearer ${auth}` },
      payload: richDetailPagePayload("图文详情", content.id)
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/artists",
      headers: { authorization: `Bearer ${auth}` },
      payload: artistPayload(avatar.id, bannerDetail.json().data.id)
    });

    const switched = await app.inject({
      method: "PUT",
      url: `/api/admin/artists/${created.json().data.id}`,
      headers: { authorization: `Bearer ${auth}` },
      payload: { detailPageId: richDetail.json().data.id }
    });
    expect(switched.statusCode).toBe(200);
    expect(switched.json().data).toMatchObject({
      detailPageId: richDetail.json().data.id,
      detailPageType: "rich_text",
      bannerCount: 0,
      detailMediaCount: 1
    });

    const cleared = await app.inject({
      method: "PUT",
      url: `/api/admin/artists/${created.json().data.id}`,
      headers: { authorization: `Bearer ${auth}` },
      payload: { detailPageId: null }
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().data).toMatchObject({
      detailPageId: null,
      detailPageSummary: null,
      detailPageType: null
    });
  });

  it("links cases to reusable detail pages and leaves detail pages after case deletion", async () => {
    const auth = await token();
    const cover = await createAsset(107, "image", { width: 460, height: 320 });
    const content = await createAsset(108, "image");
    const detail = await app.inject({
      method: "POST",
      url: "/api/admin/detail-pages",
      headers: { authorization: `Bearer ${auth}` },
      payload: richDetailPagePayload("接口案例详情", content.id)
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/cases",
      headers: { authorization: `Bearer ${auth}` },
      payload: {
        title: "接口详情案例",
        category: "发布会",
        tag: "品牌活动",
        coverAssetId: cover.id,
        summary: "案例简介",
        eventDate: "2026-07-11T00:00:00.000Z",
        location: "杭州",
        isFeatured: true,
        featuredSortOrder: 9,
        sortOrder: 9,
        status: "enabled",
        detailPageId: detail.json().data.id
      }
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().data.id;
    const list = await app.inject({ method: "GET", url: "/api/client/cases" });
    expect(list.json().data.find((item: { id: number }) => item.id === id)).toMatchObject({
      detailPageId: detail.json().data.id,
      hasDetailPage: true
    });
    expect(list.json().data.find((item: { id: number }) => item.id === id)).not.toHaveProperty("detailPage");

    const client = await app.inject({ method: "GET", url: `/api/client/cases/${id}` });
    expect(client.json().data.detailPage).toMatchObject({ id: detail.json().data.id, type: "rich_text" });

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/admin/cases/${id}`,
      headers: { authorization: `Bearer ${auth}` }
    });
    expect(removed.statusCode).toBe(200);
    expect(await prisma.detailPageConfig.count({ where: { id: detail.json().data.id } })).toBe(1);
  });

  it("returns controlled errors for invalid references and unknown stored detail types", async () => {
    const auth = await token();
    const avatar = await createAsset(109, "image");
    const invalidReference = await app.inject({
      method: "POST",
      url: "/api/admin/artists",
      headers: { authorization: `Bearer ${auth}` },
      payload: artistPayload(avatar.id, 999999)
    });
    expect(invalidReference.statusCode).toBe(400);
    expect(invalidReference.json().error.code).toBe("DETAIL_PAGE_REFERENCE_NOT_FOUND");

    const missing = await app.inject({ method: "GET", url: "/api/client/detail-pages/999999" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("DETAIL_PAGE_NOT_FOUND");

    const unknown = await prisma.detailPageConfig.create({
      data: { name: "未来类型详情", pageType: "future_type", richTextHtml: "<p>未来内容</p>" }
    });
    const response = await app.inject({ method: "GET", url: `/api/client/detail-pages/${unknown.id}` });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("UNKNOWN_DETAIL_PAGE_TYPE");
  });
});
