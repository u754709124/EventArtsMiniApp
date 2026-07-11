import { z } from "zod";

export const detailPageTypeValues = ["banner_rich_text", "rich_text"] as const;
export const detailOwnerTypeValues = ["artist", "activity_case"] as const;

export type DetailPageType = (typeof detailPageTypeValues)[number];
export type DetailOwnerType = (typeof detailOwnerTypeValues)[number];

export type DetailPageConfigField = "heroSubtitle" | "banners" | "richText";
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
    requiresHeroSubtitle: true,
    requiresRichText: true,
    minBannerCount: 1,
    maxBannerCount: 6,
    bannerAllowedMediaTypes: ["image"],
    configFields: ["heroSubtitle", "banners", "richText"],
    schemaVersion: 1
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
    schemaVersion: 1
  }
} as const satisfies Record<DetailPageType, DetailPageTypeDefinition>;

export const detailPageTypeLabels = {
  banner_rich_text: detailPageTypeDefinitions.banner_rich_text.label,
  rich_text: detailPageTypeDefinitions.rich_text.label
} as const satisfies Record<DetailPageType, string>;

export const DetailPageTypeSchema = z.enum(detailPageTypeValues);
export const DetailOwnerTypeSchema = z.enum(detailOwnerTypeValues);

const positiveAssetIdSchema = z.coerce.number().int().positive();
const richTextHtmlSchema = z.string().trim().min(1, "请填写富文本详情");

export const BannerRichTextDetailPageInputSchema = z
  .object({
    type: z.literal("banner_rich_text"),
    heroSubtitle: z.string().trim().min(1, "请输入 BANNER 宣传语").max(80, "BANNER 宣传语不能超过 80 个字符"),
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
    type: z.literal("rich_text"),
    richTextHtml: richTextHtmlSchema
  })
  .strict();

export const detailPageInputSchemas = {
  banner_rich_text: BannerRichTextDetailPageInputSchema,
  rich_text: RichTextDetailPageInputSchema
} as const satisfies Record<DetailPageType, z.ZodType>;

export const DetailPageInputSchema = z.discriminatedUnion("type", [
  detailPageInputSchemas.banner_rich_text,
  detailPageInputSchemas.rich_text
]);

export type BannerRichTextDetailPageInput = z.infer<typeof BannerRichTextDetailPageInputSchema>;
export type RichTextDetailPageInput = z.infer<typeof RichTextDetailPageInputSchema>;
export type DetailPageInput = z.infer<typeof DetailPageInputSchema>;

export type DetailPageBannerDto = {
  id: number;
  assetId: number;
  url: string;
  width: number | null;
  height: number | null;
  sortOrder: number;
};

export type DetailPageBlockDto =
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

export type DetailPageConfigDto = {
  type: DetailPageType;
  typeLabel: string;
  rendererKey: DetailPageRendererKey;
  schemaVersion: number;
  heroSubtitle: string;
  banners: DetailPageBannerDto[];
  richTextHtml: string;
  blocks: DetailPageBlockDto[];
};

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
    `<section class="ea-detail-card"><h2 class="ea-section-title">个人简介</h2><div class="ea-section-body"><p>林然，资深婚礼&amp;商演主持人，8年行业经验，擅长婚礼、发布会、年会、启动仪式等多种风格主持。以真诚的表达、稳健的台风和出色的现场把控力，为每一场活动注入温度与仪式感。</p></div></section>`,
    `<section class="ea-detail-card"><h2 class="ea-section-title">服务优势</h2><div class="ea-advantage-grid">${[
      ["8年主持经验", "千场历练 专业沉淀"],
      ["婚礼/商演双场景", "风格多变 轻松驾驭"],
      ["控场能力强", "节奏精准 临场应变"],
      ["普通话一级", "发音标准 表达清晰"]
    ].map(([title, body]) => `<div class="ea-advantage-item"><strong>${title}</strong><p>${body}</p></div>`).join("")}</div></section>`,
    `<section class="ea-detail-card"><h2 class="ea-section-title">代表案例</h2><div class="ea-case-grid">${cases.map(([title, meta], index) => `<div class="ea-case-item"><img data-media-asset-id="${media(index)}" alt="${title}"><strong>${title}</strong><p>${meta}</p></div>`).join("")}</div></section>`,
    `<section class="ea-detail-card"><h2 class="ea-section-title">服务流程</h2><div class="ea-process-row">${[
      ["需求沟通", "了解需求"],
      ["确定方案", "定制流程"],
      ["确认档期", "签约保定"],
      ["现场执行", "专业呈现"],
      ["售后回访", "贴心服务"]
    ].map(([title, body]) => `<div class="ea-process-item"><strong>${title}</strong><p>${body}</p></div>`).join("")}</div></section>`,
    `<section class="ea-detail-card"><h2 class="ea-section-title">客户评价</h2><div class="ea-review-list"><div class="ea-review-item"><div class="ea-review-main"><strong>小确幸</strong><p>主持风格非常温暖自然，现场氛围感拉满，宾客都说是参加过最走心的婚礼！</p></div><img class="ea-review-image" data-media-asset-id="${media(0)}" alt="客户评价"></div><div class="ea-review-item"><div class="ea-review-main"><strong>Leon</strong><p>流程把控精准到位，与嘉宾互动自然，整场活动节奏非常好，期待下次合作！</p></div><img class="ea-review-image" data-media-asset-id="${media(1)}" alt="客户评价"></div></div></section>`,
    `<section class="ea-detail-card"><div class="ea-two-column"><div class="ea-calendar-card"><h2 class="ea-section-title">档期提醒</h2><p>档期较为紧张，建议尽早预约。</p><p>近期可预约时间：6月28日 周六、6月29日 周日、7月05日 周六</p></div><div class="ea-faq-card"><h2 class="ea-section-title">常见问题</h2><ul><li>主持费用包含哪些服务？</li><li>需要提前多久预定？</li><li>可以定制专属主持词吗？</li></ul></div></div></section>`
  ].join("");
}

export function buildActivityCaseTemplate(imageAssetIds: number[], videoAssetId?: number) {
  if (!imageAssetIds.length) throw new Error("案例参考模板至少需要一张图片资源");
  return [
    `<section class="ea-detail-card"><h2 class="ea-section-title">项目简介</h2><div class="ea-section-body"><p>围绕活动主题完成流程策划、舞台表达与现场协同，以统一的视觉和节奏呈现项目价值。</p></div></section>`,
    `<section class="ea-detail-card"><h2 class="ea-section-title">活动亮点</h2><ul><li>定制化流程与内容编排</li><li>多团队现场协同执行</li><li>关键环节节奏精准</li></ul></section>`,
    `<section class="ea-detail-card"><h2 class="ea-section-title">现场图片</h2><div class="ea-case-grid">${imageAssetIds.map((id, index) => `<div class="ea-case-item"><img data-media-asset-id="${id}" alt="现场图片 ${index + 1}"></div>`).join("")}</div></section>`,
    ...(videoAssetId ? [`<section class="ea-detail-card"><h2 class="ea-section-title">项目视频</h2><video data-media-asset-id="${videoAssetId}"></video></section>`] : []),
    `<section class="ea-detail-card"><h2 class="ea-section-title">执行信息</h2><div class="ea-section-body"><p>项目团队按确认方案完成进场、联排、现场执行与复盘交付。</p></div></section>`
  ].join("");
}
