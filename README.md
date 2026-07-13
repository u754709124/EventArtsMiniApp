# EventArtsMiniApp

EventArtsMiniApp 是一期微信小程序交付项目，包含 Taro 小程序、Fastify API、React Ant Design 后台、共享类型、自动化测试和阶段文档。

## 环境要求

- Node.js `22.12+`
- pnpm `11.x`
- SQLite 本地开发数据库
- 微信开发者工具，用于导入和预览微信小程序端产物

## 安装依赖

```bash
pnpm install
```

在 CI 或无 TTY 环境中可使用：

```bash
CI=true pnpm install
```

## 环境变量

复制 `.env.example` 为 `.env`，并按环境修改：

- `API_PORT`：API 监听端口，默认 `3001`
- `API_HOST`：API 监听地址，默认 `127.0.0.1`；`NODE_ENV=production` 只允许 loopback，禁止 `0.0.0.0` 或公网地址
- `JWT_SECRET`：管理员 JWT 密钥，生产环境必须替换
- `DATABASE_URL`：SQLite 数据库地址，默认 `file:./dev.db`
- `UPLOAD_DIR`：本地上传目录，默认指向仓库根目录 `uploads`
- `MAX_IMAGE_UPLOAD_BYTES`：图片上传上限，默认 `10MB`
- `MAX_VIDEO_UPLOAD_BYTES`：视频上传上限，默认 `100MB`
- `PUBLIC_BASE_URL`：资源 URL 前缀
- `WECHAT_MINIAPP_APP_ID`：目标微信小程序 AppID；生产必填
- `WECHAT_MINIAPP_APP_SECRET`：目标微信小程序 AppSecret；只放 API 服务端，生产必填
- `WECHAT_AUTH_VERIFIER_MODE`：微信登录校验模式，生产只能为 `wechat`
- `CLIENT_SESSION_TTL_SECONDS`：小程序客户端会话有效期，默认 `1800`
- `WECHAT_CODE2SESSION_TIMEOUT_MS`：服务端调用微信 `code2Session` 超时，默认 `3000`
- `ADMIN_HOST`：Admin 生产静态服务监听地址，默认 `127.0.0.1`；`NODE_ENV=production` 只允许 loopback，禁止 `0.0.0.0` 或公网地址
- `ADMIN_PORT`：Admin 生产静态服务监听端口，默认 `4173`
- `VITE_API_BASE_URL`：后台管理系统 API Base URL；本地也可留空走 Vite proxy，生产同源 Nginx 部署应留空
- `TARO_APP_API_BASE_URL`：Taro H5/weapp 编译时注入的小程序 API Base URL

## 初始化数据库

```bash
pnpm db:push
pnpm db:seed
```

`db:push` 会创建独立详情页表、文章表并执行幂等 SQLite 兼容迁移；`db:seed` 可重复运行，并按稳定 seed key 写入公告、首页 BANNER、人员、案例和文章的已绑定/未绑定详情示例。旧 `DetailPageConfig.ownerType/ownerId` 只作为 deprecated 迁移痕迹保留，运行时由业务表的可空 `detailPageId` 外键引用独立详情页。升级前请同时备份 SQLite 文件和 `uploads`。

`db:seed` 不会创建、覆盖或删除管理员。首次初始化管理员必须显式执行一次 bootstrap，并从标准输入传入强密码：

```bash
read -r -s BOOTSTRAP_PASSWORD
printf '%s\n' "$BOOTSTRAP_PASSWORD" | pnpm admin:bootstrap -- --username <admin-username> --password-stdin
unset BOOTSTRAP_PASSWORD
```

bootstrap 只允许在没有管理员时创建首个管理员；重复执行不会覆盖已有凭据。生产环境禁止运行 `db:seed`，上线前必须配置强 `JWT_SECRET`。

## 本地启动

```bash
pnpm dev:api
pnpm dev:admin
pnpm dev:h5
```

默认地址：

- API：`http://127.0.0.1:3001`
- Admin：`http://127.0.0.1:5173`
- Miniapp H5：`http://127.0.0.1:10086`

