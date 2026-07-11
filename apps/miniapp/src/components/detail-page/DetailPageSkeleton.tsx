import { View } from "@tarojs/components";
import type { DetailPageRendererKey } from "@event-arts/shared";
import { DetailNavigation } from "./DetailNavigation";

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
  return (
    <View
      className={`detail-page detail-page--skeleton ${banner ? "detail-page--banner" : "detail-page--rich-only"}`}
      data-testid={`detail-skeleton-${layout}`}
    >
      {banner ? (
        <View className="detail-skeleton__banner" data-testid="detail-banner-skeleton">
          <DetailNavigation title="" fallbackTabUrl={fallbackTabUrl} overlay />
          <View className="detail-skeleton__hero-line detail-skeleton__hero-line--title" />
          <View className="detail-skeleton__hero-line" />
        </View>
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
