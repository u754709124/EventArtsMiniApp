import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { backupManifestSchema, type BackupManifest } from "@event-arts/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createPrismaClient, type AppPrismaClient } from "../src/db";
import { createBackupService, type BackupServiceHooks } from "../src/backup";
import { createApiLoggerOptions } from "../src/logging";
import { ensureDatabaseSchema } from "../src/sqlite-schema";
import {
  readDecryptedEdgeOneSystemConfig,
  writeEdgeOneSystemConfig
} from "../src/system-config/edgeone-config-store";
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

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function startApp(hooks?: BackupServiceHooks) {
  app = await buildApp({
    prisma,
    jwtSecret: "backup-test-secret",
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

async function createBackup(token: string, note = `backup-${randomUUID()}`) {
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

function multipartBody(fieldName: string, filename: string, content: Buffer) {
  const boundary = `----eventarts-download-${randomUUID()}`;
  const header = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
    "Content-Type: application/gzip\r\n\r\n",
    "utf8"
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  return {
    payload: Buffer.concat([header, content, footer]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` }
  };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "event-arts-g08-"));
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
});

afterEach(async () => {
  if (app) await app.close();
  await prisma.$disconnect();
  await rm(root, { recursive: true, force: true });
});

describe("admin backup API", () => {
  it("requires administrator authentication for backup management routes", async () => {
    await startApp();

    const list = await app!.inject({ method: "GET", url: "/api/admin/backups" });
    const create = await app!.inject({ method: "POST", url: "/api/admin/backups", payload: {} });
    const download = await app!.inject({ method: "GET", url: "/api/admin/backups/missing/download" });
    const remove = await app!.inject({
      method: "DELETE",
      url: "/api/admin/backups/missing",
      payload: { backupId: "missing", confirmation: "DELETE_BACKUP" }
    });

    expect(list.statusCode).toBe(401);
    expect(create.statusCode).toBe(401);
    expect(download.statusCode).toBe(401);
    expect(remove.statusCode).toBe(401);
  });

  it("downloads a private verified archive that the existing import preflight accepts", async () => {
    const longDirectory = "a".repeat(90);
    const longFilename = `${longDirectory}/${"b".repeat(40)}.txt`;
    const longContent = "long pax path";
    await mkdir(path.join(uploadDir, longDirectory), { recursive: true });
    await writeFile(path.join(uploadDir, longFilename), longContent);
    await prisma.mediaAsset.create({
      data: {
        resourceName: "PAX 长路径素材",
        resourceNameKey: "pax-long-path",
        originalName: "long.txt",
        filename: longFilename,
        md5: "1".repeat(32),
        mimeType: "text/plain",
        mediaType: "file",
        url: `/uploads/${longFilename}`,
        size: Buffer.byteLength(longContent)
      }
    });
    await startApp();
    const token = await login();
    const backup = await createBackup(token, "download-roundtrip");

    const response = await app!.inject({
      method: "GET",
      url: `/api/admin/backups/${backup.id}/download`,
      headers: auth(token)
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/gzip");
    expect(response.headers["content-disposition"]).toBe(`attachment; filename="${backup.id}.tar.gz"`);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.rawPayload.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
    expect(response.body).not.toContain(backupDir);
    expect(response.body).not.toContain(databasePath);

    const multipart = multipartBody("file", `${backup.id}.tar.gz`, response.rawPayload);
    const imported = await app!.inject({
      method: "POST",
      url: "/api/admin/backups/import",
      headers: { ...auth(token), ...multipart.headers },
      payload: multipart.payload
    });
    expect(imported.statusCode, imported.body).toBe(200);
    expect(imported.json().data).toMatchObject({
      backup: { id: expect.stringMatching(/^import-/), status: "ready" },
      preflight: {
        source: "external_archive",
        checks: {
          manifest: "ok",
          checksums: "ok",
          sqliteIntegrity: "ok",
          schemaCompatible: true,
          mediaFiles: "ok"
        }
      }
    });
    expect(securityEvents()).toEqual(expect.arrayContaining([
      "backup_download_requested",
      "backup_download_completed"
    ]));
    await expect(prisma.operationLog.findFirstOrThrow({
      where: { action: "DOWNLOAD_BACKUP" }
    })).resolves.toMatchObject({ createdBy: expect.any(Number) });
  });

  it("rejects missing, non-ready, and damaged backup downloads without exposing an attachment", async () => {
    await startApp();
    const token = await login();
    const missing = await app!.inject({
      method: "GET",
      url: "/api/admin/backups/backup-missing/download",
      headers: auth(token)
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ success: false, error: { code: "BACKUP_NOT_FOUND" } });
    expect(missing.headers["content-disposition"]).toBeUndefined();

    const backup = await createBackup(token);
    const manifestPath = path.join(backupDir, backup.id, "manifest.json");
    const readyManifest = await readManifest(backup.id);
    await writeFile(manifestPath, `${JSON.stringify({ ...readyManifest, status: "restoring" }, null, 2)}\n`);
    const nonReady = await app!.inject({
      method: "GET",
      url: `/api/admin/backups/${backup.id}/download`,
      headers: auth(token)
    });
    expect(nonReady.statusCode).toBe(409);
    expect(nonReady.json()).toMatchObject({ success: false, error: { code: "BACKUP_CONFLICT" } });
    expect(nonReady.headers["content-disposition"]).toBeUndefined();

    await writeFile(manifestPath, `${JSON.stringify(readyManifest, null, 2)}\n`);
    await writeFile(path.join(backupDir, backup.id, readyManifest.database.path), "damaged");
    const damaged = await app!.inject({
      method: "GET",
      url: `/api/admin/backups/${backup.id}/download`,
      headers: auth(token)
    });
    expect(damaged.statusCode).toBe(400);
    expect(damaged.json()).toMatchObject({ success: false, error: { code: "BACKUP_INVALID" } });
    expect(damaged.headers["content-disposition"]).toBeUndefined();
  });

  it("blocks deletion while a backup download lease is active", async () => {
    await startApp();
    const token = await login();
    const backup = await createBackup(token);
    const service = createBackupService({ prisma, uploadDir, backupDir, databaseUrl });
    const download = await service.createDownloadArchive(backup.id);
    try {
      await expect(service.deleteBackup(backup.id)).rejects.toMatchObject({
        code: "BACKUP_CONFLICT",
        statusCode: 409
      });
    } finally {
      download.stream.destroy();
      download.release();
    }
  });

  it("prunes only local automatic backups and safely skips download conflicts", async () => {
    let current = new Date("2026-07-18T00:00:00.000Z");
    const service = createBackupService({
      prisma,
      uploadDir,
      backupDir,
      databaseUrl,
      now: () => current
    });
    const manual = await service.createBackup({ note: "manual-retention-keep" });
    current = new Date("2026-07-18T00:01:00.000Z");
    const restoreSnapshot = await service.createBackup({ backupKind: "restore_snapshot", note: "restore-retention-keep" });

    const automaticIds: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      current = new Date(Date.UTC(2026, 6, 18, 1, index, 0));
      automaticIds.push((await service.createBackup({ backupKind: "automatic" })).id);
    }
    const importId = `import-20260718T010500000Z-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await cp(path.join(backupDir, automaticIds[0]!), path.join(backupDir, importId), { recursive: true });

    const oldestAutomatic = automaticIds[0]!;
    const activeDownload = await service.createDownloadArchive(oldestAutomatic);
    try {
      const firstPrune = await service.pruneAutomaticBackups({ keep: 3 });
      expect(firstPrune).toMatchObject({
        keepCount: 3,
        automaticBackupCount: 5,
        deletedBackupIds: [automaticIds[1]],
        skippedConflictBackupIds: [oldestAutomatic]
      });
      expect(await publishedBackupIds()).toEqual(expect.arrayContaining([
        manual.id,
        restoreSnapshot.id,
        importId,
        oldestAutomatic,
        ...automaticIds.slice(2)
      ]));
    } finally {
      activeDownload.stream.destroy();
      activeDownload.release();
    }

    const secondPrune = await service.pruneAutomaticBackups({ keep: 3 });
    expect(secondPrune).toMatchObject({
      automaticBackupCount: 4,
      deletedBackupIds: [oldestAutomatic],
      skippedConflictBackupIds: []
    });
    const finalIds = await publishedBackupIds();
    expect(finalIds).toEqual(expect.arrayContaining([
      manual.id,
      restoreSnapshot.id,
      importId,
      ...automaticIds.slice(-3)
    ]));
    expect(finalIds).not.toEqual(expect.arrayContaining(automaticIds.slice(0, 2)));
    await expect(readManifest(manual.id)).resolves.toMatchObject({ backupKind: "manual" });
    await expect(readManifest(restoreSnapshot.id)).resolves.toMatchObject({ backupKind: "restore_snapshot" });
    await expect(readManifest(importId)).resolves.toMatchObject({ backupKind: "automatic" });
  });

  it("creates a versioned manifest with a VACUUM INTO database snapshot and safe upload file checksums", async () => {
    const edgeOneEncryptionKey = Buffer.alloc(32, 7);
    const edgeOneSecretId = ["BACKUP", "ONLY", "SECRET", "ID"].join("_");
    const edgeOneSecretKey = ["BACKUP", "ONLY", "SECRET", "KEY"].join("_");
    await mkdir(path.join(uploadDir, "nested"), { recursive: true });
    await mkdir(path.join(uploadDir, ".tmp"), { recursive: true });
    await mkdir(path.join(uploadDir, ".trash"), { recursive: true });
    await mkdir(path.join(uploadDir, "empty-dir"), { recursive: true });
    await writeFile(path.join(uploadDir, "visible.txt"), "visible upload");
    await writeFile(path.join(uploadDir, "nested", "photo.txt"), "nested upload");
    await writeFile(path.join(uploadDir, ".tmp", "ignored.upload"), "temporary");
    await writeFile(path.join(uploadDir, ".trash", "deleted.pending"), "deleted");
    await writeFile(path.join(uploadDir, ".hidden"), "hidden");
    await writeFile(path.join(root, "outside.txt"), "outside");
    await symlink(path.join(root, "outside.txt"), path.join(uploadDir, "linked.txt"));
    await prisma.operationLog.create({ data: { action: "PRE_BACKUP_SENTINEL", detail: "before snapshot" } });
    await prisma.dailyUserVisit.create({
      data: {
        appId: "wx-backup-test",
        openidHash: "backup-openid-hash",
        visitDate: "2026-07-12"
      }
    });
    await prisma.pageViewEvent.create({
      data: {
        pagePath: "/pages/home/index",
        scene: "backup-test",
        userAgent: "identity-test-agent",
        anonymousFingerprint: "fingerprint-backup-test",
        sampleWeight: 1
      }
    });
    await prisma.clientSession.create({
      data: {
        tokenHash: "c".repeat(64),
        appId: "wx-backup-test",
        openidHash: "client-openid-hash",
        expiresAt: new Date(Date.now() + 60_000)
      }
    });
    await prisma.scheduledTaskState.create({
      data: {
        taskKey: "backup-test-task",
        lastStatus: "success",
        resultSummaryJson: JSON.stringify({ operator: testAdminCredentials.username })
      }
    });
    await writeEdgeOneSystemConfig(prisma, edgeOneEncryptionKey, {
      zoneId: "zone-backup-test",
      secretId: edgeOneSecretId,
      secretKey: edgeOneSecretKey
    });
    await startApp();
    const token = await login();
    const backupAdmin = await prisma.adminUser.findUniqueOrThrow({
      where: { username: testAdminCredentials.username }
    });
    const notificationEventId = randomUUID();
    await prisma.adminNotification.create({
      data: {
        adminId: backupAdmin.id,
        clientEventId: notificationEventId,
        level: "success",
        message: "备份前通知",
        occurredAt: new Date()
      }
    });
    const nestedAsset = await prisma.mediaAsset.create({
      data: {
        resourceName: "Nested backup photo",
        resourceNameKey: "nested-backup-photo",
        originalName: "photo.txt",
        filename: "nested/photo.txt",
        md5: createHash("md5").update("nested upload").digest("hex"),
        mimeType: "text/plain",
        mediaType: "file",
        url: "/uploads/nested/photo.txt",
        size: Buffer.byteLength("nested upload"),
        createdBy: backupAdmin.id
      }
    });
    await prisma.mediaAsset.create({
      data: {
        resourceName: "Visible backup file",
        resourceNameKey: "visible-backup-file",
        originalName: "visible.txt",
        filename: "visible.txt",
        md5: createHash("md5").update("visible upload").digest("hex"),
        mimeType: "text/plain",
        mediaType: "file",
        url: "/uploads/visible.txt",
        size: Buffer.byteLength("visible upload"),
        createdBy: backupAdmin.id
      }
    });
    await prisma.$executeRawUnsafe(
      `INSERT INTO edgeone_prefetch_resources
        (zoneId, mediaAssetId, contentVersion, targetUrl, targetHash, status, createdBy)
        VALUES ('zone-backup-test', ?, 'v1', 'https://cdn.example.test/nested-photo', ?, 'reserved', ?)`,
      nestedAsset.id,
      "d".repeat(64),
      backupAdmin.id
    );
    const edgeOneRows = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
      "SELECT id FROM edgeone_prefetch_resources WHERE targetHash = ?",
      "d".repeat(64)
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO edgeone_prefetch_attempts
        (prefetchResourceId, attemptNumber, status)
        VALUES (?, 1, 'reserved')`,
      edgeOneRows[0]!.id
    );

    const backup = await createBackup(token, "手动备份");
    const manifest = await readManifest(backup.id);

    expect(manifest).toMatchObject({
      formatVersion: 3,
      identityRestorePolicy: "preserve_target",
      dataScope: "non_identity",
      backupKind: "manual",
      status: "ready",
      app: { name: "api", version: "0.1.0" },
      createdBy: { username: "后台管理员" },
      note: "手动备份",
      database: { path: "database.sqlite", snapshotMethod: "sqlite-vacuum-into" }
    });
    expect(manifest.createdBy).not.toHaveProperty("adminId");
    expect(manifest.createdBy).not.toHaveProperty("publicId");
    expect(JSON.stringify(manifest)).not.toContain(testAdminCredentials.username);
    expect(JSON.stringify(manifest)).not.toContain(backupAdmin.publicId);
    expect(manifest.schema).toMatchObject({
      provider: "sqlite",
      userVersion: expect.any(Number),
      schemaHash: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    expect(manifest.uploads.map((file) => file.path)).toEqual([
      "uploads/nested/photo.txt",
      "uploads/visible.txt"
    ]);

    const databaseSnapshotPath = path.join(backupDir, backup.id, manifest.database.path);
    expect(await sha256File(databaseSnapshotPath)).toBe(manifest.database.sha256);
    for (const file of manifest.uploads) {
      expect(await sha256File(path.join(backupDir, backup.id, file.path))).toBe(file.sha256);
    }
    expect(manifest.totalFiles).toBe(3);
    expect(manifest.totalBytes).toBe(manifest.database.size + manifest.uploads.reduce((total, file) => total + file.size, 0));
    expect(backup.size).toBe(manifest.totalBytes);
    expect(backup.sha256).toBe(manifest.sha256);

    const snapshotPrisma = createPrismaClient(`file:${databaseSnapshotPath}`);
    try {
      await expect(snapshotPrisma.adminUser.count()).resolves.toBe(0);
      await expect(snapshotPrisma.adminMenuPermission.count()).resolves.toBe(0);
      await expect(snapshotPrisma.adminSession.count()).resolves.toBe(0);
      await expect(snapshotPrisma.adminPasswordResetToken.count()).resolves.toBe(0);
      await expect(snapshotPrisma.adminNotification.count()).resolves.toBe(0);
      await expect(snapshotPrisma.clientSession.count()).resolves.toBe(0);
      await expect(snapshotPrisma.dailyUserVisit.count()).resolves.toBe(0);
      await expect(snapshotPrisma.pageViewEvent.count()).resolves.toBe(0);
      await expect(snapshotPrisma.operationLog.count()).resolves.toBe(0);
      await expect(snapshotPrisma.scheduledTaskState.count()).resolves.toBe(0);
      await expect(snapshotPrisma.edgeOnePrefetchResource.count()).resolves.toBe(0);
      await expect(snapshotPrisma.edgeOnePrefetchAttempt.count()).resolves.toBe(0);
      await expect(snapshotPrisma.mediaAsset.findMany({
        orderBy: { resourceNameKey: "asc" },
        select: { resourceNameKey: true, filename: true, createdBy: true }
      })).resolves.toEqual([
        { resourceNameKey: "nested-backup-photo", filename: "nested/photo.txt", createdBy: null },
        { resourceNameKey: "visible-backup-file", filename: "visible.txt", createdBy: null }
      ]);
      const snapshotConfig = await snapshotPrisma.systemConfig.findUniqueOrThrow({ where: { id: 1 } });
      expect(snapshotConfig).toMatchObject({ zoneId: "zone-backup-test" });
      expect(snapshotConfig.secretIdCiphertext).not.toContain(edgeOneSecretId);
      expect(snapshotConfig.secretKeyCiphertext).not.toContain(edgeOneSecretKey);
      await expect(readDecryptedEdgeOneSystemConfig(snapshotPrisma, edgeOneEncryptionKey)).resolves.toMatchObject({
        zoneId: "zone-backup-test",
        secretId: edgeOneSecretId,
        secretKey: edgeOneSecretKey
      });
      await expect(
        readDecryptedEdgeOneSystemConfig(snapshotPrisma, Buffer.alloc(32, 8))
      ).rejects.toThrow("could not be authenticated");
    } finally {
      await snapshotPrisma.$disconnect();
    }

    const createLog = await prisma.operationLog.findFirstOrThrow({ where: { action: "CREATE_BACKUP" } });
    expect(createLog.createdBy).toBeGreaterThan(0);
    expect(createLog.detail).toContain(backup.id);
    expect(JSON.stringify(backup)).not.toContain("/uploads/");
    expect(securityEvents()).toEqual(expect.arrayContaining([
      "backup_create_requested",
      "backup_create_completed"
    ]));
  });

  it("lists backups and requires explicit confirmation before deleting only deletable backup states", async () => {
    await startApp();
    const token = await login();
    const backup = await createBackup(token);

    const list = await app!.inject({ method: "GET", url: "/api/admin/backups", headers: auth(token) });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.backups).toHaveLength(1);
    expect(list.json().data.backups[0]).toMatchObject({
      id: backup.id,
      status: "ready",
      uploadFileCount: 0
    });
    expect(JSON.stringify(list.json())).not.toContain(backupDir);

    const missingConfirmation = await app!.inject({
      method: "DELETE",
      url: `/api/admin/backups/${backup.id}`,
      headers: auth(token),
      payload: { backupId: backup.id }
    });
    expect(missingConfirmation.statusCode).toBe(400);
    expect(missingConfirmation.json()).toMatchObject({
      success: false,
      error: { code: "BACKUP_DELETE_CONFIRMATION_REQUIRED" }
    });
    expect(await publishedBackupIds()).toEqual([backup.id]);

    const manifestPath = path.join(backupDir, backup.id, "manifest.json");
    const restoringManifest: BackupManifest = { ...(await readManifest(backup.id)), status: "restoring" };
    await writeFile(manifestPath, `${JSON.stringify(restoringManifest, null, 2)}\n`, "utf8");
    const nonDeletable = await app!.inject({
      method: "DELETE",
      url: `/api/admin/backups/${backup.id}`,
      headers: auth(token),
      payload: { backupId: backup.id, confirmation: "DELETE_BACKUP" }
    });
    expect(nonDeletable.statusCode).toBe(409);
    expect(nonDeletable.json()).toMatchObject({
      success: false,
      error: { code: "BACKUP_CONFLICT" }
    });
    expect(await publishedBackupIds()).toEqual([backup.id]);

    const readyManifest: BackupManifest = { ...restoringManifest, status: "ready" };
    await writeFile(manifestPath, `${JSON.stringify(readyManifest, null, 2)}\n`, "utf8");
    const deleted = await app!.inject({
      method: "DELETE",
      url: `/api/admin/backups/${backup.id}`,
      headers: auth(token),
      payload: { backupId: backup.id, confirmation: "DELETE_BACKUP" }
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ success: true, data: { backupId: backup.id }, message: "ok" });
    expect(await publishedBackupIds()).toEqual([]);

    const operationActions = await prisma.operationLog.findMany({
      where: { action: { in: ["DELETE_BACKUP", "DELETE_BACKUP_FAILED"] } },
      orderBy: { id: "asc" }
    });
    expect(operationActions.map((item) => item.action)).toEqual([
      "DELETE_BACKUP_FAILED",
      "DELETE_BACKUP_FAILED",
      "DELETE_BACKUP"
    ]);
    expect(securityEvents()).toEqual(expect.arrayContaining([
      "backup_delete_failed",
      "backup_delete_requested",
      "backup_delete_completed"
    ]));
  });

  it("safely rejects concurrent backup creation", async () => {
    let release!: () => void;
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let held = false;
    await startApp({
      beforePublish: async () => {
        if (!held) {
          held = true;
          entered();
          await releasePromise;
        }
      }
    });
    const token = await login();

    const first = app!.inject({
      method: "POST",
      url: "/api/admin/backups",
      headers: auth(token),
      payload: {}
    });
    await enteredPromise;
    const second = await app!.inject({
      method: "POST",
      url: "/api/admin/backups",
      headers: auth(token),
      payload: {}
    });
    release();
    const firstResponse = await first;

    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({
      success: false,
      error: { code: "BACKUP_CONFLICT" }
    });
    expect(firstResponse.statusCode).toBe(200);
    expect(await publishedBackupIds()).toHaveLength(1);
  });

  it("cleans staging files and leaves no partial published backup after creation failure", async () => {
    await startApp({
      beforePublish: async () => {
        throw new Error("planned backup failure token=secret-value");
      }
    });
    const token = await login();

    const failed = await app!.inject({
      method: "POST",
      url: "/api/admin/backups",
      headers: auth(token),
      payload: {}
    });

    expect(failed.statusCode).toBe(500);
    expect(failed.json()).toMatchObject({
      success: false,
      error: { code: "INTERNAL_ERROR" }
    });
    expect(await publishedBackupIds()).toEqual([]);
    const stagingEntries = await readdir(path.join(backupDir, ".staging")).catch(() => []);
    expect(stagingEntries).toEqual([]);
    await expect(prisma.operationLog.findFirstOrThrow({
      where: { action: "CREATE_BACKUP_FAILED" }
    })).resolves.toBeTruthy();
    expect(securityEvents()).toContain("backup_create_failed");
    expect(JSON.stringify(logs)).not.toContain("secret-value");
  });
});
