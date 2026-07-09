import { describe, expect, it } from "vitest";
import {
  fail,
  mediaDimensionRules,
  mediaUsageValues,
  menuTypeValues,
  ok,
  type ClientHomeResponse
} from "../src/index";

describe("shared contracts", () => {
  it("keeps the phase-one menu enum fixed to the five supported types", () => {
    expect(menuTypeValues).toEqual(["host", "singer", "actor", "activity_case", "contact"]);
  });

  it("keeps upload usage enum and fixed dimension rules aligned", () => {
    expect(mediaUsageValues).toContain("person_avatar");
    expect(mediaDimensionRules.banner).toEqual({ width: 1420, height: 580 });
    expect(mediaDimensionRules.menu_icon).toEqual({ width: 176, height: 176 });
    expect(mediaDimensionRules.case_cover).toEqual({ width: 460, height: 320 });
    expect(mediaDimensionRules.person_avatar).toBeUndefined();
  });

  it("wraps success and failure responses in the required envelope", () => {
    expect(ok({ value: 1 })).toEqual({ success: true, data: { value: 1 }, message: "ok" });
    expect(fail("BAD_REQUEST", "参数错误")).toEqual({
      success: false,
      error: { code: "BAD_REQUEST", message: "参数错误" }
    });
  });

  it("types client home response with required top-level fields", () => {
    const home: ClientHomeResponse = {
      site: {
        appName: "喜缘主持",
        subtitle: "专业主持人",
        defaultBannerUrl: "",
        placeholderBannerUrl: "",
        placeholderIconUrl: "",
        placeholderCaseUrl: ""
      },
      announcements: [],
      banners: [],
      menus: [],
      featuredCases: []
    };

    expect(Object.keys(home)).toEqual(["site", "announcements", "banners", "menus", "featuredCases"]);
  });
});
