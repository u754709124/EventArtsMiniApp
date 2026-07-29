export type DetailNavigationMetrics = { safeTop: number; headerHeight: number };

export const detailBannerMinHeightRpx = 424;

export const detailCardOverlapRpx = 42;

export const detailHeroVisibleGapRpx = 24;

export const detailHeroBottomSpaceRpx = detailCardOverlapRpx + detailHeroVisibleGapRpx;

export const detailHeroNavigationGapPx = 8;

export const detailNavigationFallbackMetrics: DetailNavigationMetrics = {
  safeTop: 20,
  headerHeight: 44
};
