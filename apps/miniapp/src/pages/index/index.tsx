import Taro from "@tarojs/taro";
import { Image, Swiper, SwiperItem, Text, View } from "@tarojs/components";
import type { ITouchEvent } from "@tarojs/components/types";
import { useEffect, useRef, useState } from "react";
import type { AnnouncementDto, BannerDto, ClientHomeResponse, MenuItemDto } from "@event-arts/shared";
import { generatedAssets } from "../../assets";
import { AppImage } from "../../components/AppImage";
import { ArticleCard } from "../../components/ArticleCard";
import { CaseCard } from "../../components/CaseCard";
import { MiniappPageHeader } from "../../components/MiniappPageHeader";
import { ErrorState, LoadingState, PullDownRefreshIndicator } from "../../components/PageState";
import { getHome, trackPageView } from "../../services/api";
import { navigateToDetailPage } from "../../utils/detail-page-navigation";
import { openMenu } from "../../utils/menu-navigation";
import { usePullDownRefreshState } from "../../utils/pull-down-refresh";
import { useRepeatClickGuard } from "../../utils/repeat-click-guard";
import { getNoticeDisplayTiming, getNoticeMarqueeStartPauseMs } from "./announcement-timing";
import "./index.scss";

const swipeThreshold = 8;
const noticeMeasureDelayMs = 80;

type NoticeMarqueeState = {
  announcementId: number;
  distancePx: number;
  phase: "measuring" | "ready" | "scrolling";
  runId: number;
  scrollDurationMs: number;
  totalDurationMs: number;
};

function useSwipeClickGuard() {
  const start = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);

  function onTouchStart(event: ITouchEvent) {
    const touch = event.touches[0];
    start.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    suppressClick.current = false;
  }

  function onTouchMove(event: ITouchEvent) {
    const touch = event.touches[0];
    if (!touch || !start.current) return;
    const deltaX = Math.abs(touch.clientX - start.current.x);
    const deltaY = Math.abs(touch.clientY - start.current.y);
    if (deltaX > swipeThreshold && deltaX > deltaY) suppressClick.current = true;
  }

  function onTouchEnd() {
    start.current = null;
  }

  function allowClick() {
    if (!suppressClick.current) return true;
    suppressClick.current = false;
    return false;
  }

  return { allowClick, onTouchEnd, onTouchMove, onTouchStart };
}

function getBrowserNodeWidth(selector: string, includeScrollWidth: boolean) {
  if (typeof document === "undefined") return 0;
  const node = document.querySelector(selector) as HTMLElement | null;
  if (!node) return 0;
  const rectWidth = node.getBoundingClientRect().width;
  return includeScrollWidth ? Math.max(rectWidth, node.scrollWidth) : rectWidth;
}

function getNoticeNodeWidth(selector: string, includeScrollWidth = false): Promise<number> {
  return new Promise((resolve) => {
    const browserWidth = Taro.getEnv() === Taro.ENV_TYPE.WEB ? getBrowserNodeWidth(selector, includeScrollWidth) : 0;
    if (browserWidth > 0) {
      resolve(browserWidth);
      return;
    }
    try {
      const query = Taro.createSelectorQuery();
      query.select(selector).boundingClientRect();
      query.exec((rects) => {
        const rect = Array.isArray(rects) ? rects[0] : null;
        const rectWidth = typeof rect?.width === "number" ? rect.width : 0;
        resolve(rectWidth || getBrowserNodeWidth(selector, includeScrollWidth));
      });
    } catch {
      resolve(getBrowserNodeWidth(selector, includeScrollWidth));
    }
  });
}

function getNoticeTrackStyle(announcementId: number, marquee: NoticeMarqueeState | null) {
  if (!marquee || marquee.announcementId !== announcementId || marquee.distancePx <= 0) {
    return "transform: translate3d(0, 0, 0); transition: none;";
  }

  if (marquee.phase !== "scrolling") {
    return "transform: translate3d(0, 0, 0); transition: none;";
  }

  return `transform: translate3d(-${marquee.distancePx}px, 0, 0); transition: transform ${marquee.scrollDurationMs}ms linear;`;
}

