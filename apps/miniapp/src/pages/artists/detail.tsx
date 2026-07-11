import { View } from "@tarojs/components";
import { useLoad } from "@tarojs/taro";
import type { ArtistDetailDto } from "@event-arts/shared";
import { buildArtistHero } from "../../components/detail-page/adapters";
import { DetailRouteView } from "../../components/detail-page/DetailRouteView";
import { useDetailResource } from "../../components/detail-page/useDetailResource";

export default function ArtistDetail() {
  const resource = useDetailResource<ArtistDetailDto>({
    buildUrl: (id) => `/api/client/artists/${id}`,
    buildPagePath: (id) => `/pages/artists/detail?id=${id}`,
    scene: "artist_detail"
  });
  useLoad((query) => {
    resource.load(query.id);
  });
  return (
    <View data-testid="artist-detail-page">
      <DetailRouteView
        state={resource.state}
        retry={resource.retry}
        buildHero={buildArtistHero}
        fallbackTabUrl="/pages/category/index"
        loadingLayout="richText"
        loadingTitle="人员详情"
      />
    </View>
  );
}
