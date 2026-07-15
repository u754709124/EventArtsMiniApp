import { useDidShow, usePullDownRefresh } from "@tarojs/taro";
import { Input, Text, View } from "@tarojs/components";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ActivityCaseListItemDto } from "@event-arts/shared";
import { CaseCard } from "../../components/CaseCard";
import { MiniappPageHeader } from "../../components/MiniappPageHeader";
import { EmptyState, LoadingState } from "../../components/PageState";
import { getCases } from "../../services/api";
import { consumePendingCaseMenuFilter } from "../../utils/menu-navigation";
import { runPullDownRefresh } from "../../utils/pull-down-refresh";
import { useRepeatClickGuard } from "../../utils/repeat-click-guard";
import "./list.scss";

function normalizeCaseText(value: string) {
  return value.trim().toLocaleLowerCase("zh-CN");
}

function matchesCaseKeyword(item: ActivityCaseListItemDto, keyword: string) {
  const normalized = normalizeCaseText(keyword);
  if (!normalized) return true;
  return [item.title, item.category, item.tag, item.summary, item.location]
    .some((value) => normalizeCaseText(value).includes(normalized));
}

export default function CaseList() {
  const [items, setItems] = useState<ActivityCaseListItemDto[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const requestId = useRef(0);
  const clickGuard = useRepeatClickGuard();
  const visibleItems = useMemo(
    () => items.filter((item) => matchesCaseKeyword(item, query)),
    [items, query]
  );

  async function load(nextCategory = category, background = false) {
    const current = requestId.current + 1;
    requestId.current = current;
    if (!background) {
      setLoading(true);
      setFailed(false);
    }
    try {
      const data = await getCases({ category: nextCategory });
      if (requestId.current !== current) return;
      setItems(data);
      setFailed(false);
    } catch (error) {
      if (requestId.current !== current) return;
      if (background) throw error;
      setFailed(true);
    } finally {
      if (requestId.current === current) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [category]);

  useDidShow(() => {
    const pendingFilter = consumePendingCaseMenuFilter();
    if (!pendingFilter) return;
    setCategory(pendingFilter.category?.trim() ?? "");
    setQuery("");
  });

  usePullDownRefresh(() => runPullDownRefresh(() => load(category, true)));

  return (
    <View className="page" data-testid="case-list-page">
      <MiniappPageHeader title="活动案例" />
      <View className="case-search" data-testid="case-search-box">
        <Input
          className="case-search__input"
          data-testid="case-search-input"
          placeholder=""
          value={query}
          onInput={(event) => setQuery(String(event.detail.value ?? ""))}
        />
        {!query && <Text className="case-search__placeholder">搜索标题、类型、地点</Text>}
      </View>
      {loading ? (
        <LoadingState />
      ) : failed ? (
        <View className="case-list-state" data-testid="case-list-error-state">
          <Text>案例加载失败</Text>
          <Text className="primary-button" data-testid="case-list-reload" onClick={() => clickGuard("case-list:reload", () => load())}>重新加载</Text>
        </View>
      ) : visibleItems.length === 0 ? (
        <EmptyState text={query.trim() ? "没有匹配的案例" : "暂无案例"} />
      ) : (
        <View className="case-list-results">
          {visibleItems.map((item: ActivityCaseListItemDto) => (
            <CaseCard key={item.id} item={item} variant="list" />
          ))}
        </View>
      )}
    </View>
  );
}
