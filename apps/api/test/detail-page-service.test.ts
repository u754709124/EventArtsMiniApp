import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPrismaClient, type AppPrismaClient } from "../src/db";
import {
  deleteDetailPageConfig,
  getDetailPageConfig,
  getRequiredDetailPageConfig,
  previewDetailPageConfig,
  upsertDetailPageConfig,
  validateDetailPageOwner
} from "../src/detail-pages/detail-page-service";
import { DetailPageDomainError } from "../src/detail-pages/detail-page-types";
import { ensureDatabaseSchema } from "../src/sqlite-schema";

const root = path.join(process.cwd(), ".tmp/detail-page-service-tests");

async function createDatabase(name: string) {
  const runtime = path.join(root, name);
  await mkdir(runtime, { recursive: true });
  const prisma = createPrismaClient(`file:${path.join(runtime, "service.db")}`);
  await ensureDatabaseSchema(prisma, { uploadDir: path.join(runtime, "uploads") });
  return prisma;
}

async function createAsset(prisma: AppPrismaClient, id: number, mediaType: "image" | "video") {
  const extension = mediaType === "image" ? "png" : "mp4";
  return prisma.mediaAsset.create({
    data: {
      id,
      resourceName: `服务资源-${id}`,
      resourceNameKey: `service-${id}`,
      originalName: `service-${id}.${extension}`,
      filename: `service-${id}.${extension}`,
      md5: (1000 + id).toString(16).padStart(32, "0"),
      mimeType: mediaType === "image" ? "image/png" : "video/mp4",
      mediaType,
      url: `/uploads/service-${id}.${extension}`,
      width: mediaType === "image" ? 1200 : 1920,
      height: mediaType === "image" ? 800 : 1080,
      size: 1024
    }
  });
}

async function createArtist(prisma: AppPrismaClient, id = 1) {
  return prisma.artist.create({
    data: {
      id,
      name: `人员-${id}`,
      type: "host",
      location: "杭州",
      badge: "主持人",
      summary: "简介",
      tagsJson: "[]",
      detail: "旧详情",
      sortOrder: 1,
      status: "enabled"
    }
  });
}

