import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AdminRole } from "@event-arts/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resetSuperAdminPassword,
  runAdminPasswordResetCli
} from "../src/admin-password-reset-cli";
import { adminResetTokenRevokeReasons, adminSessionRevokeReasons } from "../src/admin-sessions";
import { createPrismaClient, type AppPrismaClient } from "../src/db";
import { hashPassword, verifyPassword } from "../src/security";
import { ensureDatabaseSchema } from "../src/sqlite-schema";

let root: string;
let uploadDir: string;
let databaseUrl: string;
let prisma: AppPrismaClient;
let clockNow: Date;

async function createAccount(input: { role: AdminRole; status?: "enabled" | "disabled"; username?: string }) {
  const password = `Password-${randomUUID()}-Aa1!`;
  const account = await prisma.adminUser.create({
    data: {
      username: input.username ?? `cli-${input.role.toLowerCase()}-${randomUUID()}`,
      passwordHash: hashPassword(password),
      role: input.role,
      status: input.status ?? "enabled",
      activatedAt: clockNow
    }
  });
  return { account, password };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "event-arts-reset-cli-"));
  uploadDir = path.join(root, "uploads");
  await mkdir(uploadDir, { recursive: true });
  databaseUrl = `file:${path.join(root, "test.db")}`;
  clockNow = new Date("2026-07-19T05:00:00.000Z");
  prisma = createPrismaClient(databaseUrl);
  await ensureDatabaseSchema(prisma, { uploadDir });
});

afterEach(async () => {
  await prisma.$disconnect();
  await rm(root, { recursive: true, force: true });
});

