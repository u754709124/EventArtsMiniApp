import { describe, expect, it } from "vitest";
import { ADMIN_BASENAME, ADMIN_BASE_PATH, isAdminLoginPathname, stripAdminBasename, withAdminBasename } from "./admin-paths";

describe("admin route base paths", () => {
  it("uses /admin as the browser router basename", () => {
    expect(ADMIN_BASENAME).toBe("/admin");
    expect(ADMIN_BASE_PATH).toBe("/admin/");
  });

  it("prefixes absolute admin paths without creating double /admin segments", () => {
    expect(withAdminBasename("/login")).toBe("/admin/login");
    expect(withAdminBasename("dashboard")).toBe("/admin/dashboard");
    expect(withAdminBasename("/admin/detail-pages/new")).toBe("/admin/detail-pages/new");
  });

  it("recognizes login paths with and without the production basename", () => {
    expect(isAdminLoginPathname("/login")).toBe(true);
    expect(isAdminLoginPathname("/admin/login")).toBe(true);
    expect(isAdminLoginPathname("/admin/dashboard")).toBe(false);
  });

  it("strips the production basename for route matching", () => {
    expect(stripAdminBasename("/admin")).toBe("/");
    expect(stripAdminBasename("/admin/dashboard")).toBe("/dashboard");
    expect(stripAdminBasename("/dashboard")).toBe("/dashboard");
  });
});
