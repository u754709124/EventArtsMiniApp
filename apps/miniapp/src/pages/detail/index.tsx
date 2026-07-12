import { View } from "@tarojs/components";
import Taro, { useLoad, useShareAppMessage } from "@tarojs/taro";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DetailPageConfigDto } from "@event-arts/shared";
import { resolveDetailPagePresentation } from "@event-arts/shared/detail-page-presentation";
import {
  buildDetailShareState,
  detailShareFallbackPayload,
  type DetailSharePayload
} from "../../components/detail-page/detail-share";
import { isWeappShareEnvironment } from "../../components/detail-page/detail-share-platform";
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
  const [routeId, setRouteId] = useState<number | null>(null);
  const resource = useDetailResource<StandaloneDetailPageData>({
    buildUrl: (id) => `/api/client/detail-pages/${id}`,
    buildPagePath: (id) => `/pages/detail/index?id=${id}`,
    scene: "detail_page",
    normalize: normalizeDetailPage
  });
  const share = useMemo(() => {
    if (resource.state.status !== "success") {
      return { canShare: false, payload: null } as const;
    }
    const hero = buildStandaloneHero(resource.state.data);
    return buildDetailShareState({
      routeId,
      detailPage: resource.state.data.detailPage,
      hero
    });
  }, [resource.state, routeId]);
  const sharePayloadRef = useRef<DetailSharePayload | null>(null);

  sharePayloadRef.current = share.canShare ? share.payload : null;

  useShareAppMessage(() => sharePayloadRef.current || detailShareFallbackPayload);

  useEffect(() => {
    if (!isWeappShareEnvironment()) return;
    try {
      if (share.canShare) {
        Taro.showShareMenu?.({ menus: ["shareAppMessage"] });
      } else {
        Taro.hideShareMenu?.();
      }
    } catch {
      // Share menu visibility is a platform enhancement; the button remains state-gated.
    }
  }, [share.canShare]);

  useLoad((query) => {
    const id = Number(query.id);
    setRouteId(Number.isInteger(id) && id > 0 ? id : null);
    resource.load(query.id);
  });
  return (
    <View className="detail-route" data-testid="standalone-detail-page">
      <DetailRouteView
        state={resource.state}
        retry={resource.retry}
        buildHero={buildStandaloneHero}
        fallbackTabUrl="/pages/index/index"
        share={share}
        loadingLayout="richText"
        loadingTitle="详情"
      />
    </View>
  );
}
