import { Text, View } from "@tarojs/components";
import { useLoad } from "@tarojs/taro";
import { useState } from "react";
import type { ActivityCaseDetailDto } from "@event-arts/shared";
import { generatedAssets } from "../../assets";
import { AppImage } from "../../components/AppImage";
import { request } from "../../services/api";

export default function CaseDetail() {
  const [item, setItem] = useState<ActivityCaseDetailDto | null>(null);
  useLoad((query) => {
    void request<ActivityCaseDetailDto>(`/api/client/cases/${query.id}`).then(setItem);
  });
  return (
    <View className="page" data-testid="case-detail-page">
      <Text className="home-title">{item?.title || "案例详情"}</Text>
      {item && <AppImage className="banner__image" testid="case-detail-image" src={item.coverUrl} fallback={generatedAssets.placeholderCase} />}
      <Text>{item?.summary || "暂无案例内容"}</Text>
      <Text>{item?.detail}</Text>
    </View>
  );
}