本地详情联调建议先运行 `pnpm db:push && pnpm db:seed`。seed 中“林然”和“浪漫粉色系户外婚礼”是 BANNER + 富文本；“Jessica”和“企业年会歌手演出”是单富文本；文章 seed 包含“婚礼攻略”“活动策划”两类，前三篇绑定独立详情页，一篇不绑定。测试和调试应按这些稳定名称/标题从 API 解析 ID，不要假设 SQLite 自增值。

## 构建

```bash
pnpm --filter api build
pnpm --filter admin build
pnpm --filter miniapp build:h5
pnpm build:weapp
```

微信小程序端构建完成后，将 `apps/miniapp/dist` 导入微信开发者工具。

生产小程序包内的 API 地址是构建时写入的常量。上传前必须在根目录 `.env` 设置真实的 `TARO_APP_API_BASE_URL`，或直接执行：

```bash
TARO_APP_API_BASE_URL="$REAL_WEAPP_API_ORIGIN" pnpm build:weapp
```

`REAL_WEAPP_API_ORIGIN` 必须替换为已经部署、可公网访问、已配置到微信后台 request 合法域名的 HTTPS origin。`weapp` 构建默认会拒绝 `127.0.0.1`、`localhost`、`.test`、`example.*` 等本地或占位地址；仅本地临时调试可设置 `ALLOW_UNSAFE_MINIAPP_API_BASE_URL=true` 跳过。修改该地址后必须重新构建并重新上传小程序，否则旧包仍会请求之前编译进去的地址。

Admin 生产构建资源固定使用 `/admin/` base。构建后可用以下命令启动只监听回环地址的静态服务：

```bash
API_HOST=127.0.0.1 API_PORT=3001 PUBLIC_BASE_URL=https://your-domain.example pnpm start:api
ADMIN_HOST=127.0.0.1 ADMIN_PORT=4173 pnpm start:admin
```

该服务只服务 `apps/admin/dist`，支持 `/admin/*` SPA 刷新 fallback；缺失的真实静态资源仍返回 404。
生产模式下 API 和 Admin 会在监听端口前拒绝非 loopback host；不要用 `API_HOST=0.0.0.0` 或 `ADMIN_HOST=0.0.0.0` 作为部署捷径。

## 人员列表参考资源

人员列表参考图及其六张可复现的示例封面资源位于 `docs/design` 和 `apps/miniapp/src/assets/generated`。重新生成资源请运行：

```bash
pnpm assets:slice:artists
```

脚本会验证参考图尺寸，并输出固定 `690 × 480` 的人员封面资源及资源清单；种子数据会按媒体库方式注册这些资源。

## 独立详情页管理

详情页是独立、可复用、可统一管理的内容实体。后台侧栏提供“详情页管理”，业务表单只选择 `detailPageId`，不再内嵌完整详情配置。公告、首页 BANNER、人员、案例和文章可以共享同一详情页；被任一业务记录引用的详情页不能删除。

后台信息架构按“数据看板 / 首页运营 / 内容管理 / 素材管理”分组，菜单、面包屑和路由高亮来自同一导航配置。人员和案例使用独立新增/编辑页，短首页运营表单保留抽屉；详见 `docs/design/admin-navigation-and-forms.md`。

小程序所有新入口统一跳转到：

```text
/pages/detail/index?id=<detailPageId>
```

`detailPageId` 为空时入口不可点击，也不会回退旧 `linkType/linkTarget` 或 owner 详情页。旧人员/案例详情路由仅作为兼容跳板。

支持：

- `banner_rich_text`：独立名称、Hero、1–6 张有序图片 BANNER 和富文本。
- `rich_text`：只有富文本，没有 BANNER DOM、高度、页码或负重叠。

重新生成详情参考资源：

```bash
pnpm assets:slice:artist-detail
```

脚本校验 `898 × 1751` 权威参考图和 SHA-256，输出坐标网格、显式 manifest、26 个确定性资源与 contact sheet。架构、安全白名单、视觉测量和第三种 renderer 扩展步骤见 `docs/design/detail-page-system.md`。

