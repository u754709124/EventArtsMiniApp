import { createHash, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { backupManifestSchema, type BackupManifest } from "@event-arts/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createPrismaClient, type AppPrismaClient } from "../src/db";
import type { BackupServiceHooks } from "../src/backup";
import { createApiLoggerOptions } from "../src/logging";
import { ensureDatabaseSchema } from "../src/sqlite-schema";
import { resetTestAdmin, testAdminCredentials } from "./fixtures";

type LogEntry = Record<string, unknown>;

let root: string;
let uploadDir: string;
let backupDir: string;
let databasePath: string;
let databaseUrl: string;
let prisma: AppPrismaClient;
let app: Awaited<ReturnType<typeof buildApp>> | null;
let logs: LogEntry[];
let extraCleanupPaths: string[];

function createLogCapture() {
  logs = [];
  return {
    write(message: string) {
      for (const line of message.split("\n")) {
        if (!line.trim()) continue;
        logs.push(JSON.parse(line) as LogEntry);
      }
    }
  };
}

function securityEvents() {
  return logs
    .filter((entry) => entry.event === "security")
    .map((entry) => entry.securityEvent);
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function startApp(hooks?: BackupServiceHooks) {
  app = await buildApp({
    prisma,
    jwtSecret: "restore-test-secret",
    uploadDir,
    backupDir,
    databaseUrl,
    publicBaseUrl: "http://127.0.0.1:3001",
    logger: createApiLoggerOptions({ stream: createLogCapture(), level: "info" }),
    backupHooks: hooks
  });
  return app;
}

async function login() {
  if (!app) throw new Error("app not started");
  const response = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: testAdminCredentials
  });
  expect(response.statusCode).toBe(200);
  return String(response.json().data.token);
}

async function createBackup(token: string, note = `restore-${randomUUID()}`) {
  if (!app) throw new Error("app not started");
  const response = await app.inject({
    method: "POST",
    url: "/api/admin/backups",
    headers: auth(token),
    payload: { note }
  });
  expect(response.statusCode).toBe(200);
  return response.json().data.backup as { id: string; size: number; sha256: string };
}

async function readManifest(backupId: string) {
  return backupManifestSchema.parse(
    JSON.parse(await readFile(path.join(backupDir, backupId, "manifest.json"), "utf8"))
  );
}

async function publishedBackupIds() {
  const entries = await readdir(backupDir).catch(() => []);
  const visible: string[] = [];
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const entryStat = await lstat(path.join(backupDir, entry));
    if (entryStat.isDirectory()) visible.push(entry);
  }
  return visible.sort();
}

