import { View } from "@tarojs/components";
import type { ActivityCaseDetailDto } from "@event-arts/shared";
import { LegacyDetailRedirectPage } from "../../components/detail-page/LegacyDetailRedirectPage";

export default function CaseDetail() {
  return (
    <View data-testid="case-detail-page">
      <LegacyDetailRedirectPage<ActivityCaseDetailDto>
        buildUrl={(id) => `/api/client/cases/${id}`}
        fallbackTabUrl="/pages/cases/list"
        loadingTitle="案例详情"
        testid="case-detail-legacy-state"
      />
    </View>
  );
}
