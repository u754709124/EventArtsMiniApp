import type { AppPrismaClient } from "../db";
import { collectRichTextMediaAssetIds, extractRichTextMedia, normalizeDetailRichTextToH1Cards } from "./detail-page-sanitizer";

export const DETAIL_PAGE_MIGRATION_ID = "20260711_standalone_detail_pages_v1";
export const DETAIL_PAGE_H1_CARDS_MIGRATION_ID = "20260711_h1_detail_cards_v2";

type ColumnInfo = { name: string; notnull: number; dflt_value: string | null };
type RelationSnapshot = {
  detailCount: number;
  bannerRows: Array<{ id: number; detailPageConfigId: number; mediaAssetId: number; sortOrder: number }>;
  contentRows: Array<{ id: number; detailPageConfigId: number; mediaAssetId: number }>;
};

const targetDetailColumns = [
  ["name", "TEXT NOT NULL DEFAULT ''"],
  ["heroTitle", "TEXT NOT NULL DEFAULT ''"],
  ["heroTypeLabel", "TEXT NOT NULL DEFAULT ''"],
  ["heroBadge", "TEXT NOT NULL DEFAULT ''"],
  ["heroTagsJson", "TEXT NOT NULL DEFAULT '[]'"],
  ["heroLocation", "TEXT NOT NULL DEFAULT ''"],
  ["heroMetaJson", "TEXT NOT NULL DEFAULT '[]'"]
] as const;

async function tableExists(prisma: AppPrismaClient, table: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    table
  );
  return rows.length > 0;
}

async function columns(prisma: AppPrismaClient, table: string) {
  return prisma.$queryRawUnsafe<ColumnInfo[]>(`PRAGMA table_info(${table})`);
}

async function columnNames(prisma: AppPrismaClient, table: string) {
  return new Set((await columns(prisma, table)).map((column) => column.name));
}

async function hasMigrationId(prisma: AppPrismaClient, id: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    "SELECT id FROM schema_migrations WHERE id = ?",
    id
  );
  return rows.length > 0;
}

async function hasMigration(prisma: AppPrismaClient) {
  return hasMigrationId(prisma, DETAIL_PAGE_MIGRATION_ID);
}

async function hasTargetSchema(prisma: AppPrismaClient) {
  if (!(await tableExists(prisma, "detail_page_configs"))) return false;
  const detailColumns = await columns(prisma, "detail_page_configs");
  const detailNames = new Set(detailColumns.map((column) => column.name));
  const ownerType = detailColumns.find((column) => column.name === "ownerType");
  const ownerId = detailColumns.find((column) => column.name === "ownerId");
  if (!targetDetailColumns.every(([name]) => detailNames.has(name))) return false;
  if (ownerType?.notnull || ownerId?.notnull) return false;
  for (const table of ["announcements", "banners", "artists", "activity_cases"]) {
    if (!(await columnNames(prisma, table)).has("detailPageId")) return false;
  }
  if ((await tableExists(prisma, "articles")) && !(await columnNames(prisma, "articles")).has("detailPageId")) return false;
  return true;
}

async function snapshot(prisma: AppPrismaClient): Promise<RelationSnapshot> {
  const detailCount = await prisma.$queryRawUnsafe<Array<{ count: number | bigint }>>(
    "SELECT COUNT(*) AS count FROM detail_page_configs"
  );
  const bannerRows = await prisma.$queryRawUnsafe<RelationSnapshot["bannerRows"]>(
    "SELECT id, detailPageConfigId, mediaAssetId, sortOrder FROM detail_page_banner_media ORDER BY id"
  );
  const contentRows = await prisma.$queryRawUnsafe<RelationSnapshot["contentRows"]>(
    "SELECT id, detailPageConfigId, mediaAssetId FROM detail_page_content_media ORDER BY id"
  );
  return {
    detailCount: Number(detailCount[0]?.count ?? 0),
    bannerRows,
    contentRows
  };
}

function assertSameSnapshot(before: RelationSnapshot, after: RelationSnapshot) {
  if (before.detailCount !== after.detailCount) {
    throw new Error(`详情页数量不一致: ${before.detailCount} -> ${after.detailCount}`);
  }
  if (JSON.stringify(before.bannerRows) !== JSON.stringify(after.bannerRows)) {
    throw new Error("详情页 BANNER 媒体关系或顺序在迁移中发生变化");
  }
  if (JSON.stringify(before.contentRows) !== JSON.stringify(after.contentRows)) {
    throw new Error("详情页富文本媒体关系在迁移中发生变化");
  }
}

