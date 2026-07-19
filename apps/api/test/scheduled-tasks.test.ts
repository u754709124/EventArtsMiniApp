import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { backupManifestSchema } from "@event-arts/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAdminNotificationCleanupCli } from "../src/admin-notifications";
import { runAdminSessionCleanupCli } from "../src/admin-sessions";
import { runPageViewCleanupCli } from "../src/analytics";
import { buildApp } from "../src/app";
import { backupImpactTables, createBackupService, type BackupServiceHooks } from "../src/backup";
import type { LoadApiConfigOptions } from "../src/config";
import { createPrismaClient, type AppPrismaClient } from "../src/db";
import { runEdgeOnePrefetchReconcile } from "../src/edgeone-prefetch-reconcile";
import { ensureDatabaseSchema } from "../src/sqlite-schema";
import {
  ScheduledTaskBusyError,
  createScheduledTaskScheduler,
  createScheduledTaskRunner,
  listScheduledTasks,
  nextScheduledTaskExecution,
  type ScheduledTaskHandler,
  type ScheduledTaskSchedulerTimerApi
} from "../src/scheduled-tasks";
import { resetTestAdmin, testAdminCredentials } from "./fixtures";

let root: string;
let uploadDir: string;
let backupDir: string;
let databaseUrl: string;
let prisma: AppPrismaClient;
let app: Awaited<ReturnType<typeof buildApp>> | null;
let now: Date;

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function login() {
  if (!app) throw new Error("app not started");
  const response = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: testAdminCredentials
  });
  expect(response.statusCode).toBe(200);
  return String(response.json().data.token);
}

function cliConfig(): LoadApiConfigOptions {
  return {
    repositoryRoot: root,
    envFilePath: path.join(root, ".env"),
    processEnv: {
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      PUBLIC_BASE_URL: "http://127.0.0.1:3001",
      UPLOAD_DIR: uploadDir,
      BACKUP_DIR: backupDir,
      JWT_SECRET: "scheduled-task-cli-test-secret",
      WECHAT_AUTH_VERIFIER_MODE: "fake",
      WECHAT_MINIAPP_APP_ID: "wx0123456789abcdef"
    }
  };
}

async function startApp(
  handlers?: Partial<Record<string, ScheduledTaskHandler>>,
  leaseMs = 5_000,
  backupHooks?: BackupServiceHooks
) {
  app = await buildApp({
    prisma,
    jwtSecret: "scheduled-task-test-secret",
    uploadDir,
    backupDir,
    databaseUrl,
    publicBaseUrl: "http://127.0.0.1:3001",
    now: () => now,
    backupHooks,
    scheduledTasks: { handlers, leaseMs }
  });
  return app;
}

async function readBackupManifest(backupId: string) {
  return backupManifestSchema.parse(
    JSON.parse(await readFile(path.join(backupDir, backupId, "manifest.json"), "utf8"))
  );
}

async function publishedBackupIds() {
  const entries = await readdir(backupDir).catch(() => []);
  const visible: string[] = [];
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const entryStat = await lstat(path.join(backupDir, entry)).catch(() => null);
    if (entryStat?.isDirectory()) visible.push(entry);
  }
  return visible.sort();
}

function createTimerHarness() {
  let nextId = 0;
  const pending = new Map<number, { callback: () => void; delayMs: number }>();
  const timers: ScheduledTaskSchedulerTimerApi = {
    setTimeout(callback, delayMs) {
      const id = nextId;
      nextId += 1;
      pending.set(id, { callback, delayMs });
      return id;
    },
    clearTimeout(timer) {
      pending.delete(Number(timer));
    }
  };
  return {
    timers,
    pending,
    fire(id: number) {
      const timer = pending.get(id);
      if (!timer) throw new Error(`timer ${id} is not pending`);
      pending.delete(id);
      timer.callback();
    }
  };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "event-arts-scheduled-tasks-"));
  uploadDir = path.join(root, "uploads");
  backupDir = path.join(root, "backups");
  databaseUrl = `file:${path.join(root, "test.db")}`;
  now = new Date("2026-07-18T01:00:30.000Z");
  await mkdir(uploadDir, { recursive: true });
  await mkdir(backupDir, { recursive: true });
  prisma = createPrismaClient(databaseUrl);
  await ensureDatabaseSchema(prisma, { uploadDir });
  await resetTestAdmin(prisma);
  app = null;
});

