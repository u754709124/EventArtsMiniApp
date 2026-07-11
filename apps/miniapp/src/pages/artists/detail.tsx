import { Text, View } from "@tarojs/components";
import { useLoad } from "@tarojs/taro";
import { useState } from "react";
import type { ArtistDetailDto } from "@event-arts/shared";
import { request } from "../../services/api";

export default function ArtistDetail() {
  const [item, setItem] = useState<ArtistDetailDto | null>(null);
  useLoad((query) => {
    void request<ArtistDetailDto>(`/api/client/artists/${query.id}`).then(setItem);
  });
  return (
    <View className="page" data-testid="artist-detail-page">
      <Text className="home-title">{item?.name || "人员详情"}</Text>
      <Text>{item?.summary || "暂无人员内容"}</Text>
      <Text>{item?.detail}</Text>
    </View>
  );
}
