import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  AdminAccountStatusSchema,
  AdminRoleSchema,
  adminAuthIdentityDtoSchema,
  adminDelegableMenuKeys,
  adminEffectiveMenuKeys,
  adminGrantableMenuKeyValues,
  expandAdminMenuSelection,
  isAdminGrantableMenuKey,
  isAdminMenuGroupKey,
  passwordPolicy,
  type AdminGrantableMenuKey,
  type AdminRole,
  type AdminUserDto
} from "@event-arts/shared";
import { adminAuthIdentityForAdmin } from "./admin-authorization";
import {
  adminResetTokenRevokeReasons,
  adminSessionRevokeReasons,
  revokeAdminSecurityCredentialsForAdmin
} from "./admin-sessions";
import {
  issueAdminPasswordResetLinkInTransaction
} from "./admin-password-reset";
import type { AppPrismaClient } from "./db";
import { hashPassword, verifyPassword } from "./security";

const adminUsernameInputSchema = z.string().trim().min(1).max(64);
const grantableMenuSelectionSchema = z.string().min(1).max(96);

export const adminUserPublicIdParamSchema = z.string().uuid();

export const adminUserCreateRequestSchema = z.object({
  username: adminUsernameInputSchema,
  role: AdminRoleSchema,
  permissions: z.array(grantableMenuSelectionSchema).max(64).default([]),
  currentPassword: z.string().min(1).max(passwordPolicy.maxLength),
  confirmation: z.literal(true)
}).strict();

export const adminUserUpdateRequestSchema = z.object({
  username: adminUsernameInputSchema.optional(),
  role: AdminRoleSchema.optional(),
  status: z.enum(["enabled", "disabled"]).optional(),
  currentPassword: z.string().min(1).max(passwordPolicy.maxLength).optional(),
  confirmation: z.literal(true).optional()
}).strict().refine(
  (value) => value.username !== undefined || value.role !== undefined || value.status !== undefined,
  "至少需要提交一个账户字段"
);

export const adminUserPermissionsUpdateRequestSchema = z.object({
  permissions: z.array(grantableMenuSelectionSchema).max(64),
  confirmation: z.literal(true).optional()
}).strict();

export type AdminUserCreateRequest = z.infer<typeof adminUserCreateRequestSchema>;
export type AdminUserUpdateRequest = z.infer<typeof adminUserUpdateRequestSchema>;
export type AdminUserPermissionsUpdateRequest =
  z.infer<typeof adminUserPermissionsUpdateRequestSchema>;

type AdminUserClient = AppPrismaClient | Prisma.TransactionClient;
type AdminAccountRecord = {
  id: number;
  publicId: string;
  username: string;
  passwordHash: string;
  role: string;
  status: string;
  activatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  menuPermissions: Array<{ menuKey: string }>;
};

export class AdminUserError extends Error {
  constructor(
    readonly code:
      | "ADMIN_USER_FORBIDDEN"
      | "ADMIN_USER_NOT_FOUND"
      | "ADMIN_USER_INVALID_REQUEST"
      | "ADMIN_USER_USERNAME_TAKEN"
      | "ADMIN_USER_LAST_SUPER_ADMIN"
      | "ADMIN_USER_INVALID_CREDENTIALS",
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = "AdminUserError";
  }
}

export async function listAdminUsers(prisma: AppPrismaClient, issuerId: number) {
  const issuer = await requireEnabledIssuer(prisma, issuerId);
  const issuerRole = parseRole(issuer.role);
  const where = issuerRole === "SUPER_ADMIN" ? {} : { role: "USER" };
  const users = await prisma.adminUser.findMany({
    where,
    include: { menuPermissions: true },
    orderBy: [{ role: "asc" }, { username: "asc" }, { id: "asc" }]
  });
  return { items: users.map(serializeAdminUser), total: users.length };
}

export async function getAdminUser(prisma: AppPrismaClient, issuerId: number, targetPublicId: string) {
  const { issuer, target } = await loadIssuerAndTarget(prisma, issuerId, targetPublicId);
  assertCanReadTarget(issuer, target);
  return serializeAdminUser(target);
}

