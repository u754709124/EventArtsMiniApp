import Taro from "@tarojs/taro";
import type { MenuItemDto, MenuType } from "@event-arts/shared";

export const menuLabels: Record<MenuType, string> = {
  host: "主持人",
  singer: "歌手",
  actor: "演员",
  activity_case: "活动案例",
  article: "文章",
  contact: "联系我们"
};

export const menuSummaries: Record<MenuType, string> = {
  host: "寻找适合活动风格的专业主持人",
  singer: "发现适合现场氛围的实力歌手",
  actor: "挑选丰富活动体验的演艺人员",
  activity_case: "浏览真实活动案例与现场效果",
  article: "阅读婚礼攻略与活动策划经验",
  contact: "咨询档期、报价与合作方式"
};

const menuRoutes: Record<MenuType, string> = {
  host: "/pages/artists/list?type=host",
  singer: "/pages/artists/list?type=singer",
  actor: "/pages/artists/list?type=actor",
  activity_case: "/pages/cases/list",
  article: "/pages/articles/list",
  contact: "/pages/contact/index"
};

const caseMenuFilterStorageKey = "event-arts:case-menu-filter";

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
  const menuType = (isMenuItemLike(menu) ? menu.type : menu) as MenuType;
  const url = menuRoutes[menuType];
  if (!url) return;
  if (menuType === "activity_case") {
    setPendingCaseMenuFilter(menu);
    ignoreNavigationError(Taro.switchTab({ url }));
    return;
  }
  if (menuType === "article") {
    ignoreNavigationError(Taro.navigateTo({ url: articleMenuUrl(menu) }));
    return;
  }
  ignoreNavigationError(Taro.navigateTo({ url }));
}
