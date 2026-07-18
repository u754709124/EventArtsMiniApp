import { Text, Video, View } from "@tarojs/components";
import type { CSSProperties } from "react";
import { useState } from "react";
import type { ExtractDetailPageVideoBlock } from "./internal-types";
import { getVideoAspectRatioPadding } from "./video-layout";

type VideoWrapStyle = CSSProperties;

function positiveDimension(value: number | null) {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : null;
}

function getVideoWrapLayout(block: ExtractDetailPageVideoBlock): { className: string; style: VideoWrapStyle } {
  const width = positiveDimension(block.width);
  const height = positiveDimension(block.height);
  if (!width || !height) {
    return {
      className: "detail-video-wrap",
      style: { paddingBottom: getVideoAspectRatioPadding(block) }
    };
  }
  return {
    className: "detail-video-wrap detail-video-wrap--intrinsic",
    style: {
      maxWidth: `${width}px`,
      aspectRatio: `${width} / ${height}`
    }
  };
}

export function DetailVideoBlock({ block }: { block: ExtractDetailPageVideoBlock }) {
  const [failed, setFailed] = useState(false);
  const layout = getVideoWrapLayout(block);

  if (failed) {
    return (
      <View className="detail-video-error" data-testid="detail-video-error">
        <Text>视频加载失败，请下拉刷新重试</Text>
      </View>
    );
  }

  return (
    <View
      className={layout.className}
      style={layout.style}
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
