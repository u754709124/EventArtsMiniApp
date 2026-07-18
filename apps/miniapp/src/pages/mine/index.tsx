import { Text, View } from "@tarojs/components";
import { useEffect, useRef, useState } from "react";
import type { ClientHomeResponse } from "@event-arts/shared";
import { MiniappPageHeader } from "../../components/MiniappPageHeader";
import { ErrorState, LoadingState, PullDownRefreshIndicator } from "../../components/PageState";
import { getHome, trackPageView } from "../../services/api";
import { usePullDownRefreshState } from "../../utils/pull-down-refresh";
import "./index.scss";

export default function MinePage() {
  const [site, setSite] = useState<ClientHomeResponse["site"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const requestToken = useRef(0);

  async function load(background = false) {
    const token = requestToken.current + 1;
    requestToken.current = token;
    if (!background) {
      setLoading(true);
      setFailed(false);
    }
    try {
      const home = await getHome();
      if (requestToken.current !== token) return;
      setSite(home.site);
      setFailed(false);
      trackPageView("/pages/mine/index", "mine").catch(() => undefined);
    } catch (error) {
      if (requestToken.current !== token) return;
      if (background) throw error;
      setFailed(true);
    } finally {
      if (requestToken.current === token) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const refreshing = usePullDownRefreshState(() => load(true));

  if (loading) return <LoadingState />;
  if (failed || !site) return <ErrorState />;

  return (
    <View className="page mine-page" data-testid="mine-page">
      {refreshing && <PullDownRefreshIndicator />}
      <MiniappPageHeader title="我的" />
      <View className="mine-welcome" data-testid="mine-welcome">
        <View className="mine-welcome__copy">
          <Text className="mine-welcome__eyebrow">欢迎使用</Text>
          <Text className="mine-welcome__name" data-testid="mine-app-name">
            {site.appName}
          </Text>
          <Text className="mine-welcome__subtitle" data-testid="mine-subtitle">
            {site.subtitle}
          </Text>
        </View>

        <View className="mine-stage" aria-hidden>
          <View className="mine-stage__curtain mine-stage__curtain--outer" />
          <View className="mine-stage__curtain mine-stage__curtain--middle" />
          <View className="mine-stage__curtain mine-stage__curtain--inner" />
          <View className="mine-stage__spotlight mine-stage__spotlight--left" />
          <View className="mine-stage__spotlight mine-stage__spotlight--right" />
          <View className="mine-stage__platform mine-stage__platform--back" />
          <View className="mine-stage__platform mine-stage__platform--front" />
          <Text className="mine-stage__note mine-stage__note--large">♪</Text>
          <Text className="mine-stage__note mine-stage__note--small">♪</Text>
          <View className="mine-stage__spark mine-stage__spark--one" />
          <View className="mine-stage__spark mine-stage__spark--two" />
          <View className="mine-stage__spark mine-stage__spark--three" />
        </View>
      </View>

      <View className="mine-message" data-testid="mine-message">
        <View className="mine-dot-field mine-dot-field--left" aria-hidden />
        <View className="mine-dot-field mine-dot-field--right" aria-hidden />
        <Text>让每一次相聚，都有专业表达</Text>
        <View className="mine-message__ornament" aria-hidden>
          <View />
          <Text>·</Text>
          <View />
        </View>
      </View>
    </View>
  );
}
