import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  AdminPasswordResetPurposeSchema,
  adminPasswordResetPolicy,
  passwordPolicy,
  strongPasswordSchema,
  type AdminPasswordResetPurpose,
  type AdminRole
} from "@event-arts/shared";
import {
  adminResetTokenRevokeReasons,
  adminSessionRevokeReasons,
  revokeAdminResetTokensForAdmin,
  revokeAdminSessionsForAdmin
} from "./admin-sessions";
import type { AppPrismaClient } from "./db";
import { hashPassword, verifyPassword } from "./security";

export const adminPasswordResetLinkRequestSchema = z.object({
  purpose: AdminPasswordResetPurposeSchema.default("recovery"),
  currentPassword: z.string().min(1).max(passwordPolicy.maxLength),
  confirmation: z.literal(true)
}).strict();

export const adminPasswordResetLinksRevokeRequestSchema = z.object({
  purpose: AdminPasswordResetPurposeSchema.optional(),
  currentPassword: z.string().min(1).max(passwordPolicy.maxLength),
  confirmation: z.literal(true)
}).strict();

export const adminPasswordResetConsumeRequestSchema = z
  .object({
    token: z.string().min(43).max(128).regex(/^[A-Za-z0-9_-]+$/),
    newPassword: strongPasswordSchema,
    confirmPassword: z.string().min(1).max(passwordPolicy.maxLength)
  })
  .strict()
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "两次输入的新密码不一致"
  });

export type AdminPasswordResetLinkRequest = z.infer<typeof adminPasswordResetLinkRequestSchema>;
export type AdminPasswordResetLinksRevokeRequest =
  z.infer<typeof adminPasswordResetLinksRevokeRequestSchema>;
export type AdminPasswordResetConsumeRequest = z.infer<typeof adminPasswordResetConsumeRequestSchema>;

type AdminPasswordResetClient = AppPrismaClient | Prisma.TransactionClient;

type AdminPasswordResetActor = {
  id: number;
  publicId: string;
  username: string;
  role: string;
  status: string;
  passwordHash: string;
};

export class AdminPasswordResetError extends Error {
  constructor(
    readonly code:
      | "ADMIN_PASSWORD_RESET_FORBIDDEN"
      | "ADMIN_PASSWORD_RESET_INVALID_CREDENTIALS"
      | "ADMIN_PASSWORD_RESET_TARGET_NOT_FOUND"
      | "ADMIN_PASSWORD_RESET_INVALID_REQUEST"
      | "PASSWORD_RESET_TOKEN_INVALID",
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = "AdminPasswordResetError";
  }
}

export function hashAdminPasswordResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function generateAdminPasswordResetToken() {
  const token = randomBytes(adminPasswordResetPolicy.tokenBytes).toString("base64url");
  return { token, tokenHash: hashAdminPasswordResetToken(token) };
}

export function normalizeAdminPasswordResetTtlMinutes(value: number | undefined) {
  const candidate = value ?? adminPasswordResetPolicy.defaultTtlMinutes;
  return Math.min(
    adminPasswordResetPolicy.maxTtlMinutes,
    Math.max(adminPasswordResetPolicy.minTtlMinutes, candidate)
  );
}

export function adminPasswordResetLink(publicBaseUrl: string, token: string) {
  return `${publicBaseUrl.replace(/\/+$/, "")}/admin/reset-password#token=${encodeURIComponent(token)}`;
}

export function canIssueAdminPasswordResetLink(issuerRole: AdminRole, targetRole: AdminRole) {
  if (targetRole === "SUPER_ADMIN") return false;
  if (issuerRole === "SUPER_ADMIN") return targetRole === "ADMIN" || targetRole === "USER";
  if (issuerRole === "ADMIN") return targetRole === "USER";
  return false;
}

export async function issueAdminPasswordResetLink(
  prisma: AppPrismaClient,
  input: {
    issuerId: number;
    targetPublicId: string;
    purpose: AdminPasswordResetPurpose;
    currentPassword: string;
    now: Date;
    publicBaseUrl: string;
    tokenTtlMinutes?: number;
  }
) {
  return prisma.$transaction(async (tx) => {
    const issuer = await requireEnabledIssuer(tx, input.issuerId);
    assertCurrentPassword(issuer, input.currentPassword);

    const target = await tx.adminUser.findUnique({ where: { publicId: input.targetPublicId } });
    if (!target) {
      throw new AdminPasswordResetError(
        "ADMIN_PASSWORD_RESET_TARGET_NOT_FOUND",
        "后台账户不存在",
        404
      );
    }

    const result = await issueAdminPasswordResetLinkInTransaction(tx, {
      issuer,
      target,
      purpose: input.purpose,
      now: input.now,
      publicBaseUrl: input.publicBaseUrl,
      tokenTtlMinutes: input.tokenTtlMinutes
    });
    await tx.operationLog.create({
      data: {
        action: "ADMIN_PASSWORD_RESET_LINK_CREATED",
        createdBy: issuer.id,
        detail: JSON.stringify({
          purpose: result.purpose,
          issuerPublicId: issuer.publicId,
          targetPublicId: target.publicId,
          targetRole: target.role,
          revokedSessionCount: result.revokedSessionCount,
          revokedResetTokenCount: result.revokedResetTokenCount
        })
      }
    });
    return result;
  });
}

