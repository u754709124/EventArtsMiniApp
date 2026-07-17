import { EdgeOneDomainError, mapEdgeOneSdkError } from "./errors";
import type {
  EdgeOneBillingMetric,
  EdgeOneBillingPoint,
  EdgeOneClient,
  EdgeOnePlan
} from "./types";

export const edgeOneRegionTrafficFactors = {
  CH: 1,
  NA: 1.71,
  EU: 1.71,
  AS1: 2.49,
  AS2: 2.68,
  AS3: 2.78,
  MidEast: 2.91,
  AF: 2.91,
  SA: 2.91
} as const;

const maxBillingRangeMs = 31 * 24 * 60 * 60 * 1000;

type BillingInterval = "5min" | "hour" | "day";

function invalidBillingData(): never {
  throw new EdgeOneDomainError(
    "upstream",
    "EDGEONE_INVALID_BILLING_DATA",
    "腾讯云返回的计费数据不可用"
  );
}

function assertValidRange(start: Date, end: Date) {
  const duration = end.getTime() - start.getTime();
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    duration <= 0 ||
    duration > maxBillingRangeMs
  ) {
    return invalidBillingData();
  }
}

function valueForPoint(point: EdgeOneBillingPoint | null | undefined, zoneId: string) {
  if (
    !point ||
    !Number.isSafeInteger(point.Value) ||
    (point.Value as number) < 0 ||
    (point.ZoneId !== undefined && point.ZoneId !== null && point.ZoneId !== zoneId) ||
    (point.Time !== undefined && point.Time !== null && !Number.isFinite(Date.parse(point.Time)))
  ) {
    return invalidBillingData();
  }
  return point.Value as number;
}

async function queryMetric(
  client: EdgeOneClient,
  options: {
    zoneId: string;
    metric: EdgeOneBillingMetric;
    start: Date;
    end: Date;
    interval: BillingInterval;
    groupByRegion: boolean;
    weightedByRegion: boolean;
  }
) {
  assertValidRange(options.start, options.end);
  let response;
  try {
    response = await client.describeBillingData({
      StartTime: options.start.toISOString(),
      EndTime: options.end.toISOString(),
      ZoneIds: [options.zoneId],
      MetricName: options.metric,
      Interval: options.interval,
      ...(options.groupByRegion ? { GroupBy: ["region-id" as const] } : {})
    });
  } catch (error) {
    throw mapEdgeOneSdkError(error);
  }
  if (!Array.isArray(response.Data)) return invalidBillingData();

  let total = 0;
  for (const point of response.Data) {
    const value = valueForPoint(point, options.zoneId);
    let factor = 1;
    if (options.weightedByRegion) {
      if (typeof point.RegionId !== "string" || !(point.RegionId in edgeOneRegionTrafficFactors)) {
        return invalidBillingData();
      }
      factor =
        edgeOneRegionTrafficFactors[point.RegionId as keyof typeof edgeOneRegionTrafficFactors];
    }
    total += value * factor;
    if (!Number.isFinite(total) || total > Number.MAX_SAFE_INTEGER) return invalidBillingData();
  }
  return total;
}

export async function queryEdgeOneLast24Hours(client: EdgeOneClient, zoneId: string, now: Date) {
  const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [accTraffic, smartTraffic, requestCount] = await Promise.all([
    queryMetric(client, {
      zoneId,
      metric: "acc_flux",
      start,
      end: now,
      interval: "5min",
      groupByRegion: false,
      weightedByRegion: false
    }),
    queryMetric(client, {
      zoneId,
      metric: "smt_flux",
      start,
      end: now,
      interval: "5min",
      groupByRegion: false,
      weightedByRegion: false
    }),
    queryMetric(client, {
      zoneId,
      metric: "sec_request_clean",
      start,
      end: now,
      interval: "5min",
      groupByRegion: false,
      weightedByRegion: false
    })
  ]);
  const trafficBytes = accTraffic + smartTraffic;
  if (!Number.isSafeInteger(trafficBytes)) return invalidBillingData();
  return { start, end: now, trafficBytes, requestCount };
}

export async function queryEdgeOnePackageUsage(
  client: EdgeOneClient,
  options: { zoneId: string; start: Date; end: Date }
) {
  if (options.start.getTime() === options.end.getTime()) {
    return { trafficUsedBytes: 0, requestUsed: 0 };
  }
  const [accTraffic, smartTraffic, requestUsed] = await Promise.all([
    queryMetric(client, {
      ...options,
      metric: "acc_flux",
      interval: "day",
      groupByRegion: true,
      weightedByRegion: true
    }),
    queryMetric(client, {
      ...options,
      metric: "smt_flux",
      interval: "day",
      groupByRegion: true,
      weightedByRegion: true
    }),
    queryMetric(client, {
      ...options,
      metric: "sec_request_clean",
      interval: "day",
      groupByRegion: false,
      weightedByRegion: false
    })
  ]);
  const trafficUsedBytes = accTraffic + smartTraffic;
  if (!Number.isFinite(trafficUsedBytes) || trafficUsedBytes > Number.MAX_SAFE_INTEGER) {
    return invalidBillingData();
  }
  return { trafficUsedBytes, requestUsed };
}

function capacity(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new EdgeOneDomainError(
      "upstream",
      "EDGEONE_INVALID_PLAN_DATA",
      "腾讯云返回的套餐数据不可用"
    );
  }
  return value as number;
}

export function edgeOnePackageCapacities(plan: EdgeOnePlan) {
  return {
    trafficCapacityBytes: capacity(plan.SecTrafficCapacity),
    requestCapacity: capacity(plan.SecRequestCapacity)
  };
}