afterEach(async () => {
  if (app) await app.close();
  await prisma.$disconnect();
  await rm(root, { recursive: true, force: true });
});

describe("scheduled task cron and schema", () => {
  it("computes fixed Asia/Shanghai cron boundaries strictly after now", () => {
    expect(nextScheduledTaskExecution("2 * * * *", new Date("2026-07-18T01:01:59.999Z")).toISOString())
      .toBe("2026-07-18T01:02:00.000Z");
    expect(nextScheduledTaskExecution("2 * * * *", new Date("2026-07-18T01:02:00.000Z")).toISOString())
      .toBe("2026-07-18T02:02:00.000Z");
    expect(nextScheduledTaskExecution("10 3 * * *", new Date("2026-07-17T19:09:59.999Z")).toISOString())
      .toBe("2026-07-17T19:10:00.000Z");
    expect(nextScheduledTaskExecution("20 3 * * *", new Date("2026-07-17T19:20:00.000Z")).toISOString())
      .toBe("2026-07-18T19:20:00.000Z");
    expect(nextScheduledTaskExecution("*/5 * * * *", new Date("2026-07-18T01:04:59.999Z")).toISOString())
      .toBe("2026-07-18T01:05:00.000Z");
    expect(nextScheduledTaskExecution("0 0 * * *", new Date("2026-07-18T15:59:59.999Z")).toISOString())
      .toBe("2026-07-18T16:00:00.000Z");
    expect(nextScheduledTaskExecution("0 0 * * *", new Date("2026-07-18T16:00:00.000Z")).toISOString())
      .toBe("2026-07-19T16:00:00.000Z");
  });

  it("creates the additive state table idempotently and includes it in backup impact tables", async () => {
    await ensureDatabaseSchema(prisma, { uploadDir });
    const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type IN ('table','index') AND name LIKE 'scheduled_task_states%'"
    );
    const names = rows.map((row) => row.name);
    expect(names).toContain("scheduled_task_states");
    expect(names).toContain("scheduled_task_states_leaseExpiresAt_idx");
    expect(backupImpactTables).toContain("scheduled_task_states");
  });
});

