import { z } from "zod";
import { DetailPageReferenceIdSchema, type DetailPageConfigDto } from "./detail-pages";

export * from "./detail-pages";

export const statusValues = ["enabled", "disabled"] as const;
export const menuTypeValues = ["host", "singer", "actor", "activity_case", "contact"] as const;
export const artistTypeValues = ["host", "singer", "actor"] as const;
export const bannerLinkTypeValues = ["none", "announcement", "case", "internal"] as const;
export const mediaTypeValues = ["image", "video"] as const;
export const mediaFieldKeyValues = [
  "site.defaultBanner",
  "site.placeholderBanner",
  "site.placeholderIcon",
  "site.placeholderCase",
  "banner.image",
  "menu.icon",
  "case.cover",
  "artist.avatar",
  "case.detail",
  "detail.banner",
  "detail.richText"
] as const;

export type Status = (typeof statusValues)[number];
export type MenuType = (typeof menuTypeValues)[number];
export type ArtistType = (typeof artistTypeValues)[number];
export type BannerLinkType = (typeof bannerLinkTypeValues)[number];
export type MediaType = (typeof mediaTypeValues)[number];
export type MediaFieldKey = (typeof mediaFieldKeyValues)[number];

export const StatusSchema = z.enum(statusValues);
export const MenuTypeSchema = z.enum(menuTypeValues);
export const ArtistTypeSchema = z.enum(artistTypeValues);
export const BannerLinkTypeSchema = z.enum(bannerLinkTypeValues);
export const MediaTypeSchema = z.enum(mediaTypeValues);
export const MediaFieldKeySchema = z.enum(mediaFieldKeyValues);

export const artistTypeLabels: Record<ArtistType, string> = {
  host: "主持人",
  singer: "歌手",
  actor: "演员"
};

export type MediaFieldRule = {
  label: string;
  allowedTypes: MediaType[];
  width: number | null;
  height: number | null;
};

export const mediaFieldRules: Record<MediaFieldKey, MediaFieldRule> = {
  "site.defaultBanner": { label: "默认 Banner 图", allowedTypes: ["image"], width: 1420, height: 580 },
  "site.placeholderBanner": { label: "Banner 占位图", allowedTypes: ["image"], width: 1420, height: 580 },
  "site.placeholderIcon": { label: "菜单图标占位图", allowedTypes: ["image"], width: 176, height: 176 },
  "site.placeholderCase": { label: "案例封面占位图", allowedTypes: ["image"], width: 460, height: 320 },
  "banner.image": { label: "Banner 图片", allowedTypes: ["image"], width: 1420, height: 580 },
  "menu.icon": { label: "菜单图标", allowedTypes: ["image"], width: 176, height: 176 },
  "case.cover": { label: "案例封面", allowedTypes: ["image"], width: 460, height: 320 },
  "artist.avatar": { label: "列表封面图", allowedTypes: ["image"], width: null, height: null },
  "case.detail": { label: "案例详情媒体", allowedTypes: ["image", "video"], width: null, height: null },
  "detail.banner": { label: "详情页 BANNER", allowedTypes: ["image"], width: null, height: null },
  "detail.richText": { label: "详情页富文本媒体", allowedTypes: ["image", "video"], width: null, height: null }
};

export function normalizeResourceName(value: string) {
  const displayName = value.normalize("NFKC").trim();
  return { displayName, key: displayName.toLocaleLowerCase("en-US") };
}

export function normalizeMediaTags(values: string[]) {
  const tags = new Map<string, string>();
  for (const value of values) {
    const normalized = normalizeResourceName(value);
    if (normalized.displayName && !tags.has(normalized.key)) tags.set(normalized.key, normalized.displayName);
  }
  return [...tags.values()];
}

export function normalizeArtistTags(input: unknown): string[] {
  let value = input;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];

  const tags = new Map<string, string>();
  for (const rawTag of value) {
    if (typeof rawTag !== "string") continue;
    const tag = rawTag.trim();
    const key = tag.toLocaleLowerCase("zh-CN");
    if (tag && !tags.has(key)) tags.set(key, tag);
  }
  return [...tags.values()];
}

export function serializeArtistTags(input: unknown): string {
  return JSON.stringify(normalizeArtistTags(input));
}

const positiveIntFromInput = z.coerce.number().int().positive();
const nullableDetailPageIdSchema = DetailPageReferenceIdSchema.default(null);

const artistNameSchema = z.string().trim().min(1).max(60);
const artistLocationSchema = z.string().trim().min(1).max(30);
const artistBadgeSchema = z.string().trim().min(1).max(12);
const artistSummarySchema = z.string().trim().min(1).max(120);
const artistTagsSchema = z
  .array(z.string())
  .transform((values) => normalizeArtistTags(values))
  .refine((values) => values.every((value) => value.length <= 12), "单个标签不能超过 12 个字符")
  .refine((values) => values.length >= 1 && values.length <= 4, "标签数量应为 1 至 4 个");
const legacyArtistTagsSchema = z
  .union([z.array(z.string()), z.string()])
  .transform((values) => normalizeArtistTags(values))
  .refine((values) => values.every((value) => value.length <= 12), "单个标签不能超过 12 个字符")
  .refine((values) => values.length >= 1 && values.length <= 4, "标签数量应为 1 至 4 个");
