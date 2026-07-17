import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app";
import { createPrismaClient, type AppPrismaClient } from "../src/db";
import type {
  DescribeBillingDataRequest,
  DescribeBillingDataResponse,
  EdgeOneClientFactory,
  EdgeOneCredentials,
  EdgeOnePlan
} from "../src/edgeone";
import { readDecryptedEdgeOneSystemConfig } from "../src/system-config";
import { ensureDatabaseSchema } from "../src/sqlite-schema";
import { resetTestAdmin, testAdminCredentials } from "./fixtures";

const encryptionKey = Buffer.alloc(32, 71);
const now = new Date("2026-07-16T12:00:00.000Z");
const zoneId = "zone-test";
const secretId = "AKIDEDGEONETEST1234";
const secretKey = "EDGEONE_TEST_SECRET_KEY";

type FakeMode =
  "ready" | "zone_not_found" | "invalid_credentials" | "billing_error" | "dashboard_deferred";

function fakeBillingResponse(request: DescribeBillingDataRequest): DescribeBillingDataResponse {
  const packageQuery = request.Interval === "day";
  if (request.MetricName === "acc_flux") {
    return {
      Data: [
        {
          Value: packageQuery ? 500 : 100,
          ZoneId: zoneId,
          ...(request.GroupBy ? { RegionId: "CH" } : {})
        }
      ]
    };
  }
  if (request.MetricName === "smt_flux") {
    return {
      Data: [
        {
          Value: packageQuery ? 100 : 200,
          ZoneId: zoneId,
          ...(request.GroupBy ? { RegionId: "NA" } : {})
        }
      ]
    };
  }
  return { Data: [{ Value: packageQuery ? 400 : 30, ZoneId: zoneId }] };
}

function fakePlan(): EdgeOnePlan {
  return {
    PlanId: "edgeone-plan-test",
    PlanType: "plan-standard",
    Status: "normal",
    PayMode: 1,
    EnabledTime: "2026-06-15T00:00:00.000Z",
    ExpiredTime: "2027-06-15T00:00:00.000Z",
    SecTrafficCapacity: 100,
    SecRequestCapacity: 200,
    AccTrafficCapacity: 9_000,
    SmartTrafficCapacity: 8_000,
    ZonesInfo: [{ ZoneId: zoneId }]
  };
}

let root: string;
let uploadDir: string;
let prisma: AppPrismaClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let mode: FakeMode;
let observedCredentials: EdgeOneCredentials[];
let billingRequests: DescribeBillingDataRequest[];
let deferredBillingResponses: Array<{
  request: DescribeBillingDataRequest;
  resolve: (response: DescribeBillingDataResponse) => void;
}>;

const fakeClientFactory: EdgeOneClientFactory = (credentials) => {
  observedCredentials.push({ ...credentials });
  return {
    async describePlans() {
      if (mode === "invalid_credentials") {
        throw { code: "AuthFailure.SignatureFailure", message: credentials.secretKey };
      }
      const plan = fakePlan();
      if (mode === "zone_not_found") plan.ZonesInfo = [{ ZoneId: "zone-other" }];
      return { TotalCount: 1, Plans: [plan] };
    },
    async describeBillingData(request) {
      billingRequests.push(request);
      if (mode === "dashboard_deferred") {
        return new Promise((resolve) => {
          deferredBillingResponses.push({ request, resolve });
        });
      }
      if (mode === "billing_error") {
        throw { code: "RequestLimitExceeded", message: credentials.secretKey };
      }
      return fakeBillingResponse(request);
    }
  };
};

async function loginAdmin() {
  const response = await app.inject({
    method: "POST",
    url: "/api/admin/auth/login",
    payload: testAdminCredentials
  });
  expect(response.statusCode).toBe(200);
  return String(response.json().data.token);
}

