import type { Prisma } from "@prisma/client";
import {
  DetailPageInputSchema,
  DetailOwnerTypeSchema,
  LegacyDetailPageInputSchema,
  detailPageTypeDefinitions,
  type DetailOwnerType,
  type DetailPageInput,
  type DetailPageOptionDto,
  type DetailPageReferenceDto,
  type DetailPageSummaryDto,
  type LegacyDetailPageInput
} from "@event-arts/shared";
import type { AppPrismaClient } from "../db";
import {
  collectRichTextMediaAssetIds,
  extractRichTextMedia,
  sanitizeAndNormalizeRichText
} from "./detail-page-sanitizer";
import {
  buildDetailPageDto,
  detailPageConfigInclude,
  serializeDetailPageConfig
} from "./detail-page-serializer";
import {
  DetailPageDomainError,
  DetailPageValidationError,
  type DetailPageMediaAsset
} from "./detail-page-types";
import { resolveStoredMediaAssetUrl, withResolvedMediaAssetUrl } from "../media-url";

export type DetailPageDb = AppPrismaClient | Prisma.TransactionClient;

type PreparedDetailPage = {
  parsed: DetailPageInput;
  bannerAssetIds: number[];
  richTextHtml: string;
  assets: Map<number, DetailPageMediaAsset>;
  contentMedia: Array<{ assetId: number }>;
  hero: {
    title: string;
    typeLabel: string;
    subtitle: string;
    badge: string;
    tags: string[];
    location: string;
    metaItems: Array<{ label: string; value: string }>;
  };
};

function supportsTransaction(db: DetailPageDb): db is AppPrismaClient {
  return typeof (db as AppPrismaClient).$transaction === "function";
}

async function withDetailPageTransaction<T>(
  db: DetailPageDb,
  work: (tx: Prisma.TransactionClient) => Promise<T>
) {
  return supportsTransaction(db) ? db.$transaction((tx) => work(tx)) : work(db);
}

function isForeignKeyConstraintError(error: unknown) {
  return (error as { code?: string } | null)?.code === "P2003";
}

function parseOwnerType(value: string) {
  const parsed = DetailOwnerTypeSchema.safeParse(value);
  if (!parsed.success) {
    throw new DetailPageDomainError("UNKNOWN_DETAIL_OWNER_TYPE", `未知详情业务类型：${value}`, 400);
  }
  return parsed.data;
}

function parseDetailPageInput(input: DetailPageInput) {
  const parsed = DetailPageInputSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "详情页配置参数错误";
    throw new DetailPageValidationError(message);
  }
  return parsed.data;
}

function parseLegacyDetailPageInput(input: LegacyDetailPageInput) {
  const parsed = LegacyDetailPageInputSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "详情页配置参数错误";
    throw new DetailPageValidationError(message);
  }
  return parsed.data;
}

async function assetsByIds(db: DetailPageDb, ids: number[]) {
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return new Map<number, DetailPageMediaAsset>();
  const assets = await db.mediaAsset.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, filename: true, mediaType: true, url: true, width: true, height: true, storageType: true }
  });
  return new Map(assets.map((asset) => [asset.id, {
    ...asset,
    url: resolveStoredMediaAssetUrl(asset)
  }]));
}

function publicDetailPageAssets(
  assets: Map<number, DetailPageMediaAsset>,
  publicBaseUrl?: string
) {
  if (!publicBaseUrl) return assets;
  return new Map([...assets].map(([id, asset]) => [
    id,
    asset.filename
      ? withResolvedMediaAssetUrl(publicBaseUrl, asset as DetailPageMediaAsset & { filename: string })
      : asset
  ]));
}

async function prepareDetailPage(db: DetailPageDb, input: DetailPageInput): Promise<PreparedDetailPage> {
  const parsed = parseDetailPageInput(input);
  const bannerAssetIds = parsed.type === "banner_rich_text" ? parsed.bannerAssetIds : [];
  const contentIds = collectRichTextMediaAssetIds(parsed.richTextHtml);
  const assets = await assetsByIds(db, [...bannerAssetIds, ...contentIds]);
  for (const id of bannerAssetIds) {
    const asset = assets.get(id);
    if (!asset) throw new DetailPageDomainError("DETAIL_MEDIA_NOT_FOUND", `BANNER 资源 ${id} 不存在`, 400);
    if (asset.mediaType !== "image") {
      throw new DetailPageDomainError("INVALID_BANNER_MEDIA_TYPE", `BANNER 资源 ${id} 不是图片`, 400);
    }
  }
  const richTextHtml = sanitizeAndNormalizeRichText(parsed.richTextHtml, assets);
  const contentMedia = extractRichTextMedia(richTextHtml);
  const hero = parsed.type === "banner_rich_text"
    ? {
        title: parsed.hero.title,
        typeLabel: parsed.hero.typeLabel,
        subtitle: parsed.hero.subtitle,
        badge: parsed.hero.badge,
        tags: parsed.hero.tags,
        location: parsed.hero.location,
        metaItems: parsed.hero.metaItems
      }
    : { title: "", typeLabel: "", subtitle: "", badge: "", tags: [], location: "", metaItems: [] };
  return {
    parsed,
    bannerAssetIds,
    richTextHtml,
    assets,
    contentMedia,
    hero
  };
}

