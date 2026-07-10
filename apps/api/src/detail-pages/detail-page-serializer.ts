import type { Prisma } from "@prisma/client";
import {
  DetailPageTypeSchema,
  detailPageTypeDefinitions,
  type DetailPageConfigDto,
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
  type: DetailPageType;
  schemaVersion: number;
  heroSubtitle: string;
  richTextHtml: string;
  banners: Array<{ id: number; asset: DetailPageMediaAsset; sortOrder: number }>;
  contentAssets: ReadonlyMap<number, DetailPageMediaAsset>;
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
    type: input.type,
    typeLabel: definition.label,
    rendererKey: definition.rendererKey,
    schemaVersion: input.schemaVersion,
    heroSubtitle: input.type === "rich_text" ? "" : input.heroSubtitle,
    banners,
    richTextHtml: input.richTextHtml,
    blocks: input.richTextHtml ? buildDetailPageBlocks(input.richTextHtml, input.contentAssets) : []
  };
}

export function serializeDetailPageConfig(record: DetailPageConfigRecord) {
  const type = assertDetailPageType(record.pageType);
  const contentAssets = new Map<number, DetailPageMediaAsset>(
    record.contentMedia.map((relation) => [relation.mediaAsset.id, relation.mediaAsset])
  );
  return buildDetailPageDto({
    type,
    schemaVersion: record.schemaVersion,
    heroSubtitle: record.heroSubtitle,
    richTextHtml: record.richTextHtml,
    banners: record.banners.map((relation) => ({
      id: relation.id,
      asset: relation.mediaAsset,
      sortOrder: relation.sortOrder
    })),
    contentAssets
  });
}
