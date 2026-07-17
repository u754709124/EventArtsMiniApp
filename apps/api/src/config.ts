import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export type RuntimeEnvironment = "development" | "test" | "production";

export type ApiCorsConfig = {
  allowedOrigins: string[];
  allowRequestsWithoutOrigin: boolean;
};

export type WeChatAuthVerifierMode = "wechat" | "fake";

export type ApiConfig = {
  env: RuntimeEnvironment;
  repositoryRoot: string;
  envFilePath: string;
  envFileLoaded: boolean;
  databaseUrl: string;
  publicBaseUrl: string;
  server: {
    host: string;
    port: number;
  };
  paths: {
    uploadDir: string;
    backupDir: string;
  };
  jwt: {
    secret: string;
    source: "environment" | "generated-development";
  };
  clientAuth: {
    sessionTtlSeconds: number;
    wechat: {
      appId: string;
      appSecret: string;
      verifierMode: WeChatAuthVerifierMode;
      code2SessionTimeoutMs: number;
    };
  };
  cors: ApiCorsConfig;
  rateLimit: {
    login: {
      windowMs: number;
      maxFailures: number;
    };
    analytics: {
      windowMs: number;
      maxRequests: number;
    };
  };
  analytics: {
    retentionDays: number;
  };
  edgeOne: {
    credentialEncryptionKey: Buffer | null;
  };
};

export type LoadApiConfigOptions = {
  repositoryRoot?: string;
  envFilePath?: string;
  processEnv?: NodeJS.ProcessEnv;
  developmentJwtSecretFactory?: () => string;
};

export class ConfigValidationError extends Error {
  readonly code = "CONFIG_VALIDATION_ERROR";
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid API configuration:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "ConfigValidationError";
    this.issues = issues;
  }
}

const apiSourceDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = path.resolve(apiSourceDir, "../../..");

const knownWeakJwtSecrets = new Set([
  "dev-secret-change-me",
  "replace-this-in-production",
  "change-me",
  "changeme",
  "secret",
  "jwt-secret",
  "test-secret"
]);

const wechatVerifierModes = ["wechat", "fake"] as const;
const knownWechatPlaceholderValues = new Set([
  "changeme",
  "changeit",
  "replace",
  "replaceme",
  "replaceinproduction",
  "example",
  "sample",
  "default",
  "placeholder",
  "dummy",
  "fake",
  "test",
  "secret",
  "appid",
  "appsecret",
  "wechatappid",
  "wechatappsecret",
  "wechatminiappappid",
  "wechatminiappappsecret",
  "miniappappid",
  "miniappappsecret",
  "yourappid",
  "yourappsecret",
  "yourwechatappid",
  "yourwechatappsecret",
  "yourwechatminiappappid",
  "yourwechatminiappappsecret",
  "wx1234567890abcdef"
]);

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return value;
}, z.boolean());

const rawEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().trim().min(1).default("file:./dev.db"),
  API_HOST: z.string().trim().min(1).default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  PUBLIC_BASE_URL: z.string().trim().url().default("http://127.0.0.1:3001"),
  UPLOAD_DIR: z.string().trim().min(1).default("uploads"),
  BACKUP_DIR: z.string().trim().min(1).default("var/backups"),
  JWT_SECRET: z.string().optional(),
  WECHAT_MINIAPP_APP_ID: z.string().trim().optional(),
  WECHAT_MINIAPP_APP_SECRET: z.string().trim().optional(),
  WECHAT_AUTH_VERIFIER_MODE: z.enum(wechatVerifierModes).default("wechat"),
  CLIENT_SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(1_800),
  WECHAT_CODE2SESSION_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(3_000),
  CORS_ALLOWED_ORIGINS: z.string().optional(),
  CORS_ALLOW_REQUESTS_WITHOUT_ORIGIN: booleanFromEnv.default(true),
  LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(86_400_000).default(900_000),
  LOGIN_RATE_LIMIT_MAX_FAILURES: z.coerce.number().int().min(1).max(1_000).default(5),
  ANALYTICS_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(86_400_000).default(60_000),
  ANALYTICS_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).max(100_000).default(60),
  PAGE_VIEW_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  EDGEONE_CREDENTIAL_ENCRYPTION_KEY: z.string().trim().optional()
});

export function getRepositoryRoot() {
  return defaultRepositoryRoot;
}

export function getRepositoryEnvPath(repositoryRoot = defaultRepositoryRoot) {
  return path.join(repositoryRoot, ".env");
}

export function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      const hashIndex = value.search(/\s+#/);
      if (hashIndex >= 0) value = value.slice(0, hashIndex).trimEnd();
    }
    values[key] = value.replace(/\\n/g, "\n");
  }
  return values;
}

function readEnvFile(envFilePath: string) {
  if (!existsSync(envFilePath)) {
    return { loaded: false, values: {} as Record<string, string> };
  }
  return { loaded: true, values: parseEnvFile(readFileSync(envFilePath, "utf8")) };
}

