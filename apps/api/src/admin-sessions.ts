import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Prisma } from "@prisma/client";
import { loadApiConfig, type LoadApiConfigOptions } from "./config";
import { createPrismaClient, type AppPrismaClient } from "./db";
import { ensureDatabaseSchema } from "./sqlite-schema";

export const ADMIN_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
export const ADMIN_SESSION_TTL_SECONDS = ADMIN_SESSION_TTL_MS / 1000;
export const ADMIN_SESSION_JWT_EXPIRES_IN = "2h";

export const adminSessionRevokeReasons = {
  logout: "logout",
  passwordChanged: "password_changed",
  roleChanged: "role_changed",
  statusChanged: "status_changed",
  permissionsChanged: "permissions_changed",
  restoreCompleted: "restore_completed"
} as const;

export const adminResetTokenRevokeReasons = {
  passwordChanged: "password_changed",
  roleChanged: "role_changed",
  statusChanged: "status_changed",
  permissionsChanged: "permissions_changed",
  newTokenIssued: "new_token_issued",
  consumed: "consumed",
  restoreCompleted: "restore_completed"
} as const;

export type AdminSessionRevokeReason = (typeof adminSessionRevokeReasons)[keyof typeof adminSessionRevokeReasons];
export type AdminResetTokenRevokeReason =
  (typeof adminResetTokenRevokeReasons)[keyof typeof adminResetTokenRevokeReasons];
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

export async function revokeAdminResetTokensForAdmin(
  prisma: AdminSessionClient,
  input: { adminId: number; reason: AdminResetTokenRevokeReason; now: Date }
) {
  return prisma.adminPasswordResetToken.updateMany({
    where: {
      adminId: input.adminId,
      usedAt: null,
      revokedAt: null
    },
    data: {
      revokedAt: input.now,
      revokeReason: input.reason
    }
  });
}

export async function revokeAdminSecurityCredentialsForAdmin(
  prisma: AdminSessionClient,
  input: {
    adminId: number;
    sessionReason: AdminSessionRevokeReason;
    resetTokenReason: AdminResetTokenRevokeReason;
    now: Date;
  }
) {
  const revokedSessions = await revokeAdminSessionsForAdmin(prisma, {
    adminId: input.adminId,
    reason: input.sessionReason,
    now: input.now
  });
  const revokedResetTokens = await revokeAdminResetTokensForAdmin(prisma, {
    adminId: input.adminId,
    reason: input.resetTokenReason,
    now: input.now
  });
  return {
    revokedSessionCount: revokedSessions.count,
    revokedResetTokenCount: revokedResetTokens.count
  };
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

type CleanupCliRuntimeOptions = {
  config?: LoadApiConfigOptions;
  now?: () => Date;
  leaseMs?: number;
  writeOutput?: (line: string) => void;
};

export async function runAdminSessionCleanupCli(
  args = process.argv.slice(2),
  runtimeOptions: CleanupCliRuntimeOptions = {}
) {
  const options = parseCleanupArgs(args);
  const config = loadApiConfig(runtimeOptions.config);
  const prisma = createPrismaClient(config.databaseUrl);
  try {
    await ensureDatabaseSchema(prisma, { uploadDir: config.paths.uploadDir });
    const [{ createScheduledTaskRunner }, { createScheduledTaskHandlers }] = await Promise.all([
      import("./scheduled-tasks"),
      import("./scheduled-task-handlers")
    ]);
    const runner = createScheduledTaskRunner({
      prisma,
      now: runtimeOptions.now,
      leaseMs: runtimeOptions.leaseMs,
      handlers: createScheduledTaskHandlers({
        prisma,
        publicBaseUrl: config.publicBaseUrl,
        analytics: config.analytics,
        edgeOne: {
          credentialEncryptionKey: config.edgeOne.credentialEncryptionKey,
          prefetch: config.edgeOne.prefetch
        },
        dryRun: options.dryRun,
        writeOutput: runtimeOptions.writeOutput ?? console.log
      })
    });
    const result = await runner.run("admin-session-cleanup");
    return {
      ...result.resultSummary,
      dryRunCount: options.dryRun ? result.resultSummary.dryRunCount ?? 0 : null
    };
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
