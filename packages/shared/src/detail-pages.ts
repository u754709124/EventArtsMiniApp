import { z } from "zod";

export const detailPageTypeValues = ["banner_rich_text", "rich_text"] as const;
export const detailOwnerTypeValues = ["artist", "activity_case"] as const;

export type DetailPageType = (typeof detailPageTypeValues)[number];
export type DetailOwnerType = (typeof detailOwnerTypeValues)[number];

export type DetailPageConfigField =
  | "heroTitle"
  | "heroTypeLabel"
  | "heroSubtitle"
  | "heroBadge"
  | "heroTags"
  | "heroLocation"
  | "heroMetaItems"
  | "banners"
  | "richText";
export type DetailPageRendererKey = "bannerRichText" | "richText";

export type DetailPageTypeDefinition = {
  label: string;
  description: string;
  rendererKey: DetailPageRendererKey;
  requiresBanner: boolean;
  requiresHeroSubtitle: boolean;
  requiresRichText: boolean;
  minBannerCount: number;
  maxBannerCount: number;
  bannerAllowedMediaTypes: readonly ("image" | "video")[];
  configFields: readonly DetailPageConfigField[];
  schemaVersion: number;
};

export const detailPageTypeDefinitions = {
  banner_rich_text: {
    label: "BANNER + 富文本",
    description: "适合人员主页、重点案例等视觉型详情页",
    rendererKey: "bannerRichText",
    requiresBanner: true,
    requiresHeroSubtitle: false,
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
  },
  rich_text: {
    label: "单富文本",
    description: "适合普通图文介绍和说明类详情页",
    rendererKey: "richText",
    requiresBanner: false,
    requiresHeroSubtitle: false,
    requiresRichText: true,
    minBannerCount: 0,
    maxBannerCount: 0,
    bannerAllowedMediaTypes: [],
    configFields: ["richText"],
    schemaVersion: 2
  }
} as const satisfies Record<DetailPageType, DetailPageTypeDefinition>;

export const detailPageTypeLabels = {
  banner_rich_text: detailPageTypeDefinitions.banner_rich_text.label,
  rich_text: detailPageTypeDefinitions.rich_text.label
} as const satisfies Record<DetailPageType, string>;

export const DetailPageTypeSchema = z.enum(detailPageTypeValues);
export const DetailOwnerTypeSchema = z.enum(detailOwnerTypeValues);

const positiveAssetIdSchema = z.coerce.number().int().positive();
const positiveIdSchema = z.number().int().positive();
const detailPageNameSchema = z.string().trim().min(1, "请输入详情页名称").max(100, "详情页名称不能超过 100 个字符");
const richTextHtmlSchema = z.string().trim().min(1, "请填写富文本详情");
const heroTextSchema = z.string().trim().max(80);
const heroRequiredTextSchema = z.string().trim().min(1).max(80);
const heroOptionalTextSchema = z.string().trim().max(80).default("");
const heroTagSchema = z.string().trim().max(12);
const heroMetaItemSchema = z
  .object({
    label: z.string().trim().min(1, "请输入元数据名称").max(16, "元数据名称不能超过 16 个字符"),
    value: z.string().trim().min(1, "请输入元数据内容").max(40, "元数据内容不能超过 40 个字符")
  })
  .strict();

