import { randomUUID } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

const apiBase = "http://127.0.0.1:3001";
const adminBase = "http://127.0.0.1:5173";
const h5Base = "http://127.0.0.1:10086";
const e2eAdminUsername = process.env.E2E_ADMIN_USERNAME ?? `e2e-admin-${process.pid}`;
const e2eAdminPassword = process.env.E2E_ADMIN_PASSWORD ?? `E2e-${randomUUID()}-Aa1!`;

process.env.E2E_ADMIN_USERNAME = e2eAdminUsername;
process.env.E2E_ADMIN_PASSWORD = e2eAdminPassword;

const apiEnv = {
  ...process.env,
  NODE_ENV: "test",
  API_HOST: "127.0.0.1",
  API_PORT: "3001",
  DATABASE_URL: `file:../.tmp/e2e-${process.pid}.db`,
  JWT_SECRET: "dev-secret-change-me",
  CORS_ALLOWED_ORIGINS: [adminBase, h5Base].join(","),
  PUBLIC_BASE_URL: apiBase,
  UPLOAD_DIR: "../../uploads",
  WECHAT_MINIAPP_APP_ID: "wx0000000000000000",
  WECHAT_AUTH_VERIFIER_MODE: "fake",
  E2E_ADMIN_USERNAME: e2eAdminUsername,
  E2E_ADMIN_PASSWORD: e2eAdminPassword
};

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: [
    {
      command: "mkdir -p apps/api/.tmp && pnpm db:push && pnpm db:seed && node -e \"process.stdout.write(process.env.E2E_ADMIN_PASSWORD + '\\n')\" | pnpm admin:bootstrap -- --username \"$E2E_ADMIN_USERNAME\" --password-stdin && pnpm dev:api",
      url: `${apiBase}/api/client/home`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: apiEnv
    },
    {
      command: "pnpm dev:admin",
      url: `${adminBase}/admin/login`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        NODE_ENV: "test",
        VITE_API_BASE_URL: ""
      }
    },
    {
      command: "pnpm dev:h5",
      url: h5Base,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        NODE_ENV: "test",
        TARO_APP_API_BASE_URL: apiBase
      }
    }
  ],
  projects: [
    {
      name: "admin",
      testMatch: /admin\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: adminBase
      }
    },
    {
      name: "miniapp-h5",
      testMatch: /miniapp-h5\.spec\.ts/,
      use: {
        ...devices["Pixel 7"],
        baseURL: h5Base,
        viewport: { width: 427, height: 922 },
        deviceScaleFactor: 2,
        isMobile: true
      }
    }
  ]
});
