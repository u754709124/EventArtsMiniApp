import { Text, View } from "@tarojs/components";
import { useEffect, useState } from "react";
import type { ActivityCaseListItemDto } from "@event-arts/shared";
import { generatedAssets } from "../../assets";
import { AppImage } from "../../components/AppImage";
import { EmptyState } from "../../components/PageState";
import { request } from "../../services/api";
import { navigateToDetailPage } from "../../utils/detail-page-navigation";
import "./list.scss";

export default function CaseList() {
  const [items, setItems] = useState<ActivityCaseListItemDto[]>([]);
  useEffect(() => {
    void request<ActivityCaseListItemDto[]>("/api/client/cases").then(setItems);
  }, []);
  return (
    <View className="page" data-testid="case-list-page">
      <Text className="home-title">活动案例</Text>
      {items.length === 0 ? (
        <EmptyState text="暂无案例" />
      ) : (
        items.map((item) => {
          const clickable = Boolean(item.detailPageId);
          return (
            <View
              key={item.id}
              className={`case-card card ${clickable ? "case-card--clickable" : "case-card--static"}`}
              data-testid="case-list-card"
              onClick={clickable ? () => navigateToDetailPage(item.detailPageId) : undefined}
            >
              <AppImage className="case-card__image" testid="case-list-image" src={item.coverUrl} fallback={generatedAssets.placeholderCase} />
              <Text className="case-card__title">{item.title}</Text>
              <Text>{item.summary}</Text>
            </View>
          );
        })
      )}
    </View>
  );
}
