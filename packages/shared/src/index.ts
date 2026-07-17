import { z } from "zod";
import { DetailPageReferenceIdSchema, DetailPageTypeSchema, DetailPageConfigDto } from "./detail-pages";

export * from "./detail-pages";
export * from "./detail-page-presentation";
export * from "./admin-notifications";

export const statusValues = ["enabled", "disabled"] as const;
export const menuTypeValues = ["host", "singer", "actor", "activity_case", "article", "detail_page", "contact"] as const;
export const artistTypeValues = ["host", "singer", "actor"] as const;
export const bannerLinkTypeValues = ["none", "announcement", "case", "internal"] as const;
export const mediaTypeValues = ["image", "video"] as const;
export const mediaFieldKeyValues = [
  "site.placeholderBanner",
  "site.placeholderIcon",
  "site.placeholderCase",
  "banner.image",
  "menu.icon",
  "case.cover",
  "article.cover",
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

export const edgeOnePrefetchStatusValues = [
  "reserved",
  "submitting",
  "processing",
  "success",
  "failed",
  "timeout",
  "canceled",
  "invalid"
] as const;
export type EdgeOnePrefetchStatus = (typeof edgeOnePrefetchStatusValues)[number];
export const EdgeOnePrefetchStatusSchema = z.enum(edgeOnePrefetchStatusValues);

export const edgeOnePrefetchTriggerRequestSchema = z.object({
  assetIds: z.array(z.number().int().positive()).max(100).transform((ids) => [...new Set(ids)]).optional()
}).strict();

export const edgeOnePrefetchItemSchema = z.object({
  mediaAssetId: z.number().int().positive(),
  status: EdgeOnePrefetchStatusSchema.nullable(),
  outcome: z.enum(["submitted", "skipped", "ineligible", "failed"]),
  safeErrorCode: z.string().min(1).max(80).nullable()
}).strict();

export const edgeOnePrefetchTriggerResponseSchema = z.object({
  submitted: z.number().int().min(0),
  skipped: z.number().int().min(0),
  ineligible: z.number().int().min(0),
  failed: z.number().int().min(0),
  items: z.array(edgeOnePrefetchItemSchema)
}).strict();

export const edgeOnePrefetchListQuerySchema = z.object({
  assetIds: z.preprocess(
    (value) => typeof value === "string"
      ? value.split(",").filter(Boolean).map(Number)
      : value,
    z.array(z.number().int().positive()).max(100)
  ).optional(),
  mediaType: MediaTypeSchema.optional(),
  status: EdgeOnePrefetchStatusSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
}).strict();

export const edgeOnePrefetchResourceDtoSchema = z.object({
  id: z.number().int().positive(),
  mediaAssetId: z.number().int().positive(),
  mode: z.literal("default"),
  status: EdgeOnePrefetchStatusSchema,
  attemptCount: z.number().int().min(0),
  nextRetryAt: z.string().datetime({ offset: true }).nullable(),
  lastSubmittedAt: z.string().datetime({ offset: true }).nullable(),
  completedAt: z.string().datetime({ offset: true }).nullable(),
  safeErrorCode: z.string().min(1).max(80).nullable(),
  safeErrorMessage: z.string().min(1).max(300).nullable(),
  updatedAt: z.string().datetime({ offset: true })
}).strict();

export const edgeOnePrefetchListResponseSchema = z.object({
  items: z.array(edgeOnePrefetchResourceDtoSchema),
  total: z.number().int().min(0),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive()
}).strict();

export type EdgeOnePrefetchTriggerRequest = z.infer<typeof edgeOnePrefetchTriggerRequestSchema>;
export type EdgeOnePrefetchItem = z.infer<typeof edgeOnePrefetchItemSchema>;
export type EdgeOnePrefetchTriggerResponse = z.infer<typeof edgeOnePrefetchTriggerResponseSchema>;
export type EdgeOnePrefetchListQuery = z.infer<typeof edgeOnePrefetchListQuerySchema>;
export type EdgeOnePrefetchResourceDto = z.infer<typeof edgeOnePrefetchResourceDtoSchema>;
export type EdgeOnePrefetchListResponse = z.infer<typeof edgeOnePrefetchListResponseSchema>;

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
  "site.placeholderBanner": { label: "Banner 占位图", allowedTypes: ["image"], width: 1420, height: 580 },
  "site.placeholderIcon": { label: "菜单图标占位图", allowedTypes: ["image"], width: 176, height: 176 },
  "site.placeholderCase": { label: "案例封面占位图", allowedTypes: ["image"], width: 460, height: 320 },
  "banner.image": { label: "Banner 图片", allowedTypes: ["image"], width: 1420, height: 580 },
  "menu.icon": { label: "菜单图标", allowedTypes: ["image"], width: 176, height: 176 },
  "case.cover": { label: "案例封面", allowedTypes: ["image"], width: 460, height: 320 },
  "article.cover": { label: "文章封面", allowedTypes: ["image"], width: null, height: null },
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

export function normalizeArticleCategory(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function normalizeArticleCategories(input: unknown): string[] {
  const rawValues = Array.isArray(input) ? input : [];
  const categories = new Map<string, string>();
  for (const value of rawValues) {
    if (typeof value !== "string") continue;
    const category = normalizeArticleCategory(value);
    const key = category.toLocaleLowerCase("en-US");
    if (category && !categories.has(key)) categories.set(key, category);
  }
  return [...categories.values()];
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
const optionalQueryTextSchema = z.string().trim().transform((value) => value || undefined).optional();
const optionalBooleanQuerySchema = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((value) => value === true || value === "true" || value === "1")
  .optional();
const articleCategorySchema = z
  .string()
  .transform((value) => normalizeArticleCategory(value))
  .refine((value) => value.length > 0, "文章分类不能为空")
  .refine((value) => value.length <= 30, "文章分类不能超过 30 个字符");
const articleOptionalCategorySchema = z
  .string()
  .transform((value) => normalizeArticleCategory(value))
  .transform((value) => value || undefined)
  .refine((value) => value === undefined || value.length <= 30, "文章分类不能超过 30 个字符")
  .optional();
const isoDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const isoDateInputSchema = z
  .union([z.string().trim().min(1), z.date()])
  .refine((value) => value instanceof Date || isoDateTimePattern.test(value), "日期必须是 ISO 时间")
  .refine((value) => !Number.isNaN(new Date(value).getTime()), "日期必须是有效 ISO 时间");

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

export const caseListQuerySchema = z.object({
  q: optionalQueryTextSchema,
  category: optionalQueryTextSchema
});

const articleFields = {
  title: z.string().trim().min(1).max(100),
  category: articleCategorySchema,
  coverAssetId: positiveIntFromInput,
  summary: z.string().trim().min(1).max(240),
  publishedAt: isoDateInputSchema,
  isFeatured: z.boolean(),
  featuredSortOrder: z.coerce.number().int().min(0),
  sortOrder: z.coerce.number().int().min(0),
  status: StatusSchema,
  detailPageId: nullableDetailPageIdSchema
};

export const ArticleCreateRequestSchema = z.object(articleFields).strict();
export const ArticleUpdateRequestSchema = z.object(articleFields).partial().strict();

export const adminArticleListQuerySchema = z.object({
  q: optionalQueryTextSchema,
  category: articleOptionalCategorySchema,
  status: StatusSchema.optional(),
  isFeatured: optionalBooleanQuerySchema,
  page: positiveIntFromInput.default(1),
  pageSize: positiveIntFromInput.max(100).default(20)
});

export const clientArticleListQuerySchema = z.object({
  q: optionalQueryTextSchema,
  category: articleOptionalCategorySchema,
  page: positiveIntFromInput.default(1),
  pageSize: positiveIntFromInput.max(50).default(10)
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

const menuItemFields = {
  text: z.string().trim().min(1),
  iconAssetId: positiveIntFromInput,
  type: MenuTypeSchema,
  configJson: z.unknown().optional(),
  showOnHome: z.boolean(),
  sortOrder: z.coerce.number().int().min(0),
  status: StatusSchema
};

export const MenuItemCreateRequestSchema = z.object({
  ...menuItemFields,
  showOnHome: menuItemFields.showOnHome.default(true)
}).strict();
export const MenuItemUpdateRequestSchema = z.object(menuItemFields).partial().strict();

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

export const adminReorderRequestSchema = z
  .object({
    ids: z.array(positiveIntFromInput).min(1)
  })
  .superRefine((value, context) => {
    const seen = new Set<number>();
    for (const [index, id] of value.ids.entries()) {
      if (seen.has(id)) {
        context.addIssue({
          code: "custom",
          path: ["ids", index],
          message: "排序 ID 不能重复"
        });
      }
      seen.add(id);
    }
  });

export const caseDetailMediaIdsSchema = z.array(positiveIntFromInput).transform((ids) => [...new Set(ids)]);

export type ApiSuccess<T> = {
  success: true;
  data: T;
  message: "ok";
};

export const apiErrorCodeValues = [
  "BAD_REQUEST",
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "INVALID_CREDENTIALS",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "DUPLICATE_RESOURCE_NAME",
  "FILE_TOO_LARGE",
  "HASH_COLLISION",
  "MD5_MISMATCH",
  "INTERNAL_ERROR",
  "MEDIA_RECOVERY_FAILED",
  "RATE_LIMITED",
  "CLIENT_AUTH_REQUIRED",
  "CLIENT_SESSION_EXPIRED",
  "CLIENT_SESSION_REVOKED",
  "INVALID_WECHAT_CODE",
  "WECHAT_AUTH_FAILED",
  "WECHAT_AUTH_UNAVAILABLE",
  "WECHAT_APPID_MISMATCH",
  "WEAK_PASSWORD",
  "SESSION_EXPIRED",
  "SESSION_REVOKED",
  "BACKUP_NOT_FOUND",
  "BACKUP_INVALID",
  "BACKUP_UNSUPPORTED_VERSION",
  "BACKUP_CONFLICT",
  "BACKUP_DELETE_CONFIRMATION_REQUIRED",
  "BACKUP_RESTORE_CONFIRMATION_REQUIRED",
  "BACKUP_RESTORE_FAILED",
  "MAINTENANCE_MODE"
] as const;

export type ApiErrorCode = (typeof apiErrorCodeValues)[number];
export type ApiErrorCodeLike = ApiErrorCode | (string & {});
export const ApiErrorCodeSchema = z.enum(apiErrorCodeValues);

export type ApiFailure = {
  success: false;
  error: {
    code: ApiErrorCodeLike;
    message: string;
    requestId?: string;
  };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export const ok = <T>(data: T): ApiSuccess<T> => ({ success: true, data, message: "ok" });

export const fail = (code: ApiErrorCodeLike, message: string): ApiFailure => ({
  success: false,
  error: { code, message }
});

export const failWithRequestId = (code: ApiErrorCodeLike, message: string, requestId: string): ApiFailure => ({
  success: false,
  error: { code, message, requestId }
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
    | "article_cover"
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
  iconAssetId: number;
  iconUrl: string;
  type: MenuType;
  configJson: unknown;
  showOnHome: boolean;
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

export type ArticleListItemDto = {
  id: number;
  title: string;
  category: string;
  coverUrl: string;
  summary: string;
  publishedAt: string;
  detailPageId: number | null;
  hasDetailPage: boolean;
  isFeatured: boolean;
  featuredSortOrder: number;
  sortOrder: number;
  status: Status;
};

export type ArticleListResponse = {
  items: ArticleListItemDto[];
  total: number;
  page: number;
  pageSize: number;
  categories: string[];
};

export type ArticleCategoryResponse = {
  categories: string[];
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
  featuredArticles: ArticleListItemDto[];
};

const edgeOneCredentialInputSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value === value.trim() && !/\s/.test(value), "凭证不能包含空白字符");

export const edgeOneConfigUpdateRequestSchema = z
  .object({
    zoneId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "ZoneId 格式不正确"),
    secretId: edgeOneCredentialInputSchema.max(128).optional(),
    secretKey: edgeOneCredentialInputSchema.optional()
  })
  .strict();

export type EdgeOneConfigUpdateRequest = z.infer<typeof edgeOneConfigUpdateRequestSchema>;

export type EdgeOneConfigResponse = {
  zoneId: string | null;
  secretIdMasked: string | null;
  secretIdConfigured: boolean;
  secretKeyConfigured: boolean;
  updatedAt: string | null;
};

export type EdgeOneDashboardState =
  | { status: "not_configured" }
  | { status: "error"; code: string; message: string }
  | {
      status: "ready";
      zoneId: string;
      fetchedAt: string;
      last24Hours: {
        startTime: string;
        endTime: string;
        trafficBytes: number;
        requestCount: number;
      };
      package: {
        planId: string;
        planType: string;
        planStatus: string;
        periodStart: string;
        periodEnd: string;
        trafficUsedBytes: number;
        trafficCapacityBytes: number;
        requestUsed: number;
        requestCapacity: number;
      };
    };

export type DashboardOverviewResponse = {
  todayUniqueUsers: number;
  weekDailyUniqueUsers: number;
  monthDailyUniqueUsers: number;
  edgeOne: EdgeOneDashboardState;
};

export const passwordPolicy = {
  minLength: 12,
  maxLength: 128,
  requiredCharacterClasses: 3
} as const;

function passwordCharacterClassCount(value: string) {
  return [
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /\d/.test(value),
    /[^A-Za-z0-9]/.test(value)
  ].filter(Boolean).length;
}

export const strongPasswordSchema = z
  .string()
  .min(passwordPolicy.minLength, `密码至少 ${passwordPolicy.minLength} 个字符`)
  .max(passwordPolicy.maxLength, `密码不能超过 ${passwordPolicy.maxLength} 个字符`)
  .refine((value) => !/\s/.test(value), "密码不能包含空白字符")
  .refine(
    (value) => passwordCharacterClassCount(value) >= passwordPolicy.requiredCharacterClasses,
    "密码必须包含大小写字母、数字、符号中的至少三类"
  );

export const loginRequestSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(passwordPolicy.maxLength)
}).strict();

export const adminChangePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1).max(passwordPolicy.maxLength),
    newPassword: strongPasswordSchema,
    confirmPassword: z.string().min(1).max(passwordPolicy.maxLength)
  })
  .strict()
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "两次输入的新密码不一致"
  });

