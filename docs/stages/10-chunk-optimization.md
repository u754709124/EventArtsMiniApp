# Stage 10：构建分块与性能预算

## 目标

降低 Admin 首次加载体积，为 Miniapp H5 配置异步依赖切分，并通过可重复的构建后检查阻止大 chunk 回归。Fastify API 当前使用 `tsx` 运行、`tsc --noEmit` 验证，不生成服务端 bundle，因此没有可切分的浏览器 chunk；本阶段的“后台”指 Admin Web。

## 实现

- Admin 路由改用 `React.lazy` 与 `Suspense`，登录、后台 shell、CRUD、详情编辑器、素材、备份等形成按需加载边界。
- Vite 生成 manifest，并按 framework、Ant Design、编辑器和其他第三方依赖切分；`entriesAware` 避免登录入口静态包含非当前路由依赖。
- Taro H5 保留框架默认 `splitChunks` 分组并补充 560 KiB `maxSize`；非 watch 生产构建的 Webpack performance 超限由警告改为错误。
- `scripts/build/check-bundles.mjs` 统一检查 Admin、H5、WeApp 产物；缺失 JS 产物、超限、Admin 动态边界缺失都会使命令失败。

## 预算

| 目标 | 单 JS 原始体积 | 初始入口 |
| --- | ---: | ---: |
| Admin | ≤ 500 KiB | 静态依赖闭包 gzip ≤ 300 KiB |
| Miniapp H5 | ≤ 620 KiB | HTML 初始脚本 raw ≤ 380 KiB |
| Miniapp WeApp | ≤ 200 KiB | 不改变页面路径、TabBar 或主包结构 |

## 前后对比

| 目标 | 优化前 | 优化后 |
| --- | ---: | ---: |
| Admin 最大 JS | 2,058.47 KiB | 170.80 KiB |
| Admin 入口 gzip | 单主包 643.66 KiB | 静态闭包 232.96 KiB |
| H5 最大 JS | 539.12 KiB | 539.12 KiB |
| H5 初始入口 raw | 364.00 KiB | 364.00 KiB |
| WeApp 最大 JS | 130.03 KiB | 130.03 KiB |

H5 的主要收益是保留 Taro 已验证的默认异步分组并增加硬性回归门禁；现有最大异步 chunk 未进一步变小，但仍低于 620 KiB 预算。自定义覆盖 Taro cache groups 会造成 H5 返回页交互失效，因此最终实现只在默认配置上追加上限。WeApp 当前分块已合理，本阶段只增加 200 KiB 上限保护。

## 验证

G01 定向验证已通过：

- `pnpm test:build`：4 项测试通过。
- `pnpm --filter admin test`：128 项测试通过。
- `pnpm --filter miniapp test`：57 项测试通过。
- `pnpm --filter admin build`：最大 JS 170.80 KiB，入口 gzip 232.96 KiB。
- `pnpm --filter miniapp build:h5`：最大 JS 539.12 KiB，入口 raw 364.00 KiB。
- `pnpm --filter miniapp build:weapp`：最大 JS 130.03 KiB。

G02 最终验证已完成：

- `pnpm lint`：通过。
- `pnpm test`：shared 44、API 225、Admin 128、Miniapp 57、deploy 8、bundle budget 4 项全部通过；Admin 仍输出既有 jsdom `getComputedStyle` 非实现噪声。
- `pnpm e2e`：Admin 与 Miniapp H5 共 58/58 通过。
- `pnpm --filter admin build && pnpm --filter miniapp build:h5 && pnpm build:weapp`：全部构建与预算门禁通过。
- `pnpm release:check`：安全门禁、lint、全部单测、58/58 E2E、API/Admin/H5/WeApp 构建全部通过。

验证过程中，首次沙箱内 E2E 因无回环监听权限失败；提升权限后发现 watch 构建不应使用生产 performance error，已修正。随后自定义覆盖 Taro cache groups 稳定复现文章返回页分类失效，改为保留 Taro 默认 splitChunks 后，精确回归与两次完整 58 项 E2E 均通过。

## 已知取舍

- Admin 通过 HTTP/2/HTTP/3 友好的细粒度共享 chunk 保持登录首包在预算内；生产 CDN 应启用长期 immutable 缓存与压缩。
- 体积门禁针对原始与 gzip 传输体积，不替代真实设备上的 LCP、INP 和网络瀑布监控。
- 微信小程序仍需在微信开发者工具与真机上复核；本阶段不迁移 subpackage。
