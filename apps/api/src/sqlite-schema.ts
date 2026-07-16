import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { normalizeResourceName } from "@event-arts/shared";
import ffprobe from "@ffprobe-installer/ffprobe";
import sharp from "sharp";
import type { AppPrismaClient } from "./db";
import { runDetailPageMigration } from "./detail-pages/detail-page-migration";

const execFileAsync = promisify(execFile);

const statements = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    appliedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    passwordHash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'enabled',
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS admin_sessions (
    jti TEXT PRIMARY KEY,
    adminId INTEGER NOT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expiresAt DATETIME NOT NULL,
    revokedAt DATETIME,
    revokeReason TEXT,
    FOREIGN KEY(adminId) REFERENCES admin_users(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS admin_sessions_adminId_idx ON admin_sessions(adminId)`,
  `CREATE INDEX IF NOT EXISTS admin_sessions_expiresAt_idx ON admin_sessions(expiresAt)`,
  `CREATE INDEX IF NOT EXISTS admin_sessions_revokedAt_idx ON admin_sessions(revokedAt)`,
  `CREATE TABLE IF NOT EXISTS client_sessions (
    id TEXT PRIMARY KEY,
    tokenHash TEXT NOT NULL UNIQUE,
    appId TEXT NOT NULL,
    openidHash TEXT NOT NULL,
    unionidHash TEXT,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expiresAt DATETIME NOT NULL,
    revokedAt DATETIME,
    revokeReason TEXT,
    lastSeenAt DATETIME
  )`,
  `CREATE INDEX IF NOT EXISTS client_sessions_openidHash_idx ON client_sessions(openidHash)`,
  `CREATE INDEX IF NOT EXISTS client_sessions_expiresAt_idx ON client_sessions(expiresAt)`,
  `CREATE INDEX IF NOT EXISTS client_sessions_revokedAt_idx ON client_sessions(revokedAt)`,
  `CREATE TABLE IF NOT EXISTS media_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    resourceName TEXT NOT NULL,
    resourceNameKey TEXT NOT NULL UNIQUE,
    originalName TEXT NOT NULL,
    filename TEXT NOT NULL UNIQUE,
    md5 TEXT NOT NULL UNIQUE,
    mimeType TEXT NOT NULL,
    mediaType TEXT NOT NULL,
    usage TEXT NOT NULL DEFAULT 'legacy',
    url TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    size INTEGER NOT NULL,
    storageType TEXT NOT NULL DEFAULT 'local',
    createdBy INTEGER,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS media_asset_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mediaAssetId INTEGER NOT NULL,
    label TEXT NOT NULL,
    labelKey TEXT NOT NULL,
    FOREIGN KEY(mediaAssetId) REFERENCES media_assets(id) ON DELETE CASCADE,
    UNIQUE(mediaAssetId, labelKey)
  )`,
  `CREATE INDEX IF NOT EXISTS media_asset_tags_labelKey_idx ON media_asset_tags(labelKey)`,
  `CREATE TABLE IF NOT EXISTS site_config (
    id INTEGER PRIMARY KEY DEFAULT 1,
    appName TEXT NOT NULL,
    subtitle TEXT NOT NULL,
    defaultBannerAssetId INTEGER,
    placeholderBannerAssetId INTEGER,
    placeholderIconAssetId INTEGER,
    placeholderCaseAssetId INTEGER,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(defaultBannerAssetId) REFERENCES media_assets(id),
    FOREIGN KEY(placeholderBannerAssetId) REFERENCES media_assets(id),
    FOREIGN KEY(placeholderIconAssetId) REFERENCES media_assets(id),
    FOREIGN KEY(placeholderCaseAssetId) REFERENCES media_assets(id)
  )`,
  `CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    summary TEXT NOT NULL,
    content TEXT NOT NULL,
    displayDurationMs INTEGER NOT NULL,
    detailPageId INTEGER,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'enabled',
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(detailPageId) REFERENCES detail_page_configs(id) ON DELETE RESTRICT
  )`,
  `CREATE INDEX IF NOT EXISTS announcements_detailPageId_idx ON announcements(detailPageId)`,
  `CREATE TABLE IF NOT EXISTS banners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    imageAssetId INTEGER NOT NULL,
    linkType TEXT NOT NULL DEFAULT 'none',
    linkTarget TEXT,
    detailPageId INTEGER,
    switchDurationMs INTEGER NOT NULL,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'enabled',
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(imageAssetId) REFERENCES media_assets(id),
    FOREIGN KEY(detailPageId) REFERENCES detail_page_configs(id) ON DELETE RESTRICT
  )`,
  `CREATE INDEX IF NOT EXISTS banners_detailPageId_idx ON banners(detailPageId)`,
  `CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    iconAssetId INTEGER NOT NULL,
    type TEXT NOT NULL,
    configJson TEXT NOT NULL,
    showOnHome BOOLEAN NOT NULL DEFAULT true,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'enabled',
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(iconAssetId) REFERENCES media_assets(id)
  )`,
  `CREATE TABLE IF NOT EXISTS artists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    avatarAssetId INTEGER,
    location TEXT NOT NULL DEFAULT '',
    badge TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL,
    tagsJson TEXT NOT NULL,
    detail TEXT NOT NULL,
    detailPageId INTEGER,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'enabled',
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(avatarAssetId) REFERENCES media_assets(id),
    FOREIGN KEY(detailPageId) REFERENCES detail_page_configs(id) ON DELETE RESTRICT
  )`,
  `CREATE INDEX IF NOT EXISTS artists_detailPageId_idx ON artists(detailPageId)`,
  `CREATE TABLE IF NOT EXISTS activity_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    tag TEXT NOT NULL,
    coverAssetId INTEGER NOT NULL,
    summary TEXT NOT NULL,
    eventDate DATETIME NOT NULL,
    location TEXT NOT NULL,
    detail TEXT NOT NULL,
    detailPageId INTEGER,
    mediaJson TEXT NOT NULL,
    isFeatured BOOLEAN NOT NULL DEFAULT false,
    featuredSortOrder INTEGER NOT NULL DEFAULT 0,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'enabled',
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(coverAssetId) REFERENCES media_assets(id),
    FOREIGN KEY(detailPageId) REFERENCES detail_page_configs(id) ON DELETE RESTRICT
  )`,
  `CREATE INDEX IF NOT EXISTS activity_cases_detailPageId_idx ON activity_cases(detailPageId)`,
  `CREATE TABLE IF NOT EXISTS activity_case_media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activityCaseId INTEGER NOT NULL,
    mediaAssetId INTEGER NOT NULL,
    sortOrder INTEGER NOT NULL,
    FOREIGN KEY(activityCaseId) REFERENCES activity_cases(id) ON DELETE CASCADE,
    FOREIGN KEY(mediaAssetId) REFERENCES media_assets(id) ON DELETE RESTRICT,
    UNIQUE(activityCaseId, mediaAssetId)
  )`,
  `CREATE INDEX IF NOT EXISTS activity_case_media_mediaAssetId_idx ON activity_case_media(mediaAssetId)`,
  `CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    coverAssetId INTEGER NOT NULL,
    summary TEXT NOT NULL,
    publishedAt DATETIME NOT NULL,
    isFeatured BOOLEAN NOT NULL DEFAULT false,
    featuredSortOrder INTEGER NOT NULL DEFAULT 0,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'enabled',
    detailPageId INTEGER,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(coverAssetId) REFERENCES media_assets(id),
    FOREIGN KEY(detailPageId) REFERENCES detail_page_configs(id) ON DELETE RESTRICT
  )`,
  `CREATE INDEX IF NOT EXISTS articles_coverAssetId_idx ON articles(coverAssetId)`,
  `CREATE INDEX IF NOT EXISTS articles_detailPageId_idx ON articles(detailPageId)`,
  `CREATE INDEX IF NOT EXISTS articles_category_idx ON articles(category)`,
  `CREATE INDEX IF NOT EXISTS articles_status_sortOrder_idx ON articles(status, sortOrder)`,
  `CREATE INDEX IF NOT EXISTS articles_status_isFeatured_featuredSortOrder_idx ON articles(status, isFeatured, featuredSortOrder)`,
  `CREATE TABLE IF NOT EXISTS detail_page_configs (
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
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS detail_page_configs_ownerType_ownerId_key
    ON detail_page_configs(ownerType, ownerId)`,
  `CREATE INDEX IF NOT EXISTS detail_page_configs_ownerType_idx
    ON detail_page_configs(ownerType)`,
  `CREATE INDEX IF NOT EXISTS detail_page_configs_name_idx
    ON detail_page_configs(name)`,
  `CREATE INDEX IF NOT EXISTS detail_page_configs_pageType_idx
    ON detail_page_configs(pageType)`,
  `CREATE TABLE IF NOT EXISTS detail_page_banner_media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    detailPageConfigId INTEGER NOT NULL,
    mediaAssetId INTEGER NOT NULL,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(detailPageConfigId) REFERENCES detail_page_configs(id) ON DELETE CASCADE,
    FOREIGN KEY(mediaAssetId) REFERENCES media_assets(id) ON DELETE RESTRICT,
    UNIQUE(detailPageConfigId, mediaAssetId)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS detail_page_banner_media_detailPageConfigId_mediaAssetId_key
    ON detail_page_banner_media(detailPageConfigId, mediaAssetId)`,
  `CREATE INDEX IF NOT EXISTS detail_page_banner_media_detailPageConfigId_sortOrder_idx
    ON detail_page_banner_media(detailPageConfigId, sortOrder)`,
  `CREATE INDEX IF NOT EXISTS detail_page_banner_media_mediaAssetId_idx
    ON detail_page_banner_media(mediaAssetId)`,
  `CREATE TABLE IF NOT EXISTS detail_page_content_media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    detailPageConfigId INTEGER NOT NULL,
    mediaAssetId INTEGER NOT NULL,
    FOREIGN KEY(detailPageConfigId) REFERENCES detail_page_configs(id) ON DELETE CASCADE,
    FOREIGN KEY(mediaAssetId) REFERENCES media_assets(id) ON DELETE RESTRICT,
    UNIQUE(detailPageConfigId, mediaAssetId)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS detail_page_content_media_detailPageConfigId_mediaAssetId_key
    ON detail_page_content_media(detailPageConfigId, mediaAssetId)`,
  `CREATE INDEX IF NOT EXISTS detail_page_content_media_mediaAssetId_idx
    ON detail_page_content_media(mediaAssetId)`,
  `CREATE TABLE IF NOT EXISTS page_view_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pagePath TEXT NOT NULL CHECK(length(pagePath) <= 256),
    scene TEXT CHECK(scene IS NULL OR length(scene) <= 64),
    userAgent TEXT CHECK(userAgent IS NULL OR length(userAgent) <= 256),
    anonymousFingerprint TEXT NOT NULL DEFAULT '',
    sampleWeight INTEGER NOT NULL DEFAULT 1,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS daily_user_visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appId TEXT NOT NULL,
    openidHash TEXT NOT NULL,
    visitDate TEXT NOT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(appId, openidHash, visitDate)
  )`,
  `CREATE INDEX IF NOT EXISTS daily_user_visits_visitDate_idx ON daily_user_visits(visitDate)`,
  `CREATE TABLE IF NOT EXISTS operation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    detail TEXT,
    createdBy INTEGER,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS seed_records (
    key TEXT PRIMARY KEY,
    entityType TEXT NOT NULL,
    entityId INTEGER NOT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`
];

type SchemaOptions = { uploadDir?: string };

type LegacyMediaRow = {
  id: number;
  originalName: string;
  filename: string;
  mimeType: string;
  mediaType: string;
  url: string;
  width: number | null;
  height: number | null;
};

async function tableExists(prisma: AppPrismaClient, table: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    table
  );
  return rows.length > 0;
}

async function ensureArtistColumns(prisma: AppPrismaClient) {
  if (!(await tableExists(prisma, "artists"))) return;
  const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>("PRAGMA table_info(artists)");
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("location")) {
    await prisma.$executeRawUnsafe("ALTER TABLE artists ADD COLUMN location TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has("badge")) {
    await prisma.$executeRawUnsafe("ALTER TABLE artists ADD COLUMN badge TEXT NOT NULL DEFAULT ''");
  }
}

async function ensureMenuItemColumns(prisma: AppPrismaClient) {
  if (!(await tableExists(prisma, "menu_items"))) return;
  const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>("PRAGMA table_info(menu_items)");
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("showOnHome")) {
    await prisma.$executeRawUnsafe("ALTER TABLE menu_items ADD COLUMN showOnHome BOOLEAN NOT NULL DEFAULT true");
  }
}

async function ensurePageViewEventColumns(prisma: AppPrismaClient) {
  if (!(await tableExists(prisma, "page_view_events"))) return;
  const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>("PRAGMA table_info(page_view_events)");
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("anonymousFingerprint")) {
    await prisma.$executeRawUnsafe("ALTER TABLE page_view_events ADD COLUMN anonymousFingerprint TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has("sampleWeight")) {
    await prisma.$executeRawUnsafe("ALTER TABLE page_view_events ADD COLUMN sampleWeight INTEGER NOT NULL DEFAULT 1");
  }
  await prisma.$executeRawUnsafe("CREATE INDEX IF NOT EXISTS page_view_events_createdAt_idx ON page_view_events(createdAt)");
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS page_view_events_anonymousFingerprint_pagePath_scene_createdAt_idx
      ON page_view_events(anonymousFingerprint, pagePath, scene, createdAt)`
  );
}