## 文章模块

后台“内容管理 / 文章管理”提供文章 CRUD，字段包括标题、分类、封面、摘要、发布时间、精选、排序、状态和可空详情页。文章详情复用独立详情页，不包含文章专属正文、富文本渲染器、分类表、slug、作者、点赞、评论或审核流程。

文章分类来自 `articles.category` 字符串，按 NFKC、trim、连续空格压缩规范化，非空且最长 30 字。首页菜单支持 type `article`，配置为 `{ "category": "婚礼攻略", "pageSize": 10 }` 或省略分类表示全部文章；小程序用 `navigateTo` 打开 `/pages/articles/list` 并携带 query。

首页返回 `featuredArticles`，最多 2 条启用精选文章；小程序首页和文章列表共用 `ArticleCard`。媒体删除保护包含 `article.cover`，详情页引用保护包含 sourceType `article`。完整模型、接口、seed、截图路径和资源复用说明见 `docs/design/article-module.md`；本模块复用已有资源，未使用参考图切片。

## 测试

```bash
pnpm lint
pnpm test
pnpm e2e
pnpm security:release-gate
```

E2E 会自动启动 API、Admin 和 Taro H5，并生成首页设计复核截图 `docs/design/actual-home-h5.png`。
`security:release-gate` 是上线安全门禁，覆盖默认凭据、弱 JWT、生产 seed、loopback 反向代理、CORS、限流、会话撤销、日志脱敏和备份恢复文档契约；`pnpm release:check` 会先执行该门禁。

聚焦公共详情工作流和四张视觉截图：

```bash
pnpm e2e -- --project=miniapp-h5 --grep "详情"
pnpm e2e -- --project=miniapp-h5 --grep "四种详情页视觉截图与人员详情对齐差异图"
```

第二条命令使用约 `427 × 922` viewport、DPR 2，固定首张 BANNER，等待字体和图片稳定，生成四张准确命名截图、`overlay-artist-detail.png`、`diff-artist-detail.png` 和带 SHA-256 的视觉证据 JSON。差异图按宽度等比缩放参考、顶部对齐并裁到较短高度，不代表像素级一致。

## 上传目录

本地上传文件存储在仓库根目录 `uploads`。资源库不区分业务用途；资源保存全局唯一资源名、原始文件名、MD5、真实格式与尺寸、标签、上传人和时间，物理文件使用随机 32 位十六进制名称防止覆盖。业务表单继续以整数资源 ID 建立关联。

管理端会在上传前读取图片/视频尺寸并分片计算 MD5；服务端会重新计算并校验。MD5 已存在时直接复用资源；Banner、菜单图标、案例封面、文章封面等固定槽位仅展示推荐尺寸，上传和最终保存不限制图片尺寸，但仍会校验资源类型和可解析元数据。正在被站点配置、Banner、菜单、案例封面、文章封面、公共详情 BANNER/富文本或人员头像引用的资源不可删除。

## 对象存储预留

一期默认使用本地存储，数据库字段已保留 `storageType` 和稳定 `url`。本地资源入库保存 `/uploads/<filename>` 相对路径；API 响应会按当前 `PUBLIC_BASE_URL` 生成公网绝对 URL，并兼容旧库里保存的本地绝对 URL。生产迁移对象存储时建议保持 API 返回 URL 不变，或通过 CDN/对象存储域名更新 `PUBLIC_BASE_URL`。

## 生产注意事项