function mergeEnvironment(fileEnv: Record<string, string>, processEnv: NodeJS.ProcessEnv) {
  const definedProcessEnv = Object.fromEntries(
    Object.entries(processEnv).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
  return { ...fileEnv, ...definedProcessEnv };
}

function toZodIssues(error: z.ZodError) {
  return error.issues.map((issue) => {
    const key = issue.path.join(".") || "environment";
    return `${key}: ${issue.message}`;
  });
}

function isValidHost(value: string) {
  if (value === "localhost") return true;
  if (net.isIP(value)) return true;
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(value);
}

export function isLoopbackHost(value: string) {
  const host = value.trim().toLowerCase();
  if (host === "localhost") return true;

  if (net.isIPv4(host)) {
    return host.split(".")[0] === "127";
  }

  if (net.isIPv6(host)) {
    return host === "::1" || host === "0:0:0:0:0:0:0:1";
  }

  return false;
}

function resolveConfiguredPath(repositoryRoot: string, value: string) {
  if (path.isAbsolute(value)) return path.normalize(value);
  const legacyApiRelative = value.startsWith("../");
  const base = legacyApiRelative ? path.resolve(repositoryRoot, "apps/api") : repositoryRoot;
  return path.resolve(base, value);
}

function isSameOrInside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parseCorsOrigins(rawValue: string | undefined, env: RuntimeEnvironment, issues: string[]) {
  const values = rawValue
    ? rawValue.split(",").map((value) => value.trim()).filter(Boolean)
    : [];

  if (env === "production" && values.length === 0) {
    issues.push("CORS_ALLOWED_ORIGINS is required in production");
  }

  for (const origin of values) {
    if (origin === "*") {
      if (env === "production") issues.push("CORS_ALLOWED_ORIGINS cannot include '*' in production");
      continue;
    }

    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      issues.push(`CORS_ALLOWED_ORIGINS contains an invalid origin: ${origin}`);
      continue;
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      issues.push(`CORS origin must use http or https: ${origin}`);
    }
    if (env === "production" && parsed.protocol !== "https:") {
      issues.push(`Production CORS origin must use https: ${origin}`);
    }
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
      issues.push(`CORS origin must not include path, query or hash: ${origin}`);
    }
  }

  return [...new Set(values)];
}

function hasAtLeastTwoCharacterClasses(value: string) {
  const classes = [
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /\d/.test(value),
    /[^A-Za-z0-9]/.test(value)
  ];
  return classes.filter(Boolean).length >= 2;
}

function isWeakJwtSecret(value: string) {
  const normalized = value.trim();
  if (normalized.length < 32) return true;
  if (knownWeakJwtSecrets.has(normalized)) return true;
  if (/^<.*>$/.test(normalized)) return true;
  if (/^(.)\1+$/.test(normalized)) return true;
  if (/(change|replace|example|sample|default|password)/i.test(normalized)) return true;
  return !hasAtLeastTwoCharacterClasses(normalized);
}

function isPlaceholderLikeSecret(value: string) {
  const normalized = value.trim();
  if (!normalized) return true;
  if (/^<.*>$/.test(normalized)) return true;
  if (/^(.)\1+$/.test(normalized)) return true;
  const compact = normalized.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (knownWechatPlaceholderValues.has(compact)) return true;
  return /^(change|replace|example|sample|default|placeholder|dummy|fake|your)/.test(compact);
}

function isLikelyWechatMiniappAppId(value: string) {
  return /^wx[A-Za-z0-9]{16}$/.test(value.trim());
}

function resolveClientAuthConfig(
  raw: z.infer<typeof rawEnvSchema>,
  issues: string[]
): ApiConfig["clientAuth"] {
  const appId = raw.WECHAT_MINIAPP_APP_ID?.trim() ?? "";
  const appSecret = raw.WECHAT_MINIAPP_APP_SECRET?.trim() ?? "";

  if (raw.NODE_ENV === "production") {
    if (raw.WECHAT_AUTH_VERIFIER_MODE !== "wechat") {
      issues.push("WECHAT_AUTH_VERIFIER_MODE must be 'wechat' in production");
    }
    if (!appId) {
      issues.push("WECHAT_MINIAPP_APP_ID is required in production");
    } else if (isPlaceholderLikeSecret(appId) || !isLikelyWechatMiniappAppId(appId)) {
      issues.push("WECHAT_MINIAPP_APP_ID is a placeholder or not a valid WeChat Mini Program AppID");
    }
    if (!appSecret) {
      issues.push("WECHAT_MINIAPP_APP_SECRET is required in production");
    } else if (isPlaceholderLikeSecret(appSecret)) {
      issues.push("WECHAT_MINIAPP_APP_SECRET is a placeholder or known development value");
    }
  }

  if (raw.WECHAT_AUTH_VERIFIER_MODE === "fake" && raw.NODE_ENV !== "production" && !appId) {
    issues.push("WECHAT_MINIAPP_APP_ID is required when WECHAT_AUTH_VERIFIER_MODE=fake");
  }

  return {
    sessionTtlSeconds: raw.CLIENT_SESSION_TTL_SECONDS,
    wechat: {
      appId,
      appSecret,
      verifierMode: raw.WECHAT_AUTH_VERIFIER_MODE,
      code2SessionTimeoutMs: raw.WECHAT_CODE2SESSION_TIMEOUT_MS
    }
  };
}

