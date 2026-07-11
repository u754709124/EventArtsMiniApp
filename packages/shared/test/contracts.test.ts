import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ArtistCreateRequestSchema,
  artistListQuerySchema,
  artistTypeLabels,
  batchDeleteMediaRequestSchema,
  fail,
  mediaFieldRules,
  mediaListQuerySchema,
  menuTypeValues,
  normalizeArtistTags,
  normalizeResourceName,
  ok,
  serializeArtistTags,
  updateMediaMetadataSchema,
  type ActivityCaseDetailDto,
  type ActivityCaseListItemDto,
  type ArtistDetailDto,
  type ArtistListItemDto,
  type ClientHomeResponse,
  type DetailPageConfigDto
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

  it("separates list summaries from required detail-page DTOs", () => {
    expectTypeOf<ArtistListItemDto>().not.toMatchTypeOf<{ detailPage: DetailPageConfigDto }>();
    expectTypeOf<ActivityCaseListItemDto>().not.toMatchTypeOf<{ detailPage: DetailPageConfigDto }>();
    expectTypeOf<ClientHomeResponse["featuredCases"][number]>().not.toMatchTypeOf<{ detailPage: DetailPageConfigDto }>();
    expectTypeOf<ArtistDetailDto>().toMatchTypeOf<{ detailPage: DetailPageConfigDto }>();
    expectTypeOf<ActivityCaseDetailDto>().toMatchTypeOf<{ detailPage: DetailPageConfigDto }>();
  });

  it("normalizes artist tags once and exposes Chinese artist labels", () => {
    expect(artistTypeLabels).toEqual({ host: "主持人", singer: "歌手", actor: "演员" });
    expect(normalizeArtistTags(["  婚礼主持 ", "婚礼主持", "", "高端晚宴"])).toEqual(["婚礼主持", "高端晚宴"]);
    expect(normalizeArtistTags('["婚礼主持", "高端晚宴"]')).toEqual(["婚礼主持", "高端晚宴"]);
    expect(normalizeArtistTags('"[\\"婚礼主持\\"]"')).toEqual([]);
    expect(serializeArtistTags('["婚礼主持", "高端晚宴"]')).toBe('["婚礼主持","高端晚宴"]');
  });

  it("validates the complete artist create payload and strict client list query", () => {
    expect(
      ArtistCreateRequestSchema.parse({
        name: " 林然 ",
        type: "host",
        avatarAssetId: 12,
        location: " 杭州 ",
        badge: " 金牌主持 ",
        tags: ["10年经验", "婚礼主持"],
        summary: " 风格大气沉稳。 ",
        detailPage: { type: "rich_text", richTextHtml: "<p>详情内容</p>" },
        sortOrder: 1,
        status: "enabled"
      })
    ).toMatchObject({ name: "林然", location: "杭州", badge: "金牌主持", tags: ["10年经验", "婚礼主持"] });
    expect(
      ArtistCreateRequestSchema.parse({
        name: "旧记录",
        type: "host",
        avatarAssetId: 13,
        location: "杭州",
        badge: "金牌主持",
        tagsJson: '["婚礼主持", "婚礼主持"]',
        summary: "简介",
        detailPage: { type: "rich_text", richTextHtml: "<p>详情</p>" },
        sortOrder: 1,
        status: "enabled"
      }).tags
    ).toEqual(["婚礼主持"]);
    expect(() => ArtistCreateRequestSchema.parse({
      name: "林然",
      type: "host",
      location: "杭州",
      badge: "金牌主持",
      tags: [],
      summary: "简介",
      detailPage: { type: "rich_text", richTextHtml: "<p>详情</p>" },
      sortOrder: 1,
      status: "enabled"
    })).toThrow();
    expect(() => ArtistCreateRequestSchema.parse({
      name: "林然",
      type: "host",
      avatarAssetId: 14,
      location: "杭州",
      badge: "金牌主持",
      tags: ["超过十二个字符的标签内容啊"],
      summary: "简介",
      detailPage: { type: "rich_text", richTextHtml: "<p>详情</p>" },
      sortOrder: 1,
      status: "enabled"
    })).toThrow();
    expect(artistListQuerySchema.parse({ q: " 林 ", tag: " 婚礼主持 " })).toEqual({
      type: "host",
      q: "林",
      tag: "婚礼主持"
    });
    expect(() => artistListQuerySchema.parse({ type: "invalid" })).toThrow();
  });
});
