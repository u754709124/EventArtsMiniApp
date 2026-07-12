import Taro from "@tarojs/taro";
import { Text, View } from "@tarojs/components";
import { useMemo } from "react";
import { useRepeatClickGuard } from "../../utils/repeat-click-guard";

type NavigationMetrics = { safeTop: number; headerHeight: number };

export function getDetailNavigationMetrics(): NavigationMetrics {
  const fallback = { safeTop: 20, headerHeight: 44 };
  if (Taro.getEnv() === Taro.ENV_TYPE.WEB) return fallback;
  try {
    const system = Taro.getSystemInfoSync();
    const safeTop = Number(system.statusBarHeight || fallback.safeTop);
    const capsule = Taro.getMenuButtonBoundingClientRect?.();
    if (capsule?.top && capsule?.bottom && capsule?.height) {
      const verticalGap = Math.max(capsule.top - safeTop, 0);
      return { safeTop, headerHeight: Math.max(capsule.height + verticalGap * 2, 44) };
    }
    return { safeTop, headerHeight: fallback.headerHeight };
  } catch {
    return fallback;
  }
}

function switchToFallback(url: string) {
  try {
    const result = Taro.switchTab({ url });
    if (result && typeof result.catch === "function") void result.catch(() => undefined);
  } catch {
    // There is no further safe navigation fallback in a non-Taro test runtime.
  }
}

export function navigateBackOrSwitchTab(fallbackTabUrl: string) {
  try {
    if (Taro.getCurrentPages().length <= 1) {
      switchToFallback(fallbackTabUrl);
      return;
    }
    const result = Taro.navigateBack({ delta: 1 });
    if (result && typeof result.catch === "function")
      void result.catch(() => switchToFallback(fallbackTabUrl));
  } catch {
    switchToFallback(fallbackTabUrl);
  }
}

export function DetailNavigation({
  title,
  fallbackTabUrl,
  overlay = false
}: {
  title: string;
  fallbackTabUrl: string;
  overlay?: boolean;
}) {
  const metrics = useMemo(getDetailNavigationMetrics, []);
  const clickGuard = useRepeatClickGuard();
  return (
    <View
      className={`detail-navigation ${overlay ? "detail-navigation--overlay" : ""}`}
      style={{ paddingTop: `${metrics.safeTop}px` }}
      data-testid="detail-navigation"
    >
      <View className="detail-navigation__bar" style={{ height: `${metrics.headerHeight}px` }}>
        <View
          aria-label="返回"
          className="detail-navigation__back"
          data-testid="detail-back-button"
          onClick={() => clickGuard(`detail:back:${fallbackTabUrl}`, () => navigateBackOrSwitchTab(fallbackTabUrl))}
        >
          <View className="detail-navigation__back-icon" aria-hidden />
        </View>
        <Text className="detail-navigation__title">{title}</Text>
      </View>
    </View>
  );
}