async function putConfig(
  token: string,
  payload: { zoneId: string; secretId?: string; secretKey?: string }
) {
  return app.inject({
    method: "PUT",
    url: "/api/admin/system-config/edgeone",
    headers: { authorization: `Bearer ${token}` },
    payload
  });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "event-arts-edgeone-api-"));
  uploadDir = path.join(root, "uploads");
  await mkdir(uploadDir, { recursive: true });
  prisma = createPrismaClient(`file:${path.join(root, "test.db")}`);
  await ensureDatabaseSchema(prisma, { uploadDir });
  await resetTestAdmin(prisma);
  mode = "ready";
  observedCredentials = [];
  billingRequests = [];
  deferredBillingResponses = [];
  app = await buildApp({
    prisma,
    jwtSecret: "edgeone-api-test-secret-with-more-than-32-chars",
    uploadDir,
    publicBaseUrl: "http://127.0.0.1:3001",
    now: () => new Date(now),
    edgeOne: { credentialEncryptionKey: encryptionKey, clientFactory: fakeClientFactory }
  });
});

afterEach(async () => {
  await app?.close();
  await prisma?.$disconnect();
  await rm(root, { recursive: true, force: true });
});

describe("EdgeOne system-config admin API", () => {
  it("requires admin authentication and returns a no-store unconfigured view", async () => {
    const unauthorizedGet = await app.inject({
      method: "GET",
      url: "/api/admin/system-config/edgeone"
    });
    const unauthorizedPut = await app.inject({
      method: "PUT",
      url: "/api/admin/system-config/edgeone",
      payload: { zoneId, secretId, secretKey }
    });
    expect(unauthorizedGet.statusCode).toBe(401);
    expect(unauthorizedPut.statusCode).toBe(401);
    expect(unauthorizedGet.headers["cache-control"]).toBe("no-store");
    expect(unauthorizedPut.headers["cache-control"]).toBe("no-store");

    const token = await loginAdmin();
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/system-config/edgeone",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json().data).toEqual({
      zoneId: null,
      secretIdMasked: null,
      secretIdConfigured: false,
      secretKeyConfigured: false,
      updatedAt: null
    });
  });

  it("validates all three metrics before saving and never returns or stores plaintext credentials", async () => {
    const token = await loginAdmin();
    const missing = await putConfig(token, { zoneId, secretId });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe("EDGEONE_CREDENTIALS_REQUIRED");
    expect(await prisma.systemConfig.count()).toBe(0);

    const response = await putConfig(token, { zoneId, secretId, secretKey });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json().data).toMatchObject({
      zoneId,
      secretIdMasked: "AKID****1234",
      secretIdConfigured: true,
      secretKeyConfigured: true
    });
    expect(response.body).not.toContain(secretId);
    expect(response.body).not.toContain(secretKey);
    expect(billingRequests.map((request) => request.MetricName)).toEqual([
      "acc_flux",
      "smt_flux",
      "sec_request_clean"
    ]);

    const raw = await prisma.systemConfig.findUniqueOrThrow({ where: { id: 1 } });
    expect(JSON.stringify(raw)).not.toContain(secretId);
    expect(JSON.stringify(raw)).not.toContain(secretKey);
    const operationLog = await prisma.operationLog.findFirstOrThrow({
      where: { action: "UPDATE_EDGEONE_CONFIG" },
      orderBy: { id: "desc" }
    });
    expect(operationLog.detail).toContain(zoneId);
    expect(operationLog.detail).not.toContain(secretId);
    expect(operationLog.detail).not.toContain(secretKey);
  });

  it("retains omitted credentials during rotation and keeps GET secrets masked", async () => {
    const token = await loginAdmin();
    expect((await putConfig(token, { zoneId, secretId, secretKey })).statusCode).toBe(200);

    const rotatedSecretKey = "ROTATED_EDGEONE_TEST_SECRET_KEY";
    const rotated = await putConfig(token, { zoneId, secretKey: rotatedSecretKey });
    expect(rotated.statusCode).toBe(200);
    expect(observedCredentials.at(-1)).toEqual({ secretId, secretKey: rotatedSecretKey });
    await expect(readDecryptedEdgeOneSystemConfig(prisma, encryptionKey)).resolves.toMatchObject({
      zoneId,
      secretId,
      secretKey: rotatedSecretKey
    });

    const getResponse = await app.inject({
      method: "GET",
      url: "/api/admin/system-config/edgeone",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.body).not.toContain(rotatedSecretKey);
    expect(getResponse.json().data.secretIdMasked).toBe("AKID****1234");
  });

  it("preserves the old encrypted row when plan or billing validation fails", async () => {
    const token = await loginAdmin();
    expect((await putConfig(token, { zoneId, secretId, secretKey })).statusCode).toBe(200);
    const before = await prisma.systemConfig.findUniqueOrThrow({ where: { id: 1 } });

    mode = "zone_not_found";
    const failedPlan = await putConfig(token, {
      zoneId,
      secretId: "AKID_REJECTED_VALUE",
      secretKey: "REJECTED_SECRET_KEY"
    });
    expect(failedPlan.statusCode).toBe(422);
    expect(failedPlan.json().error.code).toBe("EDGEONE_ZONE_NOT_FOUND");
    expect(await prisma.systemConfig.findUniqueOrThrow({ where: { id: 1 } })).toEqual(before);

    mode = "billing_error";
    const failedBilling = await putConfig(token, {
      zoneId,
      secretId: "AKID_REJECTED_VALUE",
      secretKey: "REJECTED_SECRET_KEY"
    });
    expect(failedBilling.statusCode).toBe(502);
    expect(failedBilling.json().error.code).toBe("EDGEONE_UPSTREAM_UNAVAILABLE");
    expect(failedBilling.body).not.toContain("REJECTED_SECRET_KEY");
    expect(billingRequests.slice(-3).map((request) => request.MetricName)).toEqual([
      "acc_flux",
      "smt_flux",
      "sec_request_clean"
    ]);
    expect(await prisma.systemConfig.findUniqueOrThrow({ where: { id: 1 } })).toEqual(before);

    mode = "ready";
    await prisma.$executeRawUnsafe(
      "CREATE TRIGGER reject_edgeone_operation_log BEFORE INSERT ON operation_logs WHEN NEW.action = 'UPDATE_EDGEONE_CONFIG' BEGIN SELECT RAISE(ABORT, 'reject audit'); END"
    );
    const failedAudit = await putConfig(token, {
      zoneId,
      secretKey: "ROTATION_MUST_ROLL_BACK"
    });
    expect(failedAudit.statusCode).toBe(503);
    expect(failedAudit.body).not.toContain("ROTATION_MUST_ROLL_BACK");
    expect(await prisma.systemConfig.findUniqueOrThrow({ where: { id: 1 } })).toEqual(before);
  });

  it("maps invalid credentials to a safe 422 and rejects malformed input with 400", async () => {
    const token = await loginAdmin();
    const malformed = await putConfig(token, { zoneId: "invalid.zone", secretId, secretKey });
    expect(malformed.statusCode).toBe(400);

    mode = "invalid_credentials";
    const invalid = await putConfig(token, { zoneId, secretId, secretKey });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().error).toEqual({
      code: "EDGEONE_INVALID_CREDENTIALS",
      message: "CAM 凭证无效，请检查 SecretId 和 SecretKey"
    });
    expect(invalid.body).not.toContain(secretKey);
    expect(await prisma.systemConfig.count()).toBe(0);
  });

  it("blocks saving before any SDK call when the development encryption key is absent", async () => {
    await app.close();
    app = await buildApp({
      prisma,
      jwtSecret: "edgeone-api-test-secret-with-more-than-32-chars",
      uploadDir,
      publicBaseUrl: "http://127.0.0.1:3001",
      now: () => new Date(now),
      edgeOne: { credentialEncryptionKey: null, clientFactory: fakeClientFactory }
    });
    const token = await loginAdmin();
    const response = await putConfig(token, { zoneId, secretId, secretKey });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("EDGEONE_CONFIGURATION_UNAVAILABLE");
    expect(observedCredentials).toEqual([]);
    expect(await prisma.systemConfig.count()).toBe(0);
  });
});