async function addColumnIfMissing(prisma: AppPrismaClient, table: string, name: string, definition: string) {
  const names = await columnNames(prisma, table);
  if (!names.has(name)) {
    await prisma.$executeRawUnsafe(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

async function ensureDetailColumns(prisma: AppPrismaClient) {
  for (const [name, definition] of targetDetailColumns) {
    await addColumnIfMissing(prisma, "detail_page_configs", name, definition);
  }
}

async function backfillDetailIdentity(prisma: AppPrismaClient) {
  await prisma.$executeRawUnsafe(`
    UPDATE detail_page_configs
       SET name = COALESCE(NULLIF(TRIM(name), ''), (
             CASE
               WHEN ownerType = 'artist' THEN COALESCE((SELECT '人员-' || artists.name || '-详情' FROM artists WHERE artists.id = ownerId), '详情页-' || id)
               WHEN ownerType = 'activity_case' THEN COALESCE((SELECT '案例-' || activity_cases.title || '-详情' FROM activity_cases WHERE activity_cases.id = ownerId), '详情页-' || id)
               ELSE '详情页-' || id
             END
           )),
           heroTitle = COALESCE(NULLIF(TRIM(heroTitle), ''), (
             CASE
               WHEN ownerType = 'artist' THEN COALESCE((SELECT artists.name FROM artists WHERE artists.id = ownerId), '')
               WHEN ownerType = 'activity_case' THEN COALESCE((SELECT activity_cases.title FROM activity_cases WHERE activity_cases.id = ownerId), '')
               ELSE ''
             END
           )),
           heroTypeLabel = COALESCE(NULLIF(TRIM(heroTypeLabel), ''), (
             CASE
               WHEN ownerType = 'artist' THEN COALESCE((
                 SELECT CASE artists.type
                   WHEN 'host' THEN '主持人'
                   WHEN 'singer' THEN '歌手'
                   WHEN 'actor' THEN '演员'
                   ELSE artists.type
                 END
                 FROM artists WHERE artists.id = ownerId
               ), '')
               WHEN ownerType = 'activity_case' THEN COALESCE((SELECT NULLIF(activity_cases.category, '') FROM activity_cases WHERE activity_cases.id = ownerId), '')
               ELSE ''
             END
           )),
           heroBadge = COALESCE(NULLIF(TRIM(heroBadge), ''), (
             CASE
               WHEN ownerType = 'artist' THEN COALESCE((SELECT artists.badge FROM artists WHERE artists.id = ownerId), '')
               WHEN ownerType = 'activity_case' THEN COALESCE((SELECT activity_cases.tag FROM activity_cases WHERE activity_cases.id = ownerId), '')
               ELSE ''
             END
           )),
           heroTagsJson = CASE
             WHEN ownerType = 'artist' AND (heroTagsJson IS NULL OR TRIM(heroTagsJson) = '' OR TRIM(heroTagsJson) = '[]')
             THEN COALESCE((SELECT artists.tagsJson FROM artists WHERE artists.id = ownerId), '[]')
             ELSE COALESCE(NULLIF(TRIM(heroTagsJson), ''), '[]')
           END,
           heroLocation = COALESCE(NULLIF(TRIM(heroLocation), ''), (
             CASE
               WHEN ownerType = 'artist' THEN COALESCE((SELECT artists.location FROM artists WHERE artists.id = ownerId), '')
               WHEN ownerType = 'activity_case' THEN COALESCE((SELECT activity_cases.location FROM activity_cases WHERE activity_cases.id = ownerId), '')
               ELSE ''
             END
           )),
           heroMetaJson = CASE
             WHEN ownerType = 'activity_case' AND (heroMetaJson IS NULL OR TRIM(heroMetaJson) = '' OR TRIM(heroMetaJson) = '[]')
             THEN COALESCE((
               SELECT '[{"label":"日期","value":"' ||
                      COALESCE(
                        CASE
                          WHEN typeof(activity_cases.eventDate) IN ('integer', 'real')
                          THEN date(
                            CASE
                              WHEN ABS(activity_cases.eventDate) > 9999999999
                              THEN activity_cases.eventDate / 1000
                              ELSE activity_cases.eventDate
                            END,
                            'unixepoch'
                          )
                          WHEN CAST(activity_cases.eventDate AS TEXT) GLOB '[0-9]*'
                          THEN date(
                            CASE
                              WHEN LENGTH(CAST(activity_cases.eventDate AS TEXT)) > 10
                              THEN CAST(activity_cases.eventDate AS INTEGER) / 1000
                              ELSE CAST(activity_cases.eventDate AS INTEGER)
                            END,
                            'unixepoch'
                          )
                          ELSE substr(activity_cases.eventDate, 1, 10)
                        END,
                        substr(activity_cases.eventDate, 1, 10)
                      ) || '"}]'
                 FROM activity_cases
                WHERE activity_cases.id = ownerId
             ), '[]')
             ELSE COALESCE(NULLIF(TRIM(heroMetaJson), ''), '[]')
           END
  `);
}

async function rebuildDetailTablesIfNeeded(prisma: AppPrismaClient) {
  const detailColumns = await columns(prisma, "detail_page_configs");
  const ownerType = detailColumns.find((column) => column.name === "ownerType");
  const ownerId = detailColumns.find((column) => column.name === "ownerId");
  if (!ownerType?.notnull && !ownerId?.notnull) return;

  await prisma.$executeRawUnsafe("ALTER TABLE detail_page_banner_media RENAME TO detail_page_banner_media_old");
  await prisma.$executeRawUnsafe("ALTER TABLE detail_page_content_media RENAME TO detail_page_content_media_old");
  await prisma.$executeRawUnsafe("ALTER TABLE detail_page_configs RENAME TO detail_page_configs_old");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE detail_page_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      ownerType TEXT,
      ownerId INTEGER,
      pageType TEXT NOT NULL,
      heroTitle TEXT NOT NULL DEFAULT '',
      heroTypeLabel TEXT NOT NULL DEFAULT '',
      heroSubtitle TEXT NOT NULL DEFAULT '',
      heroBadge TEXT NOT NULL DEFAULT '',
      heroTagsJson TEXT NOT NULL DEFAULT '[]',
      heroLocation TEXT NOT NULL DEFAULT '',
      heroMetaJson TEXT NOT NULL DEFAULT '[]',
      richTextHtml TEXT NOT NULL DEFAULT '',
      schemaVersion INTEGER NOT NULL DEFAULT 2,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(ownerType, ownerId)
    )
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO detail_page_configs (
      id, name, ownerType, ownerId, pageType, heroTitle, heroTypeLabel, heroSubtitle,
      heroBadge, heroTagsJson, heroLocation, heroMetaJson, richTextHtml, schemaVersion, createdAt, updatedAt
    )
    SELECT id, name, ownerType, ownerId, pageType, heroTitle, heroTypeLabel, heroSubtitle,
           heroBadge, heroTagsJson, heroLocation, heroMetaJson, richTextHtml, schemaVersion, createdAt, updatedAt
      FROM detail_page_configs_old
     ORDER BY id
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE detail_page_banner_media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      detailPageConfigId INTEGER NOT NULL,
      mediaAssetId INTEGER NOT NULL,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(detailPageConfigId) REFERENCES detail_page_configs(id) ON DELETE CASCADE,
      FOREIGN KEY(mediaAssetId) REFERENCES media_assets(id) ON DELETE RESTRICT,
      UNIQUE(detailPageConfigId, mediaAssetId)
    )
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO detail_page_banner_media (id, detailPageConfigId, mediaAssetId, sortOrder)
    SELECT id, detailPageConfigId, mediaAssetId, sortOrder
      FROM detail_page_banner_media_old
     ORDER BY id
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE detail_page_content_media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      detailPageConfigId INTEGER NOT NULL,
      mediaAssetId INTEGER NOT NULL,
      FOREIGN KEY(detailPageConfigId) REFERENCES detail_page_configs(id) ON DELETE CASCADE,
      FOREIGN KEY(mediaAssetId) REFERENCES media_assets(id) ON DELETE RESTRICT,
      UNIQUE(detailPageConfigId, mediaAssetId)
    )
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO detail_page_content_media (id, detailPageConfigId, mediaAssetId)
    SELECT id, detailPageConfigId, mediaAssetId
      FROM detail_page_content_media_old
     ORDER BY id
  `);

  await prisma.$executeRawUnsafe("DROP TABLE detail_page_banner_media_old");
  await prisma.$executeRawUnsafe("DROP TABLE detail_page_content_media_old");
  await prisma.$executeRawUnsafe("DROP TABLE detail_page_configs_old");
}

async function ensureDetailIndexes(prisma: AppPrismaClient) {
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS detail_page_configs_ownerType_ownerId_key
      ON detail_page_configs(ownerType, ownerId)
  `);
  await prisma.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS detail_page_configs_ownerType_idx ON detail_page_configs(ownerType)");
  await prisma.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS detail_page_configs_name_idx ON detail_page_configs(name)");
  await prisma.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS detail_page_configs_pageType_idx ON detail_page_configs(pageType)");
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS detail_page_banner_media_detailPageConfigId_mediaAssetId_key
      ON detail_page_banner_media(detailPageConfigId, mediaAssetId)
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS detail_page_banner_media_detailPageConfigId_sortOrder_idx
      ON detail_page_banner_media(detailPageConfigId, sortOrder)
  `);
  await prisma.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS detail_page_banner_media_mediaAssetId_idx ON detail_page_banner_media(mediaAssetId)");
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS detail_page_content_media_detailPageConfigId_mediaAssetId_key
      ON detail_page_content_media(detailPageConfigId, mediaAssetId)
  `);
  await prisma.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS detail_page_content_media_mediaAssetId_idx ON detail_page_content_media(mediaAssetId)");
}

