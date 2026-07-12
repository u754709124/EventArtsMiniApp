import type { DetailPageConfigDto, DetailPageHeroPresentation } from "@event-arts/shared";
import type { DetailShareState } from "./detail-share";

export type DetailHeroViewModel = DetailPageHeroPresentation;

export type DetailRendererProps = {
  config: DetailPageConfigDto;
  hero: DetailHeroViewModel;
  fallbackTabUrl: string;
  share?: DetailShareState;
  showShareButton?: boolean;
};

export type DetailLayoutContract = {
  createsBanner: boolean;
  createsHero: boolean;
  createsCounter: boolean;
  createsBannerSkeleton: boolean;
  reservesBannerHeight: boolean;
  usesNegativeOverlap: boolean;
};
