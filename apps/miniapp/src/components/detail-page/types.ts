import type { DetailPageConfigDto } from "@event-arts/shared";

export type DetailHeroViewModel = {
  title: string;
  typeLabel?: string;
  subtitle?: string;
  badge?: string;
  tags?: string[];
  location?: string;
  metaItems?: Array<{
    label: string;
    value: string;
  }>;
};

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
