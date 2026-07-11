import type { Prisma } from "@prisma/client";
import {
  DetailPageTypeSchema,
  detailPageTypeDefinitions,
  type DetailPageConfigDto,
  type DetailPageReferenceDto,
  type DetailPageType
} from "@event-arts/shared";
import { buildDetailPageBlocks } from "./detail-page-parser";
import { DetailPageDomainError, type DetailPageMediaAsset } from "./detail-page-types";

export const detailPageConfigInclude = {
  banners: { include: { mediaAsset: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
  contentMedia: { include: { mediaAsset: true }, orderBy: { id: "asc" } }
} satisfies Prisma.DetailPageConfigInclude;

export type DetailPageConfigRecord = Prisma.DetailPageConfigGetPayload<{
  include: typeof detailPageConfigInclude;
}>;

export function assertDetailPageType(value: string): DetailPageType {
  const parsed = DetailPageTypeSchema.safeParse(value);
  if (!parsed.success) {
    throw new DetailPageDomainError("UNKNOWN_DETAIL_PAGE_TYPE", `未知详情页类型：${value}`, 400);
  }
  return parsed.data;
}

export function buildDetailPageDto(input: {
  id: number;
  name: string;
  type: DetailPageType;
  schemaVersion: number;
  hero: DetailPageConfigDto["hero"];
  heroSubtitle: string;
  richTextHtml: string;
  banners: Array<{ id: number; asset: DetailPageMediaAsset; sortOrder: number }>;
  contentAssets: ReadonlyMap<number, DetailPageMediaAsset>;
  references?: DetailPageReferenceDto[];
  createdAt?: Date | string;
  updatedAt?: Date | string;
}): DetailPageConfigDto {
  const definition = detailPageTypeDefinitions[input.type];
  const banners = input.type === "rich_text"
    ? []
    : input.banners.map((banner) => {
        if (banner.asset.mediaType !== "image") {
          throw new DetailPageDomainError("INVALID_BANNER_MEDIA_TYPE", "详情页 BANNER 只能引用图片资源", 400);
        }
        return {
          id: banner.id,
          assetId: banner.asset.id,
          url: banner.asset.url,
          width: banner.asset.width,
          height: banner.asset.height,
          sortOrder: banner.sortOrder
        };
      });
  return {
    id: input.id,
    name: input.name,
    type: input.type,
    typeLabel: definition.label,
    rendererKey: definition.rendererKey,
    schemaVersion: input.schemaVersion,
    hero: input.type === "rich_text"
      ? { title: "", typeLabel: "", subtitle: "", badge: "", tags: [], location: "", metaItems: [] }
      : input.hero,
    heroSubtitle: input.type === "rich_text" ? "" : input.hero.subtitle || input.heroSubtitle,
    banners,
    richTextHtml: input.richTextHtml,
    blocks: input.richTextHtml ? buildDetailPageBlocks(input.richTextHtml, input.contentAssets) : [],
    ...(input.references ? { references: input.references } : {}),
    ...(input.createdAt ? { createdAt: new Date(input.createdAt).toISOString() } : {}),
    ...(input.updatedAt ? { updatedAt: new Date(input.updatedAt).toISOString() } : {})
  };
}

function parseStringArray(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
  } catch {
    return [];
  }
}

function parseMetaItems(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const label = "label" in item && typeof item.label === "string" ? item.label.trim() : "";
      const metaValue = "value" in item && typeof item.value === "string" ? item.value.trim() : "";
      return label && metaValue ? [{ label, value: metaValue }] : [];
    });
  } catch {
    return [];
  }
}

export function serializeDetailPageConfig(record: DetailPageConfigRecord) {
  const type = assertDetailPageType(record.pageType);
  const contentAssets = new Map<number, DetailPageMediaAsset>(
    record.contentMedia.map((relation) => [relation.mediaAsset.id, relation.mediaAsset])
  );
  return buildDetailPageDto({
    id: record.id,
    name: record.name,
    type,
    schemaVersion: record.schemaVersion,
    hero: {
      title: record.heroTitle,
      typeLabel: record.heroTypeLabel,
      subtitle: record.heroSubtitle,
      badge: record.heroBadge,
      tags: parseStringArray(record.heroTagsJson),
      location: record.heroLocation,
      metaItems: parseMetaItems(record.heroMetaJson)
    },
    heroSubtitle: record.heroSubtitle,
    richTextHtml: record.richTextHtml,
    banners: record.banners.map((relation) => ({
      id: relation.id,
      asset: relation.mediaAsset,
      sortOrder: relation.sortOrder
    })),
    contentAssets,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  });
}
