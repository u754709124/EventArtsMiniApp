import { defineConfig } from "@tarojs/cli";
import { fileURLToPath, URL } from "node:url";

const h5PerformanceBudget = {
  maxAssetSize: 620 * 1024,
  maxEntrypointSize: 380 * 1024
};

export default defineConfig({
  projectName: "EventArtsMiniApp",
  date: "2026-07-09",
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    828: 1.81 / 2
  },
  sourceRoot: "src",
  outputRoot: "dist",
  framework: "react",
  compiler: {
    type: "webpack5",
    prebundle: {
      enable: false
    }
  },
  plugins: ["@tarojs/plugin-framework-react"],
  defineConstants: {
    __TARO_API_BASE_URL__: JSON.stringify(process.env.TARO_APP_API_BASE_URL || "http://127.0.0.1:3001")
  },
  alias: {
    "@event-arts/shared": fileURLToPath(new URL("../../../packages/shared/src/index.ts", import.meta.url))
  },
  mini: {
    webpackChain(chain) {
      chain.performance.hints(false);
    },
    postcss: {
      pxtransform: {
        enable: true,
        config: {}
      },
      cssModules: {
        enable: false
      }
    }
  },
  h5: {
    publicPath: "/",
    staticDirectory: "static",
    webpackChain(chain) {
      chain.performance.maxAssetSize(h5PerformanceBudget.maxAssetSize);
      chain.performance.maxEntrypointSize(h5PerformanceBudget.maxEntrypointSize);
    },
    devServer: {
      host: "127.0.0.1",
      port: 10086
    }
  }
});
