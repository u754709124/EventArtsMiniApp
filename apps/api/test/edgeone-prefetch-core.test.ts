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
    return { JobId: "job-prefetch-1", FailedTargets: [], RequestId: "request-prefetch-1" };
  },
  async describePrefetchTasks() {
    return {
      TotalCount: taskTargets.length,
      Tasks: taskTargets.map((target) => ({
        JobId: "job-prefetch-1",
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
});
