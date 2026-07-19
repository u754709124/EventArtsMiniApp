import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runSecurityReleaseGate } from "./security-release-gate.mjs";

const forbiddenDefaultAdminPassword = ["admin", "123456"].join("");
const weakJwtSecret = ["dev-secret", "change-me"].join("-");

describe("security release gate", () => {
  it("passes the repository P0/P1 automated gate", () => {
    const result = runSecurityReleaseGate({
      processEnv: {
        API_HOST: "127.0.0.1",
        ADMIN_HOST: "127.0.0.1"
      }
    });

    expect(result.ok, JSON.stringify(result.issues, null, 2)).toBe(true);
    expect(result.checked.manualChecks.join("\n")).toContain("disaster drill");
    expect(result.checked.manualChecks.join("\n")).toContain("wx.login");
    expect(result.checked.manualChecks.join("\n")).toContain("edgeone:prefetch:reconcile");
  });

  it("fails P0 checks for public bindings and forbidden defaults", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "eventarts-security-gate-"));
    try {
      await mkdir(join(tempDir, "deploy/nginx"), { recursive: true });
      await mkdir(join(tempDir, "apps/api/src"), { recursive: true });
      await writeFile(join(tempDir, ".env"), `API_HOST=0.0.0.0\nADMIN_HOST=127.0.0.1\nJWT_SECRET=${weakJwtSecret}\n`);
      await writeFile(join(tempDir, ".env.example"), `JWT_SECRET=${weakJwtSecret}\n`);
      await writeFile(join(tempDir, "deploy/nginx/eventarts-miniapp.conf.template"), `
upstream eventarts_admin { server 127.0.0.1:4173; }
upstream eventarts_api { server 198.51.100.10:3001; }
`);
      await writeFile(join(tempDir, "apps/api/src/seed.ts"), `const defaultPassword = '${forbiddenDefaultAdminPassword}';\n`);

      const result = runSecurityReleaseGate({
        repositoryRoot: tempDir,
        processEnv: {}
      });

      expect(result.ok).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
        "PRODUCTION_ROUTING",
        "DEFAULT_ADMIN_PASSWORD",
        "DEFAULT_JWT_ENV",
        "WEAK_JWT_LITERAL"
      ]));
      expect(result.issues.some((issue) => issue.level === "P0")).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fails when production reset flows leak a complete link or secret to browser storage", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "eventarts-reset-leak-gate-"));
    try {
      await mkdir(join(tempDir, "apps/admin/src/pages"), { recursive: true });
      await mkdir(join(tempDir, "deploy/nginx"), { recursive: true });
      await writeFile(join(tempDir, ".env"), "API_HOST=127.0.0.1\nADMIN_HOST=127.0.0.1\n");
      await writeFile(join(tempDir, "deploy/nginx/eventarts-miniapp.conf.template"), `
upstream eventarts_admin { server 127.0.0.1:4173; }
upstream eventarts_api { server 127.0.0.1:3001; }
`);
      await writeFile(
        join(tempDir, "apps/admin/src/pages/ResetPasswordPage.tsx"),
        [
          "sessionStorage.setItem('passwordReset', rawToken);",
          "console.log(resetLink);",
          "const leaked = 'https://cms.example/admin/reset-password#token=abcdefghijklmnopqrstuvwxyz123456';"
        ].join("\n")
      );

      const result = runSecurityReleaseGate({
        repositoryRoot: tempDir,
        processEnv: {}
      });
      const codes = result.issues.map((issue) => issue.code);
      expect(codes).toEqual(expect.arrayContaining([
        "RESET_SECRET_CONSOLE_LEAK",
        "RESET_SECRET_STORAGE_LEAK",
        "RESET_URL_LITERAL_LEAK"
      ]));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
