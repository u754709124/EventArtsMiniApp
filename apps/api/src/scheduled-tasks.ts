import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  scheduledTaskDtoSchema,
  scheduledTaskKeyValues,
  scheduledTaskListResponseSchema,
  scheduledTaskRunResponseSchema,
  scheduledTaskTimeZone,
  type ScheduledTaskDto,
  type ScheduledTaskKey,
  type ScheduledTaskListResponse,
  type ScheduledTaskRunResponse,
  type ScheduledTaskSafeSummary
} from "@event-arts/shared";
import type { AppPrismaClient } from "./db";

export type { ScheduledTaskKey };

type ScheduledTaskStateClient = AppPrismaClient | Prisma.TransactionClient;

export type ScheduledTaskHandlerContext = {
  taskKey: ScheduledTaskKey;
  now: () => Date;
};

export type ScheduledTaskHandler = (
  context: ScheduledTaskHandlerContext
) => Promise<ScheduledTaskSafeSummary>;

export type ScheduledTaskRunnerOptions = {
  prisma: AppPrismaClient;
  handlers: Partial<Record<ScheduledTaskKey, ScheduledTaskHandler>>;
  now?: () => Date;
  leaseMs?: number;
};

export type ScheduledTaskRunner = ReturnType<typeof createScheduledTaskRunner>;

type ScheduledTaskTimer = ReturnType<typeof setTimeout> | number;

export type ScheduledTaskSchedulerTimerApi = {
  setTimeout: (callback: () => void, delayMs: number) => ScheduledTaskTimer;
  clearTimeout: (timer: ScheduledTaskTimer) => void;
};

export type ScheduledTaskSchedulerLogger = {
  info?: (payload: Record<string, unknown>, message?: string) => void;
  warn?: (payload: Record<string, unknown>, message?: string) => void;
  error?: (payload: Record<string, unknown>, message?: string) => void;
};

export type ScheduledTaskSchedulerOptions = {
  runner: ScheduledTaskRunner;
  now?: () => Date;
  timers?: Partial<ScheduledTaskSchedulerTimerApi>;
  logger?: ScheduledTaskSchedulerLogger;
  maxDelayMs?: number;
};

type ScheduledTaskCatalogItem = {
  taskKey: ScheduledTaskKey;
  name: string;
  description: string;
  cron: string;
  timezone: typeof scheduledTaskTimeZone;
};

type ParsedCron = {
  minutes: Set<number>;
  hours: Set<number>;
};

const minuteMs = 60_000;
const shanghaiOffsetMs = 8 * 60 * minuteMs;
const defaultLeaseMs = 10 * 60_000;
const renewalFloorMs = 1_000;
const maxTimerDelayMs = 2_147_483_647;

export const scheduledTaskCatalog = [
  {
    taskKey: "admin-session-cleanup",
    name: "管理员会话清理",
    description: "删除已过期的后台管理员登录会话。",
    cron: "2 * * * *",
    timezone: scheduledTaskTimeZone
  },
  {
    taskKey: "admin-notification-cleanup",
    name: "管理员消息清理",
    description: "删除超过保留期的后台通知消息。",
    cron: "10 3 * * *",
    timezone: scheduledTaskTimeZone
  },
  {
    taskKey: "analytics-cleanup",
    name: "访问统计清理",
    description: "删除超过保留期的访问统计数据。",
    cron: "20 3 * * *",
    timezone: scheduledTaskTimeZone
  },
  {
    taskKey: "edgeone-prefetch-reconcile",
    name: "EdgeOne 预热对账",
    description: "对账 EdgeOne 资源预热任务状态并推进重试。",
    cron: "*/5 * * * *",
    timezone: scheduledTaskTimeZone
  }
] as const satisfies readonly ScheduledTaskCatalogItem[];

const scheduledTaskKeys = new Set<ScheduledTaskKey>(scheduledTaskKeyValues);

export class ScheduledTaskNotFoundError extends Error {
  readonly code = "SCHEDULED_TASK_NOT_FOUND";
  readonly statusCode = 404;

  constructor(readonly taskKey: string) {
    super("定时任务不存在");
    this.name = "ScheduledTaskNotFoundError";
  }
}

export class ScheduledTaskBusyError extends Error {
  readonly code = "SCHEDULED_TASK_BUSY";
  readonly statusCode = 409;

  constructor(readonly taskKey: ScheduledTaskKey) {
    super("任务正在执行，请稍后再试");
    this.name = "ScheduledTaskBusyError";
  }
}

export class ScheduledTaskExecutionError extends Error {
  readonly code = "SCHEDULED_TASK_FAILED";
  readonly statusCode = 500;

