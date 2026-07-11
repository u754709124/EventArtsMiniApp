import { Text, View } from "@tarojs/components";
import { useLoad } from "@tarojs/taro";
import { useEffect, useRef, useState } from "react";
import { ApiRequestError, requestWithTask } from "../../services/api";
import { redirectToDetailPage } from "../../utils/detail-page-navigation";
import { DetailNavigation } from "./DetailNavigation";
import { DetailPageSkeleton } from "./DetailPageSkeleton";
import { createDetailRequestGate } from "./request-race";

type LegacyDetailRecord = {
  id: number;
  detailPageId: number | null;
};

type LegacyRedirectState =
  | { status: "loading" }
  | { status: "noDetail" | "notFound" | "error"; message?: string };

export function LegacyDetailRedirectPage<T extends LegacyDetailRecord>({
  buildUrl,
  fallbackTabUrl,
  loadingTitle,
  testid
}: {
  buildUrl: (id: number) => string;
  fallbackTabUrl: string;
  loadingTitle: string;
  testid: string;
}) {
  const [state, setState] = useState<LegacyRedirectState>({ status: "loading" });
  const gate = useRef(createDetailRequestGate());
  const currentId = useRef<number | null>(null);

  function load(rawId: string | number | undefined) {
    const id = Number(rawId);
    currentId.current = Number.isInteger(id) && id > 0 ? id : null;
    setState({ status: "loading" });
    if (currentId.current === null) {
      gate.current.dispose();
      setState({ status: "notFound", message: "详情地址无效" });
      return;
    }

    const task = requestWithTask<T>(buildUrl(currentId.current));
    const token = gate.current.begin(String(currentId.current), task.abort);
    void task.promise
      .then((data) => {
        if (!gate.current.isCurrent(token)) return;
        if (data.detailPageId) {
          redirectToDetailPage(data.detailPageId);
          return;
        }
        setState({ status: "noDetail" });
      })
      .catch((error: unknown) => {
        if (!gate.current.isCurrent(token)) return;
        const status = error instanceof ApiRequestError && (error.code === "NOT_FOUND" || error.statusCode === 404)
          ? "notFound"
          : "error";
        setState({
          status,
          message: error instanceof Error ? error.message : undefined
        });
      });
  }

  function retry() {
    if (currentId.current !== null) load(currentId.current);
  }

  useLoad((query) => {
    load(query.id);
  });

  useEffect(() => () => gate.current.dispose(), []);

  if (state.status === "loading") {
    return <DetailPageSkeleton layout="richText" fallbackTabUrl={fallbackTabUrl} title={loadingTitle} />;
  }

  const copy = {
    noDetail: ["暂无详情", "内容正在完善中"],
    notFound: ["内容不存在或已停用", "请返回列表选择其他内容"],
    error: ["页面加载失败", "请检查网络后重新加载"]
  } as const;
  const [title, description] = copy[state.status];

  return (
    <View className="detail-page detail-page--state" data-testid={testid}>
      <DetailNavigation title={loadingTitle} fallbackTabUrl={fallbackTabUrl} />
      <View className="detail-state" data-testid={`legacy-detail-${state.status}`}>
        <Text className="detail-state__title">{title}</Text>
        <Text className="detail-state__description">{state.message || description}</Text>
        {state.status === "error" && (
          <Text className="detail-state__button" data-testid="detail-retry" onClick={retry}>
            重新加载
          </Text>
        )}
      </View>
    </View>
  );
}
