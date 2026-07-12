import Taro from "@tarojs/taro";
import type { DetailShareState } from "./detail-share";

export function isWeappShareEnvironment() {
  try {
    return Taro.getEnv() === Taro.ENV_TYPE.WEAPP;
  } catch {
    return false;
  }
}

export function canRenderDetailShareButton(share: DetailShareState | undefined) {
  return Boolean(share?.canShare && isWeappShareEnvironment());
}
