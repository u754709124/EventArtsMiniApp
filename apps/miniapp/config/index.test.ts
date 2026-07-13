import { describe, expect, it } from "vitest";
import { validateWeappAppIdGuard } from "./index";

describe("miniapp Taro config AppID guard", () => {
  it("does not block H5 builds", () => {
    expect(() => {
      validateWeappAppIdGuard({
        buildType: "h5",
        envAppId: "",
        projectAppId: "touristappid"
      });
    }).not.toThrow();
  });

  it("requires WECHAT_MINIAPP_APP_ID for weapp builds", () => {
    expect(() => {
      validateWeappAppIdGuard({
        buildType: "weapp",
        envAppId: "",
        projectAppId: "wx0f3eaae627c91c96"
      });
    }).toThrow("WECHAT_MINIAPP_APP_ID 未配置");
  });

  it("rejects the visitor AppID for weapp builds", () => {
    expect(() => {
      validateWeappAppIdGuard({
        buildType: "weapp",
        envAppId: "wx0f3eaae627c91c96",
        projectAppId: "touristappid"
      });
    }).toThrow("仍使用游客 AppID");
  });

  it("rejects AppID mismatches for weapp builds", () => {
    expect(() => {
      validateWeappAppIdGuard({
        buildType: "weapp",
        envAppId: "wx0f3eaae627c91c96",
        projectAppId: "wx1111111111111111"
      });
    }).toThrow("appid 与 WECHAT_MINIAPP_APP_ID 不一致");
  });

  it("allows matching target AppIDs for weapp builds", () => {
    expect(() => {
      validateWeappAppIdGuard({
        buildType: "weapp",
        envAppId: " wx0f3eaae627c91c96 ",
        projectAppId: "wx0f3eaae627c91c96"
      });
    }).not.toThrow();
  });
});
