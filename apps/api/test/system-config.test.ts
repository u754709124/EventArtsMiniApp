import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "../src/db";
import { seedDatabase } from "../src/seed";
import { ensureDatabaseSchema } from "../src/sqlite-schema";
import {
  EdgeOneCredentialDecryptionError,
  EdgeOneCredentialEncryptionUnavailableError,
  decryptEdgeOneCredential,
  encryptEdgeOneCredential,
  maskEdgeOneSecretId,
  readDecryptedEdgeOneSystemConfig,
  readEdgeOneSystemConfigMetadata,
  writeEdgeOneSystemConfig
} from "../src/system-config";

const encryptionKey = Buffer.alloc(32, 23);
const testAssetRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../miniapp/src/assets/generated"
);
const tempRoots: string[] = [];

async function createTestDatabase() {
  const root = await mkdtemp(path.join(os.tmpdir(), "event-arts-system-config-"));
  tempRoots.push(root);
  const uploadDir = path.join(root, "uploads");
  await mkdir(uploadDir, { recursive: true });
  const prisma = createPrismaClient(`file:${path.join(root, "test.db")}`);
  await ensureDatabaseSchema(prisma, { uploadDir });
  return { root, uploadDir, prisma };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("EdgeOne credential encryption", () => {
  it("round-trips each field with a versioned AES-256-GCM envelope and random IV", () => {
    const first = encryptEdgeOneCredential("AKID_TEST_VALUE", "secretId", encryptionKey);
    const second = encryptEdgeOneCredential("AKID_TEST_VALUE", "secretId", encryptionKey);

    expect(first).not.toBe(second);
    expect(JSON.parse(first)).toMatchObject({
      version: 1,
      algorithm: "AES-256-GCM"
    });
    expect(Buffer.from(JSON.parse(first).iv, "base64url")).toHaveLength(12);
    expect(Buffer.from(JSON.parse(first).authTag, "base64url")).toHaveLength(16);
    expect(decryptEdgeOneCredential(first, "secretId", encryptionKey)).toBe("AKID_TEST_VALUE");
  });

  it("rejects tampering, the wrong key, and swapping ciphertext between fields", () => {
    const envelope = encryptEdgeOneCredential("TEST_SECRET_VALUE", "secretId", encryptionKey);
    const tampered = JSON.parse(envelope) as { ciphertext: string } & Record<string, unknown>;
    const bytes = Buffer.from(tampered.ciphertext, "base64url");
    bytes[0] ^= 1;
    tampered.ciphertext = bytes.toString("base64url");

    expect(() =>
      decryptEdgeOneCredential(JSON.stringify(tampered), "secretId", encryptionKey)
    ).toThrow(EdgeOneCredentialDecryptionError);
    expect(() => decryptEdgeOneCredential(envelope, "secretId", randomBytes(32))).toThrow(
      EdgeOneCredentialDecryptionError
    );
    expect(() => decryptEdgeOneCredential(envelope, "secretKey", encryptionKey)).toThrow(
      EdgeOneCredentialDecryptionError
    );
  });

  it("fails closed when the encryption key is unavailable or malformed", () => {
    expect(() => encryptEdgeOneCredential("TEST_SECRET_VALUE", "secretKey", null)).toThrow(
      EdgeOneCredentialEncryptionUnavailableError
    );
    expect(() =>
      encryptEdgeOneCredential("TEST_SECRET_VALUE", "secretKey", Buffer.alloc(31))
    ).toThrow(EdgeOneCredentialEncryptionUnavailableError);
    expect(() => decryptEdgeOneCredential("not-json", "secretKey", encryptionKey)).toThrow(
      EdgeOneCredentialDecryptionError
    );
  });
});

describe("SystemConfig persistence", () => {
  it("creates the singleton table idempotently without changing existing database rows", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "event-arts-system-config-legacy-"));
    tempRoots.push(root);
    const uploadDir = path.join(root, "uploads");
    await mkdir(uploadDir, { recursive: true });
    const prisma = createPrismaClient(`file:${path.join(root, "legacy.db")}`);
    await prisma.$executeRawUnsafe(
      "CREATE TABLE legacy_sentinel (id INTEGER PRIMARY KEY, value TEXT NOT NULL)"
    );
    await prisma.$executeRawUnsafe(
      "INSERT INTO legacy_sentinel (id, value) VALUES (1, 'preserve-me')"
    );

    await ensureDatabaseSchema(prisma, { uploadDir });
    await ensureDatabaseSchema(prisma, { uploadDir });

    const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      "PRAGMA table_info(system_config)"
    );
    expect(columns.map((column) => column.name)).toEqual([
      "id",
      "zoneId",
      "secretIdCiphertext",
      "secretKeyCiphertext",
      "updatedAt"
    ]);
    const sentinel = await prisma.$queryRawUnsafe<Array<{ value: string }>>(
      "SELECT value FROM legacy_sentinel WHERE id = 1"
    );
    expect(sentinel).toEqual([{ value: "preserve-me" }]);
    await expect(
      prisma.$executeRawUnsafe(
        "INSERT INTO system_config (id, zoneId, secretIdCiphertext, secretKeyCiphertext) VALUES (2, 'zone-test', 'a', 'b')"
      )
    ).rejects.toThrow();
    await prisma.$disconnect();
  });

  it("stores only authenticated ciphertext and decrypts through the internal store", async () => {
    const { prisma } = await createTestDatabase();
    await writeEdgeOneSystemConfig(prisma, encryptionKey, {
      zoneId: "zone-test",
      secretId: "AKID_TEST_VALUE",
      secretKey: "TEST_SECRET_KEY_VALUE"
    });

    const raw = await prisma.systemConfig.findUniqueOrThrow({ where: { id: 1 } });
    expect(raw.secretIdCiphertext).not.toContain("AKID_TEST_VALUE");
    expect(raw.secretKeyCiphertext).not.toContain("TEST_SECRET_KEY_VALUE");
    expect(JSON.parse(raw.secretIdCiphertext)).toMatchObject({
      version: 1,
      algorithm: "AES-256-GCM"
    });
    expect(await readDecryptedEdgeOneSystemConfig(prisma, encryptionKey)).toMatchObject({
      zoneId: "zone-test",
      secretId: "AKID_TEST_VALUE",
      secretKey: "TEST_SECRET_KEY_VALUE"
    });
    expect(await readEdgeOneSystemConfigMetadata(prisma)).toMatchObject({
      zoneId: "zone-test",
      secretIdConfigured: true,
      secretKeyConfigured: true
    });
    expect(maskEdgeOneSecretId("AKID1234567890")).toBe("AKID****7890");
    await prisma.$disconnect();
  });

  it("does not write anything when the non-production key is absent", async () => {
    const { prisma } = await createTestDatabase();
    await expect(
      writeEdgeOneSystemConfig(prisma, null, {
        zoneId: "zone-test",
        secretId: "AKID_TEST_VALUE",
        secretKey: "TEST_SECRET_KEY_VALUE"
      })
    ).rejects.toThrow(EdgeOneCredentialEncryptionUnavailableError);
    expect(await prisma.systemConfig.count()).toBe(0);
    await prisma.$disconnect();
  });

  it("preserves SystemConfig during ordinary seed and removes it only during reset seed", async () => {
    const { prisma, uploadDir } = await createTestDatabase();
    await writeEdgeOneSystemConfig(prisma, encryptionKey, {
      zoneId: "zone-test",
      secretId: "AKID_TEST_VALUE",
      secretKey: "TEST_SECRET_KEY_VALUE"
    });
    const before = await prisma.systemConfig.findUniqueOrThrow({ where: { id: 1 } });

    await seedDatabase(prisma, {
      uploadDir,
      publicBaseUrl: "http://127.0.0.1:3001",
      assetRoot: testAssetRoot,
      env: "test"
    });
    expect(await prisma.systemConfig.findUniqueOrThrow({ where: { id: 1 } })).toEqual(before);

    await seedDatabase(prisma, {
      uploadDir,
      publicBaseUrl: "http://127.0.0.1:3001",
      assetRoot: testAssetRoot,
      env: "test",
      reset: true
    });
    expect(await prisma.systemConfig.findUnique({ where: { id: 1 } })).toBeNull();
    await prisma.$disconnect();
  });
});
