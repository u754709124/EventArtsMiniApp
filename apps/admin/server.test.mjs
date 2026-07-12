import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AdminServerConfigError,
  defaultAdminHost,
  defaultAdminPort,
  resolveAdminServerConfig,
  resolveAdminStaticRequest
} from "./server.mjs";

let tempDir;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "eventarts-admin-dist-"));
  await mkdir(join(tempDir, "assets"), { recursive: true });
  await writeFile(join(tempDir, "index.html"), '<div id="root"></div><script type="module" src="/admin/assets/app.js"></script>');
  await writeFile(join(tempDir, "assets", "app.js"), "console.log('admin');");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function resolvePath(path) {
  return resolveAdminStaticRequest(path, { distDir: tempDir });
}

describe("admin production static server", () => {
  it("defaults to the loopback production host and port", () => {
    expect(defaultAdminHost).toBe("127.0.0.1");
    expect(defaultAdminPort).toBe(4173);
    expect(resolveAdminServerConfig({})).toEqual({
      env: "development",
      host: "127.0.0.1",
      port: 4173
    });
  });

  it("rejects non-loopback ADMIN_HOST values in production", () => {
    for (const ADMIN_HOST of ["0.0.0.0", "::", "198.51.100.10", "2001:db8::10", "admin.example.com"]) {
      expect(() => resolveAdminServerConfig({
        NODE_ENV: "production",
        ADMIN_HOST,
        ADMIN_PORT: "4173"
      }), ADMIN_HOST).toThrow(AdminServerConfigError);
      expect(() => resolveAdminServerConfig({
        NODE_ENV: "production",
        ADMIN_HOST,
        ADMIN_PORT: "4173"
      }), ADMIN_HOST).toThrow(/ADMIN_HOST must be a loopback address in production/);
    }
  });

  it("accepts loopback ADMIN_HOST values in production", () => {
    for (const ADMIN_HOST of ["127.0.0.1", "127.42.0.9", "localhost", "::1", "0:0:0:0:0:0:0:1"]) {
      expect(resolveAdminServerConfig({
        NODE_ENV: "production",
        ADMIN_HOST,
        ADMIN_PORT: "4173"
      }).host, ADMIN_HOST).toBe(ADMIN_HOST);
    }
  });

  it("rejects invalid ADMIN_PORT values", () => {
    expect(() => resolveAdminServerConfig({ ADMIN_PORT: "0" })).toThrow(/ADMIN_PORT/);
    expect(() => resolveAdminServerConfig({ ADMIN_PORT: "abc" })).toThrow(/ADMIN_PORT/);
    expect(() => resolveAdminServerConfig({ ADMIN_PORT: "4173abc" })).toThrow(/ADMIN_PORT/);
  });

  it("redirects /admin to /admin/", async () => {
    const response = await resolvePath("/admin");
    expect(response.statusCode).toBe(308);
    expect(response.headers.location).toBe("/admin/");
  });

  it("serves /admin/ and existing /admin/assets files", async () => {
    const html = await resolvePath("/admin/");
    expect(html.statusCode).toBe(200);
    expect(html.headers["content-type"]).toContain("text/html");
    expect(await readFile(html.filePath, "utf8")).toContain("/admin/assets/app.js");

    const asset = await resolvePath("/admin/assets/app.js");
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["content-type"]).toContain("text/javascript");
    expect(await readFile(asset.filePath, "utf8")).toContain("admin");
  });

  it("falls back deep admin links to the SPA index", async () => {
    const response = await resolvePath("/admin/detail-pages/new");
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(await readFile(response.filePath, "utf8")).toContain('<div id="root"></div>');
  });

  it("returns 404 for missing static assets and non-admin paths", async () => {
    expect((await resolvePath("/admin/assets/not-found.js")).statusCode).toBe(404);
    expect((await resolvePath("/api/admin/auth/login")).statusCode).toBe(404);
  });
});