describe("EdgeOne dashboard aggregation", () => {
  it("returns not_configured without affecting the existing local overview", async () => {
    const token = await loginAdmin();
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/dashboard/overview",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json().data).toEqual({
      todayUniqueUsers: 0,
      weekDailyUniqueUsers: 0,
      monthDailyUniqueUsers: 0,
      edgeOne: { status: "not_configured" }
    });
  });

  it("returns rolling usage, weighted package usage and only Sec capacities", async () => {
    const token = await loginAdmin();
    expect((await putConfig(token, { zoneId, secretId, secretKey })).statusCode).toBe(200);
    billingRequests = [];

    const response = await app.inject({
      method: "GET",
      url: "/api/admin/dashboard/overview",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.edgeOne).toEqual({
      status: "ready",
      zoneId,
      fetchedAt: now.toISOString(),
      last24Hours: {
        startTime: "2026-07-15T12:00:00.000Z",
        endTime: now.toISOString(),
        trafficBytes: 300,
        requestCount: 30
      },
      package: {
        planId: "edgeone-plan-test",
        planType: "plan-standard",
        planStatus: "normal",
        periodStart: "2026-07-15T00:00:00.000Z",
        periodEnd: "2026-08-15T00:00:00.000Z",
        trafficUsedBytes: 671,
        trafficCapacityBytes: 100,
        requestUsed: 400,
        requestCapacity: 200
      }
    });
    expect(billingRequests).toHaveLength(6);
    expect(response.body).not.toContain(secretId);
    expect(response.body).not.toContain(secretKey);
  });

  it("starts both three-metric dashboard stages before awaiting any billing response", async () => {
    const token = await loginAdmin();
    expect((await putConfig(token, { zoneId, secretId, secretKey })).statusCode).toBe(200);
    billingRequests = [];
    deferredBillingResponses = [];
    mode = "dashboard_deferred";

    let completed = false;
    const responsePromise = app
      .inject({
        method: "GET",
        url: "/api/admin/dashboard/overview",
        headers: { authorization: `Bearer ${token}` }
      })
      .then((response) => {
        completed = true;
        return response;
      });

    await vi.waitFor(() => expect(billingRequests.length).toBeGreaterThanOrEqual(3));
    await new Promise<void>((resolve) => setImmediate(resolve));
    const requestsStartedBeforeAnyResolution = billingRequests.length;
    let resolved = 0;
    const drainResponses = (async () => {
      while (!completed) {
        while (resolved < deferredBillingResponses.length) {
          const pending = deferredBillingResponses[resolved++]!;
          pending.resolve(fakeBillingResponse(pending.request));
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    })();

    const response = await responsePromise;
    await drainResponses;
    expect(requestsStartedBeforeAnyResolution).toBe(6);
    expect(response.statusCode).toBe(200);
    expect(response.json().data.edgeOne.status).toBe("ready");
  });

  it("keeps local statistics available when Tencent Cloud fails", async () => {
    const token = await loginAdmin();
    expect((await putConfig(token, { zoneId, secretId, secretKey })).statusCode).toBe(200);
    mode = "billing_error";

    const response = await app.inject({
      method: "GET",
      url: "/api/admin/dashboard/overview",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      todayUniqueUsers: 0,
      weekDailyUniqueUsers: 0,
      monthDailyUniqueUsers: 0,
      edgeOne: {
        status: "error",
        code: "EDGEONE_UPSTREAM_UNAVAILABLE",
        message: "腾讯云 EdgeOne 服务暂时不可用，请稍后重试"
      }
    });
    expect(response.body).not.toContain(secretKey);
  });
});
