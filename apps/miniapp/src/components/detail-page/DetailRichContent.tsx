import Taro from "@tarojs/taro";
import { RichText, Text, View } from "@tarojs/components";
import { useMemo } from "react";
import type { DetailPageCardDto } from "@event-arts/shared";
import { previewRichTextImage } from "./media-health";
import { collectDetailCardImageUrls } from "./model";
import { DetailVideoBlock } from "./DetailVideoBlock";
import { useDetailImageHealth } from "./useDetailImageHealth";
import { useRepeatClickGuard } from "../../utils/repeat-click-guard";
import { enhanceDetailRichTextForDisplay } from "./rich-text-display";

export function DetailRichContent({ cards }: { cards: DetailPageCardDto[] }) {
  const imageUrls = useMemo(() => collectDetailCardImageUrls(cards), [cards]);
  const imageHealth = useDetailImageHealth(imageUrls);
  const clickGuard = useRepeatClickGuard();

  function previewImage(event: unknown) {
    void previewRichTextImage(event, imageUrls, (options) => Taro.previewImage(options)).catch(
      () => undefined
    );
  }

  return (
    <View className="detail-rich-content" data-testid="detail-rich-content">
      {imageHealth.failedUrls.length > 0 && (
        <View
          className="detail-image-health-error"
          data-testid="detail-rich-image-error"
          data-failed-urls={imageHealth.failedUrls.join("|")}
          role="alert"
        >
          <Text>{imageHealth.failedUrls.length} 张正文图片加载失败</Text>
          <Text
            className="detail-state__button"
            data-testid="detail-rich-image-retry"
            onClick={() => clickGuard("detail:rich-image:retry", () => {
              if (!imageHealth.checking) imageHealth.retry();
            })}
          >
            {imageHealth.checking ? "正在重新检查" : "重新加载图片"}
          </Text>
        </View>
      )}
      {cards.map((card, cardIndex) =>
        <View key={`card-${cardIndex}`} className="detail-rich-card" data-testid="detail-rich-card">
          {card.blocks.map((block, blockIndex) =>
            block.type === "richText" ? (
              <RichText
                key={`${imageHealth.richTextRetryKey}-rich-${cardIndex}-${blockIndex}`}
                className="detail-rich-text"
                data-testid="detail-rich-text-block"
                nodes={enhanceDetailRichTextForDisplay(block.html)}
                onClick={(event) => clickGuard("detail:rich-image:preview", () => previewImage(event))}
              />
            ) : (
              <DetailVideoBlock key={`video-${block.assetId}-${cardIndex}-${blockIndex}`} block={block} />
            )
          )}
        </View>
      )}
    </View>
  );
}
