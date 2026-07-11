import { Swiper, SwiperItem, Text, View } from "@tarojs/components";
import { useMemo, useState } from "react";
import { getDisplayDetailPageBanners } from "@event-arts/shared/detail-page-presentation";
import { generatedAssets } from "../../assets";
import { AppImage } from "../AppImage";
import { DetailNavigation } from "./DetailNavigation";
import { DetailHeroBanner } from "./DetailHeroBanner";
import { DetailRichContent } from "./DetailRichContent";
import { updateFailedMediaIds } from "./media-health";
import type { DetailRendererProps } from "./types";

export function BannerRichTextRenderer({ config, hero, fallbackTabUrl }: DetailRendererProps) {
  const banners = useMemo(() => getDisplayDetailPageBanners(config.banners), [config.banners]);
  const [current, setCurrent] = useState(0);
  const [failedBannerIds, setFailedBannerIds] = useState<number[]>([]);
  const [bannerRetryKey, setBannerRetryKey] = useState(0);
  const multiple = banners.length > 1;
  const fixedForE2E =
    process.env.NODE_ENV === "test" ||
    (typeof globalThis !== "undefined" &&
      (globalThis as typeof globalThis & { __TARO_DETAIL_E2E_FIXED__?: boolean })
        .__TARO_DETAIL_E2E_FIXED__ === true);

  if (!banners.length) {
    return (
      <View className="detail-page detail-page--state">
        <DetailNavigation title={hero.title} fallbackTabUrl={fallbackTabUrl} />
        <DetailInlineState title="详情媒体配置异常" description="BANNER 图片不存在，请稍后重试" />
      </View>
    );
  }

  return (
    <View className="detail-page detail-page--banner" data-testid="detail-layout-banner">
      <View className="detail-banner" data-testid="detail-banner">
        <Swiper
          className="detail-banner__swiper"
          current={current}
          circular={multiple}
          autoplay={multiple && !fixedForE2E}
          interval={6500}
          duration={420}
          onChange={(event) => setCurrent(event.detail.current)}
        >
          {banners.map((banner) => (
            <SwiperItem key={banner.id}>
              <AppImage
                key={`${bannerRetryKey}-${banner.id}`}
                className="detail-banner__image"
                src={banner.url}
                fallback={generatedAssets.placeholderBanner}
                mode="aspectFill"
                testid="detail-banner-image"
                onError={() =>
                  setFailedBannerIds((ids) => updateFailedMediaIds(ids, banner.id, true))
                }
                onLoad={() =>
                  setFailedBannerIds((ids) => updateFailedMediaIds(ids, banner.id, false))
                }
              />
            </SwiperItem>
          ))}
        </Swiper>
        <View className="detail-banner__shade" aria-hidden />
        <DetailNavigation title="" fallbackTabUrl={fallbackTabUrl} overlay />
        <DetailHeroBanner hero={hero} />
        <Text className="detail-banner__counter" data-testid="detail-banner-counter">
          {Math.min(current + 1, banners.length)}/{banners.length}
        </Text>
      </View>
      <View className="detail-content detail-content--overlap" data-testid="detail-content-overlap">
        {failedBannerIds.length > 0 && (
          <View
            className="detail-banner-media-error"
            data-testid="detail-banner-media-error"
            role="alert"
          >
            <Text>{failedBannerIds.length} 张 BANNER 图片加载失败，已显示占位图</Text>
            <Text
              className="detail-state__button"
              data-testid="detail-banner-media-retry"
              onClick={() => {
                setFailedBannerIds([]);
                setBannerRetryKey((value) => value + 1);
              }}
            >
              重新加载图片
            </Text>
          </View>
        )}
        <DetailRichContent cards={config.cards} />
      </View>
    </View>
  );
}

function DetailInlineState({ title, description }: { title: string; description: string }) {
  return (
    <View className="detail-state" data-testid="detail-media-error">
      <Text className="detail-state__title">{title}</Text>
      <Text>{description}</Text>
    </View>
  );
}
