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

function artistPayload(avatarAssetId: number, bannerAssetId: number, contentAssetId?: number) {
  return {
    name: "接口详情主持人",
    type: "host",
    avatarAssetId,
    location: "杭州",
    badge: "金牌主持",
    tags: ["婚礼主持", "控场力强"],
    summary: "接口测试人员简介",
    sortOrder: 91,
    status: "enabled",
    detailPage: {
      type: "banner_rich_text",
      heroSubtitle: "温暖・专业",
      bannerAssetIds: [bannerAssetId],
      richTextHtml: `<p>接口富文本</p>${contentAssetId ? `<video data-media-asset-id="${contentAssetId}"></video>` : ""}`
    }
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

describe("detail page API integration", () => {
  beforeEach(async () => {
    await seedDatabase(prisma, { uploadDir, publicBaseUrl: "http://127.0.0.1:3001", reset: true });
  });

  it("seeds both page types for artists and cases without duplicate configs", async () => {
    const before = await Promise.all([
      prisma.mediaAsset.count(),
      prisma.seedRecord.count(),
      prisma.detailPageConfig.count(),
      prisma.detailPageBannerMedia.count(),
      prisma.detailPageContentMedia.count()
    ]);
    const linran = await prisma.artist.findFirstOrThrow({ where: { name: "林然" } });
    const artistConfig = await prisma.detailPageConfig.findUniqueOrThrow({
      where: { ownerType_ownerId: { ownerType: "artist", ownerId: linran.id } },
      include: { banners: { include: { mediaAsset: true }, orderBy: { sortOrder: "asc" } }, contentMedia: { include: { mediaAsset: true } } }
    });
    expect(artistConfig).toMatchObject({ pageType: "banner_rich_text", heroSubtitle: "温暖・专业・掌控全场" });
    expect(artistConfig.banners).toHaveLength(3);
    expect(artistConfig.richTextHtml).toContain("个人简介");
    expect(artistConfig.richTextHtml).toContain("常见问题");
    expect(artistConfig.banners.map((banner) => banner.mediaAsset.originalName)).toEqual([
      "banner-linran-balanced.png",
      "banner-linran-close.png",
      "banner-linran-wide.png"
    ]);

    const bannerCase = await prisma.activityCase.findFirstOrThrow({ where: { title: "浪漫粉色系户外婚礼" } });
    const bannerCaseConfig = await prisma.detailPageConfig.findUniqueOrThrow({
      where: { ownerType_ownerId: { ownerType: "activity_case", ownerId: bannerCase.id } },
      include: { banners: true, contentMedia: { include: { mediaAsset: true } } }
    });
    expect(bannerCaseConfig.banners).toHaveLength(2);
    expect(bannerCaseConfig.contentMedia.map((relation) => relation.mediaAsset.mediaType)).toContain("video");

    const richTextCase = await prisma.activityCase.findFirstOrThrow({ where: { title: "企业年会歌手演出" } });
    const richTextCaseConfig = await prisma.detailPageConfig.findUniqueOrThrow({
      where: { ownerType_ownerId: { ownerType: "activity_case", ownerId: richTextCase.id } },
      include: { banners: true, contentMedia: true }
    });
    expect(richTextCaseConfig).toMatchObject({ pageType: "rich_text", banners: [] });
    expect(richTextCaseConfig.contentMedia.length).toBeGreaterThan(0);

    const ownerTypes = await prisma.detailPageConfig.groupBy({ by: ["ownerType", "pageType"], _count: true });
    expect(ownerTypes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ownerType: "artist", pageType: "rich_text" }),
        expect.objectContaining({ ownerType: "artist", pageType: "banner_rich_text" }),
        expect.objectContaining({ ownerType: "activity_case", pageType: "rich_text" }),
        expect.objectContaining({ ownerType: "activity_case", pageType: "banner_rich_text" })
      ])
    );

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

    const reseededArtistConfig = await prisma.detailPageConfig.findUniqueOrThrow({
      where: { ownerType_ownerId: { ownerType: "artist", ownerId: linran.id } },
      include: { banners: { include: { mediaAsset: true }, orderBy: { sortOrder: "asc" } }, contentMedia: { include: { mediaAsset: true } } }
    });
    expect(reseededArtistConfig.banners.map((banner) => banner.mediaAsset.originalName)).toEqual([
      "banner-linran-balanced.png",
      "banner-linran-close.png",
      "banner-linran-wide.png"
    ]);
    expect(reseededArtistConfig.contentMedia.map((relation) => relation.mediaAsset.originalName).sort()).toEqual(
      artistConfig.contentMedia.map((relation) => relation.mediaAsset.originalName).sort()
    );
  });

  it("previews with production validation without writing config rows", async () => {
    const auth = await token();
    const banner = await createAsset(100, "image");
    const configCount = await prisma.detailPageConfig.count();
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/detail-pages/preview",
      headers: { authorization: `Bearer ${auth}` },
      payload: {
        detailPage: {
          type: "banner_rich_text",
          heroSubtitle: "预览宣传语",
          bannerAssetIds: [banner.id],
          richTextHtml: "<p>预览正文</p>"
        }
      }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ type: "banner_rich_text", rendererKey: "bannerRichText" });
    expect(await prisma.detailPageConfig.count()).toBe(configCount);
  });

  it("creates an artist and detail config atomically, then returns unified admin and client DTOs", async () => {
    const auth = await token();
    const avatar = await createAsset(101, "image");
    const banner = await createAsset(102, "image");
    const video = await createAsset(103, "video");
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/artists",
      headers: { authorization: `Bearer ${auth}` },
      payload: artistPayload(avatar.id, banner.id, video.id)
    });

    expect(response.statusCode).toBe(200);
    const created = response.json().data;
    expect(created.detailPage).toMatchObject({
      type: "banner_rich_text",
      heroSubtitle: "温暖・专业",
      banners: [expect.objectContaining({ assetId: banner.id })]
    });
    expect(created.detail).toBe(created.detailPage.richTextHtml);

    const adminList = await app.inject({
      method: "GET",
      url: "/api/admin/artists",
      headers: { authorization: `Bearer ${auth}` }
    });
    const adminItem = adminList.json().data.items.find((item: { id: number }) => item.id === created.id);
    expect(adminItem).toMatchObject({
      detailPageType: "banner_rich_text",
      detailPageTypeLabel: "BANNER + 富文本",
      bannerCount: 1,
      detailMediaCount: 1,
      hasRichText: true
    });

    const client = await app.inject({ method: "GET", url: `/api/client/artists/${created.id}` });
    expect(client.statusCode).toBe(200);
    expect(client.json().data.detailPage.blocks.map((block: { type: string }) => block.type)).toEqual(["richText", "video"]);

    const bannerReference = await app.inject({
      method: "GET",
      url: `/api/admin/media-assets/${banner.id}`,
      headers: { authorization: `Bearer ${auth}` }
    });
    const contentReference = await app.inject({
      method: "GET",
      url: `/api/admin/media-assets/${video.id}`,
      headers: { authorization: `Bearer ${auth}` }
    });
    expect(bannerReference.json().data).toMatchObject({
      inUse: true,
      referenceCount: 1,
      referenceSources: [expect.objectContaining({ type: "detail_page_banner", label: "详情页 BANNER", count: 1 })]
    });
    expect(contentReference.json().data).toMatchObject({
      inUse: true,
      referenceCount: 1,
      referenceSources: [expect.objectContaining({ type: "detail_page_content", label: "详情页富文本", count: 1 })]
    });

    const blocked = await app.inject({
      method: "DELETE",
      url: `/api/admin/media-assets/${banner.id}`,
      headers: { authorization: `Bearer ${auth}` }
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.message).toContain("详情页 BANNER");
  });

  it("rolls back the owner when detail validation fails", async () => {
    const auth = await token();
    const avatar = await createAsset(104, "image");
    const banner = await createAsset(105, "image");
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/artists",
      headers: { authorization: `Bearer ${auth}` },
      payload: artistPayload(avatar.id, banner.id, 99999)
    });
    expect(response.statusCode).toBe(400);
    expect(await prisma.artist.count({ where: { name: "接口详情主持人" } })).toBe(0);
  });

  it("switches artist type to rich text on save and clears banner references", async () => {
    const auth = await token();
    const avatar = await createAsset(106, "image");
    const banner = await createAsset(107, "image");
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/artists",
      headers: { authorization: `Bearer ${auth}` },
      payload: artistPayload(avatar.id, banner.id)
    });
    const id = created.json().data.id;
    const updated = await app.inject({
      method: "PUT",
      url: `/api/admin/artists/${id}`,
      headers: { authorization: `Bearer ${auth}` },
      payload: { detailPage: { type: "rich_text", richTextHtml: "<p>保留并切换</p>" } }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.detailPage).toMatchObject({ type: "rich_text", heroSubtitle: "", banners: [] });
    const config = await prisma.detailPageConfig.findUniqueOrThrow({
      where: { ownerType_ownerId: { ownerType: "artist", ownerId: id } }
    });
    expect(await prisma.detailPageBannerMedia.count({ where: { detailPageConfigId: config.id } })).toBe(0);
  });

  it("creates, serves and deletes a case with its common detail config", async () => {
    const auth = await token();
    const cover = await createAsset(108, "image", { width: 460, height: 320 });
    const banner = await createAsset(109, "image");
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
        detailPage: {
          type: "banner_rich_text",
          heroSubtitle: "精彩现场",
          bannerAssetIds: [banner.id],
          richTextHtml: "<p>案例正文</p>"
        }
      }
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().data.id;
    const client = await app.inject({ method: "GET", url: `/api/client/cases/${id}` });
    expect(client.json().data.detailPage).toMatchObject({ type: "banner_rich_text" });

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/admin/cases/${id}`,
      headers: { authorization: `Bearer ${auth}` }
    });
    expect(removed.statusCode).toBe(200);
    expect(await prisma.detailPageConfig.count({ where: { ownerType: "activity_case", ownerId: id } })).toBe(0);
  });

  it("returns controlled client errors for missing configs and unknown stored types", async () => {
    const artist = await prisma.artist.findFirstOrThrow();
    await prisma.detailPageConfig.deleteMany({ where: { ownerType: "artist", ownerId: artist.id } });
    const missing = await app.inject({ method: "GET", url: `/api/client/artists/${artist.id}` });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("DETAIL_PAGE_CONFIG_NOT_FOUND");

    await prisma.detailPageConfig.create({
      data: { ownerType: "artist", ownerId: artist.id, pageType: "future_type", richTextHtml: "<p>未来内容</p>" }
    });
    const unknown = await app.inject({ method: "GET", url: `/api/client/artists/${artist.id}` });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error.code).toBe("UNKNOWN_DETAIL_PAGE_TYPE");
  });
});
