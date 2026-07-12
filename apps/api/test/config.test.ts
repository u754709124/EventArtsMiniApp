import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { buildApp } from "../src/app";
import { ConfigValidationError, loadApiConfig } from "../src/config";
import type { createPrismaClient } from "../src/db";
import { startApiServer } from "../src/server";

const strongProductionSecret = "ProdSecret-Aa1!23456789012345678901234567890";
const validWechatAppId = `wx${Array.from({ length: 16 }, (_, index) => "0123456789abcdef"[index]).join("")}`;
const validWechatAppSecret = Array.from(
  { length: 32 },
  (_, index) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[index % 32]
).join("");
const productionWechatEnv = {
  WECHAT_MINIAPP_APP_ID: validWechatAppId,
  WECHAT_MINIAPP_APP_SECRET: validWechatAppSecret,
  WECHAT_AUTH_VERIFIER_MODE: "wechat"
};

async function withTempRepository(envFile: string, test: (root: string) => Promise<void> | void) {
  const root = await mkdtemp(path.join(os.tmpdir(), "event-arts-config-"));
  await writeFile(path.join(root, ".env"), envFile);
  try {
    await test(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("API configuration", () => {
  it("loads the repository root .env and lets process env override file values", async () => {
    await withTempRepository(
      [
        "NODE_ENV=development",
        "API_HOST=127.0.0.1",
        "API_PORT=3001",
        "JWT_SECRET=file-secret-Aa1!2345678901234567890",
        "DATABASE_URL=file:./from-file.db",
        "UPLOAD_DIR=uploads",
        "BACKUP_DIR=var/backups",
        "PUBLIC_BASE_URL=http://127.0.0.1:3001",
        "CORS_ALLOWED_ORIGINS=http://from-file.example"
      ].join("\n"),
      (root) => {
        const config = loadApiConfig({
          repositoryRoot: root,
          processEnv: {
            API_PORT: "4123",
            JWT_SECRET: "process-secret-Aa1!2345678901234567890",
            CORS_ALLOWED_ORIGINS: "http://127.0.0.1:5173"
          }
        });

        expect(config.envFileLoaded).toBe(true);
        expect(config.server.port).toBe(4123);
        expect(config.jwt).toMatchObject({
          source: "environment",
          secret: "process-secret-Aa1!2345678901234567890"
        });
        expect(config.databaseUrl).toBe("file:./from-file.db");
        expect(config.paths.uploadDir).toBe(path.join(root, "uploads"));
        expect(config.paths.backupDir).toBe(path.join(root, "var/backups"));
        expect(config.cors.allowedOrigins).toEqual(["http://127.0.0.1:5173"]);
      }
    );
  });

  it("generates a development-only JWT secret when non-production env omits one", async () => {
    await withTempRepository("", (root) => {
      const config = loadApiConfig({
        repositoryRoot: root,
        processEnv: { NODE_ENV: "test" },
        developmentJwtSecretFactory: () => "generated-development-secret"
      });

      expect(config.env).toBe("test");
      expect(config.jwt).toEqual({
        source: "generated-development",
        secret: "generated-development-secret"
      });
    });
  });

  it("rejects missing, default, and weak JWT secrets in production", async () => {
    await withTempRepository("", (root) => {
      const baseProductionEnv = {
        NODE_ENV: "production",
        API_HOST: "127.0.0.1",
        API_PORT: "3001",
        DATABASE_URL: "file:./prod.db",
        PUBLIC_BASE_URL: "https://api.example.com",
        UPLOAD_DIR: "uploads",
        BACKUP_DIR: "var/backups",
        CORS_ALLOWED_ORIGINS: "https://admin.example.com",
        ...productionWechatEnv
      };

      expect(() => loadApiConfig({ repositoryRoot: root, processEnv: baseProductionEnv })).toThrow(ConfigValidationError);
      expect(() => loadApiConfig({
        repositoryRoot: root,
        processEnv: { ...baseProductionEnv, JWT_SECRET: "dev-secret-change-me" }
      })).toThrow(/weak, a placeholder, or a known default/);
      expect(() => loadApiConfig({
        repositoryRoot: root,
        processEnv: { ...baseProductionEnv, JWT_SECRET: "short" }
      })).toThrow(/weak, a placeholder, or a known default/);
    });
  });

  it("validates production CORS origins and typed security defaults", async () => {
    await withTempRepository("", (root) => {
      const config = loadApiConfig({
        repositoryRoot: root,
        processEnv: {
          NODE_ENV: "production",
          API_HOST: "127.0.0.1",
          API_PORT: "3001",
          DATABASE_URL: "file:./prod.db",
          PUBLIC_BASE_URL: "https://api.example.com",
          UPLOAD_DIR: "uploads",
          BACKUP_DIR: "var/backups",
          JWT_SECRET: strongProductionSecret,
          CORS_ALLOWED_ORIGINS: "https://admin.example.com,https://miniapp.example.com",
          ...productionWechatEnv,
          LOGIN_RATE_LIMIT_WINDOW_MS: "900000",
          LOGIN_RATE_LIMIT_MAX_FAILURES: "5",
          ANALYTICS_RATE_LIMIT_WINDOW_MS: "60000",
          ANALYTICS_RATE_LIMIT_MAX_REQUESTS: "60",
          PAGE_VIEW_SAMPLE_RATE: "0.1",
          PAGE_VIEW_RETENTION_DAYS: "90"
        }
      });

      expect(config.cors.allowedOrigins).toEqual(["https://admin.example.com", "https://miniapp.example.com"]);
      expect(config.clientAuth).toEqual({
        sessionTtlSeconds: 1800,
        wechat: {
          appId: validWechatAppId,
          appSecret: validWechatAppSecret,
          verifierMode: "wechat",
          code2SessionTimeoutMs: 3000
        }
      });
      expect(config.rateLimit.login).toEqual({ windowMs: 900000, maxFailures: 5 });
      expect(config.rateLimit.analytics).toEqual({ windowMs: 60000, maxRequests: 60 });
      expect(config.analytics).toMatchObject({ sampleRate: 0.1, retentionDays: 90 });
    });
  });

  it("fails closed for missing or placeholder WeChat production configuration and fake verifiers", async () => {
    await withTempRepository("", (root) => {
      const productionEnv = {
        NODE_ENV: "production",
        API_HOST: "127.0.0.1",
        API_PORT: "3001",
        DATABASE_URL: "file:./prod.db",
        PUBLIC_BASE_URL: "https://api.example.com",
        UPLOAD_DIR: "uploads",
        BACKUP_DIR: "var/backups",
        JWT_SECRET: strongProductionSecret,
        CORS_ALLOWED_ORIGINS: "https://admin.example.com"
      };

      expect(() => loadApiConfig({
        repositoryRoot: root,
        processEnv: productionEnv
      })).toThrow(/WECHAT_MINIAPP_APP_ID is required in production/);
      expect(() => loadApiConfig({
        repositoryRoot: root,
        processEnv: {
          ...productionEnv,
          WECHAT_MINIAPP_APP_ID: "<set-production-wechat-miniapp-appid>",
          WECHAT_MINIAPP_APP_SECRET: validWechatAppSecret
        }
      })).toThrow(/WECHAT_MINIAPP_APP_ID is a placeholder/);
      expect(() => loadApiConfig({
        repositoryRoot: root,
        processEnv: {
          ...productionEnv,
          WECHAT_MINIAPP_APP_ID: validWechatAppId,
          WECHAT_MINIAPP_APP_SECRET: "<set-production-wechat-miniapp-secret>"
        }
      })).toThrow(/WECHAT_MINIAPP_APP_SECRET is a placeholder/);
      expect(() => loadApiConfig({
        repositoryRoot: root,
        processEnv: {
          ...productionEnv,
          ...productionWechatEnv,
          WECHAT_AUTH_VERIFIER_MODE: "fake"
        }
      })).toThrow(/WECHAT_AUTH_VERIFIER_MODE must be 'wechat' in production/);
    });
  });

  it("allows explicit fake WeChat verifier mode only outside production", async () => {
    await withTempRepository("", (root) => {
      const config = loadApiConfig({
        repositoryRoot: root,
        processEnv: {
          NODE_ENV: "test",
          WECHAT_AUTH_VERIFIER_MODE: "fake",
          WECHAT_MINIAPP_APP_ID: validWechatAppId,
          CLIENT_SESSION_TTL_SECONDS: "900",
          WECHAT_CODE2SESSION_TIMEOUT_MS: "1500"
        }
      });

      expect(config.clientAuth).toMatchObject({
        sessionTtlSeconds: 900,
        wechat: {
          appId: validWechatAppId,
          appSecret: "",
          verifierMode: "fake",
          code2SessionTimeoutMs: 1500
        }
      });
      expect(() => loadApiConfig({
        repositoryRoot: root,
        processEnv: {
          NODE_ENV: "test",
          WECHAT_AUTH_VERIFIER_MODE: "fake"
        }
      })).toThrow(/WECHAT_MINIAPP_APP_ID is required when WECHAT_AUTH_VERIFIER_MODE=fake/);
    });
  });

  it("rejects non-loopback API_HOST values in production", async () => {
    await withTempRepository("", (root) => {
      const productionEnv = {
        NODE_ENV: "production",
        API_PORT: "3001",
        DATABASE_URL: "file:./prod.db",
        PUBLIC_BASE_URL: "https://api.example.com",
        UPLOAD_DIR: "uploads",
        BACKUP_DIR: "var/backups",
        JWT_SECRET: strongProductionSecret,
        CORS_ALLOWED_ORIGINS: "https://admin.example.com",
        ...productionWechatEnv
      };

      for (const API_HOST of ["0.0.0.0", "::", "198.51.100.10", "2001:db8::10", "api.example.com"]) {
        expect(() => loadApiConfig({
          repositoryRoot: root,
          processEnv: { ...productionEnv, API_HOST }
        }), API_HOST).toThrow(/API_HOST must be a loopback address in production/);
      }
    });
  });

  it("accepts loopback API_HOST values in production", async () => {
    await withTempRepository("", (root) => {
      const productionEnv = {
        NODE_ENV: "production",
        API_PORT: "3001",
        DATABASE_URL: "file:./prod.db",
        PUBLIC_BASE_URL: "https://api.example.com",
        UPLOAD_DIR: "uploads",
        BACKUP_DIR: "var/backups",
        JWT_SECRET: strongProductionSecret,
        CORS_ALLOWED_ORIGINS: "https://admin.example.com",
        ...productionWechatEnv
      };

      for (const API_HOST of ["127.0.0.1", "127.42.0.9", "localhost", "::1", "0:0:0:0:0:0:0:1"]) {
        expect(loadApiConfig({
          repositoryRoot: root,
          processEnv: { ...productionEnv, API_HOST }
        }).server.host, API_HOST).toBe(API_HOST);
      }
    });
  });

  it("rejects wildcard or non-HTTPS CORS origins in production", async () => {
    await withTempRepository("", (root) => {
      const productionEnv = {
        NODE_ENV: "production",
        API_HOST: "127.0.0.1",
        API_PORT: "3001",
        DATABASE_URL: "file:./prod.db",
        PUBLIC_BASE_URL: "https://api.example.com",
        UPLOAD_DIR: "uploads",
        BACKUP_DIR: "var/backups",
        JWT_SECRET: strongProductionSecret,
        ...productionWechatEnv
      };

      expect(() => loadApiConfig({
        repositoryRoot: root,
        processEnv: { ...productionEnv, CORS_ALLOWED_ORIGINS: "*" }
      })).toThrow(/cannot include/);
      expect(() => loadApiConfig({
        repositoryRoot: root,
        processEnv: { ...productionEnv, CORS_ALLOWED_ORIGINS: "http://admin.example.com" }
      })).toThrow(/must use https/);
    });
  });

  it("rejects backup directories inside the upload directory", async () => {
    await withTempRepository("", (root) => {
      expect(() => loadApiConfig({
        repositoryRoot: root,
        processEnv: {
          NODE_ENV: "development",
          UPLOAD_DIR: "uploads",
          BACKUP_DIR: "uploads/backups",
          JWT_SECRET: "local-dev-secret"
        }
      })).toThrow(/BACKUP_DIR must not be inside UPLOAD_DIR/);
    });
  });

  it("validates configuration before creating Prisma or building/listening the app", async () => {
    await withTempRepository("", async (root) => {
      const createPrisma = vi.fn();
      const build = vi.fn();

      await expect(startApiServer({
        config: {
          repositoryRoot: root,
          processEnv: {
            NODE_ENV: "production",
            API_HOST: "127.0.0.1",
            API_PORT: "3001",
            DATABASE_URL: "file:./prod.db",
            PUBLIC_BASE_URL: "https://api.example.com",
            UPLOAD_DIR: "uploads",
            BACKUP_DIR: "var/backups",
            CORS_ALLOWED_ORIGINS: "https://admin.example.com",
            ...productionWechatEnv
          }
        },
        createPrisma: createPrisma as unknown as typeof createPrismaClient,
        build: build as unknown as typeof buildApp
      })).rejects.toThrow(ConfigValidationError);

      expect(createPrisma).not.toHaveBeenCalled();
      expect(build).not.toHaveBeenCalled();
    });
  });
});
