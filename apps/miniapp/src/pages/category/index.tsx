import { Text, View } from "@tarojs/components";
import { useEffect, useRef, useState } from "react";
import type { MenuItemDto } from "@event-arts/shared";
import { generatedAssets } from "../../assets";
import { AppImage } from "../../components/AppImage";
import { MiniappPageHeader } from "../../components/MiniappPageHeader";
import { EmptyState, LoadingState, PullDownRefreshIndicator } from "../../components/PageState";
import { getMenuItems } from "../../services/api";
import { menuSummaries, openMenu } from "../../utils/menu-navigation";
import { usePullDownRefreshState } from "../../utils/pull-down-refresh";
import { useRepeatClickGuard } from "../../utils/repeat-click-guard";
import "./index.scss";

export default function CategoryPage() {
  const [menus, setMenus] = useState<MenuItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const requestToken = useRef(0);
  const clickGuard = useRepeatClickGuard();

  async function load(background = false) {
    const token = requestToken.current + 1;
    requestToken.current = token;
    if (!background) {
      setLoading(true);
      setFailed(false);
    }
    try {
      const data = await getMenuItems();
      if (requestToken.current !== token) return;
      setMenus(data);
      setFailed(false);
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

  return (
    <View className="page" data-testid="category-page">
      {refreshing && <PullDownRefreshIndicator />}
      <MiniappPageHeader title="分类" />
      {loading ? <LoadingState /> : failed ? (
        <View className="category-state" data-testid="category-error-state">
          <Text>分类加载失败</Text>
          <Text className="primary-button" data-testid="category-reload" onClick={() => clickGuard("category:reload", load)}>重新加载</Text>
        </View>
      ) : menus.length === 0 ? (
        <EmptyState text="暂无分类" />
      ) : (
        <View className="category-artist-list">
          {menus.map((menu: MenuItemDto) => (
            <View
              key={menu.id}
              className="category-artist-entry"
              data-testid={`category-menu-${menu.id}`}
              data-menu-type={menu.type}
              onClick={() => clickGuard(`category:menu:${menu.id}`, () => openMenu(menu))}
            >
              <AppImage className="category-artist-entry__icon" src={menu.iconUrl} fallback={generatedAssets.placeholderIcon} />
              <View className="category-artist-entry__content" data-testid={`category-artist-${menu.type}`}>
                <Text className="category-artist-entry__title">{menu.text}</Text>
                <Text className="category-artist-entry__summary">{menuSummaries[menu.type]}</Text>
              </View>
              <Text className="category-artist-entry__arrow">›</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
