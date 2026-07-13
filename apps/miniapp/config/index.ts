import { defineConfig } from "@tarojs/cli";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

const h5PerformanceBudget = {
  maxAssetSize: 620 * 1024,
  maxEntrypointSize: 380 * 1024
};
const sharedSourceDir = fileURLToPath(new URL("../../../packages/shared/src", import.meta.url));
const sharedIndexPath = fileURLToPath(new URL("../../../packages/shared/src/index.ts", import.meta.url));
const sharedPresentationPath = fileURLToPath(new URL("../../../packages/shared/src/detail-page-presentation.ts", import.meta.url));
const repositoryEnvPath = fileURLToPath(new URL("../../../.env", import.meta.url));
const defaultLocalApiBaseUrl = "http://127.0.0.1:3001";

function parseEnvFile(content: string) {
  const values: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      const hashIndex = value.search(/\s+#/);
      if (hashIndex >= 0) value = value.slice(0, hashIndex).trimEnd();
    }
    values[key] = value.replace(/\\n/g, "\n");
  }
  return values;
}

function readRepositoryEnv() {
  return existsSync(repositoryEnvPath)
    ? parseEnvFile(readFileSync(repositoryEnvPath, "utf8"))
    : {};
}

const repositoryEnv = readRepositoryEnv();

function envValue(key: string) {
  return process.env[key] ?? repositoryEnv[key];
}

const apiBaseUrl = envValue("TARO_APP_API_BASE_URL") || defaultLocalApiBaseUrl;

function includeSharedSource(chain: { module: { rule: (name: string) => { include: { add: (path: string) => void } } } }) {
  chain.module.rule("script").include.add(sharedSourceDir);
}

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
  compile: {
    include: [sharedSourceDir]
  },
  plugins: ["@tarojs/plugin-framework-react"],
  defineConstants: {
    __TARO_API_BASE_URL__: JSON.stringify(apiBaseUrl)
  },
  alias: {
    "@event-arts/shared/detail-page-presentation": sharedPresentationPath,
    "@event-arts/shared": sharedIndexPath
  },
  mini: {
    webpackChain(chain) {
      includeSharedSource(chain);
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
      includeSharedSource(chain);
      chain.performance.maxAssetSize(h5PerformanceBudget.maxAssetSize);
      chain.performance.maxEntrypointSize(h5PerformanceBudget.maxEntrypointSize);
    },
    devServer: {
      host: "127.0.0.1",
      port: 10086
    }
  }
});
