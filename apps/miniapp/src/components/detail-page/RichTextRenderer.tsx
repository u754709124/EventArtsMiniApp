import { View } from "@tarojs/components";
import { DetailNavigation } from "./DetailNavigation";
import { DetailRichContent } from "./DetailRichContent";
import type { DetailRendererProps } from "./types";

export function RichTextRenderer({ config, hero, fallbackTabUrl }: DetailRendererProps) {
  return (
    <View className="detail-page detail-page--rich-only" data-testid="detail-layout-rich-only">
      <DetailNavigation title={hero.title} fallbackTabUrl={fallbackTabUrl} />
      <View className="detail-content detail-content--normal" data-testid="detail-content-normal">
        <DetailRichContent blocks={config.blocks} />
      </View>
    </View>
  );
}
