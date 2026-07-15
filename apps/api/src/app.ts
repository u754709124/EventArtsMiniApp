import { randomUUID } from "node:crypto";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart, { type MultipartFile } from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import type { Prisma } from "@prisma/client";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ActivityCaseCreateRequestSchema,
  ActivityCaseUpdateRequestSchema,
  ArticleCreateRequestSchema,
  ArticleUpdateRequestSchema,
  ArtistCreateRequestSchema,
  ArtistUpdateRequestSchema,
  BannerLinkTypeSchema,
  DetailPageInputSchema,
  DetailPageMenuConfigSchema,
  MediaFieldKeySchema,
  MenuItemCreateRequestSchema,
  MenuItemUpdateRequestSchema,
  adminArticleListQuerySchema,
  adminChangePasswordRequestSchema,
  adminReorderRequestSchema,
  artistListQuerySchema,
  backupCreateRequestSchema,
  backupDeleteRequestSchema,
  backupIdSchema,
  backupImportPreflightResponseSchema,
  backupRestoreAcceptedResponseSchema,
  backupRestoreRequestSchema,
  batchDeleteMediaRequestSchema,
  caseListQuerySchema,
  checkMediaNameRequestSchema,
  clientArticleListQuerySchema,
  clientWechatLoginRequestSchema,
  clientWechatLoginResponseSchema,
  fail,
  failWithRequestId,
  lookupMediaRequestSchema,
  loginRequestSchema,
  mediaFieldRules,
  mediaListQuerySchema,
  menuConfigSchemaByType,
  normalizeArtistTags,
  normalizeArticleCategories,
  normalizeResourceName,
  ok,
  pageViewRequestSchema,
  serializeArtistTags,
  updateMediaMetadataSchema,
  type ArtistType,
  type CaseMediaDto,
  type DetailPageConfigDto,
  type MediaFieldKey,
  type MenuType
} from "@event-arts/shared";
import type { AppPrismaClient } from "./db";
import {
  createDetailPage,
  deleteDetailPage,
  getDetailPageById,
  getDetailPageReferences,
  getRequiredDetailPageById,
  listDetailPageOptions,
  listDetailPages,
  previewDetailPage,
  updateDetailPage,
  validateDetailPageReference
} from "./detail-pages/detail-page-service";
import { extractRichTextMedia } from "./detail-pages/detail-page-sanitizer";
import { DetailPageDomainError } from "./detail-pages/detail-page-types";
import {
  ADMIN_SESSION_JWT_EXPIRES_IN,
  adminSessionRevokeReasons,
  createAdminSession,
  revokeAllAdminSessions,
  revokeAdminSession,
  revokeAdminSessionsForAdmin,
  type SessionClock
} from "./admin-sessions";
import {
  createMediaAsset,
  deleteStoredFile,
  getUploadConfig,
  getUploadLimits,
  inspectUpload,
  mediaReferenceSources,
  moveUploadToStorage,
  persistMultipartFile,
  queryMediaReferences,
  finalizeStagedFile,
  restoreStagedFile,
  stageStoredFileForDeletion,
  toMediaAssetDto,
  validateAssetForField
} from "./media";
import { resolveMediaAssetUrl, withResolvedMediaAssetUrl, type MediaUrlAsset } from "./media-url";
import { hashPassword, verifyPassword } from "./security";
import type { ApiConfig, ApiCorsConfig } from "./config";
import { BackupServiceError, backupArchiveMaxBytes, createBackupService, type BackupServiceHooks } from "./backup";
import {
  createApiLoggerOptions,
  logSecurityEvent,
  requestIdFromHeaders,
  redactSensitive,
  serializeErrorForLog,
  type ApiLoggerOptions
} from "./logging";
import {
  defaultPageViewAnalyticsConfig,
  recordPageViewEvent,
  weightedPageViewCount,
  type PageViewAnalyticsConfig
} from "./analytics";
import {
  FixedWindowRateLimiter,
  analyticsRateLimitKey,
  createInMemoryRateLimitStore,
  loginRateLimitKey,
  normalizeClientIp,
  type FixedWindowRateLimitPolicy,
  type RateLimitDenied,
  type RateLimitStore
} from "./rate-limit";
import {
  clientAuthLoginExchangePath,
  clientAuthProtectedRoutePrefix,
  createClientAuthVerifier,
  createClientSession,
  defaultTestClientAuthConfig,
  verifyClientSessionToken,
  type WeChatLoginCodeVerifier
} from "./client-auth";

type AppRateLimitConfig = {
  login: {
    windowMs: number;
    maxFailures: number;
  };
  analytics: {
    windowMs: number;
    maxRequests: number;
  };
};

type BuildOptions = {
  prisma: AppPrismaClient;
  jwtSecret: string;
  uploadDir: string;
  backupDir?: string;
  databaseUrl?: string;
  publicBaseUrl: string;
  cors?: ApiCorsConfig;
  logger?: ApiLoggerOptions;
  now?: SessionClock;
  backupHooks?: BackupServiceHooks;
  rateLimit?: AppRateLimitConfig;
  rateLimitStore?: RateLimitStore;
  analytics?: PageViewAnalyticsConfig;
  clientAuth?: ApiConfig["clientAuth"];
  weChatLoginCodeVerifier?: WeChatLoginCodeVerifier;
};

type AdminRequest = FastifyRequest & {
  admin?: { id: number; username: string; sessionJti: string };
};

type ClientRequest = FastifyRequest & {
  clientSession?: {
    id: string;
    appId: string;
    openidHash: string;
    unionidHash: string | null;
    expiresAt: Date;
  };
};

class MediaRecoveryError extends Error {
  readonly code = "MEDIA_RECOVERY_FAILED";
}

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };
const defaultCorsConfig: ApiCorsConfig = {
  allowedOrigins: [],
  allowRequestsWithoutOrigin: true
};
const publicInternalErrorMessage = "服务异常，请稍后再试";
const publicMediaRecoveryErrorMessage = "资源处理失败，请联系管理员并提供请求 ID";
const uploadedImageCacheControl = "public, max-age=2592000, immutable";
const defaultUploadedFileCacheControl = "public, max-age=0";
const uploadedImageFilePattern = /\.(?:jpg|png|webp)$/i;
const defaultAppRateLimit: AppRateLimitConfig = {
  login: { windowMs: 900_000, maxFailures: 5 },
  analytics: { windowMs: 60_000, maxRequests: 60 }
};
const statusInputSchema = z.enum(["enabled", "disabled"]);
const positiveIdSchema = z.coerce.number().int().positive();
const positiveBodyIdSchema = z.number().int().positive();
const nullableDetailPageIdSchema = positiveBodyIdSchema.nullable().default(null);
const sortOrderSchema = z.coerce.number().int().min(0);
const siteUpdateSchema = z.object({
  id: z.number().optional(),
  appName: z.string().min(1).optional(),
  subtitle: z.string().min(1).optional(),
  defaultBannerAssetId: positiveIdSchema.nullable().optional(),
  placeholderBannerAssetId: positiveIdSchema.nullable().optional(),
  placeholderIconAssetId: positiveIdSchema.nullable().optional(),
  placeholderCaseAssetId: positiveIdSchema.nullable().optional(),
  updatedAt: z.union([z.string(), z.date()]).optional()
}).strict();
const announcementCreateSchema = z.object({
  summary: z.string().min(1),
  content: z.string().min(1),
  displayDurationMs: z.coerce.number().int().positive(),
  detailPageId: nullableDetailPageIdSchema,
  sortOrder: sortOrderSchema,
  status: statusInputSchema
}).strict();
const announcementUpdateSchema = announcementCreateSchema.partial().strict();
const bannerCreateSchema = z.object({
  title: z.string().min(1),
  imageAssetId: positiveIdSchema,
  detailPageId: nullableDetailPageIdSchema,
  /** @deprecated Old clients may still send these fields; new admin no longer edits them. */
  linkType: BannerLinkTypeSchema.default("none"),
  linkTarget: z.string().nullable().optional(),
  switchDurationMs: z.coerce.number().int().positive(),
  sortOrder: sortOrderSchema,
  status: statusInputSchema
}).strict();
const bannerUpdateSchema = bannerCreateSchema.partial().strict();
const detailPagePreviewSchema = z.object({ detailPage: DetailPageInputSchema }).strict();
const detailPageListQuerySchema = z.object({
  q: z.string().trim().optional(),
  type: z.string().trim().optional(),
  page: positiveIdSchema.default(1),
  pageSize: positiveIdSchema.max(100).default(20)
});
const detailPageOptionQuerySchema = z.object({
  q: z.string().trim().optional(),
  type: z.string().trim().optional(),
  limit: positiveIdSchema.max(100).default(30)
});
const articleCategoryQuerySchema = z.object({
  q: z.string().trim().transform((value) => value || undefined).optional(),
  limit: positiveIdSchema.max(100).default(100)
});
const mediaMutationReleaseSymbol = Symbol("mediaMutationRelease");
const businessMutationReleaseSymbol = Symbol("businessMutationRelease");

function sendError(reply: FastifyReply, statusCode: number, code: string, message: string) {
  return reply.code(statusCode).headers(jsonHeaders).send(fail(code, message));
}

function sendPublicErrorWithRequestId(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  requestId: string
) {
  return reply.code(statusCode).headers(jsonHeaders).send(failWithRequestId(code, message, requestId));
}

function sendRateLimitError(reply: FastifyReply, decision: RateLimitDenied) {
  return reply
    .code(429)
    .header("Retry-After", String(decision.retryAfterSeconds))
    .headers(jsonHeaders)
    .send(fail("RATE_LIMITED", "请求过于频繁，请稍后再试"));
}

function loginRateLimitPolicy(config: AppRateLimitConfig): FixedWindowRateLimitPolicy {
  return {
    windowMs: config.login.windowMs,
    limit: config.login.maxFailures
  };
}

function analyticsRateLimitPolicy(config: AppRateLimitConfig): FixedWindowRateLimitPolicy {
  return {
    windowMs: config.analytics.windowMs,
    limit: config.analytics.maxRequests
  };
}

function trustedClientIp(request: FastifyRequest) {
  return normalizeClientIp(request.ip);
}

function firstZodIssueMessage(error: z.ZodError, fallback: string) {
  return error.issues[0]?.message ?? fallback;
}

function requiresBackupDeleteConfirmation(error: z.ZodError) {
  return error.issues.some((issue) => issue.path[0] === "confirmation");
}

function requiresBackupRestoreConfirmation(error: z.ZodError) {
  return error.issues.some((issue) => issue.path[0] === "confirmation");
}

function backupErrorCode(error: unknown) {
  return error instanceof BackupServiceError ? error.code : "INTERNAL_ERROR";
}

function backupErrorStatusCode(error: unknown) {
  return error instanceof BackupServiceError ? error.statusCode : 500;
}

function isMediaMutationRequest(request: FastifyRequest) {
  const pathname = request.url.split("?")[0] ?? request.url;
  return (
    (request.method === "POST" && pathname === "/api/admin/media-assets/upload") ||
    (request.method === "POST" && pathname === "/api/admin/media-assets/batch-delete") ||
    (request.method === "DELETE" && /^\/api\/admin\/media-assets\/[1-9]\d*$/.test(pathname))
  );
}

