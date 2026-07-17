export type EdgeOneCredentials = {
  secretId: string;
  secretKey: string;
};

export type EdgeOneZoneInfo = {
  ZoneId?: string | null;
  ZoneName?: string | null;
  Paused?: boolean | null;
};

export type EdgeOnePlan = {
  PlanId?: string | null;
  PlanType?: string | null;
  Status?: string | null;
  PayMode?: number | string | null;
  EnabledTime?: string | null;
  ExpiredTime?: string | null;
  SecTrafficCapacity?: number | null;
  SecRequestCapacity?: number | null;
  AccTrafficCapacity?: number | null;
  SmartTrafficCapacity?: number | null;
  ZonesInfo?: EdgeOneZoneInfo[] | null;
};

export type EdgeOneBillingPoint = {
  Time?: string | null;
  Value?: number | null;
  ZoneId?: string | null;
  RegionId?: string | null;
};

export type DescribePlansRequest = {
  Limit: number;
  Offset: number;
};

export type DescribePlansResponse = {
  TotalCount?: number | null;
  Plans?: EdgeOnePlan[] | null;
};

export type EdgeOneBillingMetric = "acc_flux" | "smt_flux" | "sec_request_clean";

export type DescribeBillingDataRequest = {
  StartTime: string;
  EndTime: string;
  ZoneIds: string[];
  MetricName: EdgeOneBillingMetric;
  Interval: "5min" | "hour" | "day";
  GroupBy?: Array<"region-id">;
};

export type DescribeBillingDataResponse = {
  Data?: EdgeOneBillingPoint[] | null;
  RequestId?: string | null;
};

export interface EdgeOneClient {
  describePlans(request: DescribePlansRequest): Promise<DescribePlansResponse>;
  describeBillingData(request: DescribeBillingDataRequest): Promise<DescribeBillingDataResponse>;
}

export type EdgeOneClientFactory = (credentials: EdgeOneCredentials) => EdgeOneClient;

export type EdgeOnePlanPeriod = {
  start: Date;
  end: Date;
};
