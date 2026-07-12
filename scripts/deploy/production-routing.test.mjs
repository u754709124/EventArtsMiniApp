import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

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
});
