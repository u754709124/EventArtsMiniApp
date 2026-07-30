import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, opendir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { createGzip, createGunzip } from "node:zlib";
import {
  adminGrantableMenuKeyValues,
  backupDtoSchema,
  backupIdSchema,
  backupManifestSchema,
  backupPreflightSummarySchema,
  type BackupKind,
  type BackupDto,
  type BackupManifest,
  type BackupPreflightSummary
} from "@event-arts/shared";
import { createPrismaClient, type AppPrismaClient } from "./db";
import { ensureDatabaseSchema } from "./sqlite-schema";

export const backupFormatVersion = 3;
export const backupArchiveMaxBytes = 256 * 1024 * 1024;
export const backupMaxExpandedBytes = 512 * 1024 * 1024;
export const backupMaxFileCount = 10_000;
export const backupMaxExpansionRatio = 200;
export const backupIdentityRestorePolicy = "preserve_target" as const;
export const automaticBackupRetentionKeepCount = 3;
const manualSchemaMigrationId = "manual-sqlite-schema";
const adminRbacMigrationId = "20260719_admin_rbac_identity_v1";
const knownPreRbacV1SchemaHashes = new Set([
  "0f203a9f01cb09b7127e5f79593e5717d4ec3f8ea14612d56d983a044872f032"
]);
const manifestFilename = "manifest.json";
const databaseSnapshotFilename = "database.sqlite";
const snapshotMethod = "sqlite-vacuum-into" as const;
const apiAppMetadata = { name: "api", version: "0.1.0" };
const nonDeletableStatuses = new Set(["verifying", "restoring"]);
const backupDownloadContentType = "application/gzip";
const paxHeaderMaxBytes = 2048;
const supportedBackupFormatVersions = [1, 2, 3] as const;
const v3IdentityExcludedTables = [
  "edgeone_prefetch_attempts",
  "edgeone_prefetch_resources",
  "admin_menu_permissions",
  "admin_sessions",
  "admin_password_reset_tokens",
  "admin_notifications",
  "admin_users",
  "client_sessions",
  "daily_user_visits",
  "page_view_events",
  "operation_logs",
  "scheduled_task_states"
] as const;
const v3IdentityExcludedSequences = [
  "edgeone_prefetch_attempts",
  "edgeone_prefetch_resources",
  "admin_menu_permissions",
  "admin_password_reset_tokens",
  "admin_notifications",
  "admin_users",
  "client_sessions",
  "daily_user_visits",
  "page_view_events",
  "operation_logs"
] as const;

type BackupAdmin = {
  id: number;
  publicId?: string;
  username: string;
};

function anonymousBackupCreator(backupKind: BackupKind) {
  if (backupKind === "automatic") return { username: "系统任务" } as const;
  if (backupKind === "restore_snapshot") return { username: "恢复前安全快照" } as const;
  return { username: "后台管理员" } as const;
}

export type BackupServiceHooks = {
  afterDatabaseSnapshot?: (context: { backupId: string; stagingDir: string }) => Promise<void> | void;
  beforePublish?: (context: { backupId: string; stagingDir: string; manifest: BackupManifest }) => Promise<void> | void;
  beforeRestoreSwitch?: (context: { restoreId: string; backupId: string; candidateDir: string }) => Promise<void> | void;
  afterRestoreDatabaseSwitch?: (context: { restoreId: string; backupId: string }) => Promise<void> | void;
  afterRestoreUploadSwitch?: (context: { restoreId: string; backupId: string }) => Promise<void> | void;
};

export type BackupServiceOptions = {
  prisma: AppPrismaClient;
  uploadDir: string;
  backupDir: string;
  databaseUrl: string;
  now?: () => Date;
  hooks?: BackupServiceHooks;
};

export class BackupServiceError extends Error {
  readonly code:
    | "BACKUP_NOT_FOUND"
    | "BACKUP_INVALID"
    | "BACKUP_UNSUPPORTED_VERSION"
    | "BACKUP_CONFLICT"
    | "BACKUP_RESTORE_FAILED";
  readonly statusCode: number;

  constructor(
    code: BackupServiceError["code"],
    message: string,
    statusCode: number,
    cause?: unknown
  ) {
    super(message, { cause });
    this.name = "BackupServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

type SchemaMetadata = BackupManifest["schema"];

type CollectedUploadFile = {
  sourcePath: string;
  manifestPath: string;
  modifiedAt: string;
};

type BackupRecord = {
  id: string;
  path: string;
  manifest: BackupManifest;
};

type BackupSource = "existing_backup" | "external_archive";

type BackupPreflightResult = {
  backup: BackupDto;
  manifest: BackupManifest;
  summary: BackupPreflightSummary;
};

type RestoreResult = {
  restoreId: string;
  backupId: string;
  snapshotBackupId: string;
  revokedSessionCount: number;
  revokedResetTokenCount: number;
  preflight: BackupPreflightSummary;
};

export type AutomaticBackupRetentionResult = {
  keepCount: number;
  automaticBackupCount: number;
  retainedBackupIds: string[];
  deletedBackupIds: string[];
  skippedConflictBackupIds: string[];
};

type ExtractedArchive = {
  files: string[];
  totalFileBytes: number;
  expandedBytes: number;
};

type BackupArchiveFile = {
  archivePath: string;
  sourcePath: string;
  size: number;
};

type BackupCompatibility = {
  mode: "current_v3" | "current_v2" | "known_prerbac_v1";
  requiresRbacUpgrade: boolean;
};

function posixPath(value: string) {
  return value.split(path.sep).join("/");
}

function isSameOrInside(parent: string, child: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeSqliteStringLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function toIso(date: Date) {
  return date.toISOString();
}

function formatBackupTimestamp(date: Date) {
  return date.toISOString().replace(/[-:.]/g, "").replace("T", "T").replace("Z", "Z");
}

function makeBackupId(now: Date) {
  return `backup-${formatBackupTimestamp(now)}-${randomBytes(6).toString("hex")}`;
}

function makeImportBackupId(now: Date) {
  return `import-${formatBackupTimestamp(now)}-${randomBytes(6).toString("hex")}`;
}

function makeRestoreId(now: Date) {
  return `restore-${formatBackupTimestamp(now)}-${randomBytes(6).toString("hex")}`;
}

function parseSqliteFilePath(databaseUrl: string) {
  if (!databaseUrl.startsWith("file:")) {
    throw new BackupServiceError("BACKUP_INVALID", "仅支持 SQLite file 数据库备份", 500);
  }
  const withoutScheme = databaseUrl.slice("file:".length);
  const rawPath = withoutScheme.split(/[?#]/)[0];
  if (!rawPath) throw new BackupServiceError("BACKUP_INVALID", "数据库路径为空，无法备份", 500);
  const decoded = decodeURIComponent(rawPath);
  return path.isAbsolute(decoded) ? path.normalize(decoded) : path.resolve(process.cwd(), decoded);
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right, "en-US"));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}

function computeBackupDigest(
  database: BackupManifest["database"],
  uploads: BackupManifest["uploads"],
  formatVersion = backupFormatVersion
) {
  const hash = createHash("sha256");
  hash.update(`format:${formatVersion}\n`);
  hash.update(`database:${database.path}:${database.size}:${database.sha256}\n`);
  for (const file of uploads) {
    hash.update(`upload:${file.path}:${file.size}:${file.sha256}\n`);
  }
  return hash.digest("hex");
}

async function hashCopiedFile(sourcePath: string, targetPath: string) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
  const [metadata, sha256] = await Promise.all([stat(targetPath), sha256File(targetPath)]);
  return { size: metadata.size, sha256 };
}

function isExcludedUploadName(name: string) {
  if (!name || name.startsWith(".")) return true;
  return (
    name.endsWith(".tmp") ||
    name.endsWith(".upload") ||
    name.endsWith(".pending") ||
    name.endsWith(".part") ||
    name.endsWith(".swp") ||
    name === "Thumbs.db"
  );
}

async function safeRealpath(value: string) {
  return realpath(value).catch(() => path.resolve(value));
}

async function collectUploadFiles(uploadDir: string, backupDir: string): Promise<CollectedUploadFile[]> {
  const uploadRoot = path.resolve(uploadDir);
  const backupRoot = path.resolve(backupDir);
  const uploadRootReal = await safeRealpath(uploadRoot);
  const backupRootReal = await safeRealpath(backupRoot);
  const files: CollectedUploadFile[] = [];

  async function walk(currentDir: string) {
    const dir = await opendir(currentDir);
    for await (const entry of dir) {
      if (isExcludedUploadName(entry.name)) continue;
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = path.relative(uploadRoot, absolutePath);
      if (relativePath === "" || relativePath.startsWith("..") || path.isAbsolute(relativePath)) continue;

      const entryStat = await lstat(absolutePath).catch(() => null);
      if (!entryStat || entryStat.isSymbolicLink()) continue;
      if (entryStat.isDirectory()) {
        const directoryReal = await safeRealpath(absolutePath);
        if (!isSameOrInside(uploadRootReal, directoryReal)) continue;
        if (isSameOrInside(backupRootReal, directoryReal) || isSameOrInside(directoryReal, backupRootReal)) continue;
        await walk(absolutePath);
        continue;
      }
      if (!entryStat.isFile()) continue;

      const fileReal = await safeRealpath(absolutePath);
      if (!isSameOrInside(uploadRootReal, fileReal)) continue;
      if (isSameOrInside(backupRootReal, fileReal)) continue;
      files.push({
        sourcePath: absolutePath,
        manifestPath: `uploads/${posixPath(relativePath)}`,
        modifiedAt: toIso(entryStat.mtime)
      });
    }
  }

  await mkdir(uploadRoot, { recursive: true });
  await walk(uploadRoot);
  return files.sort((left, right) => left.manifestPath.localeCompare(right.manifestPath, "en-US"));
}

async function collectSchemaMetadata(prisma: AppPrismaClient): Promise<SchemaMetadata> {
  const [
    sqliteVersionRows,
    userVersionRows,
    migrationRows,
    schemaRows
  ] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ version: string }>>("SELECT sqlite_version() AS version"),
    prisma.$queryRawUnsafe<Array<{ user_version: number | bigint }>>("PRAGMA user_version"),
    prisma.$queryRawUnsafe<Array<{ id: string }>>(
      "SELECT id FROM schema_migrations ORDER BY id"
    ).catch(() => []),
    prisma.$queryRawUnsafe<Array<{ name: string; type: string; sql: string | null }>>(
      "SELECT name, type, sql FROM sqlite_master WHERE type IN ('table', 'index', 'trigger', 'view') ORDER BY type, name"
    )
  ]);
  const schemaHash = createHash("sha256").update(stableJson(schemaRows)).digest("hex");
  const migrationIds = migrationRows.map((row) => row.id).filter(Boolean);
  return {
    provider: "sqlite",
    sqliteVersion: sqliteVersionRows[0]?.version ?? "unknown",
    userVersion: Number(userVersionRows[0]?.user_version ?? 0),
    schemaHash,
    migrationIds: migrationIds.length ? migrationIds : [manualSchemaMigrationId]
  };
}

