import Taro, { usePullDownRefresh } from "@tarojs/taro";
import { useEffect, useRef, useState } from "react";

export const pullDownRefreshFailureMessage = "刷新失败，请稍后重试";

export async function runPullDownRefresh(refresh: () => Promise<unknown>) {
  try {
    await refresh();
  } catch {
    await Promise.resolve(Taro.showToast({
      title: pullDownRefreshFailureMessage,
      icon: "none"
    })).catch(() => undefined);
  } finally {
    await Promise.resolve(Taro.stopPullDownRefresh()).catch(() => undefined);
  }
}

type RefreshController = {
  run: () => Promise<void>;
  update: (refresh: () => Promise<unknown>) => void;
};

export function createPullDownRefreshController(
  refresh: () => Promise<unknown>,
  onRefreshingChange: (refreshing: boolean) => void
): RefreshController {
  let currentRefresh = refresh;
  let activeRefresh: Promise<void> | null = null;

  return {
    run() {
      if (activeRefresh) return activeRefresh;

      onRefreshingChange(true);
      const task = runPullDownRefresh(() => currentRefresh()).finally(() => {
        if (activeRefresh !== task) return;
        activeRefresh = null;
        onRefreshingChange(false);
      });
      activeRefresh = task;
      return task;
    },
    update(nextRefresh) {
      currentRefresh = nextRefresh;
    }
  };
}

export function usePullDownRefreshState(refresh: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(false);
  const controller = useRef<RefreshController | null>(null);

  if (!controller.current) {
    controller.current = createPullDownRefreshController(refresh, (nextRefreshing) => {
      if (mounted.current) setRefreshing(nextRefreshing);
    });
  }
  controller.current.update(refresh);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  usePullDownRefresh(controller.current.run);
  return refreshing;
}
