import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ArtistCreateRequestSchema,
  ArticleCreateRequestSchema,
  MenuItemCreateRequestSchema,
  MenuItemUpdateRequestSchema,
  adminArticleListQuerySchema,
  artistListQuerySchema,
  artistTypeLabels,
  batchDeleteMediaRequestSchema,
  caseListQuerySchema,
  clientArticleListQuerySchema,
  fail,
  mediaFieldRules,
  mediaListQuerySchema,
  menuConfigSchemaByType,
  menuTypeValues,
  normalizeArticleCategories,
  normalizeArticleCategory,
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
  it("keeps the phase-one menu enum aligned with supported home menu types", () => {
    expect(menuTypeValues).toEqual(["host", "singer", "actor", "activity_case", "article", "contact"]);
  });

  it("validates menu item create and update requests strictly", () => {
    expect(
      MenuItemCreateRequestSchema.parse({
        text: " 联系我们 ",
        iconAssetId: "5",
        type: "contact",
        configJson: { phone: "13800001111" },
        sortOrder: "2",
        status: "enabled"
      })
    ).toMatchObject({
      text: "联系我们",
      iconAssetId: 5,
      showOnHome: true,
      sortOrder: 2
    });
    expect(MenuItemUpdateRequestSchema.parse({ text: "主持人" })).toEqual({ text: "主持人" });
    expect(() => MenuItemUpdateRequestSchema.parse({ type: "bad" })).toThrow();
    expect(() => MenuItemUpdateRequestSchema.parse({ text: "主持人", iconUrl: "/uploads/icon.png" })).toThrow();
    expect(menuConfigSchemaByType.activity_case.parse({ category: " 婚礼主持 ", onlyFeatured: true, pageSize: 6 }))
      .toEqual({ category: "婚礼主持", onlyFeatured: true, pageSize: 6 });
    expect(menuConfigSchemaByType.activity_case.parse({ category: "   ", onlyFeatured: false, pageSize: 6 }))
      .toEqual({ category: undefined, onlyFeatured: false, pageSize: 6 });
    expect(menuConfigSchemaByType.article.parse({ category: " 婚礼攻略 ", pageSize: 6 }))
      .toEqual({ category: "婚礼攻略", pageSize: 6 });
    expect(menuConfigSchemaByType.article.parse({ category: "   " })).toEqual({ category: undefined, pageSize: 10 });
    expect(() => menuConfigSchemaByType.article.parse({ pageSize: 51 })).toThrow();
  });

  it("normalizes and validates article contracts", () => {
    expect(normalizeArticleCategory("  Ｗedding   Guide  ")).toBe("Wedding Guide");
    expect(normalizeArticleCategories([" Guide ", "guide", "婚礼攻略", "婚礼攻略 "])).toEqual(["Guide", "婚礼攻略"]);
    expect(
      ArticleCreateRequestSchema.parse({
        title: " 婚礼攻略 ",
        category: " 婚礼   攻略 ",
        coverAssetId: "3",
        summary: " 摘要 ",
        publishedAt: "2026-07-12T08:00:00.000Z",
        isFeatured: true,
        featuredSortOrder: "1",
        sortOrder: "2",
        status: "enabled",
        detailPageId: null
      })
    ).toMatchObject({
      title: "婚礼攻略",
      category: "婚礼 攻略",
      coverAssetId: 3,
      summary: "摘要",
      isFeatured: true,
      featuredSortOrder: 1,
      sortOrder: 2,
      detailPageId: null
    });
    expect(clientArticleListQuerySchema.parse({ category: " 婚礼攻略 ", pageSize: "50" })).toMatchObject({
      category: "婚礼攻略",
      page: 1,
      pageSize: 50
    });
    expect(adminArticleListQuerySchema.parse({ isFeatured: "true", status: "enabled" })).toMatchObject({
      isFeatured: true,
      status: "enabled"
    });
    expect(() => ArticleCreateRequestSchema.parse({
      title: "文章",
      category: "婚礼攻略",
      coverAssetId: 1,
      summary: "摘要",
      publishedAt: "2026/07/12",
      isFeatured: false,
      featuredSortOrder: 0,
      sortOrder: 0,
      status: "enabled",
      detailPageId: null
    })).toThrow();
    expect(() => ArticleCreateRequestSchema.parse({
      title: "文章",
      category: "",
      coverAssetId: 1,
      summary: "摘要",
      publishedAt: "not-a-date",
      isFeatured: false,
      featuredSortOrder: 0,
      sortOrder: 0,
      status: "enabled",
      detailPageId: null
    })).toThrow();
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
    expect(mediaFieldRules["article.cover"]).toMatchObject({ allowedTypes: ["image"], width: null, height: null });
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
      featuredCases: [],
      featuredArticles: []
    };

    expect(Object.keys(home)).toEqual(["site", "announcements", "banners", "menus", "featuredCases", "featuredArticles"]);
  });

  it("separates list summaries from required detail-page DTOs", () => {
    expectTypeOf<ArtistListItemDto>().not.toMatchTypeOf<{ detailPage: DetailPageConfigDto }>();
    expectTypeOf<ActivityCaseListItemDto>().not.toMatchTypeOf<{ detailPage: DetailPageConfigDto }>();
    expectTypeOf<ClientHomeResponse["featuredCases"][number]>().not.toMatchTypeOf<{ detailPage: DetailPageConfigDto }>();
    expectTypeOf<ArtistListItemDto>().toMatchTypeOf<{ detailPageId: number | null; hasDetailPage: boolean }>();
    expectTypeOf<ActivityCaseListItemDto>().toMatchTypeOf<{ detailPageId: number | null; hasDetailPage: boolean }>();
    expectTypeOf<ArtistDetailDto>().toMatchTypeOf<{ detailPage: DetailPageConfigDto | null }>();
    expectTypeOf<ActivityCaseDetailDto>().toMatchTypeOf<{ detailPage: DetailPageConfigDto | null }>();
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
        detailPageId: null,
        sortOrder: 1,
        status: "enabled"
      })
    ).toMatchObject({ name: "林然", location: "杭州", badge: "金牌主持", tags: ["10年经验", "婚礼主持"], detailPageId: null });
    expect(
      ArtistCreateRequestSchema.parse({
        name: "旧记录",
        type: "host",
        avatarAssetId: 13,
        location: "杭州",
        badge: "金牌主持",
        tagsJson: '["婚礼主持", "婚礼主持"]',
        summary: "简介",
        detailPageId: 8,
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
      detailPageId: null,
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
      detailPageId: null,
      sortOrder: 1,
      status: "enabled"
    })).toThrow();
    expect(artistListQuerySchema.parse({ q: " 林 ", tag: " 婚礼主持 " })).toEqual({
      type: "host",
      q: "林",
      tag: "婚礼主持"
    });
    expect(caseListQuerySchema.parse({ q: " 年会 ", category: " 歌手演出 " })).toEqual({ q: "年会", category: "歌手演出" });
    expect(caseListQuerySchema.parse({ q: "   ", category: "   " })).toEqual({ q: undefined, category: undefined });
    expect(() => artistListQuerySchema.parse({ type: "invalid" })).toThrow();
  });
});
