import { defineConfig } from "@tarojs/cli";
import { fileURLToPath, URL } from "node:url";

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
  alias: {
    "@event-arts/shared": fileURLToPath(new URL("../../../packages/shared/src/index.ts", import.meta.url))
  },
  mini: {
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
    devServer: {
      host: "127.0.0.1",
      port: 10086
    }
  }
});
