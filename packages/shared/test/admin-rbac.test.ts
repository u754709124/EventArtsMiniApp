import { describe, expect, it } from "vitest";
import {
  AdminAccountStatusSchema,
  AdminGrantableMenuKeySchema,
  AdminPasswordResetPurposeSchema,
  AdminRoleSchema,
  adminAccountStatusValues,
  adminDelegableMenuKeyValues,
  adminGrantableMenuKeyValues,
  adminMenuCatalog,
  adminMenuKeyValues,
  adminPasswordResetPolicy,
  adminPasswordResetPurposeValues,
  adminRoleValues,
  expandAdminMenuSelection
} from "../src/admin-rbac";

describe("admin RBAC shared contracts", () => {
  it("defines the fixed account hierarchy and lifecycle states", () => {
    expect(adminRoleValues).toEqual(["SUPER_ADMIN", "ADMIN", "USER"]);
    expect(adminAccountStatusValues).toEqual(["pending_activation", "enabled", "disabled"]);
    expect(AdminRoleSchema.parse("SUPER_ADMIN")).toBe("SUPER_ADMIN");
    expect(AdminAccountStatusSchema.parse("pending_activation")).toBe("pending_activation");
    expect(() => AdminRoleSchema.parse("OWNER")).toThrow();
    expect(() => AdminAccountStatusSchema.parse("deleted")).toThrow();
  });

  it("defines one-time password token purposes and TTL bounds", () => {
    expect(adminPasswordResetPurposeValues).toEqual(["activation", "recovery"]);
    expect(AdminPasswordResetPurposeSchema.parse("activation")).toBe("activation");
    expect(adminPasswordResetPolicy).toEqual({
      tokenBytes: 32,
      defaultTtlMinutes: 30,
      minTtlMinutes: 5,
      maxTtlMinutes: 60
    });
  });

  it("keeps intrinsic capabilities out of grants and sensitive menus out of ADMIN delegation", () => {
    const byKey = new Map(adminMenuCatalog.map((item) => [item.key, item]));
    expect(adminMenuKeyValues).toEqual(adminMenuCatalog.map((item) => item.key));
    expect(adminGrantableMenuKeyValues).toEqual(
      adminMenuCatalog.filter((item) => item.access === "grantable").map((item) => item.key)
    );
    expect(byKey.get("change-password")).toMatchObject({ access: "authenticated", delegable: false });
    expect(byKey.get("user-management")).toMatchObject({ access: "role_capability", delegable: false });
    expect(byKey.get("backups")).toMatchObject({ access: "grantable", delegable: false });
    expect(byKey.get("system-config")).toMatchObject({ access: "grantable", delegable: false });
    expect(byKey.get("scheduled-tasks")).toMatchObject({ access: "grantable", delegable: false });
    expect(AdminGrantableMenuKeySchema.parse("backups")).toBe("backups");
    expect(adminDelegableMenuKeyValues).not.toContain("backups");
    expect(adminDelegableMenuKeyValues).not.toContain("scheduled-tasks");
    expect(adminDelegableMenuKeyValues).not.toContain("system-config");
  });

  it("expands group selections only to current grantable leaf keys", () => {
    expect(expandAdminMenuSelection(["content", "backups", "artists", "missing"])).toEqual([
      "artists",
      "cases",
      "articles",
      "detail-pages",
      "backups"
    ]);
    expect(expandAdminMenuSelection(["account"])).toEqual(["backups"]);
  });
});
