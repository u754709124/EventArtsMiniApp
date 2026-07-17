import { describe, expect, it, vi } from "vitest";
import type { AppPrismaClient } from "../src/db";
import {
  createTencentEdgeOneClientFactory,
  edgeOnePackageCapacities,
  edgeOneRegionTrafficFactors,
  findUniqueAvailablePlan,
  mapEdgeOneSdkError,
  queryEdgeOneLast24Hours,
  queryEdgeOnePackageUsage,
  resolveEdgeOnePlanPeriod,
  type DescribeBillingDataRequest,
  type DescribeBillingDataResponse,
  type EdgeOneClient,
  type EdgeOnePlan,
  type EdgeOneSdkClientConfig
} from "../src/edgeone";
import { encryptEdgeOneCredential, readEdgeOneSystemConfigAdminView } from "../src/system-config";

const zoneId = "zone-test";

function availablePlan(overrides: Partial<EdgeOnePlan> = {}): EdgeOnePlan {
  return {
    PlanId: "edgeone-plan-test",
    PlanType: "plan-standard",
    Status: "normal",
    PayMode: 1,
    EnabledTime: "2026-06-15T00:00:00.000Z",
    ExpiredTime: "2027-06-15T00:00:00.000Z",
    SecTrafficCapacity: 1_000,
    SecRequestCapacity: 2_000,
    ZonesInfo: [{ ZoneId: zoneId }],
    ...overrides
  };
}

describe("Tencent EdgeOne SDK adapter", () => {
  it("pins the 2022-09-01 client profile to the official endpoint, POST, HTTPS and an explicit timeout", async () => {
    let receivedConfig: EdgeOneSdkClientConfig | undefined;
    const describePlans = vi.fn(async () => ({ TotalCount: 0, Plans: [] }));
    const factory = createTencentEdgeOneClientFactory({
      timeoutSeconds: 7,
      createSdkClient: (config) => {
        receivedConfig = config;
        return {
          DescribePlans: describePlans,
          DescribeBillingData: vi.fn(async () => ({ Data: [] }))
        };
      }
    });
    const client = factory({ secretId: "AKID_TEST", secretKey: "SECRET_TEST" });
    await client.describePlans({ Limit: 200, Offset: 0 });

    expect(receivedConfig).toEqual({
      credential: { secretId: "AKID_TEST", secretKey: "SECRET_TEST" },
      region: "",
      profile: {
        httpProfile: {
          endpoint: "teo.tencentcloudapi.com",
          protocol: "https://",
          reqMethod: "POST",
          reqTimeout: 7
        }
      }
    });
    expect(describePlans).toHaveBeenCalledWith({ Limit: 200, Offset: 0 });
  });

  it("maps credential, permission and unknown SDK failures without exposing raw messages", () => {
    expect(
      mapEdgeOneSdkError({ code: "AuthFailure.SignatureFailure", message: "SECRET_TEST" })
    ).toMatchObject({ code: "EDGEONE_INVALID_CREDENTIALS", kind: "validation" });
    expect(
      mapEdgeOneSdkError({ code: "UnauthorizedOperation", message: "internal detail" })
    ).toMatchObject({ code: "EDGEONE_PERMISSION_DENIED", kind: "validation" });
    expect(mapEdgeOneSdkError(new Error("socket contained SECRET_TEST"))).toMatchObject({
      code: "EDGEONE_UPSTREAM_UNAVAILABLE",
      kind: "upstream"
    });
  });
});