- 使用 `admin:bootstrap` 创建首个管理员，并配置强 `JWT_SECRET`。
- 生产环境不要运行 `pnpm db:seed`；该命令会在写入前失败。
- 上线前运行 `pnpm security:release-gate`；任一自动化 P0/P1 门禁失败都不得发布。
- 推荐以 Nginx 作为唯一公网入口：`/admin/` 代理到 Admin 静态服务，`/api/` 和 `/uploads/` 代理到 API。
- 生产 API/Admin 只能绑定 `127.0.0.1`、`localhost`、`::1` 等 loopback；禁止通过 `API_HOST=0.0.0.0` 或 `ADMIN_HOST=0.0.0.0` 暴露服务。容器、多主机或多实例部署必须先创建 Planner revision 重新定义网络边界。
- 设置生产 `DATABASE_URL`、`PUBLIC_BASE_URL`、`TARO_APP_API_BASE_URL`；同源 Nginx 部署下 `VITE_API_BASE_URL` 留空。`TARO_APP_API_BASE_URL` 必须是真实 HTTPS origin，不能是 `127.0.0.1`、`localhost`、`.test` 或 `example.*` 占位地址。
- `PUBLIC_BASE_URL` 必须是公网 origin，例如 `https://your-domain.example`，不要追加 `/api`。
- 生产 `/api/client/**` 除 `POST /api/client/auth/wechat` 外都需要微信小程序客户端会话；小程序端通过 `wx.login` 取得 code 后换取短期 client bearer token。CORS、Origin、Referer、User-Agent 或自定义 Header 不能作为“只有小程序可访问”的身份边界。
- 生产必须配置真实 `WECHAT_MINIAPP_APP_ID`、`WECHAT_MINIAPP_APP_SECRET` 和 `WECHAT_AUTH_VERIFIER_MODE=wechat`；缺失、占位或 fake verifier 会让 API 启动失败。
- Admin upstream 默认 `127.0.0.1:4173`，API upstream 默认 `127.0.0.1:3001`，公网只开放 Nginx。
- 为 `/uploads` 或对象存储配置备份、访问控制和 CDN。
- 后台“账号安全 / 备份与恢复”支持创建全量备份、查看列表、删除、导入 `.tar`/`.tar.gz` 外部备份并执行 `RESTORE_FULL_BACKUP` 二次确认恢复。恢复成功会撤销所有管理员会话。
- 从旧版本升级前必须同时备份 SQLite 数据库与完整 `uploads` 目录。迁移预检遇到缺失文件或无法解释的非空旧 `mediaJson` 会停止，不会猜测或丢弃数据。
- 使用 HTTPS API 域名，并在微信小程序后台配置 request 合法域名；上线前用真实小程序复核 `wx.login -> /api/client/auth/wechat -> /api/client/home`。如果真机报 `ERR_CONNECTION_CLOSED`，先确认小程序包内编译进去的 `TARO_APP_API_BASE_URL` 是真实可访问域名，而不是验证或文档里的占位地址。
- 部署前运行 `pnpm deploy:smoke`、`pnpm test:deploy` 和 `pnpm security:release-gate` 检查配置层面的 loopback upstream 和 P0/P1 自动化安全契约；真实 TLS、防火墙、安全组、磁盘容量、异地备份、调度器和灾难演练仍必须在目标环境人工验证。
- 使用 `pnpm build:weapp` 后在微信开发者工具中复核页面、TabBar、上传资源访问和接口域名。

Nginx 模板和完整部署、验证、备份、回滚步骤见 `docs/deploy/nginx-production-routing.md`。

## 文档

- 阶段文档：`docs/stages`
- 接口文档：`docs/api/index.md`
- 设计资料和截图：`docs/design`
- 项目规范：`AGENTS.md`
- Codex 复杂任务规划、Goal 持久化、恢复与安全清理：
  `docs/codex/planning-and-goals.md`

## Codex 复杂任务编排

局部低风险修改直接执行；跨模块、架构、迁移、安全、并发或不确定需求先由
只读 Planner 定义唯一 Goal。运行期计划位于被 Git 忽略的
`.codex/runtime/plans/<task-id>/`，而项目 Agent 模板位于受版本控制的
`.codex/agents/`。

常用入口：

```bash
pnpm codex:task:classify --request "修正 README 标题错别字" --affected-path README.md
pnpm codex:plan:init --task-id 20260712T000000Z-example-plan --classification COMPLEX
pnpm codex:plan:verify --task-id 20260712T000000Z-example-plan
```

完整门槛、Planner 唯一 Goal 权限、不可变文件、委派/结果模板、revision、恢复、
完整性校验、并发限制、清理命令和已知 CLI 限制见
`docs/codex/planning-and-goals.md`。