  constructor(readonly taskKey: ScheduledTaskKey, readonly summary: ScheduledTaskSafeSummary) {
    super("任务执行失败，请稍后重试");
    this.name = "ScheduledTaskExecutionError";
  }
}

export function isScheduledTaskKey(value: string): value is ScheduledTaskKey {
  return scheduledTaskKeys.has(value as ScheduledTaskKey);
}

export function requireScheduledTaskKey(value: string): ScheduledTaskKey {
  if (!isScheduledTaskKey(value)) throw new ScheduledTaskNotFoundError(value);
  return value;
}

function range(from: number, to: number) {
  const values = new Set<number>();
  for (let value = from; value <= to; value += 1) values.add(value);
  return values;
}

function parseCronField(value: string, min: number, max: number) {
  if (value === "*") return range(min, max);
  if (value.startsWith("*/")) {
    const step = Number(value.slice(2));
    if (!Number.isInteger(step) || step < 1 || step > max - min + 1) {
      throw new Error(`unsupported cron step: ${value}`);
    }
    const values = new Set<number>();
    for (let item = min; item <= max; item += step) values.add(item);
    return values;
  }
  const fixed = Number(value);
  if (!Number.isInteger(fixed) || fixed < min || fixed > max) {
    throw new Error(`unsupported cron field: ${value}`);
  }
  return new Set([fixed]);
}

export function parseScheduledTaskCron(cron: string): ParsedCron {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5 || parts[2] !== "*" || parts[3] !== "*" || parts[4] !== "*") {
    throw new Error(`unsupported scheduled task cron: ${cron}`);
  }
  return {
    minutes: parseCronField(parts[0]!, 0, 59),
    hours: parseCronField(parts[1]!, 0, 23)
  };
}

function shanghaiWallClockDate(utcDate: Date) {
  return new Date(utcDate.getTime() + shanghaiOffsetMs);
}

function utcDateFromShanghaiWallClock(wallClockDate: Date) {
  return new Date(wallClockDate.getTime() - shanghaiOffsetMs);
}

export function nextScheduledTaskExecution(cron: string, now: Date) {
  if (!Number.isFinite(now.getTime())) throw new Error("invalid current time");
  const parsed = parseScheduledTaskCron(cron);
  const startWallClock = shanghaiWallClockDate(now);
  startWallClock.setUTCSeconds(0, 0);
  startWallClock.setUTCMinutes(startWallClock.getUTCMinutes() + 1);

  for (let offset = 0; offset < 366 * 24 * 60; offset += 1) {
    const candidate = new Date(startWallClock.getTime() + offset * minuteMs);
    if (parsed.hours.has(candidate.getUTCHours()) && parsed.minutes.has(candidate.getUTCMinutes())) {
      const utc = utcDateFromShanghaiWallClock(candidate);
      if (utc.getTime() > now.getTime()) return utc;
    }
  }
  throw new Error(`unable to compute next execution for cron: ${cron}`);
}

function schedulerErrorPayload(error: unknown) {
  const candidate = error as { code?: unknown; statusCode?: unknown; name?: unknown };
  return sanitizeSummary({
    errorCode: typeof candidate.code === "string" ? candidate.code : "SCHEDULED_TASK_SCHEDULER_ERROR",
    statusCode: typeof candidate.statusCode === "number" ? candidate.statusCode : null,
    errorName: typeof candidate.name === "string" ? candidate.name : null
  });
}

