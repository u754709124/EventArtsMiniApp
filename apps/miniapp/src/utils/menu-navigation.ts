import Taro from "@tarojs/taro";
import type { MenuItemDto, MenuType } from "@event-arts/shared";
import { navigateToDetailPage } from "./detail-page-navigation";
import { runGuardedAction } from "./repeat-click-guard";

export const menuLabels: Record<MenuType, string> = {
  artist: "人员",
  activity_case: "活动案例",
  article: "文章",
  detail_page: "详情页直达",
  contact: "联系我们"
};

export const menuSummaries: Record<MenuType, string> = {
  artist: "按人员分类浏览主持、歌手与演艺服务",
  activity_case: "浏览真实活动案例与现场效果",
  article: "阅读婚礼攻略与活动策划经验",
  detail_page: "直接查看精选服务与活动详情",
  contact: "咨询档期、报价与合作方式"
};

const menuRoutes: Record<MenuType, string> = {
  artist: "/pages/artists/list",
  activity_case: "/pages/cases/list",
  article: "/pages/articles/list",
  detail_page: "/pages/detail/index",
  contact: "/pages/contact/index"
};

const caseMenuFilterStorageKey = "event-arts:case-menu-filter";
const legacyArtistCategoryMap: Record<string, string> = {
  host: "主持人",
  singer: "歌手",
  actor: "演员"
};

type CaseMenuFilter = {
  category?: string;
};

export function ignoreNavigationError(result: Promise<unknown> | void) {
  if (result && typeof result.catch === "function") {
    result.catch(() => undefined);
  }
}

function isMenuItemLike(value: MenuItemDto | MenuType | string): value is MenuItemDto {
  return typeof value === "object" && value !== null && "type" in value;
}

function getMenuConfig(menu: MenuItemDto | MenuType | string) {
  return isMenuItemLike(menu) && typeof menu.configJson === "object" && menu.configJson !== null
    ? menu.configJson as Record<string, unknown>
    : {};
}

function normalizeMenuType(menu: MenuItemDto | MenuType | string): MenuType | undefined {
  const rawType = String(isMenuItemLike(menu) ? menu.type : menu);
  if (rawType in legacyArtistCategoryMap) return "artist";
  return rawType in menuRoutes ? (rawType as MenuType) : undefined;
}

function setPendingCaseMenuFilter(menu: MenuItemDto | MenuType | string) {
  const rawCategory = getMenuConfig(menu).category;
  const category = typeof rawCategory === "string" ? rawCategory.trim() : "";
  try {
    Taro.setStorageSync(caseMenuFilterStorageKey, { category });
  } catch {
    // Storage can be unavailable in some H5 test runtimes; fall through to unfiltered list.
  }
}

function articleMenuUrl(menu: MenuItemDto | MenuType | string) {
  const config = getMenuConfig(menu);
  const entries: string[] = [];
  const category = typeof config.category === "string" ? config.category.trim() : "";
  const pageSize = Number(config.pageSize);
  if (category) entries.push(`category=${encodeURIComponent(category)}`);
  if (Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 50) entries.push(`pageSize=${pageSize}`);
  return `/pages/articles/list${entries.length ? `?${entries.join("&")}` : ""}`;
}

function artistMenuUrl(menu: MenuItemDto | MenuType | string) {
  const config = getMenuConfig(menu);
  const rawMenuType = String(isMenuItemLike(menu) ? menu.type : menu);
  const configuredCategory = typeof config.category === "string" ? config.category.trim() : "";
  const category = configuredCategory || legacyArtistCategoryMap[rawMenuType] || "";
  return category ? `/pages/artists/list?category=${encodeURIComponent(category)}` : "/pages/artists/list";
}

function detailPageMenuId(menu: MenuItemDto | MenuType | string) {
  const detailPageId = getMenuConfig(menu).detailPageId;
  return Number.isInteger(detailPageId) && Number(detailPageId) > 0 ? Number(detailPageId) : null;
}

function contactMenuUrl(menu: MenuItemDto | MenuType | string) {
  return isMenuItemLike(menu) && Number.isInteger(menu.id) && menu.id > 0
    ? `/pages/contact/index?menuId=${menu.id}`
    : "/pages/contact/index";
}

export function consumePendingCaseMenuFilter(): CaseMenuFilter | undefined {
  try {
    const value = Taro.getStorageSync<CaseMenuFilter>(caseMenuFilterStorageKey);
    Taro.removeStorageSync(caseMenuFilterStorageKey);
    return value && typeof value === "object" ? value : undefined;
  } catch {
    return undefined;
  }
}

export function openMenu(menu: MenuItemDto | MenuType | string) {
  const menuType = normalizeMenuType(menu);
  if (!menuType) return;
  if (menuType === "detail_page") {
    const detailPageId = detailPageMenuId(menu);
    if (detailPageId !== null) navigateToDetailPage(detailPageId);
    return;
  }
  const url = menuRoutes[menuType];
  if (!url) return;
  runGuardedAction(`menu:navigate:${menuType}:${url}`, () => {
    if (menuType === "activity_case") {
      setPendingCaseMenuFilter(menu);
      ignoreNavigationError(Taro.switchTab({ url }));
      return;
    }
    if (menuType === "article") {
      ignoreNavigationError(Taro.navigateTo({ url: articleMenuUrl(menu) }));
      return;
    }
    if (menuType === "artist") {
      ignoreNavigationError(Taro.navigateTo({ url: artistMenuUrl(menu) }));
      return;
    }
    if (menuType === "contact") {
      ignoreNavigationError(Taro.navigateTo({ url: contactMenuUrl(menu) }));
      return;
    }
    ignoreNavigationError(Taro.navigateTo({ url }));
  });
}
