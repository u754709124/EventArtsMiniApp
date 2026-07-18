import { Text, Video, View } from "@tarojs/components";
import { useState } from "react";
import type { ExtractDetailPageVideoBlock } from "./internal-types";
import { getVideoAspectRatioPadding } from "./video-layout";

export function DetailVideoBlock({ block }: { block: ExtractDetailPageVideoBlock }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <View className="detail-video-error" data-testid="detail-video-error">
        <Text>视频加载失败，请下拉刷新重试</Text>
      </View>
    );
  }

  return (
    <View
      className="detail-video-wrap"
      style={{ paddingBottom: getVideoAspectRatioPadding(block) }}
      data-testid="detail-video"
    >
      <Video
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