function AnnouncementBar({ announcements }: { announcements: AnnouncementDto[] }) {
  const [current, setCurrent] = useState(0);
  const [marquee, setMarquee] = useState<NoticeMarqueeState | null>(null);
  const marqueeRunId = useRef(0);
  const swipeGuard = useSwipeClickGuard();
  const clickGuard = useRepeatClickGuard();
  const multiple = announcements.length > 1;
  const currentAnnouncement = announcements[current] ?? announcements[0];
  const marqueeReady = Boolean(marquee && marquee.phase !== "measuring");
  const currentAnnouncementKey = currentAnnouncement
    ? [
        currentAnnouncement.id,
        currentAnnouncement.summary,
        currentAnnouncement.content,
        currentAnnouncement.detailPageId ?? "",
        currentAnnouncement.displayDurationMs ?? ""
      ].join("|")
    : "";

  useEffect(() => {
    if (current < announcements.length) return;
    setCurrent(0);
  }, [announcements.length, current]);

  useEffect(() => {
    if (!currentAnnouncement) {
      setMarquee(null);
      return undefined;
    }

    let cancelled = false;
    let startTimer: ReturnType<typeof setTimeout> | undefined;
    const runId = marqueeRunId.current + 1;
    marqueeRunId.current = runId;
    const baseTiming = getNoticeDisplayTiming(currentAnnouncement.displayDurationMs, 0);
    setMarquee({
      announcementId: currentAnnouncement.id,
      distancePx: 0,
      phase: "measuring",
      runId,
      scrollDurationMs: 0,
      totalDurationMs: baseTiming.totalDurationMs
    });

    const measureTimer = setTimeout(() => {
      void Promise.all([
        getNoticeNodeWidth(`#noticeContentViewport-${current}`),
        getNoticeNodeWidth(`#noticeContentItem-${current}`, true)
      ]).then(([viewportWidth, contentWidth]) => {
        if (cancelled) return;

        const timing = getNoticeDisplayTiming(currentAnnouncement.displayDurationMs, contentWidth - viewportWidth);
        setMarquee({
          announcementId: currentAnnouncement.id,
          distancePx: timing.distancePx,
          phase: "ready",
          runId,
          scrollDurationMs: timing.scrollDurationMs,
          totalDurationMs: timing.totalDurationMs
        });

        if (timing.shouldScroll) {
          startTimer = setTimeout(() => {
            if (cancelled) return;
            setMarquee((state) => (
              state?.runId === runId
                ? { ...state, phase: "scrolling" }
                : state
            ));
          }, getNoticeMarqueeStartPauseMs());
        }
      });
    }, noticeMeasureDelayMs);

    return () => {
      cancelled = true;
      clearTimeout(measureTimer);
      if (startTimer) clearTimeout(startTimer);
    };
  }, [current, currentAnnouncementKey]);

  useEffect(() => {
    if (!multiple || !currentAnnouncement || !marqueeReady || marquee?.announcementId !== currentAnnouncement.id) {
      return undefined;
    }

    const switchTimer = setTimeout(() => {
      setCurrent((value) => (value + 1) % announcements.length);
    }, marquee.totalDurationMs);

    return () => clearTimeout(switchTimer);
  }, [
    announcements.length,
    currentAnnouncement?.id,
    marquee?.announcementId,
    marquee?.runId,
    marquee?.totalDurationMs,
    marqueeReady,
    multiple
  ]);

  if (!currentAnnouncement) return null;
  return (
    <View className="notice card" data-testid="home-announcement" data-current-index={current}>
      <Swiper
        className="notice__swiper"
        current={current}
        autoplay={false}
        circular={multiple}
        disableTouch={false}
        duration={280}
        onChange={(event) => setCurrent(Number(event.detail.current || 0))}
      >
        {announcements.map((announcement, index) => {
          const clickable = Boolean(announcement.detailPageId);
          return (
            <SwiperItem key={announcement.id}>
              <View
                className={`notice__slide ${clickable ? "notice__slide--clickable" : "notice__slide--static"}`}
                onTouchStart={swipeGuard.onTouchStart}
                onTouchMove={swipeGuard.onTouchMove}
                onTouchEnd={swipeGuard.onTouchEnd}
                onTouchCancel={swipeGuard.onTouchEnd}
                onClick={clickable ? () => {
                  if (!swipeGuard.allowClick()) return;
                  clickGuard(`home:announcement:${announcement.id}`, () => navigateToDetailPage(announcement.detailPageId));
                } : undefined}
              >
                <Image className="notice__icon" src={generatedAssets.iconBullet} mode="aspectFit" />
                <View className="notice__summary">
                  <Text className="notice__summary-text">{announcement.summary}</Text>
                </View>
                <View className="notice__content-viewport" id={`noticeContentViewport-${index}`}>
                  <View
                    className="notice__content-track"
                    id={`noticeContentTrack-${index}`}
                    style={getNoticeTrackStyle(announcement.id, marquee)}
                  >
                    <View className="notice__content" id={`noticeContentItem-${index}`}>
                      <Text className="notice__content-text">{announcement.content}</Text>
                    </View>
                  </View>
                </View>
                {clickable && <Text className="notice__arrow">›</Text>}
              </View>
            </SwiperItem>
          );
        })}
      </Swiper>
    </View>
  );
}

