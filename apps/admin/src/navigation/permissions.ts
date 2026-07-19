import type { AdminGrantableMenuKey, AdminMenuKey, AdminRole, AdminUserDto } from "@event-arts/shared";
import { adminGrantableMenuKeyValues } from "@event-arts/shared";
import type { AdminIdentity } from "../api";
import { adminMenuConfig, isMenuGroup, menuLeaves, type AdminMenuItem } from "./menu-config";

const roleWeight: Record<AdminRole, number> = {
  USER: 1,
  ADMIN: 2,
  SUPER_ADMIN: 3
};

export const adminRoleLabels: Record<AdminRole, string> = {
  SUPER_ADMIN: "超级管理员",
  ADMIN: "管理员",
  USER: "普通用户"
};

export const adminStatusLabels: Record<AdminUserDto["status"], string> = {
  pending_activation: "待激活",
  enabled: "启用",
  disabled: "禁用"
};

export function hasAdminMenu(identity: AdminIdentity, key: AdminMenuKey) {
  return identity.permissions.includes(key);
}

export function filterAdminMenuConfig(
  identity: AdminIdentity,
  items: AdminMenuItem[] = adminMenuConfig
): AdminMenuItem[] {
  const filtered: AdminMenuItem[] = [];
  for (const item of items) {
    if (!isMenuGroup(item)) {
      if (hasAdminMenu(identity, item.key)) filtered.push(item);
      continue;
    }
    const children = item.children.filter((child) => hasAdminMenu(identity, child.key));
    if (children.length) filtered.push({ ...item, children });
  }
  return filtered;
}

export function firstAccessibleAdminPath(identity: AdminIdentity) {
  return menuLeaves(filterAdminMenuConfig(identity))[0]?.path ?? "/change-password";
}

export function canAccessRouteMenu(identity: AdminIdentity, menuKey: AdminMenuKey) {
  return hasAdminMenu(identity, menuKey);
}

export function canReadAdminUser(identity: AdminIdentity, target: AdminUserDto) {
  if (identity.role === "SUPER_ADMIN") return true;
  return identity.role === "ADMIN" && target.role === "USER";
}

export function canManageAdminUser(identity: AdminIdentity, target: AdminUserDto) {
  if (identity.publicId === target.publicId) return false;
  if (identity.role === "SUPER_ADMIN") return true;
  return identity.role === "ADMIN" && target.role === "USER";
}

export function canIssuePasswordLink(identity: AdminIdentity, target: AdminUserDto) {
  if (identity.publicId === target.publicId) return false;
  if (target.role === "SUPER_ADMIN") return false;
  if (identity.role === "SUPER_ADMIN") return target.role === "ADMIN" || target.role === "USER";
  if (identity.role === "ADMIN") return target.role === "USER";
  return false;
}

export function creatableRoles(identity: AdminIdentity): AdminRole[] {
  if (identity.role === "SUPER_ADMIN") return ["ADMIN", "USER"];
  if (identity.role === "ADMIN") return ["USER"];
  return [];
}

export function editableRoles(identity: AdminIdentity, target: AdminUserDto): AdminRole[] {
  if (identity.role === "SUPER_ADMIN") {
    return target.role === "SUPER_ADMIN" || target.status === "enabled"
      ? ["SUPER_ADMIN", "ADMIN", "USER"]
      : ["ADMIN", "USER"];
  }
  if (identity.role === "ADMIN" && target.role === "USER") return ["USER"];
  return [target.role];
}

export function assignablePermissionKeys(identity: AdminIdentity): AdminGrantableMenuKey[] {
  const delegable = new Set(identity.delegablePermissions);
  return adminGrantableMenuKeyValues.filter((key) => delegable.has(key));
}

export function canAssignPermissions(identity: AdminIdentity, targetRole: AdminRole) {
  return roleWeight[identity.role] > roleWeight[targetRole] && targetRole !== "SUPER_ADMIN";
}
