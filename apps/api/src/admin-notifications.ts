import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AdminNotification, Prisma } from "@prisma/client";
import {
  adminNotificationCreateResponseSchema,
  adminNotificationDtoSchema,
  adminNotificationListResponseSchema,
  type AdminNotificationCreateRequest,
  type AdminNotificationDto,
  type AdminNotificationListQuery
} from "@event-arts/shared";
import { loadApiConfig, type LoadApiConfigOptions } from "./config";
import { createPrismaClient, type AppPrismaClient } from "./db";
import { ensureDatabaseSchema } from "./sqlite-schema";

export const ADMIN_NOTIFICATION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const ADMIN_NOTIFICATION_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

type NotificationClient = AppPrismaClient | Prisma.TransactionClient;

export function adminNotificationCutoff(now = new Date()) {
  return new Date(now.getTime() - ADMIN_NOTIFICATION_RETENTION_MS);
}

export function toAdminNotificationDto(notification: AdminNotification): AdminNotificationDto {
  return adminNotificationDtoSchema.parse({
    id: notification.id,
    clientEventId: notification.clientEventId,
    level: notification.level,
    message: notification.message,
    occurredAt: notification.occurredAt.toISOString(),
    createdAt: notification.createdAt.toISOString()
  });
}

export async function countExpiredAdminNotifications(prisma: AppPrismaClient, now = new Date()) {
  return prisma.adminNotification.count({
    where: { occurredAt: { lt: adminNotificationCutoff(now) } }
  });
}

export async function cleanupExpiredAdminNotifications(prisma: NotificationClient, now = new Date()) {
  const result = await prisma.adminNotification.deleteMany({
    where: { occurredAt: { lt: adminNotificationCutoff(now) } }
  });
  return { deletedCount: result.count };
}

export async function createAdminNotification(
  prisma: AppPrismaClient,
  input: {
    adminId: number;
    notification: AdminNotificationCreateRequest;
    now?: Date;
  }
) {
  const now = input.now ?? new Date();
  const occurredAt = new Date(input.notification.occurredAt);
  const cutoff = adminNotificationCutoff(now);
  if (occurredAt < cutoff) {
    return adminNotificationCreateResponseSchema.parse({
      notification: null,
      persisted: false,
      reason: "expired"
    });
  }
  if (occurredAt.getTime() > now.getTime() + ADMIN_NOTIFICATION_MAX_FUTURE_SKEW_MS) {
    throw new RangeError("消息发生时间不能晚于服务器时间 5 分钟");
  }

  const notification = await prisma.$transaction(async (tx) => {
    await cleanupExpiredAdminNotifications(tx, now);
    return tx.adminNotification.upsert({
      where: {
        adminId_clientEventId: {
          adminId: input.adminId,
          clientEventId: input.notification.clientEventId
        }
      },
      update: {},
      create: {
        adminId: input.adminId,
        clientEventId: input.notification.clientEventId,
        level: input.notification.level,
        message: input.notification.message,
        occurredAt
      }
    });
  });

  return adminNotificationCreateResponseSchema.parse({
    notification: toAdminNotificationDto(notification),
    persisted: true,
    reason: null
  });
}

export async function listAdminNotifications(
  prisma: AppPrismaClient,
  input: {
    adminId: number;
    query: AdminNotificationListQuery;
    now?: Date;
  }
) {
  const now = input.now ?? new Date();
  const cutoff = adminNotificationCutoff(now);
  const where = {
    adminId: input.adminId,
    ...(input.query.level ? { level: input.query.level } : {}),
    occurredAt: { gte: cutoff, lte: new Date(now.getTime() + ADMIN_NOTIFICATION_MAX_FUTURE_SKEW_MS) }
  } satisfies Prisma.AdminNotificationWhereInput;

  const [items, total] = await prisma.$transaction(async (tx) => {
    await cleanupExpiredAdminNotifications(tx, now);
    return Promise.all([
      tx.adminNotification.findMany({
        where,
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        skip: (input.query.page - 1) * input.query.pageSize,
        take: input.query.pageSize
      }),
      tx.adminNotification.count({ where })
    ]);
  });

  return adminNotificationListResponseSchema.parse({
    items: items.map(toAdminNotificationDto),
    pagination: {
      page: input.query.page,
      pageSize: input.query.pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / input.query.pageSize)
    }
  });
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

export async function runAdminNotificationCleanupCli(
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
    const result = await runner.run("admin-notification-cleanup");
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
  runAdminNotificationCleanupCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
