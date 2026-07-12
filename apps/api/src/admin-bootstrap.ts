import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { strongPasswordSchema } from "@event-arts/shared";
import { loadApiConfig } from "./config";
import { createPrismaClient, type AppPrismaClient } from "./db";
import { hashPassword } from "./security";
import { ensureDatabaseSchema } from "./sqlite-schema";

const usernameSchema = z.string().trim().min(1).max(64);

export class AdminBootstrapError extends Error {
  readonly code:
    | "ADMIN_BOOTSTRAP_INVALID_USERNAME"
    | "ADMIN_BOOTSTRAP_WEAK_PASSWORD"
    | "ADMIN_BOOTSTRAP_ALREADY_EXISTS"
    | "ADMIN_BOOTSTRAP_USAGE";

  constructor(code: AdminBootstrapError["code"], message: string) {
    super(message);
    this.name = "AdminBootstrapError";
    this.code = code;
  }
}

export async function bootstrapAdmin(
  prisma: AppPrismaClient,
  input: { username: string; password: string }
) {
  const parsedUsername = usernameSchema.safeParse(input.username);
  if (!parsedUsername.success) {
    throw new AdminBootstrapError("ADMIN_BOOTSTRAP_INVALID_USERNAME", "管理员用户名必须为 1-64 个字符。");
  }

  const parsedPassword = strongPasswordSchema.safeParse(input.password);
  if (!parsedPassword.success) {
    throw new AdminBootstrapError(
      "ADMIN_BOOTSTRAP_WEAK_PASSWORD",
      parsedPassword.error.issues[0]?.message ?? "管理员密码不符合强度要求。"
    );
  }

  const existingCount = await prisma.adminUser.count();
  if (existingCount > 0) {
    throw new AdminBootstrapError(
      "ADMIN_BOOTSTRAP_ALREADY_EXISTS",
      "管理员已存在；bootstrap 只允许初始化首个管理员，不会覆盖已有凭据。"
    );
  }

  return prisma.adminUser.create({
    data: {
      username: parsedUsername.data,
      passwordHash: hashPassword(parsedPassword.data),
      status: "enabled"
    },
    select: { id: true, username: true, status: true }
  });
}

function parseArgs(args: string[]) {
  let username: string | undefined;
  let passwordStdin = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
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
    throw new AdminBootstrapError("ADMIN_BOOTSTRAP_USAGE", `未知参数：${arg}`);
  }

  if (!username) {
    throw new AdminBootstrapError("ADMIN_BOOTSTRAP_USAGE", "必须显式提供 --username。");
  }
  if (!passwordStdin) {
    throw new AdminBootstrapError("ADMIN_BOOTSTRAP_USAGE", "必须通过 --password-stdin 从标准输入读取管理员密码。");
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

export async function runAdminBootstrapCli(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const password = await readPasswordFromStdin();
  const config = loadApiConfig();
  const prisma = createPrismaClient(config.databaseUrl);
  try {
    await ensureDatabaseSchema(prisma, { uploadDir: config.paths.uploadDir });
    const admin = await bootstrapAdmin(prisma, { username: options.username, password });
    console.log(`Admin bootstrap complete: ${admin.username}`);
  } finally {
    await prisma.$disconnect();
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runAdminBootstrapCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
