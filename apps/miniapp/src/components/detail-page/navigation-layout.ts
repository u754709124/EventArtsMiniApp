export type DetailNavigationMetrics = { safeTop: number; headerHeight: number };

export const detailBannerMinHeightRpx = 424;

export const detailCardOverlapRpx = 42;

export const detailHeroVisibleGapRpx = 24;

export const detailHeroBottomSpaceRpx = detailCardOverlapRpx + detailHeroVisibleGapRpx;

export const detailHeroMinimumImageTopPx = 48;

export const detailHeroNavigationGapPx = 8;

export const detailBannerBackOverlapPx = 8;

export function getDetailBannerTopPx(metrics: DetailNavigationMetrics) {
  return Math.max(metrics.safeTop - detailBannerBackOverlapPx, 0);
}

export function getDetailHeroImageTopPx(metrics: DetailNavigationMetrics) {
  const bannerTop = getDetailBannerTopPx(metrics);
  return Math.max(
    detailHeroMinimumImageTopPx,
    metrics.safeTop + metrics.headerHeight + detailHeroNavigationGapPx - bannerTop
  );
}

export const detailNavigationFallbackMetrics: DetailNavigationMetrics = {
  safeTop: 20,
  headerHeight: 44
};
