import Taro from "@tarojs/taro";
import { runGuardedAction } from "./repeat-click-guard";

export function isValidDetailPageId(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

export function buildDetailPageUrl(detailPageId: number) {
  return `/pages/detail/index?id=${detailPageId}`;
}

export function navigateToDetailPage(detailPageId: number | null | undefined) {
  if (!isValidDetailPageId(detailPageId)) return;
  runGuardedAction(`detail:navigate:${detailPageId}`, () => {
    Taro.navigateTo({ url: buildDetailPageUrl(detailPageId) }).catch(() => undefined);
  });
}

export function redirectToDetailPage(detailPageId: number | null | undefined) {
  if (!isValidDetailPageId(detailPageId)) return;
  Taro.redirectTo({ url: buildDetailPageUrl(detailPageId) })
    .catch(() => {
      Taro.navigateTo({ url: buildDetailPageUrl(detailPageId) }).catch(() => undefined);
    });
}
