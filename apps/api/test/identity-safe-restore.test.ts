import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { backupManifestSchema, type BackupManifest } from "@event-arts/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createBackupService } from "../src/backup";
import { createPrismaClient, type AppPrismaClient } from "../src/db";
import { hashPassword, verifyPassword } from "../src/security";
import { ensureDatabaseSchema } from "../src/sqlite-schema";
import { resetTestAdmin, testAdminCredentials } from "./fixtures";

let root: string;
let uploadDir: string;
let backupDir: string;
let databasePath: string;
let databaseUrl: string;
let prisma: AppPrismaClient;
let app: Awaited<ReturnType<typeof buildApp>> | null;

const knownPreRbacV1SchemaHash = "0f203a9f01cb09b7127e5f79593e5717d4ec3f8ea14612d56d983a044872f032";
const manualSqliteSchemaMigrationId = "manual-sqlite-schema";
const legacyPreRbacV1StatementsGzipBase64 =
  "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";

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

function sha256Text(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(filePath: string) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right, "en-US"));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}

function backupDigest(
  database: BackupManifest["database"],
  uploads: BackupManifest["uploads"],
  formatVersion: 1 | 2
) {
  const hash = createHash("sha256");
  hash.update(`format:${formatVersion}\n`);
  hash.update(`database:${database.path}:${database.size}:${database.sha256}\n`);
  for (const file of uploads) hash.update(`upload:${file.path}:${file.size}:${file.sha256}\n`);
  return hash.digest("hex");
}

function legacyPreRbacV1Statements() {
  const statements = JSON.parse(
    gunzipSync(Buffer.from(legacyPreRbacV1StatementsGzipBase64, "base64")).toString("utf8")
  ) as unknown;
  if (!Array.isArray(statements) || statements.length !== 65 || statements.some((item) => typeof item !== "string")) {
    throw new Error("legacy pre-RBAC v1 schema fixture is invalid");
  }
  return statements as string[];
}

