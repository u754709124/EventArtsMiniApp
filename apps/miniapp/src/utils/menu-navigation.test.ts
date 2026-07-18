import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MenuItemDto } from "@event-arts/shared";

const taroMock = vi.hoisted(() => ({
  navigateTo: vi.fn(() => Promise.resolve()),
  switchTab: vi.fn(() => Promise.resolve()),
  setStorageSync: vi.fn(),
  getStorageSync: vi.fn(),
  removeStorageSync: vi.fn()
}));

vi.mock("@tarojs/taro", () => ({ default: taroMock }));
vi.mock("./repeat-click-guard", () => ({
  runGuardedAction: (_key: string, action: () => unknown) => action()
}));

import { menuLabels, menuSummaries, openMenu } from "./menu-navigation";

function menu(type: MenuItemDto["type"], configJson: unknown = {}): MenuItemDto {
  return {
    id: 7,
    text: "测试菜单",
    iconAssetId: 1,
    iconUrl: "/uploads/icon.png",
    type,
    configJson,
    showOnHome: true,
    sortOrder: 1,
    status: "enabled"
  };
}

beforeEach(() => vi.clearAllMocks());

describe("menu navigation", () => {
  it("opens a direct-detail menu through the shared detail-page navigator", () => {
    openMenu(menu("detail_page", { detailPageType: "rich_text", detailPageId: 42 }));

    expect(taroMock.navigateTo).toHaveBeenCalledTimes(1);
    expect(taroMock.navigateTo).toHaveBeenCalledWith({ url: "/pages/detail/index?id=42" });
    expect(taroMock.switchTab).not.toHaveBeenCalled();
  });

  it("ignores missing or invalid direct-detail ids and never accepts arbitrary paths", () => {
    for (const configJson of [
      {},
      { detailPageId: null },
      { detailPageId: 0 },
      { detailPageId: -1 },
      { detailPageId: 1.5 },
      { detailPageId: "42" },
      { detailPageId: 0, url: "/pages/contact/index" }
    ]) {
      openMenu(menu("detail_page", configJson));
    }

    expect(taroMock.navigateTo).not.toHaveBeenCalled();
    expect(taroMock.switchTab).not.toHaveBeenCalled();
  });

  it("keeps existing case and article navigation behavior", () => {
    openMenu(menu("activity_case", { category: "婚礼主持" }));
    expect(taroMock.setStorageSync).toHaveBeenCalledWith("event-arts:case-menu-filter", { category: "婚礼主持" });
    expect(taroMock.switchTab).toHaveBeenCalledWith({ url: "/pages/cases/list" });

    openMenu(menu("article", { category: "婚礼攻略", pageSize: 6 }));
    expect(taroMock.navigateTo).toHaveBeenCalledWith({
      url: "/pages/articles/list?category=%E5%A9%9A%E7%A4%BC%E6%94%BB%E7%95%A5&pageSize=6"
    });
  });

  it("opens artist menus with optional encoded categories", () => {
    openMenu(menu("artist"));
    expect(taroMock.navigateTo).toHaveBeenCalledWith({ url: "/pages/artists/list" });

    openMenu(menu("artist", { category: "儿童主持 / 双语" }));
    expect(taroMock.navigateTo).toHaveBeenCalledWith({
      url: "/pages/artists/list?category=%E5%84%BF%E7%AB%A5%E4%B8%BB%E6%8C%81%20%2F%20%E5%8F%8C%E8%AF%AD"
    });
  });

  it("falls back to the unfiltered artist list for invalid artist menu config", () => {
    openMenu(menu("artist", { category: 42 }));

    expect(taroMock.navigateTo).toHaveBeenCalledWith({ url: "/pages/artists/list" });
  });

  it("maps legacy artist menu types to category-filtered artist lists", () => {
    openMenu({ ...menu("artist"), type: "host" as unknown as MenuItemDto["type"] });

    expect(taroMock.navigateTo).toHaveBeenCalledWith({
      url: "/pages/artists/list?category=%E4%B8%BB%E6%8C%81%E4%BA%BA"
    });
  });

  it("defines display copy for the canonical artist menu type", () => {
    expect(menuLabels.artist).toBe("人员");
    expect(menuSummaries.artist).toBeTruthy();
    expect(menuLabels.detail_page).toBe("详情页直达");
    expect(menuSummaries.detail_page).toBeTruthy();
  });
});
