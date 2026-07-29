import { View } from "@tarojs/components";
import type { DetailPageRendererKey } from "@event-arts/shared";
import { useMemo } from "react";
import { DetailNavigation, getDetailNavigationMetrics } from "./DetailNavigation";
import { getDetailBannerTopPx, getDetailHeroImageTopPx } from "./navigation-layout";

export function DetailPageSkeleton({
  layout,
  fallbackTabUrl,
  title
}: {
  layout: DetailPageRendererKey;
  fallbackTabUrl: string;
  title: string;
}) {
  const banner = layout === "bannerRichText";
  const navigationMetrics = useMemo(getDetailNavigationMetrics, []);
  const bannerTop = getDetailBannerTopPx(navigationMetrics);
  const heroImageTop = getDetailHeroImageTopPx(navigationMetrics);
  return (
    <View
      className={`detail-page detail-page--skeleton ${banner ? "detail-page--banner" : "detail-page--rich-only"}`}
      data-testid={`detail-skeleton-${layout}`}
    >
      {banner ? (
        <>
          <DetailNavigation
            title=""
            fallbackTabUrl={fallbackTabUrl}
            metrics={navigationMetrics}
            className="detail-navigation--banner-safe"
          />
          <View
            className="detail-skeleton__banner"
            data-testid="detail-banner-skeleton"
            style={{ marginTop: `${bannerTop}px`, paddingTop: `${heroImageTop}px` }}
          >
            <View className="detail-skeleton__hero-line detail-skeleton__hero-line--title" />
            <View className="detail-skeleton__hero-line" />
          </View>
        </>
      ) : (
        <DetailNavigation title={title} fallbackTabUrl={fallbackTabUrl} />
      )}
      <View
        className={`detail-content ${banner ? "detail-content--overlap" : "detail-content--normal"}`}
      >
        {[0, 1, 2].map((index) => (
          <View key={index} className="detail-skeleton__card">
            <View />
            <View />
            <View />
          </View>
        ))}
      </View>
    </View>
  );
}
