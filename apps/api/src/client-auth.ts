import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { ApiErrorCode } from "@event-arts/shared";
import type { ApiConfig, WeChatAuthVerifierMode } from "./config";
import type { AppPrismaClient } from "./db";

export const clientAuthLoginExchangePath = "/api/client/auth/wechat" as const;
export const clientAuthProtectedRoutePrefix = "/api/client/" as const;

export type ClientAuthRouteBoundary = {
  protectedPrefix: typeof clientAuthProtectedRoutePrefix;
  loginExchangePath: typeof clientAuthLoginExchangePath;
};

export type ClientSessionConfig = {
  ttlSeconds: number;
};

export type WeChatLoginVerificationInput = {
  code: string;
  expectedAppId: string;
  timeoutMs: number;
  requestId?: string;
};

export type WeChatLoginVerificationSuccess = {
  ok: true;
  appId: string;
  openid: string;
  unionid?: string;
  sessionKey: string;
};

export type WeChatLoginVerificationFailureReason =
  | "invalid_code"
  | "appid_mismatch"
  | "upstream_timeout"
  | "upstream_error"
  | "misconfigured";

export type WeChatLoginVerificationFailure = {
  ok: false;
  reason: WeChatLoginVerificationFailureReason;
  retryable: boolean;
  publicErrorCode: Extract<ApiErrorCode, "INVALID_WECHAT_CODE" | "WECHAT_AUTH_UNAVAILABLE">;
  publicMessage: string;
  upstreamErrCode?: number;
};

export type WeChatLoginVerificationResult =
  | WeChatLoginVerificationSuccess
  | WeChatLoginVerificationFailure;

export type WeChatLoginCodeVerifier = {
  readonly mode: WeChatAuthVerifierMode;
  verifyLoginCode(input: WeChatLoginVerificationInput): Promise<WeChatLoginVerificationResult>;
};

export const clientSessionTokenType = "Bearer" as const;
export const clientSessionTokenBytes = 32;
export const clientSessionTokenMinLength = 32;
export const clientSessionTokenMaxLength = 4096;

export const clientSessionRevokeReasons = {
  manual: "manual",
  security: "security"
} as const;

export type ClientSessionRevokeReason = (typeof clientSessionRevokeReasons)[keyof typeof clientSessionRevokeReasons];
type ClientSessionClient = AppPrismaClient | Prisma.TransactionClient;

export type ClientSessionAuthSuccess = {
  ok: true;
  session: {
    id: string;
    appId: string;
    openidHash: string;
    unionidHash: string | null;
    tokenHash: string;
    expiresAt: Date;
  };
};

export type ClientSessionAuthFailureReason =
  | "missing"
  | "malformed"
  | "unknown"
  | "expired"
  | "revoked";

export type ClientSessionAuthFailure = {
  ok: false;
  reason: ClientSessionAuthFailureReason;
  publicErrorCode: Extract<ApiErrorCode, "CLIENT_AUTH_REQUIRED" | "CLIENT_SESSION_EXPIRED" | "CLIENT_SESSION_REVOKED">;
  publicMessage: string;
};

export type ClientSessionAuthResult = ClientSessionAuthSuccess | ClientSessionAuthFailure;

type WeChatCode2SessionResponse = {
  openid?: unknown;
  session_key?: unknown;
  unionid?: unknown;
  errcode?: unknown;
  errmsg?: unknown;
};

export type WeChatCode2SessionFetch = typeof fetch;

export type WeChatCode2SessionVerifierOptions = {
  appId: string;
  appSecret: string;
  fetchImpl?: WeChatCode2SessionFetch;
};

export type FakeWeChatVerifierSuccess = {
  ok?: true;
  appId?: string;
  openid?: string;
  unionid?: string;
  sessionKey?: string;
};

export type FakeWeChatVerifierOptions = {
  appId: string;
  codes?: Record<string, FakeWeChatVerifierSuccess | WeChatLoginVerificationFailure>;
  acceptAnyCode?: boolean;
  singleUse?: boolean;
};

function clientAuthFailure(
  reason: ClientSessionAuthFailureReason,
  publicErrorCode: ClientSessionAuthFailure["publicErrorCode"],
  publicMessage: string
): ClientSessionAuthFailure {
  return { ok: false, reason, publicErrorCode, publicMessage };
}

export function hashClientSessionToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function hashClientSubject(input: { appId: string; subject: string; kind: "openid" | "unionid" }) {
  return createHash("sha256")
    .update(`wechat-miniapp:${input.kind}:${input.appId}:${input.subject}`, "utf8")
    .digest("hex");
}