describe("EdgeOne plan selection and periods", () => {
  it("paginates DescribePlans and requires one exact available ZoneId match", async () => {
    const calls: number[] = [];
    const client: EdgeOneClient = {
      async describePlans(request) {
        calls.push(request.Offset);
        if (request.Offset === 0) {
          return { TotalCount: 2, Plans: [availablePlan({ ZonesInfo: [{ ZoneId: "other" }] })] };
        }
        return { TotalCount: 2, Plans: [availablePlan()] };
      },
      async describeBillingData() {
        return { Data: [] };
      }
    };

    await expect(findUniqueAvailablePlan(client, zoneId)).resolves.toMatchObject({
      PlanId: "edgeone-plan-test"
    });
    expect(calls).toEqual([0, 1]);
  });

  it("rejects missing, inactive and ambiguous ZoneId ownership", async () => {
    const clientFor = (plans: EdgeOnePlan[]): EdgeOneClient => ({
      async describePlans() {
        return { TotalCount: plans.length, Plans: plans };
      },
      async describeBillingData() {
        return { Data: [] };
      }
    });
    await expect(findUniqueAvailablePlan(clientFor([]), zoneId)).rejects.toMatchObject({
      code: "EDGEONE_ZONE_NOT_FOUND"
    });
    await expect(
      findUniqueAvailablePlan(clientFor([availablePlan({ Status: "expired" })]), zoneId)
    ).rejects.toMatchObject({ code: "EDGEONE_PLAN_UNAVAILABLE" });
    await expect(
      findUniqueAvailablePlan(
        clientFor([availablePlan(), availablePlan({ PlanId: "edgeone-plan-other" })]),
        zoneId
      )
    ).rejects.toMatchObject({ code: "EDGEONE_PLAN_AMBIGUOUS" });
  });

  it("anchors prepaid periods in Asia/Shanghai and uses the documented 31-day month-end overflow", () => {
    const monthEnd = resolveEdgeOnePlanPeriod(
      availablePlan({
        EnabledTime: "2024-01-31T02:00:00.000Z",
        ExpiredTime: "2027-01-31T02:00:00.000Z"
      }),
      new Date("2025-02-28T08:00:00.000Z")
    );
    expect(monthEnd.start.toISOString()).toBe("2025-01-31T02:00:00.000Z");
    expect(monthEnd.end.toISOString()).toBe("2025-03-03T02:00:00.000Z");

    const documentedExample = resolveEdgeOnePlanPeriod(
      availablePlan({
        EnabledTime: "2025-03-30T16:00:00.000Z",
        ExpiredTime: "2027-03-30T16:00:00.000Z"
      }),
      new Date("2025-04-15T00:00:00.000Z")
    );
    expect(documentedExample.start.toISOString()).toBe("2025-03-30T16:00:00.000Z");
    expect(documentedExample.end.toISOString()).toBe("2025-04-30T16:00:00.000Z");

    const leap = resolveEdgeOnePlanPeriod(
      availablePlan({
        EnabledTime: "2024-02-29T00:00:00.000Z",
        ExpiredTime: "2027-02-28T00:00:00.000Z"
      }),
      new Date("2025-02-28T01:00:00.000Z")
    );
    expect(leap.start.toISOString()).toBe("2025-01-29T00:00:00.000Z");
    expect(leap.end.toISOString()).toBe("2025-03-01T00:00:00.000Z");
  });

  it("uses an Asia/Shanghai natural month only for enterprise postpaid plans", () => {
    const period = resolveEdgeOnePlanPeriod(
      availablePlan({ PlanType: "plan-enterprise", PayMode: 0 }),
      new Date("2026-07-16T03:00:00.000Z")
    );
    expect(period.start.toISOString()).toBe("2026-06-30T16:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-07-31T16:00:00.000Z");
    expect(() =>
      resolveEdgeOnePlanPeriod(
        availablePlan({ PlanType: "plan-standard", PayMode: 0 }),
        new Date("2026-07-16T03:00:00.000Z")
      )
    ).toThrow(expect.objectContaining({ code: "EDGEONE_PLAN_PERIOD_UNAVAILABLE" }));
  });

  it("constrains the final prepaid cycle by ExpiredTime and rejects an expired plan", () => {
    const plan = availablePlan({
      EnabledTime: "2026-01-15T00:00:00.000Z",
      ExpiredTime: "2026-07-20T00:00:00.000Z"
    });
    const period = resolveEdgeOnePlanPeriod(plan, new Date("2026-07-16T00:00:00.000Z"));
    expect(period.start.toISOString()).toBe("2026-07-15T00:00:00.000Z");
    expect(period.end.toISOString()).toBe("2026-07-20T00:00:00.000Z");
    expect(() => resolveEdgeOnePlanPeriod(plan, new Date("2026-07-20T00:00:00.000Z"))).toThrow(
      expect.objectContaining({ code: "EDGEONE_PLAN_PERIOD_UNAVAILABLE" })
    );
  });

  it("accepts only exact numeric or string PayMode 0/1 values", () => {
    expect(
      resolveEdgeOnePlanPeriod(
        availablePlan({ PayMode: "1" }),
        new Date("2026-07-16T00:00:00.000Z")
      ).start.toISOString()
    ).toBe("2026-07-15T00:00:00.000Z");
    expect(
      resolveEdgeOnePlanPeriod(
        availablePlan({ PlanType: "plan-enterprise", PayMode: "0" }),
        new Date("2026-07-16T00:00:00.000Z")
      ).start.toISOString()
    ).toBe("2026-06-30T16:00:00.000Z");

    for (const PayMode of ["", " ", "00", "01", "2", 2, null]) {
      expect(() =>
        resolveEdgeOnePlanPeriod(availablePlan({ PayMode }), new Date("2026-07-16T00:00:00.000Z"))
      ).toThrow(expect.objectContaining({ code: "EDGEONE_PLAN_PERIOD_UNAVAILABLE" }));
    }
  });
});