async function activeDatabasePath(prisma: AppPrismaClient, fallbackPath: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string; file: string }>>("PRAGMA database_list");
  const main = rows.find((row) => row.name === "main");
  return main?.file ? path.resolve(main.file) : fallbackPath;
}

async function snapshotDatabase(prisma: AppPrismaClient, targetPath: string) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await rm(targetPath, { force: true });
  await prisma.$executeRawUnsafe(`VACUUM INTO ${safeSqliteStringLiteral(targetPath)}`);
  return databaseSnapshotMetadata(targetPath);
}

async function databaseSnapshotMetadata(snapshotPath: string) {
  const [metadata, sha256] = await Promise.all([stat(snapshotPath), sha256File(snapshotPath)]);
  const snapshotPrisma = createPrismaClient(`file:${snapshotPath}`);
  try {
    const [pageSizeRows, pageCountRows] = await Promise.all([
      snapshotPrisma.$queryRawUnsafe<Array<{ page_size: number | bigint }>>("PRAGMA page_size"),
      snapshotPrisma.$queryRawUnsafe<Array<{ page_count: number | bigint }>>("PRAGMA page_count")
    ]);
    return {
      path: databaseSnapshotFilename,
      size: metadata.size,
      sha256,
      snapshotMethod,
      pageSize: Number(pageSizeRows[0]?.page_size ?? 0),
      pageCount: Number(pageCountRows[0]?.page_count ?? 0)
    };
  } finally {
    await snapshotPrisma.$disconnect().catch(() => undefined);
  }
}

async function sanitizeV3NonIdentityDatabaseSnapshot(databasePath: string) {
  const snapshotPrisma = createPrismaClient(`file:${databasePath}`);
  try {
    await sqliteIntegrityCheck(snapshotPrisma);
    await snapshotPrisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
    await snapshotPrisma.$executeRawUnsafe("BEGIN IMMEDIATE");
    try {
      if (await sqliteTableExists(snapshotPrisma, "edgeone_prefetch_attempts")) {
        await snapshotPrisma.$executeRawUnsafe("DELETE FROM edgeone_prefetch_attempts");
      }
      if (await sqliteTableExists(snapshotPrisma, "edgeone_prefetch_resources")) {
        await snapshotPrisma.$executeRawUnsafe("DELETE FROM edgeone_prefetch_resources");
      }
      if (await sqliteTableExists(snapshotPrisma, "media_assets")) {
        await snapshotPrisma.$executeRawUnsafe("UPDATE media_assets SET createdBy = NULL WHERE createdBy IS NOT NULL");
      }
      for (const table of [
        "admin_menu_permissions",
        "admin_sessions",
        "admin_password_reset_tokens",
        "admin_notifications",
        "admin_users",
        "client_sessions",
        "daily_user_visits",
        "page_view_events",
        "operation_logs",
        "scheduled_task_states"
      ]) {
        if (await sqliteTableExists(snapshotPrisma, table)) {
          await snapshotPrisma.$executeRawUnsafe(`DELETE FROM ${table}`);
        }
      }
      if (await sqliteTableExists(snapshotPrisma, "sqlite_sequence")) {
        await snapshotPrisma.$executeRawUnsafe(
          `DELETE FROM sqlite_sequence WHERE name IN (${sqlInStringList(v3IdentityExcludedSequences)})`
        );
      }
      await snapshotPrisma.$executeRawUnsafe("COMMIT");
    } catch (error) {
      await snapshotPrisma.$executeRawUnsafe("ROLLBACK").catch(() => undefined);
      throw error;
    }
    await sqliteIntegrityCheck(snapshotPrisma);
    await assertV3NonIdentityDatabase(snapshotPrisma);
    await snapshotPrisma.$executeRawUnsafe("VACUUM");
    await sqliteIntegrityCheck(snapshotPrisma);
    await assertV3NonIdentityDatabase(snapshotPrisma);
  } catch (error) {
    if (error instanceof BackupServiceError) throw error;
    throw new BackupServiceError("BACKUP_INVALID", "备份数据库身份数据清理失败", 500, error);
  } finally {
    await snapshotPrisma.$disconnect().catch(() => undefined);
  }
  return databaseSnapshotMetadata(databasePath);
}

async function assertV3NonIdentityDatabase(prisma: AppPrismaClient, statusCode = 500) {
  for (const table of v3IdentityExcludedTables) {
    if (!(await sqliteTableExists(prisma, table))) continue;
    const count = await tableRowCount(prisma, table);
    if (count !== 0) {
      throw new BackupServiceError("BACKUP_INVALID", `v3 备份数据库仍包含身份数据表 ${table}`, statusCode);
    }
  }
  if (await sqliteTableExists(prisma, "media_assets")) {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: number | bigint }>>(
      "SELECT COUNT(*) AS count FROM media_assets WHERE createdBy IS NOT NULL"
    );
    if (Number(rows[0]?.count ?? 0) !== 0) {
      throw new BackupServiceError("BACKUP_INVALID", "v3 备份数据库仍包含媒体 actor", statusCode);
    }
  }
}

async function validateV3BackupSnapshotBeforePublish(databasePath: string, manifest: BackupManifest) {
  if (manifest.formatVersion !== 3) return;
  const snapshotPrisma = createPrismaClient(`file:${databasePath}`);
  try {
    await sqliteIntegrityCheck(snapshotPrisma);
    await assertV3NonIdentityDatabase(snapshotPrisma);
    await validateMediaManifestReferences(snapshotPrisma, manifest);
  } catch (error) {
    if (error instanceof BackupServiceError) throw error;
    throw new BackupServiceError("BACKUP_INVALID", "v3 备份发布前数据库校验失败", 500, error);
  } finally {
    await snapshotPrisma.$disconnect().catch(() => undefined);
  }
}

function manifestFilePath(root: string, manifestPath: string, statusCode = 500) {
  const absolutePath = path.resolve(root, manifestPath);
  if (!isSameOrInside(root, absolutePath)) {
    throw new BackupServiceError("BACKUP_INVALID", "备份清单包含越界路径", statusCode);
  }
  return absolutePath;
}

async function verifyManifestFiles(stagingDir: string, manifest: BackupManifest, invalidStatusCode = 500) {
  const parsed = backupManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    throw new BackupServiceError("BACKUP_INVALID", "备份清单格式无效", invalidStatusCode, parsed.error);
  }
  const entries = [manifest.database, ...manifest.uploads];
  let totalBytes = 0;
  for (const entry of entries) {
    const absolutePath = manifestFilePath(stagingDir, entry.path, invalidStatusCode);
    const entryStat = await lstat(absolutePath).catch(() => null);
    if (!entryStat || !entryStat.isFile() || entryStat.isSymbolicLink()) {
      throw new BackupServiceError("BACKUP_INVALID", "备份清单包含非普通文件", invalidStatusCode);
    }
    if (entryStat.size !== entry.size) {
      throw new BackupServiceError("BACKUP_INVALID", "备份文件大小校验失败", invalidStatusCode);
    }
    const actualSha256 = await sha256File(absolutePath);
    if (actualSha256 !== entry.sha256) {
      throw new BackupServiceError("BACKUP_INVALID", "备份文件 SHA-256 校验失败", invalidStatusCode);
    }
    totalBytes += entry.size;
  }
  if (totalBytes !== manifest.totalBytes || entries.length !== manifest.totalFiles) {
    throw new BackupServiceError("BACKUP_INVALID", "备份总量校验失败", invalidStatusCode);
  }
  const digest = computeBackupDigest(manifest.database, manifest.uploads, manifest.formatVersion);
  if (digest !== manifest.sha256) {
    throw new BackupServiceError("BACKUP_INVALID", "备份总 SHA-256 校验失败", invalidStatusCode);
  }
}

async function readManifest(backupPath: string, invalidStatusCode = 500) {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path.join(backupPath, manifestFilename), "utf8")) as unknown;
  } catch (error) {
    throw new BackupServiceError("BACKUP_INVALID", "备份清单格式无效", invalidStatusCode, error);
  }
  if (
    raw &&
    typeof raw === "object" &&
    "formatVersion" in raw &&
    !supportedBackupFormatVersions.includes(Number((raw as { formatVersion?: unknown }).formatVersion) as 1 | 2 | 3)
  ) {
    throw new BackupServiceError("BACKUP_UNSUPPORTED_VERSION", "备份格式版本不兼容", 409);
  }
  const parsed = backupManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BackupServiceError("BACKUP_INVALID", "备份清单格式无效", invalidStatusCode, parsed.error);
  }
  return parsed.data;
}

function backupKindForLocalRecord(id: string, manifest: BackupManifest): BackupKind {
  if (id.startsWith("import-")) return "imported";
  if (manifest.formatVersion === 3) return manifest.backupKind;
  return "manual";
}

function dataScopeForManifest(manifest: BackupManifest) {
  return manifest.formatVersion === 3 ? manifest.dataScope : "full";
}

function toBackupDto(id: string, manifest: BackupManifest): BackupDto {
  return backupDtoSchema.parse({
    id,
    formatVersion: manifest.formatVersion,
    identityRestorePolicy: backupIdentityRestorePolicy,
    dataScope: dataScopeForManifest(manifest),
    backupKind: backupKindForLocalRecord(id, manifest),
    status: manifest.status,
    createdBy: manifest.createdBy,
    createdAt: manifest.createdAt,
    size: manifest.totalBytes,
    sha256: manifest.sha256,
    database: {
      size: manifest.database.size,
      sha256: manifest.database.sha256,
      snapshotMethod: manifest.database.snapshotMethod
    },
    uploadFileCount: manifest.uploads.length,
    note: manifest.note
  });
}

function parseBackupId(value: string) {
  const parsed = backupIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new BackupServiceError("BACKUP_INVALID", "备份 ID 无效", 400, parsed.error);
  }
  return parsed.data;
}

function ensureReadyManifest(manifest: BackupManifest, statusCode = 400, message = "备份当前状态不可恢复") {
  if (manifest.status !== "ready") {
    throw new BackupServiceError("BACKUP_CONFLICT", message, statusCode);
  }
}

