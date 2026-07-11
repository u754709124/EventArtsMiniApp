import { View } from "@tarojs/components";
import { useLoad } from "@tarojs/taro";
import type { DetailPageConfigDto } from "@event-arts/shared";
import { resolveDetailPagePresentation } from "@event-arts/shared/detail-page-presentation";
import { DetailRouteView } from "../../components/detail-page/DetailRouteView";
import { useDetailResource } from "../../components/detail-page/useDetailResource";
import type { DetailHeroViewModel } from "../../components/detail-page/types";
import "./index.scss";

type StandaloneDetailPageData = {
  id: number;
  status: "enabled";
  detailPage: DetailPageConfigDto;
};

function normalizeDetailPage(data: unknown): StandaloneDetailPageData {
  const detailPage = data as DetailPageConfigDto;
  return {
    id: detailPage.id,
    status: "enabled",
    detailPage
  };
}

function buildStandaloneHero(data: StandaloneDetailPageData): DetailHeroViewModel {
  return resolveDetailPagePresentation(data.detailPage).hero;
}

export default function DetailPage() {
  const resource = useDetailResource<StandaloneDetailPageData>({
    buildUrl: (id) => `/api/client/detail-pages/${id}`,
    buildPagePath: (id) => `/pages/detail/index?id=${id}`,
    scene: "detail_page",
    normalize: normalizeDetailPage
  });
  useLoad((query) => {
    resource.load(query.id);
  });
  return (
    <View className="detail-route" data-testid="standalone-detail-page">
      <DetailRouteView
        state={resource.state}
        retry={resource.retry}
        buildHero={buildStandaloneHero}
        fallbackTabUrl="/pages/index/index"
        loadingLayout="richText"
        loadingTitle="详情"
      />
    </View>
  );
}