export async function issueAdminPasswordResetLinkInTransaction(
  prisma: AdminPasswordResetClient,
  input: {
    issuer: AdminPasswordResetActor;
    target: AdminPasswordResetActor;
    purpose: AdminPasswordResetPurpose;
    now: Date;
    publicBaseUrl: string;
    tokenTtlMinutes?: number;
  }
) {
  assertIssuerCanIssueLink(input.issuer, input.target, input.purpose);

  const revokedSessions = await revokeAdminSessionsForAdmin(prisma, {
    adminId: input.target.id,
    reason: adminSessionRevokeReasons.passwordChanged,
    now: input.now
  });
  const revokedResetTokens = await revokeAdminResetTokensForAdmin(prisma, {
    adminId: input.target.id,
    reason: adminResetTokenRevokeReasons.newTokenIssued,
    now: input.now
  });
  const { token, tokenHash } = generateAdminPasswordResetToken();
  const ttlMinutes = normalizeAdminPasswordResetTtlMinutes(input.tokenTtlMinutes);
  const expiresAt = new Date(input.now.getTime() + ttlMinutes * 60_000);
  await prisma.adminPasswordResetToken.create({
    data: {
      adminId: input.target.id,
      purpose: input.purpose,
      tokenHash,
      createdBy: input.issuer.id,
      targetRoleAtIssue: input.target.role,
      createdAt: input.now,
      expiresAt
    }
  });
  return {
    purpose: input.purpose,
    resetLink: adminPasswordResetLink(input.publicBaseUrl, token),
    expiresAt: expiresAt.toISOString(),
    revokedSessionCount: revokedSessions.count,
    revokedResetTokenCount: revokedResetTokens.count
  };
}

export async function revokeAdminPasswordResetLinks(
  prisma: AppPrismaClient,
  input: {
    issuerId: number;
    targetPublicId: string;
    purpose?: AdminPasswordResetPurpose;
    currentPassword: string;
    now: Date;
  }
) {
  return prisma.$transaction(async (tx) => {
    const issuer = await requireEnabledIssuer(tx, input.issuerId);
    assertCurrentPassword(issuer, input.currentPassword);
    const target = await tx.adminUser.findUnique({ where: { publicId: input.targetPublicId } });
    if (!target) {
      throw new AdminPasswordResetError(
        "ADMIN_PASSWORD_RESET_TARGET_NOT_FOUND",
        "后台账户不存在",
        404
      );
    }
    assertIssuerCanIssueLink(issuer, target, input.purpose ?? "recovery");
    const revoked = await tx.adminPasswordResetToken.updateMany({
      where: {
        adminId: target.id,
        usedAt: null,
        revokedAt: null,
        ...(input.purpose ? { purpose: input.purpose } : {})
      },
      data: {
        revokedAt: input.now,
        revokeReason: adminResetTokenRevokeReasons.newTokenIssued
      }
    });
    await tx.operationLog.create({
      data: {
        action: "ADMIN_PASSWORD_RESET_LINKS_REVOKED",
        createdBy: issuer.id,
        detail: JSON.stringify({
          issuerPublicId: issuer.publicId,
          targetPublicId: target.publicId,
          targetRole: target.role,
          purpose: input.purpose ?? null,
          revokedResetTokenCount: revoked.count
        })
      }
    });
    return { revokedResetTokenCount: revoked.count };
  });
}

