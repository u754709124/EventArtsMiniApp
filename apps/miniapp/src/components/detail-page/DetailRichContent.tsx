import Taro from "@tarojs/taro";
import { RichText, View } from "@tarojs/components";
import { useEffect, useMemo } from "react";
import type { DetailPageCardDto } from "@event-arts/shared";
import { previewRichTextImage } from "./media-health";
import { collectDetailCardImageUrls } from "./model";
import { DetailVideoBlock } from "./DetailVideoBlock";
import { useRepeatClickGuard } from "../../utils/repeat-click-guard";
import { enhanceDetailRichTextForDisplay } from "./rich-text-display";
import { createExclusiveVideoPlaybackController } from "./video-playback";

export function DetailRichContent({ cards }: { cards: DetailPageCardDto[] }) {
  const imageUrls = useMemo(() => collectDetailCardImageUrls(cards), [cards]);
  const clickGuard = useRepeatClickGuard();
  const videoPlayback = useMemo(() => createExclusiveVideoPlaybackController(), []);

  useEffect(() => () => videoPlayback.reset(), [videoPlayback]);

  function previewImage(event: unknown) {
    void previewRichTextImage(event, imageUrls, (options) => Taro.previewImage(options)).catch(
      () => undefined
    );
  }

  return (
    <View className="detail-rich-content" data-testid="detail-rich-content">
      {cards.map((card, cardIndex) =>
        <View key={`card-${cardIndex}`} className="detail-rich-card" data-testid="detail-rich-card">
          {card.blocks.map((block, blockIndex) =>
            block.type === "richText" ? (
              <RichText
                key={`rich-${cardIndex}-${blockIndex}`}
                className="detail-rich-text"
                data-testid="detail-rich-text-block"
                nodes={enhanceDetailRichTextForDisplay(block.html)}
                onClick={(event) => clickGuard("detail:rich-image:preview", () => previewImage(event))}
              />
            ) : (
              <DetailVideoBlock
                key={`video-${block.assetId}-${cardIndex}-${blockIndex}`}
                block={block}
                videoId={`detail-video-${cardIndex}-${blockIndex}`}
                onPlay={() =>
                  videoPlayback.play(`detail-video-${cardIndex}-${blockIndex}`, (videoId) => {
                    Taro.createVideoContext(videoId).pause();
                  })
                }
                onInactive={() =>
                  videoPlayback.inactive(`detail-video-${cardIndex}-${blockIndex}`)
                }
              />
            )
          )}
        </View>
      )}
    </View>
  );
}
