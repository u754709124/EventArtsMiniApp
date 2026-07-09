import type { AppPrismaClient } from "./db";

const statements = [
  `CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    passwordHash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'enabled',
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS media_assets (
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
  )`,
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
    sortOrder INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'enabled',
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS banners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    imageAssetId INTEGER NOT NULL,
    linkType TEXT NOT NULL DEFAULT 'none',
    linkTarget TEXT,
    switchDurationMs INTEGER NOT NULL,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'enabled',
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(imageAssetId) REFERENCES media_assets(id)
  )`,
  `CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    iconAssetId INTEGER NOT NULL,
    type TEXT NOT NULL,
    configJson TEXT NOT NULL,
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
    summary TEXT NOT NULL,
    tagsJson TEXT NOT NULL,
    detail TEXT NOT NULL,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'enabled',
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(avatarAssetId) REFERENCES media_assets(id)
  )`,
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
    mediaJson TEXT NOT NULL,
    isFeatured BOOLEAN NOT NULL DEFAULT false,
    featuredSortOrder INTEGER NOT NULL DEFAULT 0,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'enabled',
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(coverAssetId) REFERENCES media_assets(id)
  )`,
  `CREATE TABLE IF NOT EXISTS page_view_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pagePath TEXT NOT NULL,
    scene TEXT,
    userAgent TEXT,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS operation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    detail TEXT,
    createdBy INTEGER,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`
];

export async function ensureDatabaseSchema(prisma: AppPrismaClient) {
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
}
