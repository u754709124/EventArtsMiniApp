import Taro from "@tarojs/taro";
import { Text, View } from "@tarojs/components";
import { useMemo } from "react";

function useTitleSafeTop() {
  return useMemo(() => {
    if (Taro.getEnv() === Taro.ENV_TYPE.WEB) return 36;
    try {
      const rect = Taro.getMenuButtonBoundingClientRect?.();
      if (rect?.top) return rect.top + 12;
    } catch {
      return 52;
    }
    return 52;
  }, []);
}

export function MiniappPageHeader({
  title,
  subtitle,
  titleTestId,
  subtitleTestId
}: {
  title: string;
  subtitle?: string;
  titleTestId?: string;
  subtitleTestId?: string;
}) {
  const safeTop = useTitleSafeTop();
  return (
    <View className="miniapp-page-header" style={{ paddingTop: `${safeTop}px` }}>
      <Text className="home-title" data-testid={titleTestId}>
        {title}
      </Text>
      {subtitle && (
        <Text className="home-subtitle" data-testid={subtitleTestId}>
          {subtitle}
        </Text>
      )}
    </View>
  );
}
