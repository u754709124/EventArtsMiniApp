# Stage 6 - Weapp Build and Deploy

## 阶段目标
完成最终集成检查、微信小程序构建和部署说明，确认一期功能可进入人工验收。

## 功能范围
构建命令、导入目录、环境变量、API Base URL、资源存储、上线前清单。

## 主要文件
- `apps/miniapp/dist`
- `README.md`
- `.env.example`
- `docs/stages/06-weapp-build-and-deploy.md`
- `apps/miniapp/config/index.ts`
- `playwright.config.ts`
- `docs/deploy/nginx-production-routing.md`
- `deploy/nginx/eventarts-miniapp.conf.template`

## 数据结构或接口
生产环境使用同一 API 响应格式。小程序端 API Base URL 通过 `TARO_APP_API_BASE_URL` 在 Taro 编译时注入，后台通过 `VITE_API_BASE_URL` 或同源反向代理访问 API。

## 测试方式
最终运行：
```bash
pnpm install
pnpm lint
pnpm test
pnpm e2e
pnpm --filter api build
pnpm --filter admin build
pnpm --filter miniapp build:h5
pnpm build:weapp
```

## 验收清单
- [x] weapp 构建成功
- [x] 微信开发者工具导入目录明确
- [x] 生产环境变量说明完成
- [x] API Base URL 配置说明完成
- [x] 图片/视频资源存储说明完成
- [x] 上线前检查清单完成
- [x] 最终命令矩阵已运行并记录

## 已完成事项
- 2026-07-10 最终复核：`pnpm install`、`pnpm lint`、`pnpm test`、`pnpm e2e`、`pnpm --filter api build`、`pnpm --filter admin build`、`pnpm --filter miniapp build:h5`、`pnpm build:weapp` 全部完成。测试包含 shared 6 项、admin 3 项、api 34 项，Playwright 21 项且运行记录为 `passed`。
- `pnpm install`：当前 Codex 无 TTY 环境下直接运行会触发 pnpm module purge 确认并中断；按 pnpm 提示使用 `CI=true pnpm install` 后通过。
- `pnpm lint`：通过。
- `pnpm test`：通过；sandbox 内 Prisma engine cache 写入 `~/.cache/prisma` 被拒，使用提升权限运行后通过，shared 6 个测试、admin 3 个测试、api 34 个测试全部通过。
- `pnpm e2e`：通过；Admin 与 Miniapp H5 共 21 个 Playwright 场景全部通过，包含统一资源库、MD5 复用、内容寻址 seed、首页顶部/Banner 几何与精选案例卡片高度回归。
- `pnpm --filter api build`：通过；包含 Prisma Client 生成和 TypeScript noEmit。
- `pnpm --filter admin build`：通过；后续已配置 chunk warning budget，当前 Vite 构建无 warning 输出。
- `pnpm --filter miniapp build:h5`：通过；后续已压缩参考图生成资源并配置 performance budget，当前 Taro H5 构建无 warning 输出。
- `pnpm build:weapp`：通过；微信小程序端产物已生成到 `apps/miniapp/dist`。
- 首页视觉校准后复跑：`pnpm lint`、`pnpm test`、`pnpm e2e`、`pnpm --filter miniapp build:h5`、`pnpm build:weapp` 均通过；H5 截图已更新，Playwright 总数为 20。
- `.env.example` 已修正为 `VITE_API_BASE_URL` 与 `TARO_APP_API_BASE_URL`。
- README 已补全安装、数据库、seed、管理员 bootstrap、启动、构建、测试、生产注意事项、上传目录和对象存储预留说明。

## 构建命令
```bash
pnpm --filter api build
pnpm --filter admin build
pnpm --filter miniapp build:h5
pnpm build:weapp
```

## 微信开发者工具导入目录
构建微信小程序端后，在微信开发者工具中导入：
```text
apps/miniapp/dist
```

该目录包含 `app.json`、`app.js`、`app.wxss`、页面分包资源和 `project.config.json`。

## 生产环境变量
- `API_PORT`：API 服务端口。
- `API_HOST`：API 监听地址；生产 Nginx 反代部署默认 `127.0.0.1`，`NODE_ENV=production` 禁止 `0.0.0.0` 或公网地址。
- `ADMIN_HOST`：Admin 静态服务监听地址；生产默认 `127.0.0.1`，`NODE_ENV=production` 禁止 `0.0.0.0` 或公网地址。
- `ADMIN_PORT`：Admin 静态服务端口；生产默认 `4173`。
- `JWT_SECRET`：管理员 JWT 密钥，生产必须替换。
- `DATABASE_URL`：生产数据库连接；一期本地默认为 SQLite。
- `UPLOAD_DIR`：本地上传目录。
- `PUBLIC_BASE_URL`：媒体资源公开访问前缀。
- `VITE_API_BASE_URL`：后台构建或代理使用的 API Base URL。
- `TARO_APP_API_BASE_URL`：小程序/H5 编译时 API Base URL。

