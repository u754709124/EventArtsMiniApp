import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient, type AppPrismaClient } from "../src/db";
import {
  createEdgeOnePrefetchService,
  type EdgeOneClientFactory
} from "../src/edgeone";
import { ensureDatabaseSchema } from "../src/sqlite-schema";
import { writeEdgeOneSystemConfig } from "../src/system-config";
import { resetTestAdmin } from "./fixtures";

const encryptionKey = Buffer.alloc(32, 23);
const runtimeConfig = {
  enabled: true,
  maxBatchSize: 20,
  maxAttempts: 3,
  leaseSeconds: 120,
  initialBackoffSeconds: 60,
  maxBackoffSeconds: 3600
};

let root: string;
let prisma: AppPrismaClient;
let adminId: number;
let createCalls: string[][];
let taskTargets: string[];
let latestJobId: string;

const clientFactory: EdgeOneClientFactory = () => ({
  async describePlans() {
    return { TotalCount: 0, Plans: [] };
  },
  async describeBillingData() {
    return { Data: [] };
  },
  async createPrefetchTask(request) {
    createCalls.push(request.Targets);
    taskTargets = request.Targets;
    latestJobId = `job-prefetch-${createCalls.length}`;
    return { JobId: latestJobId, FailedTargets: [], RequestId: `request-prefetch-${createCalls.length}` };
  },
  async describePrefetchTasks() {
    return {
      TotalCount: taskTargets.length,
      Tasks: taskTargets.map((target) => ({
        JobId: latestJobId,
        TargetHash: createHash("sha256").update(target).digest("hex"),
        Status: "success"
      })),
      RequestId: "request-prefetch-query-1"
    };
  }
});

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "edgeone-prefetch-core-"));
  const uploadDir = path.join(root, "uploads");
  await mkdir(uploadDir);
  prisma = createPrismaClient(`file:${path.join(root, "test.db")}`);
  await ensureDatabaseSchema(prisma, { uploadDir });
  adminId = (await resetTestAdmin(prisma)).id;
  await writeEdgeOneSystemConfig(prisma, encryptionKey, {
    zoneId: "zone-prefetch-test",
    secretId: "AKID_PREFETCH_TEST",
    secretKey: "PREFETCH_TEST_SECRET"
  });
  await prisma.mediaAsset.create({
    data: {
      resourceName: "prefetch.jpg",
      resourceNameKey: "prefetch.jpg",
      originalName: "prefetch.jpg",
      filename: "prefetch.jpg",
      md5: "0123456789abcdef0123456789abcdef",
      mimeType: "image/jpeg",
      mediaType: "image",
      url: "/uploads/prefetch.jpg",
      size: 123,
      createdBy: adminId
    }
  });
  createCalls = [];
  taskTargets = [];
  latestJobId = "job-prefetch-1";
});

afterEach(async () => {
  await prisma.$disconnect();
  await rm(root, { recursive: true, force: true });
});

