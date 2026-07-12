import Taro, { useLoad } from "@tarojs/taro";
import { Input, Text, View } from "@tarojs/components";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ArtistListItemDto, ArtistType } from "@event-arts/shared";
import { generatedAssets } from "../../assets";
import { AppImage } from "../../components/AppImage";
import { request } from "../../services/api";
import { navigateToDetailPage } from "../../utils/detail-page-navigation";
import { ignoreNavigationError } from "../../utils/menu-navigation";
import { useRepeatClickGuard } from "../../utils/repeat-click-guard";
import "./list.scss";

type ArtistListItem = ArtistListItemDto;

type FilterOptions = {
  locations: string[];
  tags: string[];
};

const artistTypes: ArtistType[] = ["host", "singer", "actor"];

const artistTypeLabels: Record<ArtistType, string> = {
  host: "主持人",
  singer: "歌手",
  actor: "演员"
};

const artistCopy: Record<ArtistType, { searchPlaceholder: string }> = {
  host: { searchPlaceholder: "搜索主持人姓名、擅长风格或活动类型" },
  singer: { searchPlaceholder: "搜索歌手姓名、擅长风格或活动类型" },
  actor: { searchPlaceholder: "搜索演员姓名、擅长风格或活动类型" }
};

function normalizeArtistType(value: unknown): ArtistType {
  return artistTypes.includes(value as ArtistType) ? (value as ArtistType) : "host";
}

function getTags(item: ArtistListItem) {
  return Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string" && Boolean(tag.trim())) : [];
}

function getText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function buildArtistListUrl(type: ArtistType, keyword: string, location: string, tag: string) {
  const entries = [
    ["type", type],
    ["q", keyword],
    ["location", location],
    ["tag", tag]
  ].filter(([, value]) => Boolean(value));
  const query = entries.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
  return `/api/client/artists?${query}`;
}

