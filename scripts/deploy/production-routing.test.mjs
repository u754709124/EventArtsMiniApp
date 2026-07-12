import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractNginxUpstreams, runProductionSmokeCheck } from "./production-smoke-check.mjs";

const nginxTemplatePath = new URL("../../deploy/nginx/eventarts-miniapp.conf.template", import.meta.url);
const viteConfigPath = new URL("../../apps/admin/vite.config.ts", import.meta.url);
const appRoutesPath = new URL("../../apps/admin/src/routes/AppRoutes.tsx", import.meta.url);

async function readText(url) {
  return readFile(url, "utf8");
}

describe("production routing repository contract", () => {
  it("builds admin assets under /admin/ and configures the browser router basename", async () => {
    const viteConfig = await readText(viteConfigPath);
    const appRoutes = await readText(appRoutesPath);

    expect(viteConfig).toContain('base: "/admin/"');
    expect(appRoutes).toContain("basename: ADMIN_BASENAME");
  });

  it("keeps admin, api, and uploads proxy paths intact in the nginx template", async () => {
    const template = await readText(nginxTemplatePath);

    expect(template).toContain("location = /admin");
    expect(template).toContain("return 308 /admin/;");
    expect(template).toMatch(/location \^~ \/admin\/[\s\S]*?proxy_pass http:\/\/eventarts_admin;/);
    expect(template).toMatch(/location \^~ \/api\/[\s\S]*?proxy_pass http:\/\/eventarts_api;/);
    expect(template).toMatch(/location \^~ \/uploads\/[\s\S]*?proxy_pass http:\/\/eventarts_api;/);
    expect(template).not.toContain("proxy_pass http://eventarts_api/");
    expect(template).not.toContain("proxy_pass http://eventarts_admin/");
  });

  it("sets loopback upstreams, proxy headers, upload size, and timeouts", async () => {
    const template = await readText(nginxTemplatePath);

    expect(template).toContain("server 127.0.0.1:4173;");
    expect(template).toContain("server 127.0.0.1:3001;");
    expect(extractNginxUpstreams(template)).toEqual([
      { name: "eventarts_admin", host: "127.0.0.1", port: 4173 },
      { name: "eventarts_api", host: "127.0.0.1", port: 3001 }
    ]);
    for (const header of [
      "proxy_set_header Host $host;",
      "proxy_set_header X-Real-IP $remote_addr;",
      "proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
      "proxy_set_header X-Forwarded-Proto $scheme;",
      "proxy_set_header X-Forwarded-Host $host;",
      "proxy_set_header X-Forwarded-Port $server_port;"
    ]) {
      expect(template).toContain(header);
    }
    expect(template).toContain("client_max_body_size 120m;");
    expect(template).toContain("proxy_connect_timeout 15s;");
    expect(template).toContain("proxy_send_timeout 120s;");
    expect(template).toContain("proxy_read_timeout 120s;");
  });

  it("includes guarded TLS/HSTS placeholders and production security headers", async () => {
    const template = await readText(nginxTemplatePath);

    expect(template).toContain("Do not uncomment these lines with placeholder paths");
    expect(template).toContain("# ssl_certificate /etc/letsencrypt/live/your-domain.example/fullchain.pem;");
    expect(template).toContain("# add_header Strict-Transport-Security");
    expect(template).toContain('add_header X-Content-Type-Options "nosniff" always;');
    expect(template).toContain('add_header X-Frame-Options "DENY" always;');
    expect(template).toContain('add_header Referrer-Policy "strict-origin-when-cross-origin" always;');
    expect(template).toContain('add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;');
    expect(template).toContain("server_tokens off;");
  });

  it("smoke-checks production deployment host and upstream loopback contracts", async () => {
    const result = runProductionSmokeCheck({
      envFilePath: new URL("../../.missing-env-for-smoke-check", import.meta.url),
      nginxTemplatePath,
      processEnv: {
        API_HOST: "127.0.0.1",
        ADMIN_HOST: "localhost"
      }
    });

    expect(result.ok).toBe(true);
    expect(result.checked.hosts).toEqual({
      API_HOST: "127.0.0.1",
      ADMIN_HOST: "localhost"
    });
    expect(result.manualChecks.join("\n")).toContain("firewall/security-group");
  });

  it("fails the smoke-check for public API or Admin hosts", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "eventarts-deploy-smoke-"));
    const envFilePath = join(tempDir, ".env");
    await writeFile(envFilePath, "API_HOST=0.0.0.0\nADMIN_HOST=198.51.100.10\n");

    try {
      const result = runProductionSmokeCheck({
        envFilePath,
        nginxTemplatePath,
        processEnv: {}
      });

      expect(result.ok).toBe(false);
      expect(result.issues).toContain("API_HOST must be loopback for production reverse-proxy deployment; got 0.0.0.0");
      expect(result.issues).toContain("ADMIN_HOST must be loopback for production reverse-proxy deployment; got 198.51.100.10");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