const artistQueryTextSchema = z.string().trim().transform((value) => value || undefined).optional();

const artistTagInput = {
  tags: artistTagsSchema.optional(),
  tagsJson: legacyArtistTagsSchema.optional()
};

function normalizeArtistRequestTags<T extends { tags?: string[]; tagsJson?: string[] }>(input: T) {
  const { tags, tagsJson, ...artist } = input;
  return { ...artist, ...(tags !== undefined || tagsJson !== undefined ? { tags: tags ?? tagsJson ?? [] } : {}) };
}

function requireArtistTags(value: { tags?: string[]; tagsJson?: string[] }, context: z.RefinementCtx) {
  if (value.tags === undefined && value.tagsJson === undefined) {
    context.addIssue({ code: "custom", path: ["tags"], message: "请至少填写一个标签" });
  }
}

export const ArtistCreateRequestSchema = z
  .object({
    name: artistNameSchema,
    type: ArtistTypeSchema,
    avatarAssetId: positiveIntFromInput,
    location: artistLocationSchema,
    badge: artistBadgeSchema,
    ...artistTagInput,
    summary: artistSummarySchema,
    detailPageId: nullableDetailPageIdSchema,
    sortOrder: z.coerce.number().int().min(0),
    status: StatusSchema
  })
  .strict()
  .superRefine(requireArtistTags)
  .transform(normalizeArtistRequestTags);

export const ArtistUpdateRequestSchema = z
  .object({
    name: artistNameSchema.optional(),
    type: ArtistTypeSchema.optional(),
    avatarAssetId: positiveIntFromInput.nullable().optional(),
    location: artistLocationSchema.optional(),
    badge: artistBadgeSchema.optional(),
    ...artistTagInput,
    summary: artistSummarySchema.optional(),
    detailPageId: DetailPageReferenceIdSchema.optional(),
    sortOrder: z.coerce.number().int().min(0).optional(),
    status: StatusSchema.optional()
  })
  .strict()
  .transform(normalizeArtistRequestTags);

export const artistListQuerySchema = z.object({
  type: ArtistTypeSchema.default("host"),
  q: artistQueryTextSchema,
  location: artistQueryTextSchema,
  tag: artistQueryTextSchema
});

const activityCaseFields = {
  title: z.string().trim().min(1),
  category: z.string().trim().min(1),
  tag: z.string().trim().min(1),
  coverAssetId: positiveIntFromInput,
  summary: z.string().trim().min(1),
  eventDate: z.union([z.string().trim().min(1), z.date()]),
  location: z.string().trim().min(1),
  isFeatured: z.boolean(),
  featuredSortOrder: z.coerce.number().int().min(0),
  sortOrder: z.coerce.number().int().min(0),
  status: StatusSchema,
  detailPageId: nullableDetailPageIdSchema
};

export const ActivityCaseCreateRequestSchema = z.object(activityCaseFields).strict();
export const ActivityCaseUpdateRequestSchema = z.object(activityCaseFields).partial().strict();

export const mediaListQuerySchema = z.object({
  mediaType: MediaTypeSchema.optional(),
  q: z.string().trim().optional(),
  tag: z.string().trim().optional(),
  referenceStatus: z.enum(["used", "unused"]).optional(),
  width: positiveIntFromInput.optional(),
  height: positiveIntFromInput.optional(),
  page: positiveIntFromInput.default(1),
  pageSize: positiveIntFromInput.max(100).default(20)
});

export const lookupMediaRequestSchema = z.object({
  md5: z.string().regex(/^[a-f\d]{32}$/i),
  size: positiveIntFromInput
});

export const checkMediaNameRequestSchema = z.object({
  resourceName: z.string().transform((value, context) => {
    const normalized = normalizeResourceName(value);
    if (!normalized.displayName) {
      context.addIssue({ code: "custom", message: "资源名称不能为空" });
      return z.NEVER;
    }
    return normalized.displayName;
  }),
  excludeId: positiveIntFromInput.optional()
});

export const updateMediaMetadataSchema = z
  .object({
    resourceName: z.string(),
    tags: z.array(z.string()).default([])
  })
  .transform((value, context) => {
    const normalized = normalizeResourceName(value.resourceName);
    if (!normalized.displayName) {
      context.addIssue({ code: "custom", message: "资源名称不能为空" });
      return z.NEVER;
    }
    return { resourceName: normalized.displayName, tags: normalizeMediaTags(value.tags) };
  });

export const batchDeleteMediaRequestSchema = z.object({
  ids: z.array(positiveIntFromInput).min(1).transform((ids) => [...new Set(ids)])
});

export const caseDetailMediaIdsSchema = z.array(positiveIntFromInput).transform((ids) => [...new Set(ids)]);

export type ApiSuccess<T> = {
  success: true;
  data: T;
  message: "ok";
};

