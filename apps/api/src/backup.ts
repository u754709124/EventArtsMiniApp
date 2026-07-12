import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, opendir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import {
  backupDtoSchema,
  backupIdSchema,
  backupManifestSchema,
  backupPreflightSummarySchema,
  type BackupDto,
  type BackupManifest,
  type BackupPreflightSummary
} from "@event-arts/shared";
import { createPrismaClient, type AppPrismaClient } from "./db";

export const backupFormatVersion = 1;
export const backupArchiveMaxBytes = 256 * 1024 * 1024;
export const backupMaxExpandedBytes = 512 * 1024 * 1024;
export const backupMaxFileCount = 10_000;
export const backupMaxExpansionRatio = 200;
const manualSchemaMigrationId = "manual-sqlite-schema";
const manifestFilename = "manifest.json";
const databaseSnapshotFilename = "database.sqlite";
const snapshotMethod = "sqlite-vacuum-into" as const;
const apiAppMetadata = { name: "api", version: "0.1.0" };
const nonDeletableStatuses = new Set(["verifying", "restoring"]);

type BackupAdmin = {
  id: number;
  username: string;
};

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
  preflight: BackupPreflightSummary;
};

type ExtractedArchive = {
  files: string[];
  totalFileBytes: number;
  expandedBytes: number;
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

function computeBackupDigest(database: BackupManifest["database"], uploads: BackupManifest["uploads"]) {
  const hash = createHash("sha256");
  hash.update(`format:${backupFormatVersion}\n`);
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
  const [metadata, sha256] = await Promise.all([stat(targetPath), sha256File(targetPath)]);
  const [pageSizeRows, pageCountRows] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ page_size: number | bigint }>>("PRAGMA page_size"),
    prisma.$queryRawUnsafe<Array<{ page_count: number | bigint }>>("PRAGMA page_count")
  ]);
  return {
    path: databaseSnapshotFilename,
    size: metadata.size,
    sha256,
    snapshotMethod,
    pageSize: Number(pageSizeRows[0]?.page_size ?? 0),
    pageCount: Number(pageCountRows[0]?.page_count ?? 0)
  };
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
  const digest = computeBackupDigest(manifest.database, manifest.uploads);
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
    (raw as { formatVersion?: unknown }).formatVersion !== backupFormatVersion
  ) {
    throw new BackupServiceError("BACKUP_UNSUPPORTED_VERSION", "备份格式版本不兼容", 409);
  }
  const parsed = backupManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BackupServiceError("BACKUP_INVALID", "备份清单格式无效", invalidStatusCode, parsed.error);
  }
  return parsed.data;
}

