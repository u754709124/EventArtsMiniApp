import { describe, expect, it } from "vitest";
import {
  ActivityCaseCreateRequestSchema,
  ArtistCreateRequestSchema,
  DetailPageInputSchema,
  detailOwnerTypeValues,
  detailPageTypeDefinitions,
  detailPageTypeLabels,
  detailPageTypeValues,
  mediaFieldRules,
  type DetailPageConfigDto
} from "../src/index";

const richTextHtml = '<section class="ea-detail-card"><p>有效详情</p></section>';

describe("detail page registry", () => {
  it("defines the two phase-one types and two owner types exactly", () => {
    expect(detailPageTypeValues).toEqual(["banner_rich_text", "rich_text"]);
    expect(detailOwnerTypeValues).toEqual(["artist", "activity_case"]);
  });

  it("keeps labels and renderer keys in one exhaustive registry", () => {
    expect(detailPageTypeLabels).toEqual({
      banner_rich_text: "BANNER + 富文本",
      rich_text: "单富文本"
    });
    expect(detailPageTypeDefinitions.banner_rich_text).toMatchObject({
      rendererKey: "bannerRichText",
      requiresBanner: true,
      requiresHeroSubtitle: true,
      requiresRichText: true,
      minBannerCount: 1,
      maxBannerCount: 6,
      bannerAllowedMediaTypes: ["image"],
      configFields: ["heroSubtitle", "banners", "richText"],
      schemaVersion: 1
    });
    expect(detailPageTypeDefinitions.rich_text).toMatchObject({
      rendererKey: "richText",
      requiresBanner: false,
      requiresHeroSubtitle: false,
      requiresRichText: true,
      minBannerCount: 0,
      maxBannerCount: 0,
      bannerAllowedMediaTypes: [],
      configFields: ["richText"],
      schemaVersion: 1
    });
    expect(new Set(Object.values(detailPageTypeDefinitions).map((definition) => definition.rendererKey)).size).toBe(2);
  });
});

describe("detail page input union", () => {
  it("normalizes a valid banner and rich-text request", () => {
    expect(
      DetailPageInputSchema.parse({
        type: "banner_rich_text",
        heroSubtitle: " 温暖・专业・掌控全场 ",
        bannerAssetIds: [10, 11, 12],
        richTextHtml
      })
    ).toEqual({
      type: "banner_rich_text",
      heroSubtitle: "温暖・专业・掌控全场",
      bannerAssetIds: [10, 11, 12],
      richTextHtml
    });
  });

  it("requires one to six unique image IDs and a non-empty subtitle", () => {
    const base = {
      type: "banner_rich_text" as const,
      heroSubtitle: "宣传语",
      bannerAssetIds: [1],
      richTextHtml
    };
    expect(() => DetailPageInputSchema.parse({ ...base, heroSubtitle: "   " })).toThrow();
    expect(() => DetailPageInputSchema.parse({ ...base, heroSubtitle: "甲".repeat(81) })).toThrow();
    expect(() => DetailPageInputSchema.parse({ ...base, bannerAssetIds: [] })).toThrow();
    expect(() => DetailPageInputSchema.parse({ ...base, bannerAssetIds: [1, 2, 3, 4, 5, 6, 7] })).toThrow();
    expect(() => DetailPageInputSchema.parse({ ...base, bannerAssetIds: [1, 1] })).toThrow();
    expect(() => DetailPageInputSchema.parse({ ...base, bannerAssetIds: [0] })).toThrow();
  });

  it("accepts rich text without banner fields and rejects hidden banner data", () => {
    expect(DetailPageInputSchema.parse({ type: "rich_text", richTextHtml })).toEqual({
      type: "rich_text",
      richTextHtml
    });
    expect(() => DetailPageInputSchema.parse({ type: "rich_text", richTextHtml, bannerAssetIds: [1] })).toThrow();
    expect(() => DetailPageInputSchema.parse({ type: "rich_text", richTextHtml, heroSubtitle: "仍然生效" })).toThrow();
  });

  it("rejects missing and unknown types instead of selecting a fallback", () => {
    expect(() => DetailPageInputSchema.parse({ richTextHtml })).toThrow();
    expect(() => DetailPageInputSchema.parse({ type: "unknown", richTextHtml })).toThrow();
  });

  it("requires structurally non-empty HTML before the API semantic sanitizer runs", () => {
    expect(() => DetailPageInputSchema.parse({ type: "rich_text", richTextHtml: "   " })).toThrow();
  });
});

describe("business request integration", () => {
  it("requires nested detailPage for new artists and rejects the deprecated detail input", () => {
    const payload = {
      name: "林然",
      type: "host",
      avatarAssetId: 12,
      location: "杭州",
      badge: "金牌主持",
      tags: ["婚礼主持"],
      summary: "风格大气沉稳。",
      sortOrder: 1,
      status: "enabled",
      detailPage: { type: "rich_text", richTextHtml }
    };
    expect(ArtistCreateRequestSchema.parse(payload).detailPage).toEqual(payload.detailPage);
    expect(() => ArtistCreateRequestSchema.parse({ ...payload, detail: "旧详情" })).toThrow();
  });

  it("requires nested detailPage for new cases", () => {
    const parsed = ActivityCaseCreateRequestSchema.parse({
      title: "品牌发布会",
      category: "商业活动",
      tag: "发布会",
      coverAssetId: 20,
      summary: "项目简介",
      eventDate: "2026-07-11T00:00:00.000Z",
      location: "杭州",
      isFeatured: true,
      featuredSortOrder: 1,
      sortOrder: 1,
      status: "enabled",
      detailPage: { type: "banner_rich_text", heroSubtitle: "精彩现场", bannerAssetIds: [21], richTextHtml }
    });
    expect(parsed.detailPage.type).toBe("banner_rich_text");
    expect(parsed).not.toHaveProperty("detail");
    expect(parsed).not.toHaveProperty("detailMediaAssetIds");
  });

  it("defines media rules for detail banners and rich content", () => {
    expect(mediaFieldRules["detail.banner"]).toMatchObject({ allowedTypes: ["image"], width: null, height: null });
    expect(mediaFieldRules["detail.richText"]).toMatchObject({ allowedTypes: ["image", "video"], width: null, height: null });
  });

  it("types the stable detail page DTO shape", () => {
    const dto: DetailPageConfigDto = {
      type: "rich_text",
      typeLabel: "单富文本",
      rendererKey: "richText",
      schemaVersion: 1,
      heroSubtitle: "",
      banners: [],
      richTextHtml,
      blocks: [{ type: "richText", html: richTextHtml }]
    };
    expect(dto.banners).toEqual([]);
    expect(dto.blocks[0].type).toBe("richText");
  });
});
