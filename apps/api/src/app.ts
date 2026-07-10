import { mkdir, unlink } from "node:fs/promises";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import type { Prisma } from "@prisma/client";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ActivityCaseCreateRequestSchema,
  ActivityCaseUpdateRequestSchema,
  ArtistCreateRequestSchema,
  ArtistUpdateRequestSchema,
  BannerLinkTypeSchema,
  MediaFieldKeySchema,
  MenuTypeSchema,
  artistListQuerySchema,
  batchDeleteMediaRequestSchema,
  checkMediaNameRequestSchema,
  DetailPageInputSchema,
  fail,
  lookupMediaRequestSchema,
  mediaFieldRules,
  mediaListQuerySchema,
  normalizeArtistTags,
  normalizeResourceName,
  ok,
  pageViewRequestSchema,
  serializeArtistTags,
  updateMediaMetadataSchema,
  type ArtistType,
  type CaseMediaDto,
  type DetailPageConfigDto,
  type MediaFieldKey
} from "@event-arts/shared";
import type { AppPrismaClient } from "./db";
import {
  deleteDetailPageConfig,
  getDetailPageConfig,
  getRequiredDetailPageConfig,
  previewDetailPageConfig,
  upsertDetailPageConfig
} from "./detail-pages/detail-page-service";
import { extractRichTextMedia } from "./detail-pages/detail-page-sanitizer";
import { DetailPageDomainError } from "./detail-pages/detail-page-types";
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
import { verifyPassword } from "./security";

type BuildOptions = {
  prisma: AppPrismaClient;
  jwtSecret: string;
  uploadDir: string;
  publicBaseUrl: string;
};

type AdminRequest = FastifyRequest & {
  admin?: { id: number; username: string };
};

class MediaRecoveryError extends Error {
  readonly code = "MEDIA_RECOVERY_FAILED";
}

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };
const statusInputSchema = z.enum(["enabled", "disabled"]);
const positiveIdSchema = z.coerce.number().int().positive();
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
  sortOrder: sortOrderSchema,
  status: statusInputSchema
}).strict();
const announcementUpdateSchema = announcementCreateSchema.partial().strict();
const bannerCreateSchema = z.object({
  title: z.string().min(1),
  imageAssetId: positiveIdSchema,
  linkType: BannerLinkTypeSchema.default("none"),
  linkTarget: z.string().nullable().optional(),
  switchDurationMs: z.coerce.number().int().positive(),
  sortOrder: sortOrderSchema,
  status: statusInputSchema
}).strict();
const bannerUpdateSchema = bannerCreateSchema.partial().strict();
const menuCreateSchema = z.object({
  text: z.string().min(1),
  iconAssetId: positiveIdSchema,
  type: MenuTypeSchema,
  configJson: z.unknown().optional(),
  sortOrder: sortOrderSchema,
  status: statusInputSchema
}).strict();
const menuUpdateSchema = menuCreateSchema.partial().strict();
const detailPagePreviewSchema = z.object({ detailPage: DetailPageInputSchema }).strict();
function sendError(reply: FastifyReply, statusCode: number, code: string, message: string) {
  return reply.code(statusCode).headers(jsonHeaders).send(fail(code, message));
}

function parseJson(value: string | null | undefined) {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function serializeCaseMedia(item: {
  sortOrder: number;
  mediaAsset: { id: number; mediaType: string; url: string; width: number | null; height: number | null };
}): CaseMediaDto {
  return {
    id: item.mediaAsset.id,
    mediaType: item.mediaAsset.mediaType as "image" | "video",
    url: item.mediaAsset.url,
    width: item.mediaAsset.width ?? 0,
    height: item.mediaAsset.height ?? 0,
    sortOrder: item.sortOrder
  };
}

type ArtistWithCover = Prisma.ArtistGetPayload<{ include: { avatarAsset: true } }>;

export function serializeArtist(item: ArtistWithCover) {
  const coverUrl = item.avatarAsset?.url ?? null;
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
    sortOrder: item.sortOrder,
    status: item.status as "enabled" | "disabled"
  };
}