function isUnsafeHttpMethod(method: string) {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

function isRestoreRoute(request: FastifyRequest) {
  const pathname = request.url.split("?")[0] ?? request.url;
  return request.method === "POST" && /^\/api\/admin\/backups\/[A-Za-z0-9][A-Za-z0-9._-]*\/restore$/.test(pathname);
}

function requestPathname(request: FastifyRequest) {
  return request.url.split("?")[0] ?? request.url;
}

function isClientLoginExchangeRequest(request: FastifyRequest) {
  return request.method === "POST" && requestPathname(request) === clientAuthLoginExchangePath;
}

function isClientProtectedRequest(request: FastifyRequest) {
  const pathname = requestPathname(request);
  return pathname.startsWith(clientAuthProtectedRoutePrefix) && !isClientLoginExchangeRequest(request);
}

function bearerTokenFromRequest(request: FastifyRequest) {
  const header = request.headers.authorization;
  if (Array.isArray(header) || typeof header !== "string") return null;
  const match = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/.exec(header.trim());
  return match?.[1] ?? null;
}

function clientWechatLoginRateLimitKey(clientIp: string) {
  return loginRateLimitKey({ clientIp, username: "client:wechat" });
}

function wechatAuthFailureStatus(reason: string) {
  if (reason === "upstream_timeout") return 504;
  if (reason === "upstream_error" || reason === "misconfigured") return 502;
  return 401;
}

async function readBackupArchive(part: MultipartFile) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of part.file) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > backupArchiveMaxBytes) {
      throw new BackupServiceError("BACKUP_INVALID", "备份归档过大", 413);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

function parseRouteId(params: unknown) {
  const id = Number((params as { id?: string }).id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function reorderByIds(
  prisma: AppPrismaClient,
  ids: number[],
  handlers: {
    findAllIds: (tx: Prisma.TransactionClient) => Promise<Array<{ id: number }>>;
    updateOrder: (tx: Prisma.TransactionClient, id: number, sortOrder: number) => Promise<unknown>;
  }
) {
  await prisma.$transaction(async (tx) => {
    const existing = await handlers.findAllIds(tx);
    const existingIds = new Set(existing.map((item) => item.id));
    if (existingIds.size !== ids.length || ids.some((id) => !existingIds.has(id))) {
      throw new DetailPageDomainError("VALIDATION_ERROR", "排序记录不存在或不完整", 400);
    }
    await Promise.all(ids.map((id, index) => handlers.updateOrder(tx, id, index + 1)));
  });
}

function parseJson(value: string | null | undefined) {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function isMenuType(value: string): value is MenuType {
  return Object.hasOwn(menuConfigSchemaByType, value);
}

function parseMenuConfigForType(type: string, configJson: unknown) {
  if (!isMenuType(type)) return {};
  const schema = menuConfigSchemaByType[type];
  const parsed = schema.safeParse(configJson && typeof configJson === "object" ? configJson : {});
  if (!parsed.success) {
    console.warn(`Invalid menu config for type ${type}; falling back to defaults.`);
  }
  if (parsed.success) return parsed.data;
  const fallback = schema.safeParse({});
  return fallback.success ? fallback.data : {};
}

async function prepareMenuConfigForSave(prisma: AppPrismaClient, type: string, configJson: unknown) {
  if (!isMenuType(type)) {
    throw new DetailPageDomainError("VALIDATION_ERROR", "菜单类型错误", 400);
  }
  const parsed = menuConfigSchemaByType[type].safeParse(configJson && typeof configJson === "object" ? configJson : {});
  if (!parsed.success) {
    throw new DetailPageDomainError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "菜单配置错误", 400);
  }
  if (type === "detail_page") {
    const detailPageMenuConfig = DetailPageMenuConfigSchema.parse(parsed.data);
    const detailPage = await prisma.detailPageConfig.findUnique({
      where: { id: detailPageMenuConfig.detailPageId },
      select: { pageType: true }
    });
    if (!detailPage) {
      throw new DetailPageDomainError("DETAIL_PAGE_NOT_FOUND", "详情页不存在", 404);
    }
    if (detailPage.pageType !== detailPageMenuConfig.detailPageType) {
      throw new DetailPageDomainError("VALIDATION_ERROR", "详情页类型与所选类型不一致", 400);
    }
  }
  return parsed.data;
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function toIsoDateTime(date: Date) {
  return date.toISOString();
}

function mediaUrl(publicBaseUrl: string, asset: MediaUrlAsset | null | undefined) {
  return asset ? resolveMediaAssetUrl(publicBaseUrl, asset) : "";
}

function publicMediaAsset<T extends MediaUrlAsset>(publicBaseUrl: string, asset: T | null): T | null {
  return asset ? withResolvedMediaAssetUrl(publicBaseUrl, asset) : null;
}

function serializeCaseMedia(item: {
  sortOrder: number;
  mediaAsset: { id: number; mediaType: string; width: number | null; height: number | null } & MediaUrlAsset;
}, publicBaseUrl: string): CaseMediaDto {
  return {
    id: item.mediaAsset.id,
    mediaType: item.mediaAsset.mediaType as "image" | "video",
    url: mediaUrl(publicBaseUrl, item.mediaAsset),
    width: item.mediaAsset.width ?? 0,
    height: item.mediaAsset.height ?? 0,
    sortOrder: item.sortOrder
  };
}

type ArtistWithCover = Prisma.ArtistGetPayload<{ include: { avatarAsset: true } }>;

export function serializeArtist(item: ArtistWithCover, publicBaseUrl: string) {
  const coverUrl = item.avatarAsset ? mediaUrl(publicBaseUrl, item.avatarAsset) : null;
  const detailPageId = item.detailPageId ?? null;
  return {
    id: item.id,
    name: item.name,
    type: item.type as ArtistType,
    coverUrl,
    avatarUrl: coverUrl,
    location: item.location ?? "",
    badge: item.badge ?? "",
    tags: normalizeArtistTags(item.tagsJson),
    summary: item.summary,
    detail: item.detail,
    detailPageId,
    hasDetailPage: detailPageId !== null,
    sortOrder: item.sortOrder,
    status: item.status as "enabled" | "disabled"
  };
}

function serializeAdminArtist(item: ArtistWithCover, detailPage: DetailPageConfigDto | null, publicBaseUrl: string) {
  const artist = serializeArtist(item, publicBaseUrl);
  return {
    ...item,
    ...artist,
    avatarAsset: publicMediaAsset(publicBaseUrl, item.avatarAsset),
    detail: detailPage?.richTextHtml ?? item.detail,
    detailPageSummary: detailPage ? { id: detailPage.id, name: detailPage.name, type: detailPage.type, typeLabel: detailPage.typeLabel } : null,
    detailPageType: detailPage?.type ?? null,
    detailPageTypeLabel: detailPage?.typeLabel ?? "详情待补充",
    bannerCount: detailPage?.banners.length ?? 0,
    detailMediaCount: detailPage ? extractRichTextMedia(detailPage.richTextHtml).length : 0,
    hasRichText: Boolean(detailPage?.richTextHtml),
    tagsJson: artist.tags
  };
}

async function legacyCaseMediaFromDetailPage(prisma: AppPrismaClient, detailPage: DetailPageConfigDto, publicBaseUrl: string) {
  const references = extractRichTextMedia(detailPage.richTextHtml);
  const assets = references.length
    ? await prisma.mediaAsset.findMany({ where: { id: { in: references.map((item) => item.assetId) } } })
    : [];
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  return references.flatMap((reference, sortOrder) => {
    const asset = assetsById.get(reference.assetId);
    if (!asset) return [];
    return [{
      id: asset.id,
      mediaType: asset.mediaType as "image" | "video",
      url: mediaUrl(publicBaseUrl, asset),
      width: asset.width ?? 0,
      height: asset.height ?? 0,
      sortOrder
    } satisfies CaseMediaDto];
  });
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date) {
  const day = date.getDay() || 7;
  const start = startOfDay(date);
  start.setDate(start.getDate() - day + 1);
  return start;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

async function assetUrl(prisma: AppPrismaClient, id: number | null | undefined, publicBaseUrl: string) {
  if (!id) return "";
  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  return mediaUrl(publicBaseUrl, asset);
}

async function mediaProblemForId(prisma: AppPrismaClient, id: unknown, fieldKey: MediaFieldKey) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return { code: "VALIDATION_ERROR", message: `${mediaFieldRules[fieldKey].label}不能为空` };
  }
  const asset = await prisma.mediaAsset.findUnique({ where: { id: numericId } });
  if (!asset) return { code: "NOT_FOUND", message: `${mediaFieldRules[fieldKey].label}资源不存在` };
  return validateAssetForField(fieldKey, asset);
}

function serializeAnnouncement(item: {
  id: number;
  summary: string;
  content: string;
  displayDurationMs: number;
  detailPageId: number | null;
  sortOrder: number;
  status: string;
}) {
  const detailPageId = item.detailPageId ?? null;
  return {
    id: item.id,
    summary: item.summary,
    content: item.content,
    displayDurationMs: item.displayDurationMs,
    detailPageId,
    hasDetailPage: detailPageId !== null,
    sortOrder: item.sortOrder,
    status: item.status as "enabled" | "disabled"
  };
}

function serializeBanner(item: {
  id: number;
  title: string;
  imageAsset?: MediaUrlAsset | null;
  imageAssetId: number;
  linkType: string;
  linkTarget: string | null;
  detailPageId: number | null;
  switchDurationMs: number;
  sortOrder: number;
  status: string;
}, publicBaseUrl: string) {
  const detailPageId = item.detailPageId ?? null;
  return {
    ...item,
    imageAsset: publicMediaAsset(publicBaseUrl, item.imageAsset ?? null),
    imageUrl: mediaUrl(publicBaseUrl, item.imageAsset),
    detailPageId,
    hasDetailPage: detailPageId !== null,
    linkType: item.linkType,
    linkTarget: item.linkTarget,
    status: item.status as "enabled" | "disabled"
  };
}

function serializeMenuItem(item: {
  id: number;
  text: string;
  iconAssetId: number;
  iconAsset?: MediaUrlAsset | null;
  type: string;
  configJson: string;
  showOnHome: boolean;
  sortOrder: number;
  status: string;
}, publicBaseUrl: string) {
  return {
    id: item.id,
    text: item.text,
    iconAssetId: item.iconAssetId,
    iconUrl: mediaUrl(publicBaseUrl, item.iconAsset),
    type: item.type,
    configJson: parseMenuConfigForType(item.type, parseJson(item.configJson)),
    showOnHome: Boolean(item.showOnHome),
    sortOrder: item.sortOrder,
    status: item.status as "enabled" | "disabled"
  };
}

function matchesCaseQuery(item: { title: string; category: string; tag: string; summary: string; location: string }, q?: string) {
  const normalizedQuery = q?.toLocaleLowerCase("zh-CN");
  if (!normalizedQuery) return true;
  return [item.title, item.category, item.tag, item.summary, item.location]
    .some((value) => value.toLocaleLowerCase("zh-CN").includes(normalizedQuery));
}

function uniqueCaseCategories(items: Array<{ category: string | null }>) {
  return [...new Set(items
    .map((item) => item.category?.trim())
    .filter((category): category is string => Boolean(category)))]
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function uniqueArticleCategories(items: Array<{ category: string | null }>) {
  return normalizeArticleCategories(items.map((item) => item.category ?? ""))
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function articleWhere(query: { q?: string; category?: string; status?: "enabled" | "disabled"; isFeatured?: boolean }) {
  const where: Prisma.ArticleWhereInput = {};
  if (query.status) where.status = query.status;
  if (query.category) where.category = query.category;
  if (query.isFeatured !== undefined) where.isFeatured = query.isFeatured;
  if (query.q) {
    where.OR = [
      { title: { contains: query.q } },
      { category: { contains: query.q } },
      { summary: { contains: query.q } }
    ];
  }
  return where;
}

function serializeArticleListItem(item: Prisma.ArticleGetPayload<{ include: { coverAsset: true } }>, publicBaseUrl: string) {
  const detailPageId = item.detailPageId ?? null;
  return {
    id: item.id,
    title: item.title,
    category: item.category,
    coverUrl: mediaUrl(publicBaseUrl, item.coverAsset),
    summary: item.summary,
    publishedAt: toIsoDateTime(item.publishedAt),
    detailPageId,
    hasDetailPage: detailPageId !== null,
    isFeatured: item.isFeatured,
    featuredSortOrder: item.featuredSortOrder,
    sortOrder: item.sortOrder,
    status: item.status as "enabled" | "disabled"
  };
}

async function serializeAdminArticle(
  prisma: AppPrismaClient,
  item: Prisma.ArticleGetPayload<{ include: { coverAsset: true } }>,
  publicBaseUrl: string
) {
  const detailPage = item.detailPageId ? await getDetailPageById(prisma, item.detailPageId, false, publicBaseUrl) : null;
  return {
    ...serializeArticleListItem(item, publicBaseUrl),
    coverAssetId: item.coverAssetId,
    coverAsset: publicMediaAsset(publicBaseUrl, item.coverAsset),
    detailPageSummary: detailPage ? { id: detailPage.id, name: detailPage.name, type: detailPage.type, typeLabel: detailPage.typeLabel } : null,
    detailPageType: detailPage?.type ?? null,
    detailPageTypeLabel: detailPage?.typeLabel ?? "详情待补充",
    bannerCount: detailPage?.banners.length ?? 0,
    detailMediaCount: detailPage ? extractRichTextMedia(detailPage.richTextHtml).length : 0,
    hasRichText: Boolean(detailPage?.richTextHtml)
  };
}

function articleDataFromBody<T extends { publishedAt?: string | Date }>(body: T) {
  return {
    ...body,
    ...(body.publishedAt !== undefined ? { publishedAt: new Date(body.publishedAt) } : {})
  };
}

function serializeCaseListItem(item: Prisma.ActivityCaseGetPayload<{
  include: { coverAsset: true; media: { include: { mediaAsset: true } } };
}>, publicBaseUrl: string) {
  const detailPageId = item.detailPageId ?? null;
  return {
    id: item.id,
    title: item.title,
    category: item.category,
    tag: item.tag,
    summary: item.summary,
    eventDate: toIsoDate(item.eventDate),
    location: item.location,
    detail: item.detail,
    detailPageId,
    hasDetailPage: detailPageId !== null,
    isFeatured: item.isFeatured,
    featuredSortOrder: item.featuredSortOrder,
    sortOrder: item.sortOrder,
    status: item.status as "enabled" | "disabled",
    coverUrl: mediaUrl(publicBaseUrl, item.coverAsset),
    media: item.media.map((media) => serializeCaseMedia(media, publicBaseUrl))
  };
}

type CorsDecision =
  | { allowed: true; origin: string | false }
  | { allowed: false; reason: "missing_origin" | "invalid_origin" | "origin_not_allowed" | "wildcard_not_allowed" };

function normalizeOriginHeader(value: unknown) {
  const origin = Array.isArray(value) ? value[0] : value;
  if (typeof origin !== "string" || !origin.trim()) return null;
  try {
    const parsed = new URL(origin);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function evaluateCorsRequest(corsConfig: ApiCorsConfig, originHeader: unknown): CorsDecision {
  const normalizedOrigin = normalizeOriginHeader(originHeader);
  if (!normalizedOrigin) {
    return originHeader
      ? { allowed: false, reason: "invalid_origin" }
      : corsConfig.allowRequestsWithoutOrigin
        ? { allowed: true, origin: false }
        : { allowed: false, reason: "missing_origin" };
  }

  if (corsConfig.allowedOrigins.includes("*")) {
    return { allowed: false, reason: "wildcard_not_allowed" };
  }

  return corsConfig.allowedOrigins.includes(normalizedOrigin)
    ? { allowed: true, origin: normalizedOrigin }
    : { allowed: false, reason: "origin_not_allowed" };
}

function corsOriginResolver(corsConfig: ApiCorsConfig) {
  return (origin: string | undefined, callback: (error: Error | null, origin: string | boolean) => void) => {
    const decision = evaluateCorsRequest(corsConfig, origin);
    callback(null, decision.allowed ? decision.origin : false);
  };
}

export async function buildApp(options: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? createApiLoggerOptions(),
    trustProxy: "loopback",
    requestIdHeader: "x-request-id",
    genReqId: (request) => requestIdFromHeaders(request.headers)
  });
  const { prisma } = options;
  const corsConfig = options.cors ?? defaultCorsConfig;
  const uploadLimits = getUploadLimits();
  const currentTime = options.now ?? (() => new Date());
  const rateLimitConfig = options.rateLimit ?? defaultAppRateLimit;
  const analyticsConfig = options.analytics ?? defaultPageViewAnalyticsConfig;
  const clientAuthConfig = options.clientAuth ?? defaultTestClientAuthConfig();
  const weChatLoginCodeVerifier =
    options.weChatLoginCodeVerifier ?? createClientAuthVerifier(clientAuthConfig);
  const rateLimiter = new FixedWindowRateLimiter(
    options.rateLimitStore ?? createInMemoryRateLimitStore(),
    currentTime
  );
  const backupService = createBackupService({
    prisma,
    uploadDir: options.uploadDir,
    backupDir: options.backupDir ?? path.resolve(options.uploadDir, "..", "backups"),
    databaseUrl: options.databaseUrl ?? process.env.DATABASE_URL ?? "file:./dev.db",
    now: currentTime,
    hooks: options.backupHooks
  });
  let backupCreateInProgress = false;
  let backupDonePromise: Promise<void> | null = null;
  let resolveBackupDone: (() => void) | null = null;
  let activeMediaMutations = 0;
  let mediaIdleResolvers: Array<() => void> = [];
  let restoreInProgress = false;
  let activeBusinessMutations = 0;
  let businessIdleResolvers: Array<() => void> = [];
  const loginLimiterPolicy = loginRateLimitPolicy(rateLimitConfig);
  const analyticsLimiterPolicy = analyticsRateLimitPolicy(rateLimitConfig);
  const invalidLoginPasswordHash = hashPassword(randomUUID());

  async function waitForBackupCreate() {
    while (backupDonePromise) await backupDonePromise;
  }

  async function waitForMediaMutations() {
    if (activeMediaMutations === 0) return;
    await new Promise<void>((resolve) => {
      mediaIdleResolvers.push(resolve);
    });
  }

  async function waitForBusinessMutations() {
    if (activeBusinessMutations === 0) return;
    await new Promise<void>((resolve) => {
      businessIdleResolvers.push(resolve);
    });
  }

  function releaseMediaMutation() {
    activeMediaMutations = Math.max(0, activeMediaMutations - 1);
    if (activeMediaMutations === 0) {
      const resolvers = mediaIdleResolvers;
      mediaIdleResolvers = [];
      resolvers.forEach((resolve) => resolve());
    }
  }

  function releaseBusinessMutation() {
    activeBusinessMutations = Math.max(0, activeBusinessMutations - 1);
    if (activeBusinessMutations === 0) {
      const resolvers = businessIdleResolvers;
      businessIdleResolvers = [];
      resolvers.forEach((resolve) => resolve());
    }
  }

  async function runBackupCreateExclusive<T>(handler: () => Promise<T>) {
    if (backupCreateInProgress) {
      throw new BackupServiceError("BACKUP_CONFLICT", "已有备份创建任务正在进行，请稍后重试", 409);
    }
    backupCreateInProgress = true;
    backupDonePromise = new Promise<void>((resolve) => {
      resolveBackupDone = resolve;
    });
    try {
      await waitForMediaMutations();
      return await handler();
    } finally {
      backupCreateInProgress = false;
      const resolve = resolveBackupDone;
      resolveBackupDone = null;
      backupDonePromise = null;
      resolve?.();
    }
  }

  async function runRestoreExclusive<T>(handler: () => Promise<T>) {
    if (restoreInProgress || backupCreateInProgress) {
      throw new BackupServiceError("BACKUP_CONFLICT", "已有备份或恢复任务正在进行，请稍后重试", 409);
    }
    restoreInProgress = true;
    try {
      await waitForBusinessMutations();
      await waitForMediaMutations();
      return await handler();
    } finally {
      restoreInProgress = false;
    }
  }

  await mkdir(options.uploadDir, { recursive: true });
  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Request-Id", request.id);
    const corsDecision = evaluateCorsRequest(corsConfig, request.headers.origin);
    if (!corsDecision.allowed) {
      logSecurityEvent(request, "cors_rejected", {
        reason: corsDecision.reason,
        origin: request.headers.origin
      }, "warn");
      return sendError(reply, 403, "FORBIDDEN", "请求来源不被允许");
    }
  });
  await app.register(cors, {
    origin: corsOriginResolver(corsConfig),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id"]
  });
  await app.register(jwt, { secret: options.jwtSecret });
  await app.register(multipart, {
    limits: { fileSize: Math.max(uploadLimits.imageMaxBytes, uploadLimits.videoMaxBytes, backupArchiveMaxBytes), files: 1 }
  });
  await app.register(fastifyStatic, {
    root: options.uploadDir,
    prefix: "/uploads/",
    decorateReply: false,
    cacheControl: false,
    setHeaders(response, filePath) {
      response.setHeader(
        "Cache-Control",
        uploadedImageFilePattern.test(filePath) ? uploadedImageCacheControl : defaultUploadedFileCacheControl
      );
    }
  });

  app.addHook("preHandler", async (request, reply) => {
    if (isUnsafeHttpMethod(request.method) && !isRestoreRoute(request)) {
      if (restoreInProgress) {
        return sendError(
          reply,
          503,
          "MAINTENANCE_MODE",
          "系统正在恢复备份，请稍后再试"
        );
      }
      activeBusinessMutations += 1;
      (request as FastifyRequest & { [businessMutationReleaseSymbol]?: () => void })[
        businessMutationReleaseSymbol
      ] = releaseBusinessMutation;
    }
    if (!isMediaMutationRequest(request)) return;
    await waitForBackupCreate();
    activeMediaMutations += 1;
    (request as FastifyRequest & { [mediaMutationReleaseSymbol]?: () => void })[mediaMutationReleaseSymbol] =
      releaseMediaMutation;
  });

  app.addHook("onResponse", async (request) => {
    const businessRelease = (request as FastifyRequest & { [businessMutationReleaseSymbol]?: () => void })[
      businessMutationReleaseSymbol
    ];
    if (businessRelease) {
      delete (request as FastifyRequest & { [businessMutationReleaseSymbol]?: () => void })[
        businessMutationReleaseSymbol
      ];
      businessRelease();
    }
    const release = (request as FastifyRequest & { [mediaMutationReleaseSymbol]?: () => void })[
      mediaMutationReleaseSymbol
    ];
    if (!release) return;
    delete (request as FastifyRequest & { [mediaMutationReleaseSymbol]?: () => void })[mediaMutationReleaseSymbol];
    release();
  });

  app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, request, reply) => {
    if (error instanceof DetailPageDomainError) {
      return sendError(reply, error.statusCode, error.code, error.message);
    }
    if (error.code === "MEDIA_RECOVERY_FAILED") {
      logSecurityEvent(request, "media_recovery_failed", {
        error: serializeErrorForLog(error),
        headers: request.headers,
        body: request.body
      }, "error");
      return sendPublicErrorWithRequestId(
        reply,
        500,
        error.code,
        publicMediaRecoveryErrorMessage,
        request.id
      );
    }
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (statusCode < 500) {
      return sendError(reply, statusCode, error.code ?? "BAD_REQUEST", "请求参数错误");
    }

    request.log.error({
      event: "request_error",
      requestId: request.id,
      error: serializeErrorForLog(error),
      headers: redactSensitive(request.headers),
      body: redactSensitive(request.body)
    }, "request failed");
    return sendPublicErrorWithRequestId(reply, statusCode, "INTERNAL_ERROR", publicInternalErrorMessage, request.id);
  });

  app.setNotFoundHandler((request, reply) => {
    return sendError(reply, 404, "NOT_FOUND", "接口不存在");
  });

  async function requireAdmin(request: AdminRequest, reply: FastifyReply) {
    try {
      const decoded = await request.jwtVerify<{ id: number; username: string; jti?: string }>();
      if (!decoded.jti) throw new Error("missing session id");
      const session = await prisma.adminSession.findUnique({
        where: { jti: decoded.jti },
        include: { admin: true }
      });
      if (
        !session ||
        session.adminId !== decoded.id ||
        session.revokedAt ||
        session.expiresAt <= currentTime() ||
        session.admin.status !== "enabled"
      ) {
        throw new Error("invalid admin session");
      }
      request.admin = { id: session.admin.id, username: session.admin.username, sessionJti: session.jti };
    } catch {
      return sendError(reply, 401, "UNAUTHORIZED", "请先登录");
    }
  }

  async function requireClientSession(request: ClientRequest, reply: FastifyReply) {
    const result = await verifyClientSessionToken(prisma, {
      token: bearerTokenFromRequest(request),
      now: currentTime(),
      touch: true
    });
    if (!result.ok) {
      logSecurityEvent(request, "client_session_rejected", {
        reason: result.reason,
        code: result.publicErrorCode,
        hasAuthorization: Boolean(request.headers.authorization),
        origin: request.headers.origin,
        referer: request.headers.referer,
        userAgent: request.headers["user-agent"]
      }, "warn");
      return sendError(reply, 401, result.publicErrorCode, result.publicMessage);
    }
    request.clientSession = {
      id: result.session.id,
      appId: result.session.appId,
      openidHash: result.session.openidHash,
      unionidHash: result.session.unionidHash,
      expiresAt: result.session.expiresAt
    };
  }

  app.addHook("preHandler", async (request, reply) => {
    if (!isClientProtectedRequest(request)) return;
    return requireClientSession(request as ClientRequest, reply);
  });

  async function deleteMediaAssetWithFile(id: number) {
    const asset = await prisma.mediaAsset.findUnique({ where: { id }, include: { tags: true } });
    if (!asset) return { status: "not_found" as const };
    const referenceSources = await mediaReferenceSources(prisma, id);
    if (referenceSources.length) return { status: "in_use" as const, referenceSources };

    const staged = await stageStoredFileForDeletion(options.uploadDir, asset.filename);
    try {
      await prisma.mediaAsset.delete({ where: { id } });
    } catch (error) {
      try {
        await restoreStagedFile(staged);
      } catch (restoreError) {
        throw new MediaRecoveryError(`资源删除失败且文件恢复失败，需人工检查暂存文件：${String(restoreError)}`);
      }
      if ((error as { code?: string }).code === "P2003") {
        return { status: "in_use" as const, referenceSources: await mediaReferenceSources(prisma, id) };
      }
      throw error;
    }

    try {
      await finalizeStagedFile(staged);
    } catch (error) {
      try {
        await prisma.mediaAsset.create({
          data: {
            id: asset.id,
            resourceName: asset.resourceName,
            resourceNameKey: asset.resourceNameKey,
            originalName: asset.originalName,
            filename: asset.filename,
            md5: asset.md5,
            mimeType: asset.mimeType,
            mediaType: asset.mediaType,
            legacyUsage: asset.legacyUsage,
            url: asset.url,
            width: asset.width,
            height: asset.height,
            size: asset.size,
            storageType: asset.storageType,
            createdBy: asset.createdBy,
            createdAt: asset.createdAt,
            updatedAt: asset.updatedAt,
            tags: { create: asset.tags.map((tag) => ({ label: tag.label, labelKey: tag.labelKey })) }
          }
        });
      } catch (databaseRestoreError) {
        throw new MediaRecoveryError(`资源文件清理失败且数据库恢复失败，暂存文件已保留：${String(databaseRestoreError)}`);
      }
      try {
        await restoreStagedFile(staged);
      } catch (fileRestoreError) {
        throw new MediaRecoveryError(`资源数据库已恢复但文件恢复失败，暂存文件已保留：${String(fileRestoreError)}`);
      }
      throw error;
    }
    return { status: "deleted" as const };
  }

  async function writeOperationLog(action: string, detail: Record<string, unknown>, createdBy?: number) {
    await prisma.operationLog.create({
      data: {
        action,
        detail: JSON.stringify(redactSensitive(detail)),
        createdBy
      }
    });
  }

  async function mediaDtosForReferences(rows: Array<{ id: number; referenceCount: number }>) {
    if (!rows.length) return [];
    const assets: Array<Prisma.MediaAssetGetPayload<{ include: { tags: true } }>> = [];
    for (let offset = 0; offset < rows.length; offset += 500) {
      assets.push(...await prisma.mediaAsset.findMany({
        where: { id: { in: rows.slice(offset, offset + 500).map((row) => row.id) } },
        include: { tags: true }
      }));
    }
    const creatorIds = [...new Set(assets.flatMap((asset) => asset.createdBy ? [asset.createdBy] : []))];
    const creators = creatorIds.length
      ? await prisma.adminUser.findMany({ where: { id: { in: creatorIds } }, select: { id: true, username: true } })
      : [];
    const creatorNames = new Map(creators.map((creator) => [creator.id, creator.username]));
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    return Promise.all(rows.map((row) => {
      const asset = assetById.get(row.id);
      if (!asset) throw new Error(`missing media asset ${row.id}`);
      return toMediaAssetDto(prisma, asset, {
        publicBaseUrl: options.publicBaseUrl,
        referenceCount: row.referenceCount,
        createdByName: asset.createdBy ? creatorNames.get(asset.createdBy) ?? null : null
      });
    }));
  }

  app.post("/api/admin/auth/login", async (request, reply) => {
    const parsed = loginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", firstZodIssueMessage(parsed.error, "登录参数错误"));
    }

    const clientIp = trustedClientIp(request);
    const loginLimiterKey = loginRateLimitKey({
      clientIp,
      username: parsed.data.username
    });
    const admin = await prisma.adminUser.findUnique({ where: { username: parsed.data.username } });
    const candidatePasswordHash = admin?.status === "enabled" ? admin.passwordHash : invalidLoginPasswordHash;
    const passwordMatches = verifyPassword(parsed.data.password, candidatePasswordHash);
    if (!admin || admin.status !== "enabled" || !passwordMatches) {
      const limitDecision = await rateLimiter.consume(loginLimiterKey, loginLimiterPolicy);
      logSecurityEvent(request, "admin_login_failed", {
        username: parsed.data.username,
        clientIp,
        adminExists: Boolean(admin),
        adminStatus: admin?.status ?? "missing"
      }, "warn");
      if (!limitDecision.allowed) {
        logSecurityEvent(request, "admin_login_rate_limited", {
          username: parsed.data.username,
          clientIp,
          retryAfterSeconds: limitDecision.retryAfterSeconds,
          resetAt: limitDecision.resetAt
        }, "warn");
        return sendRateLimitError(reply, limitDecision);
      }
      return sendError(reply, 401, "INVALID_CREDENTIALS", "用户名或密码错误");
    }

    await rateLimiter.reset(loginLimiterKey);
    const session = await createAdminSession(prisma, { adminId: admin.id, now: currentTime() });
    const token = app.jwt.sign(
      { id: admin.id, username: admin.username, jti: session.jti },
      { expiresIn: ADMIN_SESSION_JWT_EXPIRES_IN }
    );
    return reply.send(ok({ token, id: admin.id, username: admin.username }));
  });

  app.post("/api/admin/auth/logout", { preHandler: requireAdmin }, async (request: AdminRequest, reply) => {
    const revoked = await revokeAdminSession(prisma, {
      jti: request.admin!.sessionJti,
      reason: adminSessionRevokeReasons.logout,
      now: currentTime()
    });
    logSecurityEvent(request, "admin_session_revoked", {
      adminId: request.admin!.id,
      username: request.admin!.username,
      sessionJti: request.admin!.sessionJti,
      reason: adminSessionRevokeReasons.logout,
      revokedSessionCount: revoked.count
    });
    return reply.send(ok({}));
  });

  app.get("/api/admin/auth/me", { preHandler: requireAdmin }, async (request: AdminRequest, reply) => {
    return reply.send(ok({ id: request.admin!.id, username: request.admin!.username }));
  });

  app.post("/api/admin/auth/change-password", { preHandler: requireAdmin }, async (request: AdminRequest, reply) => {
    const parsed = adminChangePasswordRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const hasWeakPasswordIssue = parsed.error.issues.some((issue) => issue.path[0] === "newPassword");
      logSecurityEvent(request, "admin_password_change_failed", {
        adminId: request.admin!.id,
        reason: hasWeakPasswordIssue ? "weak_password" : "validation_error"
      }, "warn");
      return sendError(
        reply,
        400,
        hasWeakPasswordIssue ? "WEAK_PASSWORD" : "VALIDATION_ERROR",
        firstZodIssueMessage(parsed.error, "密码参数错误")
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const admin = await tx.adminUser.findFirst({
        where: { id: request.admin!.id, status: "enabled" }
      });
      if (!admin || !verifyPassword(parsed.data.currentPassword, admin.passwordHash)) {
        return { status: "invalid_current_password" as const };
      }

      const updated = await tx.adminUser.updateMany({
        where: { id: admin.id, status: "enabled", passwordHash: admin.passwordHash },
        data: { passwordHash: hashPassword(parsed.data.newPassword) }
      });
      if (updated.count !== 1) return { status: "stale_password" as const };

      const revoked = await revokeAdminSessionsForAdmin(tx, {
        adminId: admin.id,
        reason: adminSessionRevokeReasons.passwordChanged,
        now: currentTime()
      });
      return { status: "changed" as const, revokedSessionCount: revoked.count };
    });

    if (result.status !== "changed") {
      logSecurityEvent(request, "admin_password_change_failed", {
        adminId: request.admin!.id,
        reason: result.status
      }, "warn");
      return sendError(reply, 401, "INVALID_CREDENTIALS", "当前密码错误");
    }

    logSecurityEvent(request, "admin_password_changed", {
      adminId: request.admin!.id,
      username: request.admin!.username
    });
    logSecurityEvent(request, "admin_sessions_revoked", {
      adminId: request.admin!.id,
      reason: adminSessionRevokeReasons.passwordChanged,
      revokedSessionCount: result.revokedSessionCount
    });
    return reply.send(ok({ revokedSessionCount: result.revokedSessionCount }));
  });

  app.get("/api/admin/dashboard/overview", { preHandler: requireAdmin }, async (_request, reply) => {
    const now = currentTime();
    const [todayPv, weekPv, monthPv] = await Promise.all([
      weightedPageViewCount(prisma, startOfDay(now)),
      weightedPageViewCount(prisma, startOfWeek(now)),
      weightedPageViewCount(prisma, startOfMonth(now))
    ]);
    return reply.send(
      ok({
        todayPv,
        weekPv,
        monthPv,
        estimated: analyticsConfig.sampleRate < 1,
        sampleRate: analyticsConfig.sampleRate,
        sampleWeight: Math.max(1, Math.round(1 / analyticsConfig.sampleRate))
      })
    );
  });

  app.get("/api/admin/backups", { preHandler: requireAdmin }, async (_request, reply) => {
    return reply.send(ok({ backups: await backupService.listBackups() }));
  });

  app.post("/api/admin/backups", { preHandler: requireAdmin }, async (request: AdminRequest, reply) => {
    const parsed = backupCreateRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      await writeOperationLog(
        "CREATE_BACKUP_FAILED",
        { code: "VALIDATION_ERROR" },
        request.admin!.id
      ).catch(() => undefined);
      logSecurityEvent(request, "backup_create_failed", {
        adminId: request.admin!.id,
        code: "VALIDATION_ERROR"
      }, "warn");
      return sendError(reply, 400, "VALIDATION_ERROR", firstZodIssueMessage(parsed.error, "备份参数错误"));
    }

    logSecurityEvent(request, "backup_create_requested", {
      adminId: request.admin!.id,
      username: request.admin!.username
    });
    try {
      const backup = await runBackupCreateExclusive(() =>
        backupService.createBackup({
          createdBy: { id: request.admin!.id, username: request.admin!.username },
          note: parsed.data.note
        })
      );
      await writeOperationLog(
        "CREATE_BACKUP",
        { backupId: backup.id, size: backup.size, sha256: backup.sha256, status: backup.status },
        request.admin!.id
      );
      logSecurityEvent(request, "backup_create_completed", {
        adminId: request.admin!.id,
        backupId: backup.id,
        size: backup.size,
        sha256: backup.sha256
      });
      return reply.send(ok({ backup }));
    } catch (error) {
      await writeOperationLog(
        "CREATE_BACKUP_FAILED",
        { code: backupErrorCode(error) },
        request.admin!.id
      ).catch(() => undefined);
      logSecurityEvent(request, "backup_create_failed", {
        adminId: request.admin!.id,
        code: backupErrorCode(error),
        error: serializeErrorForLog(error)
      }, "error");
      if (error instanceof BackupServiceError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }
      throw error;
    }
  });

  app.post("/api/admin/backups/import", { preHandler: requireAdmin }, async (request: AdminRequest, reply) => {
    let archive: Buffer | null = null;
    let originalName: string | null = null;
    try {
      for await (const part of request.parts()) {
        if (part.type === "field") continue;
        if (part.fieldname !== "file" && part.fieldname !== "archive") {
          for await (const chunk of part.file) void chunk;
          return sendError(reply, 400, "VALIDATION_ERROR", "导入归档字段必须为 file 或 archive");
        }
        if (archive) return sendError(reply, 400, "VALIDATION_ERROR", "每次只能导入一个备份归档");
        originalName = path.basename(part.filename || "backup.tar").slice(0, 160);
        archive = await readBackupArchive(part);
      }
    } catch (error) {
      if ((error as Error).message === "FILE_TOO_LARGE" || (error as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") {
        return sendError(reply, 413, "BACKUP_INVALID", "备份归档过大");
      }
      if (error instanceof BackupServiceError) return sendError(reply, error.statusCode, error.code, error.message);
      throw error;
    }
    if (!archive) return sendError(reply, 400, "VALIDATION_ERROR", "导入归档不能为空");

    logSecurityEvent(request, "backup_import_requested", {
      adminId: request.admin!.id,
      username: request.admin!.username,
      source: "external_archive",
      archiveName: originalName,
      archiveBytes: archive.byteLength
    });
    try {
      const imported = await backupService.importArchive({
        archive,
        originalName,
        importedBy: { id: request.admin!.id, username: request.admin!.username }
      });
      await writeOperationLog(
        "IMPORT_BACKUP",
        {
          backupId: imported.backup.id,
          source: "external_archive",
          operator: { adminId: request.admin!.id, username: request.admin!.username },
          archiveName: originalName,
          archiveBytes: archive.byteLength,
          result: "completed",
          requestId: request.id
        },
        request.admin!.id
      );
      logSecurityEvent(request, "backup_import_completed", {
        adminId: request.admin!.id,
        backupId: imported.backup.id,
        source: "external_archive",
        archiveName: originalName,
        archiveBytes: archive.byteLength,
        requestId: request.id
      });
      return reply.send(ok(backupImportPreflightResponseSchema.parse({
        backup: imported.backup,
        preflight: imported.summary
      })));
    } catch (error) {
      await writeOperationLog(
        "IMPORT_BACKUP_FAILED",
        {
          source: "external_archive",
          operator: { adminId: request.admin!.id, username: request.admin!.username },
          archiveName: originalName,
          archiveBytes: archive.byteLength,
          result: "failed",
          requestId: request.id,
          code: backupErrorCode(error)
        },
        request.admin!.id
      ).catch(() => undefined);
      logSecurityEvent(request, "backup_import_rejected", {
        adminId: request.admin!.id,
        source: "external_archive",
        archiveName: originalName,
        archiveBytes: archive.byteLength,
        requestId: request.id,
        code: backupErrorCode(error),
        error: serializeErrorForLog(error)
      }, "warn");
      if (error instanceof BackupServiceError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }
      throw error;
    }
  });

  app.post("/api/admin/backups/:id/restore", { preHandler: requireAdmin }, async (request: AdminRequest, reply) => {
    const parsedId = backupIdSchema.safeParse((request.params as { id?: string }).id);
    if (!parsedId.success) return sendError(reply, 400, "VALIDATION_ERROR", "备份 ID 无效");
    const parsed = backupRestoreRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const confirmationMissing = requiresBackupRestoreConfirmation(parsed.error);
      return sendError(
        reply,
        400,
        confirmationMissing ? "BACKUP_RESTORE_CONFIRMATION_REQUIRED" : "VALIDATION_ERROR",
        confirmationMissing ? "恢复备份需要显式确认" : firstZodIssueMessage(parsed.error, "恢复备份参数错误")
      );
    }
    if (parsed.data.backupId !== parsedId.data) {
      return sendError(reply, 400, "VALIDATION_ERROR", "路径备份 ID 与请求体不一致");
    }

    logSecurityEvent(request, "backup_restore_requested", {
      adminId: request.admin!.id,
      username: request.admin!.username,
      backupId: parsedId.data,
      source: "backup",
      requestId: request.id
    });
    try {
      const restore = await runRestoreExclusive(() =>
        backupService.restoreBackup({
          backupId: parsedId.data,
          createdBy: { id: request.admin!.id, username: request.admin!.username }
        })
      );
      const revoked = await revokeAllAdminSessions(prisma, {
        reason: adminSessionRevokeReasons.restoreCompleted,
        now: currentTime()
      });
      await writeOperationLog(
        "RESTORE_BACKUP",
        {
          backupId: restore.backupId,
          snapshotBackupId: restore.snapshotBackupId,
          restoreId: restore.restoreId,
          source: "backup",
          operator: { adminId: request.admin!.id, username: request.admin!.username },
          result: "completed",
          requestId: request.id,
          revokedSessionCount: revoked.count
        },
        request.admin!.id
      );
      logSecurityEvent(request, "backup_restore_completed", {
        adminId: request.admin!.id,
        backupId: restore.backupId,
        snapshotBackupId: restore.snapshotBackupId,
        restoreId: restore.restoreId,
        source: "backup",
        result: "completed",
        requestId: request.id,
        revokedSessionCount: revoked.count
      });
      return reply.send(ok(backupRestoreAcceptedResponseSchema.parse({
        restoreId: restore.restoreId,
        backupId: restore.backupId,
        snapshotBackupId: restore.snapshotBackupId,
        revokedSessionCount: revoked.count
      })));
    } catch (error) {
      await writeOperationLog(
        "RESTORE_BACKUP_FAILED",
        {
          backupId: parsedId.data,
          source: "backup",
          operator: { adminId: request.admin!.id, username: request.admin!.username },
          result: "failed",
          requestId: request.id,
          code: backupErrorCode(error)
        },
        request.admin!.id
      ).catch(() => undefined);
      logSecurityEvent(request, "backup_restore_failed", {
        adminId: request.admin!.id,
        backupId: parsedId.data,
        source: "backup",
        result: "failed",
        requestId: request.id,
        code: backupErrorCode(error),
        statusCode: backupErrorStatusCode(error),
        error: serializeErrorForLog(error)
      }, "error");
      if (error instanceof BackupServiceError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }
      throw error;
    }
  });

  app.delete("/api/admin/backups/:id", { preHandler: requireAdmin }, async (request: AdminRequest, reply) => {
    const parsedId = backupIdSchema.safeParse((request.params as { id?: string }).id);
    if (!parsedId.success) {
      await writeOperationLog(
        "DELETE_BACKUP_FAILED",
        { code: "VALIDATION_ERROR" },
        request.admin!.id
      ).catch(() => undefined);
      logSecurityEvent(request, "backup_delete_failed", {
        adminId: request.admin!.id,
        code: "VALIDATION_ERROR"
      }, "warn");
      return sendError(reply, 400, "VALIDATION_ERROR", "备份 ID 无效");
    }
    const parsed = backupDeleteRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      const confirmationMissing = requiresBackupDeleteConfirmation(parsed.error);
      const code = confirmationMissing ? "BACKUP_DELETE_CONFIRMATION_REQUIRED" : "VALIDATION_ERROR";
      await writeOperationLog(
        "DELETE_BACKUP_FAILED",
        { backupId: parsedId.data, code },
        request.admin!.id
      ).catch(() => undefined);
      logSecurityEvent(request, "backup_delete_failed", {
        adminId: request.admin!.id,
        backupId: parsedId.data,
        code
      }, "warn");
      return sendError(
        reply,
        400,
        code,
        confirmationMissing ? "删除备份需要显式确认" : firstZodIssueMessage(parsed.error, "删除备份参数错误")
      );
    }
    if (parsed.data.backupId !== parsedId.data) {
      await writeOperationLog(
        "DELETE_BACKUP_FAILED",
        { backupId: parsedId.data, code: "VALIDATION_ERROR" },
        request.admin!.id
      ).catch(() => undefined);
      logSecurityEvent(request, "backup_delete_failed", {
        adminId: request.admin!.id,
        backupId: parsedId.data,
        code: "VALIDATION_ERROR"
      }, "warn");
      return sendError(reply, 400, "VALIDATION_ERROR", "路径备份 ID 与请求体不一致");
    }

    logSecurityEvent(request, "backup_delete_requested", {
      adminId: request.admin!.id,
      username: request.admin!.username,
      backupId: parsedId.data
    });
    try {
      const result = await backupService.deleteBackup(parsedId.data);
      await writeOperationLog("DELETE_BACKUP", { backupId: result.backupId }, request.admin!.id);
      logSecurityEvent(request, "backup_delete_completed", {
        adminId: request.admin!.id,
        backupId: result.backupId
      });
      return reply.send(ok(result));
    } catch (error) {
      await writeOperationLog(
        "DELETE_BACKUP_FAILED",
        { backupId: parsedId.data, code: backupErrorCode(error) },
        request.admin!.id
      ).catch(() => undefined);
      logSecurityEvent(request, "backup_delete_failed", {
        adminId: request.admin!.id,
        backupId: parsedId.data,
        code: backupErrorCode(error),
        error: serializeErrorForLog(error)
      }, "error");
      if (error instanceof BackupServiceError) {
        return sendError(reply, error.statusCode, error.code, error.message);
      }
      throw error;
    }
  });

  app.post(clientAuthLoginExchangePath, async (request, reply) => {
    const clientIp = trustedClientIp(request);
    const limiterKey = clientWechatLoginRateLimitKey(clientIp);
    const preLimitDecision = await rateLimiter.peek(limiterKey, loginLimiterPolicy);
    if (!preLimitDecision.allowed) {
      logSecurityEvent(request, "client_wechat_login_rate_limited", {
        clientIp,
        retryAfterSeconds: preLimitDecision.retryAfterSeconds,
        resetAt: preLimitDecision.resetAt
      }, "warn");
      return sendRateLimitError(reply, preLimitDecision);
    }

    const parsed = clientWechatLoginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      await rateLimiter.consume(limiterKey, loginLimiterPolicy);
      logSecurityEvent(request, "client_wechat_login_failed", {
        clientIp,
        reason: "validation_error"
      }, "warn");
      return sendError(reply, 400, "VALIDATION_ERROR", firstZodIssueMessage(parsed.error, "微信登录参数错误"));
    }

    const verification = await weChatLoginCodeVerifier.verifyLoginCode({
      code: parsed.data.code,
      expectedAppId: clientAuthConfig.wechat.appId,
      timeoutMs: clientAuthConfig.wechat.code2SessionTimeoutMs,
      requestId: request.id
    });
    if (!verification.ok) {
      await rateLimiter.consume(limiterKey, loginLimiterPolicy);
      logSecurityEvent(request, "client_wechat_login_failed", {
        clientIp,
        reason: verification.reason,
        code: verification.publicErrorCode,
        retryable: verification.retryable,
        upstreamErrCode: verification.upstreamErrCode
      }, verification.retryable ? "error" : "warn");
      return sendError(
        reply,
        wechatAuthFailureStatus(verification.reason),
        verification.publicErrorCode,
        verification.publicMessage
      );
    }

    if (verification.appId !== clientAuthConfig.wechat.appId) {
      await rateLimiter.consume(limiterKey, loginLimiterPolicy);
      logSecurityEvent(request, "client_wechat_login_failed", {
        clientIp,
        reason: "appid_mismatch",
        code: "INVALID_WECHAT_CODE"
      }, "warn");
      return sendError(reply, 401, "INVALID_WECHAT_CODE", "微信登录凭证无效，请重新登录");
    }

    await rateLimiter.reset(limiterKey);
    const issued = await createClientSession(prisma, {
      appId: verification.appId,
      openid: verification.openid,
      unionid: verification.unionid,
      ttlSeconds: clientAuthConfig.sessionTtlSeconds,
      now: currentTime()
    });
    logSecurityEvent(request, "client_wechat_login_succeeded", {
      clientIp,
      sessionId: issued.session.id,
      appId: issued.session.appId,
      openidHash: issued.session.openidHash,
      unionidHash: issued.session.unionidHash,
      expiresAt: issued.expiresAt
    });

    return reply.send(ok(clientWechatLoginResponseSchema.parse({
      token: issued.token,
      tokenType: issued.tokenType,
      expiresInSeconds: issued.expiresInSeconds,
      expiresAt: issued.expiresAt.toISOString()
    })));
  });

  app.get("/api/client/home", async (_request, reply) => {
    const site = await prisma.siteConfig.findFirst({ where: { id: 1 } });
    const [announcements, banners, menus, featuredCases, featuredArticles] = await Promise.all([
      prisma.announcement.findMany({ where: { status: "enabled" }, orderBy: { sortOrder: "asc" } }),
      prisma.banner.findMany({
        where: { status: "enabled" },
        include: { imageAsset: true },
        orderBy: { sortOrder: "asc" }
      }),
      prisma.menuItem.findMany({
        where: { status: "enabled", showOnHome: true },
        include: { iconAsset: true },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }]
      }),
      prisma.activityCase.findMany({
        where: { status: "enabled", isFeatured: true },
        include: { coverAsset: true, media: { include: { mediaAsset: true }, orderBy: { sortOrder: "asc" } } },
        orderBy: { featuredSortOrder: "asc" }
      }),
      prisma.article.findMany({
        where: { status: "enabled", isFeatured: true },
        include: { coverAsset: true },
        orderBy: [{ featuredSortOrder: "asc" }, { publishedAt: "desc" }, { id: "asc" }],
        take: 2
      })
    ]);

    return reply.send(
      ok({
        site: {
          appName: site?.appName ?? "",
          subtitle: site?.subtitle ?? "",
          defaultBannerUrl: await assetUrl(prisma, site?.defaultBannerAssetId, options.publicBaseUrl),
          placeholderBannerUrl: await assetUrl(prisma, site?.placeholderBannerAssetId, options.publicBaseUrl),
          placeholderIconUrl: await assetUrl(prisma, site?.placeholderIconAssetId, options.publicBaseUrl),
          placeholderCaseUrl: await assetUrl(prisma, site?.placeholderCaseAssetId, options.publicBaseUrl)
        },
        announcements: announcements.map(serializeAnnouncement),
        banners: banners.map((item) => serializeBanner(item, options.publicBaseUrl)),
        menus: menus.map((item) => serializeMenuItem(item, options.publicBaseUrl)),
        featuredCases: featuredCases.map((item) => serializeCaseListItem(item, options.publicBaseUrl)),
        featuredArticles: featuredArticles.map((item) => serializeArticleListItem(item, options.publicBaseUrl))
      })
    );
  });

  app.get("/api/client/menu-items", async (_request, reply) => {
    const items = await prisma.menuItem.findMany({
      where: { status: "enabled" },
      include: { iconAsset: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }]
    });
    return reply.send(ok(items.map((item) => serializeMenuItem(item, options.publicBaseUrl))));
  });

  app.post("/api/client/track/page-view", async (request, reply) => {
    const limitDecision = await rateLimiter.consume(
      analyticsRateLimitKey(trustedClientIp(request)),
      analyticsLimiterPolicy
    );
    if (!limitDecision.allowed) {
      logSecurityEvent(request, "analytics_rate_limited", {
        clientIp: trustedClientIp(request),
        retryAfterSeconds: limitDecision.retryAfterSeconds,
        resetAt: limitDecision.resetAt
      }, "warn");
      return sendRateLimitError(reply, limitDecision);
    }

    const parsed = pageViewRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "页面统计参数错误");
    await recordPageViewEvent(prisma, {
      pagePath: parsed.data.pagePath,
      scene: parsed.data.scene,
      userAgent: request.headers["user-agent"],
      clientIp: trustedClientIp(request),
      now: currentTime(),
      hmacSecret: options.jwtSecret,
      config: analyticsConfig
    });
    return reply.send(ok({}));
  });

  app.get("/api/client/announcements/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const item = await prisma.announcement.findFirst({ where: { id, status: "enabled" } });
    return item ? reply.send(ok(serializeAnnouncement(item))) : sendError(reply, 404, "NOT_FOUND", "公告不存在");
  });

  app.get("/api/client/detail-pages/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return sendError(reply, 400, "VALIDATION_ERROR", "详情页 ID 无效");
    return reply.send(ok(await getRequiredDetailPageById(prisma, id, false, options.publicBaseUrl)));
  });

  app.get("/api/client/cases", async (request, reply) => {
    const parsed = caseListQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "案例列表查询参数错误");
    const where: Prisma.ActivityCaseWhereInput = {
      status: "enabled",
      ...(parsed.data.category ? { category: parsed.data.category } : {})
    };
    const items = await prisma.activityCase.findMany({
      where,
      include: { coverAsset: true, media: { include: { mediaAsset: true }, orderBy: { sortOrder: "asc" } } },
      orderBy: { sortOrder: "asc" }
    });
    return reply.send(
      ok(items.filter((item) => matchesCaseQuery(item, parsed.data.q)).map((item) => serializeCaseListItem(item, options.publicBaseUrl)))
    );
  });

  app.get("/api/client/cases/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const item = await prisma.activityCase.findFirst({
      where: { id, status: "enabled" },
      include: { coverAsset: true, media: { include: { mediaAsset: true }, orderBy: { sortOrder: "asc" } } }
    });
    if (!item) return sendError(reply, 404, "NOT_FOUND", "案例不存在");
    const detailPage = item.detailPageId ? await getDetailPageById(prisma, item.detailPageId, false, options.publicBaseUrl) : null;
    return reply.send(ok({
          ...serializeCaseListItem(item, options.publicBaseUrl),
          id: item.id,
          title: item.title,
          category: item.category,
          tag: item.tag,
          summary: item.summary,
          eventDate: toIsoDate(item.eventDate),
          location: item.location,
          detail: detailPage?.richTextHtml ?? item.detail,
          detailPage,
          isFeatured: item.isFeatured,
          featuredSortOrder: item.featuredSortOrder,
          sortOrder: item.sortOrder,
          status: item.status,
          coverUrl: mediaUrl(options.publicBaseUrl, item.coverAsset),
          media: detailPage
            ? await legacyCaseMediaFromDetailPage(prisma, detailPage, options.publicBaseUrl)
            : item.media.map((media) => serializeCaseMedia(media, options.publicBaseUrl))
        }));
  });

  app.get("/api/client/articles", async (request, reply) => {
    const parsed = clientArticleListQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "文章列表查询参数错误");
    const { page, pageSize, ...query } = parsed.data;
    const where = articleWhere({ ...query, status: "enabled" });
    const [items, total, categoryRows] = await Promise.all([
      prisma.article.findMany({
        where,
        include: { coverAsset: true },
        orderBy: [{ sortOrder: "asc" }, { publishedAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.article.count({ where }),
      prisma.article.findMany({
        where: { status: "enabled" },
        select: { category: true },
        orderBy: { category: "asc" }
      })
    ]);
    return reply.send(ok({
      items: items.map((item) => serializeArticleListItem(item, options.publicBaseUrl)),
      total,
      page,
      pageSize,
      categories: uniqueArticleCategories(categoryRows)
    }));
  });

  app.get("/api/client/artists", async (request, reply) => {
    const parsed = artistListQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "人员列表查询参数错误");
    const { type, q, location, tag } = parsed.data;
    const items = await prisma.artist.findMany({
      where: { status: "enabled", type },
      include: { avatarAsset: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }]
    });
    const normalizedQuery = q?.toLocaleLowerCase("zh-CN");
    const filtered = items.filter((item) => {
      const tags = normalizeArtistTags(item.tagsJson);
      if (location && item.location !== location) return false;
      if (tag && !tags.includes(tag)) return false;
      if (!normalizedQuery) return true;
      return [item.name, item.location, item.badge, item.summary, ...tags]
        .some((value) => value.toLocaleLowerCase("zh-CN").includes(normalizedQuery));
    });
    return reply.send(ok(filtered.map((item) => serializeArtist(item, options.publicBaseUrl))));
  });

  app.get("/api/client/artists/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const item = await prisma.artist.findFirst({ where: { id, status: "enabled" }, include: { avatarAsset: true } });
    if (!item) return sendError(reply, 404, "NOT_FOUND", "人员不存在");
    const detailPage = item.detailPageId ? await getDetailPageById(prisma, item.detailPageId, false, options.publicBaseUrl) : null;
    return reply.send(ok({ ...serializeArtist(item, options.publicBaseUrl), detail: detailPage?.richTextHtml ?? item.detail, detailPage }));
  });

  app.get("/api/admin/detail-pages", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = detailPageListQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "详情页列表参数错误");
    return reply.send(ok(await listDetailPages(prisma, parsed.data, options.publicBaseUrl)));
  });

  app.get("/api/admin/detail-pages/options", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = detailPageOptionQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "详情页选项参数错误");
    return reply.send(ok({ items: await listDetailPageOptions(prisma, parsed.data) }));
  });

  app.get("/api/admin/detail-pages/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return sendError(reply, 400, "VALIDATION_ERROR", "详情页 ID 无效");
    return reply.send(ok(await getRequiredDetailPageById(prisma, id, true, options.publicBaseUrl)));
  });

  app.post("/api/admin/detail-pages", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = DetailPageInputSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "详情页参数错误");
    return reply.send(ok(await createDetailPage(prisma, parsed.data, options.publicBaseUrl)));
  });

  app.put("/api/admin/detail-pages/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return sendError(reply, 400, "VALIDATION_ERROR", "详情页 ID 无效");
    const parsed = DetailPageInputSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "详情页参数错误");
    return reply.send(ok(await updateDetailPage(prisma, id, parsed.data, options.publicBaseUrl)));
  });

  app.delete("/api/admin/detail-pages/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return sendError(reply, 400, "VALIDATION_ERROR", "详情页 ID 无效");
    await deleteDetailPage(prisma, id);
    return reply.send(ok({}));
  });

  app.get("/api/admin/detail-pages/:id/references", { preHandler: requireAdmin }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return sendError(reply, 400, "VALIDATION_ERROR", "详情页 ID 无效");
    await getRequiredDetailPageById(prisma, id, false, options.publicBaseUrl);
    return reply.send(ok({ items: await getDetailPageReferences(prisma, id) }));
  });

  app.post("/api/admin/detail-pages/preview", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = detailPagePreviewSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "详情页预览参数错误");
    return reply.send(ok(await previewDetailPage(prisma, parsed.data.detailPage, options.publicBaseUrl)));
  });

  app.get("/api/admin/site-config", { preHandler: requireAdmin }, async (_request, reply) => {
    const site = await prisma.siteConfig.findFirst({ where: { id: 1 } });
    return reply.send(ok(site));
  });

  app.put("/api/admin/site-config", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = siteUpdateSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "首页配置参数错误");
    const body = { ...parsed.data };
    delete body.id;
    delete body.updatedAt;
    delete body.defaultBannerAssetId;
    const mediaFields = [
      ["placeholderBannerAssetId", "site.placeholderBanner"],
      ["placeholderIconAssetId", "site.placeholderIcon"],
      ["placeholderCaseAssetId", "site.placeholderCase"]
    ] as const;
    for (const [property, fieldKey] of mediaFields) {
      if (body[property] === null || body[property] === undefined) continue;
      const problem = await mediaProblemForId(prisma, body[property], fieldKey);
      if (problem) return sendError(reply, problem.code === "NOT_FOUND" ? 404 : 400, problem.code, problem.message);
    }
    const site = await prisma.siteConfig.upsert({
      where: { id: 1 },
      update: body,
      create: { id: 1, appName: body.appName ?? "", subtitle: body.subtitle ?? "", ...body }
    });
    return reply.send(ok(site));
  });

  app.get("/api/admin/media-assets/upload-config", { preHandler: requireAdmin }, async (_request, reply) => {
    return reply.send(ok(getUploadConfig()));
  });

  app.get("/api/admin/media-assets", { preHandler: requireAdmin }, async (_request, reply) => {
    const parsed = mediaListQuerySchema.safeParse((_request as FastifyRequest<{ Querystring: Record<string, string> }>).query);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "资源筛选参数错误");
    const { mediaType, q, tag, referenceStatus, page, pageSize } = parsed.data;
    const result = await queryMediaReferences(prisma, {
      mediaType,
      q,
      tagKey: tag ? normalizeResourceName(tag).key : undefined,
      referenceStatus,
      offset: (page - 1) * pageSize,
      limit: pageSize
    });
    return reply.send(ok({ items: await mediaDtosForReferences(result.rows), total: result.total, page, pageSize }));
  });

  app.get("/api/admin/media-assets/tags", { preHandler: requireAdmin }, async (_request, reply) => {
    const tags = await prisma.mediaAssetTag.findMany({ orderBy: { label: "asc" } });
    const counts = new Map<string, { label: string; count: number }>();
    for (const tag of tags) {
      const current = counts.get(tag.labelKey);
      if (current) current.count += 1;
      else counts.set(tag.labelKey, { label: tag.label, count: 1 });
    }
    return reply.send(ok({ items: [...counts.values()] }));
  });

  app.get("/api/admin/media-assets/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const asset = await prisma.mediaAsset.findUnique({ where: { id }, include: { tags: true } });
    if (!asset) return sendError(reply, 404, "NOT_FOUND", "资源不存在");
    return reply.send(ok(await toMediaAssetDto(prisma, asset, { publicBaseUrl: options.publicBaseUrl })));
  });

  app.post("/api/admin/media-assets/lookup", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = lookupMediaRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "MD5 查询参数错误");
    const asset = await prisma.mediaAsset.findUnique({ where: { md5: parsed.data.md5.toLowerCase() }, include: { tags: true } });
    if (!asset) return reply.send(ok({ asset: null }));
    if (asset.size !== parsed.data.size) return sendError(reply, 409, "HASH_COLLISION", "MD5 相同但文件大小不一致");
    return reply.send(ok({ asset: await toMediaAssetDto(prisma, asset, { publicBaseUrl: options.publicBaseUrl }) }));
  });

  app.post("/api/admin/media-assets/check-name", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = checkMediaNameRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "资源名称不能为空");
    const key = normalizeResourceName(parsed.data.resourceName).key;
    const existing = await prisma.mediaAsset.findUnique({ where: { resourceNameKey: key } });
    return reply.send(ok({ available: !existing || existing.id === parsed.data.excludeId }));
  });

  app.post("/api/admin/media-assets/upload", { preHandler: requireAdmin }, async (request: AdminRequest, reply) => {
    const fields = new Map<string, string>();
    let upload: Awaited<ReturnType<typeof persistMultipartFile>> | null = null;
    let storedFilename: string | null = null;
    let committed = false;
    const discardStoredFile = async () => {
      if (!storedFilename) return;
      const filename = storedFilename;
      try {
        await deleteStoredFile(options.uploadDir, filename);
        storedFilename = null;
      } catch (error) {
        throw new MediaRecoveryError(`未提交资源文件回滚失败，需人工删除：${filename}；${String(error)}`);
      }
    };
    try {
      try {
        for await (const part of request.parts()) {
          if (part.type === "field") fields.set(part.fieldname, String(part.value));
          if (part.type === "file" && part.fieldname !== "file") {
            for await (const chunk of part.file) {
              // Consume rejected file streams so multipart parsing can finish cleanly.
              void chunk;
            }
            return sendError(reply, 400, "VALIDATION_ERROR", "上传文件字段必须为 file");
          }
          if (part.type === "file") {
            if (upload) return sendError(reply, 400, "VALIDATION_ERROR", "每次只能上传一个文件");
            upload = await persistMultipartFile(part, options.uploadDir);
          }
        }
      } catch (error) {
        const code = (error as { code?: string }).code;
        if ((error as Error).message === "FILE_TOO_LARGE") return sendError(reply, 413, "FILE_TOO_LARGE", "文件过大");
        if (code === "FST_FILES_LIMIT") return sendError(reply, 400, "VALIDATION_ERROR", "每次只能上传一个文件");
        throw error;
      }
      if (!upload) return sendError(reply, 400, "VALIDATION_ERROR", "上传文件不能为空");

      const name = normalizeResourceName(fields.get("resourceName") ?? "");
      if (!name.displayName) return sendError(reply, 400, "VALIDATION_ERROR", "资源名称不能为空");
      const clientMd5 = (fields.get("md5") ?? "").toLowerCase();
      if (!/^[a-f\d]{32}$/.test(clientMd5) || clientMd5 !== upload.md5) {
        return sendError(reply, 400, "MD5_MISMATCH", "客户端与服务端 MD5 不一致");
      }
      let tags: string[] = [];
      try {
        const parsedTags = JSON.parse(fields.get("tags") ?? "[]");
        if (!Array.isArray(parsedTags) || !parsedTags.every((tag) => typeof tag === "string")) throw new Error();
        tags = parsedTags;
      } catch {
        return sendError(reply, 400, "VALIDATION_ERROR", "资源标签格式错误");
      }

      const inspected = await inspectUpload(upload);
      if (!inspected.ok) {
        const status = inspected.error.code === "FILE_TOO_LARGE" ? 413 : 400;
        return sendError(reply, status, inspected.error.code, inspected.error.message);
      }
      const parsedField = fields.has("fieldKey") ? MediaFieldKeySchema.safeParse(fields.get("fieldKey")) : null;
      if (parsedField && !parsedField.success) {
        return sendError(reply, 400, "VALIDATION_ERROR", "资源字段类型错误");
      }
      if (parsedField?.success) {
        const problem = validateAssetForField(parsedField.data, inspected);
        if (problem) return sendError(reply, 400, problem.code, problem.message);
      }

      upload.mimeType = inspected.mimeType;

      const existing = await prisma.mediaAsset.findUnique({ where: { md5: upload.md5 }, include: { tags: true } });
      if (existing) {
        if (existing.size !== upload.size) return sendError(reply, 409, "HASH_COLLISION", "MD5 相同但文件大小不一致");
        return reply.send(ok({ asset: await toMediaAssetDto(prisma, existing, { publicBaseUrl: options.publicBaseUrl }), reused: true }));
      }
      const duplicateName = await prisma.mediaAsset.findUnique({ where: { resourceNameKey: name.key } });
      if (duplicateName) return sendError(reply, 409, "DUPLICATE_RESOURCE_NAME", "资源名称已存在，请更换");

      storedFilename = await moveUploadToStorage(upload, options.uploadDir);
      try {
        await unlink(upload.tempPath);
      } catch (error) {
        await discardStoredFile();
        throw error;
      }
      try {
        const asset = await createMediaAsset(prisma, {
          resourceName: name.displayName,
          tags,
          upload,
          filename: storedFilename,
          mediaType: inspected.mediaType,
          width: inspected.width,
          height: inspected.height,
          createdBy: request.admin?.id
        });
        committed = true;
        return reply.send(ok({ asset: await toMediaAssetDto(prisma, asset, { publicBaseUrl: options.publicBaseUrl }), reused: false }));
      } catch (error) {
        const concurrent = await prisma.mediaAsset.findUnique({ where: { md5: upload.md5 }, include: { tags: true } });
        if (concurrent && concurrent.size === upload.size) {
          await discardStoredFile();
          return reply.send(ok({ asset: await toMediaAssetDto(prisma, concurrent, { publicBaseUrl: options.publicBaseUrl }), reused: true }));
        }
        if ((error as { code?: string }).code === "P2002") {
          await discardStoredFile();
          return sendError(reply, 409, "DUPLICATE_RESOURCE_NAME", "资源名称已存在，请更换");
        }
        throw error;
      }
    } catch (error) {
      if (!committed && storedFilename) await discardStoredFile();
      throw error;
    } finally {
      if (upload) await unlink(upload.tempPath).catch(() => undefined);
    }
  });

  app.patch("/api/admin/media-assets/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const parsed = updateMediaMetadataSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "资源名称或标签格式错误");
    const existing = await prisma.mediaAsset.findUnique({ where: { id } });
    if (!existing) return sendError(reply, 404, "NOT_FOUND", "资源不存在");
    const name = normalizeResourceName(parsed.data.resourceName);
    const duplicate = await prisma.mediaAsset.findUnique({ where: { resourceNameKey: name.key } });
    if (duplicate && duplicate.id !== id) return sendError(reply, 409, "DUPLICATE_RESOURCE_NAME", "资源名称已存在，请更换");
    try {
      const asset = await prisma.$transaction(async (tx) => {
        await tx.mediaAssetTag.deleteMany({ where: { mediaAssetId: id } });
        return tx.mediaAsset.update({
          where: { id },
          data: {
            resourceName: name.displayName,
            resourceNameKey: name.key,
            tags: {
              create: parsed.data.tags.map((label) => ({ label, labelKey: normalizeResourceName(label).key }))
            }
          },
          include: { tags: true }
        });
      });
      return reply.send(ok(await toMediaAssetDto(prisma, asset, { publicBaseUrl: options.publicBaseUrl })));
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        return sendError(reply, 409, "DUPLICATE_RESOURCE_NAME", "资源名称已存在，请更换");
      }
      throw error;
    }
  });

  app.delete("/api/admin/media-assets/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const result = await deleteMediaAssetWithFile(id);
    if (result.status === "not_found") return sendError(reply, 404, "NOT_FOUND", "资源不存在");
    if (result.status === "in_use") {
      return sendError(
        reply,
        409,
        "MEDIA_IN_USE",
        `资源正在被使用，无法删除：${result.referenceSources.map((source) => source.label).join("、")}`
      );
    }
    return reply.send(ok({}));
  });

  app.post("/api/admin/media-assets/scan-unused", { preHandler: requireAdmin }, async (_request, reply) => {
    const result = await queryMediaReferences(prisma, { referenceStatus: "unused" });
    return reply.send(ok({ items: await mediaDtosForReferences(result.rows) }));
  });

  app.post("/api/admin/media-assets/batch-delete", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = batchDeleteMediaRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "请选择需要删除的资源");
    const deletedIds: number[] = [];
    const skipped: { id: number; reason: string }[] = [];
    const failed: { id: number; reason: string }[] = [];
    for (const id of parsed.data.ids) {
      try {
        const result = await deleteMediaAssetWithFile(id);
        if (result.status === "not_found") {
          failed.push({ id, reason: "NOT_FOUND" });
          continue;
        }
        if (result.status === "in_use") {
          skipped.push({ id, reason: "MEDIA_IN_USE" });
          continue;
        }
        deletedIds.push(id);
      } catch (error) {
        logSecurityEvent(request, "media_recovery_failed", {
          mediaAssetId: id,
          error: serializeErrorForLog(error)
        }, "error");
        failed.push({ id, reason: "DELETE_FAILED" });
      }
    }
    return reply.send(ok({ deletedIds, skipped, failed }));
  });

  registerCrud(app, prisma, requireAdmin, options.publicBaseUrl);

  return app;
}

