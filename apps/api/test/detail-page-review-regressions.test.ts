import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createPrismaClient, type AppPrismaClient } from "../src/db";
import { mediaReferenceCount } from "../src/media";
import { hashPassword } from "../src/security";
import { ensureDatabaseSchema } from "../src/sqlite-schema";

const root = path.join(process.cwd(), ".tmp/detail-page-review-regressions");
const databasePath = path.join(root, "review.db");
const uploadDir = path.join(root, "uploads");

let prisma: AppPrismaClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let assetSequence = 0;

async function resetDatabase() {
  await prisma.detailPageConfig.deleteMany();
  await prisma.activityCaseMedia.deleteMany();
  await prisma.operationLog.deleteMany();
  await prisma.activityCase.deleteMany();
  await prisma.artist.deleteMany();
  await prisma.mediaAsset.deleteMany();
  await prisma.adminUser.deleteMany();
  await prisma.adminUser.create({
    data: {
      username: "admin",
      passwordHash: hashPassword("admin123456", "detail-review-admin")
    }
  });
  assetSequence = 0;
}

async function token() {
  const response = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: { username: "admin", password: "admin123456" }
  });
  expect(response.statusCode).toBe(200);
  return response.json().data.token as string;
}

async function createAsset(
  name: string,
  mediaType: "image" | "video" = "image",
  dimensions?: { width: number; height: number }
) {
  assetSequence += 1;
  const extension = mediaType === "image" ? "png" : "mp4";
  const filename = `review-${assetSequence}.${extension}`;
  await writeFile(path.join(uploadDir, filename), Buffer.from(`review-asset-${assetSequence}`));
  return prisma.mediaAsset.create({
    data: {
      resourceName: name,
      resourceNameKey: name.toLocaleLowerCase("zh-CN"),
      originalName: filename,
      filename,
      md5: (9000 + assetSequence).toString(16).padStart(32, "0"),
      mimeType: mediaType === "image" ? "image/png" : "video/mp4",
      mediaType,
      url: `/uploads/${filename}`,
      width: dimensions?.width ?? (mediaType === "image" ? 1500 : 1920),
      height: dimensions?.height ?? (mediaType === "image" ? 760 : 1080),
      size: 32
    }
  });
}

function artistPayload(avatarAssetId: number, contentAssetId: number) {
  return {
    name: "审查回归人员",
    type: "host",
    avatarAssetId,
    location: "杭州",
    badge: "主持人",
    tags: ["回归测试"],
    summary: "人员详情引用回归",
    sortOrder: 1,
    status: "enabled",
    detailPage: {
      type: "rich_text",
      richTextHtml: `<p>人员正文</p><img data-media-asset-id="${contentAssetId}">`
    }
  };
}

function casePayload(coverAssetId: number, contentAssetId: number) {
  return {
    title: "审查回归案例",
    category: "发布会",
    tag: "回归测试",
    coverAssetId,
    summary: "案例详情引用回归",
    eventDate: "2026-07-11T00:00:00.000Z",
    location: "杭州",
    isFeatured: true,
    featuredSortOrder: 1,
    sortOrder: 1,
    status: "enabled",
    detailPage: {
      type: "rich_text",
      richTextHtml: `<p>案例正文</p><img data-media-asset-id="${contentAssetId}">`
    }
  };
}

beforeAll(async () => {
  await rm(root, { recursive: true, force: true });
  await mkdir(uploadDir, { recursive: true });
  prisma = createPrismaClient(`file:${databasePath}`);
  await ensureDatabaseSchema(prisma, { uploadDir });
  app = await buildApp({
    prisma,
    jwtSecret: "detail-review-secret",
    uploadDir,
    publicBaseUrl: "http://127.0.0.1:3001"
  });
});

beforeEach(resetDatabase);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  await rm(root, { recursive: true, force: true });
});