function getFilterOptions(items: ArtistListItem[]): FilterOptions {
  const locations = new Set<string>();
  const tags = new Set<string>();
  items.forEach((item) => {
    const location = getText(item.location);
    if (location) locations.add(location);
    getTags(item).forEach((tag) => tags.add(tag.trim()));
  });
  return { locations: [...locations], tags: [...tags] };
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

function ArtistCard({ item, type }: { item: ArtistListItem; type: ArtistType }) {
  const tags = getTags(item).slice(0, 4);
  const clickable = Boolean(item.detailPageId);
  return (
    <View
      className={`artist-card ${clickable ? "artist-card--clickable" : "artist-card--static"}`}
      data-testid="artist-card"
      onClick={clickable ? () => navigateToDetailPage(item.detailPageId) : undefined}
    >
      <View className="artist-card__cover-wrap">
        <AppImage
          className="artist-card__cover"
          testid="artist-card-cover"
          src={getText(item.coverUrl)}
          fallback={generatedAssets.placeholderCase}
        />
        <View className="artist-card__badge">
          <View className="artist-card__crown" aria-hidden />
          <Text className="artist-card__badge-text">{getText(item.badge) || artistTypeLabels[type]}</Text>
        </View>
      </View>
      <View className="artist-card__body">
        <View className="artist-card__meta">
          <View className="artist-card__name-group">
            <Text className="artist-card__name">{getText(item.name) || "未命名人员"}</Text>
            <Text className="artist-card__type">{artistTypeLabels[type]}</Text>
          </View>
          <View className="artist-card__location-group">
            <View className="artist-card__location-icon" aria-hidden />
            <Text className="artist-card__location">{getText(item.location) || "暂未填写"}</Text>
          </View>
        </View>
        <View className="artist-card__tags">
          {tags.map((tag) => (
            <Text key={tag} className="artist-card__tag">
              {tag}
            </Text>
          ))}
        </View>
        <Text className="artist-card__summary">{getText(item.summary) || "暂未填写人员介绍"}</Text>
      </View>
    </View>
  );
}

function ArtistListSkeleton() {
  return (
    <View className="artist-grid" data-testid="artist-list-skeleton">
      {[0, 1, 2, 3].map((index) => (
        <View key={index} className="artist-skeleton">
          <View className="artist-skeleton__cover" />
          <View className="artist-skeleton__line artist-skeleton__line--title" />
          <View className="artist-skeleton__line" />
          <View className="artist-skeleton__line artist-skeleton__line--short" />
        </View>
      ))}
    </View>
  );
}

function ArtistFilterPanel({
  options,
  location,
  tag,
  onLocationChange,
  onTagChange,
  onClose,
  onReset,
  onConfirm
}: {
  options: FilterOptions;
  location: string;
  tag: string;
  onLocationChange: (value: string) => void;
  onTagChange: (value: string) => void;
  onClose: () => void;
  onReset: () => void;
  onConfirm: () => void;
}) {
  const clickGuard = useRepeatClickGuard();
  return (
    <View className="artist-filter" data-testid="artist-filter-panel" onClick={() => clickGuard("artist:filter:close-backdrop", onClose)}>
      <View className="artist-filter__sheet" onClick={(event) => event.stopPropagation()}>
        <View className="artist-filter__handle" />
        <View className="artist-filter__heading">
          <Text className="artist-filter__title">筛选</Text>
          <Text className="artist-filter__close" onClick={() => clickGuard("artist:filter:close", onClose)}>
            关闭
          </Text>
        </View>
        <Text className="artist-filter__label">演绎地点</Text>
        <View className="artist-filter__options">
          {options.locations.length === 0 ? (
            <Text className="artist-filter__empty">暂无可选地点</Text>
          ) : (
            options.locations.map((option) => (
              <Text
                key={option}
                className={`artist-filter__option ${location === option ? "artist-filter__option--active" : ""}`}
                data-testid={`artist-filter-location-${option}`}
                onClick={() => clickGuard(`artist:filter:location:${option}`, () => onLocationChange(location === option ? "" : option))}
              >
                {option}
              </Text>
            ))
          )}
        </View>
        <Text className="artist-filter__label">擅长标签</Text>
        <View className="artist-filter__options">
          {options.tags.length === 0 ? (
            <Text className="artist-filter__empty">暂无可选标签</Text>
          ) : (
            options.tags.map((option) => (
              <Text
                key={option}
                className={`artist-filter__option ${tag === option ? "artist-filter__option--active" : ""}`}
                data-testid={`artist-filter-tag-${option}`}
                onClick={() => clickGuard(`artist:filter:tag:${option}`, () => onTagChange(tag === option ? "" : option))}
              >
                {option}
              </Text>
            ))
          )}
        </View>
        <View className="artist-filter__actions">
          <Text className="artist-filter__reset" data-testid="artist-filter-reset" onClick={() => clickGuard("artist:filter:reset", onReset)}>
            重置
          </Text>
          <Text className="artist-filter__confirm" data-testid="artist-filter-confirm" onClick={() => clickGuard("artist:filter:confirm", onConfirm)}>
            确定
          </Text>
        </View>
      </View>
    </View>
  );
}

export default function ArtistList() {
  const [type, setType] = useState<ArtistType>("host");
  const [items, setItems] = useState<ArtistListItem[]>([]);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ locations: [], tags: [] });
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [location, setLocation] = useState("");
  const [tag, setTag] = useState("");
  const [draftLocation, setDraftLocation] = useState("");
  const [draftTag, setDraftTag] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const requestToken = useRef(0);
  const metrics = useMemo(getNavigationMetrics, []);
  const copy = artistCopy[type as ArtistType];
  const title = artistTypeLabels[type as ArtistType];
  const clickGuard = useRepeatClickGuard();

  useLoad((query) => {
    const nextType = normalizeArtistType(query.type);
    setType(nextType);
    setItems([]);
    setFilterOptions({ locations: [], tags: [] });
    setKeywordInput("");
    setKeyword("");
    setLocation("");
    setTag("");
  });

  useEffect(() => {
    const timer = setTimeout(() => setKeyword(keywordInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [keywordInput]);

  useEffect(() => {
    const token = requestToken.current + 1;
    requestToken.current = token;
    setLoading(true);
    setFailed(false);
    void request<ArtistListItem[]>(buildArtistListUrl(type, keyword, location, tag))
      .then((data) => {
        if (requestToken.current !== token) return;
        setItems(data);
        if (!keyword && !location && !tag) setFilterOptions(getFilterOptions(data));
      })
      .catch(() => {
        if (requestToken.current !== token) return;
        setFailed(true);
      })
      .finally(() => {
        if (requestToken.current === token) setLoading(false);
      });
  }, [keyword, location, reloadKey, tag, type]);

  function goBack() {
    try {
      if (Taro.getCurrentPages().length > 1) {
        ignoreNavigationError(Taro.navigateBack({ delta: 1 }));
        return;
      }
    } catch {
      // H5 may not expose the native page stack; use the category tab below.
    }
    ignoreNavigationError(Taro.switchTab({ url: "/pages/category/index" }));
  }

  function openFilter() {
    setDraftLocation(location);
    setDraftTag(tag);
    setFilterOpen(true);
  }

  function resetFilter() {
    setDraftLocation("");
    setDraftTag("");
    setLocation("");
    setTag("");
    setFilterOpen(false);
  }

  function confirmFilter() {
    setLocation(draftLocation);
    setTag(draftTag);
    setFilterOpen(false);
  }

  return (
    <View className="artists-page" data-testid={`artist-list-page-${type}`}>
      <View className="artists-nav" style={{ paddingTop: `${metrics.safeTop}px` }}>
        <View className="artists-nav__content" style={{ height: `${metrics.headerHeight}px` }}>
          <View className="artists-nav__back" data-testid="artist-back-button" onClick={() => clickGuard("artist:back", goBack)}>
            <View className="artists-nav__back-icon" aria-hidden />
          </View>
          <Text className="artists-nav__title" data-testid="artist-list-title">
            {title}
          </Text>
        </View>
      </View>

      <View className="artist-search-row">
        <View className="artist-search">
          <View className="artist-search__icon" aria-hidden />
          <Input
            className="artist-search__input"
            data-testid="artist-search-input"
            value={keywordInput}
            placeholder={copy.searchPlaceholder}
            placeholderClass="artist-search__placeholder"
            maxlength={80}
            onInput={(event) => setKeywordInput(event.detail.value)}
          />
        </View>
        <View className="artist-filter-button" data-testid="artist-filter-button" onClick={() => clickGuard("artist:filter:open", openFilter)}>
          <View className="artist-filter-button__icon" aria-hidden />
          <Text>筛选</Text>
        </View>
      </View>

      <View className="artist-list-content" data-testid="artist-list-content">
        {loading ? (
          <ArtistListSkeleton />
        ) : failed ? (
          <View className="artist-state" data-testid="artist-list-error">
            <Text className="artist-state__title">页面加载失败</Text>
            <Text className="artist-state__desc">请稍后重试</Text>
            <Text className="artist-state__action" data-testid="artist-list-retry" onClick={() => clickGuard("artist:retry", () => setReloadKey((value: number) => value + 1))}>
              重新加载
            </Text>
          </View>
        ) : items.length === 0 ? (
          <View className="artist-state" data-testid="artist-list-empty">
            <Text className="artist-state__title">暂无{title}</Text>
            <Text className="artist-state__desc">试试修改搜索或筛选条件</Text>
          </View>
        ) : (
          <View className="artist-grid">
            {items.map((item: ArtistListItem) => (
              <ArtistCard key={item.id} item={item} type={type} />
            ))}
          </View>
        )}
      </View>

      {filterOpen && (
        <ArtistFilterPanel
          options={filterOptions}
          location={draftLocation}
          tag={draftTag}
          onLocationChange={setDraftLocation}
          onTagChange={setDraftTag}
          onClose={() => clickGuard("artist:filter:close", () => setFilterOpen(false))}
          onReset={() => clickGuard("artist:filter:reset", resetFilter)}
          onConfirm={() => clickGuard("artist:filter:confirm", confirmFilter)}
        />
      )}
    </View>
  );
}