export const adminPasswordChangedResponseSchema = z.object({
  revokedSessionCount: z.number().int().min(0)
}).strict();

export type AdminChangePasswordRequest = z.infer<typeof adminChangePasswordRequestSchema>;
export type AdminPasswordChangedResponse = z.infer<typeof adminPasswordChangedResponseSchema>;

export const adminSessionStatusValues = ["active", "expired", "revoked"] as const;
export type AdminSessionStatus = (typeof adminSessionStatusValues)[number];
export const AdminSessionStatusSchema = z.enum(adminSessionStatusValues);

const apiIsoDateTimeStringSchema = z
  .string()
  .refine((value) => isoDateTimePattern.test(value), "时间必须是 ISO 字符串")
  .refine((value) => !Number.isNaN(new Date(value).getTime()), "时间必须有效");

export const adminSessionDtoSchema = z.object({
  id: z.string().min(1).max(128),
  adminId: z.number().int().positive(),
  username: z.string().min(1).max(64),
  status: AdminSessionStatusSchema,
  createdAt: apiIsoDateTimeStringSchema,
  expiresAt: apiIsoDateTimeStringSchema,
  revokedAt: apiIsoDateTimeStringSchema.nullable(),
  revokeReason: z.string().max(120).nullable()
}).strict();

export const adminSessionListResponseSchema = z.object({
  sessions: z.array(adminSessionDtoSchema)
}).strict();

