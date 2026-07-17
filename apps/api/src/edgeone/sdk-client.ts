import { teo } from "tencentcloud-sdk-nodejs-teo";
import { createHash } from "node:crypto";
import { mapEdgeOneSdkError, sanitizeEdgeOneUpstreamRequestId } from "./errors";
import type {
  CreatePrefetchTaskRequest,
  DescribeBillingDataRequest,
  DescribeBillingDataResponse,
  DescribePlansRequest,
  DescribePlansResponse,
  DescribePrefetchTasksRequest,
  EdgeOneClient,
  EdgeOneClientFactory,
  EdgeOneCredentials
} from "./types";

export type EdgeOneSdkClientConfig = {
  credential: EdgeOneCredentials;
  region: "";
  profile: {
    httpProfile: {
      endpoint: "teo.tencentcloudapi.com";
      protocol: "https://";
      reqMethod: "POST";
      reqTimeout: number;
    };
  };
};

type TencentEdgeOneSdkClient = {
  DescribePlans(request: DescribePlansRequest): Promise<DescribePlansResponse>;
  DescribeBillingData(request: DescribeBillingDataRequest): Promise<DescribeBillingDataResponse>;
  CreatePrefetchTask?(request: CreatePrefetchTaskRequest): Promise<{
    JobId?: string | null;
    FailedList?: Array<{ Reason?: string | null; Targets?: string[] | null }> | null;
    RequestId?: string | null;
  }>;
  DescribePrefetchTasks?(request: DescribePrefetchTasksRequest): Promise<{
    TotalCount?: number | null;
    Tasks?: Array<{
      JobId?: string | null;
      Target?: string | null;
      Status?: string | null;
      FailType?: string | null;
    }> | null;
    RequestId?: string | null;
  }>;
};

export type TencentEdgeOneSdkClientCreator = (
  config: EdgeOneSdkClientConfig
) => TencentEdgeOneSdkClient;

function hashTarget(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safePrefetchFailureReason(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return /^[A-Za-z][A-Za-z0-9._-]{0,79}$/.test(normalized) ? normalized : undefined;
}

function safePrefetchIdentifier(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)
    ? value
    : undefined;
}

function safePrefetchStatus(value: unknown) {
  return typeof value === "string"
    && ["processing", "success", "failed", "timeout", "canceled", "invalid"].includes(value)
    ? value
    : undefined;
}

export function createTencentEdgeOneClientFactory(
  options: {
    timeoutSeconds?: number;
    createSdkClient?: TencentEdgeOneSdkClientCreator;
  } = {}
): EdgeOneClientFactory {
  const timeoutSeconds = options.timeoutSeconds ?? 10;
  const createSdkClient =
    options.createSdkClient ??
    ((config: EdgeOneSdkClientConfig) =>
      new teo.v20220901.Client(config) as unknown as TencentEdgeOneSdkClient);

  return (credentials) => {
    const sdkClient = createSdkClient({
      credential: credentials,
      region: "",
      profile: {
        httpProfile: {
          endpoint: "teo.tencentcloudapi.com",
          protocol: "https://",
          reqMethod: "POST",
          reqTimeout: timeoutSeconds
        }
      }
    });

    const client: EdgeOneClient = {
      async describePlans(request) {
        try {
          const response = await sdkClient.DescribePlans(request);
          return { TotalCount: response.TotalCount, Plans: response.Plans };
        } catch (error) {
          throw mapEdgeOneSdkError(error);
        }
      },
      async describeBillingData(request) {
        try {
          const response = await sdkClient.DescribeBillingData(request);
          return {
            Data: response.Data,
            RequestId: sanitizeEdgeOneUpstreamRequestId(response.RequestId)
          };
        } catch (error) {
          throw mapEdgeOneSdkError(error);
        }
      },
      async createPrefetchTask(request) {
        try {
          const response = await sdkClient.CreatePrefetchTask!(request);
          return {
            JobId: safePrefetchIdentifier(response.JobId),
            FailedTargets: (response.FailedList ?? []).flatMap((failure) =>
              (failure.Targets ?? []).map((target) => ({
                TargetHash: hashTarget(target),
                ReasonCode: safePrefetchFailureReason(failure.Reason)
              }))
            ),
            RequestId: sanitizeEdgeOneUpstreamRequestId(response.RequestId)
          };
        } catch (error) {
          throw mapEdgeOneSdkError(error);
        }
      },
      async describePrefetchTasks(request) {
        try {
          const response = await sdkClient.DescribePrefetchTasks!(request);
          return {
            TotalCount: typeof response.TotalCount === "number" ? response.TotalCount : undefined,
            Tasks: (response.Tasks ?? []).map((task) => ({
              JobId: safePrefetchIdentifier(task.JobId),
              TargetHash: typeof task.Target === "string" ? hashTarget(task.Target) : undefined,
              Status: safePrefetchStatus(task.Status),
              FailType: safePrefetchFailureReason(task.FailType)
            })),
            RequestId: sanitizeEdgeOneUpstreamRequestId(response.RequestId)
          };
        } catch (error) {
          throw mapEdgeOneSdkError(error);
        }
      }
    };
    return client;
  };
}

export const defaultEdgeOneClientFactory = createTencentEdgeOneClientFactory();
