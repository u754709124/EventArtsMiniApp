import { View } from "@tarojs/components";
import { useLoad } from "@tarojs/taro";
import type { ActivityCaseDetailDto } from "@event-arts/shared";
import { buildCaseHero } from "../../components/detail-page/adapters";
import { DetailRouteView } from "../../components/detail-page/DetailRouteView";
import { useDetailResource } from "../../components/detail-page/useDetailResource";

export default function CaseDetail() {
  const resource = useDetailResource<ActivityCaseDetailDto>({
    buildUrl: (id) => `/api/client/cases/${id}`,
    buildPagePath: (id) => `/pages/cases/detail?id=${id}`,
    scene: "activity_case_detail"
  });
  useLoad((query) => {
    resource.load(query.id);
  });
  return (
    <View data-testid="case-detail-page">
      <DetailRouteView
        state={resource.state}
        retry={resource.retry}
        buildHero={buildCaseHero}
        fallbackTabUrl="/pages/cases/list"
        loadingLayout="richText"
        loadingTitle="案例详情"
      />
    </View>
  );
}