function isDeferredDetailPageIndex(statement: string) {
  return (
    /CREATE INDEX IF NOT EXISTS (announcements|banners|artists|activity_cases|articles)_detailPageId_idx/.test(statement) ||
    /CREATE (?:UNIQUE )?INDEX IF NOT EXISTS detail_page_configs_/.test(statement)
  );
}

function storagePath(uploadDir: string, row: LegacyMediaRow) {
  const resolveInsideUploadDir = (storageKey: string) => {
    const root = path.resolve(uploadDir);
    const candidate = path.resolve(root, storageKey);
    if (!candidate.startsWith(`${root}${path.sep}`)) {
      throw new Error(`旧资源路径越界: ${row.id}:${row.originalName}`);
    }
    return candidate;
  };
  try {
    const pathname = decodeURIComponent(new URL(row.url).pathname);
    const marker = "/uploads/";
    const index = pathname.indexOf(marker);
    if (index >= 0) return resolveInsideUploadDir(pathname.slice(index + marker.length));
  } catch {
    // Fall back to the stored filename for legacy relative URLs.
  }
  return resolveInsideUploadDir(row.filename);
}

async function preflightLegacyMedia(prisma: AppPrismaClient, uploadDir: string) {
  const rows = await prisma.$queryRawUnsafe<LegacyMediaRow[]>(
    "SELECT id, originalName, filename, mimeType, mediaType, url, width, height FROM media_assets ORDER BY id"
  );
  if (await tableExists(prisma, "activity_cases")) {
    const unsupported = await prisma.$queryRawUnsafe<Array<{ id: number; mediaJson: string }>>(
      "SELECT id, mediaJson FROM activity_cases WHERE TRIM(COALESCE(mediaJson, '')) NOT IN ('', '[]')"
    );
    if (unsupported.length) {
      throw new Error(`无法迁移非空 mediaJson，案例 ID: ${unsupported.map((item) => item.id).join(", ")}`);
    }
  }

  const prepared: Array<LegacyMediaRow & {
    absolutePath: string;
    storageKey: string;
    resourceName: string;
    resourceNameKey: string;
    md5: string;
    size: number;
    actualWidth: number;
    actualHeight: number;
  }> = [];
  const usedNames = new Set<string>();
  const missing: string[] = [];
  for (const row of rows) {
    const absolutePath = storagePath(uploadDir, row);
    let buffer: Buffer;
    try {
      buffer = await readFile(absolutePath);
    } catch {
      missing.push(`${row.id}:${row.originalName} (${absolutePath})`);
      continue;
    }
    let actualWidth = row.width ?? 0;
    let actualHeight = row.height ?? 0;
    try {
      if (row.mediaType === "image") {
        const metadata = await sharp(buffer).metadata();
        actualWidth = metadata.width ?? 0;
        actualHeight = metadata.height ?? 0;
      } else if (row.mediaType === "video") {
        const { stdout } = await execFileAsync(ffprobe.path, [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=width,height",
          "-of",
          "json",
          absolutePath
        ]);
        const info = JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number }> };
        actualWidth = info.streams?.[0]?.width ?? 0;
        actualHeight = info.streams?.[0]?.height ?? 0;
      }
    } catch {
      throw new Error(`无法读取旧资源尺寸: ${row.id}:${row.originalName}`);
    }
    if (!actualWidth || !actualHeight) {
      throw new Error(`无法读取旧资源尺寸: ${row.id}:${row.originalName}`);
    }
    let name = normalizeResourceName(row.originalName);
    if (usedNames.has(name.key)) name = normalizeResourceName(`${name.displayName} (${row.id})`);
    usedNames.add(name.key);
    prepared.push({
      ...row,
      absolutePath,
      storageKey: path.relative(uploadDir, absolutePath),
      resourceName: name.displayName,
      resourceNameKey: name.key,
      md5: createHash("md5").update(buffer).digest("hex"),
      size: buffer.length,
      actualWidth,
      actualHeight
    });
  }
  if (missing.length) throw new Error(`旧资源文件缺失: ${missing.join("; ")}`);
  return prepared;
}