export function createScheduledTaskScheduler(options: ScheduledTaskSchedulerOptions) {
  const now = options.now ?? (() => new Date());
  const setTimer = options.timers?.setTimeout ?? setTimeout;
  const clearTimer = options.timers?.clearTimeout ?? clearTimeout;
  const logger = options.logger;
  const timers = new Map<ScheduledTaskKey, ScheduledTaskTimer>();
  const delayCeilingMs = Math.max(1, options.maxDelayMs ?? maxTimerDelayMs);
  let started = false;

  function log(
    level: "info" | "warn" | "error",
    payload: Record<string, unknown>,
    message: string
  ) {
    logger?.[level]?.({ event: "scheduled_task_scheduler", ...payload }, message);
  }

  function clearTaskTimer(taskKey: ScheduledTaskKey) {
    const existing = timers.get(taskKey);
    if (existing === undefined) return;
    clearTimer(existing);
    timers.delete(taskKey);
  }

  function schedule(item: ScheduledTaskCatalogItem) {
    if (!started) return;
    clearTaskTimer(item.taskKey);

    const current = now();
    const next = nextScheduledTaskExecution(item.cron, current);
    const delayMs = Math.max(0, Math.min(next.getTime() - current.getTime(), delayCeilingMs));
    const timer = setTimer(() => {
      timers.delete(item.taskKey);
      if (now().getTime() < next.getTime()) {
        schedule(item);
        return;
      }
      void runAndReschedule(item);
    }, delayMs);
    (timer as { unref?: () => void }).unref?.();
    timers.set(item.taskKey, timer);
    log("info", {
      taskKey: item.taskKey,
      nextExecutionAt: next.toISOString(),
      delayMs
    }, "Scheduled task timer armed");
  }

  async function runAndReschedule(item: ScheduledTaskCatalogItem) {
    if (!started) return;
    try {
      const result = await options.runner.run(item.taskKey);
      log("info", {
        taskKey: result.taskKey,
        status: result.status,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt
      }, "Scheduled task completed");
    } catch (error) {
      const payload = schedulerErrorPayload(error);
      log(error instanceof ScheduledTaskBusyError ? "warn" : "error", {
        taskKey: item.taskKey,
        ...payload
      }, "Scheduled task execution did not complete successfully");
    } finally {
      schedule(item);
    }
  }

  return {
    start() {
      if (started) return false;
      started = true;
      for (const item of scheduledTaskCatalog) schedule(item);
      log("info", { taskCount: scheduledTaskCatalog.length }, "Scheduled task scheduler started");
      return true;
    },
    stop() {
      if (!started && timers.size === 0) return false;
      started = false;
      for (const taskKey of Array.from(timers.keys())) clearTaskTimer(taskKey);
      log("info", { taskCount: scheduledTaskCatalog.length }, "Scheduled task scheduler stopped");
      return true;
    },
    isStarted() {
      return started;
    }
  };
}

function parseSummary(value: string | null): ScheduledTaskSafeSummary | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return sanitizeSummary(parsed as Record<string, unknown>);
  } catch {
    return null;
  }
}

function sanitizeSummaryValue(value: unknown) {
  if (typeof value === "string") return value.slice(0, 300);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean" || value === null) return value;
  return undefined;
}

export function sanitizeSummary(input: Record<string, unknown>): ScheduledTaskSafeSummary {
  const summary: ScheduledTaskSafeSummary = {};
  for (const [rawKey, rawValue] of Object.entries(input).slice(0, 20)) {
    const key = rawKey.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 80);
    if (!key) continue;
    const value = sanitizeSummaryValue(rawValue);
    if (value !== undefined) summary[key] = value;
  }
  return summary;
}

function safeFailureSummary(error: unknown): ScheduledTaskSafeSummary {
  const candidate = error as { code?: unknown; status?: unknown; publicMessage?: unknown };
  return sanitizeSummary({
    errorCode: typeof candidate.code === "string" ? candidate.code : "TASK_FAILED",
    status: typeof candidate.status === "string" ? candidate.status : null,
    message: typeof candidate.publicMessage === "string" ? candidate.publicMessage : "任务执行失败"
  });
}

function serializeSummary(summary: ScheduledTaskSafeSummary) {
  return JSON.stringify(sanitizeSummary(summary));
}

function toTaskDto(
  item: ScheduledTaskCatalogItem,
  state: {
    lastStartedAt: Date | null;
    lastFinishedAt: Date | null;
    lastStatus: string | null;
    resultSummaryJson: string | null;
    leaseToken: string | null;
    leaseExpiresAt: Date | null;
  } | null,
  now: Date
): ScheduledTaskDto {
  const isRunning = Boolean(state?.leaseToken && state.leaseExpiresAt && state.leaseExpiresAt > now);
  const status = state?.lastStatus === "running" || state?.lastStatus === "success" || state?.lastStatus === "failed"
    ? state.lastStatus
    : null;
  return scheduledTaskDtoSchema.parse({
    taskKey: item.taskKey,
    name: item.name,
    description: item.description,
    cron: item.cron,
    timezone: item.timezone,
    nextExecutionAt: nextScheduledTaskExecution(item.cron, now).toISOString(),
    lastExecutionAt: state?.lastStartedAt?.toISOString() ?? null,
    lastFinishedAt: state?.lastFinishedAt?.toISOString() ?? null,
    lastStatus: status,
    isRunning,
    resultSummary: parseSummary(state?.resultSummaryJson ?? null)
  });
}