describe("detail page review regressions", () => {
  it("returns stable Chinese 404 envelopes when deleting missing owners", async () => {
    const auth = await token();
    const headers = { authorization: `Bearer ${auth}` };

    const artist = await app.inject({ method: "DELETE", url: "/api/admin/artists/99999", headers });
    const activityCase = await app.inject({ method: "DELETE", url: "/api/admin/cases/99999", headers });

    expect(artist.statusCode).toBe(404);
    expect(artist.json()).toEqual({
      success: false,
      error: { code: "NOT_FOUND", message: "人员不存在" }
    });
    expect(activityCase.statusCode).toBe(404);
    expect(activityCase.json()).toEqual({
      success: false,
      error: { code: "NOT_FOUND", message: "案例不存在" }
    });
  });

  it("updates case detail content relations without leaving the replaced asset referenced", async () => {
    const auth = await token();
    const headers = { authorization: `Bearer ${auth}` };
    const cover = await createAsset("案例封面", "image", { width: 460, height: 320 });
    const first = await createAsset("案例旧正文图");
    const second = await createAsset("案例新正文图");
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/cases",
      headers,
      payload: casePayload(cover.id, first.id)
    });
    expect(created.statusCode).toBe(200);

    const updated = await app.inject({
      method: "PUT",
      url: `/api/admin/cases/${created.json().data.id}`,
      headers,
      payload: {
        detailPage: {
          type: "rich_text",
          richTextHtml: `<p>更新正文</p><img data-media-asset-id="${second.id}">`
        }
      }
    });

    expect(updated.statusCode).toBe(200);
    expect(await mediaReferenceCount(prisma, first.id)).toBe(0);
    expect(await mediaReferenceCount(prisma, second.id)).toBe(1);
  });

  it("protects detail media from unused scan and batch delete until artist deletion releases it", async () => {
    const auth = await token();
    const headers = { authorization: `Bearer ${auth}` };
    const avatar = await createAsset("人员封面");
    const content = await createAsset("人员正文图");
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/artists",
      headers,
      payload: artistPayload(avatar.id, content.id)
    });
    expect(created.statusCode).toBe(200);

    const usedScan = await app.inject({ method: "POST", url: "/api/admin/media-assets/scan-unused", headers });
    expect(usedScan.json().data.items.map((item: { id: number }) => item.id)).not.toContain(content.id);
    const protectedBatch = await app.inject({
      method: "POST",
      url: "/api/admin/media-assets/batch-delete",
      headers,
      payload: { ids: [content.id] }
    });
    expect(protectedBatch.json().data).toMatchObject({
      deletedIds: [],
      skipped: [{ id: content.id, reason: "MEDIA_IN_USE" }]
    });

    const deletedArtist = await app.inject({
      method: "DELETE",
      url: `/api/admin/artists/${created.json().data.id}`,
      headers
    });
    expect(deletedArtist.statusCode).toBe(200);
    expect(await prisma.detailPageConfig.count({
      where: { ownerType: "artist", ownerId: created.json().data.id }
    })).toBe(0);
    expect(await mediaReferenceCount(prisma, content.id)).toBe(0);

    const unusedScan = await app.inject({ method: "POST", url: "/api/admin/media-assets/scan-unused", headers });
    expect(unusedScan.json().data.items.map((item: { id: number }) => item.id)).toContain(content.id);
    const deletedBatch = await app.inject({
      method: "POST",
      url: "/api/admin/media-assets/batch-delete",
      headers,
      payload: { ids: [content.id] }
    });
    expect(deletedBatch.json().data.deletedIds).toEqual([content.id]);
    expect(await prisma.mediaAsset.findUnique({ where: { id: content.id } })).toBeNull();
  });

  it("keeps client lists summary-only while detail endpoints require detailPage", async () => {
    const auth = await token();
    const headers = { authorization: `Bearer ${auth}` };
    const cover = await createAsset("列表案例封面", "image", { width: 460, height: 320 });
    const content = await createAsset("列表案例正文图");
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/cases",
      headers,
      payload: casePayload(cover.id, content.id)
    });
    const id = created.json().data.id;

    const list = await app.inject({ method: "GET", url: "/api/client/cases" });
    const home = await app.inject({ method: "GET", url: "/api/client/home" });
    const detail = await app.inject({ method: "GET", url: `/api/client/cases/${id}` });

    expect(list.json().data.find((item: { id: number }) => item.id === id)).not.toHaveProperty("detailPage");
    expect(home.json().data.featuredCases.find((item: { id: number }) => item.id === id)).not.toHaveProperty("detailPage");
    expect(detail.json().data.detailPage).toMatchObject({ type: "rich_text" });
  });
});
