import { View } from "@tarojs/components";
import { DetailNavigation } from "./DetailNavigation";
import { DetailRichContent } from "./DetailRichContent";
import type { DetailRendererProps } from "./types";

export function RichTextRenderer({ config, hero, fallbackTabUrl, showShareButton = false }: DetailRendererProps) {
  return (
    <View className="detail-page detail-page--rich-only" data-testid="detail-layout-rich-only">
      <DetailNavigation title={hero.title} fallbackTabUrl={fallbackTabUrl} />
      <View
        className={`detail-content detail-content--normal ${showShareButton ? "detail-content--with-floating-share" : ""}`}
        data-testid="detail-content-normal"
      >
        <DetailRichContent cards={config.cards} />
      </View>
    </View>
  );
}
