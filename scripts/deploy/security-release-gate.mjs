import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runProductionSmokeCheck } from "./production-smoke-check.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = path.resolve(scriptDir, "../..");

const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  "dist",
  ".tmp",
  "test-results",
  "playwright-report",
  "var",
  "uploads",
  ".codex/runtime"
]);

const allowedWeakJwtFiles = new Set([
  "apps/api/src/config.ts",
  "apps/api/test/config.test.ts",
  "playwright.config.ts"
]);

const forbiddenDefaultAdminPassword = ["admin", "123456"].join("");
const weakJwtSecretLiteral = ["dev-secret", "change-me"].join("-");
const forbiddenDefaultJwtEnv = `JWT_SECRET=${weakJwtSecretLiteral}`;

function posixRelative(root, filename) {
  return path.relative(root, filename).split(path.sep).join("/");
}

function shouldIgnore(relativePath) {
  return relativePath.split("/").some((part, index, parts) => {
    const prefix = parts.slice(0, index + 1).join("/");
    return ignoredDirectories.has(part) || ignoredDirectories.has(prefix);
  });
}

function listTextFiles(root) {
  const files = [];

  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const relative = posixRelative(root, absolute);
      if (shouldIgnore(relative)) continue;
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const size = statSync(absolute).size;
      if (size > 2 * 1024 * 1024) continue;
      files.push({ absolute, relative });
    }
  }

  walk(root);
  return files;
}

function readProjectFile(root, relativePath) {
  const absolute = path.join(root, relativePath);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
}

function addIssue(issues, level, code, message) {
  issues.push({ level, code, message });
}

function scanForbiddenDefaults(root, issues) {
  for (const file of listTextFiles(root)) {
    const content = readFileSync(file.absolute, "utf8");
    if (content.includes(forbiddenDefaultAdminPassword)) {
      addIssue(issues, "P0", "DEFAULT_ADMIN_PASSWORD", `Forbidden default administrator password appears in ${file.relative}`);
    }
    if (content.includes(forbiddenDefaultJwtEnv)) {
      addIssue(issues, "P0", "DEFAULT_JWT_ENV", `Usable default JWT env assignment appears in ${file.relative}`);
    }
    if (content.includes(weakJwtSecretLiteral) && !allowedWeakJwtFiles.has(file.relative)) {
      addIssue(issues, "P0", "WEAK_JWT_LITERAL", `Weak JWT literal appears outside the explicit denylist/test allowlist: ${file.relative}`);
    }
  }
}

function assertContains(issues, level, code, label, content, needles) {
  for (const needle of needles) {
    if (!content.includes(needle)) {
      addIssue(issues, level, code, `${label} is missing required marker: ${needle}`);
    }
  }
}