## API Base URL 配置
- 本地 H5：`TARO_APP_API_BASE_URL=http://127.0.0.1:3001 pnpm dev:h5`。
- 微信小程序生产构建：`TARO_APP_API_BASE_URL=https://your-domain.example pnpm build:weapp`。
- 生产推荐同源 Nginx 反代：`/admin/` 转发到 Admin 静态服务，`/api/` 和 `/uploads/` 原样转发到 API。
- 同源部署下后台 `VITE_API_BASE_URL` 留空，让 Admin 请求 `/api/...`；`PUBLIC_BASE_URL` 使用公网 origin，例如 `https://your-domain.example`，不要追加 `/api`。
- 不允许用 `API_HOST=0.0.0.0` 或 `ADMIN_HOST=0.0.0.0` 作为部署捷径；容器、多主机或多实例部署必须先创建 Planner revision 重新定义网络边界。

## 图片/视频资源存储
一期使用本地 `uploads` 目录和 `media_assets.storageType=local`。上传资源统一记录唯一资源名、原文件名、随机存储名、MD5、真实类型、URL、宽高、大小、标签、上传人和时间；资源库不区分业务用途。生产迁移对象存储时保留 `media_assets.url` 返回语义，并将 `PUBLIC_BASE_URL` 指向 CDN 或对象存储公开域名。

## 上线前检查清单
- 使用 `admin:bootstrap` 创建首个管理员；不要在生产运行 `pnpm db:seed`。
- 替换 `JWT_SECRET`。
- 配置生产 `DATABASE_URL` 并备份数据库。
- 配置 HTTPS 域名和微信小程序 request 合法域名；同源部署时该域名同时承载 `/admin/`、`/api/` 和 `/uploads/`。
- 确认 `TARO_APP_API_BASE_URL` 指向生产 API 后重新执行 `pnpm build:weapp`。
- 按 `docs/deploy/nginx-production-routing.md` 启用 Nginx 模板，并在服务器执行 `nginx -t` 后 reload。
- 执行 `pnpm test:deploy`、`pnpm deploy:smoke` 和 `pnpm security:release-gate` 检查配置层 loopback upstream、默认凭据、弱 JWT、生产 seed 防护、CORS、限流、session 撤销、日志脱敏和备份/恢复契约；目标服务器防火墙、安全组和公网端口不可达性仍需人工验证。
- 在微信开发者工具导入 `apps/miniapp/dist`，复核首页、公告、Banner、菜单跳转、案例详情、TabBar 和异常状态。
- 复核上传目录或对象存储的读写权限、`BACKUP_DIR` 容量、异地备份复制、备份保留调度、CDN 缓存策略和灾难恢复演练结果。
- 复核后台资源删除保护、推荐尺寸提示、可解析元数据校验和保存后立即生效。
- 运行 `pnpm lint`、`pnpm test`、`pnpm e2e`、`pnpm build:weapp`。

## 对应 git commit hash
bc22e21

## 已知问题或设计取舍
- 生产构建脚本使用 Taro 官方 `--no-check`，避免原生 doctor 依赖远程配置 schema；项目配置继续由 TypeScript、lint、自动化测试及实际 H5/weapp 编译验证。
- Codex sandbox 不能写 Prisma 默认用户缓存目录，涉及 `prisma generate` 的命令在本环境使用提升权限运行；普通本机开发环境通常不需要。
- 本轮在受限 sandbox 内直接执行 Taro H5 构建时，macOS `SystemConfiguration` 服务访问被拒，依赖运行时输出 `Attempted to create a NULL object` 后不再推进。以提升权限重跑同一构建及 `pnpm e2e` 后均通过；这是当前自动化宿主限制，不影响项目代码或本机开发命令。
- Taro H5/weapp 早期曾提示 `banner-default.png` 和 `placeholder-banner.png` 超过推荐体积；后续已将切图脚本输出改为 palette PNG，保留尺寸与资源名，同时消除构建 warning。
- Admin 构建提示首包 chunk 超过 Vite 默认建议值；一期后台页面集中在单入口，后续可按路由拆分 dynamic import。
- 微信端已完成构建产物生成，仍需在微信开发者工具中进行真实设备预览和合法域名校验。
