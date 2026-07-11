import { Text, View } from "@tarojs/components";
import type { ComponentType } from "react";
import type { DetailPageRendererKey } from "@event-arts/shared";
import { resolveDetailPagePresentation } from "@event-arts/shared/detail-page-presentation";
import { BannerRichTextRenderer } from "./BannerRichTextRenderer";
import { DetailNavigation } from "./DetailNavigation";
import { RichTextRenderer } from "./RichTextRenderer";
import type { DetailRendererProps } from "./types";
import "./detail-page.scss";

export const detailRendererRegistry = {
  bannerRichText: BannerRichTextRenderer,
  richText: RichTextRenderer
} satisfies Record<DetailPageRendererKey, ComponentType<DetailRendererProps>>;

export function DetailPageRenderer(props: DetailRendererProps) {
  const Renderer = detailRendererRegistry[props.config.rendererKey];
  const presentation = resolveDetailPagePresentation(props.config);
  if (!Renderer) {
    return (
      <DetailConfigState
        {...props}
        testid="detail-unknown-renderer"
        title="详情页类型暂不支持"
        description={`未知详情页渲染器：${String(props.config.rendererKey)}`}
      />
    );
  }
  if (!presentation.hasSemanticContent) {
    return (
      <DetailConfigState
        {...props}
        testid="detail-semantic-empty"
        title="详情待补充"
        description="当前详情内容为空"
      />
    );
  }
  return <Renderer {...props} />;
}

function DetailConfigState({
  testid,
  title,
  description,
  hero,
  fallbackTabUrl
}: DetailRendererProps & { testid: string; title: string; description: string }) {
  return (
    <View className="detail-page detail-page--state">
      <DetailNavigation title={hero.title} fallbackTabUrl={fallbackTabUrl} />
      <View className="detail-state" data-testid={testid}>
        <Text className="detail-state__title">{title}</Text>
        <Text>{description}</Text>
      </View>
    </View>
  );
}