export async function consumeAdminPasswordResetLink(
  prisma: AppPrismaClient,
  input: AdminPasswordResetConsumeRequest & { now: Date }
) {
  const tokenHash = hashAdminPasswordResetToken(input.token);
  return prisma.$transaction(async (tx) => {
    const tokenRow = await tx.adminPasswordResetToken.findUnique({
      where: { tokenHash },
      include: { admin: true, creator: true }
    });
    if (!tokenRow) throw invalidPublicTokenError();
    if (tokenRow.usedAt || tokenRow.revokedAt || tokenRow.expiresAt.getTime() <= input.now.getTime()) {
      throw invalidPublicTokenError();
    }

    const purpose = AdminPasswordResetPurposeSchema.safeParse(tokenRow.purpose);
    if (!purpose.success) throw invalidPublicTokenError();
    if (tokenRow.admin.role === "SUPER_ADMIN") throw invalidPublicTokenError();
    if (tokenRow.admin.role !== tokenRow.targetRoleAtIssue) throw invalidPublicTokenError();
    if (!tokenRow.creator || tokenRow.creator.status !== "enabled") throw invalidPublicTokenError();
    if (!canIssueRolePair(tokenRow.creator.role, tokenRow.admin.role)) throw invalidPublicTokenError();

    const requiredStatus = purpose.data === "activation" ? "pending_activation" : "enabled";
    if (tokenRow.admin.status !== requiredStatus) throw invalidPublicTokenError();

    const marked = await tx.adminPasswordResetToken.updateMany({
      where: {
        id: tokenRow.id,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: input.now },
        targetRoleAtIssue: tokenRow.admin.role
      },
      data: { usedAt: input.now }
    });
    if (marked.count !== 1) throw invalidPublicTokenError();

    const updated = await tx.adminUser.updateMany({
      where: {
        id: tokenRow.adminId,
        role: tokenRow.admin.role,
        status: requiredStatus
      },
      data: {
        passwordHash: hashPassword(input.newPassword),
        ...(purpose.data === "activation" ? { status: "enabled", activatedAt: input.now } : {})
      }
    });
    if (updated.count !== 1) throw invalidPublicTokenError();

    const revokedSessions = await revokeAdminSessionsForAdmin(tx, {
      adminId: tokenRow.adminId,
      reason: adminSessionRevokeReasons.passwordChanged,
      now: input.now
    });
    const revokedResetTokens = await revokeAdminResetTokensForAdmin(tx, {
      adminId: tokenRow.adminId,
      reason: adminResetTokenRevokeReasons.consumed,
      now: input.now
    });
    await tx.operationLog.create({
      data: {
        action: "ADMIN_PASSWORD_RESET_LINK_CONSUMED",
        detail: JSON.stringify({
          purpose: purpose.data,
          targetPublicId: tokenRow.admin.publicId,
          targetRole: tokenRow.admin.role,
          revokedSessionCount: revokedSessions.count,
          revokedResetTokenCount: revokedResetTokens.count
        })
      }
    });
    return {
      purpose: purpose.data,
      revokedSessionCount: revokedSessions.count,
      revokedResetTokenCount: revokedResetTokens.count
    };
  });
}

async function requireEnabledIssuer(prisma: AdminPasswordResetClient, issuerId: number) {
  const issuer = await prisma.adminUser.findFirst({ where: { id: issuerId, status: "enabled" } });
  if (!issuer) {
    throw new AdminPasswordResetError(
      "ADMIN_PASSWORD_RESET_INVALID_CREDENTIALS",
      "当前密码错误",
      401
    );
  }
  return issuer;
}

function assertCurrentPassword(issuer: AdminPasswordResetActor, currentPassword: string) {
  if (!verifyPassword(currentPassword, issuer.passwordHash)) {
    throw new AdminPasswordResetError(
      "ADMIN_PASSWORD_RESET_INVALID_CREDENTIALS",
      "当前密码错误",
      401
    );
  }
}

function assertIssuerCanIssueLink(
  issuer: AdminPasswordResetActor,
  target: AdminPasswordResetActor,
  purpose: AdminPasswordResetPurpose
) {
  if (issuer.id === target.id || !canIssueRolePair(issuer.role, target.role)) {
    throw new AdminPasswordResetError(
      "ADMIN_PASSWORD_RESET_FORBIDDEN",
      "无权为该账户生成重置链接",
      403
    );
  }
  if (purpose === "activation" && target.status !== "pending_activation") {
    throw new AdminPasswordResetError(
      "ADMIN_PASSWORD_RESET_INVALID_REQUEST",
      "该账户不处于待激活状态",
      400
    );
  }
  if (purpose === "recovery" && target.status !== "enabled") {
    throw new AdminPasswordResetError(
      "ADMIN_PASSWORD_RESET_INVALID_REQUEST",
      "该账户当前不能生成恢复链接",
      400
    );
  }
}

function canIssueRolePair(issuerRole: string, targetRole: string) {
  const parsedIssuer = parseRole(issuerRole);
  const parsedTarget = parseRole(targetRole);
  return parsedIssuer && parsedTarget
    ? canIssueAdminPasswordResetLink(parsedIssuer, parsedTarget)
    : false;
}

function parseRole(role: string): AdminRole | null {
  if (role === "SUPER_ADMIN" || role === "ADMIN" || role === "USER") return role;
  return null;
}

function invalidPublicTokenError() {
  return new AdminPasswordResetError(
    "PASSWORD_RESET_TOKEN_INVALID",
    "重置链接无效或已失效",
    400
  );
}