export const adminLogoutResponseSchema = z.object({}).strict();

export type AdminSessionDto = z.infer<typeof adminSessionDtoSchema>;
export type AdminSessionListResponse = z.infer<typeof adminSessionListResponseSchema>;

export const clientWechatLoginCodeMaxLength = 512 as const;

export const clientWechatLoginRequestSchema = z.object({
  code: z.string().trim().min(1).max(clientWechatLoginCodeMaxLength)
}).strict();

export const clientSessionTokenTypeValues = ["Bearer"] as const;
export type ClientSessionTokenType = (typeof clientSessionTokenTypeValues)[number];
export const ClientSessionTokenTypeSchema = z.enum(clientSessionTokenTypeValues);

export const clientWechatLoginResponseSchema = z.object({
  token: z.string().min(32).max(4096),
  tokenType: z.literal("Bearer"),
  expiresInSeconds: z.number().int().positive().max(86_400),
  expiresAt: apiIsoDateTimeStringSchema
}).strict();

export const clientWechatLoginErrorCodeValues = [
  "VALIDATION_ERROR",
  "INVALID_WECHAT_CODE",
  "WECHAT_AUTH_UNAVAILABLE",
  "RATE_LIMITED",
  "INTERNAL_ERROR"
] as const;

export const ClientWechatLoginErrorCodeSchema = z.enum(clientWechatLoginErrorCodeValues);

