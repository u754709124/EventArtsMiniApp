import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrapAdmin } from "../src/admin-bootstrap";
import { createPrismaClient, type AppPrismaClient } from "../src/db";
import { hashPassword, verifyPassword } from "../src/security";
import { ensureDatabaseSchema } from "../src/sqlite-schema";

const adminRbacMigrationId = "20260719_admin_rbac_identity_v1";

let root: string;
let uploadDir: string;
let prisma: AppPrismaClient;

function strongPassword() {
  return `Rbac-${randomUUID()}-Aa1!`;
}

function expectUuid(value: string) {
  expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
}

async function createLegacyAdminUsersTable() {
  await prisma.$executeRawUnsafe(`CREATE TABLE admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    passwordHash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'enabled',
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "event-arts-rbac-g01-"));
  uploadDir = path.join(root, "uploads");
  await mkdir(uploadDir, { recursive: true });
  prisma = createPrismaClient(`file:${path.join(root, "test.db")}`);
});

afterEach(async () => {
  await prisma.$disconnect();
  await rm(root, { recursive: true, force: true });
});

describe("admin RBAC identity migration", () => {
  it("upgrades legacy administrators to enabled SUPER_ADMIN accounts with stable public IDs", async () => {
    const ownerPassword = strongPassword();
    await createLegacyAdminUsersTable();
    await prisma.$executeRawUnsafe(
      "INSERT INTO admin_users (username, passwordHash, status) VALUES (?, ?, 'disabled'), (?, ?, 'enabled')",
      "owner",
      hashPassword(ownerPassword),
      "second-owner",
      hashPassword(strongPassword())
    );

    await ensureDatabaseSchema(prisma, { uploadDir });
    const firstRows = await prisma.$queryRawUnsafe<Array<{
      username: string;
      passwordHash: string;
      publicId: string;
      role: string;
      status: string;
      activatedAt: string | Date | null;
    }>>("SELECT username, passwordHash, publicId, role, status, activatedAt FROM admin_users ORDER BY id");

    expect(firstRows).toHaveLength(2);
    expect(new Set(firstRows.map((row) => row.publicId)).size).toBe(2);
    for (const row of firstRows) {
      expectUuid(row.publicId);
      expect(row.role).toBe("SUPER_ADMIN");
      expect(row.status).toBe("enabled");
      expect(row.activatedAt).not.toBeNull();
    }
    expect(verifyPassword(ownerPassword, firstRows[0].passwordHash)).toBe(true);

    await ensureDatabaseSchema(prisma, { uploadDir });
    const secondRows = await prisma.$queryRawUnsafe<typeof firstRows>(
      "SELECT username, passwordHash, publicId, role, status, activatedAt FROM admin_users ORDER BY id"
    );
    expect(secondRows).toEqual(firstRows);

    const migrationRows = await prisma.$queryRawUnsafe<Array<{ total: number | bigint }>>(
      "SELECT COUNT(*) AS total FROM schema_migrations WHERE id = ?",
      adminRbacMigrationId
    );
    expect(Number(migrationRows[0].total)).toBe(1);
  });

  it("does not change an existing identity or permissions when bootstrap is repeated", async () => {
    await ensureDatabaseSchema(prisma, { uploadDir });
    const password = strongPassword();
    const admin = await bootstrapAdmin(prisma, { username: " owner ", password });
    await prisma.$executeRawUnsafe(
      "INSERT INTO admin_menu_permissions (adminId, menuKey, grantedBy) VALUES (?, 'dashboard', ?)",
      admin.id,
      admin.id
    );
    const before = await prisma.$queryRawUnsafe<Array<{
      publicId: string;
      role: string;
      status: string;
      activatedAt: string | Date | null;
      permissions: number | bigint;
    }>>(
      `SELECT u.publicId, u.role, u.status, u.activatedAt, COUNT(p.id) AS permissions
        FROM admin_users u
        LEFT JOIN admin_menu_permissions p ON p.adminId = u.id
        WHERE u.id = ?
        GROUP BY u.id`,
      admin.id
    );

    await expect(bootstrapAdmin(prisma, { username: "owner", password: strongPassword() }))
      .rejects.toMatchObject({ code: "ADMIN_BOOTSTRAP_ALREADY_EXISTS" });
    await ensureDatabaseSchema(prisma, { uploadDir });

    const after = await prisma.$queryRawUnsafe<typeof before>(
      `SELECT u.publicId, u.role, u.status, u.activatedAt, COUNT(p.id) AS permissions
        FROM admin_users u
        LEFT JOIN admin_menu_permissions p ON p.adminId = u.id
        WHERE u.id = ?
        GROUP BY u.id`,
      admin.id
    );
    expect(after).toEqual(before);
    expect(after[0]).toMatchObject({ role: "SUPER_ADMIN", status: "enabled" });
    expect(after[0].activatedAt).not.toBeNull();
    expect(Number(after[0].permissions)).toBe(1);
  });

  it("enforces unique menu grants and reset-token hashes while storing token role snapshots", async () => {
    await ensureDatabaseSchema(prisma, { uploadDir });
    const admin = await bootstrapAdmin(prisma, { username: "owner", password: strongPassword() });
    const tokenHash = "a".repeat(64);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    await prisma.$executeRawUnsafe(
      "INSERT INTO admin_menu_permissions (adminId, menuKey, grantedBy) VALUES (?, 'artists', ?)",
      admin.id,
      admin.id
    );
    await expect(prisma.$executeRawUnsafe(
      "INSERT INTO admin_menu_permissions (adminId, menuKey, grantedBy) VALUES (?, 'artists', ?)",
      admin.id,
      admin.id
    )).rejects.toThrow();

    await prisma.$executeRawUnsafe(
      `INSERT INTO admin_password_reset_tokens
        (adminId, purpose, tokenHash, createdBy, targetRoleAtIssue, expiresAt)
        VALUES (?, 'activation', ?, ?, 'ADMIN', ?)`,
      admin.id,
      tokenHash,
      admin.id,
      expiresAt
    );
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO admin_password_reset_tokens
        (adminId, purpose, tokenHash, createdBy, targetRoleAtIssue, expiresAt)
        VALUES (?, 'recovery', ?, ?, 'USER', ?)`,
      admin.id,
      tokenHash,
      admin.id,
      expiresAt
    )).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO admin_password_reset_tokens
        (adminId, purpose, tokenHash, createdBy, targetRoleAtIssue, expiresAt)
        VALUES (?, 'super_admin_recovery', ?, ?, 'SUPER_ADMIN', ?)`,
      admin.id,
      "b".repeat(64),
      admin.id,
      expiresAt
    )).rejects.toThrow();

    const tokens = await prisma.$queryRawUnsafe<Array<{
      purpose: string;
      targetRoleAtIssue: string;
      usedAt: string | Date | null;
      revokedAt: string | Date | null;
      revokeReason: string | null;
    }>>(
      "SELECT purpose, targetRoleAtIssue, usedAt, revokedAt, revokeReason FROM admin_password_reset_tokens"
    );
    expect(tokens).toEqual([
      {
        purpose: "activation",
        targetRoleAtIssue: "ADMIN",
        usedAt: null,
        revokedAt: null,
        revokeReason: null
      }
    ]);
  });

  it("rolls back legacy identity column changes when migration constraints fail", async () => {
    await prisma.$executeRawUnsafe(`CREATE TABLE admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      publicId TEXT,
      username TEXT NOT NULL UNIQUE,
      passwordHash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'enabled',
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await prisma.$executeRawUnsafe(
      "INSERT INTO admin_users (publicId, username, passwordHash, status) VALUES ('duplicate-public-id', 'owner', 'hash-1', 'disabled'), ('duplicate-public-id', 'second-owner', 'hash-2', 'enabled')"
    );

    await expect(ensureDatabaseSchema(prisma, { uploadDir })).rejects.toThrow();

    const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>("PRAGMA table_info(admin_users)");
    expect(columns.map((column) => column.name)).not.toContain("role");
    expect(columns.map((column) => column.name)).not.toContain("activatedAt");

    const rows = await prisma.$queryRawUnsafe<Array<{ username: string; status: string }>>(
      "SELECT username, status FROM admin_users ORDER BY id"
    );
    expect(rows).toEqual([
      { username: "owner", status: "disabled" },
      { username: "second-owner", status: "enabled" }
    ]);

    const migrationRows = await prisma.$queryRawUnsafe<Array<{ total: number | bigint }>>(
      "SELECT COUNT(*) AS total FROM schema_migrations WHERE id = ?",
      adminRbacMigrationId
    );
    expect(Number(migrationRows[0].total)).toBe(0);
  });
});
