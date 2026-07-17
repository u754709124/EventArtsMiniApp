import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPrismaClient, type AppPrismaClient } from "../src/db";
import { ensureDatabaseSchema } from "../src/sqlite-schema";

let prisma: AppPrismaClient | undefined;
let root: string | undefined;

afterEach(async () => {
  await prisma?.$disconnect();
  if (root) await rm(root, { recursive: true, force: true });
});

describe("EdgeOne prefetch SQLite migration", () => {
  it("is additive and idempotent", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "edgeone-prefetch-migration-"));
    const uploadDir = path.join(root, "uploads");
    await mkdir(uploadDir);
    prisma = createPrismaClient(`file:${path.join(root, "test.db")}`);
    await ensureDatabaseSchema(prisma, { uploadDir });
    await ensureDatabaseSchema(prisma, { uploadDir });

    const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type IN ('table','index') AND name LIKE 'edgeone_prefetch_%'"
    );
    const names = rows.map((row) => row.name);
    expect(names).toContain("edgeone_prefetch_resources");
    expect(names).toContain("edgeone_prefetch_attempts");
    expect(names).toContain(
      "edgeone_prefetch_resources_zoneId_mediaAssetId_contentVersion_targetHash_mode_key"
    );
  });
});
