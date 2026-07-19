import { describe, expect, it } from "vitest";
import {
  backupDtoSchema,
  backupManifestSchema,
  backupPreflightSummarySchema,
  type BackupManifest
} from "./index";

const baseManifest = {
  status: "ready",
  app: { name: "api", version: "0.1.0" },
  schema: {
    provider: "sqlite",
    sqliteVersion: "3.45.0",
    userVersion: 0,
    schemaHash: "a".repeat(64),
    migrationIds: ["manual-sqlite-schema"]
  },
  createdAt: "2026-07-19T00:00:00.000Z",
  note: null,
  database: {
    path: "database.sqlite",
    size: 4096,
    sha256: "b".repeat(64),
    snapshotMethod: "sqlite-vacuum-into",
    pageSize: 4096,
    pageCount: 1
  },
  uploads: [],
  totalBytes: 4096,
  totalFiles: 1,
  sha256: "c".repeat(64)
} as const;

describe("backup v3 shared contracts", () => {
  it("accepts non-identity v3 manifests without identifiable creator fields", () => {
    const manifest = backupManifestSchema.parse({
      ...baseManifest,
      formatVersion: 3,
      identityRestorePolicy: "preserve_target",
      dataScope: "non_identity",
      backupKind: "manual",
      createdBy: { username: "后台管理员" }
    });

    expect(manifest.formatVersion).toBe(3);
    expect(manifest.createdBy).toEqual({ username: "后台管理员" });
    expect(JSON.stringify(manifest)).not.toContain("adminId");
    expect(JSON.stringify(manifest)).not.toContain("publicId");
  });

  it("keeps legacy v2 manifests readable with identified creators", () => {
    const manifest = backupManifestSchema.parse({
      ...baseManifest,
      formatVersion: 2,
      identityRestorePolicy: "preserve_target",
      createdBy: {
        adminId: 1,
        publicId: "11111111-1111-4111-8111-111111111111",
        username: "legacy-admin"
      }
    }) as BackupManifest;

    expect(manifest.formatVersion).toBe(2);
    expect(manifest.createdBy).toMatchObject({ adminId: 1, username: "legacy-admin" });
  });

  it("exposes backup kind and data scope in API DTOs and preflight summaries", () => {
    const dto = backupDtoSchema.parse({
      id: "backup-v3",
      formatVersion: 3,
      identityRestorePolicy: "preserve_target",
      dataScope: "non_identity",
      backupKind: "imported",
      status: "ready",
      createdBy: { username: "系统任务" },
      createdAt: "2026-07-19T00:00:00.000Z",
      size: 4096,
      sha256: "d".repeat(64),
      database: {
        size: 4096,
        sha256: "b".repeat(64),
        snapshotMethod: "sqlite-vacuum-into"
      },
      uploadFileCount: 0,
      note: null
    });
    const preflight = backupPreflightSummarySchema.parse({
      formatVersion: 3,
      identityRestorePolicy: "preserve_target",
      dataScope: "non_identity",
      backupKind: "imported",
      createdAt: "2026-07-19T00:00:00.000Z",
      createdBy: { username: "系统任务" },
      note: null,
      source: "external_archive",
      database: {
        size: 4096,
        snapshotMethod: "sqlite-vacuum-into",
        pageSize: 4096,
        pageCount: 1
      },
      uploads: { fileCount: 0, totalBytes: 0 },
      totals: { fileCount: 1, totalBytes: 4096 },
      checks: {
        manifest: "ok",
        checksums: "ok",
        sqliteIntegrity: "ok",
        schemaCompatible: true,
        mediaFiles: "ok"
      },
      impact: { tables: [] }
    });

    expect(dto).toMatchObject({ backupKind: "imported", dataScope: "non_identity" });
    expect(preflight).toMatchObject({ backupKind: "imported", dataScope: "non_identity" });
  });
});