export async function listScheduledTasks(
  prisma: AppPrismaClient,
  now = new Date()
): Promise<ScheduledTaskListResponse> {
  const rows = await prisma.scheduledTaskState.findMany({
    where: { taskKey: { in: scheduledTaskCatalog.map((item) => item.taskKey) } }
  });
  const stateByKey = new Map(rows.map((row) => [row.taskKey, row]));
  return scheduledTaskListResponseSchema.parse({
    items: scheduledTaskCatalog.map((item) => toTaskDto(item, stateByKey.get(item.taskKey) ?? null, now))
  });
}

async function ensureTaskState(tx: ScheduledTaskStateClient, taskKey: ScheduledTaskKey, now: Date) {
  await tx.scheduledTaskState.upsert({
    where: { taskKey },
    update: {},
    create: {
      taskKey,
      createdAt: now,
      updatedAt: now
    }
  });
}

async function acquireLease(input: {
  prisma: AppPrismaClient;
  taskKey: ScheduledTaskKey;
  now: Date;
  leaseMs: number;
}) {
  const leaseToken = randomUUID();
  const leaseExpiresAt = new Date(input.now.getTime() + input.leaseMs);
  const acquired = await input.prisma.$transaction(async (tx) => {
    await ensureTaskState(tx, input.taskKey, input.now);
    const result = await tx.scheduledTaskState.updateMany({
      where: {
        taskKey: input.taskKey,
        OR: [
          { leaseToken: null },
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lte: input.now } }
        ]
      },
      data: {
        leaseToken,
        leaseExpiresAt,
        lastStartedAt: input.now,
        lastStatus: "running",
        updatedAt: input.now
      }
    });
    return result.count === 1;
  });
  return acquired ? { leaseToken, leaseExpiresAt } : null;
}

async function renewLease(input: {
  prisma: AppPrismaClient;
  taskKey: ScheduledTaskKey;
  leaseToken: string;
  now: Date;
  leaseMs: number;
}) {
  const result = await input.prisma.scheduledTaskState.updateMany({
    where: {
      taskKey: input.taskKey,
      leaseToken: input.leaseToken
    },
    data: {
      leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs),
      updatedAt: input.now
    }
  });
  return result.count === 1;
}

async function finishLease(input: {
  prisma: AppPrismaClient;
  taskKey: ScheduledTaskKey;
  leaseToken: string;
  finishedAt: Date;
  status: "success" | "failed";
  summary: ScheduledTaskSafeSummary;
}) {
  await input.prisma.scheduledTaskState.updateMany({
    where: {
      taskKey: input.taskKey,
      leaseToken: input.leaseToken
    },
    data: {
      leaseToken: null,
      leaseExpiresAt: null,
      lastFinishedAt: input.finishedAt,
      lastStatus: input.status,
      resultSummaryJson: serializeSummary(input.summary),
      updatedAt: input.finishedAt
    }
  });
}

export function createScheduledTaskRunner(options: ScheduledTaskRunnerOptions) {
  const now = options.now ?? (() => new Date());
  const leaseMs = options.leaseMs ?? defaultLeaseMs;

  return {
    async run(taskKeyInput: string): Promise<ScheduledTaskRunResponse> {
      const taskKey = requireScheduledTaskKey(taskKeyInput);
      const handler = options.handlers[taskKey];
      if (!handler) throw new ScheduledTaskNotFoundError(taskKey);

      const startedAt = now();
      const lease = await acquireLease({ prisma: options.prisma, taskKey, now: startedAt, leaseMs });
      if (!lease) throw new ScheduledTaskBusyError(taskKey);

      const renewalInterval = setInterval(() => {
        void renewLease({
          prisma: options.prisma,
          taskKey,
          leaseToken: lease.leaseToken,
          now: now(),
          leaseMs
        }).catch(() => undefined);
      }, Math.max(renewalFloorMs, Math.floor(leaseMs / 3)));
      renewalInterval.unref?.();

      try {
        const summary = sanitizeSummary(await handler({ taskKey, now }));
        const finishedAt = now();
        await finishLease({
          prisma: options.prisma,
          taskKey,
          leaseToken: lease.leaseToken,
          finishedAt,
          status: "success",
          summary
        });
        return scheduledTaskRunResponseSchema.parse({
          taskKey,
          status: "success",
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          resultSummary: summary
        });
      } catch (error) {
        const summary = safeFailureSummary(error);
        const finishedAt = now();
        await finishLease({
          prisma: options.prisma,
          taskKey,
          leaseToken: lease.leaseToken,
          finishedAt,
          status: "failed",
          summary
        });
        throw new ScheduledTaskExecutionError(taskKey, summary);
      } finally {
        clearInterval(renewalInterval);
      }
    }
  };
}
