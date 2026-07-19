import {
  AdminAccountStatusSchema,
  AdminRoleSchema,
  adminDelegableMenuKeys,
  adminEffectiveMenuKeys,
  adminGrantableMenuKeyValues,
  adminMenuKeyValues,
  isAdminGrantableMenuKey,
  type AdminAuthIdentityDto,
  type AdminGrantableMenuKey,
  type AdminMenuKey,
  type AdminRole
} from "@event-arts/shared";
import type { AppPrismaClient } from "./db";

export type AdminRouteAccessPolicy =
  | { kind: "public" }
  | { kind: "authenticated" }
  | { kind: "role"; roles: readonly AdminRole[] }
  | { kind: "menu"; menuKey: AdminMenuKey };

export type AdminRoutePolicyEntry = {
  method: string;
  path: string;
  policy: AdminRouteAccessPolicy;
};

export type AdminRegisteredRoute = {
  method: string;
  url: string;
};

export type AdminAuthContext = AdminAuthIdentityDto & {
  status: "enabled";
  sessionJti: string;
  explicitPermissions: AdminGrantableMenuKey[];
};

const publicPolicy = { kind: "public" } as const;
const authenticatedPolicy = { kind: "authenticated" } as const;
const superAdminPolicy = { kind: "role", roles: ["SUPER_ADMIN"] } as const;

function menuPolicy(menuKey: AdminMenuKey): AdminRouteAccessPolicy {
  return { kind: "menu", menuKey };
}

