import { EdgeOneDomainError, mapEdgeOneSdkError, sanitizeEdgeOneUpstreamRequestId } from "./errors";
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
const hourMs = 60 * 60 * 1000;
const shanghaiOffsetMs = 8 * hourMs;

type BillingInterval = "hour" | "day";

function invalidBillingData(upstreamRequestId?: unknown): never {
  throw new EdgeOneDomainError(
    "upstream",
    "EDGEONE_INVALID_BILLING_DATA",
    "腾讯云返回的计费数据不可用",
    { upstreamRequestId: sanitizeEdgeOneUpstreamRequestId(upstreamRequestId) }
  );
}

function truncateToSecond(value: Date) {
  const time = value.getTime();
  if (!Number.isFinite(time)) return invalidBillingData();
  return new Date(Math.floor(time / 1_000) * 1_000);
}

function normalizedBillingRange(start: Date, end: Date, allowEmpty = false) {
  const normalizedStart = truncateToSecond(start);
  const normalizedEnd = truncateToSecond(end);
  const duration = normalizedEnd.getTime() - normalizedStart.getTime();
  if (duration < 0 || (!allowEmpty && duration === 0) || duration > maxBillingRangeMs) {
    return invalidBillingData();
  }
  return { start: normalizedStart, end: normalizedEnd };
}

export function floorEdgeOneBillingHour(value: Date) {
  const time = value.getTime();
  if (!Number.isFinite(time)) return invalidBillingData();
  return new Date(Math.floor(time / hourMs) * hourMs);
}

function padDateTimePart(value: number) {
  return String(value).padStart(2, "0");
}

export function formatEdgeOneBillingTime(value: Date) {
  const normalized = truncateToSecond(value);
  const shanghai = new Date(normalized.getTime() + shanghaiOffsetMs);
  const year = shanghai.getUTCFullYear();
  if (year < 0 || year > 9_999) return invalidBillingData();
  return [
    String(year).padStart(4, "0"),
    "-",
    padDateTimePart(shanghai.getUTCMonth() + 1),
    "-",
    padDateTimePart(shanghai.getUTCDate()),
    "T",
    padDateTimePart(shanghai.getUTCHours()),
    ":",
    padDateTimePart(shanghai.getUTCMinutes()),
    ":",
    padDateTimePart(shanghai.getUTCSeconds()),
    "+08:00"
  ].join("");
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

function valueForPoint(
  point: EdgeOneBillingPoint | null | undefined,
  zoneId: string,
  upstreamRequestId?: string
) {
  if (
    !point ||
    !Number.isSafeInteger(point.Value) ||
    (point.Value as number) < 0 ||
    (point.ZoneId !== undefined && point.ZoneId !== null && point.ZoneId !== zoneId) ||
    (point.Time !== undefined && point.Time !== null && !Number.isFinite(Date.parse(point.Time)))
  ) {
    return invalidBillingData(upstreamRequestId);
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
  const range = normalizedBillingRange(options.start, options.end);
  assertValidRange(range.start, range.end);
  let response;
  try {
    response = await client.describeBillingData({
      StartTime: formatEdgeOneBillingTime(range.start),
      EndTime: formatEdgeOneBillingTime(range.end),
      ZoneIds: [options.zoneId],
      MetricName: options.metric,
      Interval: options.interval,
      ...(options.groupByRegion ? { GroupBy: ["region-id" as const] } : {})
    });
  } catch (error) {
    throw mapEdgeOneSdkError(error);
  }
  const upstreamRequestId = sanitizeEdgeOneUpstreamRequestId(response.RequestId);
  if (!Array.isArray(response.Data)) return invalidBillingData(upstreamRequestId);

  let total = 0;
  for (const point of response.Data) {
    const value = valueForPoint(point, options.zoneId, upstreamRequestId);
    let factor = 1;
    if (options.weightedByRegion) {
      if (typeof point.RegionId !== "string" || !(point.RegionId in edgeOneRegionTrafficFactors)) {
        return invalidBillingData(upstreamRequestId);
      }
      factor =
        edgeOneRegionTrafficFactors[point.RegionId as keyof typeof edgeOneRegionTrafficFactors];
    }
    total += value * factor;
    if (!Number.isFinite(total) || total > Number.MAX_SAFE_INTEGER) {
      return invalidBillingData(upstreamRequestId);
    }
  }
  return total;
}

export async function queryEdgeOneLast24Hours(client: EdgeOneClient, zoneId: string, now: Date) {
  const end = floorEdgeOneBillingHour(now);
  const start = new Date(end.getTime() - 24 * hourMs);
  const [accTraffic, smartTraffic, requestCount] = await Promise.all([
    queryMetric(client, {
      zoneId,
      metric: "acc_flux",
      start,
      end,
      interval: "hour",
      groupByRegion: false,
      weightedByRegion: false
    }),
    queryMetric(client, {
      zoneId,
      metric: "smt_flux",
      start,
      end,
      interval: "hour",
      groupByRegion: false,
      weightedByRegion: false
    }),
    queryMetric(client, {
      zoneId,
      metric: "sec_request_clean",
      start,
      end,
      interval: "hour",
      groupByRegion: false,
      weightedByRegion: false
    })
  ]);
  const trafficBytes = accTraffic + smartTraffic;
  if (!Number.isSafeInteger(trafficBytes)) return invalidBillingData();
  return { start, end, trafficBytes, requestCount };
}

export async function queryEdgeOnePackageUsage(
  client: EdgeOneClient,
  options: { zoneId: string; start: Date; end: Date }
) {
  const range = normalizedBillingRange(options.start, options.end, true);
  if (range.start.getTime() === range.end.getTime()) {
    return { trafficUsedBytes: 0, requestUsed: 0 };
  }
  const [accTraffic, smartTraffic, requestUsed] = await Promise.all([
    queryMetric(client, {
      zoneId: options.zoneId,
      ...range,
      metric: "acc_flux",
      interval: "day",
      groupByRegion: true,
      weightedByRegion: true
    }),
    queryMetric(client, {
      zoneId: options.zoneId,
      ...range,
      metric: "smt_flux",
      interval: "day",
      groupByRegion: true,
      weightedByRegion: true
    }),
    queryMetric(client, {
      zoneId: options.zoneId,
      ...range,
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
