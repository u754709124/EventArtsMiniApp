import { EdgeOneDomainError, mapEdgeOneSdkError } from "./errors";
import type { EdgeOneClient, EdgeOnePlan } from "./types";

const plansPageSize = 200;
const availablePlanStatuses = new Set(["normal", "expiring-soon"]);

function planStatus(plan: EdgeOnePlan) {
  return typeof plan.Status === "string" ? plan.Status.toLowerCase() : "";
}

function planContainsZone(plan: EdgeOnePlan, zoneId: string) {
  if (!Array.isArray(plan.ZonesInfo)) return false;
  return plan.ZonesInfo.some((zone) => zone?.ZoneId === zoneId);
}

export async function listAllEdgeOnePlans(client: EdgeOneClient) {
  const plans: EdgeOnePlan[] = [];
  let offset = 0;
  let expectedTotal: number | null = null;

  for (let page = 0; page < 10_000; page += 1) {
    let response;
    try {
      response = await client.describePlans({ Limit: plansPageSize, Offset: offset });
    } catch (error) {
      throw mapEdgeOneSdkError(error);
    }
    if (
      !Number.isSafeInteger(response.TotalCount) ||
      (response.TotalCount as number) < 0 ||
      !Array.isArray(response.Plans)
    ) {
      throw new EdgeOneDomainError(
        "upstream",
        "EDGEONE_INVALID_PLAN_DATA",
        "腾讯云返回的套餐数据不可用"
      );
    }
    if (expectedTotal === null) expectedTotal = response.TotalCount as number;
    if (expectedTotal !== response.TotalCount) {
      throw new EdgeOneDomainError(
        "upstream",
        "EDGEONE_INVALID_PLAN_DATA",
        "腾讯云返回的套餐数据不可用"
      );
    }
    plans.push(...response.Plans);
    if (plans.length > expectedTotal) {
      throw new EdgeOneDomainError(
        "upstream",
        "EDGEONE_INVALID_PLAN_DATA",
        "腾讯云返回的套餐数据不可用"
      );
    }
    offset += response.Plans.length;
    if (offset >= expectedTotal) break;
    if (response.Plans.length === 0) {
      throw new EdgeOneDomainError(
        "upstream",
        "EDGEONE_INVALID_PLAN_DATA",
        "腾讯云返回的套餐数据不可用"
      );
    }
  }
  if (expectedTotal === null || plans.length < expectedTotal) {
    throw new EdgeOneDomainError(
      "upstream",
      "EDGEONE_INVALID_PLAN_DATA",
      "腾讯云返回的套餐数据不可用"
    );
  }
  return plans;
}

export async function findUniqueAvailablePlan(client: EdgeOneClient, zoneId: string) {
  const plans = await listAllEdgeOnePlans(client);
  const zonePlans = plans.filter((plan) => planContainsZone(plan, zoneId));
  if (zonePlans.length === 0) {
    throw new EdgeOneDomainError(
      "validation",
      "EDGEONE_ZONE_NOT_FOUND",
      "该 ZoneId 不属于当前 CAM 账号的 EdgeOne 套餐"
    );
  }

  const availableById = new Map<string, EdgeOnePlan>();
  for (const plan of zonePlans) {
    if (!availablePlanStatuses.has(planStatus(plan))) continue;
    if (typeof plan.PlanId !== "string" || !plan.PlanId) {
      throw new EdgeOneDomainError(
        "upstream",
        "EDGEONE_INVALID_PLAN_DATA",
        "腾讯云返回的套餐数据不可用"
      );
    }
    availableById.set(plan.PlanId, plan);
  }

  const available = [...availableById.values()];
  if (available.length === 0) {
    throw new EdgeOneDomainError(
      "validation",
      "EDGEONE_PLAN_UNAVAILABLE",
      "该 ZoneId 当前没有可用的 EdgeOne 套餐"
    );
  }
  if (available.length !== 1) {
    throw new EdgeOneDomainError(
      "validation",
      "EDGEONE_PLAN_AMBIGUOUS",
      "该 ZoneId 匹配到多个可用套餐，无法确定用量周期"
    );
  }
  return available[0]!;
}