export const clientProtectedRouteErrorCodeValues = [
  "CLIENT_AUTH_REQUIRED",
  "CLIENT_SESSION_EXPIRED",
  "CLIENT_SESSION_REVOKED"
] as const;

export const ClientProtectedRouteErrorCodeSchema = z.enum(clientProtectedRouteErrorCodeValues);

export type ClientWechatLoginRequest = z.infer<typeof clientWechatLoginRequestSchema>;
export type ClientWechatLoginResponse = z.infer<typeof clientWechatLoginResponseSchema>;
export type ClientWechatLoginErrorCode = z.infer<typeof ClientWechatLoginErrorCodeSchema>;
export type ClientProtectedRouteErrorCode = z.infer<typeof ClientProtectedRouteErrorCodeSchema>;

export const rateLimitPolicySchema = z.object({
  windowMs: z.number().int().min(1_000),
  limit: z.number().int().positive()
}).strict();

export const rateLimitErrorDataSchema = z.object({
  retryAfterSeconds: z.number().int().positive()
}).strict();

export type RateLimitPolicy = z.infer<typeof rateLimitPolicySchema>;
export type RateLimitErrorData = z.infer<typeof rateLimitErrorDataSchema>;

export const analyticsFieldLimits = {
  pagePathMaxLength: 256,
  sceneMaxLength: 64,
  userAgentMaxLength: 256
} as const;

