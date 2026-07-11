import type {
  DetailPageBannerDto,
  DetailPageBlockDto,
  DetailPageCardDto,
  DetailPageRendererKey
} from "@event-arts/shared";
import {
  collectDetailPageCardImageUrls,
  collectDetailPageImageUrls,
  hasSemanticDetailPageCards,
  hasSemanticDetailPageContent,
  sortDetailPageBanners
} from "@event-arts/shared/detail-page-presentation";
import type { DetailLayoutContract } from "./types";

const layoutContracts = {
  bannerRichText: {
    createsBanner: true,
    createsHero: true,
    createsCounter: true,
    createsBannerSkeleton: true,
    reservesBannerHeight: true,
    usesNegativeOverlap: true
  },
  richText: {
    createsBanner: false,
    createsHero: false,
    createsCounter: false,
    createsBannerSkeleton: false,
    reservesBannerHeight: false,
    usesNegativeOverlap: false
  }
} as const satisfies Record<DetailPageRendererKey, DetailLayoutContract>;

export function getRendererRegistration(): DetailPageRendererKey[] {
  return Object.keys(layoutContracts) as DetailPageRendererKey[];
}

export function getDetailLayoutContract(rendererKey: DetailPageRendererKey): DetailLayoutContract {
  const contract = layoutContracts[rendererKey];
  if (!contract) throw new Error(`未知详情页渲染器：${String(rendererKey)}`);
  return contract;
}

export function sortDetailBanners(banners: DetailPageBannerDto[]) {
  return sortDetailPageBanners(banners);
}

export function collectDetailImageUrls(blocks: DetailPageBlockDto[]) {
  return collectDetailPageImageUrls(blocks);
}

export function collectDetailCardImageUrls(cards: DetailPageCardDto[]) {
  return collectDetailPageCardImageUrls(cards);
}

export function hasSemanticDetailContent(blocks: DetailPageBlockDto[]) {
  return hasSemanticDetailPageContent(blocks);
}

export function hasSemanticDetailCards(cards: DetailPageCardDto[]) {
  return hasSemanticDetailPageCards(cards);
}
