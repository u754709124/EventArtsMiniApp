import { describe, expect, it } from "vitest";
import {
  batchDeleteMediaRequestSchema,
  fail,
  mediaFieldRules,
  mediaListQuerySchema,
  menuTypeValues,
  normalizeResourceName,
  ok,
  updateMediaMetadataSchema,
  type ClientHomeResponse
} from "../src/index";

describe("shared contracts", () => {
  it("keeps the phase-one menu enum fixed to the five supported types", () => {
    expect(menuTypeValues).toEqual(["host", "singer", "actor", "activity_case", "contact"]);
  });

  it("normalizes resource names for global case-insensitive uniqueness", () => {
    expect(normalizeResourceName("  Ｄｅｍｏ资源  ")).toEqual({
      displayName: "Demo资源",
      key: "demo资源"
    });
  });

  it("defines media requirements per form field instead of upload usage", () => {
    expect(mediaFieldRules["banner.image"]).toMatchObject({
      allowedTypes: ["image"],
      width: 1420,
      height: 580
    });
    expect(mediaFieldRules["menu.icon"]).toMatchObject({ width: 176, height: 176 });
    expect(mediaFieldRules["case.cover"]).toMatchObject({ width: 460, height: 320 });
    expect(mediaFieldRules["artist.avatar"]).toMatchObject({ width: null, height: null });
    expect(mediaFieldRules["case.detail"]).toMatchObject({ allowedTypes: ["image", "video"] });
  });

  it("validates media list, metadata edit and batch delete inputs", () => {
    expect(mediaListQuerySchema.parse({ page: "2", pageSize: "20", mediaType: "image" })).toMatchObject({
      page: 2,
      pageSize: 20,
      mediaType: "image"
    });
    expect(updateMediaMetadataSchema.parse({ resourceName: " 舞台图 ", tags: [" 婚礼 ", "婚礼", ""] })).toEqual({
      resourceName: "舞台图",
      tags: ["婚礼"]
    });
    expect(batchDeleteMediaRequestSchema.parse({ ids: [3, 3, 4] })).toEqual({ ids: [3, 4] });
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
