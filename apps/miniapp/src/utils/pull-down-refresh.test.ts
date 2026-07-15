import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const taroMock = vi.hoisted(() => ({
  showToast: vi.fn(() => Promise.resolve()),
  stopPullDownRefresh: vi.fn(() => Promise.resolve())
}));

vi.mock("@tarojs/taro", () => ({ default: taroMock }));

import { createPullDownRefreshController, pullDownRefreshFailureMessage, runPullDownRefresh } from "./pull-down-refresh";

beforeEach(() => vi.clearAllMocks());

describe("pull-down refresh lifecycle", () => {
  it("awaits the real request before stopping the native refresh animation", async () => {
    let resolveRequest!: () => void;
    const request = new Promise<void>((resolve) => {
      resolveRequest = resolve;
    });

    const refreshing = runPullDownRefresh(() => request);
    await Promise.resolve();
    expect(taroMock.stopPullDownRefresh).not.toHaveBeenCalled();

    resolveRequest();
    await refreshing;
    expect(taroMock.stopPullDownRefresh).toHaveBeenCalledTimes(1);
    expect(taroMock.showToast).not.toHaveBeenCalled();
  });

  it("shows non-blocking feedback and still stops after a failed request", async () => {
    await runPullDownRefresh(() => Promise.reject(new Error("network failed")));

    expect(taroMock.showToast).toHaveBeenCalledWith({
      title: pullDownRefreshFailureMessage,
      icon: "none"
    });
    expect(taroMock.stopPullDownRefresh).toHaveBeenCalledTimes(1);
  });

  it("still stops when failure feedback itself is unavailable", async () => {
    taroMock.showToast.mockRejectedValueOnce(new Error("toast unavailable"));

    await runPullDownRefresh(() => Promise.reject(new Error("network failed")));

    expect(taroMock.stopPullDownRefresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the visual state active until the real request settles", async () => {
    let resolveRequest!: () => void;
    const request = new Promise<void>((resolve) => {
      resolveRequest = resolve;
    });
    const states: boolean[] = [];
    const controller = createPullDownRefreshController(() => request, (refreshing) => states.push(refreshing));

    const running = controller.run();
    expect(states).toEqual([true]);

    resolveRequest();
    await running;
    expect(states).toEqual([true, false]);
  });

  it("clears the visual state after a failed request", async () => {
    const states: boolean[] = [];
    const controller = createPullDownRefreshController(
      () => Promise.reject(new Error("network failed")),
      (refreshing) => states.push(refreshing)
    );

    await controller.run();

    expect(states).toEqual([true, false]);
    expect(taroMock.showToast).toHaveBeenCalledWith({
      title: pullDownRefreshFailureMessage,
      icon: "none"
    });
    expect(taroMock.stopPullDownRefresh).toHaveBeenCalledTimes(1);
  });

  it("reuses an active refresh without a second request or visual lifecycle", async () => {
    let resolveRequest!: () => void;
    const request = new Promise<void>((resolve) => {
      resolveRequest = resolve;
    });
    const refresh = vi.fn(() => request);
    const states: boolean[] = [];
    const controller = createPullDownRefreshController(refresh, (refreshing) => states.push(refreshing));

    const first = controller.run();
    const second = controller.run();

    expect(second).toBe(first);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(states).toEqual([true]);

    resolveRequest();
    await first;
    expect(states).toEqual([true, false]);
  });

  it("places the shared indicator at the top of all five refresh pages", () => {
    const integrations = [
      ["../pages/index/index.tsx", "<MiniappPageHeader", "<AnnouncementBar"],
      ["../pages/category/index.tsx", "<MiniappPageHeader", "{loading ?"],
      ["../pages/cases/list.tsx", "<MiniappPageHeader", "<View className=\"case-search\""],
      ["../pages/articles/list.tsx", "<View className=\"article-list-nav\"", "<ScrollView className=\"article-category-tabs\""],
      ["../pages/artists/list.tsx", "<View className=\"artists-nav\"", "<View className=\"artist-search-row\""]
    ] as const;

    for (const [file, before, after] of integrations) {
      const source = readFileSync(resolve(import.meta.dirname, file), "utf8");
      const indicator = source.indexOf("{refreshing && <PullDownRefreshIndicator />}");
      expect(source).toContain("usePullDownRefreshState");
      expect(indicator).toBeGreaterThan(source.indexOf(before));
      expect(indicator).toBeLessThan(source.indexOf(after));
    }

    const componentSource = readFileSync(resolve(import.meta.dirname, "../components/PageState.tsx"), "utf8");
    const appStyles = readFileSync(resolve(import.meta.dirname, "../app.scss"), "utf8");
    expect(componentSource).toContain('data-testid="pull-down-refresh-loading"');
    expect(componentSource).toContain('aria-label="正在刷新"');
    expect(appStyles).toContain("@keyframes pull-down-refresh-spin");
  });
});
