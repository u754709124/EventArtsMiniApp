import { describe, expect, it } from "vitest";
import type { AdminUserDto } from "@event-arts/shared";
import type { AdminIdentity } from "../api";
import {
  assignablePermissionKeys,
  canManageAdminUser,
  canIssuePasswordLink,
  editableRoles,
  filterAdminMenuConfig,
  firstAccessibleAdminPath
} from "./permissions";
import { isMenuGroup, menuLeaves } from "./menu-config";

function identity(overrides: Partial<AdminIdentity> = {}): AdminIdentity {
  return {
    id: 1,
    publicId: "11111111-1111-4111-8111-111111111111",
    username: "tester",
    role: "USER",
    status: "enabled",
    permissions: ["change-password"],
    delegablePermissions: [],
    ...overrides
  };
}

function target(overrides: Partial<AdminUserDto> = {}): AdminUserDto {
  return {
    ...identity(),
    activatedAt: "2026-07-19T04:00:00.000Z",
    createdAt: "2026-07-19T04:00:00.000Z",
    updatedAt: "2026-07-19T04:00:00.000Z",
    ...overrides
  };
}

describe("admin permission-aware navigation", () => {
  it("keeps only change-password for accounts without business menus", () => {
    const filtered = filterAdminMenuConfig(identity());

    expect(menuLeaves(filtered).map((item) => item.key)).toEqual(["change-password"]);
    expect(filtered.every((item) => !isMenuGroup(item) || item.children.length > 0)).toBe(true);
    expect(firstAccessibleAdminPath(identity())).toBe("/change-password");
  });

  it("shows only granted sensitive menus for ADMIN while preserving user-management", () => {
    const admin = identity({
      role: "ADMIN",
      permissions: ["media-assets", "user-management", "change-password"],
      delegablePermissions: ["media-assets"]
    });
    const leaves = menuLeaves(filterAdminMenuConfig(admin)).map((item) => item.key);

    expect(leaves).toEqual(["media-assets", "user-management", "change-password"]);
    expect(leaves).not.toContain("backups");
    expect(leaves).not.toContain("system-config");
    expect(leaves).not.toContain("scheduled-tasks");

    const sensitiveAdmin = identity({
      role: "ADMIN",
      permissions: ["backups", "scheduled-tasks", "system-config", "user-management", "change-password"],
      delegablePermissions: []
    });

    expect(menuLeaves(filterAdminMenuConfig(sensitiveAdmin)).map((item) => item.key)).toEqual([
      "user-management",
      "backups",
      "change-password",
      "scheduled-tasks",
      "system-config"
    ]);
    expect(assignablePermissionKeys(sensitiveAdmin)).toEqual([]);
  });

  it("matches the reset-link issuer-target matrix used by the UI", () => {
    const superAdmin = identity({ role: "SUPER_ADMIN", permissions: ["user-management", "change-password"] });
    const admin = identity({ role: "ADMIN", permissions: ["user-management", "change-password"] });
    const userTarget = target({ publicId: "22222222-2222-4222-8222-222222222222", role: "USER" });
    const adminTarget = target({ publicId: "33333333-3333-4333-8333-333333333333", role: "ADMIN" });
    const superTarget = target({ publicId: "44444444-4444-4444-8444-444444444444", role: "SUPER_ADMIN" });

    expect(canIssuePasswordLink(superAdmin, userTarget)).toBe(true);
    expect(canIssuePasswordLink(superAdmin, adminTarget)).toBe(true);
    expect(canIssuePasswordLink(superAdmin, superTarget)).toBe(false);
    expect(canIssuePasswordLink(admin, userTarget)).toBe(true);
    expect(canIssuePasswordLink(admin, adminTarget)).toBe(false);
    expect(canIssuePasswordLink(admin, superTarget)).toBe(false);
    expect(canIssuePasswordLink(admin, target({ publicId: admin.publicId, role: "ADMIN" }))).toBe(false);
  });

  it("does not expose self-management actions even for SUPER_ADMIN", () => {
    const superAdmin = identity({ role: "SUPER_ADMIN", permissions: ["user-management", "change-password"] });

    expect(canManageAdminUser(superAdmin, target({ publicId: superAdmin.publicId, role: "SUPER_ADMIN" }))).toBe(false);
  });

  it("lets a SUPER_ADMIN keep the peer role selected while re-enabling a disabled SUPER_ADMIN", () => {
    const superAdmin = identity({ role: "SUPER_ADMIN", permissions: ["user-management", "change-password"] });
    const disabledPeer = target({
      publicId: "55555555-5555-4555-8555-555555555555",
      role: "SUPER_ADMIN",
      status: "disabled"
    });

    expect(editableRoles(superAdmin, disabledPeer)).toContain("SUPER_ADMIN");
  });
});
