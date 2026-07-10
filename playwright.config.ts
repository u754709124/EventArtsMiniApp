import { defineConfig, devices } from "@playwright/test";

const apiBase = "http://127.0.0.1:3001";
const adminBase = "http://127.0.0.1:5173";
const h5Base = "http://127.0.0.1:10086";

const apiEnv = {
  ...process.env,
  API_PORT: "3001",
  DATABASE_URL: "file:./dev.db",
  JWT_SECRET: "dev-secret-change-me",
  PUBLIC_BASE_URL: apiBase,
  UPLOAD_DIR: "../../uploads"
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
      command: "pnpm db:push && pnpm db:seed && pnpm dev:api",
      url: `${apiBase}/api/client/home`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: apiEnv
    },
    {
      command: "pnpm dev:admin",
      url: `${adminBase}/login`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
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
