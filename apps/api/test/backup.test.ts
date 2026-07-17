import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { backupManifestSchema, type BackupManifest } from "@event-arts/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createPrismaClient, type AppPrismaClient } from "../src/db";
import type { BackupServiceHooks } from "../src/backup";
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
    const remove = await app!.inject({
      method: "DELETE",
      url: "/api/admin/backups/missing",
      payload: { backupId: "missing", confirmation: "DELETE_BACKUP" }
    });

    expect(list.statusCode).toBe(401);
    expect(create.statusCode).toBe(401);
    expect(remove.statusCode).toBe(401);
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

    const backup = await createBackup(token, "手动备份");
    const manifest = await readManifest(backup.id);

    expect(manifest).toMatchObject({
      formatVersion: 1,
      status: "ready",
      app: { name: "api", version: "0.1.0" },
      createdBy: { username: testAdminCredentials.username },
      note: "手动备份",
      database: { path: "database.sqlite", snapshotMethod: "sqlite-vacuum-into" }
    });
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
      await expect(snapshotPrisma.operationLog.findFirstOrThrow({
        where: { action: "PRE_BACKUP_SENTINEL" }
      })).resolves.toMatchObject({ detail: "before snapshot" });
      await expect(snapshotPrisma.dailyUserVisit.findFirstOrThrow({
        where: { appId: "wx-backup-test" }
      })).resolves.toMatchObject({ openidHash: "backup-openid-hash", visitDate: "2026-07-12" });
      await expect(snapshotPrisma.adminNotification.findFirstOrThrow({
        where: { clientEventId: notificationEventId }
      })).resolves.toMatchObject({
        adminId: backupAdmin.id,
        level: "success",
        message: "备份前通知"
      });
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
