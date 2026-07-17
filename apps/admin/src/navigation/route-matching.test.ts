import { describe, expect, it } from "vitest";
import { adminMenuConfig } from "./menu-config";
import { matchAdminRoute, validOpenKeys } from "./route-matching";

describe("admin route matching", () => {
  it("keeps system configuration as the final unique top-level item", () => {
    const topLevelKeys = adminMenuConfig.map((item) => item.key);

    expect(topLevelKeys).toEqual(["dashboard", "home", "content", "assets", "account", "system-config"]);
    expect(adminMenuConfig.at(-1)?.key).toBe("system-config");
    expect(topLevelKeys.filter((key) => key === "system-config")).toHaveLength(1);
  });

  it("matches nested create/edit routes to their list menu leaf", () => {
    expect(matchAdminRoute("/artists/new")).toMatchObject({
      selectedKeys: ["artists"],
      openKeys: ["content"],
      breadcrumbs: ["内容管理", "人员管理", "新增人员"],
      title: "新增人员"
    });
    expect(matchAdminRoute("/cases/12/edit").selectedKeys).toEqual(["cases"]);
    expect(matchAdminRoute("/detail-pages/8/edit").selectedKeys).toEqual(["detail-pages"]);
  });

  it("matches homepage resource groups and filters persisted open keys", () => {
    expect(matchAdminRoute("/banners").openKeys).toEqual(["home"]);
    expect(matchAdminRoute("/menu-items")).toMatchObject({
      selectedKeys: ["menu-items"],
      openKeys: ["home"],
      breadcrumbs: ["首页运营", "分类菜单"],
      title: "分类菜单"
    });
    expect(matchAdminRoute("/media-assets").breadcrumbs).toEqual(["素材管理", "素材库"]);
    expect(matchAdminRoute("/change-password")).toMatchObject({
      selectedKeys: ["change-password"],
      openKeys: ["account"],
      breadcrumbs: ["账号安全", "修改密码"],
      title: "修改密码"
    });
    expect(matchAdminRoute("/backups")).toMatchObject({
      selectedKeys: ["backups"],
      openKeys: ["account"],
      breadcrumbs: ["账号安全", "备份与恢复"],
      title: "备份与恢复"
    });
    expect(matchAdminRoute("/system-config")).toMatchObject({
      selectedKeys: ["system-config"],
      openKeys: [],
      breadcrumbs: ["系统配置"],
      title: "系统配置"
    });
    expect(validOpenKeys(["home", "content", "account", "unknown"])).toEqual(["home", "content", "account"]);
  });

  it("does not select another menu for unknown or similar-prefix routes", () => {
    expect(matchAdminRoute("/artists-other")).toMatchObject({
      selectedKeys: [],
      openKeys: [],
      title: "未找到页面"
    });
    expect(matchAdminRoute("/case").selectedKeys).toEqual([]);
  });
});
