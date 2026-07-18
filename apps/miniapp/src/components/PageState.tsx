import { Text, View } from "@tarojs/components";

export function LoadingState() {
  return (
    <View className="loading-state" data-testid="miniapp-loading">
      <Text>加载中...</Text>
    </View>
  );
}

export function PullDownRefreshIndicator() {
  return (
    <View className="pull-down-refresh-loading" data-testid="pull-down-refresh-loading" role="status" aria-label="正在刷新">
      <View className="pull-down-refresh-loading__spinner" aria-hidden />
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

export function ErrorState() {
  return (
    <View className="error-state" data-testid="home-error-state">
      <Text>页面加载失败</Text>
      <Text>请下拉刷新重试</Text>
    </View>
  );
}
