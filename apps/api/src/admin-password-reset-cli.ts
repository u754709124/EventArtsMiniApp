import path from "node:path";
import { fileURLToPath } from "node:url";
import { strongPasswordSchema } from "@event-arts/shared";
import {
  adminResetTokenRevokeReasons,
  adminSessionRevokeReasons,
  revokeAdminSecurityCredentialsForAdmin
} from "./admin-sessions";
import { loadApiConfig, type LoadApiConfigOptions } from "./config";
import { createPrismaClient, type AppPrismaClient } from "./db";
import { hashPassword } from "./security";
import { ensureDatabaseSchema } from "./sqlite-schema";

export class AdminPasswordResetCliError extends Error {
  constructor(
    readonly code:
      | "ADMIN_PASSWORD_RESET_CLI_USAGE"
      | "ADMIN_PASSWORD_RESET_CLI_WEAK_PASSWORD"
      | "ADMIN_PASSWORD_RESET_CLI_TARGET_NOT_FOUND"
      | "ADMIN_PASSWORD_RESET_CLI_TARGET_NOT_SUPER_ADMIN",
    message: string
  ) {
    super(message);
    this.name = "AdminPasswordResetCliError";
  }
}

export async function resetSuperAdminPassword(
  prisma: AppPrismaClient,
  input: { username: string; password: string; now: Date }
) {
  const parsedPassword = strongPasswordSchema.safeParse(input.password);
  if (!parsedPassword.success) {
    throw new AdminPasswordResetCliError(
      "ADMIN_PASSWORD_RESET_CLI_WEAK_PASSWORD",
      parsedPassword.error.issues[0]?.message ?? "超级管理员密码不符合强度要求。"
    );
  }

  return prisma.$transaction(async (tx) => {
    const admin = await tx.adminUser.findUnique({ where: { username: input.username } });
    if (!admin) {
      throw new AdminPasswordResetCliError(
        "ADMIN_PASSWORD_RESET_CLI_TARGET_NOT_FOUND",
        "目标超级管理员不存在。"
      );
    }
    if (admin.role !== "SUPER_ADMIN") {
      throw new AdminPasswordResetCliError(
        "ADMIN_PASSWORD_RESET_CLI_TARGET_NOT_SUPER_ADMIN",
        "CLI 只能重置既有超级管理员密码。"
      );
    }

    await tx.adminUser.update({
      where: { id: admin.id },
      data: { passwordHash: hashPassword(parsedPassword.data) }
    });
    const revoked = await revokeAdminSecurityCredentialsForAdmin(tx, {
      adminId: admin.id,
      sessionReason: adminSessionRevokeReasons.passwordChanged,
      resetTokenReason: adminResetTokenRevokeReasons.passwordChanged,
      now: input.now
    });
    await tx.operationLog.create({
      data: {
        action: "ADMIN_PASSWORD_RESET_CLI",
        detail: JSON.stringify({
          targetPublicId: admin.publicId,
          targetRole: admin.role,
          targetStatus: admin.status,
          revokedSessionCount: revoked.revokedSessionCount,
          revokedResetTokenCount: revoked.revokedResetTokenCount
        })
      }
    });
    return {
      username: admin.username,
      status: admin.status,
      revokedSessionCount: revoked.revokedSessionCount,
      revokedResetTokenCount: revoked.revokedResetTokenCount
    };
  });
}

function parseArgs(args: string[]) {
  let username: string | undefined;
  let passwordStdin = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--username") {
      username = args[index + 1];
      index += 1;
      continue;
    }
    if (arg?.startsWith("--username=")) {
      username = arg.slice("--username=".length);
      continue;
    }
    if (arg === "--password-stdin") {
      passwordStdin = true;
      continue;
    }
    if (arg === "--password" || arg?.startsWith("--password=")) {
      throw new AdminPasswordResetCliError(
        "ADMIN_PASSWORD_RESET_CLI_USAGE",
        "不得通过 argv 提供密码；必须使用 --password-stdin。"
      );
    }
    throw new AdminPasswordResetCliError(
      "ADMIN_PASSWORD_RESET_CLI_USAGE",
      "未知参数；用法：--username <super-admin-name> --password-stdin。"
    );
  }

  if (!username) {
    throw new AdminPasswordResetCliError(
      "ADMIN_PASSWORD_RESET_CLI_USAGE",
      "必须显式提供 --username。"
    );
  }
  if (!passwordStdin) {
    throw new AdminPasswordResetCliError(
      "ADMIN_PASSWORD_RESET_CLI_USAGE",
      "必须通过 --password-stdin 从标准输入读取超级管理员密码。"
    );
  }
  return { username };
}

async function readPasswordFromStdin() {
  let password = "";
  for await (const chunk of process.stdin) {
    password += String(chunk);
  }
  return password.replace(/\r?\n$/, "");
}

type AdminPasswordResetCliRuntimeOptions = {
  config?: LoadApiConfigOptions;
  now?: () => Date;
  readPassword?: () => string | Promise<string>;
  writeOutput?: (line: string) => void;
};

export async function runAdminPasswordResetCli(
  args = process.argv.slice(2),
  runtimeOptions: AdminPasswordResetCliRuntimeOptions = {}
) {
  const options = parseArgs(args);
  const password = await (runtimeOptions.readPassword ?? readPasswordFromStdin)();
  const config = loadApiConfig(runtimeOptions.config);
  const prisma = createPrismaClient(config.databaseUrl);
  try {
    await ensureDatabaseSchema(prisma, { uploadDir: config.paths.uploadDir });
    const result = await resetSuperAdminPassword(prisma, {
      username: options.username,
      password,
      now: runtimeOptions.now?.() ?? new Date()
    });
    const line =
      `Super admin password reset complete: ${result.username}; ` +
      `revokedSessions=${result.revokedSessionCount}; ` +
      `revokedResetTokens=${result.revokedResetTokenCount}`;
    (runtimeOptions.writeOutput ?? console.log)(line);
    return result;
  } finally {
    await prisma.$disconnect();
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runAdminPasswordResetCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