function serializeAdminArtist(item: ArtistWithCover, detailPage: DetailPageConfigDto | null) {
  const artist = serializeArtist(item);
  return {
    ...item,
    ...artist,
    detail: detailPage?.richTextHtml ?? item.detail,
    detailPage,
    detailPageType: detailPage?.type ?? null,
    detailPageTypeLabel: detailPage?.typeLabel ?? "详情待补充",
    bannerCount: detailPage?.banners.length ?? 0,
    detailMediaCount: detailPage ? extractRichTextMedia(detailPage.richTextHtml).length : 0,
    hasRichText: Boolean(detailPage?.richTextHtml),
    tagsJson: artist.tags
  };
}

async function legacyCaseMediaFromDetailPage(prisma: AppPrismaClient, detailPage: DetailPageConfigDto) {
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
      url: asset.url,
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

async function assetUrl(prisma: AppPrismaClient, id: number | null | undefined) {
  if (!id) return "";
  const asset = await prisma.mediaAsset.findUnique({ where: { id } });
  return asset?.url ?? "";
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

export async function buildApp(options: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const { prisma } = options;
  const uploadLimits = getUploadLimits();

  await mkdir(options.uploadDir, { recursive: true });
  await app.register(cors, { origin: true });
  await app.register(jwt, { secret: options.jwtSecret });
  await app.register(multipart, {
    limits: { fileSize: Math.max(uploadLimits.imageMaxBytes, uploadLimits.videoMaxBytes), files: 1 }
  });
  await app.register(fastifyStatic, {
    root: options.uploadDir,
    prefix: "/uploads/",
    decorateReply: false
  });

  app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, _request, reply) => {
    if (error instanceof DetailPageDomainError) {
      return sendError(reply, error.statusCode, error.code, error.message);
    }
    if (error.code === "MEDIA_RECOVERY_FAILED") {
      return sendError(reply, 500, error.code, error.message);
    }
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    return sendError(reply, statusCode, "INTERNAL_ERROR", error.message || "服务异常");
  });

  async function requireAdmin(request: AdminRequest, reply: FastifyReply) {
    try {
      const decoded = await request.jwtVerify<{ id: number; username: string }>();
      const admin = await prisma.adminUser.findFirst({
        where: { id: decoded.id, status: "enabled" }
      });
      if (!admin) throw new Error("missing admin");
      request.admin = { id: admin.id, username: admin.username };
    } catch {
      return sendError(reply, 401, "UNAUTHORIZED", "请先登录");
    }
  }

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
        referenceCount: row.referenceCount,
        createdByName: asset.createdBy ? creatorNames.get(asset.createdBy) ?? null : null
      });
    }));
  }

  app.post("/api/admin/auth/login", async (request, reply) => {
    const body = request.body as { username?: string; password?: string };
    const admin = await prisma.adminUser.findUnique({ where: { username: body.username ?? "" } });
    if (!admin || admin.status !== "enabled" || !verifyPassword(body.password ?? "", admin.passwordHash)) {
      return sendError(reply, 401, "INVALID_CREDENTIALS", "用户名或密码错误");
    }

    const token = app.jwt.sign({ id: admin.id, username: admin.username }, { expiresIn: "7d" });
    return reply.send(ok({ token, id: admin.id, username: admin.username }));
  });

  app.post("/api/admin/auth/logout", { preHandler: requireAdmin }, async (_request, reply) => {
    return reply.send(ok({}));
  });

  app.get("/api/admin/auth/me", { preHandler: requireAdmin }, async (request: AdminRequest, reply) => {
    return reply.send(ok(request.admin));
  });

  app.get("/api/admin/dashboard/overview", { preHandler: requireAdmin }, async (_request, reply) => {
    const now = new Date();
    const [todayPv, weekPv, monthPv] = await Promise.all([
      prisma.pageViewEvent.count({ where: { createdAt: { gte: startOfDay(now) } } }),
      prisma.pageViewEvent.count({ where: { createdAt: { gte: startOfWeek(now) } } }),
      prisma.pageViewEvent.count({ where: { createdAt: { gte: startOfMonth(now) } } })
    ]);
    return reply.send(ok({ todayPv, weekPv, monthPv }));
  });

  app.get("/api/client/home", async (_request, reply) => {
    const site = await prisma.siteConfig.findFirst({ where: { id: 1 } });
    const [announcements, banners, menus, featuredCases] = await Promise.all([
      prisma.announcement.findMany({ where: { status: "enabled" }, orderBy: { sortOrder: "asc" } }),
      prisma.banner.findMany({
        where: { status: "enabled" },
        include: { imageAsset: true },
        orderBy: { sortOrder: "asc" }
      }),
      prisma.menuItem.findMany({
        where: { status: "enabled" },
        include: { iconAsset: true },
        orderBy: { sortOrder: "asc" }
      }),
      prisma.activityCase.findMany({
        where: { status: "enabled", isFeatured: true },
        include: { coverAsset: true, media: { include: { mediaAsset: true }, orderBy: { sortOrder: "asc" } } },
        orderBy: { featuredSortOrder: "asc" }
      })
    ]);

    return reply.send(
      ok({
        site: {
          appName: site?.appName ?? "",
          subtitle: site?.subtitle ?? "",
          defaultBannerUrl: await assetUrl(prisma, site?.defaultBannerAssetId),
          placeholderBannerUrl: await assetUrl(prisma, site?.placeholderBannerAssetId),
          placeholderIconUrl: await assetUrl(prisma, site?.placeholderIconAssetId),
          placeholderCaseUrl: await assetUrl(prisma, site?.placeholderCaseAssetId)
        },
        announcements,
        banners: banners.map((banner) => ({ ...banner, imageUrl: banner.imageAsset.url })),
        menus: menus.map((menu) => ({ ...menu, iconUrl: menu.iconAsset.url, configJson: parseJson(menu.configJson) })),
        featuredCases: featuredCases.map((item) => ({
          id: item.id,
          title: item.title,
          category: item.category,
          tag: item.tag,
          summary: item.summary,
          location: item.location,
          detail: item.detail,
          isFeatured: item.isFeatured,
          featuredSortOrder: item.featuredSortOrder,
          sortOrder: item.sortOrder,
          status: item.status,
          eventDate: toIsoDate(item.eventDate),
          coverUrl: item.coverAsset.url,
          media: item.media.map(serializeCaseMedia)
        }))
      })
    );
  });

  app.post("/api/client/track/page-view", async (request, reply) => {
    const parsed = pageViewRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "页面统计参数错误");
    await prisma.pageViewEvent.create({
      data: {
        pagePath: parsed.data.pagePath,
        scene: parsed.data.scene,
        userAgent: request.headers["user-agent"]
      }
    });
    return reply.send(ok({}));
  });

  app.get("/api/client/announcements/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const item = await prisma.announcement.findFirst({ where: { id, status: "enabled" } });
    return item ? reply.send(ok(item)) : sendError(reply, 404, "NOT_FOUND", "公告不存在");
  });

  app.get("/api/client/cases", async (_request, reply) => {
    const items = await prisma.activityCase.findMany({
      where: { status: "enabled" },
      include: { coverAsset: true, media: { include: { mediaAsset: true }, orderBy: { sortOrder: "asc" } } },
      orderBy: { sortOrder: "asc" }
    });
    return reply.send(
      ok(items.map((item) => ({
        id: item.id,
        title: item.title,
        category: item.category,
        tag: item.tag,
        summary: item.summary,
        eventDate: toIsoDate(item.eventDate),
        location: item.location,
        detail: item.detail,
        isFeatured: item.isFeatured,
        featuredSortOrder: item.featuredSortOrder,
        sortOrder: item.sortOrder,
        status: item.status,
        coverUrl: item.coverAsset.url,
        media: item.media.map(serializeCaseMedia)
      })))
    );
  });

  app.get("/api/client/cases/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const item = await prisma.activityCase.findFirst({
      where: { id, status: "enabled" },
      include: { coverAsset: true, media: { include: { mediaAsset: true }, orderBy: { sortOrder: "asc" } } }
    });
    if (!item) return sendError(reply, 404, "NOT_FOUND", "案例不存在");
    const detailPage = await getRequiredDetailPageConfig(prisma, "activity_case", item.id);
    return reply.send(ok({
          id: item.id,
          title: item.title,
          category: item.category,
          tag: item.tag,
          summary: item.summary,
          eventDate: toIsoDate(item.eventDate),
          location: item.location,
          detail: detailPage.richTextHtml,
          detailPage,
          isFeatured: item.isFeatured,
          featuredSortOrder: item.featuredSortOrder,
          sortOrder: item.sortOrder,
          status: item.status,
          coverUrl: item.coverAsset.url,
          media: await legacyCaseMediaFromDetailPage(prisma, detailPage)
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
    return reply.send(ok(filtered.map(serializeArtist)));
  });

  app.get("/api/client/artists/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const item = await prisma.artist.findFirst({ where: { id, status: "enabled" }, include: { avatarAsset: true } });
    if (!item) return sendError(reply, 404, "NOT_FOUND", "人员不存在");
    const detailPage = await getRequiredDetailPageConfig(prisma, "artist", item.id);
    return reply.send(ok({ ...serializeArtist(item), detail: detailPage.richTextHtml, detailPage }));
  });

  app.post("/api/admin/detail-pages/preview", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = detailPagePreviewSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "详情页预览参数错误");
    return reply.send(ok(await previewDetailPageConfig(prisma, parsed.data.detailPage)));
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
    const mediaFields = [
      ["defaultBannerAssetId", "site.defaultBanner"],
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
    const { mediaType, q, tag, referenceStatus, width, height, page, pageSize } = parsed.data;
    const result = await queryMediaReferences(prisma, {
      mediaType,
      q,
      tagKey: tag ? normalizeResourceName(tag).key : undefined,
      referenceStatus,
      width,
      height,
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
    return reply.send(ok(await toMediaAssetDto(prisma, asset)));
  });

  app.post("/api/admin/media-assets/lookup", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = lookupMediaRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "MD5 查询参数错误");
    const asset = await prisma.mediaAsset.findUnique({ where: { md5: parsed.data.md5.toLowerCase() }, include: { tags: true } });
    if (!asset) return reply.send(ok({ asset: null }));
    if (asset.size !== parsed.data.size) return sendError(reply, 409, "HASH_COLLISION", "MD5 相同但文件大小不一致");
    return reply.send(ok({ asset: await toMediaAssetDto(prisma, asset) }));
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
        return reply.send(ok({ asset: await toMediaAssetDto(prisma, existing), reused: true }));
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
          publicBaseUrl: options.publicBaseUrl,
          mediaType: inspected.mediaType,
          width: inspected.width,
          height: inspected.height,
          createdBy: request.admin?.id
        });
        committed = true;
        return reply.send(ok({ asset: await toMediaAssetDto(prisma, asset), reused: false }));
      } catch (error) {
        const concurrent = await prisma.mediaAsset.findUnique({ where: { md5: upload.md5 }, include: { tags: true } });
        if (concurrent && concurrent.size === upload.size) {
          await discardStoredFile();
          return reply.send(ok({ asset: await toMediaAssetDto(prisma, concurrent), reused: true }));
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
      return reply.send(ok(await toMediaAssetDto(prisma, asset)));
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
      } catch {
        failed.push({ id, reason: "DELETE_FAILED" });
      }
    }
    return reply.send(ok({ deletedIds, skipped, failed }));
  });

  registerCrud(app, prisma, requireAdmin);

  return app;
}

