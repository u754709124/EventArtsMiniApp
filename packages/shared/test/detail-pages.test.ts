import { describe, expect, it } from "vitest";
import {
  ActivityCaseCreateRequestSchema,
  ArtistCreateRequestSchema,
  DetailPageInputSchema,
  detailPageInputSchemaOptions,
  detailPageInputSchemas,
  detailOwnerTypeValues,
  detailPageTypeDefinitions,
  detailPageTypeLabels,
  detailPageTypeValues,
  mediaFieldRules,
  type DetailPageConfigDto
} from "../src/index";

const richTextHtml = '<section class="ea-detail-card"><p>有效详情</p></section>';

describe("detail page registry", () => {
  it("binds every registered detail type to an input schema", () => {
    expect(Object.keys(detailPageInputSchemas)).toEqual(detailPageTypeValues);
  });

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
      configFields: [
        "heroTitle",
        "heroTypeLabel",
        "heroSubtitle",
        "heroBadge",
        "heroTags",
        "heroLocation",
        "heroMetaItems",
        "banners",
        "richText"
      ],
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
  it("derives all discriminated-union options from the complete schema registry", () => {
    const registryOptions = Object.values(detailPageInputSchemas);
    const registryTypes = registryOptions.map((schema) => schema.shape.type.value);
    const unionTypes = DetailPageInputSchema.options.map((schema) => schema.shape.type.value);

    expect(detailPageInputSchemaOptions).toEqual(registryOptions);
    expect(unionTypes).toEqual(registryTypes);
    expect(new Set(unionTypes)).toEqual(new Set(detailPageTypeValues));
    expect(unionTypes).toHaveLength(detailPageTypeValues.length);
  });

  it("normalizes a valid banner and rich-text request", () => {
    expect(
      DetailPageInputSchema.parse({
        name: " 林然详情 ",
        type: "banner_rich_text",
        hero: {
          title: " 林然 ",
          typeLabel: " 主持人 ",
          subtitle: " 温暖・专业・掌控全场 ",
          badge: " 金牌主持 ",
          tags: ["婚礼主持", "婚礼主持", "高端晚宴"],
          location: " 杭州 ",
          metaItems: [{ label: "经验", value: "10年" }]
        },
        bannerAssetIds: [10, 11, 12],
        richTextHtml
      })
    ).toEqual({
      name: "林然详情",
      type: "banner_rich_text",
      hero: {
        title: "林然",
        typeLabel: "主持人",
        subtitle: "温暖・专业・掌控全场",
        badge: "金牌主持",
        tags: ["婚礼主持", "高端晚宴"],
        location: "杭州",
        metaItems: [{ label: "经验", value: "10年" }]
      },
      bannerAssetIds: [10, 11, 12],
      richTextHtml
    });
  });

  it("requires one to six unique image IDs and a non-empty subtitle", () => {
    const base = {
      name: "详情页",
      type: "banner_rich_text" as const,
      hero: {
        title: "标题",
        typeLabel: "",
        subtitle: "宣传语",
        badge: "",
        tags: [],
        location: "",
        metaItems: []
      },
      bannerAssetIds: [1],
      richTextHtml
    };
    expect(() => DetailPageInputSchema.parse({ ...base, hero: { ...base.hero, subtitle: "   " } })).toThrow();
    expect(() => DetailPageInputSchema.parse({ ...base, hero: { ...base.hero, subtitle: "甲".repeat(81) } })).toThrow();
    expect(() => DetailPageInputSchema.parse({ ...base, bannerAssetIds: [] })).toThrow();
    expect(() => DetailPageInputSchema.parse({ ...base, bannerAssetIds: [1, 2, 3, 4, 5, 6, 7] })).toThrow();
    expect(() => DetailPageInputSchema.parse({ ...base, bannerAssetIds: [1, 1] })).toThrow();
    expect(() => DetailPageInputSchema.parse({ ...base, bannerAssetIds: [0] })).toThrow();
  });

  it("accepts rich text without banner fields and rejects hidden banner data", () => {
    expect(DetailPageInputSchema.parse({ name: "普通详情", type: "rich_text", richTextHtml })).toEqual({
      name: "普通详情",
      type: "rich_text",
      richTextHtml
    });
    expect(() => DetailPageInputSchema.parse({ name: "普通详情", type: "rich_text", richTextHtml, bannerAssetIds: [1] })).toThrow();
    expect(() => DetailPageInputSchema.parse({ name: "普通详情", type: "rich_text", richTextHtml, hero: { title: "标题", subtitle: "仍然生效" } })).toThrow();
  });

  it("rejects missing and unknown types instead of selecting a fallback", () => {
    expect(() => DetailPageInputSchema.parse({ name: "普通详情", richTextHtml })).toThrow();
    expect(() => DetailPageInputSchema.parse({ name: "普通详情", type: "unknown", richTextHtml })).toThrow();
  });

  it("requires structurally non-empty HTML before the API semantic sanitizer runs", () => {
    expect(() => DetailPageInputSchema.parse({ name: "普通详情", type: "rich_text", richTextHtml: "   " })).toThrow();
  });
});

describe("business request integration", () => {
  it("accepts nullable detailPageId for artists and rejects nested detail config", () => {
    const payload = {
      name: "林然",
      type: "host",
      avatarAssetId: 12,
      location: "杭州",
      badge: "金牌主持",
      tags: ["婚礼主持"],
      summary: "风格大气沉稳。",
      detailPageId: 12,
      sortOrder: 1,
      status: "enabled"
    };
    expect(ArtistCreateRequestSchema.parse(payload).detailPageId).toBe(12);
    expect(ArtistCreateRequestSchema.parse({ ...payload, detailPageId: null }).detailPageId).toBeNull();
    expect(() => ArtistCreateRequestSchema.parse({ ...payload, detailPage: { type: "rich_text", richTextHtml } })).toThrow();
    expect(() => ArtistCreateRequestSchema.parse({ ...payload, detail: "旧详情" })).toThrow();
  });

  it("accepts nullable detailPageId for cases", () => {
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
      detailPageId: null
    });
    expect(parsed.detailPageId).toBeNull();
    expect(parsed).not.toHaveProperty("detail");
    expect(parsed).not.toHaveProperty("detailPage");
    expect(parsed).not.toHaveProperty("detailMediaAssetIds");
  });

  it("defines media rules for detail banners and rich content", () => {
    expect(mediaFieldRules["detail.banner"]).toMatchObject({ allowedTypes: ["image"], width: null, height: null });
    expect(mediaFieldRules["detail.richText"]).toMatchObject({ allowedTypes: ["image", "video"], width: null, height: null });
  });

  it("types the stable detail page DTO shape", () => {
    const dto: DetailPageConfigDto = {
      id: 1,
      name: "普通详情",
      type: "rich_text",
      typeLabel: "单富文本",
      rendererKey: "richText",
      schemaVersion: 1,
      hero: {
        title: "",
        typeLabel: "",
        subtitle: "",
        badge: "",
        tags: [],
        location: "",
        metaItems: []
      },
      heroSubtitle: "",
      banners: [],
      richTextHtml,
      blocks: [{ type: "richText", html: richTextHtml }]
    };
    expect(dto.banners).toEqual([]);
    expect(dto.blocks[0].type).toBe("richText");
  });
});
