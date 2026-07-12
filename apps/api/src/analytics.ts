import { createHmac } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyticsFieldLimits } from "@event-arts/shared";
import { loadApiConfig } from "./config";
import { createPrismaClient, type AppPrismaClient } from "./db";
import { ensureDatabaseSchema } from "./sqlite-schema";

export type PageViewAnalyticsConfig = {
  sampleRate: number;
  retentionDays: number;
  dedupeWindowSeconds: number;
};

export type PageViewAnalyticsInput = {
  pagePath: string;
  scene?: string;
  userAgent: unknown;
  clientIp: string;
  now: Date;
  hmacSecret: string;
  config: PageViewAnalyticsConfig;
};

export type PageViewAnalyticsResult =
  | { sampled: false; tracked: false; deduped: false; sampleWeight: 0 }
  | { sampled: true; tracked: false; deduped: true; sampleWeight: number }
  | { sampled: true; tracked: true; deduped: false; sampleWeight: number };

export const defaultPageViewAnalyticsConfig: PageViewAnalyticsConfig = {
  sampleRate: 0.1,
  retentionDays: 90,
  dedupeWindowSeconds: 30
};

const oneDayMs = 24 * 60 * 60 * 1000;

function utcDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function hmacHex(secret: string, purpose: string, value: string) {
  return createHmac("sha256", `${purpose}:${secret}`).update(value).digest("hex");
}

function clampSampleRate(sampleRate: number) {
  if (!Number.isFinite(sampleRate)) return defaultPageViewAnalyticsConfig.sampleRate;
  return Math.min(1, Math.max(0.001, sampleRate));
}

export function normalizeAnalyticsText(value: string, maxLength: number) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

export function normalizeUserAgent(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return null;
  const normalized = normalizeAnalyticsText(raw, analyticsFieldLimits.userAgentMaxLength);
  return normalized || null;
}

export function normalizeOptionalScene(value: string | undefined) {
  if (value === undefined) return null;
  const normalized = normalizeAnalyticsText(value, analyticsFieldLimits.sceneMaxLength);
  return normalized || null;
}

export function createAnonymousFingerprint(input: {
  clientIp: string;
  userAgent: string | null;
  now: Date;
  hmacSecret: string;
}) {
  return hmacHex(
    input.hmacSecret,
    `page-view-fingerprint-v1:${utcDay(input.now)}`,
    `${input.clientIp}\n${input.userAgent ?? ""}`
  );
}

export function pageViewSampleWeight(sampleRate: number) {
  return Math.max(1, Math.round(1 / clampSampleRate(sampleRate)));
}

export function shouldSamplePageView(input: {
  anonymousFingerprint: string;
  pagePath: string;
  scene: string | null;
  sampleRate: number;
  hmacSecret: string;
}) {
  const sampleRate = clampSampleRate(input.sampleRate);
  if (sampleRate >= 1) return true;
  const digest = hmacHex(
    input.hmacSecret,
    "page-view-sample-v1",
    `${input.anonymousFingerprint}\n${input.pagePath}\n${input.scene ?? ""}`
  );
  const score = Number.parseInt(digest.slice(0, 12), 16) / 0xffffffffffff;
  return score < sampleRate;
}

export function pageViewRetentionCutoff(now: Date, retentionDays: number) {
  return new Date(now.getTime() - Math.max(1, retentionDays) * oneDayMs);
}

export async function recordPageViewEvent(
  prisma: AppPrismaClient,
  input: PageViewAnalyticsInput
): Promise<PageViewAnalyticsResult> {
  const pagePath = normalizeAnalyticsText(input.pagePath, analyticsFieldLimits.pagePathMaxLength);
  const scene = normalizeOptionalScene(input.scene);
  const userAgent = normalizeUserAgent(input.userAgent);
  const anonymousFingerprint = createAnonymousFingerprint({
    clientIp: input.clientIp,
    userAgent,
    now: input.now,
    hmacSecret: input.hmacSecret
  });
  const sampleWeight = pageViewSampleWeight(input.config.sampleRate);

  if (
    !shouldSamplePageView({
      anonymousFingerprint,
      pagePath,
      scene,
      sampleRate: input.config.sampleRate,
      hmacSecret: input.hmacSecret
    })
  ) {
    return { sampled: false, tracked: false, deduped: false, sampleWeight: 0 };
  }

  const dedupeWindowStart = new Date(input.now.getTime() - input.config.dedupeWindowSeconds * 1000);
  const duplicate = await prisma.pageViewEvent.findFirst({
    where: {
      anonymousFingerprint,
      pagePath,
      scene,
      createdAt: { gte: dedupeWindowStart }
    },
    select: { id: true }
  });
  if (duplicate) {
    return { sampled: true, tracked: false, deduped: true, sampleWeight };
  }

  await prisma.pageViewEvent.create({
    data: {
      pagePath,
      scene,
      userAgent,
      anonymousFingerprint,
      sampleWeight,
      createdAt: input.now
    }
  });
  return { sampled: true, tracked: true, deduped: false, sampleWeight };
}

export async function weightedPageViewCount(prisma: AppPrismaClient, since: Date) {
  const aggregate = await prisma.pageViewEvent.aggregate({
    where: { createdAt: { gte: since } },
    _sum: { sampleWeight: true }
  });
  return aggregate._sum.sampleWeight ?? 0;
}

export async function countExpiredPageViewEvents(
  prisma: AppPrismaClient,
  input: { now: Date; retentionDays: number }
) {
  return prisma.pageViewEvent.count({
    where: { createdAt: { lt: pageViewRetentionCutoff(input.now, input.retentionDays) } }
  });
}

export async function cleanupExpiredPageViewEvents(
  prisma: AppPrismaClient,
  input: { now: Date; retentionDays: number }
) {
  const result = await prisma.pageViewEvent.deleteMany({
    where: { createdAt: { lt: pageViewRetentionCutoff(input.now, input.retentionDays) } }
  });
  return { deletedCount: result.count };
}

function parsePageViewCleanupArgs(args: string[]) {
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

export async function runPageViewCleanupCli(args = process.argv.slice(2)) {
  const options = parsePageViewCleanupArgs(args);
  const config = loadApiConfig();
  const prisma = createPrismaClient(config.databaseUrl);
  try {
    await ensureDatabaseSchema(prisma, { uploadDir: config.paths.uploadDir });
    const now = new Date();
    if (options.dryRun) {
      const count = await countExpiredPageViewEvents(prisma, {
        now,
        retentionDays: config.analytics.retentionDays
      });
      console.log(`Expired page-view events would be deleted: ${count}`);
      return { deletedCount: 0, dryRunCount: count };
    }
    const result = await cleanupExpiredPageViewEvents(prisma, {
      now,
      retentionDays: config.analytics.retentionDays
    });
    console.log(`Expired page-view events deleted: ${result.deletedCount}`);
    return { ...result, dryRunCount: null };
  } finally {
    await prisma.$disconnect();
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runPageViewCleanupCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