export const pageViewRequestSchema = z.object({
  pagePath: z.string().trim().min(1).max(analyticsFieldLimits.pagePathMaxLength),
  scene: z.string().trim().min(1).max(analyticsFieldLimits.sceneMaxLength).optional()
}).strict();

export const pageViewTrackResponseSchema = z.object({}).strict();

export type PageViewRequest = z.infer<typeof pageViewRequestSchema>;
export type PageViewTrackResponse = z.infer<typeof pageViewTrackResponseSchema>;

export const backupStatusValues = ["ready", "verifying", "restoring", "failed"] as const;
export type BackupStatus = (typeof backupStatusValues)[number];
export const BackupStatusSchema = z.enum(backupStatusValues);

export const backupIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "备份 ID 只能包含字母、数字、点、下划线和连字符");

export const backupCreateRequestSchema = z.object({
  note: z.string().trim().max(200).optional()
}).strict();

export const backupDeleteRequestSchema = z.object({
  backupId: backupIdSchema,
  confirmation: z.literal("DELETE_BACKUP")
}).strict();

export const backupRestoreRequestSchema = z.object({
  backupId: backupIdSchema,
  confirmation: z.literal("RESTORE_FULL_BACKUP")
}).strict();

export const backupRelativePathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) => {
      if (value.includes("\0") || value.startsWith("/") || value.startsWith("\\")) return false;
      return !value.split(/[\\/]+/).includes("..");
    },
    "备份路径必须是安全相对路径"
  );

export const backupManifestFileSchema = z.object({
  path: backupRelativePathSchema,
  size: z.number().int().min(0),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i)
}).strict();

export const backupManifestCreatorSchema = z.object({
  adminId: z.number().int().positive(),
  username: z.string().min(1).max(64)
}).strict();

export const backupManifestAppSchema = z.object({
  name: z.string().min(1).max(120),
  version: z.string().min(1).max(80)
}).strict();

export const backupManifestSchemaMetadataSchema = z.object({
  provider: z.literal("sqlite"),
  sqliteVersion: z.string().min(1).max(80),
  userVersion: z.number().int().min(0),
  schemaHash: z.string().regex(/^[a-f0-9]{64}$/i),
  migrationIds: z.array(z.string().min(1).max(160))
}).strict();

export const backupManifestDatabaseSchema = backupManifestFileSchema.extend({
  snapshotMethod: z.literal("sqlite-vacuum-into"),
  pageSize: z.number().int().positive(),
  pageCount: z.number().int().min(0)
}).strict();

export const backupManifestUploadFileSchema = backupManifestFileSchema.extend({
  modifiedAt: apiIsoDateTimeStringSchema
}).strict();

export const backupManifestSchema = z.object({
  formatVersion: z.literal(1),
  status: BackupStatusSchema,
  app: backupManifestAppSchema,
  schema: backupManifestSchemaMetadataSchema,
  createdBy: backupManifestCreatorSchema,
  createdAt: apiIsoDateTimeStringSchema,
  note: z.string().max(200).nullable(),
  database: backupManifestDatabaseSchema,
  uploads: z.array(backupManifestUploadFileSchema),
  totalBytes: z.number().int().min(0),
  totalFiles: z.number().int().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i)
}).strict();