export const adminRoutePolicies = [
  { method: "POST", path: "/api/admin/auth/login", policy: publicPolicy },
  { method: "POST", path: "/api/admin/auth/logout", policy: authenticatedPolicy },
  { method: "GET", path: "/api/admin/auth/me", policy: authenticatedPolicy },
  { method: "POST", path: "/api/admin/auth/change-password", policy: authenticatedPolicy },
  { method: "POST", path: "/api/admin/notifications", policy: authenticatedPolicy },
  { method: "GET", path: "/api/admin/notifications", policy: authenticatedPolicy },

  { method: "GET", path: "/api/admin/dashboard/overview", policy: menuPolicy("dashboard") },

  { method: "GET", path: "/api/admin/scheduled-tasks", policy: superAdminPolicy },
  { method: "POST", path: "/api/admin/scheduled-tasks/:taskKey/run", policy: superAdminPolicy },
  { method: "GET", path: "/api/admin/system-config/edgeone", policy: superAdminPolicy },
  { method: "PUT", path: "/api/admin/system-config/edgeone", policy: superAdminPolicy },
  { method: "GET", path: "/api/admin/backups", policy: superAdminPolicy },
  { method: "GET", path: "/api/admin/backups/:id/download", policy: superAdminPolicy },
  { method: "POST", path: "/api/admin/backups", policy: superAdminPolicy },
  { method: "POST", path: "/api/admin/backups/import", policy: superAdminPolicy },
  { method: "POST", path: "/api/admin/backups/:id/restore", policy: superAdminPolicy },
  { method: "DELETE", path: "/api/admin/backups/:id", policy: superAdminPolicy },

  { method: "POST", path: "/api/admin/edgeone/prefetch", policy: menuPolicy("media-assets") },
  { method: "GET", path: "/api/admin/edgeone/prefetch", policy: menuPolicy("media-assets") },
  { method: "POST", path: "/api/admin/edgeone/prefetch/reconcile", policy: menuPolicy("media-assets") },

  { method: "GET", path: "/api/admin/detail-pages", policy: menuPolicy("detail-pages") },
  { method: "GET", path: "/api/admin/detail-pages/options", policy: menuPolicy("detail-pages") },
  { method: "GET", path: "/api/admin/detail-pages/:id", policy: menuPolicy("detail-pages") },
  { method: "POST", path: "/api/admin/detail-pages", policy: menuPolicy("detail-pages") },
  { method: "PUT", path: "/api/admin/detail-pages/:id", policy: menuPolicy("detail-pages") },
  { method: "DELETE", path: "/api/admin/detail-pages/:id", policy: menuPolicy("detail-pages") },
  { method: "GET", path: "/api/admin/detail-pages/:id/references", policy: menuPolicy("detail-pages") },
  { method: "POST", path: "/api/admin/detail-pages/preview", policy: menuPolicy("detail-pages") },

  { method: "GET", path: "/api/admin/site-config", policy: menuPolicy("site-config") },
  { method: "PUT", path: "/api/admin/site-config", policy: menuPolicy("site-config") },

  { method: "GET", path: "/api/admin/media-assets/upload-config", policy: menuPolicy("media-assets") },
  { method: "GET", path: "/api/admin/media-assets", policy: menuPolicy("media-assets") },
  { method: "GET", path: "/api/admin/media-assets/tags", policy: menuPolicy("media-assets") },
  { method: "GET", path: "/api/admin/media-assets/:id", policy: menuPolicy("media-assets") },
  { method: "POST", path: "/api/admin/media-assets/lookup", policy: menuPolicy("media-assets") },
  { method: "POST", path: "/api/admin/media-assets/check-name", policy: menuPolicy("media-assets") },
  { method: "POST", path: "/api/admin/media-assets/upload", policy: menuPolicy("media-assets") },
  { method: "PATCH", path: "/api/admin/media-assets/:id", policy: menuPolicy("media-assets") },
  { method: "DELETE", path: "/api/admin/media-assets/:id", policy: menuPolicy("media-assets") },
  { method: "POST", path: "/api/admin/media-assets/scan-unused", policy: menuPolicy("media-assets") },
  { method: "POST", path: "/api/admin/media-assets/batch-delete", policy: menuPolicy("media-assets") },

  { method: "GET", path: "/api/admin/announcements", policy: menuPolicy("announcements") },
  { method: "POST", path: "/api/admin/announcements/reorder", policy: menuPolicy("announcements") },
  { method: "GET", path: "/api/admin/announcements/:id", policy: menuPolicy("announcements") },
  { method: "POST", path: "/api/admin/announcements", policy: menuPolicy("announcements") },
  { method: "PUT", path: "/api/admin/announcements/:id", policy: menuPolicy("announcements") },
  { method: "DELETE", path: "/api/admin/announcements/:id", policy: menuPolicy("announcements") },

  { method: "GET", path: "/api/admin/banners", policy: menuPolicy("banners") },
  { method: "POST", path: "/api/admin/banners/reorder", policy: menuPolicy("banners") },
  { method: "GET", path: "/api/admin/banners/:id", policy: menuPolicy("banners") },
  { method: "POST", path: "/api/admin/banners", policy: menuPolicy("banners") },
  { method: "PUT", path: "/api/admin/banners/:id", policy: menuPolicy("banners") },
  { method: "DELETE", path: "/api/admin/banners/:id", policy: menuPolicy("banners") },

  { method: "GET", path: "/api/admin/menu-items", policy: menuPolicy("menu-items") },
  { method: "POST", path: "/api/admin/menu-items/reorder", policy: menuPolicy("menu-items") },
  { method: "GET", path: "/api/admin/menu-items/:id", policy: menuPolicy("menu-items") },
  { method: "POST", path: "/api/admin/menu-items", policy: menuPolicy("menu-items") },
  { method: "PUT", path: "/api/admin/menu-items/:id", policy: menuPolicy("menu-items") },
  { method: "DELETE", path: "/api/admin/menu-items/:id", policy: menuPolicy("menu-items") },

  { method: "GET", path: "/api/admin/case-categories", policy: menuPolicy("cases") },
  { method: "GET", path: "/api/admin/cases", policy: menuPolicy("cases") },
  { method: "POST", path: "/api/admin/cases/reorder", policy: menuPolicy("cases") },
  { method: "GET", path: "/api/admin/cases/:id", policy: menuPolicy("cases") },
  { method: "POST", path: "/api/admin/cases", policy: menuPolicy("cases") },
  { method: "PUT", path: "/api/admin/cases/:id", policy: menuPolicy("cases") },
  { method: "DELETE", path: "/api/admin/cases/:id", policy: menuPolicy("cases") },

  { method: "GET", path: "/api/admin/artist-categories", policy: menuPolicy("artists") },
  { method: "GET", path: "/api/admin/artists", policy: menuPolicy("artists") },
  { method: "POST", path: "/api/admin/artists/reorder", policy: menuPolicy("artists") },
  { method: "GET", path: "/api/admin/artists/:id", policy: menuPolicy("artists") },
  { method: "POST", path: "/api/admin/artists", policy: menuPolicy("artists") },
  { method: "PUT", path: "/api/admin/artists/:id", policy: menuPolicy("artists") },
  { method: "DELETE", path: "/api/admin/artists/:id", policy: menuPolicy("artists") },

  { method: "GET", path: "/api/admin/articles/categories", policy: menuPolicy("articles") },
  { method: "GET", path: "/api/admin/articles", policy: menuPolicy("articles") },
  { method: "POST", path: "/api/admin/articles/reorder", policy: menuPolicy("articles") },
  { method: "GET", path: "/api/admin/articles/:id", policy: menuPolicy("articles") },
  { method: "POST", path: "/api/admin/articles", policy: menuPolicy("articles") },
  { method: "PUT", path: "/api/admin/articles/:id", policy: menuPolicy("articles") },
  { method: "DELETE", path: "/api/admin/articles/:id", policy: menuPolicy("articles") }
] as const satisfies readonly AdminRoutePolicyEntry[];

const policyIndex = buildPolicyIndex(adminRoutePolicies);

