import { describe, expect, it } from "vitest";
import {
  adminDelegableMenuKeyValues,
  adminEffectiveMenuKeys,
  adminDelegableMenuKeys,
  adminGrantableMenuKeyValues,
  adminMenuCatalog,
  adminMenuKeyValues,
  expandAdminMenuSelection
} from "./admin-rbac";

describe("admin RBAC catalog", () => {
  it("keeps all menu leaves in the shared catalog and separates grant scopes", () => {
    expect(adminMenuCatalog.map((item) => item.key)).toEqual(adminMenuKeyValues);
    expect(new Set(adminMenuCatalog.map((item) => item.key)).size).toBe(16);
    expect(adminGrantableMenuKeyValues).toEqual([
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
    ]);
    expect(adminDelegableMenuKeyValues).toEqual([
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
    ]);
  });

  it("allows SUPER_ADMIN-only assignment of sensitive menus without making them ADMIN-delegable", () => {
    const sensitiveGrants = ["backups", "scheduled-tasks", "system-config"] as const;
    const adminEffective = adminEffectiveMenuKeys("ADMIN", sensitiveGrants);

    expect(adminEffective).toEqual([
      "user-management",
      "backups",
      "change-password",
      "scheduled-tasks",
      "system-config"
    ]);
    expect(adminDelegableMenuKeys("SUPER_ADMIN", adminMenuKeyValues)).toEqual(adminGrantableMenuKeyValues);
    expect(adminDelegableMenuKeys("ADMIN", adminEffective)).toEqual([]);
    expect(adminDelegableMenuKeys("ADMIN", adminEffectiveMenuKeys("ADMIN", ["media-assets", "backups"]))).toEqual([
      "media-assets"
    ]);
  });

  it("expands groups only to explicit grantable leaves and never stores inherent capabilities", () => {
    expect(expandAdminMenuSelection(["account"])).toEqual(["backups"]);
    expect(expandAdminMenuSelection(["change-password", "user-management"])).toEqual([]);
  });
});
