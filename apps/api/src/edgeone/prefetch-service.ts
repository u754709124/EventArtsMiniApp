import { randomUUID } from "node:crypto";
import type {
  EdgeOnePrefetchListQuery,
  EdgeOnePrefetchListResponse,
  EdgeOnePrefetchStatus,
  EdgeOnePrefetchTriggerRequest,
  EdgeOnePrefetchTriggerResponse
} from "@event-arts/shared";
import type { AppPrismaClient } from "../db";
import { readDecryptedEdgeOneSystemConfig } from "../system-config";
import { asEdgeOneDomainError, EdgeOneDomainError } from "./errors";
import {
  canonicalPrefetchTarget,
  createPrefetchIdentity,
  EDGEONE_PREFETCH_MODE
} from "./prefetch-identity";
import {
  edgeOnePrefetchAutomaticRetryStatuses,
  edgeOnePrefetchFailureStatuses,
  assertPrefetchStatusTransition,
  isPrefetchFailureStatus,
  isPrefetchRetryableStatus,
  parseEdgeOnePrefetchStatus,
  shouldSkipPrefetchStatus
} from "./prefetch-state";
import { defaultEdgeOneClientFactory } from "./sdk-client";
import type { EdgeOneClientFactory, EdgeOnePrefetchClient } from "./types";

export type EdgeOnePrefetchRuntimeConfig = {
  enabled: boolean;
  maxBatchSize: number;
  maxAttempts: number;
  leaseSeconds: number;
  initialBackoffSeconds: number;
  maxBackoffSeconds: number;
};

type PrefetchServiceOptions = {
  prisma: AppPrismaClient;
  publicBaseUrl: string;
  credentialEncryptionKey: Buffer | null | undefined;
  config: EdgeOnePrefetchRuntimeConfig;
  clientFactory?: EdgeOneClientFactory;
  now?: () => Date;
  leaseTokenFactory?: () => string;
};

type Submission = {
  id: number;
  mediaAssetId: number;
  targetUrl: string;
  targetHash: string;
  leaseToken: string;
  attemptNumber: number;
};

type StoredResource = {
  id: number;
  mediaAssetId: number;
  targetHash: string;
  currentJobId: string | null;
  attemptCount: number;
  status: string;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
  nextRetryAt: Date | null;
};

type TriggerMode = "manual" | "automatic";

function isUniqueConstraintError(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "P2002");
}

function leaseExpiry(now: Date, seconds: number) {
  return new Date(now.getTime() + seconds * 1000);
}

function retryAt(now: Date, attemptCount: number, config: EdgeOnePrefetchRuntimeConfig) {
  const exponent = Math.max(0, attemptCount - 1);
  const seconds = Math.min(
    config.maxBackoffSeconds,
    config.initialBackoffSeconds * 2 ** exponent
  );
  return new Date(now.getTime() + seconds * 1000);
}

function safeUpstreamMessage(error: EdgeOneDomainError) {
  return error.publicMessage.slice(0, 300);
}

function requireEnabled(config: EdgeOnePrefetchRuntimeConfig) {
  if (!config.enabled) {
    throw new EdgeOneDomainError(
      "unavailable",
      "EDGEONE_PREFETCH_DISABLED",
      "EdgeOne 资源预热功能尚未启用"
    );
  }
}

function statusOf(resource: StoredResource) {
  return parseEdgeOnePrefetchStatus(resource.status);
}

function skippedItem(resource: StoredResource) {
  return {
    mediaAssetId: resource.mediaAssetId,
    status: statusOf(resource),
    outcome: "skipped" as const,
    safeErrorCode: null
  };
}