async function collectSchemaMetadataForTest(candidate: AppPrismaClient): Promise<BackupManifest["schema"]> {
  const [
    sqliteVersionRows,
    userVersionRows,
    migrationRows,
    schemaRows
  ] = await Promise.all([
    candidate.$queryRawUnsafe<Array<{ version: string }>>("SELECT sqlite_version() AS version"),
    candidate.$queryRawUnsafe<Array<{ user_version: number | bigint }>>("PRAGMA user_version"),
    candidate.$queryRawUnsafe<Array<{ id: string }>>("SELECT id FROM schema_migrations ORDER BY id").catch(() => []),
    candidate.$queryRawUnsafe<Array<{ name: string; type: string; sql: string | null }>>(
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
    migrationIds: migrationIds.length ? migrationIds : [manualSqliteSchemaMigrationId]
  };
}

async function writeKnownPreRbacV1Backup() {
  const backupId = `backup-legacy-prerbac-v1-${randomUUID()}`;
  const backupPath = path.join(backupDir, backupId);
  const legacyUploadDir = path.join(backupPath, "uploads");
  const databaseSnapshotPath = path.join(backupPath, "database.sqlite");
  const uploadPath = path.join(legacyUploadDir, "legacy-v1.txt");
  const legacyUploadContent = "legacy v1 restored upload";
  await mkdir(legacyUploadDir, { recursive: true });
  await writeFile(uploadPath, legacyUploadContent, "utf8");

  const legacyPrisma = createPrismaClient(`file:${databaseSnapshotPath}`);
  let database: BackupManifest["database"];
  let schema: BackupManifest["schema"];
  try {
    for (const statement of legacyPreRbacV1Statements()) {
      await legacyPrisma.$executeRawUnsafe(statement);
    }
    await legacyPrisma.$executeRawUnsafe(
      `INSERT INTO admin_users (id, username, passwordHash, status, createdAt, updatedAt)
        VALUES (1, 'legacy-root', ?, 'enabled', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      hashPassword("Legacy-Root-Aa1!")
    );
    await legacyPrisma.$executeRawUnsafe(
      `INSERT INTO admin_sessions (jti, adminId, expiresAt)
        VALUES ('legacy-session-candidate', 1, datetime('now', '+1 hour'))`
    );
    await legacyPrisma.$executeRawUnsafe(
      `INSERT INTO admin_notifications (adminId, clientEventId, level, message, occurredAt)
        VALUES (1, 'legacy-v1-candidate-notification', 'info', '候选旧通知不应恢复', CURRENT_TIMESTAMP)`
    );
    await legacyPrisma.$executeRawUnsafe(
      `INSERT INTO media_assets
        (id, resourceName, resourceNameKey, originalName, filename, md5, mimeType, mediaType, usage, url, size, storageType, createdBy)
        VALUES (1, 'Legacy v1 asset', 'legacy-v1-asset', 'legacy-v1.txt', 'legacy-v1.txt', ?, 'text/plain', 'file', 'legacy', '/uploads/legacy-v1.txt', ?, 'local', 1)`,
      createHash("md5").update(legacyUploadContent).digest("hex"),
      Buffer.byteLength(legacyUploadContent)
    );
    await legacyPrisma.$executeRawUnsafe(
      `INSERT INTO operation_logs (action, detail, createdBy)
        VALUES ('LEGACY_V1_BUSINESS', 'restored from allowlisted v1 fixture', 1)`
    );

    schema = await collectSchemaMetadataForTest(legacyPrisma);
    expect(schema.schemaHash).toBe(knownPreRbacV1SchemaHash);
    expect(schema.migrationIds).toEqual([manualSqliteSchemaMigrationId]);
    const [pageSizeRows, pageCountRows] = await Promise.all([
      legacyPrisma.$queryRawUnsafe<Array<{ page_size: number | bigint }>>("PRAGMA page_size"),
      legacyPrisma.$queryRawUnsafe<Array<{ page_count: number | bigint }>>("PRAGMA page_count")
    ]);
    await legacyPrisma.$disconnect();
    const databaseStat = await stat(databaseSnapshotPath);
    database = {
      path: "database.sqlite",
      size: databaseStat.size,
      sha256: await sha256File(databaseSnapshotPath),
      snapshotMethod: "sqlite-vacuum-into",
      pageSize: Number(pageSizeRows[0]?.page_size ?? 0),
      pageCount: Number(pageCountRows[0]?.page_count ?? 0)
    };
  } catch (error) {
    await legacyPrisma.$disconnect().catch(() => undefined);
    throw error;
  }

  const uploadStat = await stat(uploadPath);
  const uploads: BackupManifest["uploads"] = [{
    path: "uploads/legacy-v1.txt",
    size: uploadStat.size,
    sha256: await sha256File(uploadPath),
    modifiedAt: "2026-07-19T00:00:00.000Z"
  }];
  const totalBytes = database.size + uploads.reduce((sum, file) => sum + file.size, 0);
  const manifest: BackupManifest = {
    formatVersion: 1,
    status: "ready",
    app: { name: "event-arts-api", version: "test" },
    schema,
    createdBy: { adminId: 1, username: "legacy-root" },
    createdAt: "2026-07-19T00:00:00.000Z",
    note: "known pre-RBAC v1",
    database,
    uploads,
    totalBytes,
    totalFiles: 1 + uploads.length,
    sha256: backupDigest(database, uploads, 1)
  };
  await writeManifest(backupId, manifest);
  return { backupId, manifest };
}

async function startApp() {
  app = await buildApp({
    prisma,
    jwtSecret: "identity-safe-restore-test-secret",
    uploadDir,
    backupDir,
    databaseUrl,
    publicBaseUrl: "http://127.0.0.1:3001"
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

async function createBackup(token: string, note = `identity-safe-${randomUUID()}`) {
  if (!app) throw new Error("app not started");
  const response = await app.inject({
    method: "POST",
    url: "/api/admin/backups",
    headers: auth(token),
    payload: { note }
  });
  expect(response.statusCode).toBe(200);
  return response.json().data.backup as { id: string };
}

async function readManifest(backupId: string) {
  return backupManifestSchema.parse(
    JSON.parse(await readFile(path.join(backupDir, backupId, "manifest.json"), "utf8"))
  );
}

async function writeManifest(backupId: string, manifest: unknown) {
  await writeFile(
    path.join(backupDir, backupId, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
}

async function createMediaAsset(input: {
  resourceName: string;
  resourceNameKey: string;
  filename: string;
  content: string;
  createdBy: number;
}) {
  await writeFile(path.join(uploadDir, input.filename), input.content);
  return prisma.mediaAsset.create({
    data: {
      resourceName: input.resourceName,
      resourceNameKey: input.resourceNameKey,
      originalName: input.filename,
      filename: input.filename,
      md5: sha256Text(input.content).slice(0, 32),
      mimeType: "text/plain",
      mediaType: "file",
      url: `/uploads/${input.filename}`,
      size: Buffer.byteLength(input.content),
      createdBy: input.createdBy
    }
  });
}

async function createEdgeOneResource(input: {
  mediaAssetId: number;
  createdBy: number;
  targetHash: string;
}) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO edgeone_prefetch_resources
      (zoneId, mediaAssetId, contentVersion, targetUrl, targetHash, status, createdBy)
      VALUES ('zone-identity-safe', ?, 'v1', ?, ?, 'reserved', ?)`,
    input.mediaAssetId,
    `https://cdn.example.test/${input.targetHash}`,
    input.targetHash,
    input.createdBy
  );
  const rows = await prisma.$queryRawUnsafe<Array<{ id: number }>>(
    "SELECT id FROM edgeone_prefetch_resources WHERE targetHash = ?",
    input.targetHash
  );
  const resourceId = rows[0]!.id;
  await prisma.$executeRawUnsafe(
    `INSERT INTO edgeone_prefetch_attempts
      (prefetchResourceId, attemptNumber, status)
      VALUES (?, 1, 'reserved')`,
    resourceId
  );
  return resourceId;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "event-arts-identity-restore-"));
  uploadDir = path.join(root, "uploads");
  backupDir = path.join(root, "backups");
  databasePath = path.join(root, "test.db");
  databaseUrl = `file:${databasePath}`;
  await mkdir(uploadDir, { recursive: true });
  prisma = createPrismaClient(databaseUrl);
  await ensureDatabaseSchema(prisma, { uploadDir });
  await resetTestAdmin(prisma);
  app = null;
});

