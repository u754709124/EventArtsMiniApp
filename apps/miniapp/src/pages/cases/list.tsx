import Taro from "@tarojs/taro";
import { Text, View } from "@tarojs/components";
import { useEffect, useState } from "react";
import type { ActivityCaseDto } from "@event-arts/shared";
import { generatedAssets } from "../../assets";
import { AppImage } from "../../components/AppImage";
import { EmptyState } from "../../components/PageState";
import { request } from "../../services/api";

function openCase(id: number) {
  Taro.navigateTo({ url: `/pages/cases/detail?id=${id}` }).catch(() => undefined);
}

export default function CaseList() {
  const [items, setItems] = useState<ActivityCaseDto[]>([]);
  useEffect(() => {
    void request<ActivityCaseDto[]>("/api/client/cases").then(setItems);
  }, []);
  return (
    <View className="page" data-testid="case-list-page">
      <Text className="home-title">活动案例</Text>
      {items.length === 0 ? (
        <EmptyState text="暂无案例" />
      ) : (
        items.map((item) => (
          <View
            key={item.id}
            className="case-card card"
            data-testid="case-list-card"
            onClick={() => openCase(item.id)}
          >
            <AppImage className="case-card__image" testid="case-list-image" src={item.coverUrl} fallback={generatedAssets.placeholderCase} />
            <Text className="case-card__title">{item.title}</Text>
            <Text>{item.summary}</Text>
          </View>
        ))
      )}
    </View>
  );
}
