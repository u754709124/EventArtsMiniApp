import type {
  EdgeOneConfigResponse,
  EdgeOneConfigUpdateRequest,
  EdgeOneDashboardState
} from "@event-arts/shared";
import type { AppPrismaClient } from "../db";
import {
  maskEdgeOneSecretId,
  readDecryptedEdgeOneSystemConfig,
  readEdgeOneSystemConfigAdminView,
  requireEdgeOneCredentialEncryptionKey,
  writeEdgeOneSystemConfig
} from "../system-config";
import {
  edgeOnePackageCapacities,
  queryEdgeOneLast24Hours,
  queryEdgeOnePackageUsage
} from "./billing";
import { asEdgeOneDomainError, EdgeOneDomainError } from "./errors";
import { findUniqueAvailablePlan } from "./plans";
import { resolveEdgeOnePlanPeriod } from "./period";
import { defaultEdgeOneClientFactory } from "./sdk-client";
import type { EdgeOneClientFactory, EdgeOnePlan } from "./types";

type EdgeOneServiceOptions = {
  prisma: AppPrismaClient;
  credentialEncryptionKey: Buffer | null | undefined;
  clientFactory?: EdgeOneClientFactory;
  now?: () => Date;
};

function configResponse(
  metadata: {
    zoneId: string;
    secretIdConfigured: boolean;
    secretKeyConfigured: boolean;
    updatedAt: Date;
  } | null,
  secretIdMasked: string | null
): EdgeOneConfigResponse {
  return {
    zoneId: metadata?.zoneId ?? null,
    secretIdMasked,
    secretIdConfigured: metadata?.secretIdConfigured ?? false,
    secretKeyConfigured: metadata?.secretKeyConfigured ?? false,
    updatedAt: metadata?.updatedAt.toISOString() ?? null
  };
}

function requirePlanString(plan: EdgeOnePlan, field: "PlanId" | "PlanType" | "Status") {
  const value = plan[field];
  if (typeof value !== "string" || !value) {
    throw new EdgeOneDomainError(
      "upstream",
      "EDGEONE_INVALID_PLAN_DATA",
      "腾讯云返回的套餐数据不可用"
    );
  }
  return value;
}

export function createEdgeOneService(options: EdgeOneServiceOptions) {
  const clientFactory = options.clientFactory ?? defaultEdgeOneClientFactory;
  const currentTime = options.now ?? (() => new Date());

  async function getConfig(): Promise<EdgeOneConfigResponse> {
    const view = await readEdgeOneSystemConfigAdminView(
      options.prisma,
      options.credentialEncryptionKey
    );
    if (!view) return configResponse(null, null);
    return configResponse(view, view.secretIdMasked);
  }

  async function updateConfig(input: EdgeOneConfigUpdateRequest, createdBy?: number) {
    requireEdgeOneCredentialEncryptionKey(options.credentialEncryptionKey);
    const existing = await readDecryptedEdgeOneSystemConfig(
      options.prisma,
      options.credentialEncryptionKey
    );
    if (!existing && (!input.secretId || !input.secretKey)) {
      throw new EdgeOneDomainError(
        "bad_request",
        "EDGEONE_CREDENTIALS_REQUIRED",
        "首次配置必须同时提供 SecretId 和 SecretKey"
      );
    }

    const candidate = {
      zoneId: input.zoneId,
      secretId: input.secretId ?? existing!.secretId,
      secretKey: input.secretKey ?? existing!.secretKey
    };
    const client = clientFactory({ secretId: candidate.secretId, secretKey: candidate.secretKey });
    const now = currentTime();
    const plan = await findUniqueAvailablePlan(client, candidate.zoneId);
    edgeOnePackageCapacities(plan);
    resolveEdgeOnePlanPeriod(plan, now);
    await queryEdgeOneLast24Hours(client, candidate.zoneId, now);

    const audit = {
      zoneId: candidate.zoneId,
      planId: requirePlanString(plan, "PlanId"),
      updatedFields: [
        "zoneId",
        ...(input.secretId ? ["secretId"] : []),
        ...(input.secretKey ? ["secretKey"] : [])
      ]
    };
    const metadata = await options.prisma.$transaction(async (transaction) => {
      const saved = await writeEdgeOneSystemConfig(
        transaction as unknown as AppPrismaClient,
        options.credentialEncryptionKey,
        candidate
      );
      await transaction.operationLog.create({
        data: {
          action: "UPDATE_EDGEONE_CONFIG",
          detail: JSON.stringify(audit),
          createdBy
        }
      });
      return saved;
    });
    return {
      config: configResponse(metadata, maskEdgeOneSecretId(candidate.secretId)),
      audit
    };
  }

  async function dashboardState(): Promise<EdgeOneDashboardState> {
    try {
      const configured = await readDecryptedEdgeOneSystemConfig(
        options.prisma,
        options.credentialEncryptionKey
      );
      if (!configured) return { status: "not_configured" };

      const now = currentTime();
      const client = clientFactory({
        secretId: configured.secretId,
        secretKey: configured.secretKey
      });
      const plan = await findUniqueAvailablePlan(client, configured.zoneId);
      const capacities = edgeOnePackageCapacities(plan);
      const period = resolveEdgeOnePlanPeriod(plan, now);
      const [last24Hours, packageUsage] = await Promise.all([
        queryEdgeOneLast24Hours(client, configured.zoneId, now),
        queryEdgeOnePackageUsage(client, {
          zoneId: configured.zoneId,
          start: period.start,
          end: now
        })
      ]);

      return {
        status: "ready",
        zoneId: configured.zoneId,
        fetchedAt: now.toISOString(),
        last24Hours: {
          startTime: last24Hours.start.toISOString(),
          endTime: last24Hours.end.toISOString(),
          trafficBytes: last24Hours.trafficBytes,
          requestCount: last24Hours.requestCount
        },
        package: {
          planId: requirePlanString(plan, "PlanId"),
          planType: requirePlanString(plan, "PlanType"),
          planStatus: requirePlanString(plan, "Status"),
          periodStart: period.start.toISOString(),
          periodEnd: period.end.toISOString(),
          trafficUsedBytes: packageUsage.trafficUsedBytes,
          trafficCapacityBytes: capacities.trafficCapacityBytes,
          requestUsed: packageUsage.requestUsed,
          requestCapacity: capacities.requestCapacity
        }
      };
    } catch (error) {
      const safe = asEdgeOneDomainError(error);
      return { status: "error", code: safe.code, message: safe.publicMessage };
    }
  }

  return { getConfig, updateConfig, dashboardState };
}

export type EdgeOneService = ReturnType<typeof createEdgeOneService>;