async function migrateLegacyMedia(prisma: AppPrismaClient, uploadDir: string) {
  const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>("PRAGMA table_info(media_assets)");
  if (columns.some((column) => column.name === "resourceName")) return;
  const prepared = await preflightLegacyMedia(prisma, uploadDir);
  const canonicalByMd5 = new Map<string, (typeof prepared)[number]>();
  const duplicateToCanonical = new Map<number, number>();
  for (const row of prepared) {
    const canonical = canonicalByMd5.get(row.md5);
    if (canonical) duplicateToCanonical.set(row.id, canonical.id);
    else canonicalByMd5.set(row.md5, row);
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("ALTER TABLE media_assets ADD COLUMN resourceName TEXT");
    await tx.$executeRawUnsafe("ALTER TABLE media_assets ADD COLUMN resourceNameKey TEXT");
    await tx.$executeRawUnsafe("ALTER TABLE media_assets ADD COLUMN md5 TEXT");
    await tx.$executeRawUnsafe("ALTER TABLE media_assets ADD COLUMN updatedAt DATETIME");

    const references = [
      ["site_config", "defaultBannerAssetId"],
      ["site_config", "placeholderBannerAssetId"],
      ["site_config", "placeholderIconAssetId"],
      ["site_config", "placeholderCaseAssetId"],
      ["banners", "imageAssetId"],
      ["menu_items", "iconAssetId"],
      ["artists", "avatarAssetId"],
      ["activity_cases", "coverAssetId"]
    ] as const;
    for (const [duplicateId, canonicalId] of duplicateToCanonical) {
      for (const [table, column] of references) {
        const exists = await tx.$queryRawUnsafe<Array<{ name: string }>>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
          table
        );
        if (exists.length) await tx.$executeRawUnsafe(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`, canonicalId, duplicateId);
      }
    }

    for (const row of canonicalByMd5.values()) {
      await tx.$executeRawUnsafe(
        "UPDATE media_assets SET resourceName = ?, resourceNameKey = ?, md5 = ?, filename = ?, width = ?, height = ?, size = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?",
        row.resourceName,
        row.resourceNameKey,
        row.md5,
        row.storageKey,
        row.actualWidth,
        row.actualHeight,
        row.size,
        row.id
      );
    }
    for (const duplicateId of duplicateToCanonical.keys()) {
      await tx.$executeRawUnsafe("DELETE FROM media_assets WHERE id = ?", duplicateId);
    }
    await tx.$executeRawUnsafe("CREATE UNIQUE INDEX media_assets_resourceNameKey_key ON media_assets(resourceNameKey)");
    await tx.$executeRawUnsafe("CREATE UNIQUE INDEX media_assets_md5_key ON media_assets(md5)");
  });

  for (const row of prepared.filter((item) => duplicateToCanonical.has(item.id))) {
    await unlink(row.absolutePath).catch(() => undefined);
  }
}

export async function ensureDatabaseSchema(prisma: AppPrismaClient, options: SchemaOptions = {}) {
  const hasMediaTable = await tableExists(prisma, "media_assets");
  if (hasMediaTable) {
    const uploadDir = options.uploadDir ?? path.resolve(process.cwd(), "../../uploads");
    await migrateLegacyMedia(prisma, uploadDir);
  }
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  for (const statement of statements) {
    if (isDeferredDetailPageIndex(statement)) continue;
    await prisma.$executeRawUnsafe(statement);
  }
  await ensureArtistColumns(prisma);
  await ensureMenuItemColumns(prisma);
  await ensurePageViewEventColumns(prisma);
  await runDetailPageMigration(prisma);
}
