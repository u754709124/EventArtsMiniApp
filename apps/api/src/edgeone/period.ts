import { EdgeOneDomainError } from "./errors";
import type { EdgeOnePlan, EdgeOnePlanPeriod } from "./types";

const shanghaiOffsetMs = 8 * 60 * 60 * 1000;
const maxBillingRangeMs = 31 * 24 * 60 * 60 * 1000;

type LocalDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

function invalidPeriod(): never {
  throw new EdgeOneDomainError(
    "validation",
    "EDGEONE_PLAN_PERIOD_UNAVAILABLE",
    "无法识别 EdgeOne 套餐计费周期"
  );
}

function parseExplicitTimestamp(value: unknown) {
  if (
    typeof value !== "string" ||
    !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return invalidPeriod();
  }
  return new Date(value);
}

function toShanghaiParts(value: Date): LocalDateTime {
  const local = new Date(value.getTime() + shanghaiOffsetMs);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    second: local.getUTCSeconds(),
    millisecond: local.getUTCMilliseconds()
  };
}

function fromShanghaiParts(parts: LocalDateTime) {
  return new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      parts.millisecond
    ) - shanghaiOffsetMs
  );
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function shiftYearMonth(year: number, month: number, delta: number) {
  const zeroBased = year * 12 + month - 1 + delta;
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 };
}

function anniversary(anchor: LocalDateTime, year: number, month: number) {
  const overflowDays = Math.max(0, anchor.day - daysInMonth(year, month));
  return fromShanghaiParts({
    ...anchor,
    year,
    month,
    day: Math.min(anchor.day, daysInMonth(year, month)) + overflowDays
  });
}

function assertRange(period: EdgeOnePlanPeriod, now: Date) {
  if (
    !Number.isFinite(now.getTime()) ||
    period.start > now ||
    period.end <= now ||
    now.getTime() - period.start.getTime() > maxBillingRangeMs ||
    period.end.getTime() - period.start.getTime() > maxBillingRangeMs
  ) {
    return invalidPeriod();
  }
  return period;
}

function prepaidPeriod(plan: EdgeOnePlan, now: Date) {
  const enabled = parseExplicitTimestamp(plan.EnabledTime);
  const expired = parseExplicitTimestamp(plan.ExpiredTime);
  if (now < enabled || now >= expired) return invalidPeriod();

  const anchor = toShanghaiParts(enabled);
  const localNow = toShanghaiParts(now);
  const initialMonthIndex = Math.max(
    0,
    (localNow.year - anchor.year) * 12 + localNow.month - anchor.month
  );
  let monthIndex = initialMonthIndex;
  let startMonth = shiftYearMonth(anchor.year, anchor.month, monthIndex);
  let start = anniversary(anchor, startMonth.year, startMonth.month);
  while (start > now && monthIndex > 0) {
    monthIndex -= 1;
    startMonth = shiftYearMonth(anchor.year, anchor.month, monthIndex);
    start = anniversary(anchor, startMonth.year, startMonth.month);
  }

  let nextMonth = shiftYearMonth(anchor.year, anchor.month, monthIndex + 1);
  let anniversaryEnd = anniversary(anchor, nextMonth.year, nextMonth.month);
  while (anniversaryEnd <= now) {
    monthIndex += 1;
    start = anniversaryEnd;
    nextMonth = shiftYearMonth(anchor.year, anchor.month, monthIndex + 1);
    anniversaryEnd = anniversary(anchor, nextMonth.year, nextMonth.month);
  }
  const end = anniversaryEnd < expired ? anniversaryEnd : expired;
  return assertRange({ start, end }, now);
}

function postpaidEnterprisePeriod(plan: EdgeOnePlan, now: Date) {
  if (
    typeof plan.PlanType !== "string" ||
    !plan.PlanType.toLowerCase().startsWith("plan-enterprise")
  ) {
    return invalidPeriod();
  }
  const localNow = toShanghaiParts(now);
  const start = fromShanghaiParts({
    year: localNow.year,
    month: localNow.month,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0
  });
  const next = shiftYearMonth(localNow.year, localNow.month, 1);
  const end = fromShanghaiParts({
    year: next.year,
    month: next.month,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0
  });
  return assertRange({ start, end }, now);
}

export function resolveEdgeOnePlanPeriod(plan: EdgeOnePlan, now: Date) {
  const payMode =
    plan.PayMode === 0 || plan.PayMode === "0"
      ? 0
      : plan.PayMode === 1 || plan.PayMode === "1"
        ? 1
        : null;
  if (payMode === 1) return prepaidPeriod(plan, now);
  if (payMode === 0) return postpaidEnterprisePeriod(plan, now);
  return invalidPeriod();
}