async function ensureBusinessDetailColumns(prisma: AppPrismaClient) {
  await addColumnIfMissing(prisma, "announcements", "detailPageId", "INTEGER REFERENCES detail_page_configs(id) ON DELETE RESTRICT");
  await addColumnIfMissing(prisma, "banners", "detailPageId", "INTEGER REFERENCES detail_page_configs(id) ON DELETE RESTRICT");
  await addColumnIfMissing(prisma, "artists", "detailPageId", "INTEGER REFERENCES detail_page_configs(id) ON DELETE RESTRICT");
  await addColumnIfMissing(prisma, "activity_cases", "detailPageId", "INTEGER REFERENCES detail_page_configs(id) ON DELETE RESTRICT");
  if (await tableExists(prisma, "articles")) {
    await addColumnIfMissing(prisma, "articles", "detailPageId", "INTEGER REFERENCES detail_page_configs(id) ON DELETE RESTRICT");
  }
  await prisma.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS announcements_detailPageId_idx ON announcements(detailPageId)");
  await prisma.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS banners_detailPageId_idx ON banners(detailPageId)");
  await prisma.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS artists_detailPageId_idx ON artists(detailPageId)");
  await prisma.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS activity_cases_detailPageId_idx ON activity_cases(detailPageId)");
  if (await tableExists(prisma, "articles")) {
    await prisma.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS articles_detailPageId_idx ON articles(detailPageId)");
  }
  if (await tableExists(prisma, "recent_activities")) {
    await prisma.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS recent_activities_detailPageId_idx ON recent_activities(detailPageId)");
  }
}

