import { Text, View } from "@tarojs/components";
import Taro, { useLoad } from "@tarojs/taro";
import { useState } from "react";
import type { AnnouncementDto } from "@event-arts/shared";
import { request } from "../../services/api";

export default function AnnouncementDetail() {
  const [item, setItem] = useState<AnnouncementDto | null>(null);
  useLoad((query) => {
    void request<AnnouncementDto>(`/api/client/announcements/${query.id}`).then(setItem);
  });
  return (
    <View className="page">
      <Text className="home-title">{item?.summary || "公告详情"}</Text>
      <Text>{item?.content || "暂无公告内容"}</Text>
      <Text className="primary-button" onClick={() => Taro.navigateBack()}>
        返回
      </Text>
    </View>
  );
}
