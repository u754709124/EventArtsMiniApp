import { describe, expect, it } from "vitest";
import { matchAdminRoute, validOpenKeys } from "./route-matching";

describe("admin route matching", () => {
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
    expect(matchAdminRoute("/media-assets").breadcrumbs).toEqual(["素材管理", "素材库"]);
    expect(validOpenKeys(["home", "content", "unknown"])).toEqual(["home", "content"]);
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