function registerCrud(
  app: FastifyInstance,
  prisma: AppPrismaClient,
  requireAdmin: (request: AdminRequest, reply: FastifyReply) => Promise<unknown>
) {
  app.get("/api/admin/announcements", { preHandler: requireAdmin }, async (_request, reply) => {
    const items = await prisma.announcement.findMany({ orderBy: { sortOrder: "asc" } });
    return reply.send(ok({ items, total: items.length }));
  });
  app.post("/api/admin/announcements", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = announcementCreateSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "公告参数错误");
    const item = await prisma.announcement.create({ data: parsed.data });
    return reply.send(ok(item));
  });
  app.put("/api/admin/announcements/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = announcementUpdateSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "公告参数错误");
    const id = Number((request.params as { id: string }).id);
    const item = await prisma.announcement.update({ where: { id }, data: parsed.data });
    return reply.send(ok(item));
  });
  app.delete("/api/admin/announcements/:id", { preHandler: requireAdmin }, async (request, reply) => {
    await prisma.announcement.delete({ where: { id: Number((request.params as { id: string }).id) } });
    return reply.send(ok({}));
  });

  app.get("/api/admin/banners", { preHandler: requireAdmin }, async (_request, reply) => {
    const items = await prisma.banner.findMany({ include: { imageAsset: true }, orderBy: { sortOrder: "asc" } });
    return reply.send(ok({ items, total: items.length }));
  });
  app.post("/api/admin/banners", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = bannerCreateSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "Banner 参数错误");
    const problem = await mediaProblemForId(prisma, parsed.data.imageAssetId, "banner.image");
    if (problem) return sendError(reply, problem.code === "NOT_FOUND" ? 404 : 400, problem.code, problem.message);
    const item = await prisma.banner.create({ data: parsed.data });
    return reply.send(ok(item));
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
    const item = await prisma.banner.update({
      where: { id },
      data: body
    });
    return reply.send(ok(item));
  });
  app.delete("/api/admin/banners/:id", { preHandler: requireAdmin }, async (request, reply) => {
    await prisma.banner.delete({ where: { id: Number((request.params as { id: string }).id) } });
    return reply.send(ok({}));
  });

  app.get("/api/admin/menu-items", { preHandler: requireAdmin }, async (_request, reply) => {
    const items = await prisma.menuItem.findMany({ include: { iconAsset: true }, orderBy: { sortOrder: "asc" } });
    return reply.send(ok({ items, total: items.length }));
  });
  app.post("/api/admin/menu-items", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = menuCreateSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "菜单参数错误");
    const body = parsed.data;
    const problem = await mediaProblemForId(prisma, body.iconAssetId, "menu.icon");
    if (problem) return sendError(reply, problem.code === "NOT_FOUND" ? 404 : 400, problem.code, problem.message);
    const item = await prisma.menuItem.create({
      data: { ...body, configJson: JSON.stringify(body.configJson ?? {}) }
    });
    return reply.send(ok(item));
  });
  app.put("/api/admin/menu-items/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = menuUpdateSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "菜单参数错误");
    const body = parsed.data;
    const id = Number((request.params as { id: string }).id);
    const existing = await prisma.menuItem.findUnique({ where: { id } });
    if (!existing) return sendError(reply, 404, "NOT_FOUND", "菜单不存在");
    const problem = await mediaProblemForId(prisma, body.iconAssetId ?? existing.iconAssetId, "menu.icon");
    if (problem) return sendError(reply, problem.code === "NOT_FOUND" ? 404 : 400, problem.code, problem.message);
    const data = { ...body };
    if (Object.hasOwn(body, "configJson")) data.configJson = JSON.stringify(body.configJson ?? {});
    const item = await prisma.menuItem.update({
      where: { id },
      data: data as never
    });
    return reply.send(ok(item));
  });
  app.delete("/api/admin/menu-items/:id", { preHandler: requireAdmin }, async (request, reply) => {
    await prisma.menuItem.delete({ where: { id: Number((request.params as { id: string }).id) } });
    return reply.send(ok({}));
  });

  app.get("/api/admin/cases", { preHandler: requireAdmin }, async (_request, reply) => {
    const items = await prisma.activityCase.findMany({
      include: { coverAsset: true, media: { include: { mediaAsset: true }, orderBy: { sortOrder: "asc" } } },
      orderBy: { sortOrder: "asc" }
    });
    const serialized = await Promise.all(items.map(async (item) => {
      const detailPage = await getDetailPageConfig(prisma, "activity_case", item.id);
      return {
        id: item.id,
        title: item.title,
        category: item.category,
        tag: item.tag,
        coverAssetId: item.coverAssetId,
        coverAsset: item.coverAsset,
        summary: item.summary,
        eventDate: toIsoDate(item.eventDate),
        location: item.location,
        detail: detailPage?.richTextHtml ?? item.detail,
        detailPage,
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
        media: detailPage ? await legacyCaseMediaFromDetailPage(prisma, detailPage) : item.media.map(serializeCaseMedia)
      };
    }));
    return reply.send(ok({
      items: serialized,
      total: items.length
    }));
  });
  app.post("/api/admin/cases", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = ActivityCaseCreateRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "案例参数错误");
    const body = parsed.data;
    const coverProblem = await mediaProblemForId(prisma, body.coverAssetId, "case.cover");
    if (coverProblem) return sendError(reply, coverProblem.code === "NOT_FOUND" ? 404 : 400, coverProblem.code, coverProblem.message);
    const { detailPage, eventDate, ...caseBody } = body;
    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.activityCase.create({
        data: {
          ...caseBody,
          eventDate: new Date(String(eventDate)),
          detail: "",
          legacyMediaJson: "[]"
        }
      });
      const config = await upsertDetailPageConfig(tx, "activity_case", created.id, detailPage);
      return { created, config };
    });
    return reply.send(ok({
      ...result.created,
      eventDate: toIsoDate(result.created.eventDate),
      detail: result.config.richTextHtml,
      detailPage: result.config,
      detailPageType: result.config.type,
      detailPageTypeLabel: result.config.typeLabel,
      bannerCount: result.config.banners.length,
      detailMediaCount: extractRichTextMedia(result.config.richTextHtml).length,
      hasRichText: Boolean(result.config.richTextHtml),
      detailMediaAssetIds: extractRichTextMedia(result.config.richTextHtml).map((item) => item.assetId),
      media: await legacyCaseMediaFromDetailPage(prisma, result.config)
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
    const { detailPage, eventDate, ...caseBody } = body;
    const updateData = {
      ...caseBody,
      ...(eventDate !== undefined ? { eventDate: new Date(String(eventDate)) } : {})
    };
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.activityCase.update({
        where: { id },
        data: updateData
      });
      const config = detailPage
        ? await upsertDetailPageConfig(tx, "activity_case", id, detailPage)
        : await getRequiredDetailPageConfig(tx, "activity_case", id);
      return { updated, config };
    });
    return reply.send(ok({
      ...result.updated,
      eventDate: toIsoDate(result.updated.eventDate),
      detail: result.config.richTextHtml,
      detailPage: result.config,
      detailPageType: result.config.type,
      detailPageTypeLabel: result.config.typeLabel,
      bannerCount: result.config.banners.length,
      detailMediaCount: extractRichTextMedia(result.config.richTextHtml).length,
      hasRichText: Boolean(result.config.richTextHtml),
      detailMediaAssetIds: extractRichTextMedia(result.config.richTextHtml).map((item) => item.assetId),
      media: await legacyCaseMediaFromDetailPage(prisma, result.config)
    }));
  });
  app.delete("/api/admin/cases/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    await prisma.$transaction(async (tx) => {
      await deleteDetailPageConfig(tx, "activity_case", id);
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
      serializeAdminArtist(item, await getDetailPageConfig(prisma, "artist", item.id))
    ));
    return reply.send(ok({ items: serialized, total: items.length }));
  });
  app.post("/api/admin/artists", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = ArtistCreateRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, "VALIDATION_ERROR", "人员参数错误");
    const body = parsed.data;
    const problem = await mediaProblemForId(prisma, body.avatarAssetId, "artist.avatar");
    if (problem) return sendError(reply, problem.code === "NOT_FOUND" ? 404 : 400, problem.code, problem.message);
    const { tags, detailPage, ...artistData } = body;
    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.artist.create({
        data: { ...artistData, detail: "", tagsJson: serializeArtistTags(tags) },
        include: { avatarAsset: true }
      });
      const config = await upsertDetailPageConfig(tx, "artist", item.id, detailPage);
      return { item, config };
    });
    return reply.send(ok(serializeAdminArtist(result.item, result.config)));
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
    const { tags, detailPage, ...artistData } = body;
    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.artist.update({
        where: { id },
        data: { ...artistData, ...(tags !== undefined ? { tagsJson: serializeArtistTags(tags) } : {}) },
        include: { avatarAsset: true }
      });
      const config = detailPage
        ? await upsertDetailPageConfig(tx, "artist", id, detailPage)
        : await getRequiredDetailPageConfig(tx, "artist", id);
      return { item, config };
    });
    return reply.send(ok(serializeAdminArtist(result.item, result.config)));
  });
  app.delete("/api/admin/artists/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    await prisma.$transaction(async (tx) => {
      await deleteDetailPageConfig(tx, "artist", id);
      await tx.artist.delete({ where: { id } });
      await tx.operationLog.create({ data: { action: "DELETE_ARTIST", detail: String(id) } });
    });
    return reply.send(ok({}));
  });
}