function generateClientSessionToken() {
  return randomBytes(clientSessionTokenBytes).toString("base64url");
}

export function isPlausibleClientSessionToken(value: string) {
  return value.length >= clientSessionTokenMinLength && value.length <= clientSessionTokenMaxLength;
}

export async function createClientSession(
  prisma: ClientSessionClient,
  input: {
    appId: string;
    openid: string;
    unionid?: string;
    ttlSeconds: number;
    now: Date;
  }
) {
  const createdAt = new Date(input.now.getTime());
  const expiresAt = new Date(createdAt.getTime() + input.ttlSeconds * 1000);
  const openidHash = hashClientSubject({ appId: input.appId, kind: "openid", subject: input.openid });
  const unionidHash = input.unionid
    ? hashClientSubject({ appId: input.appId, kind: "unionid", subject: input.unionid })
    : null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = generateClientSessionToken();
    const tokenHash = hashClientSessionToken(token);
    try {
      const session = await prisma.clientSession.create({
        data: {
          tokenHash,
          appId: input.appId,
          openidHash,
          unionidHash,
          createdAt,
          expiresAt
        }
      });
      return {
        token,
        tokenType: clientSessionTokenType,
        expiresInSeconds: input.ttlSeconds,
        expiresAt,
        session
      };
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002" || attempt === 2) throw error;
    }
  }

  throw new Error("failed to create unique client session token");
}

export async function verifyClientSessionToken(
  prisma: ClientSessionClient,
  input: { token: string | null; now: Date; touch?: boolean }
): Promise<ClientSessionAuthResult> {
  const token = input.token?.trim() ?? "";
  if (!token) {
    return clientAuthFailure("missing", "CLIENT_AUTH_REQUIRED", "请先完成小程序登录");
  }
  if (!isPlausibleClientSessionToken(token)) {
    return clientAuthFailure("malformed", "CLIENT_AUTH_REQUIRED", "请先完成小程序登录");
  }

  const tokenHash = hashClientSessionToken(token);
  const session = await prisma.clientSession.findUnique({ where: { tokenHash } });
  if (!session) {
    return clientAuthFailure("unknown", "CLIENT_AUTH_REQUIRED", "请先完成小程序登录");
  }
  if (session.revokedAt) {
    return clientAuthFailure("revoked", "CLIENT_SESSION_REVOKED", "小程序登录状态已失效，请重新登录");
  }
  if (session.expiresAt <= input.now) {
    return clientAuthFailure("expired", "CLIENT_SESSION_EXPIRED", "小程序登录状态已过期，请重新登录");
  }

  if (input.touch) {
    await prisma.clientSession.updateMany({
      where: { id: session.id, revokedAt: null, expiresAt: { gt: input.now } },
      data: { lastSeenAt: input.now }
    });
  }

  return {
    ok: true,
    session: {
      id: session.id,
      appId: session.appId,
      openidHash: session.openidHash,
      unionidHash: session.unionidHash,
      tokenHash: session.tokenHash,
      expiresAt: session.expiresAt
    }
  };
}

export async function revokeClientSession(
  prisma: ClientSessionClient,
  input: { tokenHash: string; reason: ClientSessionRevokeReason | string; now: Date }
) {
  return prisma.clientSession.updateMany({
    where: { tokenHash: input.tokenHash, revokedAt: null },
    data: {
      revokedAt: input.now,
      revokeReason: input.reason
    }
  });
}

export async function cleanupExpiredClientSessions(prisma: AppPrismaClient, now = new Date()) {
  const result = await prisma.clientSession.deleteMany({ where: { expiresAt: { lte: now } } });
  return { deletedCount: result.count };
}

function verificationFailure(
  reason: WeChatLoginVerificationFailureReason,
  retryable: boolean,
  publicErrorCode: WeChatLoginVerificationFailure["publicErrorCode"],
  publicMessage: string,
  upstreamErrCode?: number
): WeChatLoginVerificationFailure {
  return { ok: false, reason, retryable, publicErrorCode, publicMessage, upstreamErrCode };
}