function sameStringList(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function sortedMigrationIds(metadata: SchemaMetadata) {
  return [...metadata.migrationIds].sort((left, right) => left.localeCompare(right, "en-US"));
}

function schemaMetadataMatches(left: SchemaMetadata, right: SchemaMetadata) {
  return (
    left.provider === right.provider &&
    left.userVersion === right.userVersion &&
    left.schemaHash.toLowerCase() === right.schemaHash.toLowerCase() &&
    sameStringList(sortedMigrationIds(left), sortedMigrationIds(right))
  );
}

function isKnownPreRbacV1Manifest(manifest: BackupManifest) {
  if (manifest.formatVersion !== 1) return false;
  const migrations = sortedMigrationIds(manifest.schema);
  return (
    knownPreRbacV1SchemaHashes.has(manifest.schema.schemaHash.toLowerCase()) &&
    sameStringList(migrations, [manualSchemaMigrationId])
  );
}

function assertSchemaMetadataCompatible(
  current: SchemaMetadata,
  manifest: BackupManifest,
  candidate: SchemaMetadata
): BackupCompatibility {
  const candidateMatchesManifest = schemaMetadataMatches(candidate, manifest.schema);
  const currentMatchesManifest = schemaMetadataMatches(current, manifest.schema);

  if (manifest.formatVersion === 3) {
    if (
      manifest.identityRestorePolicy === backupIdentityRestorePolicy &&
      manifest.dataScope === "non_identity" &&
      candidateMatchesManifest &&
      currentMatchesManifest
    ) {
      return { mode: "current_v3", requiresRbacUpgrade: false };
    }
    throw new BackupServiceError("BACKUP_UNSUPPORTED_VERSION", "备份数据库 schema 与当前版本不兼容", 409);
  }

  if (manifest.formatVersion === 2) {
    if (
      manifest.identityRestorePolicy === backupIdentityRestorePolicy &&
      candidateMatchesManifest &&
      currentMatchesManifest
    ) {
      return { mode: "current_v2", requiresRbacUpgrade: false };
    }
    throw new BackupServiceError("BACKUP_UNSUPPORTED_VERSION", "备份数据库 schema 与当前版本不兼容", 409);
  }

  if (
    isKnownPreRbacV1Manifest(manifest) &&
    candidateMatchesManifest &&
    current.migrationIds.includes(adminRbacMigrationId)
  ) {
    return { mode: "known_prerbac_v1", requiresRbacUpgrade: true };
  }

  throw new BackupServiceError("BACKUP_UNSUPPORTED_VERSION", "备份数据库 schema 与当前版本不兼容", 409);
}

function assertPreparedRestoreSchemaCompatible(
  current: SchemaMetadata,
  candidate: SchemaMetadata,
  compatibility: BackupCompatibility
) {
  if (compatibility.mode === "current_v2" || compatibility.mode === "current_v3") {
    if (schemaMetadataMatches(candidate, current)) return;
    throw new BackupServiceError("BACKUP_UNSUPPORTED_VERSION", "备份数据库 schema 与当前版本不兼容", 409);
  }

  if (
    compatibility.mode === "known_prerbac_v1" &&
    current.migrationIds.includes(adminRbacMigrationId) &&
    candidate.migrationIds.includes(adminRbacMigrationId)
  ) {
    return;
  }

  throw new BackupServiceError("BACKUP_UNSUPPORTED_VERSION", "备份数据库 schema 与当前版本不兼容", 409);
}

function safeUploadStorageKey(filename: string) {
  const normalized = posixPath(filename).replace(/^\/+/, "");
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    normalized.startsWith("\\") ||
    normalized.split("/").includes("..")
  ) {
    throw new BackupServiceError("BACKUP_INVALID", "备份媒体文件路径无效", 400);
  }
  return normalized;
}

function uploadManifestPathForFilename(filename: string) {
  return `uploads/${safeUploadStorageKey(filename)}`;
}

function restoredUploadFilePath(uploadRoot: string, manifestPath: string) {
  if (!manifestPath.startsWith("uploads/")) {
    throw new BackupServiceError("BACKUP_INVALID", "备份媒体文件路径无效", 400);
  }
  const relative = manifestPath.slice("uploads/".length);
  if (!relative || relative.includes("\0") || relative.split(/[\\/]+/).includes("..")) {
    throw new BackupServiceError("BACKUP_INVALID", "备份媒体文件路径无效", 400);
  }
  const absolutePath = path.resolve(uploadRoot, relative);
  if (!isSameOrInside(uploadRoot, absolutePath)) {
    throw new BackupServiceError("BACKUP_INVALID", "备份媒体文件路径无效", 400);
  }
  return absolutePath;
}

async function sqliteIntegrityCheck(prisma: AppPrismaClient) {
  const integrityRows = await prisma.$queryRawUnsafe<Array<{ integrity_check: string }>>("PRAGMA integrity_check");
  if (integrityRows.length !== 1 || integrityRows[0]?.integrity_check !== "ok") {
    throw new BackupServiceError("BACKUP_INVALID", "备份数据库完整性校验失败", 400);
  }
  const foreignKeyRows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>("PRAGMA foreign_key_check");
  if (foreignKeyRows.length) {
    throw new BackupServiceError("BACKUP_INVALID", "备份数据库外键校验失败", 400);
  }
}

async function sqliteTableExists(prisma: AppPrismaClient, table: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    table
  );
  return rows.length > 0;
}

async function validateMediaManifestReferences(prisma: AppPrismaClient, manifest: BackupManifest) {
  const manifestUploadPaths = new Set(manifest.uploads.map((file) => file.path));
  if (!(await sqliteTableExists(prisma, "media_assets"))) {
    if (manifestUploadPaths.size) {
      throw new BackupServiceError("BACKUP_INVALID", "备份媒体文件清单与数据库不一致", 400);
    }
    return;
  }

  const rows = await prisma.$queryRawUnsafe<Array<{ id: number; filename: string }>>(
    "SELECT id, filename FROM media_assets ORDER BY id"
  );
  const databaseUploadPaths = new Set<string>();
  for (const row of rows) {
    const manifestPath = uploadManifestPathForFilename(row.filename);
    databaseUploadPaths.add(manifestPath);
    if (!manifestUploadPaths.has(manifestPath)) {
      throw new BackupServiceError("BACKUP_INVALID", "备份缺少数据库引用的媒体文件", 400);
    }
  }
  for (const manifestPath of manifestUploadPaths) {
    if (!databaseUploadPaths.has(manifestPath)) {
      throw new BackupServiceError("BACKUP_INVALID", "备份媒体文件清单与数据库不一致", 400);
    }
  }
}

async function validateCandidateDatabase(databasePath: string, manifest: BackupManifest, currentSchema: SchemaMetadata) {
  const candidatePrisma = createPrismaClient(`file:${databasePath}`);
  try {
    await sqliteIntegrityCheck(candidatePrisma);
    const candidateSchema = await collectSchemaMetadata(candidatePrisma);
    assertSchemaMetadataCompatible(currentSchema, manifest, candidateSchema);
    if (manifest.formatVersion === 3) await assertV3NonIdentityDatabase(candidatePrisma, 400);
    await validateMediaManifestReferences(candidatePrisma, manifest);
    return candidatePrisma;
  } catch (error) {
    await candidatePrisma.$disconnect().catch(() => undefined);
    if (error instanceof BackupServiceError) throw error;
    throw new BackupServiceError("BACKUP_INVALID", "备份数据库完整性校验失败", 400, error);
  }
}

async function determineBackupCompatibility(
  prisma: AppPrismaClient,
  manifest: BackupManifest,
  currentSchema: SchemaMetadata
) {
  await sqliteIntegrityCheck(prisma);
  const candidateSchema = await collectSchemaMetadata(prisma);
  const compatibility = assertSchemaMetadataCompatible(currentSchema, manifest, candidateSchema);
  if (manifest.formatVersion === 3) await assertV3NonIdentityDatabase(prisma, 400);
  return compatibility;
}

function sqlInStringList(values: readonly string[]) {
  return values.map(safeSqliteStringLiteral).join(", ");
}

async function tableRowCount(prisma: AppPrismaClient, table: string) {
  if (!(await sqliteTableExists(prisma, table))) return 0;
  const rows = await prisma.$queryRawUnsafe<Array<{ count: number | bigint }>>(
    `SELECT COUNT(*) AS count FROM ${table}`
  );
  return Number(rows[0]?.count ?? 0);
}

async function attachCurrentIdentityDatabase(prisma: AppPrismaClient, currentDatabasePath: string) {
  await prisma.$executeRawUnsafe(
    `ATTACH DATABASE ${safeSqliteStringLiteral(currentDatabasePath)} AS current_identity`
  );
}

async function detachCurrentIdentityDatabase(prisma: AppPrismaClient) {
  await prisma.$executeRawUnsafe("DETACH DATABASE current_identity").catch(() => undefined);
}

