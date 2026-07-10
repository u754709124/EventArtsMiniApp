import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { createPrismaClient } from "../src/db";
import { ensureDatabaseSchema } from "../src/sqlite-schema";
import { tinyMp4Buffer } from "./fixtures";

const root = path.join(process.cwd(), ".tmp/media-migration-tests");

async function createLegacyDatabase(name: string) {
  const runtime = path.join(root, name);
  const uploadDir = path.join(runtime, "uploads");
  await mkdir(uploadDir, { recursive: true });
  const prisma = createPrismaClient(`file:${path.join(runtime, "legacy.db")}`);
  await prisma.$executeRawUnsafe(`CREATE TABLE media_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    originalName TEXT NOT NULL,
    filename TEXT NOT NULL UNIQUE,
    mimeType TEXT NOT NULL,
    mediaType TEXT NOT NULL,
    usage TEXT NOT NULL,
    url TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    size INTEGER NOT NULL,
    storageType TEXT NOT NULL DEFAULT 'local',
    createdBy INTEGER,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  return { prisma, uploadDir };
}

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("legacy media migration", () => {
  it("backfills real metadata, disambiguates names and merges duplicate content", async () => {
    const { prisma, uploadDir } = await createLegacyDatabase("backfill");
    const duplicate = await sharp({ create: { width: 20, height: 10, channels: 4, background: "red" } }).png().toBuffer();
    const unique = await sharp({ create: { width: 30, height: 15, channels: 4, background: "blue" } }).png().toBuffer();
    await writeFile(path.join(uploadDir, "one.png"), duplicate);
    await writeFile(path.join(uploadDir, "two.png"), duplicate);
    await writeFile(path.join(uploadDir, "three.png"), unique);
    for (const [id, filename] of [[1, "one.png"], [2, "two.png"], [3, "three.png"]] as const) {
      await prisma.$executeRawUnsafe(
        "INSERT INTO media_assets (id, originalName, filename, mimeType, mediaType, usage, url, width, height, size, storageType) VALUES (?, ?, ?, 'image/png', 'image', 'banner', ?, 1, 1, 1, 'local')",
        id,
        "同名.png",
        filename,
        `http://127.0.0.1:3001/uploads/${filename}`
      );
    }

    await ensureDatabaseSchema(prisma, { uploadDir });

    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      "SELECT id, resourceName, resourceNameKey, md5, width, height, size FROM media_assets ORDER BY id"
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: 1, resourceName: "同名.png", width: 20, height: 10, size: duplicate.length });
    expect(rows[1]).toMatchObject({ id: 3, resourceName: "同名.png (3)", width: 30, height: 15, size: unique.length });
    expect(rows[0].md5).toMatch(/^[a-f\d]{32}$/);
    expect(rows[0].resourceNameKey).not.toBe(rows[1].resourceNameKey);
    await prisma.$disconnect();
  });

  it("aborts without schema writes when a legacy file is missing", async () => {
    const { prisma, uploadDir } = await createLegacyDatabase("missing-file");
    await prisma.$executeRawUnsafe(
      "INSERT INTO media_assets (originalName, filename, mimeType, mediaType, usage, url, size, storageType) VALUES ('missing.png', 'missing.png', 'image/png', 'image', 'banner', 'http://127.0.0.1:3001/uploads/missing.png', 1, 'local')"
    );

    await expect(ensureDatabaseSchema(prisma, { uploadDir })).rejects.toThrow(/missing\.png/);
    const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>("PRAGMA table_info(media_assets)");
    expect(columns.map((column) => column.name)).not.toContain("resourceName");
    await prisma.$disconnect();
  });

  it("aborts without media schema writes when legacy case media JSON is non-empty", async () => {
    const { prisma, uploadDir } = await createLegacyDatabase("legacy-case-media");
    await prisma.$executeRawUnsafe("CREATE TABLE activity_cases (id INTEGER PRIMARY KEY, mediaJson TEXT NOT NULL)");
    await prisma.$executeRawUnsafe("INSERT INTO activity_cases (id, mediaJson) VALUES (7, '[{\"url\":\"unknown\"}]')");

    await expect(ensureDatabaseSchema(prisma, { uploadDir })).rejects.toThrow(/案例 ID: 7/);
    const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>("PRAGMA table_info(media_assets)");
    expect(columns.map((column) => column.name)).not.toContain("resourceName");
    await prisma.$disconnect();
  });

  it("re-probes legacy video dimensions instead of trusting stored metadata", async () => {
    const { prisma, uploadDir } = await createLegacyDatabase("video-metadata");
    const video = tinyMp4Buffer();
    await writeFile(path.join(uploadDir, "legacy.mp4"), video);
    await prisma.$executeRawUnsafe(
      "INSERT INTO media_assets (originalName, filename, mimeType, mediaType, usage, url, width, height, size, storageType) VALUES ('legacy.mp4', 'legacy.mp4', 'video/mp4', 'video', 'video', '/uploads/legacy.mp4', 1, 1, 1, 'local')"
    );

    await ensureDatabaseSchema(prisma, { uploadDir });

    const rows = await prisma.$queryRawUnsafe<Array<{ width: number; height: number; size: number }>>(
      "SELECT width, height, size FROM media_assets"
    );
    expect(rows).toEqual([{ width: 16, height: 8, size: video.length }]);
    await prisma.$disconnect();
  });

  it("adds artist location and badge to an existing SQLite table without losing rows and remains idempotent", async () => {
    const runtime = path.join(root, "artist-columns");
    await mkdir(runtime, { recursive: true });
    const prisma = createPrismaClient(`file:${path.join(runtime, "legacy.db")}`);
    await prisma.$executeRawUnsafe("CREATE TABLE media_assets (id INTEGER PRIMARY KEY, resourceName TEXT)");
    await prisma.$executeRawUnsafe("INSERT INTO media_assets (id, resourceName) VALUES (7, 'old-cover.png')");
    await prisma.$executeRawUnsafe(`CREATE TABLE artists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      avatarAssetId INTEGER,
      summary TEXT NOT NULL,
      tagsJson TEXT NOT NULL,
      detail TEXT NOT NULL,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'enabled',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await prisma.$executeRawUnsafe(
      "INSERT INTO artists (name, type, avatarAssetId, summary, tagsJson, detail, sortOrder, status) VALUES ('旧主持人', 'host', 7, '旧简介', '[]', '旧详情', 4, 'enabled')"
    );

    await ensureDatabaseSchema(prisma, { uploadDir: path.join(runtime, "uploads") });
    await ensureDatabaseSchema(prisma, { uploadDir: path.join(runtime, "uploads") });

    const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>("PRAGMA table_info(artists)");
    const rows = await prisma.$queryRawUnsafe<Array<{ name: string; avatarAssetId: number; location: string; badge: string; sortOrder: number }>>(
      "SELECT name, avatarAssetId, location, badge, sortOrder FROM artists"
    );
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(["location", "badge"]));
    expect(rows).toEqual([{ name: "旧主持人", avatarAssetId: 7, location: "", badge: "", sortOrder: 4 }]);
    await prisma.$disconnect();
  });
});
