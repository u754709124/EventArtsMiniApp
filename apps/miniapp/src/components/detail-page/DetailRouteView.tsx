import { Text, View } from "@tarojs/components";
import type { DetailPageRendererKey } from "@event-arts/shared";
import { DetailNavigation } from "./DetailNavigation";
import { DetailPageRenderer } from "./DetailPageRenderer";
import { DetailPageSkeleton } from "./DetailPageSkeleton";
import { useRepeatClickGuard } from "../../utils/repeat-click-guard";
import type { DetailHeroViewModel } from "./types";
import type { DetailResourceState } from "./useDetailResource";

type DetailData = { detailPage: NonNullable<Parameters<typeof DetailPageRenderer>[0]["config"]> };

const stateCopy = {
  notFound: ["内容不存在或已停用", "请返回列表选择其他内容"],
  disabled: ["内容已停用", "当前内容暂不可访问"],
  configMissing: ["详情配置不存在", "内容正在完善中，请稍后再试"],
  unknownRenderer: ["详情页类型暂不支持", "请稍后升级后重试"],
  error: ["页面加载失败", "请检查网络后重新加载"]
} as const;

export function DetailRouteView<T extends DetailData>({
  state,
  retry,
  buildHero,
  fallbackTabUrl,
  // The renderer is unknown before the DTO arrives. A neutral card skeleton avoids
  // speculatively creating banner DOM for a route that may resolve to rich-only.
  loadingLayout = "richText",
  loadingTitle = "详情"
}: {
  state: DetailResourceState<T>;
  retry: () => void;
  buildHero: (data: T) => DetailHeroViewModel;
  fallbackTabUrl: string;
  loadingLayout?: DetailPageRendererKey;
  loadingTitle?: string;
}) {
  const clickGuard = useRepeatClickGuard();
  if (state.status === "loading") {
    return (
      <DetailPageSkeleton
        layout={loadingLayout}
        fallbackTabUrl={fallbackTabUrl}
        title={loadingTitle}
      />
    );
  }
  if (state.status === "success") {
    return (
      <DetailPageRenderer
        config={state.data.detailPage}
        hero={buildHero(state.data)}
        fallbackTabUrl={fallbackTabUrl}
      />
    );
  }
  const [title, description] = stateCopy[state.status];
  return (
    <View className="detail-page detail-page--state" data-testid={`detail-state-${state.status}`}>
      <DetailNavigation title={loadingTitle} fallbackTabUrl={fallbackTabUrl} />
      <View className="detail-state">
        <Text className="detail-state__title">{title}</Text>
        <Text className="detail-state__description">{state.message || description}</Text>
        {(state.status === "error" || state.status === "configMissing") && (
          <Text className="detail-state__button" data-testid="detail-retry" onClick={() => clickGuard("detail:retry", retry)}>
            重新加载
          </Text>
        )}
      </View>
    </View>
  );
}