async function syncBannerRelations(db: DetailPageDb, configId: number, desiredIds: number[]) {
  if (desiredIds.length) {
    await db.detailPageBannerMedia.deleteMany({
      where: { detailPageConfigId: configId, mediaAssetId: { notIn: desiredIds } }
    });
  } else {
    await db.detailPageBannerMedia.deleteMany({ where: { detailPageConfigId: configId } });
  }
  for (const [sortOrder, mediaAssetId] of desiredIds.entries()) {
    await db.detailPageBannerMedia.upsert({
      where: { detailPageConfigId_mediaAssetId: { detailPageConfigId: configId, mediaAssetId } },
      update: { sortOrder },
      create: { detailPageConfigId: configId, mediaAssetId, sortOrder }
    });
  }
}

async function syncContentRelations(db: DetailPageDb, configId: number, desiredIds: number[]) {
  if (desiredIds.length) {
    await db.detailPageContentMedia.deleteMany({
      where: { detailPageConfigId: configId, mediaAssetId: { notIn: desiredIds } }
    });
  } else {
    await db.detailPageContentMedia.deleteMany({ where: { detailPageConfigId: configId } });
  }
  for (const mediaAssetId of desiredIds) {
    await db.detailPageContentMedia.upsert({
      where: { detailPageConfigId_mediaAssetId: { detailPageConfigId: configId, mediaAssetId } },
      update: {},
      create: { detailPageConfigId: configId, mediaAssetId }
    });
  }
}

function detailPageData(prepared: PreparedDetailPage) {
  return {
    name: prepared.parsed.name,
    pageType: prepared.parsed.type,
    heroTitle: prepared.hero.title,
    heroTypeLabel: prepared.hero.typeLabel,
    heroSubtitle: prepared.hero.subtitle,
    heroBadge: prepared.hero.badge,
    heroTagsJson: JSON.stringify(prepared.hero.tags),
    heroLocation: prepared.hero.location,
    heroMetaJson: JSON.stringify(prepared.hero.metaItems),
    richTextHtml: prepared.richTextHtml,
    schemaVersion: detailPageTypeDefinitions[prepared.parsed.type].schemaVersion
  };
}

async function menuReferencesToDetailPage(db: DetailPageDb, detailPageId: number): Promise<DetailPageReferenceDto[]> {
  const menus = await db.menuItem.findMany({
    where: { type: "detail_page" },
    select: { id: true, text: true, configJson: true },
    orderBy: { id: "asc" }
  });
  return menus.flatMap((menu) => {
    try {
      const config = JSON.parse(menu.configJson) as { detailPageId?: unknown };
      return Number.isInteger(config?.detailPageId) && config.detailPageId === detailPageId && detailPageId > 0
        ? [{ sourceType: "menu" as const, sourceId: menu.id, sourceName: menu.text }]
        : [];
    } catch {
      return [];
    }
  });
}