describe("scheduled task scheduler", () => {
  it("keeps buildApp timer-free unless the real server enables the scheduler", async () => {
    const timerHarness = createTimerHarness();
    app = await buildApp({
      prisma,
      jwtSecret: "scheduled-task-test-secret",
      uploadDir,
      backupDir,
      databaseUrl,
      publicBaseUrl: "http://127.0.0.1:3001",
      now: () => now,
      scheduledTasks: {
        scheduler: { timers: timerHarness.timers }
      }
    });

    await app.ready();
    expect(timerHarness.pending.size).toBe(0);
  });

  it("starts once, waits until due, persists a scheduled run, and stops cleanly", async () => {
    const timerHarness = createTimerHarness();
    const handler = vi.fn().mockResolvedValue({ deletedCount: 2 });
    app = await buildApp({
      prisma,
      jwtSecret: "scheduled-task-test-secret",
      uploadDir,
      backupDir,
      databaseUrl,
      publicBaseUrl: "http://127.0.0.1:3001",
      now: () => now,
      scheduledTasks: {
        handlers: { "admin-session-cleanup": handler },
        scheduler: { enabled: true, timers: timerHarness.timers }
      }
    });

    await app.ready();
    expect(timerHarness.pending.size).toBe(5);
    expect(handler).not.toHaveBeenCalled();
    const sessionTimer = [...timerHarness.pending].find(([, timer]) => timer.delayMs === 90_000);
    expect(sessionTimer).toBeDefined();

    now = new Date("2026-07-18T01:02:00.000Z");
    timerHarness.fire(sessionTimer![0]);
    await vi.waitFor(async () => {
      const state = await prisma.scheduledTaskState.findUnique({
        where: { taskKey: "admin-session-cleanup" }
      });
      expect(state).toMatchObject({
        lastStartedAt: now,
        lastFinishedAt: now,
        lastStatus: "success"
      });
    });
    expect(handler).toHaveBeenCalledOnce();
    expect(timerHarness.pending.size).toBe(5);

    await app.close();
    app = null;
    expect(timerHarness.pending.size).toBe(0);
  });

  it("is idempotent and reschedules after busy and failed executions without leaking errors", async () => {
    const timerHarness = createTimerHarness();
    const secret = "scheduler-secret-must-not-leak";
    const runner = {
      run: vi.fn()
        .mockRejectedValueOnce(new ScheduledTaskBusyError("admin-session-cleanup"))
        .mockRejectedValueOnce(new Error(secret))
    } as unknown as ReturnType<typeof createScheduledTaskRunner>;
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    const scheduler = createScheduledTaskScheduler({
      runner,
      now: () => now,
      timers: timerHarness.timers,
      logger
    });

    expect(scheduler.start()).toBe(true);
    expect(scheduler.start()).toBe(false);
    expect(timerHarness.pending.size).toBe(5);

    const firstTimer = [...timerHarness.pending].find(([, timer]) => timer.delayMs === 90_000);
    now = new Date("2026-07-18T01:02:00.000Z");
    timerHarness.fire(firstTimer![0]);
    await vi.waitFor(() => expect(runner.run).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalled());
    expect(timerHarness.pending.size).toBe(5);

    const secondTimer = [...timerHarness.pending].find(([, timer]) => timer.delayMs === 3_600_000);
    now = new Date("2026-07-18T02:02:00.000Z");
    timerHarness.fire(secondTimer![0]);
    await vi.waitFor(() => expect(runner.run).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());
    expect(JSON.stringify([
      logger.info.mock.calls,
      logger.warn.mock.calls,
      logger.error.mock.calls
    ])).not.toContain(secret);
    expect(timerHarness.pending.size).toBe(5);

    expect(scheduler.stop()).toBe(true);
    expect(scheduler.stop()).toBe(false);
    expect(timerHarness.pending.size).toBe(0);
  });
});

describe("scheduled task runner leases", () => {
  it("serializes the same task, allows different tasks, and recovers expired leases", async () => {
    let releaseSession!: () => void;
    let markStarted!: () => void;
    const sessionStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const runner = createScheduledTaskRunner({
      prisma,
      now: () => now,
      leaseMs: 30_000,
      handlers: {
        "admin-session-cleanup": async () => {
          markStarted();
          await new Promise<void>((release) => {
            releaseSession = release;
          });
          return { deletedCount: 1 };
        },
        "admin-notification-cleanup": async () => ({ deletedCount: 2 }),
        "analytics-cleanup": async () => ({ deletedCount: 3 }),
        "edgeone-prefetch-reconcile": async () => ({ status: "disabled" })
      }
    });
    const firstRun = runner.run("admin-session-cleanup");
    await sessionStarted;
    await expect(runner.run("admin-session-cleanup")).rejects.toMatchObject({ code: "SCHEDULED_TASK_BUSY" });
    await expect(runner.run("admin-notification-cleanup")).resolves.toMatchObject({
      taskKey: "admin-notification-cleanup",
      status: "success"
    });
    releaseSession();
    await expect(firstRun).resolves.toMatchObject({
      taskKey: "admin-session-cleanup",
      status: "success"
    });

    await prisma.scheduledTaskState.upsert({
      where: { taskKey: "analytics-cleanup" },
      update: {
        leaseToken: "expired-token",
        leaseExpiresAt: new Date(now.getTime() - 1_000),
        lastStatus: "running"
      },
      create: {
        taskKey: "analytics-cleanup",
        leaseToken: "expired-token",
        leaseExpiresAt: new Date(now.getTime() - 1_000),
        lastStatus: "running"
      }
    });
    const recoveryRunner = createScheduledTaskRunner({
      prisma,
      now: () => now,
      handlers: {
        "admin-session-cleanup": async () => ({ deletedCount: 0 }),
        "admin-notification-cleanup": async () => ({ deletedCount: 0 }),
        "analytics-cleanup": async () => ({ deletedCount: 1 }),
        "edgeone-prefetch-reconcile": async () => ({ status: "disabled" })
      }
    });
    await expect(recoveryRunner.run("analytics-cleanup")).resolves.toMatchObject({ status: "success" });
  });
});

