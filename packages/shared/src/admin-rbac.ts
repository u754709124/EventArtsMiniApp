import { z } from "zod";

export const adminRoleValues = ["SUPER_ADMIN", "ADMIN", "USER"] as const;
export type AdminRole = (typeof adminRoleValues)[number];
export const AdminRoleSchema = z.enum(adminRoleValues);

export const adminAccountStatusValues = ["pending_activation", "enabled", "disabled"] as const;
export type AdminAccountStatus = (typeof adminAccountStatusValues)[number];
export const AdminAccountStatusSchema = z.enum(adminAccountStatusValues);

export const adminPasswordResetPurposeValues = ["activation", "recovery"] as const;
export type AdminPasswordResetPurpose = (typeof adminPasswordResetPurposeValues)[number];
export const AdminPasswordResetPurposeSchema = z.enum(adminPasswordResetPurposeValues);

export const adminMenuGroupKeyValues = ["home", "content", "assets", "account"] as const;
export type AdminMenuGroupKey = (typeof adminMenuGroupKeyValues)[number];
export const AdminMenuGroupKeySchema = z.enum(adminMenuGroupKeyValues);

export const adminMenuKeyValues = [
  "dashboard",
  "site-config",
  "announcements",
  "banners",
  "menu-items",
  "artists",
  "cases",
  "recent-activities",
  "articles",
  "detail-pages",
  "media-assets",
  "user-management",
  "backups",
  "change-password",
  "scheduled-tasks",
  "system-config"
] as const;
export type AdminMenuKey = (typeof adminMenuKeyValues)[number];
export const AdminMenuKeySchema = z.enum(adminMenuKeyValues);

export const adminGrantableMenuKeyValues = [
  "dashboard",
  "site-config",
  "announcements",
  "banners",
  "menu-items",
  "artists",
  "cases",
  "recent-activities",
  "articles",
  "detail-pages",
  "media-assets",
  "backups",
  "scheduled-tasks",
  "system-config"
] as const;
export type AdminGrantableMenuKey = (typeof adminGrantableMenuKeyValues)[number];
export const AdminGrantableMenuKeySchema = z.enum(adminGrantableMenuKeyValues);

export const adminDelegableMenuKeyValues = [
  "dashboard",
  "site-config",
  "announcements",
  "banners",
  "menu-items",
  "artists",
  "cases",
  "recent-activities",
  "articles",
  "detail-pages",
  "media-assets"
] as const satisfies readonly AdminGrantableMenuKey[];
export type AdminDelegableMenuKey = (typeof adminDelegableMenuKeyValues)[number];
export const AdminDelegableMenuKeySchema = z.enum(adminDelegableMenuKeyValues);

export const adminMenuSensitivityValues = ["standard", "sensitive", "critical"] as const;
export type AdminMenuSensitivity = (typeof adminMenuSensitivityValues)[number];
export const AdminMenuSensitivitySchema = z.enum(adminMenuSensitivityValues);

export const adminMenuAccessKindValues = [
  "grantable",
  "authenticated",
  "role_capability"
] as const;
export type AdminMenuAccessKind = (typeof adminMenuAccessKindValues)[number];
export const AdminMenuAccessKindSchema = z.enum(adminMenuAccessKindValues);

export type AdminMenuCatalogItem = {
  key: AdminMenuKey;
  label: string;
  parentKey: AdminMenuGroupKey | null;
  order: number;
  access: AdminMenuAccessKind;
  sensitivity: AdminMenuSensitivity;
  delegable: boolean;
};

export const adminMenuCatalog = [
  {
    key: "dashboard",
    label: "数据看板",
    parentKey: null,
    order: 10,
    access: "grantable",
    sensitivity: "sensitive",
    delegable: true
  },
  {
    key: "site-config",
    label: "首页配置",
    parentKey: "home",
    order: 20,
    access: "grantable",
    sensitivity: "sensitive",
    delegable: true
  },
  {
    key: "announcements",
    label: "公告管理",
    parentKey: "home",
    order: 30,
    access: "grantable",
    sensitivity: "standard",
    delegable: true
  },
  {
    key: "banners",
    label: "首页轮播",
    parentKey: "home",
    order: 40,
    access: "grantable",
    sensitivity: "standard",
    delegable: true
  },
  {
    key: "menu-items",
    label: "分类菜单",
    parentKey: "home",
    order: 50,
    access: "grantable",
    sensitivity: "standard",
    delegable: true
  },
  {
    key: "artists",
    label: "人员管理",
    parentKey: "content",
    order: 60,
    access: "grantable",
    sensitivity: "standard",
    delegable: true
  },
  {
    key: "cases",
    label: "案例管理",
    parentKey: "content",
    order: 70,
    access: "grantable",
    sensitivity: "standard",
    delegable: true
  },
  {
    key: "recent-activities",
    label: "近日活动管理",
    parentKey: "content",
    order: 80,
    access: "grantable",
    sensitivity: "standard",
    delegable: true
  },
  {
    key: "articles",
    label: "文章管理",
    parentKey: "content",
    order: 90,
    access: "grantable",
    sensitivity: "standard",
    delegable: true
  },
  {
    key: "detail-pages",
    label: "详情页管理",
    parentKey: "content",
    order: 100,
    access: "grantable",
    sensitivity: "standard",
    delegable: true
  },
  {
    key: "media-assets",
    label: "素材库",
    parentKey: "assets",
    order: 110,
    access: "grantable",
    sensitivity: "sensitive",
    delegable: true
  },
  {
    key: "user-management",
    label: "用户管理",
    parentKey: "account",
    order: 120,
    access: "role_capability",
    sensitivity: "critical",
    delegable: false
  },
  {
    key: "backups",
    label: "备份与恢复",
    parentKey: "account",
    order: 130,
    access: "grantable",
    sensitivity: "critical",
    delegable: false
  },
  {
    key: "change-password",
    label: "修改密码",
    parentKey: "account",
    order: 140,
    access: "authenticated",
    sensitivity: "standard",
    delegable: false
  },
  {
    key: "scheduled-tasks",
    label: "定时任务",
    parentKey: null,
    order: 150,
    access: "grantable",
    sensitivity: "critical",
    delegable: false
  },
  {
    key: "system-config",
    label: "系统配置",
    parentKey: null,
    order: 160,
    access: "grantable",
    sensitivity: "critical",
    delegable: false
  }
] as const satisfies readonly AdminMenuCatalogItem[];