describe("EdgeOne prefetch idempotency", () => {
  it("submits once under concurrency, converges to success, and skips repeats", async () => {
    const service = createEdgeOnePrefetchService({
      prisma,
      publicBaseUrl: "https://media.example.com",
      credentialEncryptionKey: encryptionKey,
      config: runtimeConfig,
      clientFactory
    });

    const [left, right] = await Promise.all([
      service.trigger({}, adminId),
      service.trigger({}, adminId)
    ]);
    expect(left.submitted + right.submitted).toBe(1);
    expect(left.skipped + right.skipped).toBe(1);
    expect(createCalls).toHaveLength(1);

    await service.reconcile();
    const repeated = await service.trigger({}, adminId);
    expect(repeated).toMatchObject({ submitted: 0, skipped: 1 });
    expect(createCalls).toHaveLength(1);
    expect(await prisma.edgeOnePrefetchResource.findFirst()).toMatchObject({
      status: "success",
      attemptCount: 1
    });
    const listed = await service.list({ page: 1, pageSize: 20 });
    expect(listed.items[0]).not.toHaveProperty("targetUrl");
    expect(listed.items[0]).not.toHaveProperty("contentVersion");
  });

  it("allows a new identity when the content version changes", async () => {
    const service = createEdgeOnePrefetchService({
      prisma,
      publicBaseUrl: "https://media.example.com",
      credentialEncryptionKey: encryptionKey,
      config: runtimeConfig,
      clientFactory
    });
    await service.trigger({}, adminId);
    const asset = await prisma.mediaAsset.findFirstOrThrow();
    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { md5: "fedcba9876543210fedcba9876543210" }
    });
    const changed = await service.trigger({}, adminId);
    expect(changed.submitted).toBe(1);
    expect(createCalls).toHaveLength(2);
    expect(await prisma.edgeOnePrefetchResource.count()).toBe(2);
  });

  it.each(["failed", "timeout", "canceled", "invalid"] as const)(
    "manual trigger retriggers %s resources regardless of old retry guards",
    async (status) => {
      const service = createEdgeOnePrefetchService({
        prisma,
        publicBaseUrl: "https://media.example.com",
        credentialEncryptionKey: encryptionKey,
        config: runtimeConfig,
        clientFactory
      });
      await service.trigger({}, adminId);
      const resource = await prisma.edgeOnePrefetchResource.findFirstOrThrow();
      for (const attemptNumber of [2, 3]) {
        await prisma.edgeOnePrefetchAttempt.create({
          data: {
            prefetchResourceId: resource.id,
            attemptNumber,
            status: "failed",
            safeErrorCode: "OLD_ATTEMPT"
          }
        });
      }
      await prisma.edgeOnePrefetchResource.update({
        where: { id: resource.id },
        data: {
          status,
          currentJobId: "old-job-id",
          attemptCount: runtimeConfig.maxAttempts,
          nextRetryAt: new Date(Date.now() + 86_400_000),
          completedAt: new Date("2026-07-17T00:00:00.000Z"),
          safeErrorCode: "OLD_SAFE_CODE",
          safeErrorMessage: "旧错误"
        }
      });

      const retriggered = await service.trigger({}, adminId);
      expect(retriggered).toMatchObject({ submitted: 1, skipped: 0, failed: 0 });
      expect(createCalls).toHaveLength(2);
      const updated = await prisma.edgeOnePrefetchResource.findUniqueOrThrow({
        where: { id: resource.id }
      });
      expect(updated).toMatchObject({
        status: "processing",
        currentJobId: "job-prefetch-2",
        attemptCount: runtimeConfig.maxAttempts + 1,
        nextRetryAt: null,
        completedAt: null,
        safeErrorCode: null,
        safeErrorMessage: null
      });
      const attempts = await prisma.edgeOnePrefetchAttempt.findMany({
        where: { prefetchResourceId: resource.id },
        orderBy: { attemptNumber: "asc" }
      });
      expect(attempts.map((attempt) => attempt.attemptNumber)).toEqual([1, 2, 3, 4]);
      expect(attempts[0].jobId).toBe("job-prefetch-1");
      expect(attempts[3]).toMatchObject({
        attemptNumber: 4,
        status: "processing",
        jobId: "job-prefetch-2"
      });
    }
  );

  it("claims a failed manual retrigger atomically under concurrency", async () => {
    const service = createEdgeOnePrefetchService({
      prisma,
      publicBaseUrl: "https://media.example.com",
      credentialEncryptionKey: encryptionKey,
      config: runtimeConfig,
      clientFactory
    });
    await service.trigger({}, adminId);
    const resource = await prisma.edgeOnePrefetchResource.findFirstOrThrow();
    await prisma.edgeOnePrefetchResource.update({
      where: { id: resource.id },
      data: {
        status: "failed",
        currentJobId: "old-job-id",
        attemptCount: runtimeConfig.maxAttempts,
        nextRetryAt: new Date(Date.now() + 86_400_000)
      }
    });

    const [left, right] = await Promise.all([
      service.trigger({}, adminId),
      service.trigger({}, adminId)
    ]);
    expect(left.submitted + right.submitted).toBe(1);
    expect(left.skipped + right.skipped).toBe(1);
    expect(createCalls).toHaveLength(2);
    expect(await prisma.edgeOnePrefetchAttempt.count({
      where: { prefetchResourceId: resource.id }
    })).toBe(2);
  });

  it("keeps automatic retry bounded by status, attempt count, and backoff", async () => {
    const service = createEdgeOnePrefetchService({
      prisma,
      publicBaseUrl: "https://media.example.com",
      credentialEncryptionKey: encryptionKey,
      config: runtimeConfig,
      clientFactory
    });
    await service.trigger({}, adminId);
    const resource = await prisma.edgeOnePrefetchResource.findFirstOrThrow();
    const blockedRetries = [
      {
        status: "failed" as const,
        attemptCount: runtimeConfig.maxAttempts,
        nextRetryAt: new Date(Date.now() - 1_000)
      },
      {
        status: "timeout" as const,
        attemptCount: runtimeConfig.maxAttempts - 1,
        nextRetryAt: new Date(Date.now() + 86_400_000)
      },
      {
        status: "canceled" as const,
        attemptCount: 1,
        nextRetryAt: new Date(Date.now() - 1_000)
      },
      {
        status: "invalid" as const,
        attemptCount: 1,
        nextRetryAt: new Date(Date.now() - 1_000)
      }
    ];
    for (const blocked of blockedRetries) {
      await prisma.edgeOnePrefetchResource.update({
        where: { id: resource.id },
        data: {
          status: blocked.status,
          currentJobId: null,
          attemptCount: blocked.attemptCount,
          nextRetryAt: blocked.nextRetryAt,
          leaseToken: null,
          leaseExpiresAt: null
        }
      });
      const reconciled = await service.reconcile();
      expect(reconciled.retried).toBe(0);
      expect(createCalls).toHaveLength(1);
    }
  });

  it("reconciles a manually created processing attempt beyond the automatic max attempt cap", async () => {
    const service = createEdgeOnePrefetchService({
      prisma,
      publicBaseUrl: "https://media.example.com",
      credentialEncryptionKey: encryptionKey,
      config: runtimeConfig,
      clientFactory
    });
    await service.trigger({}, adminId);
    const resource = await prisma.edgeOnePrefetchResource.findFirstOrThrow();
    for (const attemptNumber of [2, 3, 4]) {
      await prisma.edgeOnePrefetchAttempt.create({
        data: {
          prefetchResourceId: resource.id,
          attemptNumber,
          status: attemptNumber === 4 ? "processing" : "failed",
          jobId: attemptNumber === 4 ? "job-prefetch-1" : null
        }
      });
    }
    await prisma.edgeOnePrefetchResource.update({
      where: { id: resource.id },
      data: {
        status: "processing",
        currentJobId: "job-prefetch-1",
        attemptCount: runtimeConfig.maxAttempts + 1,
        nextRetryAt: null,
        leaseToken: null,
        leaseExpiresAt: null
      }
    });

    const reconciled = await service.reconcile();
    expect(reconciled.queried).toBe(1);
    expect(await prisma.edgeOnePrefetchResource.findUnique({
      where: { id: resource.id }
    })).toMatchObject({
      status: "success",
      attemptCount: runtimeConfig.maxAttempts + 1,
      currentJobId: "job-prefetch-1"
    });
    expect(await prisma.edgeOnePrefetchAttempt.findFirst({
      where: { prefetchResourceId: resource.id, attemptNumber: 4 }
    })).toMatchObject({
      status: "success",
      jobId: "job-prefetch-1"
    });
  });
});