export const DetailPageHeroInputSchema = z
  .object({
    title: heroRequiredTextSchema,
    typeLabel: heroTextSchema.default(""),
    subtitle: heroOptionalTextSchema,
    badge: heroTextSchema.default(""),
    tags: z
      .array(heroTagSchema)
      .default([])
      .transform((values) => {
        const seen = new Set<string>();
        return values
          .map((value) => value.trim())
          .filter((value) => {
            const key = value.toLocaleLowerCase("zh-CN");
            if (!value || seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, 8);
      }),
    location: z.string().trim().max(30).default(""),
    metaItems: z.array(heroMetaItemSchema).max(8, "元数据最多 8 项").default([])
  })
  .strict();

export type DetailPageHeroInput = z.infer<typeof DetailPageHeroInputSchema>;

export const BannerRichTextDetailPageInputSchema = z
  .object({
    name: detailPageNameSchema,
    type: z.literal("banner_rich_text"),
    hero: DetailPageHeroInputSchema,
    bannerAssetIds: z
      .array(positiveAssetIdSchema)
      .min(detailPageTypeDefinitions.banner_rich_text.minBannerCount, "请至少选择一张 BANNER")
      .max(detailPageTypeDefinitions.banner_rich_text.maxBannerCount, "BANNER 最多选择六张")
      .refine((ids) => new Set(ids).size === ids.length, "BANNER 资源不能重复"),
    richTextHtml: richTextHtmlSchema
  })
  .strict();

export const RichTextDetailPageInputSchema = z
  .object({
    name: detailPageNameSchema,
    type: z.literal("rich_text"),
    richTextHtml: richTextHtmlSchema
  })
  .strict();

export const detailPageInputSchemas = {
  banner_rich_text: BannerRichTextDetailPageInputSchema,
  rich_text: RichTextDetailPageInputSchema
} as const satisfies Record<DetailPageType, z.ZodType>;

type DetailPageInputSchemaOption = (typeof detailPageInputSchemas)[DetailPageType];

export const detailPageInputSchemaOptions = Object.values(detailPageInputSchemas) as [
  DetailPageInputSchemaOption,
  ...DetailPageInputSchemaOption[]
];

export const DetailPageInputSchema = z.discriminatedUnion("type", detailPageInputSchemaOptions);

export type BannerRichTextDetailPageInput = z.infer<typeof BannerRichTextDetailPageInputSchema>;
export type RichTextDetailPageInput = z.infer<typeof RichTextDetailPageInputSchema>;
export type DetailPageInput = z.infer<typeof DetailPageInputSchema>;

export const LegacyBannerRichTextDetailPageInputSchema = z
  .object({
    type: z.literal("banner_rich_text"),
    heroSubtitle: heroOptionalTextSchema,
    bannerAssetIds: z
      .array(positiveAssetIdSchema)
      .min(detailPageTypeDefinitions.banner_rich_text.minBannerCount, "请至少选择一张 BANNER")
      .max(detailPageTypeDefinitions.banner_rich_text.maxBannerCount, "BANNER 最多选择六张")
      .refine((ids) => new Set(ids).size === ids.length, "BANNER 资源不能重复"),
    richTextHtml: richTextHtmlSchema
  })
  .strict();

export const LegacyRichTextDetailPageInputSchema = z
  .object({
    type: z.literal("rich_text"),
    richTextHtml: richTextHtmlSchema
  })
  .strict();

export const LegacyDetailPageInputSchema = z.discriminatedUnion("type", [
  LegacyBannerRichTextDetailPageInputSchema,
  LegacyRichTextDetailPageInputSchema
]);

export type LegacyDetailPageInput = z.infer<typeof LegacyDetailPageInputSchema>;

export type DetailPageBannerDto = {
  id: number;
  assetId: number;
  url: string;
  width: number | null;
  height: number | null;
  sortOrder: number;
};

export type DetailPageContentBlockDto =
  | {
      type: "richText";
      html: string;
    }
  | {
      type: "video";
      assetId: number;
      url: string;
      posterUrl: string | null;
      width: number | null;
      height: number | null;
    };

/** @deprecated Use DetailPageContentBlockDto. */
export type DetailPageBlockDto = DetailPageContentBlockDto;

export type DetailPageCardDto = {
  blocks: DetailPageContentBlockDto[];
};

export type DetailPageConfigDto = {
  id: number;
  name: string;
  type: DetailPageType;
  typeLabel: string;
  rendererKey: DetailPageRendererKey;
  schemaVersion: number;
  hero: {
    title: string;
    typeLabel: string;
    subtitle: string;
    badge: string;
    tags: string[];
    location: string;
    metaItems: Array<{
      label: string;
      value: string;
    }>;
  };
  /** @deprecated Use hero.subtitle. */
  heroSubtitle: string;
  banners: DetailPageBannerDto[];
  richTextHtml: string;
  cards: DetailPageCardDto[];
  /** @deprecated Use cards.flatMap((card) => card.blocks). */
  blocks: DetailPageBlockDto[];
  references?: DetailPageReferenceDto[];
  createdAt?: string;
  updatedAt?: string;
};

export type DetailPageSummaryDto = {
  id: number;
  name: string;
  type: DetailPageType;
  typeLabel: string;
  bannerCount: number;
  detailMediaCount: number;
  referenceCount: number;
  updatedAt: string;
};

export type DetailPageOptionDto = {
  id: number;
  name: string;
  type: DetailPageType;
  typeLabel: string;
};

export type DetailPageReferenceDto = {
  sourceType: "announcement" | "banner" | "artist" | "activity_case" | "article" | "recent_activity" | "menu";
  sourceId: number;
  sourceName: string;
};

export const DetailPageReferenceIdSchema = positiveIdSchema.nullable();

export const detailContentTemplates = {
  artistProfile: { label: "人员参考模板", ownerType: "artist" },
  activityCase: { label: "案例参考模板", ownerType: "activity_case" }
} as const;

export function buildArtistProfileTemplate(mediaAssetIds: number[]) {
  const media = (index: number) => mediaAssetIds[index % mediaAssetIds.length];
  if (!mediaAssetIds.length) throw new Error("人员参考模板至少需要一张图片资源");
  const cases = [
    ["香格里拉酒店婚礼", "2024.05.18｜杭州"],
    ["品牌发布会", "2024.03.22｜上海"],
    ["企业年会盛典", "2024.01.15｜宁波"],
    ["户外草坪婚礼", "2023.10.02｜绍兴"],
    ["答谢晚宴", "2023.09.10｜苏州"]
  ];
  return [
    `<h1>个人简介</h1><p>林然，资深婚礼&amp;商演主持人，8年行业经验，擅长婚礼、发布会、年会、启动仪式等多种风格主持。以真诚的表达、稳健的台风和出色的现场把控力，为每一场活动注入温度与仪式感。</p>`,
    `<h1>服务优势</h1>${[
      ["8年主持经验", "千场历练 专业沉淀"],
      ["婚礼/商演双场景", "风格多变 轻松驾驭"],
      ["控场能力强", "节奏精准 临场应变"],
      ["普通话一级", "发音标准 表达清晰"]
    ].map(([title, body]) => `<p><strong>${title}</strong><br>${body}</p>`).join("")}`,
    `<h1>代表案例</h1>${cases.map(([title, meta], index) => `<p><strong>${title}</strong><br>${meta}</p><img data-media-asset-id="${media(index)}" alt="${title}">`).join("")}`,
    `<h1>服务流程</h1>${[
      ["需求沟通", "了解需求"],
      ["确定方案", "定制流程"],
      ["确认档期", "签约保定"],
      ["现场执行", "专业呈现"],
      ["售后回访", "贴心服务"]
    ].map(([title, body]) => `<p><strong>${title}</strong><br>${body}</p>`).join("")}`,
    `<h1>客户评价</h1><p><strong>小确幸</strong><br>主持风格非常温暖自然，现场氛围感拉满，宾客都说是参加过最走心的婚礼！</p><img data-media-asset-id="${media(0)}" alt="客户评价"><p><strong>Leon</strong><br>流程把控精准到位，与嘉宾互动自然，整场活动节奏非常好，期待下次合作！</p><img data-media-asset-id="${media(1)}" alt="客户评价">`,
    `<h1>档期提醒</h1><p>档期较为紧张，建议尽早预约。</p><p>近期可预约时间：6月28日 周六、6月29日 周日、7月05日 周六</p><p><strong>常见问题</strong><br>主持费用包含哪些服务？<br>需要提前多久预定？<br>可以定制专属主持词吗？</p>`
  ].join("");
}

export function buildActivityCaseTemplate(imageAssetIds: number[], videoAssetId?: number) {
  if (!imageAssetIds.length) throw new Error("案例参考模板至少需要一张图片资源");
  return [
    `<h1>项目简介</h1><p>围绕活动主题完成流程策划、舞台表达与现场协同，以统一的视觉和节奏呈现项目价值。</p>`,
    `<h1>活动亮点</h1><p>定制化流程与内容编排<br>多团队现场协同执行<br>关键环节节奏精准</p>`,
    `<h1>现场图片</h1>${imageAssetIds.map((id, index) => `<img data-media-asset-id="${id}" alt="现场图片 ${index + 1}">`).join("")}`,
    ...(videoAssetId ? [`<h1>项目视频</h1><video data-media-asset-id="${videoAssetId}"></video>`] : []),
    `<h1>执行信息</h1><p>项目团队按确认方案完成进场、联排、现场执行与复盘交付。</p>`
  ].join("");
}