function toBackupDto(id: string, manifest: BackupManifest): BackupDto {
  return backupDtoSchema.parse({
    id,
    formatVersion: manifest.formatVersion,
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

function ensureReadyManifest(manifest: BackupManifest, statusCode = 400) {
  if (manifest.status !== "ready") {
    throw new BackupServiceError("BACKUP_CONFLICT", "备份当前状态不可恢复", statusCode);
  }
}

function sameStringList(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function assertSchemaMetadataCompatible(current: SchemaMetadata, manifest: SchemaMetadata, candidate: SchemaMetadata) {
  const expectedMigrations = [...manifest.migrationIds].sort((left, right) => left.localeCompare(right, "en-US"));
  const currentMigrations = [...current.migrationIds].sort((left, right) => left.localeCompare(right, "en-US"));
  const candidateMigrations = [...candidate.migrationIds].sort((left, right) => left.localeCompare(right, "en-US"));
  const candidateMatchesManifest =
    candidate.provider === manifest.provider &&
    candidate.userVersion === manifest.userVersion &&
    candidate.schemaHash.toLowerCase() === manifest.schemaHash.toLowerCase() &&
    sameStringList(candidateMigrations, expectedMigrations);
  const currentMatchesManifest =
    current.provider === manifest.provider &&
    current.userVersion === manifest.userVersion &&
    current.schemaHash.toLowerCase() === manifest.schemaHash.toLowerCase() &&
    sameStringList(currentMigrations, expectedMigrations);

  if (!candidateMatchesManifest || !currentMatchesManifest) {
    throw new BackupServiceError("BACKUP_UNSUPPORTED_VERSION", "备份数据库 schema 与当前版本不兼容", 409);
  }
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
    assertSchemaMetadataCompatible(currentSchema, manifest.schema, candidateSchema);
    await validateMediaManifestReferences(candidatePrisma, manifest);
    return candidatePrisma;
  } catch (error) {
    await candidatePrisma.$disconnect().catch(() => undefined);
    if (error instanceof BackupServiceError) throw error;
    throw new BackupServiceError("BACKUP_INVALID", "备份数据库完整性校验失败", 400, error);
  }
}

async function tableCounts(prisma: AppPrismaClient) {
  const tables = [
    "admin_users",
    "admin_sessions",
    "media_assets",
    "media_asset_tags",
    "site_config",
    "announcements",
    "banners",
    "menu_items",
    "artists",
    "activity_cases",
    "activity_case_media",
    "articles",
    "detail_page_configs",
    "detail_page_banner_media",
    "detail_page_content_media",
    "page_view_events",
    "operation_logs"
  ];
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
        return {
          table,
          currentRows,
          candidateRows,
          deltaRows: candidateRows - currentRows
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

  while (offset < tarBuffer.byteLength) {
    if (offset + 512 > tarBuffer.byteLength) {
      throw new BackupServiceError("BACKUP_INVALID", "备份归档 tar 结构无效", 400);
    }
    const header = tarBuffer.subarray(offset, offset + 512);
    offset += 512;
    if (isZeroTarBlock(header)) {
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

    if (["1", "2", "3", "4", "6", "7", "x", "g", "K", "L"].includes(typeflag)) {
      throw new BackupServiceError("BACKUP_INVALID", "备份归档包含不支持或不安全的 tar 条目", 400);
    }
    const safePath = normalizeTarPath(rawPath, typeflag);

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

    const dataEnd = offset + size;
    if (dataEnd > tarBuffer.byteLength) {
      throw new BackupServiceError("BACKUP_INVALID", "备份归档 tar 结构无效", 400);
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
  return records.sort((left, right) => right.manifest.createdAt.localeCompare(left.manifest.createdAt));
}

async function ensureSafeDirectory(pathname: string) {
  const entryStat = await lstat(pathname).catch(() => null);
  if (!entryStat || !entryStat.isDirectory() || entryStat.isSymbolicLink()) {
    throw new BackupServiceError("BACKUP_NOT_FOUND", "备份不存在", 404);
  }
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

    const activePrisma = await validateCandidateDatabase(input.databasePath, input.manifest, input.currentSchema);
    await activePrisma.$disconnect();
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
    async createBackup(input: { createdBy: BackupAdmin; note?: string | null }): Promise<BackupDto> {
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
        const database = await snapshotDatabase(options.prisma, path.join(stagingDir, databaseSnapshotFilename));
        await options.hooks?.afterDatabaseSnapshot?.({ backupId, stagingDir });

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
        const manifest: BackupManifest = {
          formatVersion: backupFormatVersion,
          status: "ready",
          app: apiAppMetadata,
          schema,
          createdBy: { adminId: input.createdBy.id, username: input.createdBy.username },
          createdAt: toIso(createdAt),
          note: input.note ?? null,
          database,
          uploads: uploadEntries,
          totalBytes,
          totalFiles: 1 + uploadEntries.length,
          sha256: computeBackupDigest(database, uploadEntries)
        };

        await verifyManifestFiles(stagingDir, manifest);
        await options.hooks?.beforePublish?.({ backupId, stagingDir, manifest });
        await writeFile(path.join(stagingDir, manifestFilename), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
        const parsedManifest = backupManifestSchema.parse(JSON.parse(await readFile(path.join(stagingDir, manifestFilename), "utf8")));
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

    async listBackups(): Promise<BackupDto[]> {
      const records = await listBackupRecords(backupDir);
      return records.map((record) => toBackupDto(record.id, record.manifest));
    },

    async deleteBackup(backupId: string): Promise<{ backupId: string }> {
      const { backupPath } = backupPathForId(backupId);
      await ensureSafeDirectory(backupPath);
      const manifest = await readManifest(backupPath);
      if (nonDeletableStatuses.has(manifest.status)) {
        throw new BackupServiceError("BACKUP_CONFLICT", "备份当前状态不可删除", 409);
      }

      const deletingRoot = path.join(backupDir, ".deleting");
      await mkdir(deletingRoot, { recursive: true });
      const deletingPath = path.join(deletingRoot, `${backupId}-${randomBytes(6).toString("hex")}`);
      await rename(backupPath, deletingPath);
      await rm(deletingPath, { recursive: true, force: true });
      return { backupId };
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
      try {
        const record = await loadBackupRecord(input.backupId);
        const preflight = await preflightBackupDirectory(record.backupId, record.backupPath, "existing_backup");
        const safetySnapshot = await service.createBackup({
          createdBy: input.createdBy,
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
        await switchProductionState({
          prisma: options.prisma,
          manifest: preflight.manifest,
          currentSchema,
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
