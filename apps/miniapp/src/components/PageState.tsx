import { Text, View } from "@tarojs/components";

export function LoadingState() {
  return (
    <View className="loading-state" data-testid="miniapp-loading">
      <Text>加载中...</Text>
    </View>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <View className="empty" data-testid="miniapp-empty">
      <Text>{text}</Text>
    </View>
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <View className="error-state" data-testid="home-error-state">
      <Text>页面加载失败</Text>
      <Text>请稍后重试</Text>
      <Text className="primary-button" data-testid="home-reload" onClick={onRetry}>
        重新加载
      </Text>
    </View>
  );
}
