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
  enhanceDetailRichTextForPresentation,
  mediaFieldRules,
  collectDetailPageImageUrls,
  getDisplayDetailPageBanners,
  hasSemanticDetailPageContent,
  resolveDetailPagePresentation,
  type DetailPageConfigDto
} from "../src/index";

const richTextHtml = "<h1>有效详情</h1><p>正文</p>";

describe("detail page registry", () => {
  it("binds every registered detail type to an input schema", () => {
    expect(Object.keys(detailPageInputSchemas)).toEqual(detailPageTypeValues);
  });

  it("defines the phase-one detail types and owner types exactly", () => {
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
      schemaVersion: 2
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
      schemaVersion: 2
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
      schemaVersion: 2,
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
      cards: [{ blocks: [{ type: "richText", html: richTextHtml }] }],
      blocks: [{ type: "richText", html: richTextHtml }]
    };
    expect(dto.banners).toEqual([]);
    expect(dto.blocks[0].type).toBe("richText");
  });
});

describe("detail page presentation resolver", () => {
  const dto: DetailPageConfigDto = {
    id: 8,
    name: "  详情名称  ",
    type: "banner_rich_text",
    typeLabel: " BANNER + 富文本 ",
    rendererKey: "bannerRichText",
    schemaVersion: 2,
    hero: {
      title: "  ",
      typeLabel: "  主持人  ",
      subtitle: " ",
      badge: " 推荐 ",
      tags: [" 婚礼主持 ", "", " 控场 "],
      location: " 杭州 ",
      metaItems: [
        { label: " 经验 ", value: " 10年 " },
        { label: "空值", value: " " },
        { label: " ", value: "无效" }
      ]
    },
    heroSubtitle: "  旧宣传语  ",
    banners: [
      { id: 3, assetId: 33, url: " /c.webp ", width: 100, height: 50, sortOrder: 2 },
      { id: 2, assetId: 22, url: "  ", width: 100, height: 50, sortOrder: 0 },
      { id: 4, assetId: 44, url: "/b.webp", width: 100, height: 50, sortOrder: 1 },
      { id: 1, assetId: 11, url: "/a.webp", width: 100, height: 50, sortOrder: 1 }
    ],
    richTextHtml: "<p>正文</p>",
    cards: [
      {
        blocks: [
          { type: "richText", html: '<h1>图文</h1><p><img src="/one.jpg"><img src=" /two.jpg "></p>' },
          { type: "video", assetId: 5, url: " /video.mp4 ", posterUrl: "/poster.jpg", width: 100, height: 50 }
        ]
      }
    ],
    blocks: [
      { type: "richText", html: '<h1>图文</h1><p><img src="/one.jpg"><img src=" /two.jpg "></p>' },
      { type: "video", assetId: 5, url: " /video.mp4 ", posterUrl: "/poster.jpg", width: 100, height: 50 }
    ]
  };

  it("centralizes hero fallback, tag/meta cleanup, banner ordering and semantic content", () => {
    expect(resolveDetailPagePresentation(dto)).toEqual({
      hero: {
        title: "详情名称",
        typeLabel: "主持人",
        subtitle: "旧宣传语",
        badge: "推荐",
        tags: ["婚礼主持", "控场"],
        location: "杭州",
        metaItems: [{ label: "经验", value: "10年" }]
      },
      banners: [
        { id: 1, assetId: 11, url: "/a.webp", width: 100, height: 50, sortOrder: 1 },
        { id: 4, assetId: 44, url: "/b.webp", width: 100, height: 50, sortOrder: 1 },
        { id: 3, assetId: 33, url: "/c.webp", width: 100, height: 50, sortOrder: 2 }
      ],
      cards: dto.cards,
      blocks: dto.blocks,
      hasSemanticContent: true
    });
    expect(getDisplayDetailPageBanners(dto.banners).map((banner) => banner.id)).toEqual([1, 4, 3]);
    expect(collectDetailPageImageUrls(dto.blocks)).toEqual(["/one.jpg", "/two.jpg"]);
  });

  it("treats empty markup and empty media urls as non-semantic", () => {
    expect(hasSemanticDetailPageContent([{ type: "richText", html: "<p>&nbsp;<br></p>" }])).toBe(false);
    expect(hasSemanticDetailPageContent([{ type: "video", assetId: 1, url: " ", posterUrl: null, width: null, height: null }])).toBe(false);
    expect(hasSemanticDetailPageContent([{ type: "richText", html: '<p><img src="/valid.jpg"></p>' }])).toBe(true);
  });

  it("adds centered heading structure and responsive images idempotently", () => {
    const source = [
      "<h1>无样式标题</h1>",
      '<h1 class="title" style="padding-left:99px;color:#333;font-size:96px;font-weight:300">单行标题<strong style="font-size:72px;font-weight:400;color:#b77836">重点</strong></h1>',
      '<h1>多行标题<br><span style="font-size:3em"><em style="font-size:192rpx;background:#fff">第二行</em></span></h1>',
      '<p style="font-size:18px">保留的正文字号</p>',
      '<img data-media-asset-id="9" src="/wide.jpg" alt="宴会厅" loading="lazy" style="width:900px;border:1px solid red">'
    ].join("");
    const enhanced = enhanceDetailRichTextForPresentation(source);

    expect(enhanced).toContain('data-detail-rich-text-target="weapp"');
    expect(enhanced).toContain("font-size:15px;line-height:1.72");
    expect(enhanced.match(/data-detail-heading="true"/gu)).toHaveLength(3);
    expect(enhanced).not.toMatch(/<\/?h1\b/iu);
    expect(enhanced.match(/data-detail-heading-marker="true"/gu)).toHaveLength(3);
    expect(enhanced.match(/data-detail-heading-content="true"/gu)).toHaveLength(3);
    expect(enhanced.match(/display:flex;box-sizing:border-box;align-items:center/gu)).toHaveLength(3);
    expect(enhanced.match(/font-size:17px;font-weight:700;line-height:1\.35/gu)).toHaveLength(3);
    expect(enhanced.match(/font-size:inherit/gu)?.length).toBeGreaterThanOrEqual(6);
    expect(enhanced.match(/font-weight:inherit/gu)?.length).toBeGreaterThanOrEqual(6);
    expect(enhanced.match(/width:3px;height:13px;max-height:13px;margin-right:5px/gu)).toHaveLength(3);
    expect(enhanced.match(/align-self:center/gu)).toHaveLength(3);
    expect(enhanced.match(/display:block;box-sizing:border-box;min-width:0;flex:1/gu)).toHaveLength(3);
    expect(enhanced).toMatch(/单行标题<strong[^>]*font-size:inherit[^>]*>重点<\/strong>/u);
    expect(enhanced).toMatch(/多行标题<br[^>]*font-size:inherit[^>]*>.*第二行/su);
    expect(enhanced).toContain("width:100%;max-width:100%;height:auto");
    expect(enhanced).toContain("color:#333");
    expect(enhanced).toContain("color:#b77836");
    expect(enhanced).toContain("background:#fff");
    expect(enhanced).toContain('<p style="font-size:18px">保留的正文字号</p>');
    expect(enhanced).not.toContain("font-size:96px");
    expect(enhanced).not.toContain("font-size:72px");
    expect(enhanced).not.toContain("font-size:3em");
    expect(enhanced).not.toContain("font-size:192rpx");
    expect(enhanced).not.toContain("font-weight:300");
    expect(enhanced).not.toContain("font-weight:400");
    expect(enhanced).toContain("border:1px solid red");
    expect(enhanced).toContain('data-media-asset-id="9"');
    expect(enhanced).toContain('alt="宴会厅"');
    expect(enhanced).toContain('loading="lazy"');
    expect(enhanced).not.toContain("padding-left:99px");
    expect(enhanced).not.toContain("width:900px");
    expect(enhanced).not.toContain("vertical-align");
    expect(enhanced).not.toContain("margin-left");
    expect(enhanceDetailRichTextForPresentation(enhanced)).toBe(enhanced);

    const adminEnhanced = enhanceDetailRichTextForPresentation(source, { target: "admin" });
    expect(adminEnhanced).toContain('data-detail-rich-text-target="admin"');
    expect(adminEnhanced.match(/<h1\b/gu)).toHaveLength(3);
    expect(adminEnhanced.match(/font-size:17px;font-weight:700;line-height:1\.35/gu)).toHaveLength(3);
    expect(enhanceDetailRichTextForPresentation(adminEnhanced, { target: "admin" })).toBe(adminEnhanced);
  });

  it("upgrades V2 same-target output before becoming idempotent", () => {
    const v2 = '<div data-detail-rich-text-root="true" data-detail-rich-text-target="weapp" style="font-size:15px;line-height:1.72"><div data-detail-heading="true" style="font-size:16px;line-height:1.35"><span data-detail-heading-marker="true"></span><span data-detail-heading-content="true">旧标题</span></div><p>正文</p></div>';
    const upgraded = enhanceDetailRichTextForPresentation(v2, { target: "weapp" });

    expect(upgraded).toContain('data-detail-rich-text-version="3"');
    expect(upgraded).toContain("font-size:17px;font-weight:700;line-height:1.35");
    expect(upgraded).not.toContain("font-size:16px");
    expect(enhanceDetailRichTextForPresentation(upgraded, { target: "weapp" })).toBe(upgraded);
  });

  it("migrates the previous baseline-offset marker without duplicating nodes", () => {
    const legacy = [
      '<h1 style="display:block;padding-left:0.6em">',
      '<span data-detail-heading-marker="true" style="height:1em;margin-left:-0.6em;vertical-align:text-top"></span>',
      "旧版标题<br>第二行",
      "</h1>"
    ].join("");
    const enhanced = enhanceDetailRichTextForPresentation(legacy);

    expect(enhanced.match(/data-detail-heading-marker="true"/gu)).toHaveLength(1);
    expect(enhanced.match(/data-detail-heading-content="true"/gu)).toHaveLength(1);
    expect(enhanced).toContain("display:flex");
    expect(enhanced).toContain("align-items:center");
    expect(enhanced).not.toContain("text-top");
    expect(enhanced).not.toContain("margin-left:-0.6em");
    expect(enhanced).not.toMatch(/<\/?h1\b/iu);
    expect(enhanceDetailRichTextForPresentation(enhanced)).toBe(enhanced);
  });
});