export function runSecurityReleaseGate(options = {}) {
  const root = path.resolve(options.repositoryRoot ?? defaultRepositoryRoot);
  const issues = [];
  const smoke = runProductionSmokeCheck({
    envFilePath: options.envFilePath ?? path.join(root, ".env"),
    nginxTemplatePath: options.nginxTemplatePath ?? path.join(root, "deploy/nginx/eventarts-miniapp.conf.template"),
    processEnv: options.processEnv ?? process.env
  });

  for (const issue of smoke.issues) addIssue(issues, "P0", "PRODUCTION_ROUTING", issue);
  scanForbiddenDefaults(root, issues);

  const envExample = readProjectFile(root, ".env.example");
  assertContains(issues, "P0", "ENV_EXAMPLE", ".env.example", envExample, [
    "JWT_SECRET=<generate-a-strong-random-secret-with-at-least-32-characters>",
    "API_HOST=127.0.0.1",
    "ADMIN_HOST=127.0.0.1",
    "BACKUP_DIR=var/backups",
    "WECHAT_MINIAPP_APP_ID=",
    "WECHAT_MINIAPP_APP_SECRET=",
    "WECHAT_AUTH_VERIFIER_MODE=wechat",
    "CLIENT_SESSION_TTL_SECONDS=1800",
    "WECHAT_CODE2SESSION_TIMEOUT_MS=3000"
  ]);

  const seed = readProjectFile(root, "apps/api/src/seed.ts");
  assertContains(issues, "P0", "PRODUCTION_SEED_GUARD", "apps/api/src/seed.ts", seed, [
    "db:seed is disabled in production",
    "NODE_ENV"
  ]);

  const bootstrap = readProjectFile(root, "apps/api/src/admin-bootstrap.ts");
  assertContains(issues, "P0", "ADMIN_BOOTSTRAP", "apps/api/src/admin-bootstrap.ts", bootstrap, [
    "--password-stdin",
    "ADMIN_BOOTSTRAP_ALREADY_EXISTS",
    "strongPasswordSchema"
  ]);

  const config = readProjectFile(root, "apps/api/src/config.ts");
  assertContains(issues, "P0", "API_CONFIG_SECURITY", "apps/api/src/config.ts", config, [
    "knownWeakJwtSecrets",
    "JWT_SECRET",
    "isLoopbackHost",
    "CORS_ALLOWED_ORIGINS",
    "resolveClientAuthConfig",
    "WECHAT_AUTH_VERIFIER_MODE must be 'wechat' in production",
    "WECHAT_MINIAPP_APP_ID is required in production",
    "WECHAT_MINIAPP_APP_SECRET is required in production",
    "CLIENT_SESSION_TTL_SECONDS",
    "WECHAT_CODE2SESSION_TIMEOUT_MS"
  ]);

  const app = readProjectFile(root, "apps/api/src/app.ts");
  assertContains(issues, "P0", "AUTH_RATE_LIMIT_RESTORE", "apps/api/src/app.ts", app, [
    "loginRateLimitPolicy",
    "analyticsRateLimitPolicy",
    "revokeAllAdminSessions",
    "RESTORE_BACKUP",
    "MAINTENANCE_MODE",
    "clientAuthLoginExchangePath",
    "isClientProtectedRequest",
    "verifyClientSessionToken",
    "clientWechatLoginRateLimitKey",
    "clientWechatLoginRequestSchema",
    "clientWechatLoginResponseSchema"
  ]);
  if (app.includes("origin: true")) {
    addIssue(issues, "P0", "CORS_REFLECTION", "apps/api/src/app.ts must not use Fastify CORS origin: true");
  }

  const clientAuth = readProjectFile(root, "apps/api/src/client-auth.ts");
  assertContains(issues, "P0", "CLIENT_AUTH_SERVER", "apps/api/src/client-auth.ts", clientAuth, [
    "clientAuthLoginExchangePath",
    "clientAuthProtectedRoutePrefix",
    "https://api.weixin.qq.com/sns/jscode2session",
    "hashClientSessionToken",
    "hashClientSubject",
    "createClientSession",
    "verifyClientSessionToken",
    "tokenHash",
    "openidHash",
    "session_key"
  ]);

  const sqliteSchema = readProjectFile(root, "apps/api/src/sqlite-schema.ts");
  assertContains(issues, "P0", "CLIENT_AUTH_SQLITE", "apps/api/src/sqlite-schema.ts", sqliteSchema, [
    "CREATE TABLE IF NOT EXISTS client_sessions",
    "tokenHash TEXT NOT NULL UNIQUE",
    "openidHash TEXT NOT NULL",
    "client_sessions_expiresAt_idx",
    "client_sessions_revokedAt_idx"
  ]);

  const sessions = readProjectFile(root, "apps/api/src/admin-sessions.ts");
  assertContains(issues, "P0", "ADMIN_SESSIONS", "apps/api/src/admin-sessions.ts", sessions, [
    "ADMIN_SESSION_TTL_MS = 2 * 60 * 60 * 1000",
    "revokedAt",
    "jti"
  ]);

  const logging = readProjectFile(root, "apps/api/src/logging.ts");
  assertContains(issues, "P1", "SECURITY_LOGGING", "apps/api/src/logging.ts", logging, [
    "apiLogRedactPaths",
    "authorization",
    "password",
    "rawArchive",
    "backupArchive"
  ]);

  const analytics = readProjectFile(root, "apps/api/src/analytics.ts");
  assertContains(issues, "P1", "ANALYTICS_GOVERNANCE", "apps/api/src/analytics.ts", analytics, [
    "sampleRate",
    "retentionDays",
    "dedupeWindowSeconds",
    "cleanup"
  ]);

  const backup = readProjectFile(root, "apps/api/src/backup.ts");
  assertContains(issues, "P1", "BACKUP_RESTORE", "apps/api/src/backup.ts", backup, [
    "VACUUM INTO",
    "activeDatabasePath",
    "restoreInProgress"
  ]);

  const sharedContracts = readProjectFile(root, "packages/shared/src/index.ts");
  assertContains(issues, "P1", "BACKUP_CONTRACTS", "packages/shared/src/index.ts", sharedContracts, [
    "backupDeleteRequestSchema",
    "DELETE_BACKUP",
    "backupRestoreRequestSchema",
    "RESTORE_FULL_BACKUP",
    "clientWechatLoginRequestSchema",
    "clientWechatLoginResponseSchema",
    "ClientProtectedRouteErrorCodeSchema",
    "CLIENT_SESSION_REVOKED"
  ]);

  const miniappApi = readProjectFile(root, "apps/miniapp/src/services/api.ts");
  assertContains(issues, "P1", "MINIAPP_CLIENT_AUTH", "apps/miniapp/src/services/api.ts", miniappApi, [
    "const taroLogin",
    "getGlobalWxLogin",
    "clientAuthExchangePath",
    "Authorization",
    "configureH5ClientLoginCodeAdapter",
    "process.env.NODE_ENV === \"production\"",
    "CLIENT_SESSION_EXPIRED",
    "CLIENT_SESSION_REVOKED"
  ]);

  const deployDoc = readProjectFile(root, "docs/deploy/nginx-production-routing.md");
  assertContains(issues, "P1", "DEPLOY_DOCS", "docs/deploy/nginx-production-routing.md", deployDoc, [
    "admin:bootstrap",
    "analytics:cleanup",
    "RESTORE_FULL_BACKUP",
    "nginx -t",
    "防火墙",
    "异地",
    "WECHAT_MINIAPP_APP_ID",
    "WECHAT_MINIAPP_APP_SECRET",
    "CLIENT_AUTH_REQUIRED",
    "微信 request 合法域名"
  ]);

  const readme = readProjectFile(root, "README.md");
  assertContains(issues, "P1", "README_RELEASE_DOCS", "README.md", readme, [
    "security:release-gate",
    "deploy:smoke",
    "admin:bootstrap",
    "备份与恢复",
    "WECHAT_MINIAPP_APP_ID",
    "生产 `/api/client/**`",
    "wx.login"
  ]);

  const ok = issues.length === 0;
  return {
    ok,
    issues,
    checked: {
      smoke: smoke.checked,
      manualChecks: [
        ...smoke.manualChecks,
        "Verify production TLS certificates, HSTS, and WeChat request-domain settings on the target domain.",
        "Verify a real WeChat Mini Program wx.login -> /api/client/auth/wechat exchange on the target AppID/AppSecret before release.",
        "Verify scheduler execution for analytics cleanup and backup-retention operations.",
        "Verify backup-disk capacity, offsite backup copy, recovery time, and recovery point objectives.",
        "Run a disaster drill on a production-like host before first production release."
      ]
    }
  };
}

function isEntryPoint() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isEntryPoint()) {
  const result = runSecurityReleaseGate();
  if (!result.ok) {
    console.error("Security release gate failed:");
    for (const issue of result.issues) {
      console.error(`- [${issue.level}] ${issue.code}: ${issue.message}`);
    }
    process.exitCode = 1;
  } else {
    console.log("Security release gate passed: automated P0/P1 repository checks are green.");
  }
  console.log("Manual production checks still required:");
  for (const check of result.checked.manualChecks) console.log(`- ${check}`);
}
