import type { IncomingHttpHeaders } from "node:http";
import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger, FastifyRequest, FastifyServerOptions } from "fastify";

export const redactedValue = "[REDACTED]";

export type ApiLogStream = {
  write: (message: string) => void;
};

export type ApiLoggerOptions = Exclude<FastifyServerOptions["logger"], boolean | undefined>;

export type SecurityEventName =
  | "admin_login_failed"
  | "admin_login_rate_limited"
  | "analytics_rate_limited"
  | "client_session_rejected"
  | "client_wechat_login_failed"
  | "client_wechat_login_rate_limited"
  | "client_wechat_login_succeeded"
  | "admin_session_revoked"
  | "admin_sessions_revoked"
  | "admin_password_change_failed"
  | "admin_password_changed"
  | "cors_rejected"
  | "media_recovery_failed"
  | "backup_create_requested"
  | "backup_create_completed"
  | "backup_create_failed"
  | "backup_delete_requested"
  | "backup_delete_completed"
  | "backup_delete_failed"
  | "backup_import_requested"
  | "backup_import_completed"
  | "backup_import_rejected"
  | "backup_restore_requested"
  | "backup_restore_failed"
  | "backup_restore_completed"
  | "edgeone_prefetch_rate_limited";

const sensitiveKeyPattern =
  /^(authorization|proxy-authorization|cookie|set-cookie|password|currentpassword|newpassword|confirmpassword|code|wechatcode|logincode|token|access_token|refresh_token|jwt|jwtsecret|secret|secretid|secretkey|clientsecret|appsecret|sessionkey|session_key|openid|unionid|apikey|api_key|credential|credentials|candidatecredentials|edgeonecredentialencryptionkey)$/i;
const sensitiveKeyFragmentPattern =
  /(password|authorization|cookie|token|jwt|secret|session[-_]?key|openid|unionid|api[-_]?key|credential|encryption[-_]?key|master[-_]?key)/i;
const sensitiveTextPattern =
  /\b(authorization|password|currentPassword|newPassword|confirmPassword|code|wechatCode|loginCode|token|jwt|jwt_secret|secret|secretId|secretKey|appSecret|sessionKey|session_key|openid|unionid|api_key|apikey|EDGEONE_CREDENTIAL_ENCRYPTION_KEY)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;}\]]+)/gi;

