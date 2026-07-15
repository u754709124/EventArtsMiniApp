import Taro from "@tarojs/taro";

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