describe("SUPER_ADMIN password reset CLI", () => {
  it("resets only an existing SUPER_ADMIN and revokes sessions and reset tokens", async () => {
    const superAdmin = await createAccount({ role: "SUPER_ADMIN", username: "root-owner" });
    await prisma.adminSession.createMany({
      data: [
        {
          jti: `cli-session-a-${randomUUID()}`,
          adminId: superAdmin.account.id,
          createdAt: clockNow,
          expiresAt: new Date(clockNow.getTime() + 60_000)
        },
        {
          jti: `cli-session-b-${randomUUID()}`,
          adminId: superAdmin.account.id,
          createdAt: clockNow,
          expiresAt: new Date(clockNow.getTime() + 60_000)
        }
      ]
    });
    await prisma.adminPasswordResetToken.create({
      data: {
        adminId: superAdmin.account.id,
        purpose: "recovery",
        tokenHash: createHash("sha256").update(`old-${randomUUID()}`).digest("hex"),
        targetRoleAtIssue: "SUPER_ADMIN",
        expiresAt: new Date(clockNow.getTime() + 30 * 60_000)
      }
    });

    const nextPassword = `CliReset-${randomUUID()}-Aa1!`;
    const result = await resetSuperAdminPassword(prisma, {
      username: "root-owner",
      password: nextPassword,
      now: clockNow
    });
    expect(result).toMatchObject({
      username: "root-owner",
      status: "enabled",
      revokedSessionCount: 2,
      revokedResetTokenCount: 1
    });

    const stored = await prisma.adminUser.findUniqueOrThrow({ where: { id: superAdmin.account.id } });
    expect(stored.role).toBe("SUPER_ADMIN");
    expect(stored.status).toBe("enabled");
    expect(verifyPassword(nextPassword, stored.passwordHash)).toBe(true);
    expect(stored.passwordHash).not.toContain(nextPassword);
    expect(await prisma.adminSession.count({
      where: { adminId: stored.id, revokeReason: adminSessionRevokeReasons.passwordChanged }
    })).toBe(2);
    expect(await prisma.adminPasswordResetToken.count({
      where: { adminId: stored.id, revokeReason: adminResetTokenRevokeReasons.passwordChanged }
    })).toBe(1);
  });

  it("rejects ADMIN and USER targets without creating or changing accounts", async () => {
    const admin = await createAccount({ role: "ADMIN", username: "admin-target" });
    const user = await createAccount({ role: "USER", username: "user-target" });
    const before = await prisma.adminUser.findMany({ orderBy: { id: "asc" } });

    await expect(resetSuperAdminPassword(prisma, {
      username: "admin-target",
      password: `Rejected-${randomUUID()}-Aa1!`,
      now: clockNow
    })).rejects.toMatchObject({ code: "ADMIN_PASSWORD_RESET_CLI_TARGET_NOT_SUPER_ADMIN" });

    await expect(resetSuperAdminPassword(prisma, {
      username: "user-target",
      password: `Rejected-${randomUUID()}-Aa1!`,
      now: clockNow
    })).rejects.toMatchObject({ code: "ADMIN_PASSWORD_RESET_CLI_TARGET_NOT_SUPER_ADMIN" });

    await expect(resetSuperAdminPassword(prisma, {
      username: "missing-super",
      password: `Rejected-${randomUUID()}-Aa1!`,
      now: clockNow
    })).rejects.toMatchObject({ code: "ADMIN_PASSWORD_RESET_CLI_TARGET_NOT_FOUND" });

    expect(await prisma.adminUser.count()).toBe(2);
    await expect(prisma.adminUser.findUniqueOrThrow({ where: { id: admin.account.id } }))
      .resolves.toMatchObject({ passwordHash: before[0].passwordHash, role: "ADMIN" });
    await expect(prisma.adminUser.findUniqueOrThrow({ where: { id: user.account.id } }))
      .resolves.toMatchObject({ passwordHash: before[1].passwordHash, role: "USER" });
  });

  it("does not enable a disabled SUPER_ADMIN while resetting its password", async () => {
    await createAccount({ role: "SUPER_ADMIN", status: "disabled", username: "disabled-root" });
    const nextPassword = `DisabledCli-${randomUUID()}-Aa1!`;

    await resetSuperAdminPassword(prisma, {
      username: "disabled-root",
      password: nextPassword,
      now: clockNow
    });

    const stored = await prisma.adminUser.findUniqueOrThrow({ where: { username: "disabled-root" } });
    expect(stored.status).toBe("disabled");
    expect(verifyPassword(nextPassword, stored.passwordHash)).toBe(true);
  });

  it("requires stdin passwords and never echoes argv passwords, hashes, or secrets", async () => {
    await createAccount({ role: "SUPER_ADMIN", username: "runtime-root" });
    const leakedArg = `ArgSecret-${randomUUID()}-Aa1!`;
    await expect(runAdminPasswordResetCli([
      "--username",
      "runtime-root",
      `--password=${leakedArg}`
    ], {
      config: {
        processEnv: {
          NODE_ENV: "development",
          DATABASE_URL: databaseUrl,
          UPLOAD_DIR: uploadDir,
          PUBLIC_BASE_URL: "http://127.0.0.1:3001"
        }
      },
      readPassword: () => `Ignored-${randomUUID()}-Aa1!`,
      writeOutput: () => undefined,
      now: () => clockNow
    })).rejects.toMatchObject({ code: "ADMIN_PASSWORD_RESET_CLI_USAGE" });

    const nextPassword = `RuntimeCli-${randomUUID()}-Aa1!`;
    const output: string[] = [];
    await runAdminPasswordResetCli(["--username", "runtime-root", "--password-stdin"], {
      config: {
        processEnv: {
          NODE_ENV: "development",
          DATABASE_URL: databaseUrl,
          UPLOAD_DIR: uploadDir,
          PUBLIC_BASE_URL: "http://127.0.0.1:3001"
        }
      },
      readPassword: () => nextPassword,
      writeOutput: (line) => output.push(line),
      now: () => clockNow
    });

    const outputText = output.join("\n");
    const stored = await prisma.adminUser.findUniqueOrThrow({ where: { username: "runtime-root" } });
    expect(verifyPassword(nextPassword, stored.passwordHash)).toBe(true);
    expect(outputText).toContain("Super admin password reset complete: runtime-root");
    expect(outputText).not.toContain(nextPassword);
    expect(outputText).not.toContain(stored.passwordHash);
    expect(outputText).not.toContain(leakedArg);
  });
});