export const adminAuthIdentityDtoSchema = z.object({
  id: z.number().int().positive(),
  publicId: z.string().uuid(),
  username: z.string().min(1),
  role: AdminRoleSchema,
  status: AdminAccountStatusSchema,
  permissions: z.array(AdminMenuKeySchema),
  delegablePermissions: z.array(AdminGrantableMenuKeySchema)
}).strict();
export type AdminAuthIdentityDto = z.infer<typeof adminAuthIdentityDtoSchema>;

const adminIsoDateTimeStringSchema = z
  .string()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), "时间必须有效");

export const adminUserDtoSchema = adminAuthIdentityDtoSchema.extend({
  activatedAt: adminIsoDateTimeStringSchema.nullable(),
  createdAt: adminIsoDateTimeStringSchema,
  updatedAt: adminIsoDateTimeStringSchema
}).strict();
export type AdminUserDto = z.infer<typeof adminUserDtoSchema>;

const adminMenuKeySet = new Set<string>(adminMenuKeyValues);
const adminGrantableMenuKeySet = new Set<string>(adminGrantableMenuKeyValues);
const adminMenuGroupKeySet = new Set<string>(adminMenuGroupKeyValues);
const adminMenuCatalogByKey = new Map<AdminMenuKey, AdminMenuCatalogItem>(
  adminMenuCatalog.map((item) => [item.key, item])
);

export function isAdminMenuKey(value: string): value is AdminMenuKey {
  return adminMenuKeySet.has(value);
}

export function isAdminGrantableMenuKey(value: string): value is AdminGrantableMenuKey {
  return adminGrantableMenuKeySet.has(value);
}

export function isAdminMenuGroupKey(value: string): value is AdminMenuGroupKey {
  return adminMenuGroupKeySet.has(value);
}

export function expandAdminMenuSelection(keys: readonly string[]): AdminGrantableMenuKey[] {
  const selected = new Set<AdminGrantableMenuKey>();

  for (const key of keys) {
    if (isAdminGrantableMenuKey(key)) {
      selected.add(key);
      continue;
    }
    if (isAdminMenuGroupKey(key)) {
      for (const item of adminMenuCatalog) {
        if (item.parentKey === key && isAdminGrantableMenuKey(item.key)) selected.add(item.key);
      }
    }
  }

  return adminGrantableMenuKeyValues.filter((key) => selected.has(key));
}

export function adminMenuItemForKey(key: AdminMenuKey) {
  return adminMenuCatalogByKey.get(key) ?? null;
}

export function adminEffectiveMenuKeys(
  role: AdminRole,
  explicitGrantableKeys: readonly string[]
): AdminMenuKey[] {
  if (role === "SUPER_ADMIN") return [...adminMenuKeyValues];

  const selected = new Set<AdminMenuKey>(["change-password"]);
  if (role === "ADMIN") selected.add("user-management");

  for (const key of explicitGrantableKeys) {
    if (isAdminGrantableMenuKey(key)) selected.add(key);
  }

  return adminMenuKeyValues.filter((key) => selected.has(key));
}

export function adminDelegableMenuKeys(
  role: AdminRole,
  effectiveMenuKeys: readonly AdminMenuKey[]
): AdminGrantableMenuKey[] {
  if (role === "USER") return [];
  if (role === "SUPER_ADMIN") return [...adminGrantableMenuKeyValues];

  const effective = new Set<AdminMenuKey>(effectiveMenuKeys);
  return adminDelegableMenuKeyValues.filter((key) => {
    const item = adminMenuCatalogByKey.get(key);
    return effective.has(key) && item?.delegable === true;
  });
}

export function adminMenuIsSensitive(key: AdminMenuKey) {
  const item = adminMenuCatalogByKey.get(key);
  return item?.sensitivity === "sensitive" || item?.sensitivity === "critical";
}

export const adminPasswordResetPolicy = {
  tokenBytes: 32,
  defaultTtlMinutes: 30,
  minTtlMinutes: 5,
  maxTtlMinutes: 60
} as const;
