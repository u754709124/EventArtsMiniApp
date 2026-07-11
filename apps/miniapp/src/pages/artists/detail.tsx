import { View } from "@tarojs/components";
import type { ArtistDetailDto } from "@event-arts/shared";
import { LegacyDetailRedirectPage } from "../../components/detail-page/LegacyDetailRedirectPage";

export default function ArtistDetail() {
  return (
    <View data-testid="artist-detail-page">
      <LegacyDetailRedirectPage<ArtistDetailDto>
        buildUrl={(id) => `/api/client/artists/${id}`}
        fallbackTabUrl="/pages/category/index"
        loadingTitle="人员详情"
        testid="artist-detail-legacy-state"
      />
    </View>
  );
}