export const apiLogRedactPaths = [
  "req.headers.authorization",
  "req.headers['proxy-authorization']",
  "req.headers.cookie",
  "req.headers['set-cookie']",
  "req.headers['x-api-key']",
  "request.headers.authorization",
  "request.headers['proxy-authorization']",
  "request.headers.cookie",
  "request.headers['set-cookie']",
  "request.headers['x-api-key']",
  "headers.authorization",
  "headers['proxy-authorization']",
  "headers.cookie",
  "headers['set-cookie']",
  "headers['x-api-key']",
  "req.body.secretId",
  "req.body.secretKey",
  "req.body.candidateCredentials",
  "request.body.secretId",
  "request.body.secretKey",
  "request.body.candidateCredentials",
  "body.password",
  "body.currentPassword",
  "body.newPassword",
  "body.confirmPassword",
  "body.token",
  "body.code",
  "body.wechatCode",
  "body.loginCode",
  "body.jwt",
  "body.secret",
  "body.secretId",
  "body.secretKey",
  "body.candidateCredentials",
  "body.EDGEONE_CREDENTIAL_ENCRYPTION_KEY",
  "body.JWT_SECRET",
  "body.sessionKey",
  "body.session_key",
  "body.openid",
  "body.unionid",
  "config.jwt.secret",
  "config.JWT_SECRET",
  "config.secret",
  "config.edgeOne.credentialEncryptionKey",
  "config.EDGEONE_CREDENTIAL_ENCRYPTION_KEY",
  "candidateCredentials",
  "config.clientAuth.wechat.appSecret",
  "config.wechat.appSecret",
  "config.WECHAT_MINIAPP_APP_SECRET",
  "details.headers.authorization",
  "details.headers['proxy-authorization']",
  "details.headers.cookie",
  "details.headers['set-cookie']",
  "details.body.password",
  "details.body.currentPassword",
  "details.body.newPassword",
  "details.body.confirmPassword",
  "details.body.token",
  "details.body.code",
  "details.body.wechatCode",
  "details.body.loginCode",
  "details.body.jwt",
  "details.body.secret",
  "details.body.secretId",
  "details.body.secretKey",
  "details.body.candidateCredentials",
  "details.body.EDGEONE_CREDENTIAL_ENCRYPTION_KEY",
  "details.body.sessionKey",
  "details.body.session_key",
  "details.body.openid",
  "details.body.unionid",
  "details.config.jwt.secret",
  "details.config.JWT_SECRET",
  "details.config.edgeOne.credentialEncryptionKey",
  "details.config.EDGEONE_CREDENTIAL_ENCRYPTION_KEY",
  "details.candidateCredentials",
  "details.config.clientAuth.wechat.appSecret",
  "details.config.wechat.appSecret",
  "details.config.WECHAT_MINIAPP_APP_SECRET"
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

function isSensitiveKey(key: string) {
  const compact = key.replace(/[-_\s]/g, "");
  if (sensitiveKeyPattern.test(compact)) return true;
  if (sensitiveKeyFragmentPattern.test(key)) return true;
  return /^(backupArchive|backupContent|backupPayload|archiveBytes|rawArchive|rawBackup|fileBuffer)$/i.test(key);
}

export function sanitizeLogText(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(sensitiveTextPattern, (_match, key: string) => `${key}=${redactedValue}`);
}

export function redactSensitive(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[MaxDepth]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeLogText(value);
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[Buffer ${value.byteLength} bytes]`;
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, depth + 1));
  if (!isPlainObject(value)) return sanitizeLogText(String(value));

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveKey(key) ? redactedValue : redactSensitive(item, depth + 1)
    ])
  );
}

export function sanitizeRequestId(value: unknown) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(candidate)) return candidate;
  return randomUUID();
}

export function requestIdFromHeaders(headers: IncomingHttpHeaders) {
  return sanitizeRequestId(headers["x-request-id"]);
}

function serializeError(error: unknown) {
  if (!(error instanceof Error)) {
    return {
      type: "UnknownError",
      message: sanitizeLogText(String(error)),
      stack: ""
    };
  }
  const err = error as Error & { code?: string; statusCode?: number };
  return {
    type: err.name,
    message: sanitizeLogText(err.message),
    stack: err.stack ? sanitizeLogText(err.stack) : "",
    code: err.code,
    statusCode: err.statusCode
  };
}

export function createApiLoggerOptions(options: { stream?: ApiLogStream; level?: string } = {}): ApiLoggerOptions {
  return {
    level: options.level ?? process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
    stream: options.stream,
    redact: {
      paths: [...apiLogRedactPaths],
      censor: redactedValue
    },
    serializers: {
      req(request) {
        return {
          id: request.id,
          method: request.method,
          url: request.url,
          route: request.routeOptions?.url,
          remoteAddress: request.ip,
          headers: redactSensitive(request.headers)
        };
      },
      res(reply) {
        return {
          statusCode: reply.statusCode
        };
      },
      err: serializeError
    }
  };
}

export function logSecurityEvent(
  request: FastifyRequest,
  securityEvent: SecurityEventName,
  details: Record<string, unknown> = {},
  level: "info" | "warn" | "error" = "info"
) {
  request.log[level](
    {
      event: "security",
      securityEvent,
      requestId: request.id,
      method: request.method,
      url: request.url,
      route: request.routeOptions?.url,
      clientIp: request.ip,
      details: redactSensitive(details)
    },
    "security event"
  );
}

export function createSecurityEventLogger(logger: FastifyBaseLogger) {
  return (
    securityEvent: SecurityEventName,
    details: Record<string, unknown> = {},
    level: "info" | "warn" | "error" = "info"
  ) => {
    logger[level](
      {
        event: "security",
        securityEvent,
        details: redactSensitive(details)
      },
      "security event"
    );
  };
}

export function serializeErrorForLog(error: unknown) {
  return serializeError(error);
}