function resolveJwtSecret(
  rawSecret: string | undefined,
  env: RuntimeEnvironment,
  issues: string[],
  developmentJwtSecretFactory: () => string
) {
  const secret = rawSecret?.trim() || "";
  if (env === "production") {
    if (!secret) {
      issues.push("JWT_SECRET is required in production");
      return { secret: "", source: "environment" as const };
    }
    if (isWeakJwtSecret(secret)) {
      issues.push("JWT_SECRET is weak, a placeholder, or a known default");
    }
    return { secret, source: "environment" as const };
  }

  if (secret) return { secret, source: "environment" as const };
  return { secret: developmentJwtSecretFactory(), source: "generated-development" as const };
}

function resolveEdgeOneCredentialEncryptionKey(
  rawValue: string | undefined,
  env: RuntimeEnvironment,
  issues: string[]
) {
  const value = rawValue?.trim() ?? "";
  if (!value) {
    if (env === "production") {
      issues.push("EDGEONE_CREDENTIAL_ENCRYPTION_KEY is required in production");
    }
    return null;
  }

  const isCanonicalBase64 = /^[A-Za-z0-9+/]{43}=$/.test(value);
  const decoded = isCanonicalBase64 ? Buffer.from(value, "base64") : Buffer.alloc(0);
  if (decoded.byteLength !== 32 || decoded.toString("base64") !== value) {
    issues.push("EDGEONE_CREDENTIAL_ENCRYPTION_KEY must be canonical Base64 encoding of exactly 32 bytes");
    return null;
  }
  return decoded;
}

export function loadApiConfig(options: LoadApiConfigOptions = {}): ApiConfig {
  const repositoryRoot = options.repositoryRoot ?? defaultRepositoryRoot;
  const envFilePath = options.envFilePath ?? getRepositoryEnvPath(repositoryRoot);
  const fileEnv = readEnvFile(envFilePath);
  const mergedEnv = mergeEnvironment(fileEnv.values, options.processEnv ?? process.env);
  const parsed = rawEnvSchema.safeParse(mergedEnv);
  if (!parsed.success) {
    throw new ConfigValidationError(toZodIssues(parsed.error));
  }

  const raw = parsed.data;
  const issues: string[] = [];
  if (!isValidHost(raw.API_HOST)) issues.push(`API_HOST is not a valid hostname or IP address: ${raw.API_HOST}`);
  if (raw.NODE_ENV === "production" && !isLoopbackHost(raw.API_HOST)) {
    issues.push("API_HOST must be a loopback address in production; use Nginx as the public entrypoint");
  }

  const uploadDir = resolveConfiguredPath(repositoryRoot, raw.UPLOAD_DIR);
  const backupDir = resolveConfiguredPath(repositoryRoot, raw.BACKUP_DIR);
  if (isSameOrInside(uploadDir, backupDir)) {
    issues.push("BACKUP_DIR must not be inside UPLOAD_DIR");
  }

  const corsOrigins = parseCorsOrigins(raw.CORS_ALLOWED_ORIGINS, raw.NODE_ENV, issues);
  const clientAuth = resolveClientAuthConfig(raw, issues);
  const jwt = resolveJwtSecret(
    raw.JWT_SECRET,
    raw.NODE_ENV,
    issues,
    options.developmentJwtSecretFactory ?? (() => randomBytes(32).toString("base64url"))
  );
  const edgeOneCredentialEncryptionKey = resolveEdgeOneCredentialEncryptionKey(
    raw.EDGEONE_CREDENTIAL_ENCRYPTION_KEY,
    raw.NODE_ENV,
    issues
  );

  if (issues.length) throw new ConfigValidationError(issues);

  return {
    env: raw.NODE_ENV,
    repositoryRoot,
    envFilePath,
    envFileLoaded: fileEnv.loaded,
    databaseUrl: raw.DATABASE_URL,
    publicBaseUrl: raw.PUBLIC_BASE_URL,
    server: {
      host: raw.API_HOST,
      port: raw.API_PORT
    },
    paths: {
      uploadDir,
      backupDir
    },
    jwt,
    clientAuth,
    cors: {
      allowedOrigins: corsOrigins,
      allowRequestsWithoutOrigin: raw.CORS_ALLOW_REQUESTS_WITHOUT_ORIGIN
    },
    rateLimit: {
      login: {
        windowMs: raw.LOGIN_RATE_LIMIT_WINDOW_MS,
        maxFailures: raw.LOGIN_RATE_LIMIT_MAX_FAILURES
      },
      analytics: {
        windowMs: raw.ANALYTICS_RATE_LIMIT_WINDOW_MS,
        maxRequests: raw.ANALYTICS_RATE_LIMIT_MAX_REQUESTS
      }
    },
    analytics: {
      retentionDays: raw.PAGE_VIEW_RETENTION_DAYS
    },
    edgeOne: {
      credentialEncryptionKey: edgeOneCredentialEncryptionKey
    }
  };
}