export async function getDetailPageReferences(db: DetailPageDb, id: number): Promise<DetailPageReferenceDto[]> {
  const [announcements, banners, artists, cases, articles, recentActivities, menus] = await Promise.all([
    db.announcement.findMany({ where: { detailPageId: id }, select: { id: true, summary: true }, orderBy: { id: "asc" } }),
    db.banner.findMany({ where: { detailPageId: id }, select: { id: true, title: true }, orderBy: { id: "asc" } }),
    db.artist.findMany({ where: { detailPageId: id }, select: { id: true, name: true }, orderBy: { id: "asc" } }),
    db.activityCase.findMany({ where: { detailPageId: id }, select: { id: true, title: true }, orderBy: { id: "asc" } }),
    db.article.findMany({ where: { detailPageId: id }, select: { id: true, title: true }, orderBy: { id: "asc" } }),
    db.recentActivity.findMany({ where: { detailPageId: id }, select: { id: true, title: true }, orderBy: { id: "asc" } }),
    menuReferencesToDetailPage(db, id)
  ]);
  return [
    ...announcements.map((item) => ({ sourceType: "announcement" as const, sourceId: item.id, sourceName: item.summary })),
    ...banners.map((item) => ({ sourceType: "banner" as const, sourceId: item.id, sourceName: item.title })),
    ...artists.map((item) => ({ sourceType: "artist" as const, sourceId: item.id, sourceName: item.name })),
    ...cases.map((item) => ({ sourceType: "activity_case" as const, sourceId: item.id, sourceName: item.title })),
    ...articles.map((item) => ({ sourceType: "article" as const, sourceId: item.id, sourceName: item.title })),
    ...recentActivities.map((item) => ({ sourceType: "recent_activity" as const, sourceId: item.id, sourceName: item.title })),
    ...menus
  ];
}

export async function detailPageReferenceCount(db: DetailPageDb, id: number) {
  const [counts, menuReferences] = await Promise.all([
    Promise.all([
      db.announcement.count({ where: { detailPageId: id } }),
      db.banner.count({ where: { detailPageId: id } }),
      db.artist.count({ where: { detailPageId: id } }),
      db.activityCase.count({ where: { detailPageId: id } }),
      db.article.count({ where: { detailPageId: id } }),
      db.recentActivity.count({ where: { detailPageId: id } })
    ]),
    menuReferencesToDetailPage(db, id)
  ]);
  return counts.reduce((sum, count) => sum + count, menuReferences.length);
}

export async function listDetailPages(
  db: DetailPageDb,
  query: { q?: string; type?: string; page?: number; pageSize?: number } = {},
  publicBaseUrl?: string
) {
  const page = query.page && query.page > 0 ? query.page : 1;
  const pageSize = query.pageSize && query.pageSize > 0 ? Math.min(query.pageSize, 100) : 20;
  const where: Prisma.DetailPageConfigWhereInput = {};
  if (query.type) where.pageType = query.type;
  if (query.q?.trim()) {
    const q = query.q.trim();
    const numeric = Number(q);
    where.OR = [
      ...(Number.isInteger(numeric) && numeric > 0 ? [{ id: numeric }] : []),
      { name: { contains: q } }
    ];
  }
  const [records, total] = await Promise.all([
    db.detailPageConfig.findMany({
      where,
      include: detailPageConfigInclude,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    db.detailPageConfig.count({ where })
  ]);
  const items: DetailPageSummaryDto[] = await Promise.all(records.map(async (record) => {
    const dto = serializeDetailPageConfig(record, publicBaseUrl);
    return {
      id: record.id,
      name: record.name,
      type: dto.type,
      typeLabel: dto.typeLabel,
      bannerCount: dto.banners.length,
      detailMediaCount: extractRichTextMedia(dto.richTextHtml).length,
      referenceCount: await detailPageReferenceCount(db, record.id),
      updatedAt: record.updatedAt.toISOString()
    };
  }));
  return { items, total, page, pageSize };
}

export async function listDetailPageOptions(
  db: DetailPageDb,
  query: { q?: string; type?: string; limit?: number } = {}
): Promise<DetailPageOptionDto[]> {
  const where: Prisma.DetailPageConfigWhereInput = {};
  if (query.type) where.pageType = query.type;
  if (query.q?.trim()) {
    const q = query.q.trim();
    const numeric = Number(q);
    where.OR = [
      ...(Number.isInteger(numeric) && numeric > 0 ? [{ id: numeric }] : []),
      { name: { contains: q } }
    ];
  }
  const records = await db.detailPageConfig.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: query.limit && query.limit > 0 ? Math.min(query.limit, 100) : 30
  });
  return records.map((record) => {
    const type = record.pageType as keyof typeof detailPageTypeDefinitions;
    return {
      id: record.id,
      name: record.name,
      type,
      typeLabel: detailPageTypeDefinitions[type]?.label ?? record.pageType
    };
  });
}

export async function getDetailPageById(
  db: DetailPageDb,
  id: number,
  includeReferences = false,
  publicBaseUrl?: string
) {
  const record = await db.detailPageConfig.findUnique({ where: { id }, include: detailPageConfigInclude });
  if (!record) return null;
  const dto = serializeDetailPageConfig(record, publicBaseUrl);
  return includeReferences ? { ...dto, references: await getDetailPageReferences(db, id) } : dto;
}

