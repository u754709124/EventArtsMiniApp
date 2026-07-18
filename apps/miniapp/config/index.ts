import { defineConfig } from "@tarojs/cli";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

const visitorMiniappAppId = "touristappid";
const h5PerformanceBudget = {
  maxAssetSize: 620 * 1024,
  maxEntrypointSize: 380 * 1024
};
const sharedSourceDir = fileURLToPath(new URL("../../../packages/shared/src", import.meta.url));
const sharedIndexPath = fileURLToPath(new URL("../../../packages/shared/src/index.ts", import.meta.url));
const sharedPresentationPath = fileURLToPath(new URL("../../../packages/shared/src/detail-page-presentation.ts", import.meta.url));
const repositoryEnvPath = fileURLToPath(new URL("../../../.env", import.meta.url));
const projectConfigPath = fileURLToPath(new URL("../project.config.json", import.meta.url));
const defaultLocalApiBaseUrl = "http://127.0.0.1:3001";

type WeappAppIdGuardOptions = {
  buildType?: string;
  envAppId?: string;
  projectAppId?: string;
};

export function parseEnvFile(content: string) {
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

export function validateWeappAppIdGuard({
  buildType,
  envAppId,
  projectAppId
}: WeappAppIdGuardOptions) {
  if (buildType !== "weapp") return;

  const normalizedEnvAppId = envAppId?.trim() || "";
  const normalizedProjectAppId = projectAppId?.trim() || "";
  if (!normalizedEnvAppId) {
    throw new Error(
      [
        "拒绝构建微信小程序：WECHAT_MINIAPP_APP_ID 未配置。",
        "请在根目录 .env 或构建环境中配置目标微信小程序 AppID。"
      ].join("\n")
    );
  }
  if (!normalizedProjectAppId) {
    throw new Error(
      [
        "拒绝构建微信小程序：project.config.json 缺少 appid。",
        "请将工程 AppID 设置为目标微信小程序的公开 AppID。"
      ].join("\n")
    );
  }
  if (normalizedProjectAppId === visitorMiniappAppId) {
    throw new Error(
      [
        "拒绝构建微信小程序：project.config.json 仍使用游客 AppID。",
        "请将工程 AppID 设置为目标微信小程序的公开 AppID。"
      ].join("\n")
    );
  }
  if (normalizedProjectAppId !== normalizedEnvAppId) {
    throw new Error(
      [
        "拒绝构建微信小程序：project.config.json appid 与 WECHAT_MINIAPP_APP_ID 不一致。",
        "请确认微信开发者工具项目、weapp 构建配置和 API 服务端使用同一个目标小程序 AppID。"
      ].join("\n")
    );
  }
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

function readProjectAppId() {
  const rawConfig = JSON.parse(readFileSync(projectConfigPath, "utf8")) as { appid?: unknown };
  return typeof rawConfig.appid === "string" ? rawConfig.appid : "";
}

const apiBaseUrl = envValue("TARO_APP_API_BASE_URL") || defaultLocalApiBaseUrl;
const wechatMiniappAppId = envValue("WECHAT_MINIAPP_APP_ID");
const allowUnsafeMiniappApiBaseUrl = envValue("ALLOW_UNSAFE_MINIAPP_API_BASE_URL") === "true";

function taroBuildType() {
  const typeArg = process.argv.find((arg) => arg.startsWith("--type="));
  if (typeArg) return typeArg.slice("--type=".length);
  const typeIndex = process.argv.findIndex((arg) => arg === "--type" || arg === "-t");
  return typeIndex >= 0 ? process.argv[typeIndex + 1] : process.env.TARO_ENV;
}

function unsafeMiniappApiBaseUrlReason(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "不是有效 URL";
  }

  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:") return "微信小程序生产接口必须使用 HTTPS";
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost")) {
    return "localhost/127.0.0.1 会被编译进小程序包，真机无法访问本机 API";
  }
  if (
    host.endsWith(".test") ||
    host === "example.com" ||
    host.endsWith(".example.com") ||
    host === "example.net" ||
    host.endsWith(".example.net") ||
    host === "example.org" ||
    host.endsWith(".example.org") ||
    host === "your-domain.example" ||
    host.endsWith(".example")
  ) {
    return "仍是示例或占位域名";
  }
  return null;
}

const currentBuildType = taroBuildType();
const isWatchBuild = process.argv.includes("--watch");
const shouldGuardMiniappApiBaseUrl = currentBuildType === "weapp" && !allowUnsafeMiniappApiBaseUrl;
const unsafeReason = shouldGuardMiniappApiBaseUrl
  ? unsafeMiniappApiBaseUrlReason(apiBaseUrl)
  : null;
if (unsafeReason) {
  throw new Error(
    [
      `拒绝构建微信小程序：TARO_APP_API_BASE_URL=${apiBaseUrl}`,
      unsafeReason,
      "请改为已配置到微信后台 request 合法域名的真实 HTTPS origin 后重新构建。",
      "仅本地临时调试可设置 ALLOW_UNSAFE_MINIAPP_API_BASE_URL=true 跳过此保护。"
    ].join("\n")
  );
}
validateWeappAppIdGuard({
  buildType: currentBuildType,
  envAppId: wechatMiniappAppId,
  projectAppId: currentBuildType === "weapp" ? readProjectAppId() : undefined
});

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
      const taroSplitChunks = chain.optimization.get("splitChunks") ?? {};
      chain.optimization.splitChunks({
        ...taroSplitChunks,
        maxSize: 560 * 1024
      });
      chain.performance.hints(isWatchBuild ? false : "error");
      chain.performance.maxAssetSize(h5PerformanceBudget.maxAssetSize);
      chain.performance.maxEntrypointSize(h5PerformanceBudget.maxEntrypointSize);
    },
    devServer: {
      host: "127.0.0.1",
      port: 10086
    }
  }
});
