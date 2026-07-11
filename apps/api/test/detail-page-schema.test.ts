import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../src/db";
import { ensureDatabaseSchema } from "../src/sqlite-schema";

const root = path.join(process.cwd(), ".tmp/detail-page-schema-tests");

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("detail page SQLite schema", () => {
  it("creates the common detail tables, constraints and migration ledger idempotently", async () => {
    await mkdir(root, { recursive: true });
    const prisma = createPrismaClient(`file:${path.join(root, "new.db")}`);

    await ensureDatabaseSchema(prisma, { uploadDir: path.join(root, "uploads") });
    await ensureDatabaseSchema(prisma, { uploadDir: path.join(root, "uploads") });

    const tables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    );
    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "schema_migrations",
        "detail_page_configs",
        "detail_page_banner_media",
        "detail_page_content_media"
      ])
    );

    const configColumns = await prisma.$queryRawUnsafe<Array<{ name: string; notnull: number; dflt_value: string | null }>>(
      "PRAGMA table_info(detail_page_configs)"
    );
    expect(configColumns.map((column) => column.name)).toEqual([
      "id",
      "name",
      "ownerType",
      "ownerId",
      "pageType",
      "heroTitle",
      "heroTypeLabel",
      "heroSubtitle",
      "heroBadge",
      "heroTagsJson",
      "heroLocation",
      "heroMetaJson",
      "richTextHtml",
      "schemaVersion",
      "createdAt",
      "updatedAt"
    ]);
    expect(Number(configColumns.find((column) => column.name === "name")?.notnull)).toBe(1);
    expect(Number(configColumns.find((column) => column.name === "ownerType")?.notnull)).toBe(0);
    expect(Number(configColumns.find((column) => column.name === "ownerId")?.notnull)).toBe(0);
    expect(configColumns.find((column) => column.name === "heroSubtitle")?.dflt_value).toContain("");
    expect(configColumns.find((column) => column.name === "schemaVersion")?.dflt_value).toBe("2");

    const indexes = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name LIKE 'detail_page_%' ORDER BY name"
    );
    expect(indexes.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "detail_page_configs_ownerType_idx",
        "detail_page_configs_ownerType_ownerId_key",
        "detail_page_configs_name_idx",
        "detail_page_configs_pageType_idx",
        "detail_page_banner_media_detailPageConfigId_sortOrder_idx",
        "detail_page_banner_media_mediaAssetId_idx",
        "detail_page_content_media_mediaAssetId_idx"
      ])
    );

    for (const table of ["announcements", "banners", "artists", "activity_cases"]) {
      const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info(${table})`);
      const foreignKeys = await prisma.$queryRawUnsafe<Array<{ table: string; from: string; on_delete: string }>>(
        `PRAGMA foreign_key_list(${table})`
      );
      expect(columns.map((column) => column.name)).toContain("detailPageId");
      expect(foreignKeys).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ table: "detail_page_configs", from: "detailPageId", on_delete: "RESTRICT" })
        ])
      );
    }

    const bannerForeignKeys = await prisma.$queryRawUnsafe<Array<{ table: string; on_delete: string }>>(
      "PRAGMA foreign_key_list(detail_page_banner_media)"
    );
    expect(bannerForeignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: "detail_page_configs", on_delete: "CASCADE" }),
        expect.objectContaining({ table: "media_assets", on_delete: "RESTRICT" })
      ])
    );

    await prisma.$disconnect();
  });

  it("backfills menu item showOnHome once and preserves existing false values", async () => {
    await mkdir(root, { recursive: true });
    const prisma = createPrismaClient(`file:${path.join(root, "legacy-menu.db")}`);
    await prisma.$executeRawUnsafe(`CREATE TABLE menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      iconAssetId INTEGER NOT NULL,
      type TEXT NOT NULL,
      configJson TEXT NOT NULL,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'enabled',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await prisma.$executeRawUnsafe(
      "INSERT INTO menu_items (text, iconAssetId, type, configJson, sortOrder, status) VALUES ('旧菜单', 1, 'host', '{}', 1, 'enabled')"
    );

    await ensureDatabaseSchema(prisma, { uploadDir: path.join(root, "uploads") });
    const backfilled = await prisma.$queryRawUnsafe<Array<{ showOnHome: boolean | number }>>(
      "SELECT showOnHome FROM menu_items WHERE text = '旧菜单'"
    );
    expect(Boolean(backfilled[0].showOnHome)).toBe(true);

    await prisma.$executeRawUnsafe("UPDATE menu_items SET showOnHome = false WHERE text = '旧菜单'");
    await ensureDatabaseSchema(prisma, { uploadDir: path.join(root, "uploads") });
    const preserved = await prisma.$queryRawUnsafe<Array<{ showOnHome: boolean | number }>>(
      "SELECT showOnHome FROM menu_items WHERE text = '旧菜单'"
    );
    expect(Boolean(preserved[0].showOnHome)).toBe(false);

    await prisma.$disconnect();
  });
});