export const backupDtoSchema = z.object({
  id: backupIdSchema,
  formatVersion: z.literal(1),
  status: BackupStatusSchema,
  createdBy: backupManifestCreatorSchema,
  createdAt: apiIsoDateTimeStringSchema,
  size: z.number().int().min(0),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  database: backupManifestDatabaseSchema.pick({ size: true, sha256: true, snapshotMethod: true }),
  uploadFileCount: z.number().int().min(0),
  note: z.string().max(200).nullable()
}).strict();

export const backupCreateResponseSchema = z.object({
  backup: backupDtoSchema
}).strict();

export const backupListResponseSchema = z.object({
  backups: z.array(backupDtoSchema)
}).strict();

export const backupDeleteResponseSchema = z.object({
  backupId: backupIdSchema
}).strict();

export const backupPreflightTableImpactSchema = z.object({
  table: z.string().min(1).max(80),
  currentRows: z.number().int().min(0),
  candidateRows: z.number().int().min(0),
  deltaRows: z.number().int()
}).strict();

export const backupPreflightSummarySchema = z.object({
  formatVersion: z.literal(1),
  createdAt: apiIsoDateTimeStringSchema,
  createdBy: backupManifestCreatorSchema,
  note: z.string().max(200).nullable(),
  source: z.enum(["existing_backup", "external_archive"]),
  database: backupManifestDatabaseSchema.pick({ size: true, snapshotMethod: true, pageSize: true, pageCount: true }),
  uploads: z.object({
    fileCount: z.number().int().min(0),
    totalBytes: z.number().int().min(0)
  }).strict(),
  totals: z.object({
    fileCount: z.number().int().min(1),
    totalBytes: z.number().int().min(0)
  }).strict(),
  checks: z.object({
    manifest: z.literal("ok"),
    checksums: z.literal("ok"),
    sqliteIntegrity: z.literal("ok"),
    schemaCompatible: z.literal(true),
    mediaFiles: z.literal("ok")
  }).strict(),
  impact: z.object({
    tables: z.array(backupPreflightTableImpactSchema)
  }).strict()
}).strict();

export const backupImportPreflightResponseSchema = z.object({
  backup: backupDtoSchema,
  preflight: backupPreflightSummarySchema
}).strict();

export const backupRestoreAcceptedResponseSchema = z.object({
  restoreId: z.string().min(1).max(128),
  backupId: backupIdSchema,
  snapshotBackupId: backupIdSchema,
  revokedSessionCount: z.number().int().min(0)
}).strict();

export type BackupCreateRequest = z.infer<typeof backupCreateRequestSchema>;
export type BackupDeleteRequest = z.infer<typeof backupDeleteRequestSchema>;
export type BackupRestoreRequest = z.infer<typeof backupRestoreRequestSchema>;
export type BackupManifest = z.infer<typeof backupManifestSchema>;
export type BackupDto = z.infer<typeof backupDtoSchema>;
export type BackupPreflightSummary = z.infer<typeof backupPreflightSummarySchema>;
export type BackupCreateResponse = z.infer<typeof backupCreateResponseSchema>;
export type BackupListResponse = z.infer<typeof backupListResponseSchema>;
export type BackupDeleteResponse = z.infer<typeof backupDeleteResponseSchema>;
export type BackupImportPreflightResponse = z.infer<typeof backupImportPreflightResponseSchema>;
export type BackupRestoreAcceptedResponse = z.infer<typeof backupRestoreAcceptedResponseSchema>;

export const DetailPageMenuConfigSchema = z
  .object({
    detailPageType: DetailPageTypeSchema,
    detailPageId: z.number().int().positive()
  })
  .strict();

export type DetailPageMenuConfig = z.infer<typeof DetailPageMenuConfigSchema>;

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
    category: optionalQueryTextSchema,
    onlyFeatured: z.boolean().default(false),
    pageSize: z.number().int().positive().default(10)
  }),
  article: z.object({
    category: articleOptionalCategorySchema,
    pageSize: z.number().int().min(1).max(50).default(10)
  }),
  detail_page: DetailPageMenuConfigSchema,
  contact: z.object({
    phone: z.string().optional(),
    address: z.string().optional(),
    wechat: z.string().optional(),
    description: z.string().optional()
  })
} satisfies Record<MenuType, z.ZodType>;