export async function createAdminUser(
  prisma: AppPrismaClient,
  input: {
    issuerId: number;
    data: AdminUserCreateRequest;
    now: Date;
    publicBaseUrl: string;
    tokenTtlMinutes?: number;
  }
) {
  return prisma.$transaction(async (tx) => {
    const issuer = await requireEnabledIssuer(tx, input.issuerId);
    assertCurrentPassword(issuer, input.data.currentPassword);
    const role = parseRole(input.data.role);
    if (role === "SUPER_ADMIN") {
      throw new AdminUserError(
        "ADMIN_USER_FORBIDDEN",
        "不能通过一次性链接创建超级管理员",
        403
      );
    }
    assertCanCreateRole(issuer, role);
    const permissions = normalizeAssignablePermissions(issuer, role, input.data.permissions);

    let created: AdminAccountRecord;
    try {
      created = await tx.adminUser.create({
        data: {
          username: input.data.username,
          passwordHash: hashPassword(randomBytes(32).toString("base64url")),
          role,
          status: "pending_activation",
          activatedAt: null,
          menuPermissions: {
            create: permissions.map((menuKey) => ({
              menuKey,
              grantedBy: issuer.id
            }))
          }
        },
        include: { menuPermissions: true }
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        throw new AdminUserError(
          "ADMIN_USER_USERNAME_TAKEN",
          "后台账户用户名已存在",
          409
        );
      }
      throw error;
    }

    const activation = await issueAdminPasswordResetLinkInTransaction(tx, {
      issuer,
      target: created,
      purpose: "activation",
      now: input.now,
      publicBaseUrl: input.publicBaseUrl,
      tokenTtlMinutes: input.tokenTtlMinutes
    });
    await tx.operationLog.create({
      data: {
        action: "ADMIN_USER_CREATED",
        createdBy: issuer.id,
        detail: JSON.stringify({
          issuerPublicId: issuer.publicId,
          targetPublicId: created.publicId,
          targetRole: created.role,
          permissionCount: permissions.length,
          activationExpiresAt: activation.expiresAt
        })
      }
    });
    return {
      user: serializeAdminUser(created),
      activationLink: activation.resetLink,
      expiresAt: activation.expiresAt,
      revokedSessionCount: activation.revokedSessionCount,
      revokedResetTokenCount: activation.revokedResetTokenCount
    };
  });
}

export async function updateAdminUser(
  prisma: AppPrismaClient,
  input: {
    issuerId: number;
    targetPublicId: string;
    data: AdminUserUpdateRequest;
    now: Date;
  }
) {
  return prisma.$transaction(async (tx) => {
    const { issuer, target } = await loadIssuerAndTarget(tx, input.issuerId, input.targetPublicId);
    const nextRole = input.data.role ? parseRole(input.data.role) : parseRole(target.role);
    const nextStatus = input.data.status === undefined
      ? target.status as "pending_activation" | "enabled" | "disabled"
      : parseAccountStatus(input.data.status);
    assertCanManageTarget(issuer, target, nextRole);
    assertValidRoleStatusTransition(target, nextRole, nextStatus);
    if (requiresSuperAdminReauthentication(target, nextRole)) {
      assertCurrentPassword(issuer, input.data.currentPassword);
      if (input.data.confirmation !== true) {
        throw new AdminUserError(
          "ADMIN_USER_INVALID_REQUEST",
          "高风险账户变更需要显式确认",
          400
        );
      }
    }

    const roleChanged = nextRole !== target.role;
    const statusChanged = nextStatus !== target.status;
    const updated = await updateAdminAccountFields(tx, {
      target,
      username: input.data.username,
      nextRole,
      nextStatus,
      roleChanged,
      statusChanged,
      now: input.now
    });
    let revokedSessionCount = 0;
    let revokedResetTokenCount = 0;
    if (roleChanged || statusChanged) {
      const revoked = await revokeAdminSecurityCredentialsForAdmin(tx, {
        adminId: target.id,
        sessionReason: roleChanged
          ? adminSessionRevokeReasons.roleChanged
          : adminSessionRevokeReasons.statusChanged,
        resetTokenReason: roleChanged
          ? adminResetTokenRevokeReasons.roleChanged
          : adminResetTokenRevokeReasons.statusChanged,
        now: input.now
      });
      revokedSessionCount = revoked.revokedSessionCount;
      revokedResetTokenCount = revoked.revokedResetTokenCount;
    }

    if (roleChanged && nextRole === "SUPER_ADMIN") {
      await tx.adminMenuPermission.deleteMany({ where: { adminId: target.id } });
      updated.menuPermissions = [];
    }
    await tx.operationLog.create({
      data: {
        action: "ADMIN_USER_UPDATED",
        createdBy: issuer.id,
        detail: JSON.stringify({
          issuerPublicId: issuer.publicId,
          targetPublicId: target.publicId,
          previousRole: target.role,
          nextRole,
          previousStatus: target.status,
          nextStatus,
          usernameChanged: input.data.username !== undefined && input.data.username !== target.username,
          revokedSessionCount,
          revokedResetTokenCount
        })
      }
    });
    return {
      user: serializeAdminUser(updated),
      revokedSessionCount,
      revokedResetTokenCount
    };
  });
}

export async function updateAdminUserPermissions(
  prisma: AppPrismaClient,
  input: {
    issuerId: number;
    targetPublicId: string;
    data: AdminUserPermissionsUpdateRequest;
    now: Date;
  }
) {
  return prisma.$transaction(async (tx) => {
    const { issuer, target } = await loadIssuerAndTarget(tx, input.issuerId, input.targetPublicId);
    const targetRole = parseRole(target.role);
    if (targetRole === "SUPER_ADMIN") {
      throw new AdminUserError(
        "ADMIN_USER_FORBIDDEN",
        "超级管理员使用隐式全权限，不能配置菜单授权",
        403
      );
    }
    assertCanManageTarget(issuer, target, targetRole);
    const permissions = normalizeAssignablePermissions(issuer, targetRole, input.data.permissions);
    const revoked = await revokeAdminSecurityCredentialsForAdmin(tx, {
      adminId: target.id,
      sessionReason: adminSessionRevokeReasons.permissionsChanged,
      resetTokenReason: adminResetTokenRevokeReasons.permissionsChanged,
      now: input.now
    });
    await tx.adminMenuPermission.deleteMany({ where: { adminId: target.id } });
    if (permissions.length) {
      await tx.adminMenuPermission.createMany({
        data: permissions.map((menuKey) => ({
          adminId: target.id,
          menuKey,
          grantedBy: issuer.id
        }))
      });
    }
    const updated = await tx.adminUser.findUniqueOrThrow({
      where: { id: target.id },
      include: { menuPermissions: true }
    });
    await tx.operationLog.create({
      data: {
        action: "ADMIN_USER_PERMISSIONS_UPDATED",
        createdBy: issuer.id,
        detail: JSON.stringify({
          issuerPublicId: issuer.publicId,
          targetPublicId: target.publicId,
          targetRole,
          permissions,
          revokedSessionCount: revoked.revokedSessionCount,
          revokedResetTokenCount: revoked.revokedResetTokenCount
        })
      }
    });
    return {
      user: serializeAdminUser(updated),
      revokedSessionCount: revoked.revokedSessionCount,
      revokedResetTokenCount: revoked.revokedResetTokenCount
    };
  });
}

export function serializeAdminUser(admin: AdminAccountRecord): AdminUserDto {
  const identity = adminAuthIdentityForAdmin(admin);
  if (!identity) {
    throw new AdminUserError(
      "ADMIN_USER_INVALID_REQUEST",
      "后台账户角色或状态无效",
      500
    );
  }
  return {
    ...adminAuthIdentityDtoSchema.parse(identity),
    activatedAt: admin.activatedAt?.toISOString() ?? null,
    createdAt: admin.createdAt.toISOString(),
    updatedAt: admin.updatedAt.toISOString()
  };
}

async function requireEnabledIssuer(prisma: AdminUserClient, issuerId: number) {
  const issuer = await prisma.adminUser.findFirst({
    where: { id: issuerId, status: "enabled" },
    include: { menuPermissions: true }
  });
  if (!issuer) {
    throw new AdminUserError("ADMIN_USER_FORBIDDEN", "无权管理后台账户", 403);
  }
  return issuer;
}

async function loadIssuerAndTarget(
  prisma: AdminUserClient,
  issuerId: number,
  targetPublicId: string
) {
  const [issuer, target] = await Promise.all([
    requireEnabledIssuer(prisma, issuerId),
    prisma.adminUser.findUnique({
      where: { publicId: targetPublicId },
      include: { menuPermissions: true }
    })
  ]);
  if (!target) {
    throw new AdminUserError("ADMIN_USER_NOT_FOUND", "后台账户不存在", 404);
  }
  return { issuer, target };
}

function assertCanReadTarget(issuer: AdminAccountRecord, target: AdminAccountRecord) {
  const issuerRole = parseRole(issuer.role);
  if (issuerRole === "SUPER_ADMIN") return;
  if (issuerRole === "ADMIN" && target.role === "USER") return;
  throw new AdminUserError("ADMIN_USER_FORBIDDEN", "无权访问该后台账户", 403);
}

function assertCanCreateRole(issuer: AdminAccountRecord, targetRole: AdminRole) {
  const issuerRole = parseRole(issuer.role);
  if (issuerRole === "SUPER_ADMIN" && (targetRole === "ADMIN" || targetRole === "USER")) return;
  if (issuerRole === "ADMIN" && targetRole === "USER") return;
  throw new AdminUserError("ADMIN_USER_FORBIDDEN", "无权创建该层级后台账户", 403);
}

function assertCanManageTarget(
  issuer: AdminAccountRecord,
  target: AdminAccountRecord,
  nextRole: AdminRole
) {
  const issuerRole = parseRole(issuer.role);
  if (issuer.id === target.id) {
    throw new AdminUserError("ADMIN_USER_FORBIDDEN", "请使用自助入口管理当前账户", 403);
  }
  if (issuerRole === "SUPER_ADMIN") return;
  if (issuerRole === "ADMIN" && target.role === "USER" && nextRole === "USER") return;
  throw new AdminUserError("ADMIN_USER_FORBIDDEN", "无权管理该层级后台账户", 403);
}

function normalizeAssignablePermissions(
  issuer: AdminAccountRecord,
  targetRole: AdminRole,
  requestedKeys: readonly string[]
) {
  for (const key of requestedKeys) {
    if (!isAdminGrantableMenuKey(key) && !isAdminMenuGroupKey(key)) {
      throw new AdminUserError("ADMIN_USER_INVALID_REQUEST", "菜单权限包含无效项", 400);
    }
  }
  if (targetRole === "SUPER_ADMIN") return [];

  const expanded = expandAdminMenuSelection(requestedKeys);
  const issuerRole = parseRole(issuer.role);
  if (issuerRole === "SUPER_ADMIN") return expanded;

  const issuerExplicit = issuer.menuPermissions.map((permission) => permission.menuKey);
  const issuerEffective = adminEffectiveMenuKeys(issuerRole, issuerExplicit);
  const delegable = new Set(adminDelegableMenuKeys(issuerRole, issuerEffective));
  const disallowed = expanded.filter((key) => !delegable.has(key));
  if (disallowed.length) {
    throw new AdminUserError("ADMIN_USER_FORBIDDEN", "不能授予超出自身可委派范围的菜单权限", 403);
  }
  return adminGrantableMenuKeyValues.filter((key): key is AdminGrantableMenuKey => expanded.includes(key));
}

async function updateAdminAccountFields(
  prisma: AdminUserClient,
  input: {
    target: AdminAccountRecord;
    username: string | undefined;
    nextRole: AdminRole;
    nextStatus: "pending_activation" | "enabled" | "disabled";
    roleChanged: boolean;
    statusChanged: boolean;
    now: Date;
  }
) {
  const removesEnabledSuper = isRemovingEnabledSuper(
    input.target,
    input.nextRole,
    input.nextStatus
  );
  if (!removesEnabledSuper) {
    return prisma.adminUser.update({
      where: { id: input.target.id },
      data: {
        ...(input.username !== undefined ? { username: input.username } : {}),
        ...(input.roleChanged ? { role: input.nextRole } : {}),
        ...(input.statusChanged ? { status: input.nextStatus } : {})
      },
      include: { menuPermissions: true }
    });
  }

  const assignments: Prisma.Sql[] = [];
  if (input.username !== undefined) assignments.push(Prisma.sql`username = ${input.username}`);
  if (input.roleChanged) assignments.push(Prisma.sql`role = ${input.nextRole}`);
  if (input.statusChanged) assignments.push(Prisma.sql`status = ${input.nextStatus}`);
  assignments.push(Prisma.sql`updatedAt = ${input.now}`);

  const affected = await prisma.$executeRaw(Prisma.sql`
    UPDATE admin_users
    SET ${Prisma.join(assignments, ", ")}
    WHERE id = ${input.target.id}
      AND role = 'SUPER_ADMIN'
      AND status = 'enabled'
      AND EXISTS (
        SELECT 1
        FROM admin_users AS other
        WHERE other.id <> ${input.target.id}
          AND other.role = 'SUPER_ADMIN'
          AND other.status = 'enabled'
      )
  `);
  if (affected !== 1) {
    throw new AdminUserError(
      "ADMIN_USER_LAST_SUPER_ADMIN",
      "不能禁用或降级最后一个启用的超级管理员",
      409
    );
  }
  return prisma.adminUser.findUniqueOrThrow({
    where: { id: input.target.id },
    include: { menuPermissions: true }
  });
}

function isRemovingEnabledSuper(
  target: AdminAccountRecord,
  nextRole: AdminRole,
  nextStatus: "pending_activation" | "enabled" | "disabled"
) {
  if (target.role !== "SUPER_ADMIN" || target.status !== "enabled") return false;
  if (nextRole === "SUPER_ADMIN" && nextStatus === "enabled") return false;
  return true;
}

function requiresSuperAdminReauthentication(target: AdminAccountRecord, nextRole: AdminRole) {
  return target.role === "SUPER_ADMIN" || nextRole === "SUPER_ADMIN";
}

function assertValidRoleStatusTransition(
  target: AdminAccountRecord,
  nextRole: AdminRole,
  nextStatus: "pending_activation" | "enabled" | "disabled"
) {
  if (target.role !== "SUPER_ADMIN" && nextRole === "SUPER_ADMIN" && target.status !== "enabled") {
    throw new AdminUserError(
      "ADMIN_USER_INVALID_REQUEST",
      "只能提升已启用账户为超级管理员",
      400
    );
  }
  if (target.status === "pending_activation" && nextStatus === "enabled") {
    throw new AdminUserError(
      "ADMIN_USER_INVALID_REQUEST",
      "待激活账户必须通过激活链接启用",
      400
    );
  }
}

function assertCurrentPassword(issuer: AdminAccountRecord, currentPassword: string | undefined) {
  if (!currentPassword || !verifyPassword(currentPassword, issuer.passwordHash)) {
    throw new AdminUserError("ADMIN_USER_INVALID_CREDENTIALS", "当前密码错误", 401);
  }
}

function parseRole(role: string): AdminRole {
  const parsed = AdminRoleSchema.safeParse(role);
  if (!parsed.success) {
    throw new AdminUserError("ADMIN_USER_INVALID_REQUEST", "后台账户角色无效", 400);
  }
  return parsed.data;
}

function parseAccountStatus(status: string) {
  const parsed = AdminAccountStatusSchema.safeParse(status);
  if (!parsed.success || parsed.data === "pending_activation") {
    throw new AdminUserError("ADMIN_USER_INVALID_REQUEST", "后台账户状态无效", 400);
  }
  return parsed.data;
}
