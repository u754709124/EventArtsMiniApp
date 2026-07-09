import { Text, View } from "@tarojs/components";
import { useLoad } from "@tarojs/taro";
import { useState } from "react";
import type { ArtistDto } from "@event-arts/shared";
import { request } from "../../services/api";

export default function ArtistDetail() {
  const [item, setItem] = useState<ArtistDto | null>(null);
  useLoad((query) => {
    void request<ArtistDto>(`/api/client/artists/${query.id}`).then(setItem);
  });
  return (
    <View className="page">
      <Text className="home-title">{item?.name || "人员详情"}</Text>
      <Text>{item?.summary || "暂无人员内容"}</Text>
      <Text>{item?.detail}</Text>
    </View>
  );
}