function registerCrud(
  app: FastifyInstance,
  prisma: AppPrismaClient,
  requireAdmin: (request: AdminRequest, reply: FastifyReply) => Promise<unknown>,
  publicBaseUrl: string
) {
  async function handleReorder(
    request: FastifyRequest,
    reply: FastifyReply,
    handlers: Parameters<typeof reorderByIds>[2]
  ) {
    const parsed = adminReorderRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "排序参数错误");
    }
    await reorderByIds(prisma, parsed.data.ids, handlers);
    return reply.send(ok({ ids: parsed.data.ids }));
  }

  app.get("/api/admin/announcements", { preHandler: requireAdmin }, async (_request, reply) => {
    const items = await prisma.announcement.findMany({ orderBy: { sortOrder: "asc" } });
    return reply.send(ok({ items: items.map(serializeAnnouncement), total: items.length }));
  });
  app.post("/api/admin/announcements/reorder", { preHandler: requireAdmin }, async (request, reply) => handleReorder(request, reply, {
    findAllIds: (tx) => tx.announcement.findMany({ select: { id: true } }),
    updateOrder: (tx, id, sortOrder) => tx.announcement.update({ where: { id }, data: { sortOrder } })
  }));
  app.get("/api/admin/announcements/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const id = parseRouteId(request.params);
    if (!id) return sendError(reply, 400, "VALIDATION_ERROR", "公告 ID 错误");
    const item = await prisma.announcement.findUnique({ where: { id } });
    if (!item) return sendError(reply, 404, "NOT_FOUND", "公告不存在");
    return reply.send(ok(serializeAnnouncement(item)));
  });
  app.post("/api/admin/announcements", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = announcementCreateSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "公告参数错误");
    await validateDetailPageReference(prisma, parsed.data.detailPageId);
    const item = await prisma.announcement.create({ data: parsed.data });
    return reply.send(ok(serializeAnnouncement(item)));
  });
  app.put("/api/admin/announcements/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = announcementUpdateSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "公告参数错误");
    const id = Number((request.params as { id: string }).id);
    if (Object.hasOwn(parsed.data, "detailPageId")) await validateDetailPageReference(prisma, parsed.data.detailPageId);
    const item = await prisma.announcement.update({ where: { id }, data: parsed.data });
    return reply.send(ok(serializeAnnouncement(item)));
  });
  app.delete("/api/admin/announcements/:id", { preHandler: requireAdmin }, async (request, reply) => {
    await prisma.announcement.delete({ where: { id: Number((request.params as { id: string }).id) } });
    return reply.send(ok({}));
  });

  app.get("/api/admin/banners", { preHandler: requireAdmin }, async (_request, reply) => {
    const items = await prisma.banner.findMany({ include: { imageAsset: true }, orderBy: { sortOrder: "asc" } });
    return reply.send(ok({ items: items.map((item) => serializeBanner(item, publicBaseUrl)), total: items.length }));
  });
  app.post("/api/admin/banners/reorder", { preHandler: requireAdmin }, async (request, reply) => handleReorder(request, reply, {
    findAllIds: (tx) => tx.banner.findMany({ select: { id: true } }),
    updateOrder: (tx, id, sortOrder) => tx.banner.update({ where: { id }, data: { sortOrder } })
  }));
  app.get("/api/admin/banners/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const id = parseRouteId(request.params);
    if (!id) return sendError(reply, 400, "VALIDATION_ERROR", "Banner ID 错误");
    const item = await prisma.banner.findUnique({ where: { id }, include: { imageAsset: true } });
    if (!item) return sendError(reply, 404, "NOT_FOUND", "Banner 不存在");
    return reply.send(ok(serializeBanner(item, publicBaseUrl)));
  });
  app.post("/api/admin/banners", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = bannerCreateSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "Banner 参数错误");
    const problem = await mediaProblemForId(prisma, parsed.data.imageAssetId, "banner.image");
    if (problem) return sendError(reply, problem.code === "NOT_FOUND" ? 404 : 400, problem.code, problem.message);
    await validateDetailPageReference(prisma, parsed.data.detailPageId);
    const item = await prisma.banner.create({ data: parsed.data, include: { imageAsset: true } });
    return reply.send(ok(serializeBanner(item, publicBaseUrl)));
  });
  app.put("/api/admin/banners/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = bannerUpdateSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "Banner 参数错误");
    const body = parsed.data;
    const id = Number((request.params as { id: string }).id);
    const existing = await prisma.banner.findUnique({ where: { id } });
    if (!existing) return sendError(reply, 404, "NOT_FOUND", "Banner 不存在");
    const problem = await mediaProblemForId(prisma, body.imageAssetId ?? existing.imageAssetId, "banner.image");
    if (problem) return sendError(reply, problem.code === "NOT_FOUND" ? 404 : 400, problem.code, problem.message);
    if (Object.hasOwn(body, "detailPageId")) await validateDetailPageReference(prisma, body.detailPageId);
    const item = await prisma.banner.update({
      where: { id },
      data: body,
      include: { imageAsset: true }
    });
    return reply.send(ok(serializeBanner(item, publicBaseUrl)));
  });
  app.delete("/api/admin/banners/:id", { preHandler: requireAdmin }, async (request, reply) => {
    await prisma.banner.delete({ where: { id: Number((request.params as { id: string }).id) } });
    return reply.send(ok({}));
  });

  app.get("/api/admin/menu-items", { preHandler: requireAdmin }, async (_request, reply) => {
    const items = await prisma.menuItem.findMany({ include: { iconAsset: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
    const serialized = items.map((item) => serializeMenuItem(item, publicBaseUrl));
    return reply.send(ok({ items: serialized, total: serialized.length }));
  });
  app.post("/api/admin/menu-items/reorder", { preHandler: requireAdmin }, async (request, reply) => handleReorder(request, reply, {
    findAllIds: (tx) => tx.menuItem.findMany({ select: { id: true } }),
    updateOrder: (tx, id, sortOrder) => tx.menuItem.update({ where: { id }, data: { sortOrder } })
  }));
  app.get("/api/admin/menu-items/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const id = parseRouteId(request.params);
    if (!id) return sendError(reply, 400, "VALIDATION_ERROR", "菜单 ID 错误");
    const item = await prisma.menuItem.findUnique({ where: { id }, include: { iconAsset: true } });
    if (!item) return sendError(reply, 404, "NOT_FOUND", "菜单不存在");
    return reply.send(ok(serializeMenuItem(item, publicBaseUrl)));
  });
  app.post("/api/admin/menu-items", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = MenuItemCreateRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "菜单参数错误");
    const body = parsed.data;
    const problem = await mediaProblemForId(prisma, body.iconAssetId, "menu.icon");
    if (problem) return sendError(reply, problem.code === "NOT_FOUND" ? 404 : 400, problem.code, problem.message);
    const configJson = await prepareMenuConfigForSave(prisma, body.type, body.configJson ?? {});
    const item = await prisma.menuItem.create({
      data: { ...body, configJson: JSON.stringify(configJson) },
      include: { iconAsset: true }
    });
    return reply.send(ok(serializeMenuItem(item, publicBaseUrl)));
  });
  app.put("/api/admin/menu-items/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = MenuItemUpdateRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "菜单参数错误");
    const body = parsed.data;
    const id = Number((request.params as { id: string }).id);
    const existing = await prisma.menuItem.findUnique({ where: { id } });
    if (!existing) return sendError(reply, 404, "NOT_FOUND", "菜单不存在");
    const problem = await mediaProblemForId(prisma, body.iconAssetId ?? existing.iconAssetId, "menu.icon");
    if (problem) return sendError(reply, problem.code === "NOT_FOUND" ? 404 : 400, problem.code, problem.message);
    const data = { ...body };
    const targetType = body.type ?? existing.type;
    const targetTypeChanged = body.type !== undefined && body.type !== existing.type;
    if (Object.hasOwn(body, "configJson") || targetTypeChanged) {
      data.configJson = JSON.stringify(await prepareMenuConfigForSave(prisma, targetType, body.configJson ?? {}));
    }
    const item = await prisma.menuItem.update({
      where: { id },
      data: data as never,
      include: { iconAsset: true }
    });
    return reply.send(ok(serializeMenuItem(item, publicBaseUrl)));
  });
  app.delete("/api/admin/menu-items/:id", { preHandler: requireAdmin }, async (request, reply) => {
    await prisma.menuItem.delete({ where: { id: Number((request.params as { id: string }).id) } });
    return reply.send(ok({}));
  });

  app.get("/api/admin/case-categories", { preHandler: requireAdmin }, async (_request, reply) => {
    const items = await prisma.activityCase.findMany({
      select: { category: true },
      orderBy: { category: "asc" }
    });
    return reply.send(ok({ items: uniqueCaseCategories(items) }));
  });

  app.get("/api/admin/articles/categories", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = articleCategoryQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "文章分类查询参数错误");
    const items = await prisma.article.findMany({
      select: { category: true },
      orderBy: { category: "asc" }
    });
    const categories = uniqueArticleCategories(items)
      .filter((category) => !parsed.data.q || category.toLocaleLowerCase("zh-CN").includes(parsed.data.q.toLocaleLowerCase("zh-CN")))
      .slice(0, parsed.data.limit);
    return reply.send(ok({ categories }));
  });

  app.get("/api/admin/articles", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = adminArticleListQuerySchema.safeParse(request.query);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "文章筛选参数错误");
    const { page, pageSize, ...query } = parsed.data;
    const where = articleWhere(query);
    const [items, total] = await Promise.all([
      prisma.article.findMany({
        where,
        include: { coverAsset: true },
        orderBy: [{ sortOrder: "asc" }, { publishedAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.article.count({ where })
    ]);
    const serialized = await Promise.all(items.map((item) => serializeAdminArticle(prisma, item, publicBaseUrl)));
    return reply.send(ok({ items: serialized, total, page, pageSize }));
  });

  app.post("/api/admin/articles/reorder", { preHandler: requireAdmin }, async (request, reply) => handleReorder(request, reply, {
    findAllIds: (tx) => tx.article.findMany({ select: { id: true } }),
    updateOrder: (tx, id, sortOrder) => tx.article.update({ where: { id }, data: { sortOrder } })
  }));

  app.get("/api/admin/articles/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const id = parseRouteId(request.params);
    if (!id) return sendError(reply, 400, "VALIDATION_ERROR", "文章 ID 错误");
    const item = await prisma.article.findUnique({ where: { id }, include: { coverAsset: true } });
    if (!item) return sendError(reply, 404, "NOT_FOUND", "文章不存在");
    return reply.send(ok(await serializeAdminArticle(prisma, item, publicBaseUrl)));
  });

  app.post("/api/admin/articles", { preHandler: requireAdmin }, async (request: AdminRequest, reply) => {
    const parsed = ArticleCreateRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "文章参数错误");
    const body = parsed.data;
    const coverProblem = await mediaProblemForId(prisma, body.coverAssetId, "article.cover");
    if (coverProblem) return sendError(reply, coverProblem.code === "NOT_FOUND" ? 404 : 400, coverProblem.code, coverProblem.message);
    await validateDetailPageReference(prisma, body.detailPageId);
    const created = await prisma.$transaction(async (tx) => {
      const article = await tx.article.create({
        data: articleDataFromBody(body),
        include: { coverAsset: true }
      });
      await tx.operationLog.create({
        data: { action: "CREATE_ARTICLE", detail: String(article.id), createdBy: request.admin?.id }
      });
      return article;
    });
    return reply.send(ok(await serializeAdminArticle(prisma, created, publicBaseUrl)));
  });

  app.put("/api/admin/articles/:id", { preHandler: requireAdmin }, async (request: AdminRequest, reply) => {
    const parsed = ArticleUpdateRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "文章参数错误");
    const id = Number((request.params as { id: string }).id);
    const existing = await prisma.article.findUnique({ where: { id } });
    if (!existing) return sendError(reply, 404, "NOT_FOUND", "文章不存在");
    const body = parsed.data;
    const coverProblem = await mediaProblemForId(prisma, body.coverAssetId ?? existing.coverAssetId, "article.cover");
    if (coverProblem) return sendError(reply, coverProblem.code === "NOT_FOUND" ? 404 : 400, coverProblem.code, coverProblem.message);
    if (Object.hasOwn(body, "detailPageId")) await validateDetailPageReference(prisma, body.detailPageId);
    const updated = await prisma.$transaction(async (tx) => {
      const article = await tx.article.update({
        where: { id },
        data: articleDataFromBody(body),
        include: { coverAsset: true }
      });
      await tx.operationLog.create({
        data: { action: "UPDATE_ARTICLE", detail: String(id), createdBy: request.admin?.id }
      });
      return article;
    });
    return reply.send(ok(await serializeAdminArticle(prisma, updated, publicBaseUrl)));
  });

  app.delete("/api/admin/articles/:id", { preHandler: requireAdmin }, async (request: AdminRequest, reply) => {
    const id = Number((request.params as { id: string }).id);
    await prisma.$transaction(async (tx) => {
      const exists = await tx.article.count({ where: { id } });
      if (!exists) throw new DetailPageDomainError("NOT_FOUND", "文章不存在", 404);
      await tx.article.delete({ where: { id } });
      await tx.operationLog.create({ data: { action: "DELETE_ARTICLE", detail: String(id), createdBy: request.admin?.id } });
    });
    return reply.send(ok({}));
  });

  app.get("/api/admin/cases", { preHandler: requireAdmin }, async (_request, reply) => {
    const items = await prisma.activityCase.findMany({
      include: { coverAsset: true, media: { include: { mediaAsset: true }, orderBy: { sortOrder: "asc" } } },
      orderBy: { sortOrder: "asc" }
    });
    const serialized = await Promise.all(items.map(async (item) => {
      const detailPage = item.detailPageId ? await getDetailPageById(prisma, item.detailPageId, false, publicBaseUrl) : null;
      return {
        ...serializeCaseListItem(item, publicBaseUrl),
        id: item.id,
        title: item.title,
        category: item.category,
        tag: item.tag,
        coverAssetId: item.coverAssetId,
        coverAsset: publicMediaAsset(publicBaseUrl, item.coverAsset),
        summary: item.summary,
        eventDate: toIsoDate(item.eventDate),
        location: item.location,
        detail: detailPage?.richTextHtml ?? item.detail,
        detailPageSummary: detailPage ? { id: detailPage.id, name: detailPage.name, type: detailPage.type, typeLabel: detailPage.typeLabel } : null,
        detailPageType: detailPage?.type ?? null,
        detailPageTypeLabel: detailPage?.typeLabel ?? "详情待补充",
        bannerCount: detailPage?.banners.length ?? 0,
        detailMediaCount: detailPage ? extractRichTextMedia(detailPage.richTextHtml).length : 0,
        hasRichText: Boolean(detailPage?.richTextHtml),
        isFeatured: item.isFeatured,
        featuredSortOrder: item.featuredSortOrder,
        sortOrder: item.sortOrder,
        status: item.status,
        detailMediaAssetIds: detailPage ? extractRichTextMedia(detailPage.richTextHtml).map((media) => media.assetId) : [],
        media: detailPage
          ? await legacyCaseMediaFromDetailPage(prisma, detailPage, publicBaseUrl)
          : item.media.map((media) => serializeCaseMedia(media, publicBaseUrl))
      };
    }));
    return reply.send(ok({
      items: serialized,
      total: items.length
    }));
  });
  app.post("/api/admin/cases/reorder", { preHandler: requireAdmin }, async (request, reply) => handleReorder(request, reply, {
    findAllIds: (tx) => tx.activityCase.findMany({ select: { id: true } }),
    updateOrder: (tx, id, sortOrder) => tx.activityCase.update({ where: { id }, data: { sortOrder } })
  }));
  app.get("/api/admin/cases/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const id = parseRouteId(request.params);
    if (!id) return sendError(reply, 400, "VALIDATION_ERROR", "案例 ID 错误");
    const item = await prisma.activityCase.findUnique({
      where: { id },
      include: { coverAsset: true, media: { include: { mediaAsset: true }, orderBy: { sortOrder: "asc" } } }
    });
    if (!item) return sendError(reply, 404, "NOT_FOUND", "案例不存在");
    const detailPage = item.detailPageId ? await getDetailPageById(prisma, item.detailPageId, false, publicBaseUrl) : null;
    return reply.send(ok({
      ...serializeCaseListItem(item, publicBaseUrl),
      id: item.id,
      title: item.title,
      category: item.category,
      tag: item.tag,
      coverAssetId: item.coverAssetId,
      coverAsset: publicMediaAsset(publicBaseUrl, item.coverAsset),
      summary: item.summary,
      eventDate: toIsoDate(item.eventDate),
      location: item.location,
      detail: detailPage?.richTextHtml ?? item.detail,
      detailPageSummary: detailPage ? { id: detailPage.id, name: detailPage.name, type: detailPage.type, typeLabel: detailPage.typeLabel } : null,
      detailPageType: detailPage?.type ?? null,
      detailPageTypeLabel: detailPage?.typeLabel ?? "详情待补充",
      bannerCount: detailPage?.banners.length ?? 0,
      detailMediaCount: detailPage ? extractRichTextMedia(detailPage.richTextHtml).length : 0,
      hasRichText: Boolean(detailPage?.richTextHtml),
      isFeatured: item.isFeatured,
      featuredSortOrder: item.featuredSortOrder,
      sortOrder: item.sortOrder,
      status: item.status,
      detailMediaAssetIds: detailPage ? extractRichTextMedia(detailPage.richTextHtml).map((media) => media.assetId) : [],
      media: detailPage
        ? await legacyCaseMediaFromDetailPage(prisma, detailPage, publicBaseUrl)
        : item.media.map((media) => serializeCaseMedia(media, publicBaseUrl))
    }));
  });
  app.post("/api/admin/cases", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = ActivityCaseCreateRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "案例参数错误");
    const body = parsed.data;
    const coverProblem = await mediaProblemForId(prisma, body.coverAssetId, "case.cover");
    if (coverProblem) return sendError(reply, coverProblem.code === "NOT_FOUND" ? 404 : 400, coverProblem.code, coverProblem.message);
    await validateDetailPageReference(prisma, body.detailPageId);
    const { eventDate, ...caseBody } = body;
    const created = await prisma.activityCase.create({
      data: {
        ...caseBody,
        eventDate: new Date(String(eventDate)),
        detail: "",
        legacyMediaJson: "[]"
      },
      include: { coverAsset: true, media: { include: { mediaAsset: true }, orderBy: { sortOrder: "asc" } } }
    });
    const config = created.detailPageId ? await getDetailPageById(prisma, created.detailPageId, false, publicBaseUrl) : null;
    return reply.send(ok({
      ...serializeCaseListItem(created, publicBaseUrl),
      detail: config?.richTextHtml ?? created.detail,
      detailPageSummary: config ? { id: config.id, name: config.name, type: config.type, typeLabel: config.typeLabel } : null,
      detailPageType: config?.type ?? null,
      detailPageTypeLabel: config?.typeLabel ?? "详情待补充",
      bannerCount: config?.banners.length ?? 0,
      detailMediaCount: config ? extractRichTextMedia(config.richTextHtml).length : 0,
      hasRichText: Boolean(config?.richTextHtml),
      detailMediaAssetIds: config ? extractRichTextMedia(config.richTextHtml).map((item) => item.assetId) : [],
      media: config ? await legacyCaseMediaFromDetailPage(prisma, config, publicBaseUrl) : []
    }));
  });
  app.put("/api/admin/cases/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = ActivityCaseUpdateRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "案例参数错误");
    const body = parsed.data;
    const id = Number((request.params as { id: string }).id);
    const existing = await prisma.activityCase.findUnique({
      where: { id },
      include: { media: { orderBy: { sortOrder: "asc" } } }
    });
    if (!existing) return sendError(reply, 404, "NOT_FOUND", "案例不存在");
    const coverProblem = await mediaProblemForId(prisma, body.coverAssetId ?? existing.coverAssetId, "case.cover");
    if (coverProblem) return sendError(reply, coverProblem.code === "NOT_FOUND" ? 404 : 400, coverProblem.code, coverProblem.message);
    if (Object.hasOwn(body, "detailPageId")) await validateDetailPageReference(prisma, body.detailPageId);
    const { eventDate, ...caseBody } = body;
    const updateData = {
      ...caseBody,
      ...(eventDate !== undefined ? { eventDate: new Date(String(eventDate)) } : {})
    };
    const updated = await prisma.activityCase.update({
      where: { id },
      data: updateData,
      include: { coverAsset: true, media: { include: { mediaAsset: true }, orderBy: { sortOrder: "asc" } } }
    });
    const config = updated.detailPageId ? await getDetailPageById(prisma, updated.detailPageId, false, publicBaseUrl) : null;
    return reply.send(ok({
      ...serializeCaseListItem(updated, publicBaseUrl),
      detail: config?.richTextHtml ?? updated.detail,
      detailPageSummary: config ? { id: config.id, name: config.name, type: config.type, typeLabel: config.typeLabel } : null,
      detailPageType: config?.type ?? null,
      detailPageTypeLabel: config?.typeLabel ?? "详情待补充",
      bannerCount: config?.banners.length ?? 0,
      detailMediaCount: config ? extractRichTextMedia(config.richTextHtml).length : 0,
      hasRichText: Boolean(config?.richTextHtml),
      detailMediaAssetIds: config ? extractRichTextMedia(config.richTextHtml).map((item) => item.assetId) : [],
      media: config
        ? await legacyCaseMediaFromDetailPage(prisma, config, publicBaseUrl)
        : updated.media.map((media) => serializeCaseMedia(media, publicBaseUrl))
    }));
  });
  app.delete("/api/admin/cases/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    await prisma.$transaction(async (tx) => {
      const exists = await tx.activityCase.count({ where: { id } });
      if (!exists) throw new DetailPageDomainError("NOT_FOUND", "案例不存在", 404);
      await tx.activityCase.delete({ where: { id } });
      await tx.operationLog.create({ data: { action: "DELETE_ACTIVITY_CASE", detail: String(id) } });
    });
    return reply.send(ok({}));
  });

  app.get("/api/admin/artists", { preHandler: requireAdmin }, async (_request, reply) => {
    const items = await prisma.artist.findMany({
      include: { avatarAsset: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }]
    });
    const serialized = await Promise.all(items.map(async (item) =>
      serializeAdminArtist(
        item,
        item.detailPageId ? await getDetailPageById(prisma, item.detailPageId, false, publicBaseUrl) : null,
        publicBaseUrl
      )
    ));
    return reply.send(ok({ items: serialized, total: items.length }));
  });
  app.post("/api/admin/artists/reorder", { preHandler: requireAdmin }, async (request, reply) => handleReorder(request, reply, {
    findAllIds: (tx) => tx.artist.findMany({ select: { id: true } }),
    updateOrder: (tx, id, sortOrder) => tx.artist.update({ where: { id }, data: { sortOrder } })
  }));
  app.get("/api/admin/artists/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const id = parseRouteId(request.params);
    if (!id) return sendError(reply, 400, "VALIDATION_ERROR", "人员 ID 错误");
    const item = await prisma.artist.findUnique({ where: { id }, include: { avatarAsset: true } });
    if (!item) return sendError(reply, 404, "NOT_FOUND", "人员不存在");
    return reply.send(ok(serializeAdminArtist(
      item,
      item.detailPageId ? await getDetailPageById(prisma, item.detailPageId, false, publicBaseUrl) : null,
      publicBaseUrl
    )));
  });
  app.post("/api/admin/artists", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = ArtistCreateRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "人员参数错误");
    const body = parsed.data;
    const problem = await mediaProblemForId(prisma, body.avatarAssetId, "artist.avatar");
    if (problem) return sendError(reply, problem.code === "NOT_FOUND" ? 404 : 400, problem.code, problem.message);
    await validateDetailPageReference(prisma, body.detailPageId);
    const { tags, ...artistData } = body;
    const item = await prisma.artist.create({
      data: { ...artistData, detail: "", tagsJson: serializeArtistTags(tags) },
      include: { avatarAsset: true }
    });
    return reply.send(ok(serializeAdminArtist(
      item,
      item.detailPageId ? await getDetailPageById(prisma, item.detailPageId, false, publicBaseUrl) : null,
      publicBaseUrl
    )));
  });
  app.put("/api/admin/artists/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = ArtistUpdateRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "人员参数错误");
    const body = parsed.data;
    const id = Number((request.params as { id: string }).id);
    const existing = await prisma.artist.findUnique({ where: { id } });
    if (!existing) return sendError(reply, 404, "NOT_FOUND", "人员不存在");
    if (body.avatarAssetId !== null && body.avatarAssetId !== undefined) {
      const problem = await mediaProblemForId(prisma, body.avatarAssetId, "artist.avatar");
      if (problem) return sendError(reply, problem.code === "NOT_FOUND" ? 404 : 400, problem.code, problem.message);
    }
    if (Object.hasOwn(body, "detailPageId")) await validateDetailPageReference(prisma, body.detailPageId);
    const { tags, ...artistData } = body;
    const item = await prisma.artist.update({
      where: { id },
      data: { ...artistData, ...(tags !== undefined ? { tagsJson: serializeArtistTags(tags) } : {}) },
      include: { avatarAsset: true }
    });
    return reply.send(ok(serializeAdminArtist(
      item,
      item.detailPageId ? await getDetailPageById(prisma, item.detailPageId, false, publicBaseUrl) : null,
      publicBaseUrl
    )));
  });
  app.delete("/api/admin/artists/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    await prisma.$transaction(async (tx) => {
      const exists = await tx.artist.count({ where: { id } });
      if (!exists) throw new DetailPageDomainError("NOT_FOUND", "人员不存在", 404);
      await tx.artist.delete({ where: { id } });
      await tx.operationLog.create({ data: { action: "DELETE_ARTIST", detail: String(id) } });
    });
    return reply.send(ok({}));
  });
}