export async function getRequiredDetailPageById(
  db: DetailPageDb,
  id: number,
  includeReferences = false,
  publicBaseUrl?: string
) {
  const dto = await getDetailPageById(db, id, includeReferences, publicBaseUrl);
  if (!dto) throw new DetailPageDomainError("DETAIL_PAGE_NOT_FOUND", "详情页不存在", 404);
  return dto;
}

export async function validateDetailPageReference(db: DetailPageDb, detailPageId: number | null | undefined) {
  if (detailPageId === null || detailPageId === undefined) return null;
  if (!Number.isInteger(detailPageId) || detailPageId <= 0) {
    throw new DetailPageDomainError("DETAIL_PAGE_REFERENCE_INVALID", "详情页 ID 必须是正整数", 400);
  }
  const exists = await db.detailPageConfig.count({ where: { id: detailPageId } });
  if (!exists) throw new DetailPageDomainError("DETAIL_PAGE_REFERENCE_NOT_FOUND", "选择的详情页不存在", 400);
  return detailPageId;
}

export async function createDetailPage(db: DetailPageDb, input: DetailPageInput, publicBaseUrl?: string) {
  return withDetailPageTransaction(db, async (tx) => {
    const prepared = await prepareDetailPage(tx, input);
    const record = await tx.detailPageConfig.create({
      data: {
        ...detailPageData(prepared),
        ownerType: null,
        ownerId: null
      }
    });
    await syncBannerRelations(tx, record.id, prepared.bannerAssetIds);
    await syncContentRelations(tx, record.id, prepared.contentMedia.map((item) => item.assetId));
    return getRequiredDetailPageById(tx, record.id, true, publicBaseUrl);
  });
}

export async function updateDetailPage(db: DetailPageDb, id: number, input: DetailPageInput, publicBaseUrl?: string) {
  return withDetailPageTransaction(db, async (tx) => {
    const exists = await tx.detailPageConfig.count({ where: { id } });
    if (!exists) throw new DetailPageDomainError("DETAIL_PAGE_NOT_FOUND", "详情页不存在", 404);
    const prepared = await prepareDetailPage(tx, input);
    await tx.detailPageConfig.update({
      where: { id },
      data: detailPageData(prepared)
    });
    await syncBannerRelations(tx, id, prepared.bannerAssetIds);
    await syncContentRelations(tx, id, prepared.contentMedia.map((item) => item.assetId));
    return getRequiredDetailPageById(tx, id, true, publicBaseUrl);
  });
}

export async function deleteDetailPage(db: DetailPageDb, id: number) {
  try {
    await withDetailPageTransaction(db, async (tx) => {
      const exists = await tx.detailPageConfig.count({ where: { id } });
      if (!exists) throw new DetailPageDomainError("DETAIL_PAGE_NOT_FOUND", "详情页不存在", 404);
      const references = await getDetailPageReferences(tx, id);
      if (references.length) {
        throw new DetailPageDomainError(
          "DETAIL_PAGE_IN_USE",
          `详情页正在被 ${references.length} 处业务内容引用，无法删除`,
          409
        );
      }
      await tx.detailPageConfig.delete({ where: { id } });
    });
  } catch (error) {
    if (isForeignKeyConstraintError(error)) {
      throw new DetailPageDomainError("DETAIL_PAGE_IN_USE", "详情页正在被业务内容引用，无法删除", 409);
    }
    throw error;
  }
}

export async function previewDetailPage(db: DetailPageDb, input: DetailPageInput, publicBaseUrl?: string) {
  const prepared = await prepareDetailPage(db, input);
  const type = prepared.parsed.type;
  const assets = publicDetailPageAssets(prepared.assets, publicBaseUrl);
  return buildDetailPageDto({
    id: 0,
    name: prepared.parsed.name,
    type,
    schemaVersion: detailPageTypeDefinitions[type].schemaVersion,
    hero: prepared.hero,
    heroSubtitle: prepared.hero.subtitle,
    richTextHtml: prepared.richTextHtml,
    banners: prepared.bannerAssetIds.map((id, sortOrder) => ({
      id,
      asset: assets.get(id)!,
      sortOrder
    })),
    contentAssets: assets
  });
}

export async function validateDetailPageOwner(db: DetailPageDb, ownerTypeInput: DetailOwnerType | string, ownerId: number) {
  const ownerType = parseOwnerType(ownerTypeInput);
  const exists = ownerType === "artist"
    ? await db.artist.findUnique({ where: { id: ownerId } })
    : await db.activityCase.findUnique({ where: { id: ownerId } });
  if (!exists) {
    throw new DetailPageDomainError("DETAIL_PAGE_OWNER_NOT_FOUND", `${ownerType} #${ownerId} 不存在`, 404);
  }
  return { ownerType, owner: exists };
}

