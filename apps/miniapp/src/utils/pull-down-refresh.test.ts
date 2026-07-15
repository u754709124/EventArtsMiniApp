import { beforeEach, describe, expect, it, vi } from "vitest";

const taroMock = vi.hoisted(() => ({
  showToast: vi.fn(() => Promise.resolve()),
  stopPullDownRefresh: vi.fn(() => Promise.resolve())
}));

vi.mock("@tarojs/taro", () => ({ default: taroMock }));

import { pullDownRefreshFailureMessage, runPullDownRefresh } from "./pull-down-refresh";

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
});
