import { teo } from "tencentcloud-sdk-nodejs-teo";
import { mapEdgeOneSdkError, sanitizeEdgeOneUpstreamRequestId } from "./errors";
import type {
  DescribeBillingDataRequest,
  DescribeBillingDataResponse,
  DescribePlansRequest,
  DescribePlansResponse,
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
};

export type TencentEdgeOneSdkClientCreator = (
  config: EdgeOneSdkClientConfig
) => TencentEdgeOneSdkClient;

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
      }
    };
    return client;
  };
}

export const defaultEdgeOneClientFactory = createTencentEdgeOneClientFactory();