export function normalizeAdminRouteMethod(method: string) {
  const normalized = method.toUpperCase();
  return normalized === "HEAD" ? "GET" : normalized;
}

export function adminRoutePolicyFor(method: string, path: string) {
  return policyIndex.get(routePolicyKey(method, path)) ?? null;
}

export function describeAdminRoutePolicy(policy: AdminRouteAccessPolicy) {
  if (policy.kind === "role") return `${policy.kind}:${policy.roles.join("|")}`;
  if (policy.kind === "menu") return `${policy.kind}:${policy.menuKey}`;
  return policy.kind;
}

export function assertAdminRoutePolicyCoverage(routes: readonly AdminRegisteredRoute[]) {
  const missing = new Set<string>();
  for (const route of routes) {
    const method = normalizeAdminRouteMethod(route.method);
    if (method === "OPTIONS") continue;
    if (!route.url.startsWith("/api/admin/")) continue;
    const key = routePolicyKey(method, route.url);
    if (!policyIndex.has(key)) missing.add(`${method} ${route.url}`);
  }
  if (missing.size > 0) {
    throw new Error(`未声明后台路由访问策略: ${[...missing].sort().join(", ")}`);
  }
}

export function isAdminRouteAllowed(context: AdminAuthContext, policy: AdminRouteAccessPolicy) {
  if (policy.kind === "public" || policy.kind === "authenticated") return true;
  if (policy.kind === "role") return policy.roles.includes(context.role);
  return context.permissions.includes(policy.menuKey);
}

type AdminIdentityRecord = {
  id: number;
  publicId: string;
  username: string;
  role: string;
  status: string;
  menuPermissions: Array<{ menuKey: string }>;
};

export function adminAuthIdentityForAdmin(admin: AdminIdentityRecord): AdminAuthIdentityDto | null {
  const role = AdminRoleSchema.safeParse(admin.role);
  const status = AdminAccountStatusSchema.safeParse(admin.status);
  if (!role.success || !status.success) return null;

  const explicitPermissions = explicitGrantablePermissions(admin);
  return {
    id: admin.id,
    publicId: admin.publicId,
    username: admin.username,
    role: role.data,
    status: status.data,
    permissions: adminEffectiveMenuKeys(role.data, explicitPermissions),
    delegablePermissions: adminDelegableMenuKeys(
      role.data,
      adminEffectiveMenuKeys(role.data, explicitPermissions)
    )
  };
}

export async function loadAdminAuthContext(
  prisma: AppPrismaClient,
  input: { id: number; jti: string | undefined; now: Date }
): Promise<AdminAuthContext | null> {
  if (!Number.isInteger(input.id) || !input.jti) return null;

  const session = await prisma.adminSession.findUnique({
    where: { jti: input.jti },
    include: { admin: { include: { menuPermissions: true } } }
  });
  if (
    !session ||
    session.adminId !== input.id ||
    session.revokedAt ||
    session.expiresAt.getTime() <= input.now.getTime()
  ) {
    return null;
  }

  const identity = adminAuthIdentityForAdmin(session.admin);
  if (!identity || identity.status !== "enabled") return null;

  return {
    ...identity,
    status: "enabled",
    sessionJti: session.jti,
    explicitPermissions: explicitGrantablePermissions(session.admin)
  };
}

function explicitGrantablePermissions(admin: AdminIdentityRecord) {
  const selected = new Set<AdminGrantableMenuKey>();
  for (const permission of admin.menuPermissions) {
    if (isAdminGrantableMenuKey(permission.menuKey)) selected.add(permission.menuKey);
  }
  return adminGrantableMenuKeyValues.filter((key) => selected.has(key));
}

function buildPolicyIndex(entries: readonly AdminRoutePolicyEntry[]) {
  const index = new Map<string, AdminRouteAccessPolicy>();
  for (const entry of entries) {
    if (!entry.path.startsWith("/api/admin/")) {
      throw new Error(`后台路由策略路径无效: ${entry.method} ${entry.path}`);
    }
    validatePolicy(entry.policy);
    const key = routePolicyKey(entry.method, entry.path);
    if (index.has(key)) throw new Error(`后台路由策略重复: ${entry.method} ${entry.path}`);
    index.set(key, entry.policy);
  }
  return index;
}

function validatePolicy(policy: AdminRouteAccessPolicy) {
  if (policy.kind === "menu" && !adminMenuKeyValues.includes(policy.menuKey)) {
    throw new Error(`后台菜单策略无效: ${policy.menuKey}`);
  }
  if (policy.kind === "role") {
    for (const role of policy.roles) {
      if (!AdminRoleSchema.safeParse(role).success) throw new Error(`后台角色策略无效: ${role}`);
    }
  }
}

function routePolicyKey(method: string, path: string) {
  return `${normalizeAdminRouteMethod(method)} ${path}`;
}
