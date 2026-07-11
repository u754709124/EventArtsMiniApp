import type { DetailPageConfigDto, DetailPageHeroPresentation } from "@event-arts/shared";

export type DetailHeroViewModel = DetailPageHeroPresentation;

export type DetailRendererProps = {
  config: DetailPageConfigDto;
  hero: DetailHeroViewModel;
  fallbackTabUrl: string;
};

export type DetailLayoutContract = {
  createsBanner: boolean;
  createsHero: boolean;
  createsCounter: boolean;
  createsBannerSkeleton: boolean;
  reservesBannerHeight: boolean;
  usesNegativeOverlap: boolean;
};
