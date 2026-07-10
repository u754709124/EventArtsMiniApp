import Taro from "@tarojs/taro";
import { Swiper, SwiperItem, Text, View } from "@tarojs/components";
import { useEffect, useMemo, useState } from "react";
import type { AnnouncementDto, BannerDto, ClientHomeResponse, MenuItemDto } from "@event-arts/shared";
import { generatedAssets } from "../../assets";
import { AppImage } from "../../components/AppImage";
import { ErrorState, LoadingState } from "../../components/PageState";
import { getHome, trackPageView } from "../../services/api";
import "./index.scss";

const menuRoutes: Record<string, string> = {
  host: "/pages/artists/list?type=host",
  singer: "/pages/artists/list?type=singer",
  actor: "/pages/artists/list?type=actor",
  activity_case: "/pages/cases/list",
  contact: "/pages/contact/index"
};

function ignoreNavigationError(result: Promise<unknown> | void) {
  if (result && typeof result.catch === "function") {
    result.catch(() => undefined);
  }
}

function openMenu(type: string) {
  const url = menuRoutes[type];
  if (!url) return;
  if (type === "activity_case") {
    ignoreNavigationError(Taro.switchTab({ url }));
    return;
  }
  ignoreNavigationError(Taro.navigateTo({ url }));
}

function useSafeTop() {
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

function AnnouncementBar({ announcements }: { announcements: AnnouncementDto[] }) {
  const [index, setIndex] = useState(0);
  const current = announcements[index];

  useEffect(() => {
    if (announcements.length <= 1) return;
    const duration = current?.displayDurationMs || 3000;
    const timer = setTimeout(() => setIndex((value) => (value + 1) % announcements.length), duration);
    return () => clearTimeout(timer);
  }, [announcements.length, current?.displayDurationMs]);

  if (!current) return null;
  return (
    <View
      className={`notice card ${announcements.length > 1 ? "notice--flip" : ""}`}
      data-testid="home-announcement"
      onClick={() => ignoreNavigationError(Taro.navigateTo({ url: `/pages/announcement/detail?id=${current.id}` }))}
    >
      <Text className="notice__icon">▶</Text>
      <Text className="notice__summary">{current.summary}</Text>
      <Text className="notice__content">{current.content}</Text>
      <Text className="notice__arrow">›</Text>
    </View>
  );
}

function BannerSection({ banners, site }: { banners: BannerDto[]; site: ClientHomeResponse["site"] }) {
  const [current, setCurrent] = useState(0);
  const list = banners.length
    ? banners
    : [
        {
          id: 0,
          title: "默认 Banner",
          imageUrl: site.defaultBannerUrl || generatedAssets.bannerDefault,
          linkType: "none",
          linkTarget: null,
          switchDurationMs: 3500,
          sortOrder: 0,
          status: "enabled"
        } as BannerDto
      ];

  function open(banner: BannerDto) {
    if (banner.linkType === "announcement" && banner.linkTarget) {
      ignoreNavigationError(Taro.navigateTo({ url: `/pages/announcement/detail?id=${banner.linkTarget}` }));
    }
    if (banner.linkType === "case" && banner.linkTarget) {
      ignoreNavigationError(Taro.navigateTo({ url: `/pages/cases/detail?id=${banner.linkTarget}` }));
    }
    if (banner.linkType === "internal" && banner.linkTarget) {
      ignoreNavigationError(Taro.navigateTo({ url: banner.linkTarget }));
    }
  }

  return (
    <View className="banner-wrap">
      <Swiper
        className="banner"
        indicatorDots
        autoplay={list.length > 1}
        interval={list[0]?.switchDurationMs || 3500}
        circular
        data-testid="home-banner"
        onChange={(event) => setCurrent(Number(event.detail.current || 0))}
      >
        {list.map((banner) => (
          <SwiperItem key={banner.id} onClick={() => open(banner)}>
            <AppImage
              className="banner__image"
              testid="home-banner-image"
              src={banner.imageUrl}
              fallback={site.placeholderBannerUrl || generatedAssets.placeholderBanner}
            />
          </SwiperItem>
        ))}
      </Swiper>
      <View className="banner-dots" data-testid="home-banner-dots">
        {list.map((banner, index) => (
          <Text key={banner.id} className={`banner-dot ${index === current ? "banner-dot--active" : ""}`}>
            •
          </Text>
        ))}
      </View>
    </View>
  );
}

function MenuSection({ menus, site }: { menus: MenuItemDto[]; site: ClientHomeResponse["site"] }) {
  return (
    <View className="menu-card card" data-testid="home-menu">
      {menus.length === 0 ? (
        <Text className="menu-empty">暂无菜单</Text>
      ) : (
        menus.map((menu) => (
          <View
            key={menu.id}
            className="menu-item"
            data-testid={`home-menu-${menu.type}`}
            onClick={() => openMenu(menu.type)}
          >
            <AppImage className="menu-item__icon" src={menu.iconUrl} fallback={site.placeholderIconUrl || generatedAssets.placeholderIcon} />
            <Text>{menu.text}</Text>
          </View>
        ))
      )}
    </View>
  );
}

export default function HomePage() {
  const [data, setData] = useState<ClientHomeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const safeTop = useSafeTop();

  async function load() {
    setLoading(true);
    setFailed(false);
    try {
      const home = await getHome();
      setData(home);
      trackPageView("/pages/index/index", "home").catch(() => undefined);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (loading) return <LoadingState />;
  if (failed || !data) return <ErrorState onRetry={load} />;

  return (
    <View className="page home-page" data-testid="miniapp-home">
      <View className="home-header" style={{ paddingTop: `${safeTop}px` }}>
        <Text className="home-title" data-testid="home-app-name">
          {data.site.appName}
        </Text>
        <Text className="home-subtitle" data-testid="home-subtitle">
          {data.site.subtitle}
        </Text>
      </View>
      <AnnouncementBar announcements={data.announcements} />
      <BannerSection banners={data.banners} site={data.site} />
      <MenuSection menus={data.menus} site={data.site} />
      <View className="section-heading">
        <Text className="section-heading__title">精选案例</Text>
        <Text className="section-heading__more" onClick={() => ignoreNavigationError(Taro.switchTab({ url: "/pages/cases/list" }))}>
          更多案例 ›
        </Text>
      </View>
      {data.featuredCases.length === 0 ? (
        <View className="case-empty card">暂无精选案例</View>
      ) : (
        <View className="case-list" data-testid="home-featured-cases">
          {data.featuredCases.map((item) => (
            <View
              key={item.id}
              className="case-card"
              data-testid="home-case-card"
              onClick={() => ignoreNavigationError(Taro.navigateTo({ url: `/pages/cases/detail?id=${item.id}` }))}
            >
              <View className="case-card__image-wrap">
                <AppImage
                  className="case-card__image"
                  testid="home-case-image"
                  src={item.coverUrl}
                  fallback={data.site.placeholderCaseUrl || generatedAssets.placeholderCase}
                />
                <Text className="case-card__tag">{item.tag}</Text>
              </View>
              <View className="case-card__body">
                <Text className="case-card__title">{item.title}</Text>
                <Text className="case-card__summary">{item.summary}</Text>
                <Text className="case-card__meta">📅 {item.eventDate}</Text>
                <Text className="case-card__meta">⌖ {item.location}</Text>
                <Text className="case-card__button">查看详情 ›</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