function sha256Buffer(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function backupDigest(
  database: BackupManifest["database"],
  uploads: BackupManifest["uploads"],
  formatVersion: 1 | 2 | 3 = 3
) {
  const hash = createHash("sha256");
  hash.update(`format:${formatVersion}\n`);
  hash.update(`database:${database.path}:${database.size}:${database.sha256}\n`);
  for (const file of uploads) hash.update(`upload:${file.path}:${file.size}:${file.sha256}\n`);
  return hash.digest("hex");
}

function writeTarOctal(header: Buffer, value: number, start: number, length: number) {
  const text = value.toString(8).padStart(length - 1, "0").slice(-(length - 1));
  header.write(`${text}\0`, start, length, "ascii");
}

function tarEntry(input: { name: string; data?: Buffer; type?: string; linkname?: string }) {
  const data = input.data ?? Buffer.alloc(0);
  const header = Buffer.alloc(512, 0);
  header.write(input.name, 0, Math.min(Buffer.byteLength(input.name), 100), "utf8");
  writeTarOctal(header, 0o644, 100, 8);
  writeTarOctal(header, 0, 108, 8);
  writeTarOctal(header, 0, 116, 8);
  writeTarOctal(header, input.type === "5" || input.type === "2" ? 0 : data.byteLength, 124, 12);
  writeTarOctal(header, 0, 136, 12);
  header.fill(0x20, 148, 156);
  header.write(input.type ?? "0", 156, 1, "ascii");
  if (input.linkname) header.write(input.linkname, 157, Math.min(Buffer.byteLength(input.linkname), 100), "utf8");
  header.write("ustar", 257, 5, "ascii");
  header.write("00", 263, 2, "ascii");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  const checksumText = checksum.toString(8).padStart(6, "0");
  header.write(`${checksumText}\0 `, 148, 8, "ascii");
  const padding = Buffer.alloc((512 - (data.byteLength % 512)) % 512, 0);
  return input.type === "5" || input.type === "2"
    ? header
    : Buffer.concat([header, data, padding]);
}

function tarArchive(entries: Array<{ name: string; data?: Buffer; type?: string; linkname?: string }>) {
  return Buffer.concat([...entries.map(tarEntry), Buffer.alloc(1024, 0)]);
}

async function archiveBackup(backupId: string, options: { gzip?: boolean } = {}) {
  const manifest = await readManifest(backupId);
  const rootPath = path.join(backupDir, backupId);
  const entries = [
    { name: "manifest.json", data: await readFile(path.join(rootPath, "manifest.json")) },
    { name: manifest.database.path, data: await readFile(path.join(rootPath, manifest.database.path)) },
    ...await Promise.all(manifest.uploads.map(async (file) => ({
      name: file.path,
      data: await readFile(path.join(rootPath, file.path))
    })))
  ];
  const archive = tarArchive(entries);
  return options.gzip ? gzipSync(archive) : archive;
}

function multipartBody(fieldName: string, filename: string, content: Buffer) {
  const boundary = `----eventarts-${randomUUID()}`;
  const header = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
    "Content-Type: application/octet-stream\r\n\r\n",
    "utf8"
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  return {
    payload: Buffer.concat([header, content, footer]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` }
  };
}

async function importArchive(token: string, archive: Buffer, filename = "backup.tar.gz") {
  const multipart = multipartBody("file", filename, archive);
  return app!.inject({
    method: "POST",
    url: "/api/admin/backups/import",
    headers: { ...auth(token), ...multipart.headers },
    payload: multipart.payload
  });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "event-arts-g09-"));
  uploadDir = path.join(root, "uploads");
  backupDir = path.join(root, "backups");
  databasePath = path.join(root, "test.db");
  databaseUrl = `file:${databasePath}`;
  await mkdir(uploadDir, { recursive: true });
  prisma = createPrismaClient(databaseUrl);
  await ensureDatabaseSchema(prisma, { uploadDir });
  await resetTestAdmin(prisma);
  app = null;
  logs = [];
  extraCleanupPaths = [];
});

afterEach(async () => {
  if (app) await app.close();
  await prisma.$disconnect();
  for (const cleanupPath of extraCleanupPaths) {
    await rm(cleanupPath, { recursive: true, force: true }).catch(() => undefined);
  }
  await rm(root, { recursive: true, force: true });
});

describe("admin backup import preflight", () => {
  it("imports a tar.gz archive into an isolated backup entry and returns only a safe impact summary", async () => {
    await startApp();
    const token = await login();
    const sourceBackup = await createBackup(token, "source");
    const archive = await archiveBackup(sourceBackup.id, { gzip: true });

    const response = await importArchive(token, archive);

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.backup.id).toMatch(/^import-/);
    expect(body.data.preflight).toMatchObject({
      source: "external_archive",
      checks: {
        manifest: "ok",
        checksums: "ok",
        sqliteIntegrity: "ok",
        schemaCompatible: true,
        mediaFiles: "ok"
      }
    });
    expect(body.data.preflight.impact.tables).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "system_config", currentRows: 0, candidateRows: 0 })
    ]));
    expect(body.data.manifest).toBeUndefined();
    const text = JSON.stringify(body);
    expect(text).not.toContain(backupDir);
    expect(text).not.toContain(databasePath);
    expect(text).not.toContain("database.sqlite");
    expect(await publishedBackupIds()).toEqual(expect.arrayContaining([sourceBackup.id, body.data.backup.id]));
    expect(securityEvents()).toEqual(expect.arrayContaining([
      "backup_import_requested",
      "backup_import_completed"
    ]));
    await expect(prisma.operationLog.findFirstOrThrow({
      where: { action: "IMPORT_BACKUP" }
    })).resolves.toMatchObject({ createdBy: expect.any(Number) });
  });

  it("rejects traversal paths, symlinks, unsupported versions, checksum mismatches, bad SQLite, and media list mismatches before publishing", async () => {
    await startApp();
    const token = await login();
    const sourceBackup = await createBackup(token, "source");
    const validManifest = await readManifest(sourceBackup.id);
    const validDatabase = await readFile(path.join(backupDir, sourceBackup.id, validManifest.database.path));

    const rejectedArchives = [
      tarArchive([{ name: "../evil.txt", data: Buffer.from("evil") }]),
      tarArchive([{ name: "uploads/link", type: "2", linkname: "/tmp/secret" }]),
      tarArchive([
        { name: "manifest.json", data: Buffer.from(JSON.stringify({ ...validManifest, formatVersion: 999 })) },
        { name: "database.sqlite", data: validDatabase }
      ]),
      tarArchive([
        { name: "manifest.json", data: await readFile(path.join(backupDir, sourceBackup.id, "manifest.json")) },
        { name: "database.sqlite", data: Buffer.from("bad") }
      ])
    ];

    const brokenDatabase = Buffer.from("not sqlite");
    const brokenDatabaseManifest: BackupManifest = {
      ...validManifest,
      database: {
        ...validManifest.database,
        size: brokenDatabase.byteLength,
        sha256: sha256Buffer(brokenDatabase)
      },
      totalBytes: brokenDatabase.byteLength,
      totalFiles: 1,
      uploads: []
    };
    const badSqliteManifest = {
      ...brokenDatabaseManifest,
      sha256: backupDigest(brokenDatabaseManifest.database, [])
    };
    rejectedArchives.push(tarArchive([
      { name: "manifest.json", data: Buffer.from(JSON.stringify(badSqliteManifest)) },
      { name: "database.sqlite", data: brokenDatabase }
    ]));

    const orphanContent = Buffer.from("orphan upload");
    const orphanUploads: BackupManifest["uploads"] = [
      ...validManifest.uploads,
      {
        path: "uploads/orphan.txt",
        size: orphanContent.byteLength,
        sha256: sha256Buffer(orphanContent),
        modifiedAt: "2026-07-19T00:00:00.000Z"
      }
    ];
    const orphanManifest: BackupManifest = {
      ...validManifest,
      uploads: orphanUploads,
      totalBytes: validManifest.database.size + orphanUploads.reduce((sum, file) => sum + file.size, 0),
      totalFiles: 1 + orphanUploads.length,
      sha256: backupDigest(validManifest.database, orphanUploads, validManifest.formatVersion)
    };
    rejectedArchives.push(tarArchive([
      { name: "manifest.json", data: Buffer.from(JSON.stringify(orphanManifest)) },
      { name: validManifest.database.path, data: validDatabase },
      { name: "uploads/orphan.txt", data: orphanContent }
    ]));

    for (const archive of rejectedArchives) {
      const response = await importArchive(token, archive, "bad.tar");
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.json().success).toBe(false);
    }

    expect(await publishedBackupIds()).toEqual([sourceBackup.id]);
    expect(securityEvents()).toContain("backup_import_rejected");
    const failureLogs = await prisma.operationLog.findMany({ where: { action: "IMPORT_BACKUP_FAILED" } });
    expect(failureLogs.length).toBeGreaterThanOrEqual(rejectedArchives.length);
    expect(JSON.stringify(logs)).not.toContain("not sqlite");
  });
});

describe("admin backup restore", () => {
  it("requires exact confirmation and backup id before any restore mutation", async () => {
    await startApp();
    const token = await login();
    const backup = await createBackup(token, "target");
    const beforeIds = await publishedBackupIds();
    await prisma.operationLog.create({ data: { action: "CURRENT_SENTINEL", detail: "still-current" } });

    const response = await app!.inject({
      method: "POST",
      url: `/api/admin/backups/${backup.id}/restore`,
      headers: auth(token),
      payload: { backupId: backup.id, confirmation: "WRONG" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      success: false,
      error: { code: "BACKUP_RESTORE_CONFIRMATION_REQUIRED" }
    });
    expect(await publishedBackupIds()).toEqual(beforeIds);
    await expect(prisma.operationLog.findFirstOrThrow({
      where: { action: "CURRENT_SENTINEL" }
    })).resolves.toMatchObject({ detail: "still-current" });
    await expect(prisma.operationLog.findFirst({
      where: { action: { in: ["RESTORE_BACKUP", "RESTORE_BACKUP_FAILED"] } }
    })).resolves.toBeNull();
  });

  it("creates a pre-restore snapshot, switches to the candidate state, and revokes all admin sessions", async () => {
    await startApp();
    const firstToken = await login();
    const secondToken = await login();
    const restoreAdmin = await prisma.adminUser.findUniqueOrThrow({
      where: { username: testAdminCredentials.username }
    });
    const targetNotificationId = randomUUID();
    const currentNotificationId = randomUUID();
    await prisma.adminNotification.create({
      data: {
        adminId: restoreAdmin.id,
        clientEventId: targetNotificationId,
        level: "info",
        message: "目标备份通知",
        occurredAt: new Date()
      }
    });
    const targetAnnouncementSummary = `target-announcement-${randomUUID()}`;
    const currentAnnouncementSummary = `current-announcement-${randomUUID()}`;
    await prisma.announcement.create({
      data: {
        summary: targetAnnouncementSummary,
        content: "will-be-restored",
        displayDurationMs: 3000,
        status: "enabled"
      }
    });
    await prisma.operationLog.create({ data: { action: "TARGET_STATE", detail: "will-be-restored" } });
    const targetBackup = await createBackup(firstToken, "target");
    await prisma.adminNotification.deleteMany({ where: { clientEventId: targetNotificationId } });
    await prisma.adminNotification.create({
      data: {
        adminId: restoreAdmin.id,
        clientEventId: currentNotificationId,
        level: "warning",
        message: "恢复前当前通知",
        occurredAt: new Date()
      }
    });
    await prisma.announcement.deleteMany({ where: { summary: targetAnnouncementSummary } });
    await prisma.announcement.create({
      data: {
        summary: currentAnnouncementSummary,
        content: "will-disappear",
        displayDurationMs: 3000,
        status: "enabled"
      }
    });
    await prisma.operationLog.deleteMany({ where: { action: "TARGET_STATE" } });
    await prisma.operationLog.create({ data: { action: "CURRENT_STATE", detail: "will-disappear" } });

    const response = await app!.inject({
      method: "POST",
      url: `/api/admin/backups/${targetBackup.id}/restore`,
      headers: auth(firstToken),
      payload: { backupId: targetBackup.id, confirmation: "RESTORE_FULL_BACKUP" }
    });

    expect(response.statusCode, response.body).toBe(200);
    const restore = response.json().data as { backupId: string; restoreId: string; snapshotBackupId: string; revokedSessionCount: number };
    expect(restore.backupId).toBe(targetBackup.id);
    expect(restore.snapshotBackupId).toMatch(/^backup-/);
    expect(restore.revokedSessionCount).toBeGreaterThanOrEqual(2);

    await expect(prisma.announcement.findFirstOrThrow({ where: { summary: targetAnnouncementSummary } }))
      .resolves.toMatchObject({ content: "will-be-restored" });
    await expect(prisma.announcement.findFirst({ where: { summary: currentAnnouncementSummary } })).resolves.toBeNull();
    await expect(prisma.operationLog.findFirst({ where: { action: "TARGET_STATE" } })).resolves.toBeNull();
    await expect(prisma.operationLog.findFirst({ where: { action: "CURRENT_STATE" } })).resolves.toBeNull();
    await expect(prisma.adminNotification.findFirst({
      where: { clientEventId: targetNotificationId }
    })).resolves.toBeNull();
    await expect(prisma.adminNotification.findFirstOrThrow({
      where: { clientEventId: currentNotificationId }
    })).resolves.toMatchObject({ level: "warning", message: "恢复前当前通知" });
    await expect(prisma.operationLog.findFirstOrThrow({ where: { action: "RESTORE_BACKUP" } }))
      .resolves.toMatchObject({ createdBy: expect.any(Number) });
    const safetyManifest = await readManifest(restore.snapshotBackupId);
    expect(safetyManifest.note).toContain(targetBackup.id);

    const firstMe = await app!.inject({ method: "GET", url: "/api/admin/auth/me", headers: auth(firstToken) });
    const secondMe = await app!.inject({ method: "GET", url: "/api/admin/auth/me", headers: auth(secondToken) });
    expect(firstMe.statusCode).toBe(401);
    expect(secondMe.statusCode).toBe(401);
    expect(securityEvents()).toEqual(expect.arrayContaining([
      "backup_restore_requested",
      "backup_restore_completed"
    ]));
  });

  it("restores an imported archive when SQLite reports a different active path for a relative database URL", async () => {
    await prisma.$disconnect();
    await rm(root, { recursive: true, force: true });

    root = await mkdtemp(path.join(os.tmpdir(), "event-arts-g09-relative-"));
    uploadDir = path.join(root, "uploads");
    backupDir = path.join(root, "backups");
    await mkdir(uploadDir, { recursive: true });

    const relativeDatabaseName = `restore-import-${randomUUID()}.db`;
    databaseUrl = `file:../.tmp/${relativeDatabaseName}`;
    databasePath = path.resolve(process.cwd(), "../.tmp", relativeDatabaseName);
    extraCleanupPaths.push(databasePath, `${databasePath}-wal`, `${databasePath}-shm`, `${databasePath}-journal`);
    await mkdir(path.join(process.cwd(), ".tmp"), { recursive: true });

    prisma = createPrismaClient(databaseUrl);
    await ensureDatabaseSchema(prisma, { uploadDir });
    const databaseRows = await prisma.$queryRawUnsafe<Array<{ name: string; file: string }>>("PRAGMA database_list");
    const activeMainDatabase = databaseRows.find((row) => row.name === "main")?.file;
    expect(activeMainDatabase).toBeTruthy();
    extraCleanupPaths.push(
      activeMainDatabase!,
      `${activeMainDatabase!}-wal`,
      `${activeMainDatabase!}-shm`,
      `${activeMainDatabase!}-journal`
    );
    expect(path.resolve(activeMainDatabase!)).not.toBe(databasePath);
    await resetTestAdmin(prisma);
    await startApp();
    const token = await login();

    const importedTargetSummary = `imported-target-${randomUUID()}`;
    const importedCurrentSummary = `imported-current-${randomUUID()}`;
    await prisma.announcement.create({
      data: {
        summary: importedTargetSummary,
        content: "from-imported-archive",
        displayDurationMs: 3000,
        status: "enabled"
      }
    });
    const sourceBackup = await createBackup(token, "relative-import-target");
    await prisma.announcement.deleteMany({ where: { summary: importedTargetSummary } });
    await prisma.announcement.create({
      data: {
        summary: importedCurrentSummary,
        content: "should-disappear",
        displayDurationMs: 3000,
        status: "enabled"
      }
    });
    await prisma.operationLog.create({ data: { action: "RELATIVE_CURRENT", detail: "should-disappear" } });

    const importResponse = await importArchive(token, await archiveBackup(sourceBackup.id, { gzip: true }));
    expect(importResponse.statusCode).toBe(200);
    const importedBackupId = importResponse.json().data.backup.id as string;
    expect(importedBackupId).toMatch(/^import-/);

    const response = await app!.inject({
      method: "POST",
      url: `/api/admin/backups/${importedBackupId}/restore`,
      headers: auth(token),
      payload: { backupId: importedBackupId, confirmation: "RESTORE_FULL_BACKUP" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: { backupId: importedBackupId }
    });
    await expect(prisma.announcement.findFirstOrThrow({ where: { summary: importedTargetSummary } }))
      .resolves.toMatchObject({ content: "from-imported-archive" });
    await expect(prisma.announcement.findFirst({ where: { summary: importedCurrentSummary } })).resolves.toBeNull();
    await expect(prisma.operationLog.findFirst({ where: { action: "RELATIVE_CURRENT" } })).resolves.toBeNull();
  });

  it("blocks business writes during maintenance while restore is in progress", async () => {
    let release!: () => void;
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    await startApp({
      beforeRestoreSwitch: async () => {
        entered();
        await releasePromise;
      }
    });
    const token = await login();
    await prisma.operationLog.create({ data: { action: "MAINTENANCE_TARGET" } });
    const targetBackup = await createBackup(token, "maintenance-target");
    await prisma.operationLog.create({ data: { action: "MAINTENANCE_CURRENT" } });

    const restore = app!.inject({
      method: "POST",
      url: `/api/admin/backups/${targetBackup.id}/restore`,
      headers: auth(token),
      payload: { backupId: targetBackup.id, confirmation: "RESTORE_FULL_BACKUP" }
    });
    await enteredPromise;
    const blocked = await app!.inject({
      method: "POST",
      url: "/api/admin/announcements",
      headers: auth(token),
      payload: {}
    });
    release();
    const restored = await restore;

    expect(blocked.statusCode).toBe(503);
    expect(blocked.json()).toMatchObject({
      success: false,
      error: { code: "MAINTENANCE_MODE" }
    });
    expect(restored.statusCode).toBe(200);
  });

  it("rolls back to the pre-restore state when switching fails", async () => {
    await startApp({
      afterRestoreDatabaseSwitch: async () => {
        throw new Error("planned switch failure secret=restore-token");
      }
    });
    const token = await login();
    await prisma.operationLog.create({ data: { action: "ROLLBACK_TARGET" } });
    const targetBackup = await createBackup(token, "rollback-target");
    await prisma.operationLog.deleteMany({ where: { action: "ROLLBACK_TARGET" } });
    await prisma.operationLog.create({ data: { action: "ROLLBACK_CURRENT" } });

    const response = await app!.inject({
      method: "POST",
      url: `/api/admin/backups/${targetBackup.id}/restore`,
      headers: auth(token),
      payload: { backupId: targetBackup.id, confirmation: "RESTORE_FULL_BACKUP" }
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      success: false,
      error: { code: "BACKUP_RESTORE_FAILED" }
    });
    await expect(prisma.operationLog.findFirstOrThrow({ where: { action: "ROLLBACK_CURRENT" } }))
      .resolves.toBeTruthy();
    await expect(prisma.operationLog.findFirst({ where: { action: "ROLLBACK_TARGET" } })).resolves.toBeNull();
    const stillAuthorized = await app!.inject({ method: "GET", url: "/api/admin/auth/me", headers: auth(token) });
    expect(stillAuthorized.statusCode).toBe(200);
    expect(securityEvents()).toContain("backup_restore_failed");
    expect(JSON.stringify(logs)).not.toContain("restore-token");
  });
});
