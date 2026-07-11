import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPrismaClient, type AppPrismaClient } from "../src/db";
import {
  DETAIL_PAGE_H1_CARDS_MIGRATION_ID,
  DETAIL_PAGE_MIGRATION_ID,
  auditDetailPageOrphans,
  runDetailPageMigration
} from "../src/detail-pages/detail-page-migration";
import { ensureDatabaseSchema } from "../src/sqlite-schema";

const root = path.join(process.cwd(), ".tmp/detail-page-migration-tests");

async function createDatabase(name: string) {
  const runtime = path.join(root, name);
  await mkdir(runtime, { recursive: true });
  const prisma = createPrismaClient(`file:${path.join(runtime, "legacy.db")}`);
  await ensureDatabaseSchema(prisma, { uploadDir: path.join(runtime, "uploads") });
  await prisma.$executeRawUnsafe("DELETE FROM schema_migrations WHERE id = ?", DETAIL_PAGE_MIGRATION_ID);
  await prisma.$executeRawUnsafe("DELETE FROM schema_migrations WHERE id = ?", DETAIL_PAGE_H1_CARDS_MIGRATION_ID);
  return prisma;
}

async function createAsset(prisma: AppPrismaClient, id: number, mediaType: "image" | "video" = "image") {
  const extension = mediaType === "image" ? "png" : "mp4";
  return prisma.mediaAsset.create({
    data: {
      id,
      resourceName: `迁移资源-${id}`,
      resourceNameKey: `migration-${id}`,
      originalName: `migration-${id}.${extension}`,
      filename: `migration-${id}.${extension}`,
      md5: id.toString(16).padStart(32, "0"),
      mimeType: mediaType === "image" ? "image/png" : "video/mp4",
      mediaType,
      url: `/uploads/migration-${id}.${extension}`,
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
      name: `旧人员-${id}`,
      type: "host",
      location: "杭州",
      badge: "金牌主持",
      summary: "简介",
      tagsJson: '["婚礼主持"]',
      detail: "旧详情",
      sortOrder: id,
      status: "enabled"
    }
  });
}

