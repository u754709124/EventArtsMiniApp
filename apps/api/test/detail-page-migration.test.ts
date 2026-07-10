import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPrismaClient, type AppPrismaClient } from "../src/db";
import {
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
  return prisma;
}

async function createAsset(prisma: AppPrismaClient, id: number, mediaType: "image" | "video") {
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

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("legacy business detail migration", () => {
  it("converts artist plain text into safe paragraphs without changing the legacy field", async () => {
    const prisma = await createDatabase("artist-text");
    const artist = await prisma.artist.create({
      data: {
        name: "旧主持人",
        type: "host",
        location: "杭州",
        badge: "主持人",
        summary: "旧简介",
        tagsJson: "[]",
        detail: "第一段 <安全>\n第二段 & 内容",
        sortOrder: 1,
        status: "enabled"
      }
    });

    await runDetailPageMigration(prisma);

    const config = await prisma.detailPageConfig.findUniqueOrThrow({
      where: { ownerType_ownerId: { ownerType: "artist", ownerId: artist.id } }
    });
    expect(config).toMatchObject({ pageType: "rich_text", heroSubtitle: "", schemaVersion: 1 });
    expect(config.richTextHtml).toBe("<p>第一段 &lt;安全&gt;</p><p>第二段 &amp; 内容</p>");
    expect((await prisma.artist.findUniqueOrThrow({ where: { id: artist.id } })).detail).toBe(
      "第一段 <安全>\n第二段 & 内容"
    );
    expect(await auditDetailPageOrphans(prisma)).toEqual([]);
    await prisma.$disconnect();
  });

  it("migrates ordered case image and video nodes into HTML and unique content relations", async () => {
    const prisma = await createDatabase("case-media");
    const cover = await createAsset(prisma, 10, "image");
    const image = await createAsset(prisma, 11, "image");
    const video = await createAsset(prisma, 12, "video");
    const repeated = await createAsset(prisma, 13, "image");
    const activityCase = await prisma.activityCase.create({
      data: {
        title: "旧案例",
        category: "婚礼",
        tag: "现场",
        coverAssetId: cover.id,
        summary: "旧简介",
        eventDate: new Date("2024-05-18T00:00:00.000Z"),
        location: "杭州",
        detail: '<p>旧 HTML</p><img data-media-asset-id="13" src="/wrong.png">',
        legacyMediaJson: "[]",
        isFeatured: false,
        featuredSortOrder: 0,
        sortOrder: 1,
        status: "enabled",
        media: {
          create: [
            { mediaAssetId: image.id, sortOrder: 0 },
            { mediaAssetId: video.id, sortOrder: 1 },
            { mediaAssetId: repeated.id, sortOrder: 2 }
          ]
        }
      }
    });

    await runDetailPageMigration(prisma);

    const config = await prisma.detailPageConfig.findUniqueOrThrow({
      where: { ownerType_ownerId: { ownerType: "activity_case", ownerId: activityCase.id } },
      include: { contentMedia: { orderBy: { mediaAssetId: "asc" } } }
    });
    expect(config.contentMedia.map((item) => item.mediaAssetId)).toEqual([11, 12, 13]);
    expect(config.richTextHtml).toContain('<img src="/uploads/migration-13.png" data-media-asset-id="13"');
    expect(config.richTextHtml.match(/data-media-asset-id="13"/g)).toHaveLength(1);
    const imagePosition = config.richTextHtml.indexOf('data-media-asset-id="11"');
    const videoPosition = config.richTextHtml.indexOf('data-media-asset-id="12"');
    expect(imagePosition).toBeGreaterThan(config.richTextHtml.indexOf("旧 HTML"));
    expect(videoPosition).toBeGreaterThan(imagePosition);
    expect(await prisma.activityCaseMedia.count({ where: { activityCaseId: activityCase.id } })).toBe(0);
    expect((await prisma.activityCase.findUniqueOrThrow({ where: { id: activityCase.id } })).detail).toContain("旧 HTML");
    await prisma.$disconnect();
  });

  it("does not overwrite an existing config and remains idempotent without duplicate links", async () => {
    const prisma = await createDatabase("idempotent");
    const artist = await prisma.artist.create({
      data: {
        name: "已有配置",
        type: "singer",
        location: "上海",
        badge: "歌手",
        summary: "简介",
        tagsJson: "[]",
        detail: "旧内容",
        sortOrder: 1,
        status: "enabled"
      }
    });
    await prisma.detailPageConfig.create({
      data: {
        ownerType: "artist",
        ownerId: artist.id,
        pageType: "rich_text",
        richTextHtml: "<p>保留新内容</p>"
      }
    });

    await runDetailPageMigration(prisma);
    await runDetailPageMigration(prisma);

    expect(await prisma.detailPageConfig.count()).toBe(1);
    expect((await prisma.detailPageConfig.findFirstOrThrow()).richTextHtml).toBe("<p>保留新内容</p>");
    expect(
      await prisma.$queryRawUnsafe<Array<{ total: number }>>(
        "SELECT COUNT(*) AS total FROM schema_migrations WHERE id = ?",
        DETAIL_PAGE_MIGRATION_ID
      )
    ).toEqual([{ total: 1n }]);
    await prisma.$disconnect();
  });

  it("rolls back all configs and legacy media changes when a case has unsafe legacyMediaJson", async () => {
    const prisma = await createDatabase("rollback");
    await prisma.artist.create({
      data: {
        name: "应回滚人员",
        type: "actor",
        location: "宁波",
        badge: "演员",
        summary: "简介",
        tagsJson: "[]",
        detail: "人员详情",
        sortOrder: 1,
        status: "enabled"
      }
    });
    const cover = await createAsset(prisma, 20, "image");
    await prisma.activityCase.create({
      data: {
        title: "无法解释案例",
        category: "活动",
        tag: "异常",
        coverAssetId: cover.id,
        summary: "简介",
        eventDate: new Date(),
        location: "杭州",
        detail: "案例详情",
        legacyMediaJson: '[{"url":"unknown"}]',
        isFeatured: false,
        featuredSortOrder: 0,
        sortOrder: 1,
        status: "enabled"
      }
    });

    await expect(runDetailPageMigration(prisma)).rejects.toThrow(/activity_case.*无法解释案例|案例.*无法解释案例/);
    expect(await prisma.detailPageConfig.count()).toBe(0);
    expect(
      await prisma.$queryRawUnsafe<Array<{ total: number }>>(
        "SELECT COUNT(*) AS total FROM schema_migrations WHERE id = ?",
        DETAIL_PAGE_MIGRATION_ID
      )
    ).toEqual([{ total: 0n }]);
    await prisma.$disconnect();
  });
});
