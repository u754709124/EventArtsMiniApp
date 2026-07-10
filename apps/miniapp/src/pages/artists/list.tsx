import Taro, { useLoad } from "@tarojs/taro";
import { Text, View } from "@tarojs/components";
import { useState } from "react";
import type { ArtistDto } from "@event-arts/shared";
import { request } from "../../services/api";

function openArtist(id: number) {
  Taro.navigateTo({ url: `/pages/artists/detail?id=${id}` }).catch(() => undefined);
}

export default function ArtistList() {
  const [items, setItems] = useState<ArtistDto[]>([]);
  const [type, setType] = useState("");
  useLoad((query) => {
    const nextType = String(query.type || "");
    setType(nextType);
    void request<ArtistDto[]>(`/api/client/artists${nextType ? `?type=${nextType}` : ""}`).then(setItems);
  });
  return (
    <View className="page" data-testid={`artist-list-page-${type || "all"}`}>
      <Text className="home-title">人员列表 {type}</Text>
      {items.map((item) => (
        <View key={item.id} className="card artist-row" data-testid="artist-list-row" onClick={() => openArtist(item.id)}>
          <Text>{item.name}</Text>
          <Text>{item.summary}</Text>
        </View>
      ))}
      {items.length === 0 && <Text>暂无人员</Text>}
    </View>
  );
}