async function createCase(prisma: AppPrismaClient, coverAssetId: number, id = 1) {
  return prisma.activityCase.create({
    data: {
      id,
      title: `案例-${id}`,
      category: "活动",
      tag: "案例",
      coverAssetId,
      summary: "简介",
      eventDate: new Date("2026-07-11T00:00:00.000Z"),
      location: "杭州",
      detail: "旧详情",
      legacyMediaJson: "[]",
      isFeatured: false,
      featuredSortOrder: 0,
      sortOrder: 1,
      status: "enabled"
    }
  });
}

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("DetailPageService", () => {
  it("upserts and serializes a banner page with ordered banners and derived video blocks", async () => {
    const prisma = await createDatabase("upsert-banner");
    await createArtist(prisma);
    await createAsset(prisma, 10, "image");
    await createAsset(prisma, 11, "image");
    await createAsset(prisma, 12, "video");

    const dto = await prisma.$transaction((tx) =>
      upsertDetailPageConfig(tx, "artist", 1, {
        type: "banner_rich_text",
        heroSubtitle: " 温暖・专业 ",
        bannerAssetIds: [11, 10],
        richTextHtml: '<p>前文</p><video data-media-asset-id="12"></video><p>后文</p>'
      })
    );

    expect(dto).toMatchObject({
      type: "banner_rich_text",
      typeLabel: "BANNER + 富文本",
      rendererKey: "bannerRichText",
      schemaVersion: 2,
      heroSubtitle: "温暖・专业"
    });
    expect(dto.banners.map((banner) => banner.assetId)).toEqual([11, 10]);
    expect(dto.banners.map((banner) => banner.sortOrder)).toEqual([0, 1]);
    expect(dto.blocks.map((block) => block.type)).toEqual(["richText", "video", "richText"]);
    expect(dto.richTextHtml).toContain('src="/uploads/service-12.mp4"');
    expect(await prisma.detailPageContentMedia.count()).toBe(1);
    await prisma.$disconnect();
  });

  it("switches to rich text while preserving content and removing all banner relationships", async () => {
    const prisma = await createDatabase("switch-type");
    await createArtist(prisma);
    await createAsset(prisma, 10, "image");
    await createAsset(prisma, 11, "image");
    const html = "<h1>保留富文本</h1><p>保留富文本</p>";
    await prisma.$transaction((tx) =>
      upsertDetailPageConfig(tx, "artist", 1, {
        type: "banner_rich_text",
        heroSubtitle: "宣传语",
        bannerAssetIds: [10, 11],
        richTextHtml: html
      })
    );

    const dto = await prisma.$transaction((tx) =>
      upsertDetailPageConfig(tx, "artist", 1, { type: "rich_text", richTextHtml: html })
    );

    expect(dto).toMatchObject({ type: "rich_text", heroSubtitle: "", banners: [], richTextHtml: html });
    expect(await prisma.detailPageBannerMedia.count()).toBe(0);
    await prisma.$disconnect();
  });

  it("removes content-media relationships when their nodes are deleted", async () => {
    const prisma = await createDatabase("sync-content");
    await createArtist(prisma);
    await createAsset(prisma, 10, "image");
    await createAsset(prisma, 11, "image");
    await prisma.$transaction((tx) =>
      upsertDetailPageConfig(tx, "artist", 1, {
        type: "rich_text",
        richTextHtml: '<p>正文</p><img data-media-asset-id="10"><img data-media-asset-id="11">'
      })
    );
    await prisma.$transaction((tx) =>
      upsertDetailPageConfig(tx, "artist", 1, {
        type: "rich_text",
        richTextHtml: '<p>正文</p><img data-media-asset-id="11">'
      })
    );

    expect((await prisma.detailPageContentMedia.findMany()).map((item) => item.mediaAssetId)).toEqual([11]);
    await prisma.$disconnect();
  });

  it("keeps identical numeric owner IDs isolated by owner type", async () => {
    const prisma = await createDatabase("owner-isolation");
    const cover = await createAsset(prisma, 10, "image");
    await createArtist(prisma, 1);
    await createCase(prisma, cover.id, 1);
    await prisma.$transaction(async (tx) => {
      await upsertDetailPageConfig(tx, "artist", 1, { type: "rich_text", richTextHtml: "<p>人员内容</p>" });
      await upsertDetailPageConfig(tx, "activity_case", 1, { type: "rich_text", richTextHtml: "<p>案例内容</p>" });
    });

    expect((await getRequiredDetailPageConfig(prisma, "artist", 1)).richTextHtml).toContain("人员内容");
    expect((await getRequiredDetailPageConfig(prisma, "activity_case", 1)).richTextHtml).toContain("案例内容");
    await prisma.$disconnect();
  });

  it("validates owner existence and rejects unknown runtime owner types", async () => {
    const prisma = await createDatabase("owner-validation");
    await expect(validateDetailPageOwner(prisma, "artist", 999)).rejects.toMatchObject({ code: "DETAIL_PAGE_OWNER_NOT_FOUND" });
    await expect(validateDetailPageOwner(prisma, "unknown" as "artist", 1)).rejects.toMatchObject({ code: "UNKNOWN_DETAIL_OWNER_TYPE" });
    await prisma.$disconnect();
  });

  it("does not persist preview output", async () => {
    const prisma = await createDatabase("preview");
    await createAsset(prisma, 10, "image");
    const dto = await previewDetailPageConfig(prisma, {
      name: "预览详情",
      type: "banner_rich_text",
      hero: {
        title: "预览标题",
        typeLabel: "",
        badge: "",
        tags: [],
        location: "",
        metaItems: []
      },
      bannerAssetIds: [10],
      richTextHtml: "<p>未保存内容</p>"
    });
    expect(dto.banners[0]).toMatchObject({ assetId: 10, url: "/uploads/service-10.png" });
    expect(dto.hero).toMatchObject({ typeLabel: "", subtitle: "" });
    expect(await prisma.detailPageConfig.count()).toBe(0);
    await prisma.$disconnect();
  });

  it("uses the caller transaction so a later failure rolls back all changes", async () => {
    const prisma = await createDatabase("rollback");
    await createArtist(prisma);
    await expect(
      prisma.$transaction(async (tx) => {
        await upsertDetailPageConfig(tx, "artist", 1, { type: "rich_text", richTextHtml: "<p>事务内容</p>" });
        throw new Error("force rollback");
      })
    ).rejects.toThrow("force rollback");
    expect(await getDetailPageConfig(prisma, "artist", 1)).toBeNull();
    await prisma.$disconnect();
  });

  it("returns controlled errors for missing configs and unknown stored page types", async () => {
    const prisma = await createDatabase("controlled-errors");
    await createArtist(prisma);
    await expect(getRequiredDetailPageConfig(prisma, "artist", 1)).rejects.toMatchObject({
      code: "DETAIL_PAGE_CONFIG_NOT_FOUND"
    });
    await prisma.detailPageConfig.create({
      data: { name: "未知类型详情", ownerType: "artist", ownerId: 1, pageType: "future_type", richTextHtml: "<p>内容</p>" }
    });
    await expect(getRequiredDetailPageConfig(prisma, "artist", 1)).rejects.toMatchObject({
      code: "UNKNOWN_DETAIL_PAGE_TYPE"
    });
    await prisma.$disconnect();
  });

  it("deletes one owner config without affecting another owner type", async () => {
    const prisma = await createDatabase("delete");
    const cover = await createAsset(prisma, 10, "image");
    await createArtist(prisma, 1);
    await createCase(prisma, cover.id, 1);
    await prisma.$transaction(async (tx) => {
      await upsertDetailPageConfig(tx, "artist", 1, { type: "rich_text", richTextHtml: "<p>人员</p>" });
      await upsertDetailPageConfig(tx, "activity_case", 1, { type: "rich_text", richTextHtml: "<p>案例</p>" });
      await deleteDetailPageConfig(tx, "artist", 1);
    });
    expect(await getDetailPageConfig(prisma, "artist", 1)).toBeNull();
    expect(await getDetailPageConfig(prisma, "activity_case", 1)).not.toBeNull();
    await prisma.$disconnect();
  });

  it("exposes domain error metadata to route handlers", () => {
    expect(new DetailPageDomainError("TEST", "错误", 409)).toMatchObject({ code: "TEST", statusCode: 409 });
  });
});