afterEach(async () => {
  if (app) await app.close();
  await prisma.$disconnect();
  await rm(root, { recursive: true, force: true });
});

describe("identity-safe backup restore", () => {
  it("preserves target identity tables, clears credentials, and maps actors only by publicId", async () => {
    await startApp();
    const firstToken = await login();
    const secondToken = await login();
    const restoreAdmin = await prisma.adminUser.findUniqueOrThrow({
      where: { username: testAdminCredentials.username }
    });
    const mappedPublicId = randomUUID();
    const mappedCandidate = await prisma.adminUser.create({
      data: {
        publicId: mappedPublicId,
        username: "mapped-before-backup",
        passwordHash: hashPassword("Mapped-Before-Aa1!"),
        role: "ADMIN",
        status: "enabled",
        activatedAt: new Date()
      }
    });
    const candidateNotificationId = randomUUID();
    await prisma.adminNotification.create({
      data: {
        adminId: restoreAdmin.id,
        clientEventId: candidateNotificationId,
        level: "info",
        message: "候选通知不应恢复",
        occurredAt: new Date()
      }
    });
    await prisma.operationLog.create({ data: { action: "MAPPED_ACTOR_LOG", createdBy: mappedCandidate.id } });
    await prisma.operationLog.create({ data: { action: "UNMAPPED_ACTOR_LOG", createdBy: restoreAdmin.id } });
    const mappedAsset = await createMediaAsset({
      resourceName: "Mapped actor asset",
      resourceNameKey: "mapped-actor-asset",
      filename: "mapped-actor.txt",
      content: "mapped actor upload",
      createdBy: mappedCandidate.id
    });
    const unmappedAsset = await createMediaAsset({
      resourceName: "Unmapped actor asset",
      resourceNameKey: "unmapped-actor-asset",
      filename: "unmapped-actor.txt",
      content: "unmapped actor upload",
      createdBy: restoreAdmin.id
    });
    await createEdgeOneResource({
      mediaAssetId: mappedAsset.id,
      createdBy: mappedCandidate.id,
      targetHash: "1".repeat(64)
    });
    await createEdgeOneResource({
      mediaAssetId: unmappedAsset.id,
      createdBy: restoreAdmin.id,
      targetHash: "2".repeat(64)
    });

    const targetBackup = await createBackup(firstToken, "identity-safe-target");
    const service = createBackupService({ prisma, uploadDir, backupDir, databaseUrl });
    const preflight = await service.preflightBackup(targetBackup.id);
    expect(preflight.summary.impact.tables).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "admin_users", restoreBehavior: "preserved-current", deltaRows: 0 }),
      expect.objectContaining({ table: "admin_menu_permissions", restoreBehavior: "preserved-current", deltaRows: 0 }),
      expect.objectContaining({ table: "admin_notifications", restoreBehavior: "preserved-current", deltaRows: 0 }),
      expect.objectContaining({ table: "admin_sessions", restoreBehavior: "ignored", deltaRows: 0 }),
      expect.objectContaining({ table: "admin_password_reset_tokens", restoreBehavior: "ignored", deltaRows: 0 })
    ]));

    await prisma.edgeOnePrefetchAttempt.deleteMany();
    await prisma.edgeOnePrefetchResource.deleteMany();
    await prisma.adminMenuPermission.deleteMany({ where: { adminId: mappedCandidate.id } });
    await prisma.adminUser.delete({ where: { id: mappedCandidate.id } });
    const mappedCurrent = await prisma.adminUser.create({
      data: {
        publicId: mappedPublicId,
        username: "mapped-current-target",
        passwordHash: hashPassword("Mapped-Current-Aa1!"),
        role: "ADMIN",
        status: "enabled",
        activatedAt: new Date()
      }
    });
    const currentSuperPublicId = randomUUID();
    const currentSuperPassword = "Current-Super-Aa1!";
    await prisma.adminUser.update({
      where: { id: restoreAdmin.id },
      data: {
        publicId: currentSuperPublicId,
        passwordHash: hashPassword(currentSuperPassword),
        role: "SUPER_ADMIN",
        status: "enabled"
      }
    });
    await prisma.adminMenuPermission.create({
      data: { adminId: mappedCurrent.id, menuKey: "dashboard", grantedBy: restoreAdmin.id }
    });
    await prisma.adminNotification.deleteMany();
    const currentNotificationId = randomUUID();
    await prisma.adminNotification.create({
      data: {
        adminId: restoreAdmin.id,
        clientEventId: currentNotificationId,
        level: "warning",
        message: "当前通知必须保留",
        occurredAt: new Date()
      }
    });
    await prisma.adminPasswordResetToken.create({
      data: {
        adminId: restoreAdmin.id,
        purpose: "recovery",
        tokenHash: "a".repeat(64),
        createdBy: restoreAdmin.id,
        targetRoleAtIssue: "SUPER_ADMIN",
        expiresAt: new Date(Date.now() + 30 * 60_000)
      }
    });

    const response = await app!.inject({
      method: "POST",
      url: `/api/admin/backups/${targetBackup.id}/restore`,
      headers: auth(firstToken),
      payload: { backupId: targetBackup.id, confirmation: "RESTORE_FULL_BACKUP" }
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data).toMatchObject({
      backupId: targetBackup.id,
      revokedSessionCount: 2,
      revokedResetTokenCount: 1
    });
    await expect(prisma.adminSession.count()).resolves.toBe(0);
    await expect(prisma.adminPasswordResetToken.count()).resolves.toBe(0);
    const firstMe = await app!.inject({ method: "GET", url: "/api/admin/auth/me", headers: auth(firstToken) });
    const secondMe = await app!.inject({ method: "GET", url: "/api/admin/auth/me", headers: auth(secondToken) });
    expect(firstMe.statusCode).toBe(401);
    expect(secondMe.statusCode).toBe(401);

    const restoredSuper = await prisma.adminUser.findUniqueOrThrow({ where: { id: restoreAdmin.id } });
    expect(restoredSuper.publicId).toBe(currentSuperPublicId);
    expect(restoredSuper.role).toBe("SUPER_ADMIN");
    expect(restoredSuper.status).toBe("enabled");
    expect(verifyPassword(currentSuperPassword, restoredSuper.passwordHash)).toBe(true);
    await expect(prisma.adminUser.findFirst({
      where: { username: "mapped-before-backup" }
    })).resolves.toBeNull();
    await expect(prisma.adminUser.findUniqueOrThrow({
      where: { id: mappedCurrent.id }
    })).resolves.toMatchObject({
      publicId: mappedPublicId,
      username: "mapped-current-target",
      role: "ADMIN"
    });
    await expect(prisma.adminMenuPermission.findMany()).resolves.toEqual([
      expect.objectContaining({ adminId: mappedCurrent.id, menuKey: "dashboard", grantedBy: restoreAdmin.id })
    ]);
    await expect(prisma.adminNotification.findFirst({
      where: { clientEventId: candidateNotificationId }
    })).resolves.toBeNull();
    await expect(prisma.adminNotification.findFirstOrThrow({
      where: { clientEventId: currentNotificationId }
    })).resolves.toMatchObject({ level: "warning", message: "当前通知必须保留" });

    await expect(prisma.mediaAsset.findUniqueOrThrow({
      where: { resourceNameKey: "mapped-actor-asset" }
    })).resolves.toMatchObject({ createdBy: mappedCurrent.id });
    await expect(prisma.mediaAsset.findUniqueOrThrow({
      where: { resourceNameKey: "unmapped-actor-asset" }
    })).resolves.toMatchObject({ createdBy: null });
    await expect(prisma.operationLog.findFirstOrThrow({
      where: { action: "MAPPED_ACTOR_LOG" }
    })).resolves.toMatchObject({ createdBy: mappedCurrent.id });
    await expect(prisma.operationLog.findFirstOrThrow({
      where: { action: "UNMAPPED_ACTOR_LOG" }
    })).resolves.toMatchObject({ createdBy: null });
    const edgeOneRows = await prisma.$queryRawUnsafe<Array<{ targetHash: string; createdBy: number }>>(
      "SELECT targetHash, createdBy FROM edgeone_prefetch_resources ORDER BY targetHash"
    );
    expect(edgeOneRows).toEqual([{ targetHash: "1".repeat(64), createdBy: mappedCurrent.id }]);
    await expect(prisma.edgeOnePrefetchAttempt.count()).resolves.toBe(1);
  });

  it("restores an allowlisted pre-RBAC v1 backup after upgrading only the candidate schema", async () => {
    await startApp();
    const firstToken = await login();
    const secondToken = await login();
    const restoreAdmin = await prisma.adminUser.findUniqueOrThrow({
      where: { username: testAdminCredentials.username }
    });
    const currentSuperPublicId = randomUUID();
    const currentSuperPassword = "Current-Known-V1-Aa1!";
    await prisma.adminUser.update({
      where: { id: restoreAdmin.id },
      data: {
        publicId: currentSuperPublicId,
        passwordHash: hashPassword(currentSuperPassword),
        role: "SUPER_ADMIN",
        status: "enabled"
      }
    });
    await prisma.adminMenuPermission.create({
      data: { adminId: restoreAdmin.id, menuKey: "dashboard", grantedBy: restoreAdmin.id }
    });
    const currentNotificationId = randomUUID();
    await prisma.adminNotification.create({
      data: {
        adminId: restoreAdmin.id,
        clientEventId: currentNotificationId,
        level: "success",
        message: "当前通知在 v1 恢复中保留",
        occurredAt: new Date()
      }
    });
    await prisma.adminPasswordResetToken.create({
      data: {
        adminId: restoreAdmin.id,
        purpose: "recovery",
        tokenHash: "b".repeat(64),
        createdBy: restoreAdmin.id,
        targetRoleAtIssue: "SUPER_ADMIN",
        expiresAt: new Date(Date.now() + 30 * 60_000)
      }
    });

    const { backupId, manifest } = await writeKnownPreRbacV1Backup();
    expect(manifest.formatVersion).toBe(1);
    expect(manifest.schema.schemaHash).toBe(knownPreRbacV1SchemaHash);
    expect(manifest.schema.migrationIds).toEqual([manualSqliteSchemaMigrationId]);

    const service = createBackupService({ prisma, uploadDir, backupDir, databaseUrl });
    const preflight = await service.preflightBackup(backupId);
    expect(preflight.manifest.formatVersion).toBe(1);
    expect(preflight.manifest.schema.schemaHash).toBe(knownPreRbacV1SchemaHash);
    expect(preflight.summary.checks.schemaCompatible).toBe(true);
    expect(preflight.summary.impact.tables).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "admin_users", restoreBehavior: "preserved-current" }),
      expect.objectContaining({ table: "admin_menu_permissions", restoreBehavior: "preserved-current" }),
      expect.objectContaining({ table: "admin_notifications", restoreBehavior: "preserved-current" }),
      expect.objectContaining({ table: "admin_sessions", restoreBehavior: "ignored" }),
      expect.objectContaining({ table: "admin_password_reset_tokens", restoreBehavior: "ignored" }),
      expect.objectContaining({ table: "operation_logs", restoreBehavior: "restored", candidateRows: 1 })
    ]));

    const response = await app!.inject({
      method: "POST",
      url: `/api/admin/backups/${backupId}/restore`,
      headers: auth(firstToken),
      payload: { backupId, confirmation: "RESTORE_FULL_BACKUP" }
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data).toMatchObject({
      backupId,
      revokedSessionCount: 2,
      revokedResetTokenCount: 1
    });
    await expect(prisma.adminSession.count()).resolves.toBe(0);
    await expect(prisma.adminPasswordResetToken.count()).resolves.toBe(0);
    const firstMe = await app!.inject({ method: "GET", url: "/api/admin/auth/me", headers: auth(firstToken) });
    const secondMe = await app!.inject({ method: "GET", url: "/api/admin/auth/me", headers: auth(secondToken) });
    expect(firstMe.statusCode).toBe(401);
    expect(secondMe.statusCode).toBe(401);

    const preservedSuper = await prisma.adminUser.findUniqueOrThrow({ where: { id: restoreAdmin.id } });
    expect(preservedSuper.username).toBe(testAdminCredentials.username);
    expect(preservedSuper.publicId).toBe(currentSuperPublicId);
    expect(preservedSuper.role).toBe("SUPER_ADMIN");
    expect(preservedSuper.status).toBe("enabled");
    expect(verifyPassword(currentSuperPassword, preservedSuper.passwordHash)).toBe(true);
    await expect(prisma.adminUser.findFirst({ where: { username: "legacy-root" } })).resolves.toBeNull();
    await expect(prisma.adminMenuPermission.findMany()).resolves.toEqual([
      expect.objectContaining({ adminId: restoreAdmin.id, menuKey: "dashboard", grantedBy: restoreAdmin.id })
    ]);
    await expect(prisma.adminNotification.findFirstOrThrow({
      where: { clientEventId: currentNotificationId }
    })).resolves.toMatchObject({ level: "success", message: "当前通知在 v1 恢复中保留" });
    await expect(prisma.adminNotification.findFirst({
      where: { clientEventId: "legacy-v1-candidate-notification" }
    })).resolves.toBeNull();

    await expect(prisma.operationLog.findFirstOrThrow({
      where: { action: "LEGACY_V1_BUSINESS" }
    })).resolves.toMatchObject({
      detail: "restored from allowlisted v1 fixture",
      createdBy: null
    });
    await expect(prisma.mediaAsset.findUniqueOrThrow({
      where: { resourceNameKey: "legacy-v1-asset" }
    })).resolves.toMatchObject({
      originalName: "legacy-v1.txt",
      filename: "legacy-v1.txt",
      createdBy: null
    });
    await expect(readFile(path.join(uploadDir, "legacy-v1.txt"), "utf8")).resolves.toBe("legacy v1 restored upload");
  });

  it("rejects unknown v1 schema manifests instead of applying a broad legacy adapter", async () => {
    await startApp();
    const token = await login();
    const backup = await createBackup(token, "unknown-v1");
    const manifest = await readManifest(backup.id);
    const manifestRecord = manifest as BackupManifest & { identityRestorePolicy?: "preserve_target" };
    const withoutIdentityPolicy = { ...manifestRecord };
    delete withoutIdentityPolicy.identityRestorePolicy;
    const unknownV1 = {
      ...withoutIdentityPolicy,
      formatVersion: 1 as const,
      sha256: backupDigest(manifest.database, manifest.uploads, 1)
    };
    await writeManifest(backup.id, unknownV1);

    const response = await app!.inject({
      method: "POST",
      url: `/api/admin/backups/${backup.id}/restore`,
      headers: auth(token),
      payload: { backupId: backup.id, confirmation: "RESTORE_FULL_BACKUP" }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      success: false,
      error: { code: "BACKUP_UNSUPPORTED_VERSION" }
    });
    const stillAuthorized = await app!.inject({ method: "GET", url: "/api/admin/auth/me", headers: auth(token) });
    expect(stillAuthorized.statusCode).toBe(200);
  });
});
