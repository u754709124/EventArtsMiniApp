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

export function getDetailNavigationClearance(metrics: DetailNavigationMetrics) {
  return metrics.safeTop + metrics.headerHeight;
}

export function getDetailHeroTop(metrics: DetailNavigationMetrics) {
  return getDetailNavigationClearance(metrics) + detailHeroNavigationGapPx;
}