function BannerSection({ banners, site }: { banners: BannerDto[]; site: ClientHomeResponse["site"] }) {
  const [current, setCurrent] = useState(0);
  const swipeGuard = useSwipeClickGuard();
  const clickGuard = useRepeatClickGuard();
  const list = banners.length
    ? banners
    : [
        {
          id: 0,
          title: "Banner 占位图",
          imageUrl: site.placeholderBannerUrl || generatedAssets.placeholderBanner,
          linkType: "none",
          linkTarget: null,
          detailPageId: null,
          hasDetailPage: false,
          switchDurationMs: 3500,
          sortOrder: 0,
          status: "enabled"
        } as BannerDto
      ];
  const multiple = list.length > 1;
  const currentBanner = list[current] ?? list[0];

  return (
    <View className="banner-wrap" data-testid="home-banner-state" data-current-index={current}>
      <Swiper
        className="banner"
        current={current}
        indicatorDots
        indicatorColor="rgba(255, 255, 255, 0.7)"
        indicatorActiveColor="#ffffff"
        autoplay={multiple}
        interval={currentBanner?.switchDurationMs || 3500}
        circular={multiple}
        disableTouch={false}
        duration={280}
        data-testid="home-banner"
        data-current-index={current}
        onChange={(event) => setCurrent(Number(event.detail.current || 0))}
      >
        {list.map((banner) => {
          const clickable = Boolean(banner.detailPageId);
          return (
            <SwiperItem key={banner.id}>
              <View
                className={`banner__slide ${clickable ? "banner__slide--clickable" : "banner__slide--static"}`}
                onTouchStart={swipeGuard.onTouchStart}
                onTouchMove={swipeGuard.onTouchMove}
                onTouchEnd={swipeGuard.onTouchEnd}
                onTouchCancel={swipeGuard.onTouchEnd}
                onClick={clickable ? () => {
                  if (swipeGuard.allowClick()) clickGuard(`home:banner:${banner.id}`, () => navigateToDetailPage(banner.detailPageId));
                } : undefined}
              >
                <AppImage
                  className="banner__image"
                  testid="home-banner-image"
                  src={banner.imageUrl}
                  fallback={site.placeholderBannerUrl || generatedAssets.placeholderBanner}
                />
              </View>
            </SwiperItem>
          );
        })}
      </Swiper>
    </View>
  );
}

function MenuSection({ menus, site }: { menus: MenuItemDto[]; site: ClientHomeResponse["site"] }) {
  const clickGuard = useRepeatClickGuard();
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
            onClick={() => clickGuard(`home:menu:${menu.id}`, () => openMenu(menu))}
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
      const home = await getHome();
      if (requestToken.current !== token) return;
      setData(home);
      setFailed(false);
      trackPageView("/pages/index/index", "home").catch(() => undefined);
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
  if (failed || !data) return <ErrorState onRetry={load} />;

  return (
    <View className="page home-page" data-testid="miniapp-home">
      <MiniappPageHeader title={data.site.appName} subtitle={data.site.subtitle} titleTestId="home-app-name" subtitleTestId="home-subtitle" />
      {refreshing && <PullDownRefreshIndicator />}
      <AnnouncementBar announcements={data.announcements} />
      <BannerSection banners={data.banners} site={data.site} />
      <MenuSection menus={data.menus} site={data.site} />
      <View className="section-heading section-heading--cases">
        <Text className="section-heading__title">精选案例</Text>
        <Text className="section-heading__more" onClick={() => clickGuard("home:more:activity_case", () => openMenu("activity_case"))}>
          更多案例 ›
        </Text>
      </View>
      {data.featuredCases.length === 0 ? (
        <View className="case-empty card">暂无精选案例</View>
      ) : (
        <View className="home-case-list" data-testid="home-featured-cases">
          {data.featuredCases.map((item: ClientHomeResponse["featuredCases"][number]) => (
            <CaseCard key={item.id} item={item} variant="compact" sitePlaceholderCaseUrl={data.site.placeholderCaseUrl} />
          ))}
        </View>
      )}
      <View className="section-heading section-heading--articles">
        <Text className="section-heading__title">精选文章</Text>
        <Text className="section-heading__more" data-testid="home-article-more" onClick={() => clickGuard("home:more:article", () => openMenu("article"))}>
          更多文章 ›
        </Text>
      </View>
      {data.featuredArticles.length === 0 ? (
        <View className="case-empty card">暂无精选文章</View>
      ) : (
        <View className="home-article-list" data-testid="home-featured-articles">
          {data.featuredArticles.map((item: ClientHomeResponse["featuredArticles"][number]) => (
            <ArticleCard key={item.id} item={item} variant="home" fallback={data.site.placeholderCaseUrl} />
          ))}
        </View>
      )}
    </View>
  );
}
