import { Text, Video, View } from "@tarojs/components";
import { useState } from "react";
import type { ExtractDetailPageVideoBlock } from "./internal-types";

export function DetailVideoBlock({ block }: { block: ExtractDetailPageVideoBlock }) {
  const [failed, setFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const ratio =
    block.width && block.height && block.width > 0 && block.height > 0
      ? block.height / block.width
      : 9 / 16;

  if (failed) {
    return (
      <View className="detail-video-error" data-testid="detail-video-error">
        <Text>视频加载失败，请检查网络后重试</Text>
        <Text
          className="detail-state__button"
          onClick={() => {
            setFailed(false);
            setRetryKey((value) => value + 1);
          }}
        >
          重新加载
        </Text>
      </View>
    );
  }

  return (
    <View
      className="detail-video-wrap"
      style={{ paddingBottom: `${Math.min(Math.max(ratio, 0.35), 1.5) * 100}%` }}
      data-testid="detail-video"
    >
      <Video
        key={retryKey}
        className="detail-video"
        src={block.url}
        poster={block.posterUrl || undefined}
        controls
        autoplay={false}
        loop={false}
        initialTime={0}
        objectFit="contain"
        onError={() => setFailed(true)}
      />
    </View>
  );
}
