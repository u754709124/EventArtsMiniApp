import { matchPath } from "react-router-dom";
import { adminMenuConfig, isMenuGroup, menuLeaves, type AdminMenuGroup, type AdminMenuLeaf } from "./menu-config";

export type AdminRouteMatch = {
  leaf?: AdminMenuLeaf;
  group?: AdminMenuGroup;
  selectedKeys: string[];
  openKeys: string[];
  breadcrumbs: string[];
  title: string;
};

function routeActionTitle(pathname: string, leaf: AdminMenuLeaf) {
  if (pathname.endsWith("/new")) {
    if (leaf.key === "artists") return "新增人员";
    if (leaf.key === "cases") return "新增案例";
    if (leaf.key === "detail-pages") return "新增详情页";
    return "新增";
  }
  if (/\/[^/]+\/edit$/.test(pathname)) {
    if (leaf.key === "artists") return "编辑人员";
    if (leaf.key === "cases") return "编辑案例";
    if (leaf.key === "detail-pages") return "编辑详情页";
    return "编辑";
  }
  return null;
}

export function matchAdminRoute(pathname: string): AdminRouteMatch {
  const normalized = pathname === "/" ? "/dashboard" : pathname;
  const leaf = menuLeaves().find((item) =>
    item.matchPaths.some((pattern) => Boolean(matchPath({ path: pattern, end: true }, normalized)))
  );

  if (!leaf) {
    return {
      selectedKeys: [],
      openKeys: [],
      breadcrumbs: ["未找到页面"],
      title: "未找到页面"
    };
  }

  const action = routeActionTitle(normalized, leaf);
  const breadcrumbs = leaf.group ? [leaf.group.breadcrumb, leaf.breadcrumb] : [leaf.breadcrumb];
  if (action) breadcrumbs.push(action);

  return {
    leaf,
    group: leaf.group,
    selectedKeys: [leaf.key],
    openKeys: leaf.group ? [leaf.group.key] : [],
    breadcrumbs,
    title: action ?? leaf.label
  };
}

export function defaultOpenKeys() {
  return adminMenuConfig.filter(isMenuGroup).map((item) => item.key);
}

export function validOpenKeys(keys: string[]) {
  const groups = new Set(adminMenuConfig.filter(isMenuGroup).map((item) => item.key));
  return keys.filter((key) => groups.has(key));
}
