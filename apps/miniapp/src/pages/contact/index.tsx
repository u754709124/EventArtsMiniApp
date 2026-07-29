import { Text, View } from "@tarojs/components";
import { useLoad } from "@tarojs/taro";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MenuItemDto } from "@event-arts/shared";
import { MiniappPageHeader } from "../../components/MiniappPageHeader";
import { LoadingState, PullDownRefreshIndicator } from "../../components/PageState";
import { getMenuItems } from "../../services/api";
import { usePullDownRefreshState } from "../../utils/pull-down-refresh";
import "./index.scss";

type ContactConfig = {
  phone?: string;
  address?: string;
  wechat?: string;
  description?: string;
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function contactConfig(menu: MenuItemDto | null): Required<ContactConfig> {
  const config = menu?.configJson && typeof menu.configJson === "object"
    ? menu.configJson as ContactConfig
    : {};
  return {
    phone: cleanText(config.phone),
    address: cleanText(config.address),
    wechat: cleanText(config.wechat),
    description: cleanText(config.description)
  };
}

function chooseContactMenu(menus: readonly MenuItemDto[], requestedMenuId: number | null) {
  const contacts = menus.filter((menu) => menu.type === "contact" && menu.status === "enabled");
  if (requestedMenuId) return contacts.find((menu) => menu.id === requestedMenuId) ?? null;
  return contacts[0] ?? null;
}

export default function ContactPage() {
  const requestedMenuId = useRef<number | null>(null);
  const requestToken = useRef(0);
  const [menus, setMenus] = useState<MenuItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const selectedMenu = useMemo(() => chooseContactMenu(menus, requestedMenuId.current), [menus]);
  const config = useMemo(() => contactConfig(selectedMenu), [selectedMenu]);
  const rows = [
    { key: "phone", label: "电话", value: config.phone },
    { key: "address", label: "地址", value: config.address },
    { key: "wechat", label: "微信号", value: config.wechat }
  ].filter((row) => row.value);
  const hasContent = rows.length > 0 || Boolean(config.description);

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

  useLoad((query) => {
    const menuId = Number(query.menuId);
    requestedMenuId.current = Number.isInteger(menuId) && menuId > 0 ? menuId : null;
    void load();
  });

  useEffect(() => {
    if (requestToken.current === 0) void load();
  }, []);

  const refreshing = usePullDownRefreshState(() => load(true));

  return (
    <View className="page contact-page" data-testid="contact-page">
      {refreshing && <PullDownRefreshIndicator />}
      <MiniappPageHeader title="联系我们" />
      {loading ? (
        <LoadingState />
      ) : failed ? (
        <View className="contact-state" data-testid="contact-error-state">
          <Text>联系方式加载失败</Text>
          <Text>请下拉刷新重试</Text>
        </View>
      ) : !hasContent ? (
        <View
          className="contact-empty"
          data-testid="contact-empty-state"
          role="status"
          aria-label="联系方式待补充"
        >
          <Text>联系方式待补充</Text>
        </View>
      ) : (
        <View className="contact-card" data-testid="contact-content">
          {config.description && <Text className="contact-description">{config.description}</Text>}
          {rows.map((row) => (
            <View className="contact-row" key={row.key} data-testid={`contact-${row.key}`}>
              <Text className="contact-row__label">{row.label}</Text>
              <Text className="contact-row__value">{row.value}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
