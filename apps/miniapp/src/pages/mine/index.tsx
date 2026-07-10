import { Text, View } from "@tarojs/components";

export default function MinePage() {
  return (
    <View className="page" data-testid="mine-page">
      <Text className="home-title">我的</Text>
      <Text>欢迎使用喜缘主持・演艺服务。</Text>
    </View>
  );
}
