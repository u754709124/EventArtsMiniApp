import Taro from "@tarojs/taro";
import { RichText, Text, View } from "@tarojs/components";
import { useMemo } from "react";
import type { DetailPageBlockDto } from "@event-arts/shared";
import { previewRichTextImage } from "./media-health";
import { collectDetailImageUrls } from "./model";
import { DetailVideoBlock } from "./DetailVideoBlock";
import { useDetailImageHealth } from "./useDetailImageHealth";

export function DetailRichContent({ blocks }: { blocks: DetailPageBlockDto[] }) {
  const imageUrls = useMemo(() => collectDetailImageUrls(blocks), [blocks]);
  const imageHealth = useDetailImageHealth(imageUrls);

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
            onClick={() => {
              if (!imageHealth.checking) imageHealth.retry();
            }}
          >
            {imageHealth.checking ? "正在重新检查" : "重新加载图片"}
          </Text>
        </View>
      )}
      {blocks.map((block, index) =>
        block.type === "richText" ? (
          <RichText
            key={`${imageHealth.richTextRetryKey}-rich-${index}`}
            className="detail-rich-text"
            data-testid="detail-rich-text-block"
            nodes={block.html}
            onClick={previewImage}
          />
        ) : (
          <DetailVideoBlock key={`video-${block.assetId}-${index}`} block={block} />
        )
      )}
    </View>
  );
}
