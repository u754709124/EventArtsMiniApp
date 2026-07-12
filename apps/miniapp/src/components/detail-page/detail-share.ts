import type { DetailPageConfigDto, DetailPageHeroPresentation } from "@event-arts/shared";
import { getDisplayDetailPageBanners } from "@event-arts/shared/detail-page-presentation";

export const detailShareFallbackPayload = {
  title: "喜缘主持",
  path: "/pages/index/index"
} as const;

export type DetailSharePayload = {
  title: string;
  path: string;
  imageUrl?: string;
};

export type DetailShareState =
  | { canShare: true; payload: DetailSharePayload }
  | { canShare: false; payload: null };

export function normalizeDetailShareId(rawId: string | number | null | undefined) {
  const id = Number(rawId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function buildDetailSharePath(id: string | number | null | undefined) {
  const normalized = normalizeDetailShareId(id);
  return normalized ? `/pages/detail/index?id=${normalized}` : null;
}

export function resolveDetailShareTitle(detailPage: DetailPageConfigDto, hero?: DetailPageHeroPresentation) {
  return (
    hero?.title?.trim() ||
    detailPage.hero.title.trim() ||
    detailPage.name.trim() ||
    detailShareFallbackPayload.title
  );
}

export function resolveDetailShareImage(detailPage: DetailPageConfigDto) {
  const [firstBanner] = getDisplayDetailPageBanners(detailPage.banners);
  const url = firstBanner?.url?.trim();
  return url || null;
}

export function buildDetailShareState({
  routeId,
  detailPage,
  hero
}: {
  routeId: string | number | null | undefined;
  detailPage: DetailPageConfigDto | null | undefined;
  hero?: DetailPageHeroPresentation;
}): DetailShareState {
  const normalizedRouteId = normalizeDetailShareId(routeId);
  if (!normalizedRouteId || !detailPage || detailPage.id !== normalizedRouteId) {
    return { canShare: false, payload: null };
  }

  const path = buildDetailSharePath(normalizedRouteId);
  if (!path) return { canShare: false, payload: null };

  const imageUrl = resolveDetailShareImage(detailPage);
  return {
    canShare: true,
    payload: {
      title: resolveDetailShareTitle(detailPage, hero),
      path,
      ...(imageUrl ? { imageUrl } : {})
    }
  };
}
