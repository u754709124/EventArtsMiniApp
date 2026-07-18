import type { ApiConfig } from "./config";
import { cleanupExpiredAdminNotifications, countExpiredAdminNotifications } from "./admin-notifications";
import { cleanupExpiredAdminSessions, countExpiredAdminSessions } from "./admin-sessions";
import {
  cleanupExpiredDailyUserVisits,
  cleanupExpiredPageViewEvents,
  countExpiredDailyUserVisits,
  countExpiredPageViewEvents
} from "./analytics";
import type { AppPrismaClient } from "./db";
import { asEdgeOneDomainError, createEdgeOnePrefetchService, type EdgeOneClientFactory } from "./edgeone";
import { sanitizeSummary, type ScheduledTaskHandler, type ScheduledTaskKey } from "./scheduled-tasks";

type ScheduledTaskHandlerOptions = {
  prisma: AppPrismaClient;
  publicBaseUrl: string;
  analytics: ApiConfig["analytics"];
  edgeOne: {
    credentialEncryptionKey: Buffer | null;
    prefetch: ApiConfig["edgeOne"]["prefetch"];
    clientFactory?: EdgeOneClientFactory;
  };
  dryRun?: boolean;
  writeOutput?: (line: string) => void;
  writeError?: (line: string) => void;
};

export function createScheduledTaskHandlers(options: ScheduledTaskHandlerOptions) {
  const writeOutput = options.writeOutput;
  const writeError = options.writeError;

  return {
    "admin-session-cleanup": async ({ now }) => {
      const current = now();
      if (options.dryRun) {
        const dryRunCount = await countExpiredAdminSessions(options.prisma, current);
        writeOutput?.(`Expired admin sessions would be deleted: ${dryRunCount}`);
        return sanitizeSummary({ deletedCount: 0, dryRunCount });
      }
      const result = await cleanupExpiredAdminSessions(options.prisma, current);
      writeOutput?.(`Expired admin sessions deleted: ${result.deletedCount}`);
      return sanitizeSummary(result);
    },
    "admin-notification-cleanup": async ({ now }) => {
      const current = now();
      if (options.dryRun) {
        const dryRunCount = await countExpiredAdminNotifications(options.prisma, current);
        writeOutput?.(`Expired admin notifications would be deleted: ${dryRunCount}`);
        return sanitizeSummary({ deletedCount: 0, dryRunCount });
      }
      const result = await cleanupExpiredAdminNotifications(options.prisma, current);
      writeOutput?.(`Expired admin notifications deleted: ${result.deletedCount}`);
      return sanitizeSummary(result);
    },
    "analytics-cleanup": async ({ now }) => {
      const current = now();
      if (options.dryRun) {
        const [legacyCount, dailyCount] = await Promise.all([
          countExpiredPageViewEvents(options.prisma, {
            now: current,
            retentionDays: options.analytics.retentionDays
          }),
          countExpiredDailyUserVisits(options.prisma, {
            now: current,
            retentionDays: options.analytics.retentionDays
          })
        ]);
        const dryRunCount = legacyCount + dailyCount;
        writeOutput?.(`Expired analytics rows would be deleted: ${dryRunCount}`);
        return sanitizeSummary({ deletedCount: 0, dryRunCount, legacyCount, dailyCount });
      }
      const [legacyResult, dailyResult] = await Promise.all([
        cleanupExpiredPageViewEvents(options.prisma, {
          now: current,
          retentionDays: options.analytics.retentionDays
        }),
        cleanupExpiredDailyUserVisits(options.prisma, {
          now: current,
          retentionDays: options.analytics.retentionDays
        })
      ]);
      const deletedCount = legacyResult.deletedCount + dailyResult.deletedCount;
      writeOutput?.(`Expired analytics rows deleted: ${deletedCount}`);
      return sanitizeSummary({
        deletedCount,
        legacyDeletedCount: legacyResult.deletedCount,
        dailyDeletedCount: dailyResult.deletedCount
      });
    },
    "edgeone-prefetch-reconcile": async () => {
      if (!options.edgeOne.prefetch.enabled) {
        writeOutput?.(JSON.stringify({
          event: "edgeone_prefetch_reconcile",
          status: "disabled"
        }));
        return sanitizeSummary({ status: "disabled" });
      }
      try {
        const service = createEdgeOnePrefetchService({
          prisma: options.prisma,
          publicBaseUrl: options.publicBaseUrl,
          credentialEncryptionKey: options.edgeOne.credentialEncryptionKey,
          config: options.edgeOne.prefetch,
          clientFactory: options.edgeOne.clientFactory
        });
        const result = await service.reconcile();
        writeOutput?.(JSON.stringify({
          event: "edgeone_prefetch_reconcile",
          status: "completed",
          scanned: result.scanned,
          queried: result.queried,
          recovered: result.recovered,
          failed: result.failed,
          retried: result.retried
        }));
        return sanitizeSummary({
          status: "completed",
          scanned: result.scanned,
          queried: result.queried,
          recovered: result.recovered,
          failed: result.failed,
          retried: result.retried
        });
      } catch (error) {
        const safe = asEdgeOneDomainError(error);
        writeError?.(JSON.stringify({
          event: "edgeone_prefetch_reconcile",
          status: "failed",
          businessCode: safe.code,
          ...(safe.upstreamCode ? { upstreamCode: safe.upstreamCode } : {}),
          ...(safe.upstreamRequestId ? { upstreamRequestId: safe.upstreamRequestId } : {})
        }));
        throw safe;
      }
    }
  } satisfies Record<ScheduledTaskKey, ScheduledTaskHandler>;
}
