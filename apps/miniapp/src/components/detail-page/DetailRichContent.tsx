import Taro from "@tarojs/taro";
import { RichText, View } from "@tarojs/components";
import type { DetailPageBlockDto } from "@event-arts/shared";
import { collectDetailImageUrls } from "./model";
import { DetailVideoBlock } from "./DetailVideoBlock";

export function DetailRichContent({ blocks }: { blocks: DetailPageBlockDto[] }) {
  const imageUrls = collectDetailImageUrls(blocks);

  function previewImage(event: unknown) {
    const target = (event as { target?: { src?: string; dataset?: { src?: string } } })?.target;
    const current = target?.dataset?.src || target?.src;
    if (!current || !imageUrls.includes(current)) return;
    const result = Taro.previewImage({ current, urls: imageUrls });
    if (result && typeof result.catch === "function") void result.catch(() => undefined);
  }

  return (
    <View className="detail-rich-content" data-testid="detail-rich-content">
      {blocks.map((block, index) =>
        block.type === "richText" ? (
          <RichText
            key={`rich-${index}`}
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