describe("scheduled task admin API", () => {
  it("runs automatic backups through the same runner and keeps only the latest three automatic records", async () => {
    const service = createBackupService({ prisma, uploadDir, backupDir, databaseUrl, now: () => now });

    now = new Date("2026-07-18T02:00:00.000Z");
    const manual = await service.createBackup({ note: "manual-keep" });
    now = new Date("2026-07-18T02:01:00.000Z");
    const restoreSnapshot = await service.createBackup({ backupKind: "restore_snapshot", note: "restore-keep" });
    const importId = `import-20260718T020200000Z-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    await cp(path.join(backupDir, manual.id), path.join(backupDir, importId), { recursive: true });

    await startApp();
    now = new Date("2026-07-18T15:59:00.000Z");
    const token = await login();

    const automaticIds: string[] = [];
    let lastSummary: Record<string, unknown> | null = null;
    for (let index = 0; index < 5; index += 1) {
      now = new Date(Date.UTC(2026, 6, 18, 16, index, 0));
      const run = await app!.inject({
        method: "POST",
        url: "/api/admin/scheduled-tasks/automatic-backup/run",
        headers: auth(token),
        payload: {}
      });
      expect(run.statusCode, run.body).toBe(200);
      const summary = run.json().data.resultSummary as Record<string, unknown>;
      expect(summary).toMatchObject({
        status: "completed",
        backupKind: "automatic",
        dataScope: "non_identity",
        keepCount: 3,
        skippedConflictCount: 0
      });
      automaticIds.push(String(summary.createdBackupId));
      lastSummary = summary;
      const serializedSummary = JSON.stringify(summary);
      expect(serializedSummary).not.toContain(backupDir);
      expect(serializedSummary).not.toContain(uploadDir);
      expect(serializedSummary).not.toContain(testAdminCredentials.username);
      expect(serializedSummary).not.toContain("scheduled-task-test-secret");
    }

    expect(lastSummary).toMatchObject({
      automaticBackupCount: 4,
      retainedCount: 3,
      deletedCount: 1
    });
    const latestAutomaticIds = automaticIds.slice(-3).sort();
    const finalBackups = await service.listBackups();
    expect(finalBackups.filter((backup) => backup.backupKind === "automatic").map((backup) => backup.id).sort())
      .toEqual(latestAutomaticIds);
    expect(finalBackups.find((backup) => backup.id === manual.id)).toMatchObject({ backupKind: "manual" });
    expect(finalBackups.find((backup) => backup.id === restoreSnapshot.id)).toMatchObject({
      backupKind: "restore_snapshot"
    });
    expect(finalBackups.find((backup) => backup.id === importId)).toMatchObject({ backupKind: "imported" });
    expect(await publishedBackupIds()).toEqual(expect.arrayContaining([
      manual.id,
      restoreSnapshot.id,
      importId,
      ...latestAutomaticIds
    ]));
    expect(await publishedBackupIds()).not.toEqual(expect.arrayContaining(automaticIds.slice(0, 2)));

    for (const backupId of latestAutomaticIds) {
      await expect(readBackupManifest(backupId)).resolves.toMatchObject({
        formatVersion: 3,
        dataScope: "non_identity",
        backupKind: "automatic",
        createdBy: { username: "系统任务" },
        note: null
      });
    }

    const state = await prisma.scheduledTaskState.findUniqueOrThrow({
      where: { taskKey: "automatic-backup" }
    });
    expect(state.lastStatus).toBe("success");
    expect(state.resultSummaryJson).not.toContain(backupDir);
    expect(state.resultSummaryJson).not.toContain(uploadDir);
    expect(state.resultSummaryJson).not.toContain(testAdminCredentials.username);
  });

  it("does not prune existing automatic backups when automatic backup creation fails", async () => {
    const service = createBackupService({ prisma, uploadDir, backupDir, databaseUrl, now: () => now });
    const existingAutomaticIds: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      now = new Date(Date.UTC(2026, 6, 18, 12, index, 0));
      existingAutomaticIds.push((await service.createBackup({ backupKind: "automatic" })).id);
    }
    const secret = "automatic-backup-failure-secret";
    await startApp(undefined, 5_000, {
      beforePublish: async () => {
        throw new Error(`planned ${secret} ${backupDir}`);
      }
    });
    now = new Date("2026-07-18T15:59:00.000Z");
    const token = await login();
    now = new Date("2026-07-18T16:00:00.000Z");

    const failed = await app!.inject({
      method: "POST",
      url: "/api/admin/scheduled-tasks/automatic-backup/run",
      headers: auth(token),
      payload: {}
    });

    expect(failed.statusCode).toBe(500);
    expect(failed.json()).toMatchObject({
      success: false,
      error: { code: "SCHEDULED_TASK_FAILED" }
    });
    expect(await publishedBackupIds()).toEqual(existingAutomaticIds.sort());
    const state = await prisma.scheduledTaskState.findUniqueOrThrow({
      where: { taskKey: "automatic-backup" }
    });
    expect(state.lastStatus).toBe("failed");
    expect(state.resultSummaryJson).not.toContain(secret);
    expect(state.resultSummaryJson).not.toContain(backupDir);
  });

  it("requires auth, returns no-store catalog data, runs by task key, and rejects arbitrary input", async () => {
    await startApp({
      "admin-session-cleanup": async () => ({ deletedCount: 0 })
    });
    const unauthorized = await app!.inject({ method: "GET", url: "/api/admin/scheduled-tasks" });
    expect(unauthorized.statusCode).toBe(401);

    const token = await login();
    const list = await app!.inject({
      method: "GET",
      url: "/api/admin/scheduled-tasks",
      headers: auth(token)
    });
    expect(list.statusCode).toBe(200);
    expect(list.headers["cache-control"]).toBe("no-store");
    expect(list.json().data.items.map((item: { taskKey: string }) => item.taskKey)).toEqual([
      "admin-session-cleanup",
      "admin-notification-cleanup",
      "analytics-cleanup",
      "edgeone-prefetch-reconcile",
      "automatic-backup"
    ]);
    expect(list.json().data.items[0]).toMatchObject({
      name: "管理员会话清理",
      cron: "2 * * * *",
      timezone: "Asia/Shanghai",
      lastExecutionAt: null,
      isRunning: false
    });

    const rejectedPayload = await app!.inject({
      method: "POST",
      url: "/api/admin/scheduled-tasks/admin-session-cleanup/run",
      headers: auth(token),
      payload: { command: "rm -rf /", cron: "* * * * *", secretKey: "client-secret" }
    });
    expect(rejectedPayload.statusCode).toBe(400);

    const run = await app!.inject({
      method: "POST",
      url: "/api/admin/scheduled-tasks/admin-session-cleanup/run",
      headers: auth(token),
      payload: {}
    });
    expect(run.statusCode).toBe(200);
    expect(run.headers["cache-control"]).toBe("no-store");
    expect(run.json().data).toMatchObject({
      taskKey: "admin-session-cleanup",
      status: "success",
      resultSummary: { deletedCount: 0 }
    });

    const refreshed = await listScheduledTasks(prisma, now);
    expect(refreshed.items[0]).toMatchObject({
      lastExecutionAt: now.toISOString(),
      lastStatus: "success",
      resultSummary: { deletedCount: 0 }
    });
  });

  it("returns 404 for unknown tasks, 409 for busy tasks, and safe failure envelopes", async () => {
    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const secretId = "edgeone-secret-id-value";
    const secretKey = "edgeone-secret-key-value";
    const targetUrl = "https://media.example.com/private.jpg";
    await startApp({
      "admin-session-cleanup": async () => {
        markStarted();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { deletedCount: 0 };
      },
      "analytics-cleanup": async () => {
        throw new Error(`planned failure ${secretId} ${secretKey} ${targetUrl}`);
      }
    });
    const token = await login();

    const unknown = await app!.inject({
      method: "POST",
      url: "/api/admin/scheduled-tasks/not-a-task/run",
      headers: auth(token),
      payload: {}
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({
      success: false,
      error: { code: "SCHEDULED_TASK_NOT_FOUND" }
    });

    const firstRun = app!.inject({
      method: "POST",
      url: "/api/admin/scheduled-tasks/admin-session-cleanup/run",
      headers: auth(token),
      payload: {}
    });
    await started;
    const busy = await app!.inject({
      method: "POST",
      url: "/api/admin/scheduled-tasks/admin-session-cleanup/run",
      headers: auth(token),
      payload: {}
    });
    expect(busy.statusCode).toBe(409);
    expect(busy.json()).toMatchObject({
      success: false,
      error: { code: "SCHEDULED_TASK_BUSY" }
    });
    release();
    await expect(firstRun).resolves.toMatchObject({ statusCode: 200 });

    const failure = await app!.inject({
      method: "POST",
      url: "/api/admin/scheduled-tasks/analytics-cleanup/run",
      headers: auth(token),
      payload: {}
    });
    expect(failure.statusCode).toBe(500);
    expect(failure.json()).toMatchObject({
      success: false,
      error: { code: "SCHEDULED_TASK_FAILED" }
    });
    const body = failure.body;
    expect(body).not.toContain(secretId);
    expect(body).not.toContain(secretKey);
    expect(body).not.toContain(targetUrl);
    const failedState = await prisma.scheduledTaskState.findUniqueOrThrow({
      where: { taskKey: "analytics-cleanup" }
    });
    expect(failedState.lastStatus).toBe("failed");
    expect(failedState.resultSummaryJson).not.toContain(secretId);
    expect(failedState.resultSummaryJson).not.toContain(secretKey);
    expect(failedState.resultSummaryJson).not.toContain(targetUrl);
  });
});

describe("scheduled task CLI compatibility", () => {
  it("keeps all four existing command wrappers on the unified runner", async () => {
    await prisma.$disconnect();
    const lines: string[] = [];
    const options = {
      config: cliConfig(),
      now: () => now,
      writeOutput: (line: string) => lines.push(line)
    };

    await expect(runAdminSessionCleanupCli([], options)).resolves.toMatchObject({ deletedCount: 0, dryRunCount: null });
    await expect(runAdminNotificationCleanupCli(["--dry-run"], options)).resolves.toMatchObject({
      deletedCount: 0,
      dryRunCount: 0
    });
    await expect(runPageViewCleanupCli([], options)).resolves.toMatchObject({ deletedCount: 0, dryRunCount: null });
    await expect(runEdgeOnePrefetchReconcile({
      config: cliConfig(),
      now: () => now,
      writeOutput: (line) => lines.push(line),
      writeError: (line) => lines.push(line)
    })).resolves.toEqual({ status: "disabled" });

    prisma = createPrismaClient(databaseUrl);
    const states = await prisma.scheduledTaskState.findMany({ orderBy: { taskKey: "asc" } });
    expect(states.map((state) => state.taskKey)).toEqual([
      "admin-notification-cleanup",
      "admin-session-cleanup",
      "analytics-cleanup",
      "edgeone-prefetch-reconcile"
    ]);
    expect(states.every((state) => state.lastStatus === "success")).toBe(true);
    expect(lines).toEqual(expect.arrayContaining([
      "Expired admin sessions deleted: 0",
      "Expired admin notifications would be deleted: 0",
      "Expired analytics rows deleted: 0",
      JSON.stringify({ event: "edgeone_prefetch_reconcile", status: "disabled" })
    ]));
  });
});