export type ApiFailure = {
  success: false;
  error: {
    code: string;
    message: string;
  };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export const ok = <T>(data: T): ApiSuccess<T> => ({ success: true, data, message: "ok" });

export const fail = (code: string, message: string): ApiFailure => ({
  success: false,
  error: { code, message }
});

export type MediaAssetDto = {
  id: number;
  resourceName: string;
  originalName: string;
  md5: string;
  mimeType: string;
  mediaType: MediaType;
  url: string;
  width: number | null;
  height: number | null;
  size: number;
  storageType: "local";
  tags: string[];
  referenceCount: number;
  referenceSources?: MediaReferenceSourceDto[];
  inUse: boolean;
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MediaReferenceSourceDto = {
  type:
    | "site_default_banner"
    | "site_placeholder_banner"
    | "site_placeholder_icon"
    | "site_placeholder_case"
    | "banner"
    | "menu"
    | "case_cover"
    | "artist_cover"
    | "legacy_case_detail"
    | "detail_page_banner"
    | "detail_page_content";
  label: string;
  count: number;
};

export type CaseMediaDto = {
  id: number;
  mediaType: MediaType;
  url: string;
  width: number;
  height: number;
  sortOrder: number;
};

export type MediaUploadConfigDto = {
  image: { mimeTypes: ["image/jpeg", "image/png", "image/webp"]; maxBytes: number };
  video: { mimeTypes: ["video/mp4"]; maxBytes: number };
  fieldRules: Record<MediaFieldKey, MediaFieldRule>;
};

export type SiteConfigDto = {
  appName: string;
  subtitle: string;
  defaultBannerUrl: string;
  placeholderBannerUrl: string;
  placeholderIconUrl: string;
  placeholderCaseUrl: string;
};

export type AnnouncementDto = {
  id: number;
  summary: string;
  content: string;
  displayDurationMs: number;
  sortOrder: number;
  status: Status;
  detailPageId: number | null;
  hasDetailPage: boolean;
};

export type BannerDto = {
  id: number;
  title: string;
  imageUrl: string;
  detailPageId: number | null;
  hasDetailPage: boolean;
  /** @deprecated Use detailPageId. */
  linkType: BannerLinkType;
  /** @deprecated Use detailPageId. */
  linkTarget: string | null;
  switchDurationMs: number;
  sortOrder: number;
  status: Status;
};

export type MenuItemDto = {
  id: number;
  text: string;
  iconUrl: string;
  type: MenuType;
  configJson: unknown;
  sortOrder: number;
  status: Status;
};

export type ActivityCaseListItemDto = {
  id: number;
  title: string;
  category: string;
  tag: string;
  coverUrl: string;
  summary: string;
  eventDate: string;
  location: string;
  detail: string;
  media: CaseMediaDto[];
  detailPageId: number | null;
  hasDetailPage: boolean;
  isFeatured: boolean;
  featuredSortOrder: number;
  sortOrder: number;
  status: Status;
};

export type ActivityCaseDetailDto = ActivityCaseListItemDto & {
  detailPage: DetailPageConfigDto | null;
};

/** @deprecated Use ActivityCaseListItemDto or ActivityCaseDetailDto for an exact endpoint contract. */
export type ActivityCaseDto = ActivityCaseDetailDto;

export type ArtistListItemDto = {
  id: number;
  name: string;
  type: ArtistType;
  coverUrl: string | null;
  avatarUrl: string | null;
  location: string;
  badge: string;
  tags: string[];
  summary: string;
  detail: string;
  detailPageId: number | null;
  hasDetailPage: boolean;
  sortOrder: number;
  status: Status;
};

export type ArtistDetailDto = ArtistListItemDto & {
  detailPage: DetailPageConfigDto | null;
};

/** @deprecated Use ArtistListItemDto or ArtistDetailDto for an exact endpoint contract. */
export type ArtistDto = ArtistDetailDto;

export type ClientHomeResponse = {
  site: SiteConfigDto;
  announcements: AnnouncementDto[];
  banners: BannerDto[];
  menus: MenuItemDto[];
  featuredCases: ActivityCaseListItemDto[];
};

export type DashboardOverviewResponse = {
  todayPv: number;
  weekPv: number;
  monthPv: number;
};

export const pageViewRequestSchema = z.object({
  pagePath: z.string().min(1),
  scene: z.string().min(1).optional()
});

export const loginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

export const menuConfigSchemaByType = {
  host: z.object({
    defaultSort: z.enum(["sortOrder", "newest"]).default("sortOrder"),
    pageSize: z.number().int().positive().default(10)
  }),
  singer: z.object({
    defaultSort: z.enum(["sortOrder", "newest"]).default("sortOrder"),
    pageSize: z.number().int().positive().default(10)
  }),
  actor: z.object({
    defaultSort: z.enum(["sortOrder", "newest"]).default("sortOrder"),
    pageSize: z.number().int().positive().default(10)
  }),
  activity_case: z.object({
    category: z.string().optional(),
    onlyFeatured: z.boolean().default(false),
    pageSize: z.number().int().positive().default(10)
  }),
  contact: z.object({
    phone: z.string().optional(),
    address: z.string().optional(),
    wechat: z.string().optional(),
    description: z.string().optional()
  })
} satisfies Record<MenuType, z.ZodType>;