async function backfillBusinessReferences(prisma: AppPrismaClient) {
  await prisma.$executeRawUnsafe(`
    UPDATE artists
       SET detailPageId = (
         SELECT id FROM detail_page_configs
          WHERE ownerType = 'artist' AND ownerId = artists.id
          ORDER BY id
          LIMIT 1
       )
     WHERE detailPageId IS NULL
       AND EXISTS (
         SELECT 1 FROM detail_page_configs
          WHERE ownerType = 'artist' AND ownerId = artists.id
       )
  `);
  await prisma.$executeRawUnsafe(`
    UPDATE activity_cases
       SET detailPageId = (
         SELECT id FROM detail_page_configs
          WHERE ownerType = 'activity_case' AND ownerId = activity_cases.id
          ORDER BY id
          LIMIT 1
       )
     WHERE detailPageId IS NULL
       AND EXISTS (
         SELECT 1 FROM detail_page_configs
          WHERE ownerType = 'activity_case' AND ownerId = activity_cases.id
       )
  `);
  await prisma.$executeRawUnsafe(`
    UPDATE banners
       SET detailPageId = CASE
         WHEN linkType = 'announcement' THEN (
           SELECT announcements.detailPageId
             FROM announcements
            WHERE announcements.id = CAST(banners.linkTarget AS INTEGER)
              AND announcements.detailPageId IS NOT NULL
         )
         WHEN linkType = 'case' THEN (
           SELECT activity_cases.detailPageId
             FROM activity_cases
            WHERE activity_cases.id = CAST(banners.linkTarget AS INTEGER)
              AND activity_cases.detailPageId IS NOT NULL
         )
         ELSE detailPageId
       END
     WHERE detailPageId IS NULL
       AND linkTarget IS NOT NULL
  `);
}

async function assertForeignKeys(prisma: AppPrismaClient) {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>("PRAGMA foreign_key_check");
  if (rows.length) throw new Error(`SQLite 外键校验失败: ${JSON.stringify(rows)}`);
}

