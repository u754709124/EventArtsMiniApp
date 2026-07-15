import Taro, { useLoad } from "@tarojs/taro";
import { ScrollView, Text, View } from "@tarojs/components";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ArticleListItemDto } from "@event-arts/shared";
import { ArticleCard } from "../../components/ArticleCard";
import { EmptyState, LoadingState, PullDownRefreshIndicator } from "../../components/PageState";
import { getArticles } from "../../services/api";
import { ignoreNavigationError } from "../../utils/menu-navigation";
import { usePullDownRefreshState } from "../../utils/pull-down-refresh";
import { useRepeatClickGuard } from "../../utils/repeat-click-guard";
import "./list.scss";

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function initialQuery() {
  try {
    const params = Taro.getCurrentInstance().router?.params ?? {};
    const pageSize = Number(params.pageSize);
    return {
      category: typeof params.category === "string" ? safeDecode(params.category).trim() : "",
      pageSize: Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 50 ? pageSize : 10
    };
  } catch {
    return { category: "", pageSize: 10 };
  }
}

function pageSizeFromQuery(value: unknown) {
  const pageSize = Number(value);
  return Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 50 ? pageSize : 10;
}

function getNavigationMetrics() {
  const fallback = { safeTop: 33, headerHeight: 44 };
  if (Taro.getEnv() === Taro.ENV_TYPE.WEB) return fallback;
  try {
    const system = Taro.getSystemInfoSync();
    const safeTop = Number(system.statusBarHeight || 20);
    const capsule = Taro.getMenuButtonBoundingClientRect?.();
    if (capsule?.height && capsule?.bottom) {
      return { safeTop, headerHeight: Math.max(capsule.bottom - safeTop + 8, 44) };
    }
    return { safeTop, headerHeight: 44 };
  } catch {
    return fallback;
  }
}

function uniqueById(current: ArticleListItemDto[], next: ArticleListItemDto[]) {
  const seen = new Set<number>();
  return [...current, ...next].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export default function ArticleList() {
  const initial = useMemo(initialQuery, []);
  const metrics = useMemo(getNavigationMetrics, []);
  const [items, setItems] = useState<ArticleListItemDto[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState(initial.category);
  const [pageSize, setPageSize] = useState(initial.pageSize);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestToken = useRef(0);
  const clickGuard = useRepeatClickGuard();

  useLoad((query) => {
    setReady(false);
    setItems([]);
    setCategory(typeof query.category === "string" ? safeDecode(query.category).trim() : "");
    setPageSize(pageSizeFromQuery(query.pageSize));
    setPage(1);
    setReady(true);
  });

  const hasMore = items.length < total;

  async function load(nextPage: number, reset: boolean, background = false) {
    const token = requestToken.current + 1;
    requestToken.current = token;
    if (!background) {
      if (reset) {
        setLoading(true);
        setFailed(false);
      } else {
        setLoadingMore(true);
      }
    }
    try {
      const data = await getArticles({ category, page: nextPage, pageSize });
      if (requestToken.current !== token) return;
      setItems((current) => reset ? data.items : uniqueById(current, data.items));
      setCategories(data.categories);
      setTotal(data.total);
      setPage(data.page);
      setFailed(false);
    } catch (error) {
      if (requestToken.current !== token) return;
      if (background) throw error;
      setFailed(true);
    } finally {
      if (requestToken.current === token) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }

  useEffect(() => {
    if (!ready) return;
    void load(1, true);
  }, [category, pageSize, ready]);

  const refreshing = usePullDownRefreshState(() => load(1, true, true));

  function selectCategory(nextCategory: string) {
    if (nextCategory === category) return;
    setItems([]);
    setTotal(0);
    setPage(1);
    setCategory(nextCategory);
  }

  function goBack() {
    try {
      if (Taro.getCurrentPages().length > 1) {
        ignoreNavigationError(Taro.navigateBack({ delta: 1 }));
        return;
      }
    } catch {
      // H5 may not expose the native page stack; use the home tab below.
    }
    ignoreNavigationError(Taro.switchTab({ url: "/pages/index/index" }));
  }

  const visibleCategories = category && !categories.includes(category) ? [category, ...categories] : categories;
  const title = category || "全部文章";

  return (
    <View className="page article-list-page" data-testid="article-list-page">
      <View className="article-list-nav" style={{ paddingTop: `${metrics.safeTop}px` }}>
        <View className="article-list-nav__content" style={{ height: `${metrics.headerHeight}px` }}>
          <View className="article-list-nav__back" data-testid="article-back-button" onClick={() => clickGuard("article:back", goBack)}>
            <View className="article-list-nav__back-icon" aria-hidden />
          </View>
          <Text className="article-list-nav__title" data-testid="article-list-title">{title}</Text>
        </View>
      </View>
      {refreshing && <PullDownRefreshIndicator />}
      <ScrollView className="article-category-tabs" data-testid="article-category-tabs" scrollX enhanced showScrollbar={false}>
        <Text
          className={`article-category-tab ${category === "" ? "article-category-tab--active" : ""}`}
          data-testid="article-category-all"
          onClick={() => clickGuard("article:category:all", () => selectCategory(""))}
        >
          全部
        </Text>
        {visibleCategories.map((item) => (
          <Text
            key={item}
            className={`article-category-tab ${category === item ? "article-category-tab--active" : ""}`}
            data-testid={`article-category-${item}`}
            onClick={() => clickGuard(`article:category:${item}`, () => selectCategory(item))}
          >
            {item}
          </Text>
        ))}
      </ScrollView>
      {loading ? (
        <LoadingState />
      ) : failed ? (
        <View className="article-list-state" data-testid="article-list-error-state">
          <Text>文章加载失败</Text>
          <Text className="primary-button" data-testid="article-list-reload" onClick={() => clickGuard("article:reload", () => load(1, true))}>重新加载</Text>
        </View>
      ) : items.length === 0 ? (
        <EmptyState text={category ? "该分类暂无文章" : "暂无文章"} />
      ) : (
        <>
          <View className="article-list-results" data-testid="article-list-results">
            {items.map((item) => (
              <ArticleCard key={item.id} item={item} variant="list" />
            ))}
          </View>
          {hasMore ? (
            <Text
              className="article-load-more"
              data-testid="article-load-more"
              onClick={() => {
                if (!loadingMore) clickGuard("article:load-more", () => load(page + 1, false));
              }}
            >
              {loadingMore ? "加载中..." : "加载更多"}
            </Text>
          ) : (
            <Text className="article-list-end">已加载全部</Text>
          )}
        </>
      )}
    </View>
  );
}
