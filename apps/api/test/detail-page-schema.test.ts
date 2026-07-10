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
      "ownerType",
      "ownerId",
      "pageType",
      "heroSubtitle",
      "richTextHtml",
      "schemaVersion",
      "createdAt",
      "updatedAt"
    ]);
    expect(configColumns.find((column) => column.name === "heroSubtitle")?.dflt_value).toContain("");
    expect(configColumns.find((column) => column.name === "schemaVersion")?.dflt_value).toBe("1");

    const indexes = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name LIKE 'detail_page_%' ORDER BY name"
    );
    expect(indexes.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "detail_page_configs_ownerType_idx",
        "detail_page_configs_ownerType_ownerId_key",
        "detail_page_banner_media_detailPageConfigId_sortOrder_idx",
        "detail_page_banner_media_mediaAssetId_idx",
        "detail_page_content_media_mediaAssetId_idx"
      ])
    );

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
});