async function runH1DetailCardsMigration(prisma: AppPrismaClient) {
  if (await hasMigrationId(prisma, DETAIL_PAGE_H1_CARDS_MIGRATION_ID)) return;

  const details = await prisma.detailPageConfig.findMany({
    select: { id: true, richTextHtml: true },
    orderBy: { id: "asc" }
  });
  const mediaIds = [...new Set(details.flatMap((detail) => collectRichTextMediaAssetIds(detail.richTextHtml)))];
  const assets = mediaIds.length
    ? await prisma.mediaAsset.findMany({
        where: { id: { in: mediaIds } },
        select: { id: true, mediaType: true, url: true, width: true, height: true }
      })
    : [];
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));

  await prisma.$transaction(async (tx) => {
    for (const detail of details) {
      let richTextHtml = "";
      try {
        const sourceHtml = detail.richTextHtml.trim() ? detail.richTextHtml : "<p>内容</p>";
        richTextHtml = normalizeDetailRichTextToH1Cards(sourceHtml, assetMap);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`详情页 ${detail.id} H1 卡片迁移失败: ${message}`);
      }
      const contentMedia = extractRichTextMedia(richTextHtml);
      await tx.detailPageConfig.update({
        where: { id: detail.id },
        data: { richTextHtml, schemaVersion: 2 }
      });
      await tx.detailPageContentMedia.deleteMany({ where: { detailPageConfigId: detail.id } });
      for (const media of contentMedia) {
        await tx.detailPageContentMedia.create({
          data: { detailPageConfigId: detail.id, mediaAssetId: media.assetId }
        });
      }
    }
    await tx.$executeRawUnsafe(
      "INSERT INTO schema_migrations (id, appliedAt) VALUES (?, CURRENT_TIMESTAMP)",
      DETAIL_PAGE_H1_CARDS_MIGRATION_ID
    );
  });
}

export async function runDetailPageMigration(prisma: AppPrismaClient) {
  const migrationApplied = await hasMigration(prisma);
  if (migrationApplied && await hasTargetSchema(prisma)) {
    await runH1DetailCardsMigration(prisma);
    return;
  }

  const before = await snapshot(prisma);
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
  try {
    await prisma.$transaction(async (tx) => {
      await ensureDetailColumns(tx as AppPrismaClient);
      await backfillDetailIdentity(tx as AppPrismaClient);
      await rebuildDetailTablesIfNeeded(tx as AppPrismaClient);
      await ensureDetailIndexes(tx as AppPrismaClient);
      await ensureBusinessDetailColumns(tx as AppPrismaClient);
      await backfillBusinessReferences(tx as AppPrismaClient);
      await backfillDetailIdentity(tx as AppPrismaClient);

      const after = await snapshot(tx as AppPrismaClient);
      assertSameSnapshot(before, after);
      if (!migrationApplied) {
        await tx.$executeRawUnsafe(
          "INSERT INTO schema_migrations (id, appliedAt) VALUES (?, CURRENT_TIMESTAMP)",
          DETAIL_PAGE_MIGRATION_ID
        );
      }
    });
  } finally {
    await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  }
  await assertForeignKeys(prisma);
  await runH1DetailCardsMigration(prisma);
}

export type DetailPageOrphan = {
  id: number;
  ownerType: string | null;
  ownerId: number | null;
  reason: string;
};

export async function auditDetailPageOrphans(prisma: AppPrismaClient): Promise<DetailPageOrphan[]> {
  const configs = await prisma.detailPageConfig.findMany({ select: { id: true, ownerType: true, ownerId: true } });
  const artistIds = configs
    .filter((item) => item.ownerType === "artist" && item.ownerId !== null)
    .map((item) => item.ownerId as number);
  const caseIds = configs
    .filter((item) => item.ownerType === "activity_case" && item.ownerId !== null)
    .map((item) => item.ownerId as number);
  const [artists, cases] = await Promise.all([
    artistIds.length ? prisma.artist.findMany({ where: { id: { in: artistIds } }, select: { id: true } }) : [],
    caseIds.length ? prisma.activityCase.findMany({ where: { id: { in: caseIds } }, select: { id: true } }) : []
  ]);
  const existingArtists = new Set(artists.map((item) => item.id));
  const existingCases = new Set(cases.map((item) => item.id));
  return configs.flatMap((config) => {
    if (config.ownerType === null && config.ownerId === null) return [];
    if (config.ownerType === "artist" && config.ownerId !== null && existingArtists.has(config.ownerId)) return [];
    if (config.ownerType === "activity_case" && config.ownerId !== null && existingCases.has(config.ownerId)) return [];
    return [{
      ...config,
      reason: config.ownerType === "artist" || config.ownerType === "activity_case" ? "业务对象不存在" : "未知 ownerType"
    }];
  });
}