async function preserveTargetIdentityPlane(
  prisma: AppPrismaClient,
  currentDatabasePath: string
) {
  await attachCurrentIdentityDatabase(prisma, currentDatabasePath);
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{
      revokedSessionCount: number | bigint;
      revokedResetTokenCount: number | bigint;
    }>>(
      `SELECT
        (SELECT COUNT(*) FROM current_identity.admin_sessions WHERE revokedAt IS NULL) AS revokedSessionCount,
        (SELECT COUNT(*) FROM current_identity.admin_password_reset_tokens WHERE usedAt IS NULL AND revokedAt IS NULL) AS revokedResetTokenCount`
    );
    const revokedSessionCount = Number(rows[0]?.revokedSessionCount ?? 0);
    const revokedResetTokenCount = Number(rows[0]?.revokedResetTokenCount ?? 0);

    await prisma.$executeRawUnsafe("BEGIN IMMEDIATE");
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE media_assets
          SET createdBy = (
            SELECT current_admin.id
            FROM admin_users candidate_admin
            JOIN current_identity.admin_users current_admin
              ON current_admin.publicId = candidate_admin.publicId
            WHERE candidate_admin.id = media_assets.createdBy
          )
          WHERE createdBy IS NOT NULL`
      );
      await prisma.$executeRawUnsafe(
        `UPDATE operation_logs
          SET createdBy = (
            SELECT current_admin.id
            FROM admin_users candidate_admin
            JOIN current_identity.admin_users current_admin
              ON current_admin.publicId = candidate_admin.publicId
            WHERE candidate_admin.id = operation_logs.createdBy
          )
          WHERE createdBy IS NOT NULL`
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM edgeone_prefetch_attempts
          WHERE prefetchResourceId IN (
            SELECT resource.id
            FROM edgeone_prefetch_resources resource
            LEFT JOIN admin_users candidate_admin ON candidate_admin.id = resource.createdBy
            LEFT JOIN current_identity.admin_users current_admin
              ON current_admin.publicId = candidate_admin.publicId
            WHERE current_admin.id IS NULL
          )`
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM edgeone_prefetch_resources
          WHERE id IN (
            SELECT resource.id
            FROM edgeone_prefetch_resources resource
            LEFT JOIN admin_users candidate_admin ON candidate_admin.id = resource.createdBy
            LEFT JOIN current_identity.admin_users current_admin
              ON current_admin.publicId = candidate_admin.publicId
            WHERE current_admin.id IS NULL
          )`
      );
      await prisma.$executeRawUnsafe(
        `UPDATE edgeone_prefetch_resources
          SET createdBy = (
            SELECT current_admin.id
            FROM admin_users candidate_admin
            JOIN current_identity.admin_users current_admin
              ON current_admin.publicId = candidate_admin.publicId
            WHERE candidate_admin.id = edgeone_prefetch_resources.createdBy
          )`
      );

      await prisma.$executeRawUnsafe("DELETE FROM admin_password_reset_tokens");
      await prisma.$executeRawUnsafe("DELETE FROM admin_sessions");
      await prisma.$executeRawUnsafe("DELETE FROM admin_menu_permissions");
      await prisma.$executeRawUnsafe("DELETE FROM admin_notifications");
      await prisma.$executeRawUnsafe("DELETE FROM admin_users");
      await prisma.$executeRawUnsafe(
        `INSERT INTO admin_users
          (id, publicId, username, passwordHash, role, status, activatedAt, createdAt, updatedAt)
          SELECT id, publicId, username, passwordHash, role, status, activatedAt, createdAt, updatedAt
          FROM current_identity.admin_users
          ORDER BY id`
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO admin_menu_permissions
          (id, adminId, menuKey, grantedBy, createdAt)
          SELECT id, adminId, menuKey, grantedBy, createdAt
          FROM current_identity.admin_menu_permissions
          ORDER BY id`
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO admin_notifications
          (id, adminId, clientEventId, level, message, occurredAt, createdAt)
          SELECT id, adminId, clientEventId, level, message, occurredAt, createdAt
          FROM current_identity.admin_notifications
          ORDER BY id`
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM sqlite_sequence
          WHERE name IN (
            'admin_users',
            'admin_menu_permissions',
            'admin_password_reset_tokens',
            'admin_notifications'
          )`
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO sqlite_sequence (name, seq)
          SELECT name, seq
          FROM current_identity.sqlite_sequence
          WHERE name IN (
            'admin_users',
            'admin_menu_permissions',
            'admin_password_reset_tokens',
            'admin_notifications'
          )`
      );
      await prisma.$executeRawUnsafe("COMMIT");
    } catch (error) {
      await prisma.$executeRawUnsafe("ROLLBACK").catch(() => undefined);
      throw error;
    }

    return { revokedSessionCount, revokedResetTokenCount };
  } finally {
    await detachCurrentIdentityDatabase(prisma);
    await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON").catch(() => undefined);
  }
}

async function validatePreparedIdentityPlane(prisma: AppPrismaClient) {
  const [enabledSuperCount, sessionCount, resetTokenCount, invalidPermissionRows, invalidMediaActorRows, invalidLogActorRows] =
    await Promise.all([
      tableRowCount(prisma, "admin_users").then(async () => {
        const rows = await prisma.$queryRawUnsafe<Array<{ count: number | bigint }>>(
          "SELECT COUNT(*) AS count FROM admin_users WHERE role = 'SUPER_ADMIN' AND status = 'enabled'"
        );
        return Number(rows[0]?.count ?? 0);
      }),
      tableRowCount(prisma, "admin_sessions"),
      tableRowCount(prisma, "admin_password_reset_tokens"),
      prisma.$queryRawUnsafe<Array<{ id: number; menuKey: string }>>(
        `SELECT id, menuKey
          FROM admin_menu_permissions
          WHERE menuKey NOT IN (${sqlInStringList(adminGrantableMenuKeyValues)})
          LIMIT 1`
      ),
      prisma.$queryRawUnsafe<Array<{ id: number }>>(
        `SELECT id
          FROM media_assets
          WHERE createdBy IS NOT NULL
            AND createdBy NOT IN (SELECT id FROM admin_users)
          LIMIT 1`
      ),
      prisma.$queryRawUnsafe<Array<{ id: number }>>(
        `SELECT id
          FROM operation_logs
          WHERE createdBy IS NOT NULL
            AND createdBy NOT IN (SELECT id FROM admin_users)
          LIMIT 1`
      )
    ]);

  if (enabledSuperCount < 1) {
    throw new BackupServiceError("BACKUP_RESTORE_FAILED", "恢复候选库缺少启用的超级管理员", 500);
  }
  if (sessionCount !== 0 || resetTokenCount !== 0) {
    throw new BackupServiceError("BACKUP_RESTORE_FAILED", "恢复候选库仍包含后台会话或重置令牌", 500);
  }
  if (invalidPermissionRows.length) {
    throw new BackupServiceError("BACKUP_RESTORE_FAILED", "恢复候选库包含无效菜单权限", 500);
  }
  if (invalidMediaActorRows.length || invalidLogActorRows.length) {
    throw new BackupServiceError("BACKUP_RESTORE_FAILED", "恢复候选库包含未映射的后台 actor", 500);
  }
}

async function validatePreparedRestoreDatabase(
  databasePath: string,
  manifest: BackupManifest,
  currentSchema: SchemaMetadata,
  compatibility: BackupCompatibility
) {
  const candidatePrisma = createPrismaClient(`file:${databasePath}`);
  try {
    await sqliteIntegrityCheck(candidatePrisma);
    const candidateSchema = await collectSchemaMetadata(candidatePrisma);
    assertPreparedRestoreSchemaCompatible(currentSchema, candidateSchema, compatibility);
    await validateMediaManifestReferences(candidatePrisma, manifest);
    await validatePreparedIdentityPlane(candidatePrisma);
  } catch (error) {
    if (error instanceof BackupServiceError) throw error;
    throw new BackupServiceError("BACKUP_RESTORE_FAILED", "恢复候选库身份安全校验失败", 500, error);
  } finally {
    await candidatePrisma.$disconnect().catch(() => undefined);
  }
}

async function prepareIdentitySafeRestoreCandidate(input: {
  databasePath: string;
  uploadDir: string;
  manifest: BackupManifest;
  currentDatabasePath: string;
  currentSchema: SchemaMetadata;
}) {
  const candidatePrisma = createPrismaClient(`file:${input.databasePath}`);
  let compatibility: BackupCompatibility;
  try {
    compatibility = await determineBackupCompatibility(candidatePrisma, input.manifest, input.currentSchema);
    if (compatibility.requiresRbacUpgrade) {
      await ensureDatabaseSchema(candidatePrisma, { uploadDir: input.uploadDir });
    }
    const invalidated = await preserveTargetIdentityPlane(candidatePrisma, input.currentDatabasePath);
    await candidatePrisma.$disconnect();
    await validatePreparedRestoreDatabase(
      input.databasePath,
      input.manifest,
      input.currentSchema,
      compatibility
    );
    return { compatibility, ...invalidated };
  } catch (error) {
    await candidatePrisma.$disconnect().catch(() => undefined);
    if (error instanceof BackupServiceError) throw error;
    throw new BackupServiceError("BACKUP_RESTORE_FAILED", "恢复候选库身份安全处理失败", 500, error);
  }
}

export const backupImpactTables = [
  "admin_users",
  "admin_menu_permissions",
  "admin_sessions",
  "admin_password_reset_tokens",
  "admin_notifications",
  "edgeone_prefetch_resources",
  "edgeone_prefetch_attempts",
  "media_assets",
  "media_asset_tags",
  "site_config",
  "system_config",
  "announcements",
  "banners",
  "menu_items",
  "artists",
  "activity_cases",
  "activity_case_media",
  "recent_activities",
  "articles",
  "detail_page_configs",
  "detail_page_banner_media",
  "detail_page_content_media",
  "daily_user_visits",
  "page_view_events",
  "operation_logs",
  "scheduled_task_states"
] as const;

const preservedCurrentIdentityTables = new Set([
  "admin_users",
  "admin_menu_permissions",
  "admin_notifications"
]);
const ignoredIdentityTables = new Set([
  "admin_sessions",
  "admin_password_reset_tokens"
]);

async function tableCounts(prisma: AppPrismaClient) {
  const tables = backupImpactTables;
  const counts: Record<string, number> = {};
  for (const table of tables) {
    if (!(await sqliteTableExists(prisma, table))) {
      counts[table] = 0;
      continue;
    }
    const rows = await prisma.$queryRawUnsafe<Array<{ count: number | bigint }>>(`SELECT COUNT(*) AS count FROM ${table}`);
    counts[table] = Number(rows[0]?.count ?? 0);
  }
  return counts;
}

function buildPreflightSummary(input: {
  source: BackupSource;
  backupKind: BackupKind;
  manifest: BackupManifest;
  currentCounts: Record<string, number>;
  candidateCounts: Record<string, number>;
}): BackupPreflightSummary {
  const tables = [...new Set([
    ...Object.keys(input.currentCounts),
    ...Object.keys(input.candidateCounts)
  ])].sort((left, right) => left.localeCompare(right, "en-US"));
  return backupPreflightSummarySchema.parse({
    formatVersion: input.manifest.formatVersion,
    identityRestorePolicy: backupIdentityRestorePolicy,
    dataScope: dataScopeForManifest(input.manifest),
    backupKind: input.backupKind,
    createdAt: input.manifest.createdAt,
    createdBy: input.manifest.createdBy,
    note: input.manifest.note,
    source: input.source,
    database: {
      size: input.manifest.database.size,
      snapshotMethod: input.manifest.database.snapshotMethod,
      pageSize: input.manifest.database.pageSize,
      pageCount: input.manifest.database.pageCount
    },
    uploads: {
      fileCount: input.manifest.uploads.length,
      totalBytes: input.manifest.uploads.reduce((sum, file) => sum + file.size, 0)
    },
    totals: {
      fileCount: input.manifest.totalFiles,
      totalBytes: input.manifest.totalBytes
    },
    checks: {
      manifest: "ok",
      checksums: "ok",
      sqliteIntegrity: "ok",
      schemaCompatible: true,
      mediaFiles: "ok"
    },
    impact: {
      tables: tables.map((table) => {
        const currentRows = input.currentCounts[table] ?? 0;
        const candidateRows = input.candidateCounts[table] ?? 0;
        const restoreBehavior = preservedCurrentIdentityTables.has(table)
          ? "preserved-current"
          : ignoredIdentityTables.has(table)
            ? "ignored"
            : "restored";
        return {
          table,
          currentRows,
          candidateRows,
          deltaRows: restoreBehavior === "restored" ? candidateRows - currentRows : 0,
          restoreBehavior
        };
      })
    }
  });
}

async function verifyExtractedFilesExactly(extractedFiles: string[], manifest: BackupManifest) {
  const expected = new Set([manifestFilename, manifest.database.path, ...manifest.uploads.map((file) => file.path)]);
  const actual = new Set(extractedFiles);
  if (expected.size !== actual.size || [...expected].some((file) => !actual.has(file))) {
    throw new BackupServiceError("BACKUP_INVALID", "备份归档文件清单与 manifest 不一致", 400);
  }
}

function isGzipArchive(buffer: Buffer, filename?: string | null) {
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) return true;
  return Boolean(filename && /\.t(?:ar\.)?gz$/i.test(filename));
}

async function gunzipWithLimit(source: Buffer) {
  const chunks: Buffer[] = [];
  let total = 0;
  return new Promise<Buffer>((resolve, reject) => {
    const gunzip = createGunzip();
    gunzip.on("data", (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > backupMaxExpandedBytes) {
        gunzip.destroy(new BackupServiceError("BACKUP_INVALID", "备份归档展开后过大", 413));
        return;
      }
      chunks.push(chunk);
    });
    gunzip.on("error", reject);
    gunzip.on("end", () => resolve(Buffer.concat(chunks, total)));
    Readable.from(source).pipe(gunzip);
  });
}

function tarString(block: Buffer, start: number, length: number) {
  const slice = block.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end >= 0 ? end : slice.length).toString("utf8").trim();
}

function tarOctal(block: Buffer, start: number, length: number) {
  const raw = tarString(block, start, length).replace(/\0/g, "").trim();
  if (!raw) return 0;
  if (!/^[0-7]+$/.test(raw)) {
    throw new BackupServiceError("BACKUP_INVALID", "备份归档 tar header 无效", 400);
  }
  return Number.parseInt(raw, 8);
}

function tarChecksumValid(block: Buffer) {
  const expected = tarOctal(block, 148, 8);
  let actual = 0;
  for (let index = 0; index < 512; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : block[index] ?? 0;
  }
  return actual === expected;
}

function isZeroTarBlock(block: Buffer) {
  return block.every((value) => value === 0);
}

function writeTarOctal(header: Buffer, value: number, start: number, length: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new BackupServiceError("BACKUP_INVALID", "备份归档 tar header 无效", 400);
  }
  const text = value.toString(8);
  if (text.length > length - 1) {
    throw new BackupServiceError("BACKUP_INVALID", "备份归档 tar header 超出限制", 400);
  }
  header.write(`${text.padStart(length - 1, "0")}\0`, start, length, "ascii");
}

function writeTarText(header: Buffer, value: string, start: number, length: number) {
  if (Buffer.byteLength(value) > length) {
    throw new BackupServiceError("BACKUP_INVALID", "备份归档 tar 路径超出限制", 400);
  }
  header.write(value, start, length, "utf8");
}

function ustarPathParts(archivePath: string) {
  if (Buffer.byteLength(archivePath) <= 100) return { name: archivePath, prefix: "" };
  const slashIndexes: number[] = [];
  for (let index = 0; index < archivePath.length; index += 1) {
    if (archivePath[index] === "/") slashIndexes.push(index);
  }
  for (const slashIndex of slashIndexes.reverse()) {
    const prefix = archivePath.slice(0, slashIndex);
    const name = archivePath.slice(slashIndex + 1);
    if (prefix && name && Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix };
    }
  }
  return null;
}

function tarHeader(input: {
  archivePath: string;
  size: number;
  typeflag?: "0" | "x";
}) {
  const parts = ustarPathParts(input.archivePath);
  if (!parts) {
    throw new BackupServiceError("BACKUP_INVALID", "备份归档 tar 路径超出限制", 400);
  }
  const header = Buffer.alloc(512, 0);
  writeTarText(header, parts.name, 0, 100);
  writeTarOctal(header, 0o600, 100, 8);
  writeTarOctal(header, 0, 108, 8);
  writeTarOctal(header, 0, 116, 8);
  writeTarOctal(header, input.size, 124, 12);
  writeTarOctal(header, 0, 136, 12);
  header.fill(0x20, 148, 156);
  header.write(input.typeflag ?? "0", 156, 1, "ascii");
  header.write("ustar", 257, 5, "ascii");
  header.write("00", 263, 2, "ascii");
  writeTarText(header, "eventarts", 265, 32);
  writeTarText(header, "eventarts", 297, 32);
  if (parts.prefix) writeTarText(header, parts.prefix, 345, 155);

  let checksum = 0;
  for (const byte of header) checksum += byte;
  const checksumText = checksum.toString(8).padStart(6, "0").slice(-6);
  header.write(`${checksumText}\0 `, 148, 8, "ascii");
  return header;
}

function tarPadding(size: number) {
  const padding = (512 - (size % 512)) % 512;
  return padding ? Buffer.alloc(padding, 0) : null;
}

function paxRecord(key: string, value: string) {
  let length = Buffer.byteLength(` ${key}=${value}\n`) + 1;
  while (true) {
    const record = `${length} ${key}=${value}\n`;
    const actualLength = Buffer.byteLength(record);
    if (actualLength === length) return record;
    length = actualLength;
  }
}

function paxHeaderNameForPath(archivePath: string) {
  return `PaxHeaders/${createHash("sha256").update(archivePath).digest("hex")}`;
}

function tarDataHeaderForPath(archivePath: string) {
  return ustarPathParts(archivePath) ? archivePath : `PaxData/${createHash("sha256").update(archivePath).digest("hex")}`;
}

function tarPathMetadata(archivePath: string) {
  const safePath = normalizeTarPath(archivePath, "0");
  const paxPayload = ustarPathParts(safePath) ? null : Buffer.from(paxRecord("path", safePath), "utf8");
  if (paxPayload && paxPayload.byteLength > paxHeaderMaxBytes) {
    throw new BackupServiceError("BACKUP_INVALID", "备份归档 tar 路径超出限制", 400);
  }
  return {
    archivePath: safePath,
    paxPayload
  };
}

async function* tarArchiveChunks(files: BackupArchiveFile[]) {
  for (const file of files) {
    const pathMetadata = tarPathMetadata(file.archivePath);
    if (pathMetadata.paxPayload) {
      yield tarHeader({
        archivePath: paxHeaderNameForPath(pathMetadata.archivePath),
        size: pathMetadata.paxPayload.byteLength,
        typeflag: "x"
      });
      yield pathMetadata.paxPayload;
      const paxPadding = tarPadding(pathMetadata.paxPayload.byteLength);
      if (paxPadding) yield paxPadding;
    }

    yield tarHeader({
      archivePath: tarDataHeaderForPath(pathMetadata.archivePath),
      size: file.size,
      typeflag: "0"
    });
    for await (const chunk of createReadStream(file.sourcePath)) {
      yield chunk as Buffer;
    }
    const padding = tarPadding(file.size);
    if (padding) yield padding;
  }
  yield Buffer.alloc(1024, 0);
}

function createBackupDownloadStream(files: BackupArchiveFile[]) {
  const tarStream = Readable.from(tarArchiveChunks(files));
  const gzipStream = createGzip();
  tarStream.once("error", (error) => {
    gzipStream.destroy(error);
  });
  return tarStream.pipe(gzipStream);
}

function parsePaxPath(payload: Buffer) {
  let offset = 0;
  let pathValue: string | null = null;
  while (offset < payload.byteLength) {
    const spaceIndex = payload.indexOf(0x20, offset);
    if (spaceIndex <= offset) {
      throw new BackupServiceError("BACKUP_INVALID", "备份归档 PAX header 无效", 400);
    }
    const lengthText = payload.subarray(offset, spaceIndex).toString("ascii");
    if (!/^[1-9]\d*$/.test(lengthText)) {
      throw new BackupServiceError("BACKUP_INVALID", "备份归档 PAX header 无效", 400);
    }
    const recordLength = Number(lengthText);
    if (!Number.isSafeInteger(recordLength) || recordLength <= 0 || offset + recordLength > payload.byteLength) {
      throw new BackupServiceError("BACKUP_INVALID", "备份归档 PAX header 无效", 400);
    }
    const record = payload.subarray(spaceIndex + 1, offset + recordLength).toString("utf8");
    if (!record.endsWith("\n")) {
      throw new BackupServiceError("BACKUP_INVALID", "备份归档 PAX header 无效", 400);
    }
    const body = record.slice(0, -1);
    const equalsIndex = body.indexOf("=");
    if (equalsIndex <= 0) {
      throw new BackupServiceError("BACKUP_INVALID", "备份归档 PAX header 无效", 400);
    }
    const key = body.slice(0, equalsIndex);
    const value = body.slice(equalsIndex + 1);
    if (key !== "path") {
      throw new BackupServiceError("BACKUP_INVALID", "备份归档包含不支持的 PAX header", 400);
    }
    if (pathValue !== null) {
      throw new BackupServiceError("BACKUP_INVALID", "备份归档包含重复 PAX path", 400);
    }
    pathValue = value;
    offset += recordLength;
  }
  if (!pathValue) {
    throw new BackupServiceError("BACKUP_INVALID", "备份归档 PAX header 缺少路径", 400);
  }
  return pathValue;
}

function assertSafeTarMetadataPath(rawPath: string) {
  const cleaned = rawPath.replace(/\/+$/g, "");
  if (
    !cleaned ||
    cleaned.includes("\0") ||
    cleaned.includes("\\") ||
    cleaned.startsWith("/") ||
    cleaned.startsWith("./") ||
    cleaned.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new BackupServiceError("BACKUP_INVALID", "备份归档包含不安全路径", 400);
  }
}

function normalizeTarPath(rawPath: string, typeflag: string) {
  const cleaned = rawPath.replace(/\/+$/g, "");
  if (
    !cleaned ||
    cleaned.includes("\0") ||
    cleaned.includes("\\") ||
    cleaned.startsWith("/") ||
    cleaned.startsWith("./") ||
    cleaned.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new BackupServiceError("BACKUP_INVALID", "备份归档包含不安全路径", 400);
  }
  if (typeflag === "5") {
    if (cleaned !== "uploads" && !cleaned.startsWith("uploads/")) {
      throw new BackupServiceError("BACKUP_INVALID", "备份归档包含不支持的目录", 400);
    }
    return cleaned;
  }
  if (cleaned !== manifestFilename && cleaned !== databaseSnapshotFilename && !cleaned.startsWith("uploads/")) {
    throw new BackupServiceError("BACKUP_INVALID", "备份归档包含不支持的文件", 400);
  }
  return cleaned;
}

async function extractTarBuffer(tarBuffer: Buffer, stagingDir: string): Promise<ExtractedArchive> {
  if (tarBuffer.byteLength > backupMaxExpandedBytes) {
    throw new BackupServiceError("BACKUP_INVALID", "备份归档展开后过大", 413);
  }

  const files = new Set<string>();
  let offset = 0;
  let fileCount = 0;
  let totalFileBytes = 0;
  let sawEnd = false;
  let pendingPaxPath: string | null = null;

  while (offset < tarBuffer.byteLength) {
    if (offset + 512 > tarBuffer.byteLength) {
      throw new BackupServiceError("BACKUP_INVALID", "备份归档 tar 结构无效", 400);
    }
    const header = tarBuffer.subarray(offset, offset + 512);
    offset += 512;
    if (isZeroTarBlock(header)) {
      if (pendingPaxPath) {
        throw new BackupServiceError("BACKUP_INVALID", "备份归档 PAX header 未绑定文件", 400);
      }
      sawEnd = true;
      break;
    }
    if (!tarChecksumValid(header)) {
      throw new BackupServiceError("BACKUP_INVALID", "备份归档 tar 校验失败", 400);
    }

    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const rawPath = prefix ? `${prefix}/${name}` : name;
    const typeflag = String.fromCharCode(header[156] || 0) || "0";
    const size = tarOctal(header, 124, 12);
    const dataEnd = offset + size;
    if (dataEnd > tarBuffer.byteLength) {
      throw new BackupServiceError("BACKUP_INVALID", "备份归档 tar 结构无效", 400);
    }

    if (typeflag === "x") {
      assertSafeTarMetadataPath(rawPath);
      if (pendingPaxPath) {
        throw new BackupServiceError("BACKUP_INVALID", "备份归档包含未使用的 PAX header", 400);
      }
      if (size <= 0 || size > paxHeaderMaxBytes) {
        throw new BackupServiceError("BACKUP_INVALID", "备份归档 PAX header 无效", 400);
      }
      pendingPaxPath = parsePaxPath(tarBuffer.subarray(offset, dataEnd));
      offset += Math.ceil(size / 512) * 512;
      continue;
    }

    if (["1", "2", "3", "4", "6", "7", "g", "K", "L"].includes(typeflag)) {
      throw new BackupServiceError("BACKUP_INVALID", "备份归档包含不支持或不安全的 tar 条目", 400);
    }
    const hasPaxPath = pendingPaxPath !== null;
    if (hasPaxPath && typeflag !== "0" && typeflag !== "\0") {
      throw new BackupServiceError("BACKUP_INVALID", "备份归档 PAX path 只能用于文件", 400);
    }
    const safePath = normalizeTarPath(pendingPaxPath ?? rawPath, typeflag);
    pendingPaxPath = null;

    if (typeflag === "5") {
      if (size !== 0) {
        throw new BackupServiceError("BACKUP_INVALID", "备份归档目录条目无效", 400);
      }
      await mkdir(manifestFilePath(stagingDir, safePath, 400), { recursive: true });
      continue;
    }
    if (typeflag !== "0" && typeflag !== "\0") {
      throw new BackupServiceError("BACKUP_INVALID", "备份归档包含不支持的 tar 条目", 400);
    }
    if (files.has(safePath)) {
      throw new BackupServiceError("BACKUP_INVALID", "备份归档包含重复文件", 400);
    }
    fileCount += 1;
    if (fileCount > backupMaxFileCount) {
      throw new BackupServiceError("BACKUP_INVALID", "备份归档文件数量过多", 413);
    }
    totalFileBytes += size;
    if (totalFileBytes > backupMaxExpandedBytes) {
      throw new BackupServiceError("BACKUP_INVALID", "备份归档展开后过大", 413);
    }

    const targetPath = manifestFilePath(stagingDir, safePath, 400);
    const existingEntry = await lstat(targetPath).catch(() => null);
    if (existingEntry) {
      throw new BackupServiceError("BACKUP_INVALID", "备份归档包含冲突路径", 400);
    }
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, tarBuffer.subarray(offset, dataEnd));
    files.add(safePath);
    offset += Math.ceil(size / 512) * 512;
  }

  if (!sawEnd || !files.has(manifestFilename)) {
    throw new BackupServiceError("BACKUP_INVALID", "备份归档缺少 manifest", 400);
  }
  return {
    files: [...files].sort((left, right) => left.localeCompare(right, "en-US")),
    totalFileBytes,
    expandedBytes: tarBuffer.byteLength
  };
}

async function extractArchiveBuffer(input: {
  archive: Buffer;
  originalName?: string | null;
  stagingDir: string;
}): Promise<ExtractedArchive> {
  if (!input.archive.byteLength) {
    throw new BackupServiceError("BACKUP_INVALID", "备份归档为空", 400);
  }
  if (input.archive.byteLength > backupArchiveMaxBytes) {
    throw new BackupServiceError("BACKUP_INVALID", "备份归档过大", 413);
  }
  const tarBuffer = isGzipArchive(input.archive, input.originalName)
    ? await gunzipWithLimit(input.archive)
    : input.archive;
  if (tarBuffer.byteLength / Math.max(input.archive.byteLength, 1) > backupMaxExpansionRatio) {
    throw new BackupServiceError("BACKUP_INVALID", "备份归档展开比过高", 413);
  }
  return extractTarBuffer(tarBuffer, input.stagingDir);
}

async function listBackupRecords(backupDir: string): Promise<BackupRecord[]> {
  await mkdir(backupDir, { recursive: true });
  const dir = await opendir(backupDir);
  const records: BackupRecord[] = [];
  for await (const entry of dir) {
    if (entry.name.startsWith(".")) continue;
    const backupPath = path.join(backupDir, entry.name);
    const entryStat = await lstat(backupPath).catch(() => null);
    if (!entryStat || !entryStat.isDirectory() || entryStat.isSymbolicLink()) continue;
    try {
      records.push({ id: entry.name, path: backupPath, manifest: await readManifest(backupPath) });
    } catch {
      continue;
    }
  }
  return records.sort(compareBackupRecordsNewestFirst);
}

function compareBackupRecordsNewestFirst(left: BackupRecord, right: BackupRecord) {
  const createdAtOrder = right.manifest.createdAt.localeCompare(left.manifest.createdAt, "en-US");
  if (createdAtOrder !== 0) return createdAtOrder;
  return right.id.localeCompare(left.id, "en-US");
}

function isLocalSuccessfulAutomaticBackupRecord(record: BackupRecord) {
  return (
    !record.id.startsWith("import-") &&
    record.manifest.formatVersion === 3 &&
    record.manifest.status === "ready" &&
    record.manifest.backupKind === "automatic"
  );
}

async function ensureSafeDirectory(pathname: string) {
  const entryStat = await lstat(pathname).catch(() => null);
  if (!entryStat || !entryStat.isDirectory() || entryStat.isSymbolicLink()) {
    throw new BackupServiceError("BACKUP_NOT_FOUND", "备份不存在", 404);
  }
}

async function archiveFileForPath(backupPath: string, archivePath: string): Promise<BackupArchiveFile> {
  const safeArchivePath = normalizeTarPath(archivePath, "0");
  const sourcePath = manifestFilePath(backupPath, safeArchivePath, 400);
  const entryStat = await lstat(sourcePath).catch(() => null);
  if (!entryStat || !entryStat.isFile() || entryStat.isSymbolicLink()) {
    throw new BackupServiceError("BACKUP_INVALID", "备份清单包含非普通文件", 400);
  }
  return {
    archivePath: safeArchivePath,
    sourcePath,
    size: entryStat.size
  };
}

async function downloadArchiveFiles(backupPath: string, manifest: BackupManifest): Promise<BackupArchiveFile[]> {
  if (manifest.database.path !== databaseSnapshotFilename) {
    throw new BackupServiceError("BACKUP_INVALID", "备份数据库快照路径无效", 400);
  }
  if (manifest.totalFiles > backupMaxFileCount) {
    throw new BackupServiceError("BACKUP_INVALID", "备份归档文件数量过多", 413);
  }
  const entries = [
    await archiveFileForPath(backupPath, manifestFilename),
    await archiveFileForPath(backupPath, manifest.database.path)
  ];
  for (const file of manifest.uploads) {
    entries.push(await archiveFileForPath(backupPath, file.path));
  }
  return entries;
}

async function verifyRestoredUploadFiles(uploadRoot: string, manifest: BackupManifest) {
  for (const file of manifest.uploads) {
    const absolutePath = restoredUploadFilePath(uploadRoot, file.path);
    const entryStat = await lstat(absolutePath).catch(() => null);
    if (!entryStat || !entryStat.isFile() || entryStat.isSymbolicLink() || entryStat.size !== file.size) {
      throw new BackupServiceError("BACKUP_RESTORE_FAILED", "恢复后媒体文件校验失败", 500);
    }
    const actualSha256 = await sha256File(absolutePath);
    if (actualSha256 !== file.sha256) {
      throw new BackupServiceError("BACKUP_RESTORE_FAILED", "恢复后媒体文件校验失败", 500);
    }
  }
}

async function materializeRestoreCandidate(input: {
  backupPath: string;
  manifest: BackupManifest;
  restoreId: string;
  databasePath: string;
  uploadDir: string;
}) {
  const databaseParent = path.dirname(input.databasePath);
  const uploadParent = path.dirname(input.uploadDir);
  await mkdir(databaseParent, { recursive: true });
  await mkdir(uploadParent, { recursive: true });
  const newDatabasePath = path.join(databaseParent, `.${path.basename(input.databasePath)}.${input.restoreId}.new`);
  const newUploadDir = path.join(uploadParent, `.${path.basename(input.uploadDir)}.${input.restoreId}.new`);
  await rm(newDatabasePath, { force: true });
  await rm(newUploadDir, { recursive: true, force: true });
  await copyFile(manifestFilePath(input.backupPath, input.manifest.database.path), newDatabasePath);
  await mkdir(newUploadDir, { recursive: true });
  for (const file of input.manifest.uploads) {
    const sourcePath = manifestFilePath(input.backupPath, file.path);
    const targetPath = restoredUploadFilePath(newUploadDir, file.path);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
  }
  await verifyRestoredUploadFiles(newUploadDir, input.manifest);
  return { newDatabasePath, newUploadDir };
}

type SwitchState = {
  databasePath: string;
  uploadDir: string;
  newDatabasePath: string;
  newUploadDir: string;
  oldDatabasePath: string;
  oldUploadDir: string;
  failedDatabasePath: string;
  failedUploadDir: string;
  databaseOldMoved: boolean;
  databaseNewMoved: boolean;
  uploadOldMoved: boolean;
  uploadNewMoved: boolean;
};

function sqliteSidecars(databasePath: string) {
  return [`${databasePath}-wal`, `${databasePath}-shm`, `${databasePath}-journal`];
}

async function renameIfExists(source: string, target: string) {
  const entryStat = await lstat(source).catch(() => null);
  if (!entryStat) return false;
  await rm(target, { recursive: entryStat.isDirectory(), force: true });
  await rename(source, target);
  return true;
}

async function rollbackSwitchState(state: SwitchState) {
  if (state.uploadNewMoved) {
    await renameIfExists(state.uploadDir, state.failedUploadDir).catch(() => undefined);
  }
  if (state.uploadOldMoved) {
    await renameIfExists(state.oldUploadDir, state.uploadDir).catch(() => undefined);
  }
  if (state.databaseNewMoved) {
    await renameIfExists(state.databasePath, state.failedDatabasePath).catch(() => undefined);
  }
  if (state.databaseOldMoved) {
    await renameIfExists(state.oldDatabasePath, state.databasePath).catch(() => undefined);
  }
  for (const [sourceSidecar, targetSidecar] of sqliteSidecars(state.oldDatabasePath).map((source, index) => [
    source,
    sqliteSidecars(state.databasePath)[index]
  ] as const)) {
    await renameIfExists(sourceSidecar, targetSidecar).catch(() => undefined);
  }
}

async function removeSqliteSidecars(databasePath: string) {
  for (const sidecar of sqliteSidecars(databasePath)) {
    await rm(sidecar, { force: true }).catch(() => undefined);
  }
}

async function switchProductionState(input: {
  prisma: AppPrismaClient;
  manifest: BackupManifest;
  currentSchema: SchemaMetadata;
  compatibility: BackupCompatibility;
  restoreId: string;
  backupId: string;
  databasePath: string;
  uploadDir: string;
  newDatabasePath: string;
  newUploadDir: string;
  hooks?: BackupServiceHooks;
}) {
  const databaseParent = path.dirname(input.databasePath);
  const uploadParent = path.dirname(input.uploadDir);
  const oldDatabasePath = path.join(databaseParent, `.${path.basename(input.databasePath)}.${input.restoreId}.old`);
  const oldUploadDir = path.join(uploadParent, `.${path.basename(input.uploadDir)}.${input.restoreId}.old`);
  const failedDatabasePath = path.join(databaseParent, `.${path.basename(input.databasePath)}.${input.restoreId}.failed`);
  const failedUploadDir = path.join(uploadParent, `.${path.basename(input.uploadDir)}.${input.restoreId}.failed`);
  const state: SwitchState = {
    databasePath: input.databasePath,
    uploadDir: input.uploadDir,
    newDatabasePath: input.newDatabasePath,
    newUploadDir: input.newUploadDir,
    oldDatabasePath,
    oldUploadDir,
    failedDatabasePath,
    failedUploadDir,
    databaseOldMoved: false,
    databaseNewMoved: false,
    uploadOldMoved: false,
    uploadNewMoved: false
  };

  try {
    await input.hooks?.beforeRestoreSwitch?.({
      restoreId: input.restoreId,
      backupId: input.backupId,
      candidateDir: path.dirname(input.newDatabasePath)
    });
    await input.prisma.$executeRawUnsafe("PRAGMA wal_checkpoint(FULL)").catch(() => undefined);
    await input.prisma.$disconnect();
    await rm(oldDatabasePath, { force: true });
    await rm(oldUploadDir, { recursive: true, force: true });
    await rm(failedDatabasePath, { force: true });
    await rm(failedUploadDir, { recursive: true, force: true });

    await rename(input.databasePath, oldDatabasePath);
    state.databaseOldMoved = true;
    for (const [sourceSidecar, targetSidecar] of sqliteSidecars(input.databasePath).map((source, index) => [
      source,
      sqliteSidecars(oldDatabasePath)[index]
    ] as const)) {
      await renameIfExists(sourceSidecar, targetSidecar);
    }
    await rename(input.newDatabasePath, input.databasePath);
    state.databaseNewMoved = true;
    await input.hooks?.afterRestoreDatabaseSwitch?.({ restoreId: input.restoreId, backupId: input.backupId });

    await rename(input.uploadDir, oldUploadDir);
    state.uploadOldMoved = true;
    await rename(input.newUploadDir, input.uploadDir);
    state.uploadNewMoved = true;
    await input.hooks?.afterRestoreUploadSwitch?.({ restoreId: input.restoreId, backupId: input.backupId });

    await validatePreparedRestoreDatabase(
      input.databasePath,
      input.manifest,
      input.currentSchema,
      input.compatibility
    );
    await verifyRestoredUploadFiles(input.uploadDir, input.manifest);
    await rm(oldDatabasePath, { force: true }).catch(() => undefined);
    await rm(oldUploadDir, { recursive: true, force: true }).catch(() => undefined);
    for (const sidecar of sqliteSidecars(oldDatabasePath)) {
      await rm(sidecar, { force: true }).catch(() => undefined);
    }
    await removeSqliteSidecars(input.databasePath);
  } catch (error) {
    await rollbackSwitchState(state);
    await rm(input.newDatabasePath, { force: true }).catch(() => undefined);
    await rm(input.newUploadDir, { recursive: true, force: true }).catch(() => undefined);
    throw new BackupServiceError("BACKUP_RESTORE_FAILED", "恢复切换失败，已尝试回滚到恢复前状态", 500, error);
  }
}

export function createBackupService(options: BackupServiceOptions) {
  const uploadDir = path.resolve(options.uploadDir);
  const backupDir = path.resolve(options.backupDir);
  const databasePath = parseSqliteFilePath(options.databaseUrl);
  const now = options.now ?? (() => new Date());
  let createInProgress = false;
  let restoreInProgress = false;
  const activeBackupAccess = new Map<string, { downloads: number; deleting: boolean }>();

  if (isSameOrInside(uploadDir, backupDir)) {
    throw new BackupServiceError("BACKUP_INVALID", "备份目录不能位于 uploads 内部", 500);
  }

  function backupPathForId(backupId: string) {
    const parsedId = parseBackupId(backupId);
    const backupPath = path.join(backupDir, parsedId);
    if (!isSameOrInside(backupDir, backupPath)) {
      throw new BackupServiceError("BACKUP_INVALID", "备份 ID 无效", 400);
    }
    return { backupId: parsedId, backupPath };
  }

  function backupAccessForId(backupId: string) {
    const existing = activeBackupAccess.get(backupId);
    if (existing) return existing;
    const access = { downloads: 0, deleting: false };
    activeBackupAccess.set(backupId, access);
    return access;
  }

  function cleanupBackupAccess(backupId: string) {
    const access = activeBackupAccess.get(backupId);
    if (access && access.downloads === 0 && !access.deleting) {
      activeBackupAccess.delete(backupId);
    }
  }

  function acquireDownloadLease(backupId: string) {
    const access = backupAccessForId(backupId);
    if (access.deleting) {
      cleanupBackupAccess(backupId);
      throw new BackupServiceError("BACKUP_CONFLICT", "备份正在删除，暂不可下载", 409);
    }
    access.downloads += 1;
    let released = false;
    return () => {
      if (released) return false;
      released = true;
      const current = activeBackupAccess.get(backupId);
      if (current) current.downloads = Math.max(0, current.downloads - 1);
      cleanupBackupAccess(backupId);
      return true;
    };
  }

  function acquireDeleteLease(backupId: string) {
    const access = backupAccessForId(backupId);
    if (access.deleting) {
      cleanupBackupAccess(backupId);
      throw new BackupServiceError("BACKUP_CONFLICT", "备份正在删除，暂不可删除", 409);
    }
    if (access.downloads > 0) {
      throw new BackupServiceError("BACKUP_CONFLICT", "备份正在下载，暂不可删除", 409);
    }
    access.deleting = true;
    let released = false;
    return () => {
      if (released) return false;
      released = true;
      const current = activeBackupAccess.get(backupId);
      if (current) current.deleting = false;
      cleanupBackupAccess(backupId);
      return true;
    };
  }

  async function loadBackupRecord(backupId: string) {
    const resolved = backupPathForId(backupId);
    await ensureSafeDirectory(resolved.backupPath);
    return {
      ...resolved,
      manifest: await readManifest(resolved.backupPath, 400)
    };
  }

  async function preflightBackupDirectory(
    backupId: string,
    backupPath: string,
    source: BackupSource,
    extractedFiles?: string[]
  ): Promise<BackupPreflightResult> {
    const manifest = await readManifest(backupPath, 400);
    ensureReadyManifest(manifest);
    if (extractedFiles) await verifyExtractedFilesExactly(extractedFiles, manifest);
    await verifyManifestFiles(backupPath, manifest, 400);
    const currentSchema = await collectSchemaMetadata(options.prisma);
    const candidateDatabasePath = manifestFilePath(backupPath, manifest.database.path, 400);
    const candidatePrisma = await validateCandidateDatabase(candidateDatabasePath, manifest, currentSchema);
    try {
      const [currentCounts, candidateCounts] = await Promise.all([
        tableCounts(options.prisma),
        tableCounts(candidatePrisma)
      ]);
      return {
        backup: toBackupDto(backupId, manifest),
        manifest,
        summary: buildPreflightSummary({
          source,
          backupKind: backupKindForLocalRecord(backupId, manifest),
          manifest,
          currentCounts,
          candidateCounts
        })
      };
    } finally {
      await candidatePrisma.$disconnect();
    }
  }

  const service = {
    async createBackup(input: {
      createdBy?: BackupAdmin;
      note?: string | null;
      backupKind?: Exclude<BackupKind, "imported">;
    }): Promise<BackupDto> {
      if (createInProgress) {
        throw new BackupServiceError("BACKUP_CONFLICT", "已有备份创建任务正在进行，请稍后重试", 409);
      }
      createInProgress = true;
      let stagingDir: string | null = null;
      try {
        const createdAt = now();
        const backupId = makeBackupId(createdAt);
        await mkdir(backupDir, { recursive: true });
        const stagingRoot = path.join(backupDir, ".staging");
        await mkdir(stagingRoot, { recursive: true });
        stagingDir = await mkdtemp(path.join(stagingRoot, `${backupId}-`));

        await stat(await activeDatabasePath(options.prisma, databasePath));
        const schema = await collectSchemaMetadata(options.prisma);
        let database = await snapshotDatabase(options.prisma, path.join(stagingDir, databaseSnapshotFilename));
        await options.hooks?.afterDatabaseSnapshot?.({ backupId, stagingDir });
        database = await sanitizeV3NonIdentityDatabaseSnapshot(path.join(stagingDir, databaseSnapshotFilename));

        const uploadEntries: BackupManifest["uploads"] = [];
        for (const file of await collectUploadFiles(uploadDir, backupDir)) {
          const targetPath = manifestFilePath(stagingDir, file.manifestPath);
          const copied = await hashCopiedFile(file.sourcePath, targetPath);
          uploadEntries.push({
            path: file.manifestPath,
            size: copied.size,
            sha256: copied.sha256,
            modifiedAt: file.modifiedAt
          });
        }

        const totalBytes = database.size + uploadEntries.reduce((sum, file) => sum + file.size, 0);
        const backupKind = input.backupKind ?? "manual";
        const manifest: BackupManifest = {
          formatVersion: backupFormatVersion,
          identityRestorePolicy: backupIdentityRestorePolicy,
          dataScope: "non_identity",
          backupKind,
          status: "ready",
          app: apiAppMetadata,
          schema,
          createdBy: anonymousBackupCreator(backupKind),
          createdAt: toIso(createdAt),
          note: backupKind === "automatic" ? null : input.note ?? null,
          database,
          uploads: uploadEntries,
          totalBytes,
          totalFiles: 1 + uploadEntries.length,
          sha256: computeBackupDigest(database, uploadEntries, backupFormatVersion)
        };

        await validateV3BackupSnapshotBeforePublish(path.join(stagingDir, databaseSnapshotFilename), manifest);
        await verifyManifestFiles(stagingDir, manifest);
        await options.hooks?.beforePublish?.({ backupId, stagingDir, manifest });
        await writeFile(path.join(stagingDir, manifestFilename), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
        const parsedManifest = backupManifestSchema.parse(JSON.parse(await readFile(path.join(stagingDir, manifestFilename), "utf8")));
        await validateV3BackupSnapshotBeforePublish(path.join(stagingDir, databaseSnapshotFilename), parsedManifest);
        await verifyManifestFiles(stagingDir, parsedManifest);

        const publishedPath = path.join(backupDir, backupId);
        await rename(stagingDir, publishedPath);
        stagingDir = null;
        return toBackupDto(backupId, manifest);
      } catch (error) {
        if (stagingDir) await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      } finally {
        createInProgress = false;
      }
    },

    async pruneAutomaticBackups(input: {
      keep?: number;
    } = {}): Promise<AutomaticBackupRetentionResult> {
      const keepCount = input.keep ?? automaticBackupRetentionKeepCount;
      if (!Number.isInteger(keepCount) || keepCount < 1) {
        throw new BackupServiceError("BACKUP_INVALID", "自动备份保留数量配置无效", 500);
      }
      const automaticRecords = (await listBackupRecords(backupDir))
        .filter(isLocalSuccessfulAutomaticBackupRecord)
        .sort(compareBackupRecordsNewestFirst);
      const retained = automaticRecords.slice(0, keepCount);
      const candidates = automaticRecords.slice(keepCount);
      const deletedBackupIds: string[] = [];
      const skippedConflictBackupIds: string[] = [];

      for (const record of candidates) {
        try {
          await service.deleteBackup(record.id);
          deletedBackupIds.push(record.id);
        } catch (error) {
          if (error instanceof BackupServiceError && error.code === "BACKUP_CONFLICT") {
            skippedConflictBackupIds.push(record.id);
            continue;
          }
          throw error;
        }
      }

      return {
        keepCount,
        automaticBackupCount: automaticRecords.length,
        retainedBackupIds: retained.map((record) => record.id),
        deletedBackupIds,
        skippedConflictBackupIds
      };
    },

    async listBackups(): Promise<BackupDto[]> {
      const records = await listBackupRecords(backupDir);
      return records.map((record) => toBackupDto(record.id, record.manifest));
    },

    async createDownloadArchive(backupId: string) {
      const { backupId: parsedBackupId, backupPath } = backupPathForId(backupId);
      const release = acquireDownloadLease(parsedBackupId);
      try {
        await ensureSafeDirectory(backupPath);
        const manifest = await readManifest(backupPath, 400);
        ensureReadyManifest(manifest, 409, "备份当前状态不可下载");
        await verifyManifestFiles(backupPath, manifest, 400);
        const files = await downloadArchiveFiles(backupPath, manifest);
        return {
          backup: toBackupDto(parsedBackupId, manifest),
          filename: `${parsedBackupId}.tar.gz`,
          contentType: backupDownloadContentType,
          declaredBytes: manifest.totalBytes,
          manifestBytes: files[0]?.size ?? 0,
          sha256: manifest.sha256,
          stream: createBackupDownloadStream(files),
          release
        };
      } catch (error) {
        release();
        throw error;
      }
    },

    async deleteBackup(backupId: string): Promise<{ backupId: string }> {
      const { backupId: parsedBackupId, backupPath } = backupPathForId(backupId);
      const releaseDelete = acquireDeleteLease(parsedBackupId);
      try {
        await ensureSafeDirectory(backupPath);
        const manifest = await readManifest(backupPath);
        if (nonDeletableStatuses.has(manifest.status)) {
          throw new BackupServiceError("BACKUP_CONFLICT", "备份当前状态不可删除", 409);
        }

        const deletingRoot = path.join(backupDir, ".deleting");
        await mkdir(deletingRoot, { recursive: true });
        const deletingPath = path.join(deletingRoot, `${parsedBackupId}-${randomBytes(6).toString("hex")}`);
        await rename(backupPath, deletingPath);
        await rm(deletingPath, { recursive: true, force: true });
        return { backupId: parsedBackupId };
      } finally {
        releaseDelete();
      }
    },

    async importArchive(input: {
      archive: Buffer;
      originalName?: string | null;
      importedBy: BackupAdmin;
    }): Promise<BackupPreflightResult> {
      if (restoreInProgress) {
        throw new BackupServiceError("BACKUP_CONFLICT", "系统正在恢复备份，请稍后重试", 409);
      }
      const importId = makeImportBackupId(now());
      await mkdir(backupDir, { recursive: true });
      const importRoot = path.join(backupDir, ".imports");
      await mkdir(importRoot, { recursive: true });
      let stagingDir: string | null = await mkdtemp(path.join(importRoot, `${importId}-`));
      try {
        const extracted = await extractArchiveBuffer({
          archive: input.archive,
          originalName: input.originalName,
          stagingDir
        });
        const preflight = await preflightBackupDirectory(importId, stagingDir, "external_archive", extracted.files);
        const publishedPath = path.join(backupDir, importId);
        await rename(stagingDir, publishedPath);
        stagingDir = null;
        return {
          ...preflight,
          backup: toBackupDto(importId, preflight.manifest),
          summary: backupPreflightSummarySchema.parse({
            ...preflight.summary,
            source: "external_archive"
          })
        };
      } catch (error) {
        if (stagingDir) await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
        if (error instanceof BackupServiceError) throw error;
        throw new BackupServiceError("BACKUP_INVALID", "备份归档预检失败", 400, error);
      }
    },

    async preflightBackup(backupId: string): Promise<BackupPreflightResult> {
      const record = await loadBackupRecord(backupId);
      return preflightBackupDirectory(record.backupId, record.backupPath, "existing_backup");
    },

    async restoreBackup(input: { backupId: string; createdBy: BackupAdmin }): Promise<RestoreResult> {
      if (createInProgress || restoreInProgress) {
        throw new BackupServiceError("BACKUP_CONFLICT", "已有备份或恢复任务正在进行，请稍后重试", 409);
      }
      restoreInProgress = true;
      const restoreId = makeRestoreId(now());
      let materialized: { newDatabasePath: string; newUploadDir: string } | null = null;
      let invalidated = { revokedSessionCount: 0, revokedResetTokenCount: 0 };
      try {
        const record = await loadBackupRecord(input.backupId);
        const preflight = await preflightBackupDirectory(record.backupId, record.backupPath, "existing_backup");
        const safetySnapshot = await service.createBackup({
          createdBy: input.createdBy,
          backupKind: "restore_snapshot",
          note: `Pre-restore safety snapshot before ${record.backupId}`
        });
        const activePath = await activeDatabasePath(options.prisma, databasePath);
        materialized = await materializeRestoreCandidate({
          backupPath: record.backupPath,
          manifest: preflight.manifest,
          restoreId,
          databasePath: activePath,
          uploadDir
        });
        const currentSchema = await collectSchemaMetadata(options.prisma);
        const prepared = await prepareIdentitySafeRestoreCandidate({
          databasePath: materialized.newDatabasePath,
          uploadDir: materialized.newUploadDir,
          manifest: preflight.manifest,
          currentDatabasePath: activePath,
          currentSchema
        });
        invalidated = {
          revokedSessionCount: prepared.revokedSessionCount,
          revokedResetTokenCount: prepared.revokedResetTokenCount
        };
        await switchProductionState({
          prisma: options.prisma,
          manifest: preflight.manifest,
          currentSchema,
          compatibility: prepared.compatibility,
          restoreId,
          backupId: record.backupId,
          databasePath: activePath,
          uploadDir,
          newDatabasePath: materialized.newDatabasePath,
          newUploadDir: materialized.newUploadDir,
          hooks: options.hooks
        });
        materialized = null;
        return {
          restoreId,
          backupId: record.backupId,
          snapshotBackupId: safetySnapshot.id,
          revokedSessionCount: invalidated.revokedSessionCount,
          revokedResetTokenCount: invalidated.revokedResetTokenCount,
          preflight: preflight.summary
        };
      } catch (error) {
        if (materialized) {
          await rm(materialized.newDatabasePath, { force: true }).catch(() => undefined);
          await rm(materialized.newUploadDir, { recursive: true, force: true }).catch(() => undefined);
        }
        if (error instanceof BackupServiceError) throw error;
        throw new BackupServiceError("BACKUP_RESTORE_FAILED", "恢复失败，当前数据已保持或回滚到恢复前状态", 500, error);
      } finally {
        restoreInProgress = false;
      }
    },

    backupDir
  };
  return service;
}
