import type { AppPrismaClient } from "../db";
import {
  decryptEdgeOneCredential,
  encryptEdgeOneCredential,
  requireEdgeOneCredentialEncryptionKey
} from "./credential-encryption";

const singletonSystemConfigId = 1;

export type DecryptedEdgeOneSystemConfig = {
  zoneId: string;
  secretId: string;
  secretKey: string;
  updatedAt: Date;
};

export type EdgeOneSystemConfigMetadata = {
  zoneId: string;
  secretIdConfigured: boolean;
  secretKeyConfigured: boolean;
  updatedAt: Date;
};

export type EdgeOneSystemConfigAdminView = EdgeOneSystemConfigMetadata & {
  secretIdMasked: string;
};

export async function readEdgeOneSystemConfigAdminView(
  prisma: AppPrismaClient,
  encryptionKey: Buffer | null | undefined
): Promise<EdgeOneSystemConfigAdminView | null> {
  const record = await prisma.systemConfig.findUnique({
    where: { id: singletonSystemConfigId },
    select: {
      zoneId: true,
      secretIdCiphertext: true,
      secretKeyCiphertext: true,
      updatedAt: true
    }
  });
  if (!record) return null;
  const key = requireEdgeOneCredentialEncryptionKey(encryptionKey);
  const secretId = decryptEdgeOneCredential(record.secretIdCiphertext, "secretId", key);
  return {
    zoneId: record.zoneId,
    secretIdMasked: maskEdgeOneSecretId(secretId),
    secretIdConfigured: Boolean(record.secretIdCiphertext),
    secretKeyConfigured: Boolean(record.secretKeyCiphertext),
    updatedAt: record.updatedAt
  };
}

export async function readEdgeOneSystemConfigMetadata(
  prisma: AppPrismaClient
): Promise<EdgeOneSystemConfigMetadata | null> {
  const record = await prisma.systemConfig.findUnique({ where: { id: singletonSystemConfigId } });
  if (!record) return null;
  return {
    zoneId: record.zoneId,
    secretIdConfigured: Boolean(record.secretIdCiphertext),
    secretKeyConfigured: Boolean(record.secretKeyCiphertext),
    updatedAt: record.updatedAt
  };
}

export async function readDecryptedEdgeOneSystemConfig(
  prisma: AppPrismaClient,
  encryptionKey: Buffer | null | undefined
): Promise<DecryptedEdgeOneSystemConfig | null> {
  const record = await prisma.systemConfig.findUnique({ where: { id: singletonSystemConfigId } });
  if (!record) return null;
  const key = requireEdgeOneCredentialEncryptionKey(encryptionKey);
  return {
    zoneId: record.zoneId,
    secretId: decryptEdgeOneCredential(record.secretIdCiphertext, "secretId", key),
    secretKey: decryptEdgeOneCredential(record.secretKeyCiphertext, "secretKey", key),
    updatedAt: record.updatedAt
  };
}

export async function writeEdgeOneSystemConfig(
  prisma: AppPrismaClient,
  encryptionKey: Buffer | null | undefined,
  input: { zoneId: string; secretId: string; secretKey: string }
): Promise<EdgeOneSystemConfigMetadata> {
  const key = requireEdgeOneCredentialEncryptionKey(encryptionKey);
  const secretIdCiphertext = encryptEdgeOneCredential(input.secretId, "secretId", key);
  const secretKeyCiphertext = encryptEdgeOneCredential(input.secretKey, "secretKey", key);
  const record = await prisma.systemConfig.upsert({
    where: { id: singletonSystemConfigId },
    update: {
      zoneId: input.zoneId,
      secretIdCiphertext,
      secretKeyCiphertext
    },
    create: {
      id: singletonSystemConfigId,
      zoneId: input.zoneId,
      secretIdCiphertext,
      secretKeyCiphertext
    }
  });
  return {
    zoneId: record.zoneId,
    secretIdConfigured: true,
    secretKeyConfigured: true,
    updatedAt: record.updatedAt
  };
}

export function maskEdgeOneSecretId(secretId: string) {
  if (secretId.length <= 4) return "****";
  const suffix = secretId.slice(-4);
  if (secretId.length <= 8) return `****${suffix}`;
  return `${secretId.slice(0, 4)}****${suffix}`;
}