async function createCase(prisma: AppPrismaClient, coverAssetId: number, id = 1) {
  return prisma.activityCase.create({
    data: {
      id,
      title: `旧案例-${id}`,
      category: "婚礼",
      tag: "户外",
      coverAssetId,
      summary: "简介",
      eventDate: new Date("2024-05-18T00:00:00.000Z"),
      location: "杭州",
      detail: "旧详情",
      legacyMediaJson: "[]",
      isFeatured: false,
      featuredSortOrder: 0,
      sortOrder: id,
      status: "enabled"
    }
  });
}

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("standalone detail-page migration", () => {
  it("backfills old owner configs into business detailPageId and self-contained hero fields", async () => {
    const prisma = await createDatabase("owner-backfill");
    const cover = await createAsset(prisma, 10);
    const artist = await createArtist(prisma, 1);
    const activityCase = await createCase(prisma, cover.id, 1);
    const artistConfig = await prisma.detailPageConfig.create({
      data: {
        name: "",
        ownerType: "artist",
        ownerId: artist.id,
        pageType: "rich_text",
        richTextHtml: "<p>人员旧详情</p>"
      }
    });
    const caseConfig = await prisma.detailPageConfig.create({
      data: {
        name: "",
        ownerType: "activity_case",
        ownerId: activityCase.id,
        pageType: "rich_text",
        richTextHtml: "<p>案例旧详情</p>"
      }
    });

    await runDetailPageMigration(prisma);

    expect((await prisma.artist.findUniqueOrThrow({ where: { id: artist.id } })).detailPageId).toBe(artistConfig.id);
    expect((await prisma.activityCase.findUniqueOrThrow({ where: { id: activityCase.id } })).detailPageId).toBe(caseConfig.id);
    expect(await prisma.detailPageConfig.findUniqueOrThrow({ where: { id: artistConfig.id } })).toMatchObject({
      name: "人员-旧人员-1-详情",
      heroTitle: "旧人员-1",
      heroTypeLabel: "主持人",
      heroBadge: "金牌主持",
      heroTagsJson: '["婚礼主持"]',
      heroLocation: "杭州"
    });
    expect(await prisma.detailPageConfig.findUniqueOrThrow({ where: { id: caseConfig.id } })).toMatchObject({
      name: "案例-旧案例-1-详情",
      heroTitle: "旧案例-1",
      heroTypeLabel: "婚礼",
      heroBadge: "户外",
      heroLocation: "杭州",
      heroMetaJson: '[{"label":"日期","value":"2024-05-18"}]'
    });
    await prisma.$disconnect();
  });

  it("preserves detail IDs, HTML and media relation rows while adding business references", async () => {
    const prisma = await createDatabase("preserve-relations");
    const cover = await createAsset(prisma, 20);
    const banner = await createAsset(prisma, 21);
    const content = await createAsset(prisma, 22);
    const activityCase = await createCase(prisma, cover.id, 2);
    const config = await prisma.detailPageConfig.create({
      data: {
        name: "保留关系详情",
        ownerType: "activity_case",
        ownerId: activityCase.id,
        pageType: "banner_rich_text",
        heroTitle: "已有标题",
        heroSubtitle: "已有宣传语",
        richTextHtml: `<p>保留 HTML</p><img data-media-asset-id="${content.id}" src="${content.url}">`,
        banners: { create: [{ mediaAssetId: banner.id, sortOrder: 3 }] },
        contentMedia: { create: [{ mediaAssetId: content.id }] }
      }
    });
    const beforeBanners = await prisma.detailPageBannerMedia.findMany({ orderBy: { id: "asc" } });
    const beforeContentAssetIds = (await prisma.detailPageContentMedia.findMany({ orderBy: { id: "asc" } })).map((item) => item.mediaAssetId);

    await runDetailPageMigration(prisma);
    await runDetailPageMigration(prisma);

    expect(await prisma.detailPageConfig.findUniqueOrThrow({ where: { id: config.id } })).toMatchObject({
      id: config.id,
      richTextHtml: `<h1>保留 HTML</h1><p>保留 HTML</p><img src="${content.url}" data-media-asset-id="${content.id}" alt="内容图片">`,
      heroTitle: "已有标题",
      heroSubtitle: "已有宣传语"
    });
    expect(await prisma.detailPageBannerMedia.findMany({ orderBy: { id: "asc" } })).toEqual(beforeBanners);
    expect((await prisma.detailPageContentMedia.findMany({ orderBy: { id: "asc" } })).map((item) => item.mediaAssetId)).toEqual(beforeContentAssetIds);
    expect((await prisma.activityCase.findUniqueOrThrow({ where: { id: activityCase.id } })).detailPageId).toBe(config.id);
    await prisma.$disconnect();
  });

  it("maps legacy banner links only when the target business object already has a detail page", async () => {
    const prisma = await createDatabase("banner-link-map");
    const cover = await createAsset(prisma, 30);
    const bannerAsset = await createAsset(prisma, 31);
    const mappedCase = await createCase(prisma, cover.id, 1);
    await createCase(prisma, cover.id, 2);
    const detail = await prisma.detailPageConfig.create({
      data: {
        name: "可映射案例详情",
        ownerType: "activity_case",
        ownerId: mappedCase.id,
        pageType: "rich_text",
        richTextHtml: "<p>可映射</p>"
      }
    });
    const mappedBanner = await prisma.banner.create({
      data: {
        title: "旧案例跳转",
        imageAssetId: bannerAsset.id,
        linkType: "case",
        linkTarget: String(mappedCase.id),
        switchDurationMs: 3000,
        sortOrder: 1,
        status: "enabled"
      }
    });
    const unmappedBanner = await prisma.banner.create({
      data: {
        title: "无法映射跳转",
        imageAssetId: bannerAsset.id,
        linkType: "case",
        linkTarget: "2",
        switchDurationMs: 3000,
        sortOrder: 2,
        status: "enabled"
      }
    });

    await runDetailPageMigration(prisma);

    expect((await prisma.banner.findUniqueOrThrow({ where: { id: mappedBanner.id } })).detailPageId).toBe(detail.id);
    expect((await prisma.banner.findUniqueOrThrow({ where: { id: unmappedBanner.id } })).detailPageId).toBeNull();
    await prisma.$disconnect();
  });

  it("records the migration exactly once and passes SQLite foreign-key validation", async () => {
    const prisma = await createDatabase("ledger-and-fk");
    await runDetailPageMigration(prisma);
    await runDetailPageMigration(prisma);

    expect(
      await prisma.$queryRawUnsafe<Array<{ total: number }>>(
        "SELECT COUNT(*) AS total FROM schema_migrations WHERE id = ?",
        DETAIL_PAGE_MIGRATION_ID
      )
    ).toEqual([{ total: 1n }]);
    expect(
      await prisma.$queryRawUnsafe<Array<{ total: number }>>(
        "SELECT COUNT(*) AS total FROM schema_migrations WHERE id = ?",
        DETAIL_PAGE_H1_CARDS_MIGRATION_ID
      )
    ).toEqual([{ total: 1n }]);
    expect(await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>("PRAGMA foreign_key_check")).toEqual([]);
    await prisma.$disconnect();
  });

  it("rewrites legacy rich text cards to schema version 2 and rebuilds content media transactionally", async () => {
    const prisma = await createDatabase("h1-cards-v2");
    const image = await createAsset(prisma, 60);
    const video = await createAsset(prisma, 61, "video");
    const detail = await prisma.detailPageConfig.create({
      data: {
        name: "旧模板详情",
        pageType: "rich_text",
        richTextHtml:
          `<section class="ea-detail-card"><h2 class="ea-section-title">项目介绍</h2><div class="ea-case-grid"><p>旧正文</p><img class="ea-review-image" data-media-asset-id="${image.id}"></div></section>` +
          `<section class="ea-detail-card"><div><video data-media-asset-id="${video.id}"></video><p>视频说明</p></div></section>`,
        contentMedia: { create: [{ mediaAssetId: image.id }] }
      }
    });

    await runDetailPageMigration(prisma);

    const migrated = await prisma.detailPageConfig.findUniqueOrThrow({
      where: { id: detail.id },
      include: { contentMedia: { orderBy: { mediaAssetId: "asc" } } }
    });
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.richTextHtml).toBe(
      `<h1>项目介绍</h1><p>旧正文</p><img src="${image.url}" data-media-asset-id="${image.id}" alt="内容图片">` +
      `<h1>视频说明</h1><video src="${video.url}" data-media-asset-id="${video.id}" controls="" preload="metadata"></video><p>视频说明</p>`
    );
    expect(migrated.contentMedia.map((item) => item.mediaAssetId)).toEqual([image.id, video.id]);
    await prisma.$disconnect();
  });

  it("migrates empty legacy rich text to a valid default H1 card", async () => {
    const prisma = await createDatabase("h1-cards-empty");
    const detail = await prisma.detailPageConfig.create({
      data: {
        name: "空旧详情",
        pageType: "rich_text",
        richTextHtml: ""
      }
    });

    await runDetailPageMigration(prisma);

    expect(await prisma.detailPageConfig.findUniqueOrThrow({ where: { id: detail.id } })).toMatchObject({
      schemaVersion: 2,
      richTextHtml: "<h1>内容</h1><p>内容</p>"
    });
    await prisma.$disconnect();
  });

  it("reports unknown owner types and missing owners in the orphan audit", async () => {
    const prisma = await createDatabase("orphan-audit");
    await prisma.detailPageConfig.createMany({
      data: [
        { name: "未知业务详情", ownerType: "future_owner", ownerId: 7, pageType: "rich_text", richTextHtml: "<p>未知业务</p>" },
        { name: "缺失人员详情", ownerType: "artist", ownerId: 999, pageType: "rich_text", richTextHtml: "<p>人员不存在</p>" }
      ]
    });

    expect(await auditDetailPageOrphans(prisma)).toEqual(expect.arrayContaining([
      expect.objectContaining({ ownerType: "future_owner", ownerId: 7, reason: "未知 ownerType" }),
      expect.objectContaining({ ownerType: "artist", ownerId: 999, reason: "业务对象不存在" })
    ]));
    await prisma.$disconnect();
  });

  it("enforces restrictive detailPageId foreign keys after backfill", async () => {
    const prisma = await createDatabase("restrict-delete");
    const artist = await createArtist(prisma, 1);
    const detail = await prisma.detailPageConfig.create({
      data: {
        name: "受保护详情",
        ownerType: "artist",
        ownerId: artist.id,
        pageType: "rich_text",
        richTextHtml: "<p>受保护</p>"
      }
    });

    await runDetailPageMigration(prisma);

    await expect(prisma.detailPageConfig.delete({ where: { id: detail.id } })).rejects.toMatchObject({ code: "P2003" });
    await prisma.artist.update({ where: { id: artist.id }, data: { detailPageId: null } });
    await expect(prisma.detailPageConfig.delete({ where: { id: detail.id } })).resolves.toMatchObject({ id: detail.id });
    await prisma.$disconnect();
  });
});
