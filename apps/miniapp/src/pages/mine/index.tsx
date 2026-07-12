import { Text, View } from "@tarojs/components";
import { MiniappPageHeader } from "../../components/MiniappPageHeader";

export default function MinePage() {
  return (
    <View className="page" data-testid="mine-page">
      <MiniappPageHeader title="我的" />
      <Text>欢迎使用喜缘主持・演艺服务。</Text>
    </View>
  );
}
