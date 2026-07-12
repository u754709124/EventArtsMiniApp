import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Prisma } from "@prisma/client";
import { loadApiConfig } from "./config";
import { createPrismaClient, type AppPrismaClient } from "./db";
import { ensureDatabaseSchema } from "./sqlite-schema";

export const ADMIN_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
export const ADMIN_SESSION_TTL_SECONDS = ADMIN_SESSION_TTL_MS / 1000;
export const ADMIN_SESSION_JWT_EXPIRES_IN = "2h";

export const adminSessionRevokeReasons = {
  logout: "logout",
  passwordChanged: "password_changed",
  restoreCompleted: "restore_completed"
} as const;

export type AdminSessionRevokeReason = (typeof adminSessionRevokeReasons)[keyof typeof adminSessionRevokeReasons];
export type SessionClock = () => Date;
type AdminSessionClient = AppPrismaClient | Prisma.TransactionClient;

export function adminSessionExpiry(createdAt: Date) {
  return new Date(createdAt.getTime() + ADMIN_SESSION_TTL_MS);
}

export async function createAdminSession(
  prisma: AdminSessionClient,
  input: { adminId: number; now: Date }
) {
  const jti = randomUUID();
  const createdAt = new Date(input.now.getTime());
  const expiresAt = adminSessionExpiry(createdAt);
  await prisma.adminSession.create({
    data: {
      jti,
      adminId: input.adminId,
      createdAt,
      expiresAt
    }
  });
  return { jti, createdAt, expiresAt };
}

export async function revokeAdminSession(
  prisma: AdminSessionClient,
  input: { jti: string; reason: AdminSessionRevokeReason; now: Date }
) {
  return prisma.adminSession.updateMany({
    where: { jti: input.jti, revokedAt: null },
    data: {
      revokedAt: input.now,
      revokeReason: input.reason
    }
  });
}

export async function revokeAdminSessionsForAdmin(
  prisma: AdminSessionClient,
  input: { adminId: number; reason: AdminSessionRevokeReason; now: Date }
) {
  return prisma.adminSession.updateMany({
    where: { adminId: input.adminId, revokedAt: null },
    data: {
      revokedAt: input.now,
      revokeReason: input.reason
    }
  });
}

export async function revokeAllAdminSessions(
  prisma: AdminSessionClient,
  input: { reason: AdminSessionRevokeReason; now: Date }
) {
  return prisma.adminSession.updateMany({
    where: { revokedAt: null },
    data: {
      revokedAt: input.now,
      revokeReason: input.reason
    }
  });
}

export async function countExpiredAdminSessions(prisma: AppPrismaClient, now = new Date()) {
  return prisma.adminSession.count({ where: { expiresAt: { lte: now } } });
}

export async function cleanupExpiredAdminSessions(prisma: AppPrismaClient, now = new Date()) {
  const result = await prisma.adminSession.deleteMany({ where: { expiresAt: { lte: now } } });
  return { deletedCount: result.count };
}

function parseCleanupArgs(args: string[]) {
  let dryRun = false;
  for (const arg of args) {
    if (arg === "--") continue;
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    throw new Error(`未知参数：${arg}`);
  }
  return { dryRun };
}

export async function runAdminSessionCleanupCli(args = process.argv.slice(2)) {
  const options = parseCleanupArgs(args);
  const config = loadApiConfig();
  const prisma = createPrismaClient(config.databaseUrl);
  try {
    await ensureDatabaseSchema(prisma, { uploadDir: config.paths.uploadDir });
    const now = new Date();
    if (options.dryRun) {
      const count = await countExpiredAdminSessions(prisma, now);
      console.log(`Expired admin sessions would be deleted: ${count}`);
      return { deletedCount: 0, dryRunCount: count };
    }
    const result = await cleanupExpiredAdminSessions(prisma, now);
    console.log(`Expired admin sessions deleted: ${result.deletedCount}`);
    return { ...result, dryRunCount: null };
  } finally {
    await prisma.$disconnect();
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runAdminSessionCleanupCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
