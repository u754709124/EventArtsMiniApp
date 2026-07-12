import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrapAdmin } from "../src/admin-bootstrap";
import { createPrismaClient, type AppPrismaClient } from "../src/db";
import { seedDatabase } from "../src/seed";
import { verifyPassword } from "../src/security";
import { ensureDatabaseSchema } from "../src/sqlite-schema";

let root: string;
let uploadDir: string;
let prisma: AppPrismaClient;

function strongPassword() {
  return `Bootstrap-${randomUUID()}-Aa1!`;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "event-arts-g02-"));
  uploadDir = path.join(root, "uploads");
  await mkdir(uploadDir, { recursive: true });
  prisma = createPrismaClient(`file:${path.join(root, "test.db")}`);
  await ensureDatabaseSchema(prisma, { uploadDir });
});

afterEach(async () => {
  await prisma.$disconnect();
  await rm(root, { recursive: true, force: true });
});

describe("admin bootstrap", () => {
  it("creates the first administrator with explicit strong credentials", async () => {
    const password = strongPassword();
    const admin = await bootstrapAdmin(prisma, { username: " owner ", password });
    const stored = await prisma.adminUser.findUniqueOrThrow({ where: { id: admin.id } });

    expect(admin).toMatchObject({ username: "owner", status: "enabled" });
    expect(stored.passwordHash).not.toContain(password);
    expect(verifyPassword(password, stored.passwordHash)).toBe(true);
  });

  it("refuses to overwrite an existing administrator", async () => {
    const firstPassword = strongPassword();
    const admin = await bootstrapAdmin(prisma, { username: "owner", password: firstPassword });
    const before = await prisma.adminUser.findUniqueOrThrow({ where: { id: admin.id } });

    await expect(bootstrapAdmin(prisma, { username: "owner", password: strongPassword() }))
      .rejects.toMatchObject({ code: "ADMIN_BOOTSTRAP_ALREADY_EXISTS" });
    await expect(bootstrapAdmin(prisma, { username: "second-owner", password: strongPassword() }))
      .rejects.toMatchObject({ code: "ADMIN_BOOTSTRAP_ALREADY_EXISTS" });

    expect(await prisma.adminUser.count()).toBe(1);
    expect(await prisma.adminUser.findUniqueOrThrow({ where: { id: admin.id } }))
      .toMatchObject({ passwordHash: before.passwordHash, username: "owner" });
    expect(verifyPassword(firstPassword, before.passwordHash)).toBe(true);
  });

  it("rejects missing usernames and weak passwords before creating an administrator", async () => {
    await expect(bootstrapAdmin(prisma, { username: " ", password: strongPassword() }))
      .rejects.toMatchObject({ code: "ADMIN_BOOTSTRAP_INVALID_USERNAME" });
    await expect(bootstrapAdmin(prisma, { username: "owner", password: "weak-password" }))
      .rejects.toMatchObject({ code: "ADMIN_BOOTSTRAP_WEAK_PASSWORD" });

    expect(await prisma.adminUser.count()).toBe(0);
  });
});

describe("production seed gate", () => {
  it("rejects production seed before database or uploads side effects", async () => {
    await writeFile(path.join(uploadDir, "sentinel.txt"), "keep");
    await prisma.adminUser.create({
      data: {
        username: "existing-owner",
        passwordHash: "legacy-salt:legacy-hash",
        status: "enabled"
      }
    });
    await prisma.mediaAsset.create({
      data: {
        resourceName: "Sentinel",
        resourceNameKey: "sentinel",
        originalName: "sentinel.png",
        filename: "sentinel.png",
        md5: "00000000000000000000000000000001",
        mimeType: "image/png",
        mediaType: "image",
        url: "/uploads/sentinel.png",
        width: 1,
        height: 1,
        size: 1
      }
    });

    const before = {
      admins: await prisma.adminUser.findMany({ orderBy: { id: "asc" } }),
      media: await prisma.mediaAsset.findMany({ orderBy: { id: "asc" } }),
      uploads: await readdir(uploadDir)
    };

    await expect(seedDatabase(prisma, {
      uploadDir,
      publicBaseUrl: "http://127.0.0.1:3001",
      reset: true,
      env: "production"
    })).rejects.toThrow(/db:seed is disabled in production/);

    expect({
      admins: await prisma.adminUser.findMany({ orderBy: { id: "asc" } }),
      media: await prisma.mediaAsset.findMany({ orderBy: { id: "asc" } }),
      uploads: await readdir(uploadDir)
    }).toEqual(before);
    expect(await readFile(path.join(uploadDir, "sentinel.txt"), "utf8")).toBe("keep");
  });
});