function legacyInputToStandalone(
  ownerType: DetailOwnerType,
  owner: { name?: string; type?: string; badge?: string; tagsJson?: string; location?: string; title?: string; category?: string; tag?: string; eventDate?: Date },
  input: LegacyDetailPageInput
): DetailPageInput {
  if (input.type === "rich_text") {
    return {
      name: ownerType === "artist" ? `人员-${owner.name ?? ""}-详情` : `案例-${owner.title ?? ""}-详情`,
      type: "rich_text",
      richTextHtml: input.richTextHtml
    };
  }
  return {
    name: ownerType === "artist" ? `人员-${owner.name ?? ""}-详情` : `案例-${owner.title ?? ""}-详情`,
    type: "banner_rich_text",
    hero: {
      title: ownerType === "artist" ? String(owner.name ?? "") : String(owner.title ?? ""),
      typeLabel: ownerType === "artist"
        ? ({ host: "主持人", singer: "歌手", actor: "演员" } as Record<string, string>)[String(owner.type)] ?? String(owner.type ?? "")
        : String(owner.category ?? owner.tag ?? ""),
      subtitle: input.heroSubtitle,
      badge: ownerType === "artist" ? String(owner.badge ?? "") : String(owner.tag ?? ""),
      tags: ownerType === "artist" ? JSON.parse(String(owner.tagsJson || "[]")) as string[] : [],
      location: String(owner.location ?? ""),
      metaItems: ownerType === "activity_case" && owner.eventDate ? [{ label: "日期", value: owner.eventDate.toISOString().slice(0, 10) }] : []
    },
    bannerAssetIds: input.bannerAssetIds,
    richTextHtml: input.richTextHtml
  };
}

/** @deprecated Runtime code should use detailPageId and getDetailPageById. */
export async function getDetailPageConfig(
  db: DetailPageDb,
  ownerTypeInput: DetailOwnerType | string,
  ownerId: number
) {
  const ownerType = parseOwnerType(ownerTypeInput);
  const record = await db.detailPageConfig.findFirst({
    where: { ownerType, ownerId },
    include: detailPageConfigInclude
  });
  return record ? serializeDetailPageConfig(record) : null;
}

/** @deprecated Runtime code should use detailPageId and getRequiredDetailPageById. */
export async function getRequiredDetailPageConfig(
  db: DetailPageDb,
  ownerType: DetailOwnerType | string,
  ownerId: number
) {
  const config = await getDetailPageConfig(db, ownerType, ownerId);
  if (!config) {
    throw new DetailPageDomainError("DETAIL_PAGE_CONFIG_NOT_FOUND", "详情页配置不存在", 404);
  }
  return config;
}

/** @deprecated New writes must use createDetailPage/updateDetailPage. */
export async function upsertDetailPageConfig(
  db: DetailPageDb,
  ownerTypeInput: DetailOwnerType | string,
  ownerId: number,
  input: LegacyDetailPageInput
) {
  return withDetailPageTransaction(db, async (tx) => {
    const { ownerType, owner } = await validateDetailPageOwner(tx, ownerTypeInput, ownerId);
    const standaloneInput = legacyInputToStandalone(ownerType, owner, parseLegacyDetailPageInput(input));
    const prepared = await prepareDetailPage(tx, standaloneInput);
    const existing = await tx.detailPageConfig.findFirst({ where: { ownerType, ownerId } });
    const record = existing
      ? await tx.detailPageConfig.update({ where: { id: existing.id }, data: detailPageData(prepared) })
      : await tx.detailPageConfig.create({
          data: {
            ...detailPageData(prepared),
            ownerType,
            ownerId
          }
        });
    await syncBannerRelations(tx, record.id, prepared.bannerAssetIds);
    await syncContentRelations(tx, record.id, prepared.contentMedia.map((item) => item.assetId));
    return getRequiredDetailPageById(tx, record.id);
  });
}

/** @deprecated Deleting a business object must not delete reusable detail pages. */
export async function deleteDetailPageConfig(
  db: DetailPageDb,
  ownerTypeInput: DetailOwnerType | string,
  ownerId: number
) {
  const ownerType = parseOwnerType(ownerTypeInput);
  await db.detailPageConfig.deleteMany({ where: { ownerType, ownerId } });
}

/** @deprecated Use previewDetailPage. */
export const previewDetailPageConfig = previewDetailPage;