describe("EdgeOne billing aggregation", () => {
  it("starts each three-metric stage concurrently before awaiting any response", async () => {
    function deferredClient() {
      const requests: DescribeBillingDataRequest[] = [];
      const pending: Array<(response: DescribeBillingDataResponse) => void> = [];
      const client: EdgeOneClient = {
        async describePlans() {
          return { TotalCount: 0, Plans: [] };
        },
        describeBillingData(request) {
          requests.push(request);
          return new Promise((resolve) => pending.push(resolve));
        }
      };
      return { client, requests, pending };
    }

    const rolling = deferredClient();
    const rollingResult = queryEdgeOneLast24Hours(
      rolling.client,
      zoneId,
      new Date("2026-07-16T12:00:00.000Z")
    );
    expect(rolling.requests.map((request) => request.MetricName)).toEqual([
      "acc_flux",
      "smt_flux",
      "sec_request_clean"
    ]);
    for (const resolve of rolling.pending) resolve({ Data: [] });
    await expect(rollingResult).resolves.toMatchObject({ trafficBytes: 0, requestCount: 0 });

    const packageStage = deferredClient();
    const packageResult = queryEdgeOnePackageUsage(packageStage.client, {
      zoneId,
      start: new Date("2026-07-01T00:00:00.000Z"),
      end: new Date("2026-07-15T00:00:00.000Z")
    });
    expect(packageStage.requests.map((request) => request.MetricName)).toEqual([
      "acc_flux",
      "smt_flux",
      "sec_request_clean"
    ]);
    for (const [index, resolve] of packageStage.pending.entries()) {
      resolve({
        Data:
          index < 2
            ? [{ Value: 0, ZoneId: zoneId, RegionId: "CH" }]
            : [{ Value: 0, ZoneId: zoneId }]
      });
    }
    await expect(packageResult).resolves.toEqual({ trafficUsedBytes: 0, requestUsed: 0 });
  });

  it("queries all three metrics and applies every billing-region factor to package traffic", async () => {
    const requests: DescribeBillingDataRequest[] = [];
    const regionPoints = Object.keys(edgeOneRegionTrafficFactors).map((RegionId) => ({
      Value: 100,
      ZoneId: zoneId,
      RegionId
    }));
    const client: EdgeOneClient = {
      async describePlans() {
        return { TotalCount: 0, Plans: [] };
      },
      async describeBillingData(request) {
        requests.push(request);
        if (request.MetricName === "acc_flux") return { Data: regionPoints };
        if (request.MetricName === "smt_flux") return { Data: [] };
        return { Data: [{ Value: 7, ZoneId: zoneId }] };
      }
    };
    const usage = await queryEdgeOnePackageUsage(client, {
      zoneId,
      start: new Date("2026-07-01T00:00:00.000Z"),
      end: new Date("2026-07-15T00:00:00.000Z")
    });
    expect(usage).toEqual({ trafficUsedBytes: 2_110, requestUsed: 7 });
    expect(
      requests.map(({ MetricName, Interval, GroupBy }) => ({ MetricName, Interval, GroupBy }))
    ).toEqual([
      { MetricName: "acc_flux", Interval: "day", GroupBy: ["region-id"] },
      { MetricName: "smt_flux", Interval: "day", GroupBy: ["region-id"] },
      { MetricName: "sec_request_clean", Interval: "day", GroupBy: undefined }
    ]);
  });

  it("uses acc_flux plus smt_flux and sec_request_clean for the rolling 24-hour window", async () => {
    const requests: DescribeBillingDataRequest[] = [];
    const client: EdgeOneClient = {
      async describePlans() {
        return { TotalCount: 0, Plans: [] };
      },
      async describeBillingData(request) {
        requests.push(request);
        return {
          Data: [{ Value: request.MetricName === "sec_request_clean" ? 30 : 10, ZoneId: zoneId }]
        };
      }
    };
    const now = new Date("2026-07-16T12:00:00.000Z");
    await expect(queryEdgeOneLast24Hours(client, zoneId, now)).resolves.toMatchObject({
      trafficBytes: 20,
      requestCount: 30,
      start: new Date("2026-07-15T12:00:00.000Z"),
      end: now
    });
    expect(requests).toHaveLength(3);
    expect(requests.every((request) => request.Interval === "5min" && !request.GroupBy)).toBe(true);
  });

  it("fails closed for null data, negative values, unsafe values and unknown regions", async () => {
    const clientForData = (Data: unknown): EdgeOneClient => ({
      async describePlans() {
        return { TotalCount: 0, Plans: [] };
      },
      async describeBillingData() {
        return { Data: Data as never };
      }
    });
    const range = {
      zoneId,
      start: new Date("2026-07-01T00:00:00.000Z"),
      end: new Date("2026-07-02T00:00:00.000Z")
    };
    await expect(queryEdgeOnePackageUsage(clientForData(null), range)).rejects.toMatchObject({
      code: "EDGEONE_INVALID_BILLING_DATA"
    });
    await expect(
      queryEdgeOnePackageUsage(
        clientForData([{ Value: -1, ZoneId: zoneId, RegionId: "CH" }]),
        range
      )
    ).rejects.toMatchObject({ code: "EDGEONE_INVALID_BILLING_DATA" });
    await expect(
      queryEdgeOnePackageUsage(
        clientForData([{ Value: Number.MAX_SAFE_INTEGER + 1, ZoneId: zoneId, RegionId: "CH" }]),
        range
      )
    ).rejects.toMatchObject({ code: "EDGEONE_INVALID_BILLING_DATA" });
    await expect(
      queryEdgeOnePackageUsage(
        clientForData([{ Value: 1, ZoneId: zoneId, RegionId: "UNKNOWN" }]),
        range
      )
    ).rejects.toMatchObject({ code: "EDGEONE_INVALID_BILLING_DATA" });
  });

  it("maps only SecTrafficCapacity and SecRequestCapacity and permits overage", async () => {
    expect(
      edgeOnePackageCapacities(
        availablePlan({
          SecTrafficCapacity: 100,
          SecRequestCapacity: 200,
          AccTrafficCapacity: 9_000,
          SmartTrafficCapacity: 8_000
        })
      )
    ).toEqual({ trafficCapacityBytes: 100, requestCapacity: 200 });

    const client: EdgeOneClient = {
      async describePlans() {
        return { TotalCount: 0, Plans: [] };
      },
      async describeBillingData(request) {
        return {
          Data: [
            {
              Value: 500,
              ZoneId: zoneId,
              ...(request.GroupBy ? { RegionId: "CH" } : {})
            }
          ]
        };
      }
    };
    await expect(
      queryEdgeOnePackageUsage(client, {
        zoneId,
        start: new Date("2026-07-01T00:00:00.000Z"),
        end: new Date("2026-07-02T00:00:00.000Z")
      })
    ).resolves.toEqual({ trafficUsedBytes: 1_000, requestUsed: 500 });
  });
});

describe("EdgeOne admin config snapshot", () => {
  it("derives Zone and mask from one record without decrypting SecretKey", async () => {
    const key = Buffer.alloc(32, 19);
    const findUnique = vi.fn(async () => ({
      zoneId,
      secretIdCiphertext: encryptEdgeOneCredential("AKIDCONSISTENT1234", "secretId", key),
      secretKeyCiphertext: "intentionally-not-a-valid-envelope",
      updatedAt: new Date("2026-07-16T00:00:00.000Z")
    }));
    const prisma = {
      systemConfig: { findUnique }
    } as unknown as AppPrismaClient;

    await expect(readEdgeOneSystemConfigAdminView(prisma, key)).resolves.toEqual({
      zoneId,
      secretIdMasked: "AKID****1234",
      secretIdConfigured: true,
      secretKeyConfigured: true,
      updatedAt: new Date("2026-07-16T00:00:00.000Z")
    });
    expect(findUnique).toHaveBeenCalledTimes(1);
  });
});