async function configuredClient(options: PrefetchServiceOptions) {
  const configured = await readDecryptedEdgeOneSystemConfig(
    options.prisma,
    options.credentialEncryptionKey
  );
  if (!configured) {
    throw new EdgeOneDomainError(
      "bad_request",
      "EDGEONE_NOT_CONFIGURED",
      "请先配置 EdgeOne Zone 和 CAM 凭证"
    );
  }
  const client = (options.clientFactory ?? defaultEdgeOneClientFactory)({
    secretId: configured.secretId,
    secretKey: configured.secretKey
  });
  if (!client.createPrefetchTask || !client.describePrefetchTasks) {
    throw new EdgeOneDomainError(
      "unavailable",
      "EDGEONE_PREFETCH_CLIENT_UNAVAILABLE",
      "EdgeOne 预热客户端暂不可用"
    );
  }
  return {
    zoneId: configured.zoneId,
    client: client as EdgeOnePrefetchClient
  };
}

export function createEdgeOnePrefetchService(options: PrefetchServiceOptions) {
  const currentTime = options.now ?? (() => new Date());
  const leaseTokenFactory = options.leaseTokenFactory ?? randomUUID;

  async function prepareSubmission(
    resourceId: number,
    leaseToken: string,
    now: Date
  ): Promise<Submission | null> {
    return options.prisma.$transaction(async (transaction) => {
      const resource = await transaction.edgeOnePrefetchResource.findUnique({
        where: { id: resourceId }
      });
      if (
        !resource
        || resource.status !== "reserved"
        || resource.leaseToken !== leaseToken
        || !resource.leaseExpiresAt
        || resource.leaseExpiresAt <= now
      ) {
        return null;
      }
      assertPrefetchStatusTransition("reserved", "submitting");
      const updated = await transaction.edgeOnePrefetchResource.update({
        where: { id: resource.id },
        data: {
          status: "submitting",
          attemptCount: { increment: 1 },
          currentJobId: null,
          lastSubmittedAt: now,
          completedAt: null,
          nextRetryAt: null,
          safeErrorCode: null,
          safeErrorMessage: null
        }
      });
      await transaction.edgeOnePrefetchAttempt.create({
        data: {
          prefetchResourceId: resource.id,
          attemptNumber: updated.attemptCount,
          status: "submitting"
        }
      });
      return {
        id: resource.id,
        mediaAssetId: resource.mediaAssetId,
        targetUrl: resource.targetUrl,
        targetHash: resource.targetHash,
        leaseToken,
        attemptNumber: updated.attemptCount
      };
    });
  }

  async function acquireResource(
    zoneId: string,
    asset: {
      id: number;
      md5: string;
      filename: string;
      url: string;
      storageType: string;
    },
    createdBy: number,
    now: Date,
    mode: TriggerMode
  ): Promise<{ submission?: Submission; item?: EdgeOnePrefetchTriggerResponse["items"][number] }> {
    const target = canonicalPrefetchTarget(asset, options.publicBaseUrl);
    if (!target.eligible) {
      return {
        item: {
          mediaAssetId: asset.id,
          status: null,
          outcome: "ineligible",
          safeErrorCode: target.reason
        }
      };
    }
    const identity = createPrefetchIdentity(zoneId, asset, target);
    const persistedIdentity = {
      zoneId: identity.zoneId,
      mediaAssetId: identity.mediaAssetId,
      contentVersion: identity.contentVersion,
      targetHash: identity.targetHash,
      mode: identity.mode
    };
    const uniqueWhere = {
      zoneId_mediaAssetId_contentVersion_targetHash_mode: {
        zoneId: identity.zoneId,
        mediaAssetId: identity.mediaAssetId,
        contentVersion: identity.contentVersion,
        targetHash: identity.targetHash,
        mode: identity.mode
      }
    };
    const leaseToken = leaseTokenFactory();
    let resource: StoredResource;
    try {
      resource = await options.prisma.edgeOnePrefetchResource.create({
        data: {
          ...persistedIdentity,
          targetUrl: target.targetUrl,
          status: "reserved",
          leaseToken,
          leaseExpiresAt: leaseExpiry(now, options.config.leaseSeconds),
          createdBy
        }
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const existing = await options.prisma.edgeOnePrefetchResource.findUnique({
        where: uniqueWhere
      });
      if (!existing) throw error;
      resource = existing;
    }

    const status = statusOf(resource);
    if (resource.leaseToken === leaseToken && status === "reserved") {
      const submission = await prepareSubmission(resource.id, leaseToken, now);
      return submission ? { submission } : { item: skippedItem(resource) };
    }
    if (shouldSkipPrefetchStatus(status)) {
      return { item: skippedItem(resource) };
    }

    if (mode === "manual") {
      if (!isPrefetchFailureStatus(status)) {
        return { item: skippedItem(resource) };
      }
      const manualLeaseToken = leaseTokenFactory();
      const claimed = await options.prisma.edgeOnePrefetchResource.updateMany({
        where: {
          id: resource.id,
          status: { in: [...edgeOnePrefetchFailureStatuses] },
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }]
        },
        data: {
          status: "reserved",
          currentJobId: null,
          nextRetryAt: null,
          leaseToken: manualLeaseToken,
          leaseExpiresAt: leaseExpiry(now, options.config.leaseSeconds)
        }
      });
      if (claimed.count !== 1) return { item: skippedItem(resource) };
      const submission = await prepareSubmission(resource.id, manualLeaseToken, now);
      return submission ? { submission } : { item: skippedItem(resource) };
    }

    if (
      !isPrefetchRetryableStatus(status)
      || resource.currentJobId
      || resource.attemptCount >= options.config.maxAttempts
      || (resource.nextRetryAt && resource.nextRetryAt > now)
    ) {
      return { item: skippedItem(resource) };
    }

    const retryLeaseToken = leaseTokenFactory();
    const claimed = await options.prisma.edgeOnePrefetchResource.updateMany({
      where: {
        id: resource.id,
        status: { in: [...edgeOnePrefetchAutomaticRetryStatuses] },
        currentJobId: null,
        attemptCount: { lt: options.config.maxAttempts },
        AND: [
          { OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }] },
          { OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] }
        ]
      },
      data: {
        status: "reserved",
        leaseToken: retryLeaseToken,
        leaseExpiresAt: leaseExpiry(now, options.config.leaseSeconds)
      }
    });
    if (claimed.count !== 1) return { item: skippedItem(resource) };
    const submission = await prepareSubmission(resource.id, retryLeaseToken, now);
    return submission ? { submission } : { item: skippedItem(resource) };
  }

  async function failSubmissions(
    submissions: Submission[],
    error: EdgeOneDomainError,
    now: Date,
    ambiguous: boolean
  ) {
    for (const submission of submissions) {
      const nextRetryAt = ambiguous
        ? new Date(now.getTime() + options.config.maxBackoffSeconds * 1000)
        : retryAt(now, submission.attemptNumber, options.config);
      await options.prisma.$transaction(async (transaction) => {
        await transaction.edgeOnePrefetchResource.updateMany({
          where: {
            id: submission.id,
            status: "submitting",
            leaseToken: submission.leaseToken
          },
          data: {
            status: "failed",
            leaseToken: null,
            leaseExpiresAt: null,
            nextRetryAt,
            safeErrorCode: error.code,
            safeErrorMessage: safeUpstreamMessage(error)
          }
        });
        await transaction.edgeOnePrefetchAttempt.updateMany({
          where: {
            prefetchResourceId: submission.id,
            attemptNumber: submission.attemptNumber
          },
          data: {
            status: "failed",
            safeErrorCode: error.code,
            upstreamRequestId: error.upstreamRequestId
          }
        });
      });
    }
  }

  async function submitBatch(
    client: EdgeOnePrefetchClient,
    zoneId: string,
    submissions: Submission[],
    now: Date
  ) {
    if (!submissions.length) return new Map<number, EdgeOnePrefetchTriggerResponse["items"][number]>();
    let response;
    try {
      response = await client.createPrefetchTask({
        ZoneId: zoneId,
        Targets: submissions.map((item) => item.targetUrl),
        Mode: EDGEONE_PREFETCH_MODE,
        PrefetchMediaSegments: "off"
      });
    } catch (error) {
      const safe = asEdgeOneDomainError(error);
      await failSubmissions(submissions, safe, now, true);
      return new Map(submissions.map((submission) => [
        submission.id,
        {
          mediaAssetId: submission.mediaAssetId,
          status: "failed" as const,
          outcome: "failed" as const,
          safeErrorCode: safe.code
        }
      ]));
    }

    const failedByHash = new Map(
      response.FailedTargets.map((failure) => [failure.TargetHash, failure])
    );
    const outcomes = new Map<number, EdgeOnePrefetchTriggerResponse["items"][number]>();
    for (const submission of submissions) {
      const failure = failedByHash.get(submission.targetHash);
      const hasJob = Boolean(response.JobId);
      const status: EdgeOnePrefetchStatus = failure || !hasJob ? "failed" : "processing";
      const safeErrorCode = failure
        ? failure.ReasonCode ?? "EDGEONE_TARGET_REJECTED"
        : !hasJob
          ? "EDGEONE_MISSING_JOB_ID"
          : null;
      await options.prisma.$transaction(async (transaction) => {
        const updated = await transaction.edgeOnePrefetchResource.updateMany({
          where: {
            id: submission.id,
            status: "submitting",
            leaseToken: submission.leaseToken
          },
          data: {
            status,
            currentJobId: hasJob && !failure ? response.JobId : null,
            leaseToken: null,
            leaseExpiresAt: null,
            nextRetryAt: status === "failed"
              ? retryAt(now, submission.attemptNumber, options.config)
              : null,
            safeErrorCode,
            safeErrorMessage: safeErrorCode ? "EdgeOne 未接受该预热目标" : null
          }
        });
        if (updated.count !== 1) {
          throw new EdgeOneDomainError(
            "unavailable",
            "EDGEONE_PREFETCH_STATE_CONFLICT",
            "预热任务状态发生冲突，请刷新后重试"
          );
        }
        await transaction.edgeOnePrefetchAttempt.updateMany({
          where: {
            prefetchResourceId: submission.id,
            attemptNumber: submission.attemptNumber
          },
          data: {
            status,
            jobId: hasJob && !failure ? response.JobId : null,
            upstreamRequestId: response.RequestId,
            safeErrorCode
          }
        });
      });
      outcomes.set(submission.id, {
        mediaAssetId: submission.mediaAssetId,
        status,
        outcome: status === "processing" ? "submitted" : "failed",
        safeErrorCode
      });
    }
    return outcomes;
  }

  async function submitEligibleResources(
    input: EdgeOnePrefetchTriggerRequest,
    createdBy: number,
    mode: TriggerMode
  ): Promise<EdgeOnePrefetchTriggerResponse> {
    requireEnabled(options.config);
    if (input.assetIds && input.assetIds.length > options.config.maxBatchSize) {
      throw new EdgeOneDomainError(
        "bad_request",
        "EDGEONE_PREFETCH_BATCH_TOO_LARGE",
        `每次最多预热 ${options.config.maxBatchSize} 个资源`
      );
    }
    const { zoneId, client } = await configuredClient(options);
    const now = currentTime();
    const selectAsset = {
      id: true,
      md5: true,
      filename: true,
      url: true,
      storageType: true
    } as const;
    const itemSamples: EdgeOnePrefetchTriggerResponse["items"] = [];
    let skipped = 0;
    let ineligible = 0;
    const submissions: Submission[] = [];

    function recordNonSubmission(item: EdgeOnePrefetchTriggerResponse["items"][number]) {
      if (item.outcome === "skipped") skipped += 1;
      if (item.outcome === "ineligible") ineligible += 1;
      if (itemSamples.length < options.config.maxBatchSize) itemSamples.push(item);
    }

    async function inspectAsset(asset: {
      id: number;
      md5: string;
      filename: string;
      url: string;
      storageType: string;
    }) {
      const result = await acquireResource(zoneId, asset, createdBy, now, mode);
      if (result.submission) submissions.push(result.submission);
      if (result.item) recordNonSubmission(result.item);
    }

    if (input.assetIds) {
      const assets = await options.prisma.mediaAsset.findMany({
        where: { id: { in: input.assetIds } },
        orderBy: { id: "asc" },
        select: selectAsset
      });
      const foundIds = new Set(assets.map((asset) => asset.id));
      for (const mediaAssetId of input.assetIds) {
        if (!foundIds.has(mediaAssetId)) {
          recordNonSubmission({
            mediaAssetId,
            status: null,
            outcome: "ineligible",
            safeErrorCode: "MEDIA_ASSET_NOT_FOUND"
          });
        }
      }
      for (const asset of assets) await inspectAsset(asset);
    } else {
      let afterId = 0;
      while (submissions.length < options.config.maxBatchSize) {
        const assets = await options.prisma.mediaAsset.findMany({
          where: { id: { gt: afterId } },
          orderBy: { id: "asc" },
          take: options.config.maxBatchSize,
          select: selectAsset
        });
        if (!assets.length) break;
        for (const asset of assets) {
          afterId = asset.id;
          await inspectAsset(asset);
          if (submissions.length >= options.config.maxBatchSize) break;
        }
        if (assets.length < options.config.maxBatchSize) break;
      }
    }

    const submissionOutcomes = await submitBatch(client, zoneId, submissions, now);
    const submittedItems: EdgeOnePrefetchTriggerResponse["items"] = [];
    for (const submission of submissions) {
      const item = submissionOutcomes.get(submission.id);
      if (item) submittedItems.push(item);
    }
    const submitted = submittedItems.filter((item) => item.outcome === "submitted").length;
    const failed = submittedItems.filter((item) => item.outcome === "failed").length;
    const items = [
      ...submittedItems,
      ...itemSamples.slice(0, Math.max(0, options.config.maxBatchSize - submittedItems.length))
    ];
    return {
      submitted,
      skipped,
      ineligible,
      failed,
      items
    };
  }

  async function trigger(
    input: EdgeOnePrefetchTriggerRequest,
    createdBy: number
  ): Promise<EdgeOnePrefetchTriggerResponse> {
    return submitEligibleResources(input, createdBy, "manual");
  }

  async function updateFromRemoteTask(
    resource: StoredResource,
    client: EdgeOnePrefetchClient,
    zoneId: string,
    now: Date
  ) {
    const jobId = resource.currentJobId;
    if (!jobId) return "skipped" as const;
    let response;
    try {
      response = await client.describePrefetchTasks({
        ZoneId: zoneId,
        Limit: 20,
        Filters: [{ Name: "job-id", Values: [jobId] }]
      });
    } catch (error) {
      const safe = asEdgeOneDomainError(error);
      await options.prisma.$transaction(async (transaction) => {
        await transaction.edgeOnePrefetchResource.updateMany({
          where: { id: resource.id, leaseToken: resource.leaseToken },
          data: {
            leaseToken: null,
            leaseExpiresAt: null,
            nextRetryAt: retryAt(now, resource.attemptCount, options.config),
            safeErrorCode: safe.code,
            safeErrorMessage: safeUpstreamMessage(safe)
          }
        });
        await transaction.edgeOnePrefetchAttempt.updateMany({
          where: {
            prefetchResourceId: resource.id,
            attemptNumber: resource.attemptCount
          },
          data: {
            upstreamRequestId: safe.upstreamRequestId,
            safeErrorCode: safe.code
          }
        });
      });
      return "failed" as const;
    }
    const task = response.Tasks.find((candidate) =>
      candidate.JobId === jobId && candidate.TargetHash === resource.targetHash
    );
    const remoteStatus = task?.Status;
    const knownStatus = remoteStatus
      && ["processing", "success", "failed", "timeout", "canceled", "invalid"].includes(remoteStatus)
      ? remoteStatus as Exclude<EdgeOnePrefetchStatus, "reserved" | "submitting">
      : null;
    if (!knownStatus) {
      const safeErrorCode = task ? "EDGEONE_UNKNOWN_TASK_STATUS" : "EDGEONE_TASK_NOT_FOUND";
      await options.prisma.$transaction(async (transaction) => {
        await transaction.edgeOnePrefetchResource.updateMany({
          where: { id: resource.id, leaseToken: resource.leaseToken },
          data: {
            status: "processing",
            leaseToken: null,
            leaseExpiresAt: null,
            nextRetryAt: retryAt(now, resource.attemptCount, options.config),
            safeErrorCode,
            safeErrorMessage: "EdgeOne 任务状态暂不可确认"
          }
        });
        await transaction.edgeOnePrefetchAttempt.updateMany({
          where: {
            prefetchResourceId: resource.id,
            attemptNumber: resource.attemptCount
          },
          data: {
            status: "processing",
            upstreamRequestId: response.RequestId,
            safeErrorCode
          }
        });
      });
      return "failed" as const;
    }

    const safeErrorCode = knownStatus === "failed"
      || knownStatus === "timeout"
      || knownStatus === "canceled"
      || knownStatus === "invalid"
      ? task?.FailType ?? `EDGEONE_TASK_${knownStatus.toUpperCase()}`
      : null;
    const retryable = knownStatus === "failed" || knownStatus === "timeout";
    const completed = knownStatus !== "processing";
    await options.prisma.$transaction(async (transaction) => {
      await transaction.edgeOnePrefetchResource.updateMany({
        where: { id: resource.id, leaseToken: resource.leaseToken },
        data: {
          status: knownStatus,
          currentJobId: retryable ? null : jobId,
          leaseToken: null,
          leaseExpiresAt: null,
          nextRetryAt: retryable
            ? retryAt(now, resource.attemptCount, options.config)
            : knownStatus === "processing"
              ? retryAt(now, 1, options.config)
              : null,
          completedAt: completed ? now : null,
          safeErrorCode,
          safeErrorMessage: safeErrorCode ? "EdgeOne 预热任务未成功完成" : null
        }
      });
      await transaction.edgeOnePrefetchAttempt.updateMany({
        where: {
          prefetchResourceId: resource.id,
          attemptNumber: resource.attemptCount
        },
        data: {
          status: knownStatus,
          upstreamRequestId: response.RequestId,
          safeErrorCode
        }
      });
    });
    return knownStatus;
  }

  async function reconcile() {
    requireEnabled(options.config);
    const { zoneId, client } = await configuredClient(options);
    const now = currentTime();
    const candidates = await options.prisma.edgeOnePrefetchResource.findMany({
      where: {
        zoneId,
        OR: [
          {
            currentJobId: { not: null },
            status: { in: ["submitting", "processing", "failed", "timeout"] },
            AND: [
              { OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }] },
              { OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] }
            ]
          },
          {
            currentJobId: null,
            status: { in: ["reserved", "submitting"] },
            leaseExpiresAt: { lte: now }
          },
          {
            currentJobId: null,
            status: { in: [...edgeOnePrefetchAutomaticRetryStatuses] },
            attemptCount: { lt: options.config.maxAttempts },
            nextRetryAt: { lte: now },
            OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }]
          }
        ]
      },
      orderBy: { updatedAt: "asc" },
      take: options.config.maxBatchSize
    });
    let queried = 0;
    let recovered = 0;
    let failed = 0;
    const retryAssets: Array<{ mediaAssetId: number; createdBy: number }> = [];
    for (const candidate of candidates) {
      const token = leaseTokenFactory();
      const claimed = await options.prisma.edgeOnePrefetchResource.updateMany({
        where: {
          id: candidate.id,
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }]
        },
        data: {
          leaseToken: token,
          leaseExpiresAt: leaseExpiry(now, options.config.leaseSeconds)
        }
      });
      if (claimed.count !== 1) continue;
      const resource = { ...candidate, leaseToken: token };
      if (resource.currentJobId) {
        const outcome = await updateFromRemoteTask(resource, client, zoneId, now);
        queried += 1;
        if (outcome !== "processing" && outcome !== "success") failed += 1;
        if (queried < candidates.length) {
          await new Promise((resolve) => setTimeout(resolve, 60));
        }
        continue;
      }

      const status = statusOf(resource);
      if (status === "submitting" || status === "reserved") {
        const delay = status === "submitting"
          ? options.config.maxBackoffSeconds
          : options.config.initialBackoffSeconds;
        const safeErrorCode = status === "submitting"
          ? "EDGEONE_SUBMISSION_OUTCOME_UNKNOWN"
          : "EDGEONE_RESERVATION_EXPIRED";
        await options.prisma.$transaction(async (transaction) => {
          await transaction.edgeOnePrefetchResource.updateMany({
            where: { id: resource.id, leaseToken: token },
            data: {
              status: "failed",
              leaseToken: null,
              leaseExpiresAt: null,
              nextRetryAt: new Date(now.getTime() + delay * 1000),
              safeErrorCode,
              safeErrorMessage: "预热提交租约已过期，已进入延迟恢复"
            }
          });
          if (status === "submitting") {
            await transaction.edgeOnePrefetchAttempt.updateMany({
              where: {
                prefetchResourceId: resource.id,
                attemptNumber: resource.attemptCount
              },
              data: {
                status: "failed",
                safeErrorCode
              }
            });
          }
        });
        recovered += 1;
        continue;
      }
      await options.prisma.edgeOnePrefetchResource.updateMany({
        where: { id: resource.id, leaseToken: token },
        data: { leaseToken: null, leaseExpiresAt: null }
      });
      retryAssets.push({
        mediaAssetId: resource.mediaAssetId,
        createdBy: candidate.createdBy
      });
    }

    let retried = 0;
    for (const [index, retry] of retryAssets.entries()) {
      const retryResult = await submitEligibleResources(
        { assetIds: [retry.mediaAssetId] },
        retry.createdBy,
        "automatic"
      );
      retried += retryResult.submitted;
      failed += retryResult.failed;
      if (index < retryAssets.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
    }
    return {
      scanned: candidates.length,
      queried,
      recovered,
      retried,
      failed
    };
  }

  async function list(query: EdgeOnePrefetchListQuery): Promise<EdgeOnePrefetchListResponse> {
    const configured = await options.prisma.systemConfig.findUnique({
      where: { id: 1 },
      select: { zoneId: true }
    });
    if (!configured) {
      return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
    }

    const candidates = await options.prisma.edgeOnePrefetchResource.findMany({
      where: {
        zoneId: configured.zoneId,
        ...(query.assetIds ? { mediaAssetId: { in: query.assetIds } } : {}),
        ...(query.mediaType ? { mediaAsset: { mediaType: query.mediaType } } : {})
      },
      include: {
        mediaAsset: {
          select: {
            id: true,
            md5: true,
            filename: true,
            url: true,
            storageType: true
          }
        }
      }
    });
    const currentItems = candidates
      .filter((item) => {
        if (item.mode !== EDGEONE_PREFETCH_MODE || item.contentVersion !== item.mediaAsset.md5) {
          return false;
        }
        const target = canonicalPrefetchTarget(item.mediaAsset, options.publicBaseUrl);
        return target.eligible && item.targetHash === target.targetHash;
      })
      .filter((item) => !query.status || item.status === query.status)
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
    const total = currentItems.length;
    const offset = (query.page - 1) * query.pageSize;
    const items = currentItems.slice(offset, offset + query.pageSize);
    return {
      items: items.map((item) => ({
        id: item.id,
        mediaAssetId: item.mediaAssetId,
        mode: "default",
        status: parseEdgeOnePrefetchStatus(item.status),
        attemptCount: item.attemptCount,
        nextRetryAt: item.nextRetryAt?.toISOString() ?? null,
        lastSubmittedAt: item.lastSubmittedAt?.toISOString() ?? null,
        completedAt: item.completedAt?.toISOString() ?? null,
        safeErrorCode: item.safeErrorCode,
        safeErrorMessage: item.safeErrorMessage,
        updatedAt: item.updatedAt.toISOString()
      })),
      total,
      page: query.page,
      pageSize: query.pageSize
    };
  }

  return { trigger, reconcile, list };
}

export type EdgeOnePrefetchService = ReturnType<typeof createEdgeOnePrefetchService>;
