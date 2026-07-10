import type { Prisma } from "@prisma/client";
import {
  DetailPageInputSchema,
  DetailOwnerTypeSchema,
  type DetailOwnerType,
  type DetailPageInput
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

export type DetailPageDb = AppPrismaClient | Prisma.TransactionClient;

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

async function assetsByIds(db: DetailPageDb, ids: number[]) {
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return new Map<number, DetailPageMediaAsset>();
  const assets = await db.mediaAsset.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, mediaType: true, url: true, width: true, height: true }
  });
  return new Map(assets.map((asset) => [asset.id, asset]));
}

async function prepareDetailPage(db: DetailPageDb, input: DetailPageInput) {
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
  return {
    parsed,
    bannerAssetIds,
    richTextHtml,
    assets,
    contentMedia
  };
}

export async function validateDetailPageOwner(db: DetailPageDb, ownerTypeInput: DetailOwnerType | string, ownerId: number) {
  const ownerType = parseOwnerType(ownerTypeInput);
  const exists = ownerType === "artist"
    ? await db.artist.count({ where: { id: ownerId } })
    : await db.activityCase.count({ where: { id: ownerId } });
  if (!exists) {
    throw new DetailPageDomainError("DETAIL_PAGE_OWNER_NOT_FOUND", `${ownerType} #${ownerId} 不存在`, 404);
  }
  return ownerType;
}

export async function getDetailPageConfig(
  db: DetailPageDb,
  ownerTypeInput: DetailOwnerType | string,
  ownerId: number
) {
  const ownerType = parseOwnerType(ownerTypeInput);
  const record = await db.detailPageConfig.findUnique({
    where: { ownerType_ownerId: { ownerType, ownerId } },
    include: detailPageConfigInclude
  });
  return record ? serializeDetailPageConfig(record) : null;
}

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

export async function upsertDetailPageConfig(
  db: DetailPageDb,
  ownerTypeInput: DetailOwnerType | string,
  ownerId: number,
  input: DetailPageInput
) {
  const ownerType = await validateDetailPageOwner(db, ownerTypeInput, ownerId);
  const prepared = await prepareDetailPage(db, input);
  const record = await db.detailPageConfig.upsert({
    where: { ownerType_ownerId: { ownerType, ownerId } },
    update: {
      pageType: prepared.parsed.type,
      heroSubtitle: prepared.parsed.type === "banner_rich_text" ? prepared.parsed.heroSubtitle : "",
      richTextHtml: prepared.richTextHtml,
      schemaVersion: 1
    },
    create: {
      ownerType,
      ownerId,
      pageType: prepared.parsed.type,
      heroSubtitle: prepared.parsed.type === "banner_rich_text" ? prepared.parsed.heroSubtitle : "",
      richTextHtml: prepared.richTextHtml,
      schemaVersion: 1
    }
  });
  await syncBannerRelations(db, record.id, prepared.bannerAssetIds);
  await syncContentRelations(db, record.id, prepared.contentMedia.map((item) => item.assetId));
  return getRequiredDetailPageConfig(db, ownerType, ownerId);
}

export async function deleteDetailPageConfig(
  db: DetailPageDb,
  ownerTypeInput: DetailOwnerType | string,
  ownerId: number
) {
  const ownerType = parseOwnerType(ownerTypeInput);
  await db.detailPageConfig.deleteMany({ where: { ownerType, ownerId } });
}

export async function previewDetailPageConfig(db: DetailPageDb, input: DetailPageInput) {
  const prepared = await prepareDetailPage(db, input);
  const type = prepared.parsed.type;
  return buildDetailPageDto({
    type,
    schemaVersion: 1,
    heroSubtitle: type === "banner_rich_text" ? prepared.parsed.heroSubtitle : "",
    richTextHtml: prepared.richTextHtml,
    banners: prepared.bannerAssetIds.map((id, sortOrder) => ({
      id,
      asset: prepared.assets.get(id)!,
      sortOrder
    })),
    contentAssets: prepared.assets
  });
}