function normalizeUpstreamErrCode(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function mapWeChatErrCode(errcode: number | undefined): WeChatLoginVerificationFailure {
  if (errcode === -1 || errcode === 45011) {
    return verificationFailure(
      "upstream_error",
      true,
      "WECHAT_AUTH_UNAVAILABLE",
      "微信登录服务暂不可用，请稍后再试",
      errcode
    );
  }
  return verificationFailure(
    "invalid_code",
    false,
    "INVALID_WECHAT_CODE",
    "微信登录凭证无效，请重新登录",
    errcode
  );
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export function createWeChatLoginCodeVerifier(
  options: WeChatCode2SessionVerifierOptions
): WeChatLoginCodeVerifier {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    mode: "wechat",
    async verifyLoginCode(input) {
      if (!options.appId || !options.appSecret || input.expectedAppId !== options.appId) {
        return verificationFailure(
          "misconfigured",
          false,
          "WECHAT_AUTH_UNAVAILABLE",
          "微信登录服务暂不可用，请稍后再试"
        );
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
      try {
        const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
        url.searchParams.set("appid", options.appId);
        url.searchParams.set("secret", options.appSecret);
        url.searchParams.set("js_code", input.code);
        url.searchParams.set("grant_type", "authorization_code");

        const response = await fetchImpl(url, {
          method: "GET",
          signal: controller.signal,
          headers: { accept: "application/json" }
        });
        if (!response.ok) {
          return verificationFailure(
            "upstream_error",
            true,
            "WECHAT_AUTH_UNAVAILABLE",
            "微信登录服务暂不可用，请稍后再试"
          );
        }

        const body = await response.json() as WeChatCode2SessionResponse;
        const errcode = normalizeUpstreamErrCode(body.errcode);
        if (errcode !== undefined && errcode !== 0) return mapWeChatErrCode(errcode);
        if (typeof body.openid !== "string" || typeof body.session_key !== "string") {
          return verificationFailure(
            "upstream_error",
            true,
            "WECHAT_AUTH_UNAVAILABLE",
            "微信登录服务暂不可用，请稍后再试",
            errcode
          );
        }

        return {
          ok: true,
          appId: options.appId,
          openid: body.openid,
          unionid: typeof body.unionid === "string" ? body.unionid : undefined,
          sessionKey: body.session_key
        };
      } catch (error) {
        return verificationFailure(
          isAbortError(error) ? "upstream_timeout" : "upstream_error",
          true,
          "WECHAT_AUTH_UNAVAILABLE",
          "微信登录服务暂不可用，请稍后再试"
        );
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

export function createFakeWeChatLoginCodeVerifier(options: FakeWeChatVerifierOptions): WeChatLoginCodeVerifier {
  const usedCodes = new Set<string>();
  return {
    mode: "fake",
    async verifyLoginCode(input) {
      if (input.expectedAppId !== options.appId) {
        return verificationFailure(
          "appid_mismatch",
          false,
          "INVALID_WECHAT_CODE",
          "微信登录凭证无效，请重新登录"
        );
      }
      if (options.singleUse && usedCodes.has(input.code)) {
        return verificationFailure(
          "invalid_code",
          false,
          "INVALID_WECHAT_CODE",
          "微信登录凭证无效，请重新登录"
        );
      }

      const configured = options.codes?.[input.code];
      if (!configured && options.acceptAnyCode !== true) {
        return verificationFailure(
          "invalid_code",
          false,
          "INVALID_WECHAT_CODE",
          "微信登录凭证无效，请重新登录"
        );
      }
      if (configured && configured.ok === false) return configured;

      usedCodes.add(input.code);
      const success = configured as FakeWeChatVerifierSuccess | undefined;
      return {
        ok: true,
        appId: success?.appId ?? options.appId,
        openid: success?.openid ?? `fake-openid-${hashClientSessionToken(input.code).slice(0, 24)}`,
        unionid: success?.unionid,
        sessionKey: success?.sessionKey ?? `fake-session-key-${hashClientSessionToken(`${input.code}:session`).slice(0, 24)}`
      };
    }
  };
}

export function createClientAuthVerifier(config: ApiConfig["clientAuth"]) {
  if (config.wechat.verifierMode === "fake") {
    return createFakeWeChatLoginCodeVerifier({ appId: config.wechat.appId, acceptAnyCode: true });
  }
  return createWeChatLoginCodeVerifier({
    appId: config.wechat.appId,
    appSecret: config.wechat.appSecret
  });
}

export function defaultTestClientAuthConfig(): ApiConfig["clientAuth"] {
  return {
    sessionTtlSeconds: 1_800,
    wechat: {
      appId: "wx0000000000000000",
      appSecret: "",
      verifierMode: "fake",
      code2SessionTimeoutMs: 3_000
    }
  };
}
