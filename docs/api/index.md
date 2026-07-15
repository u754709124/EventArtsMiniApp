# API Documentation

所有接口使用统一响应信封。管理接口需要管理员 `Authorization: Bearer <token>`；生产客户端接口中，`/api/client/**` 除 `POST /api/client/auth/wechat` 外均需要后端签发的客户端会话 token。

```json
{ "success": true, "data": {}, "message": "ok" }
```

```json
{ "success": false, "error": { "code": "ERROR_CODE", "message": "错误信息" } }
```

未知 5xx 和可恢复媒体处理错误不会向客户端返回内部异常、SQL、文件路径或堆栈；错误体会在 `error.requestId` 中返回请求 ID，响应头也包含 `X-Request-Id`，用于和结构化日志关联：

```json
{ "success": false, "error": { "code": "INTERNAL_ERROR", "message": "服务异常，请稍后再试", "requestId": "..." } }
```

API CORS 使用显式 allowlist。带 `Origin` 的浏览器请求仅允许 `CORS_ALLOWED_ORIGINS` 中的 origin；未知、畸形或通配 origin 返回 `403/FORBIDDEN`。无 `Origin` 的服务端请求由 `CORS_ALLOW_REQUESTS_WITHOUT_ORIGIN` 控制。

CORS、`Origin`、`Referer`、`User-Agent`、自定义 Header 或 IP 白名单都不是小程序客户端身份依据；它们只能作为浏览器跨域或风控辅助信号。生产 `/api/client/**` 的身份边界以微信 `wx.login` code 经服务端 `code2Session` 校验后签发的短期客户端会话为准。AppSecret 只存在 API 服务端环境变量中；`session_key` 不返回前端，不作为客户端 token，也不得写入示例、日志或错误响应。

## Admin Auth And Rate Limits

首次管理员不再由 seed 创建。部署时使用 `pnpm --filter api admin:bootstrap -- --username <name> --password-stdin` 从标准输入创建首个管理员；该命令仅在没有管理员时成功，强密码要求为 12-128 字符、无空白、至少包含大小写字母/数字/符号中的三类。

- `POST /api/admin/auth/login`：body `{ "username": string, "password": string }`，成功返回 `{ "token": string, "id": number, "username": string }`。失败登录按客户端 IP + 规范化用户名限流，默认 15 分钟内最多 5 次失败；命中后返回 `429/RATE_LIMITED` 和 `Retry-After`。
- `POST /api/admin/auth/logout`：需要管理员 token，撤销当前服务器端 session。
- `GET /api/admin/auth/me`：需要管理员 token，返回当前管理员。
- `POST /api/admin/auth/change-password`：需要管理员 token，body `{ "currentPassword": string, "newPassword": string, "confirmPassword": string }`。新密码必须满足强密码策略；修改成功后撤销该管理员的所有服务器端 session，并返回 `{ "revokedSessionCount": number }`。

管理员 token 有效期为 2 小时，JWT 内含 `jti`，每次受保护请求都会校验服务器端 session 状态。登出、修改密码和全量恢复会写撤销状态；被撤销、过期或不存在的 session 即使 JWT 未过期也不能继续访问后台接口。

应用层限流使用固定窗口策略。登录限流默认由 `LOGIN_RATE_LIMIT_WINDOW_MS=900000` 和 `LOGIN_RATE_LIMIT_MAX_FAILURES=5` 控制；匿名页面统计限流默认由 `ANALYTICS_RATE_LIMIT_WINDOW_MS=60000` 和 `ANALYTICS_RATE_LIMIT_MAX_REQUESTS=60` 控制。

## Client

- `POST /api/client/auth/wechat`
- `GET /api/client/home`
- `GET /api/client/announcements/:id`
- `GET /api/client/detail-pages/:id`
- `GET /api/client/menu-items`
- `GET /api/client/cases?q=&category=`
- `GET /api/client/cases/:id`
- `GET /api/client/articles?q=&category=&page=&pageSize=`
- `GET /api/client/artists?type=host|singer|actor&q=&location=&tag=`（`type` 省略时默认为 `host`）
- `GET /api/client/artists/:id`
- `POST /api/client/track/page-view`

### Client Auth

`POST /api/client/auth/wechat` 是 `/api/client/**` 唯一不要求客户端会话的生产例外。小程序端先调用 `wx.login` 取得一次性登录凭证，再把该凭证作为请求体 `code` 提交给 API。请求体只允许一个字段：`code: string`，trim 后 1-512 字符。该接口沿用统一响应信封；成功响应的 `data` 形状为 `{ token: string, tokenType: "Bearer", expiresInSeconds: number, expiresAt: ISODateTimeString }`。响应不包含 `session_key`、AppSecret、微信上游原始响应或 openid。

登录交换错误码契约：

| 状态 | `error.code` | 含义 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | 请求体缺失、字段多余或格式不合法 |
| 401 | `INVALID_WECHAT_CODE` | code 无效、过期、重复使用、微信拒绝或目标 AppID 不匹配 |
| 429 | `RATE_LIMITED` | 登录交换请求过于频繁；响应包含 `Retry-After` |
| 502/504 | `WECHAT_AUTH_UNAVAILABLE` | 微信上游不可用、超时或服务端微信配置不可用 |
| 500 | `INTERNAL_ERROR` | 未知服务端错误；只返回脱敏 `requestId` |

除 `POST /api/client/auth/wechat` 外，生产 `/api/client/**` 请求必须带 `Authorization: Bearer <client-session-token>`。无 token、伪造 Header/Origin/Referer/User-Agent、未知 token、管理员 JWT、过期 token 或已撤销 token 都返回 401；客户端会话错误码为 `CLIENT_AUTH_REQUIRED`、`CLIENT_SESSION_EXPIRED` 或 `CLIENT_SESSION_REVOKED`。客户端 token 与管理员 token 语义隔离，不能访问 `/api/admin/**`，管理员 token 也不能访问 `/api/client/**`。

服务端 `wechat` verifier 调用微信 `jscode2session` 适配器，使用服务端环境变量中的 AppID/AppSecret 和小程序提交的临时 code 换取微信登录结果。测试环境使用注入式 fake verifier，不访问真实微信网络，也不需要真实 AppSecret。当前自动化覆盖 adapter URL、参数、超时/错误映射和 fake provider 行为；真实微信平台联调、request 合法域名和生产 AppSecret 有效性仍属于上线前人工/G15 验证项。

客户端会话 token 是服务端生成的 opaque random Bearer token。数据库 `client_sessions` 只保存 `tokenHash`、AppID、`openidHash`、`unionidHash`、创建/过期时间和撤销状态；不保存 raw token、微信 code、`session_key`、openid 或 unionid。token 默认 30 分钟过期，不设 refresh token；撤销、过期、未知和格式错误的 token 均不能访问客户端 API。

登录交换使用应用层固定窗口限流，默认复用 `LOGIN_RATE_LIMIT_WINDOW_MS` / `LOGIN_RATE_LIMIT_MAX_FAILURES`。微信上游超时映射为 `504/WECHAT_AUTH_UNAVAILABLE`，微信服务不可用或服务端 verifier 配置不可用映射为 `502/WECHAT_AUTH_UNAVAILABLE`，微信拒绝 code 或 AppID 不匹配映射为 `401/INVALID_WECHAT_CODE`；安全日志只记录脱敏原因、requestId、错误码、会话 ID 和派生 hash。

相关生产配置：

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `WECHAT_MINIAPP_APP_ID` | 空 | 生产必填，必须是目标微信小程序 AppID；缺失、占位或格式异常时 API 启动失败 |
| `WECHAT_MINIAPP_APP_SECRET` | 空 | 生产必填，只保存在 API 服务端；缺失或占位时 API 启动失败 |
| `WECHAT_AUTH_VERIFIER_MODE` | `wechat` | `wechat` 使用生产 verifier；`fake` 只允许 dev/test，生产启用会启动失败 |
| `CLIENT_SESSION_TTL_SECONDS` | `1800` | 客户端会话有效期，默认 30 分钟 |
| `WECHAT_CODE2SESSION_TIMEOUT_MS` | `3000` | 服务端调用微信 `code2Session` 的上游超时 |

`POST /api/client/track/page-view` 请求体为 `{ "pagePath": string, "scene"?: string }`。`pagePath` trim 后最长 256 字符，`scene` trim 后最长 64 字符；User-Agent 会规范化并最多保存 256 字符。服务端使用可信客户端 IP 与规范化 User-Agent 生成每日轮换 HMAC 匿名指纹，不保存原始 IP。页面访问默认按 10% 确定性采样，入库记录携带 `sampleWeight=10`，同一匿名指纹、页面和场景在 30 秒内只计一次。

案例详情的兼容 `media` 从独立详情页派生；小程序以公共 `/api/client/detail-pages/:id` 返回的 `blocks` 为准，不直接渲染兼容列表。

`GET /api/client/home` 只返回 `status=enabled` 且 `showOnHome=true` 的菜单，并额外返回 `featuredArticles`，最多 2 条启用且精选的文章，排序为 `featuredSortOrder ASC, publishedAt DESC, id ASC`。`GET /api/client/menu-items` 返回全部启用菜单，供分类页展示。菜单字段包含 `showOnHome`，后台仍使用 `/api/admin/menu-items` 管理。`GET /api/client/cases?q=&category=` 的 `q` 会 trim，空白等同未传，并在标题、分类、标签、简介和地点中做大小写不敏感匹配；`category` 会按案例分类精确筛选。

`GET /api/client/articles?q=&category=&page=&pageSize=` 只返回启用文章，排序为 `sortOrder ASC, publishedAt DESC, id ASC`。`category` 按规范化分类精确筛选；`pageSize` 默认 10，最大 50。响应：

```json
{
  "items": [
    {
      "id": 1,
      "title": "婚礼流程筹备攻略",
      "category": "婚礼攻略",
      "coverUrl": "http://127.0.0.1:3001/uploads/seed/example.png",
      "summary": "从档期、仪式流程到现场协同...",
      "publishedAt": "2026-06-10T09:00:00.000Z",
      "detailPageId": 1,
      "hasDetailPage": true,
      "isFeatured": true,
      "featuredSortOrder": 1,
      "sortOrder": 1,
      "status": "enabled"
    }
  ],
  "total": 2,
  "page": 1,
  "pageSize": 10,
  "categories": ["婚礼攻略", "活动策划"]
}
```

`categories` 始终来自全部启用文章分类，不受当前文章分类筛选页的限制。

### Common detail-page response

`GET /api/client/detail-pages/:id` 返回独立、自包含的 `DetailPageConfigDto`。业务列表、首页、人员详情和案例详情只携带 `detailPageId`/`hasDetailPage`；兼容详情接口会在有引用时附带 `detailPage`，但新小程序入口统一使用公共详情路由。

```json
{
  "id": 1,
  "name": "林然个人详情",
  "type": "banner_rich_text",
  "typeLabel": "BANNER + 富文本",
  "rendererKey": "bannerRichText",
  "schemaVersion": 1,
  "hero": {
    "title": "林然",
    "typeLabel": "主持人",
    "subtitle": "温暖・专业・掌控全场",
    "badge": "金牌主持",
    "tags": ["10年经验", "婚礼主持"],
    "location": "杭州",
    "metaItems": []
  },
  "heroSubtitle": "温暖・专业・掌控全场",
  "banners": [
    {
      "id": 1,
      "assetId": 10,
      "url": "http://127.0.0.1:3001/uploads/seed/example.png",
      "width": 1420,
      "height": 580,
      "sortOrder": 0
    }
  ],
  "richTextHtml": "<section class=\"ea-detail-card\">...</section>",
  "blocks": [
    { "type": "richText", "html": "<section class=\"ea-detail-card\">...</section>" },
    {
      "type": "video",
      "assetId": 20,
      "url": "http://127.0.0.1:3001/uploads/seed/example.mp4",
      "posterUrl": null,
      "width": 1920,
      "height": 1080
    }
  ]
}
```

`rich_text` 使用 `rendererKey: "richText"`，并保证空 Hero、`heroSubtitle: ""`、`banners: []`；它没有 BANNER DOM 或占位高度。公共详情不存在返回 `DETAIL_PAGE_NOT_FOUND`，未知持久化类型返回 `UNKNOWN_DETAIL_PAGE_TYPE`。

### Artist client APIs

`GET /api/client/artists` 仅返回启用人员，严格按 `type` 过滤，并以 `sortOrder`、`id` 升序排序。`type` 仅允许 `host`、`singer`、`actor`；非法值返回 `400 VALIDATION_ERROR`。可选 `q` 会匹配姓名、演绎地点、左上标签、下方标签和描述；`location`、`tag` 分别精确筛选地点和标签。

列表和详情都返回以下人员基础字段，客户端不会收到数据库中的原始 `tagsJson` 字符串；只有 `GET /api/client/artists/:id` 额外返回 `detailPage`，并把兼容 `detail` 从其富文本派生：

```json
{
  "id": 1,
  "name": "林然",
  "type": "host",
  "coverUrl": "http://127.0.0.1:3001/uploads/seed/xxx.png",
  "avatarUrl": "http://127.0.0.1:3001/uploads/seed/xxx.png",
  "location": "杭州",
  "badge": "金牌主持",
  "tags": ["10年经验", "婚礼主持", "高端晚宴", "控场力强"],
  "summary": "风格大气沉稳，擅长情感共鸣，深受新人喜爱，让每一场仪式都温暖动人。",
  "detail": "详情接口中从 detailPage.richTextHtml 派生的兼容字段",
  "detailPageId": 1,
  "hasDetailPage": true,
  "sortOrder": 1,
  "status": "enabled"
}
```

## Admin Media Assets

- `GET /api/admin/media-assets/upload-config`：返回图片/视频格式、大小上限和所有 `MediaFieldKey` 规则。
- `GET /api/admin/media-assets`：查询参数支持 `mediaType`、`q`、`tag`、`referenceStatus=used|unused`、`width`、`height`、`page`、`pageSize`。
- `GET /api/admin/media-assets/:id`：读取表单当前关联资源。
- `GET /api/admin/media-assets/tags`：返回标签及资源数量。
- `POST /api/admin/media-assets/lookup`：body `{ "md5": "32位MD5", "size": 123 }`。
- `POST /api/admin/media-assets/check-name`：body `{ "resourceName": "名称", "excludeId": 1 }`，`excludeId` 可选。
- `POST /api/admin/media-assets/upload`：multipart 字段为 `file`、`md5`、`resourceName`、JSON 字符串 `tags`，以及可选 `fieldKey`；返回 `{ asset, reused }`。
- `PATCH /api/admin/media-assets/:id`：body `{ "resourceName": "名称", "tags": ["标签"] }`。
- `DELETE /api/admin/media-assets/:id`：只允许删除零引用资源。
- `POST /api/admin/media-assets/scan-unused`：重新统计并返回全部零引用资源。
- `POST /api/admin/media-assets/batch-delete`：body `{ "ids": [1, 2] }`，返回 `deletedIds`、`skipped`、`failed`。

资源库上传不传用途。表单本地上传传 `fieldKey` 可提前检查槽位，但业务保存仍会再次校验。资源名按 NFKC、首尾空格和英文大小写标准化后全局唯一；相同 MD5 与大小直接复用已有资源且不修改其名称和标签。

默认允许 JPG、PNG、WebP（10MB）和 MP4（100MB），可用 `MAX_IMAGE_UPLOAD_BYTES`、`MAX_VIDEO_UPLOAD_BYTES` 覆盖。服务端重新计算 MD5，并从真实内容提取 MIME、宽高；物理文件使用随机 32 位十六进制名称。

资源引用统计包含站点配置、首页 BANNER、菜单图标、案例封面、文章封面、人员列表封面、旧案例详情媒体和公共详情页 BANNER/富文本媒体。文章封面来源类型为 `article_cover`。

## Admin Backups

备份管理接口均需要管理员 `Bearer` token。备份目录和导入暂存目录均位于 `BACKUP_DIR`，不会通过 `/uploads` 静态暴露；接口响应不返回本地文件路径、归档内容或 raw SQL。

- `GET /api/admin/backups`：返回 `{ "backups": BackupDto[] }`，不返回备份目录、本地路径或公共下载 URL。
- `POST /api/admin/backups`：body `{ "note"?: string }`，创建一致性备份并返回 `{ "backup": BackupDto }`。
- `POST /api/admin/backups/import`：multipart 字段 `file` 或 `archive` 上传 `.tar`/`.tar.gz` 外部备份。服务端先解包到 `BACKUP_DIR/.imports` 隔离暂存区，完整预检通过后发布为普通 `import-*` 备份条目，并返回 `{ "backup": BackupDto, "preflight": BackupPreflightSummary }`。
- `POST /api/admin/backups/:id/restore`：body `{ "backupId": "<same-id>", "confirmation": "RESTORE_FULL_BACKUP" }`。确认字符串和路径 ID 必须完全匹配；缺失或错误确认会在创建恢复点、进入维护模式或修改 DB/uploads 前失败。
- `DELETE /api/admin/backups/:id`：body `{ "backupId": "<same-id>", "confirmation": "DELETE_BACKUP" }`，只删除 `ready`/`failed` 等可删除状态；`verifying`、`restoring` 等状态返回 `409/BACKUP_CONFLICT`。

备份格式版本为 `formatVersion: 1`。每个备份发布为后台专用备份目录中的私有目录，包含 `database.sqlite`、`uploads/...` 文件副本和 `manifest.json`。数据库快照使用 SQLite `VACUUM INTO` 一致性机制生成，禁止直接复制活动数据库文件。

`manifest.json` 包含：

- `app`：应用名称和版本。
- `schema`：SQLite provider、SQLite 版本、`userVersion`、schema hash 和 migration id。
- `createdBy`、`createdAt`、`note`。
- `database`：快照路径、大小、SHA-256、`snapshotMethod: "sqlite-vacuum-into"`、page size 和 page count。
- `uploads`：每个收集文件的安全相对路径、大小、SHA-256 和修改时间。
- `totalBytes`、`totalFiles` 和整备份内容 SHA-256。

uploads 收集只包含普通文件，排除备份目录、`.tmp`、`.trash`、隐藏文件/目录、临时扩展名、符号链接、目录和任何越过 uploads root 的路径。创建过程先写入备份目录下的 staging 目录，完成文件校验和 manifest 校验后再原子发布；失败会清理 staging，不会留下 partial published backup。并发创建会安全拒绝为 `409/BACKUP_CONFLICT`。

导入预检会拒绝绝对路径、`..`、反斜杠路径、符号链接、硬链接、PAX/长名扩展、设备文件、不支持 tar 类型、过多文件、过大展开体积、过高展开比、版本不兼容、manifest schema 错误、文件大小或 SHA-256 不匹配、SQLite `integrity_check`/`foreign_key_check` 失败、schema metadata 不兼容，以及媒体库 `media_assets.filename` 与归档 `uploads/...` 清单不一致。预检摘要只包含版本、创建者、数据库大小、uploads 数量、表级影响行数和检查状态。

恢复执行顺序为：确认请求体和路径 ID、进入维护模式并阻止业务写入、重新预检候选备份、自动创建 G08 恢复点、把候选 DB/uploads 物化到生产目录旁的 `.new` 路径、切换 SQLite 与 uploads、切换后再次校验、撤销所有管理员 session。切换失败会尽力将 `.old` 状态回滚到生产路径；成功响应包含 `restoreId`、原始 `backupId`、`snapshotBackupId` 和 `revokedSessionCount`。

创建、删除、导入和恢复成功/失败均写 `operation_logs`，并通过结构化安全日志记录 `backup_create_*`、`backup_delete_*`、`backup_import_*`、`backup_restore_*` 事件；日志包含来源、操作者、结果和 requestId，但不记录归档内容、敏感请求体、Authorization、Cookie、JWT 或部署 secret。

## Media Field Rules

| 字段                                    | 类型       | 推荐尺寸 / 约束                                      |
| --------------------------------------- | ---------- | ----------------------------------------------------- |
| Banner 占位图、Banner 图片              | 图片       | 推荐 1420×580；尺寸不限但必须可解析                   |
| 菜单图标、菜单占位图                    | 图片       | 推荐 176×176；尺寸不限但必须可解析                    |
| 案例封面、案例封面占位图                | 图片       | 推荐 460×320；尺寸不限但必须可解析                    |
| 文章封面                                | 图片       | 尺寸不限但必须可解析                                  |
| 人员列表封面图                          | 图片       | 推荐 690×480；尺寸不限但必须可解析                    |
| 案例详情媒体                            | 图片或视频 | 尺寸不限但必须可解析                                  |
| 详情 BANNER                             | 图片       | 尺寸不限但必须可解析；每页 1–6 张，禁止视频与重复 ID  |
| 详情富文本媒体                          | 图片或视频 | 尺寸不限但必须可解析；HTML 节点类型必须与资源类型一致 |

## Other Admin APIs

- `POST /api/admin/auth/login`、`POST /api/admin/auth/logout`、`GET /api/admin/auth/me`
- `GET /api/admin/dashboard/overview`
- `GET|POST /api/admin/backups`
- `POST /api/admin/backups/import`
- `POST /api/admin/backups/:id/restore`
- `DELETE /api/admin/backups/:id`
- `GET|PUT /api/admin/site-config`
- `GET|POST|PUT|DELETE /api/admin/announcements`
- `GET|POST|PUT|DELETE /api/admin/banners`
- `GET|POST|PUT|DELETE /api/admin/menu-items`
- `GET /api/admin/case-categories`
- `GET|POST|PUT|DELETE /api/admin/cases`
- `GET /api/admin/articles/categories`
- `GET|POST|PUT|DELETE /api/admin/articles`
- `GET /api/admin/articles/:id`
- `GET|POST|PUT|DELETE /api/admin/artists`
- `GET /api/admin/detail-pages`
- `GET /api/admin/detail-pages/options`
- `GET|POST|PUT|DELETE /api/admin/detail-pages/:id`
- `GET /api/admin/detail-pages/:id/references`
- `POST /api/admin/detail-pages/preview`

`GET /api/admin/dashboard/overview` 返回兼容字段 `todayPv`、`weekPv`、`monthPv`，这些值按 `sampleWeight` 加权聚合，表示估算浏览人次；响应可包含 `estimated`、`sampleRate` 和 `sampleWeight` 说明采样语义。

公告、首页 BANNER、人员、案例和文章创建/更新请求只提交 `detailPageId: number | null` 来选择独立详情页。旧 `detail`、`detailMediaAssetIds`、BANNER `linkType/linkTarget` 不再是新表单的详情来源。所有媒体字段仍提交整数资源 ID。分类菜单接口保留 `/api/admin/menu-items`，菜单创建默认 `showOnHome: true`；关闭后仅从首页隐藏，分类页仍展示，`status=disabled` 时前台均不展示。`GET /api/admin/case-categories` 返回已有案例分类的去重字符串数组，供分类菜单和案例表单选择。`GET /api/admin/articles/categories?q=&limit=` 返回 `{ "categories": string[] }`，来源是 `articles.category`，包含启用和停用文章分类，没有文章分类表。

菜单类型共有 7 种：`host`、`singer`、`actor`、`activity_case`、`article`、`detail_page`、`contact`。创建或更新 `detail_page` 时提交严格配置：

```json
{
  "type": "detail_page",
  "configJson": {
    "detailPageType": "rich_text",
    "detailPageId": 12
  }
}
```

`detailPageType` 仅接受 `banner_rich_text` 或 `rich_text`，`detailPageId` 必须为正整数。缺失配置或类型不匹配返回 `400 VALIDATION_ERROR`；目标不存在返回 `404 DETAIL_PAGE_NOT_FOUND`。服务端以详情页真实 `pageType` 为准。菜单引用会以 `sourceType: "menu"` 出现在详情页反向引用中，并参与 `referenceCount` 与 `DETAIL_PAGE_IN_USE` 删除保护；删除菜单、切换类型或更换目标后旧引用立即释放。损坏的历史菜单配置降级为空配置，不会使菜单批量接口失败。

Article admin create body:

```json
{
  "title": "婚礼流程筹备攻略",
  "category": "婚礼攻略",
  "coverAssetId": 1,
  "summary": "不超过 240 字的摘要",
  "publishedAt": "2026-06-10T09:00:00.000Z",
  "isFeatured": true,
  "featuredSortOrder": 1,
  "sortOrder": 1,
  "status": "enabled",
  "detailPageId": 1
}
```

`category` 按 NFKC、trim、连续空格压缩规范化，非空且最长 30 字；英文去重忽略大小写。`title` 最长 100 字，`summary` 最长 240 字，`coverAssetId` 必须是存在的图片资源，`detailPageId` 可为 `null`。创建、更新和删除会写 `OperationLog`；删除文章不会删除封面或详情页。

### Detail-page admin input and preview

两种合法输入是严格互斥的 discriminated union：

```json
{
  "name": "林然个人详情",
  "type": "banner_rich_text",
  "hero": {
    "title": "林然",
    "typeLabel": "主持人",
    "subtitle": "专业策划・精彩呈现",
    "badge": "金牌主持",
    "tags": ["婚礼主持"],
    "location": "杭州",
    "metaItems": []
  },
  "bannerAssetIds": [10, 11, 12],
  "richTextHtml": "<section class=\"ea-detail-card\"><p>内容</p></section>"
}
```

```json
{
  "name": "普通图文详情",
  "type": "rich_text",
  "richTextHtml": "<section class=\"ea-detail-card\"><p>内容</p></section>"
}
```

`POST /api/admin/detail-pages/preview` body 为 `{ "detailPage": <上述输入> }`，响应为公共 `DetailPageConfigDto`。`POST /api/admin/detail-pages` 与 `PUT /api/admin/detail-pages/:id` 使用同一输入。预览与保存使用同一套服务端媒体查库、HTML 清洗、URL 重写、语义空验证和 blocks parser。

`banner_rich_text` 要求 trim 后非空宣传语、1–6 个唯一图片 ID 和语义非空富文本。`rich_text` 只接受 `richTextHtml`，不接受宣传语或 BANNER。HTML 中图片/视频必须提供正整数 `data-media-asset-id`；API 不信任客户端 `src`，会从 `MediaAsset.url` 重写。允许协议、HTML/CSS 白名单和迁移细节见 `docs/design/detail-page-system.md`。

### Admin artist APIs

`POST /api/admin/artists` 创建人员时必须提交以下字段：

```json
{
  "name": "林然",
  "type": "host",
  "avatarAssetId": 1,
  "location": "杭州",
  "badge": "金牌主持",
  "tags": ["10年经验", "婚礼主持"],
  "summary": "不超过 120 字的人员描述",
  "detailPageId": 1,
  "sortOrder": 1,
  "status": "enabled"
}
```

`name`、`location`、`badge`、`summary` 均会 trim 后校验非空；`location` 最长 30 字，`badge` 和单个标签最长 12 字，`tags` 为去空、去重后的 1 至 4 项。`avatarAssetId` 是有效的图片资源 ID，并在后台文案中称为“列表封面图”。`detailPageId` 可为 `null`，非空时必须引用已存在详情页；`PUT /api/admin/artists/:id` 支持基础字段和 `detailPageId` 局部更新。

后台人员列表和创建/更新响应都会返回安全的 `tags: string[]`，同时保留已解析为数组的兼容 `tagsJson`；服务端只通过统一的标签序列化方法写入一次 JSON，避免双重编码。

媒体错误码：`DUPLICATE_RESOURCE_NAME`、`MD5_MISMATCH`、`HASH_COLLISION`、`INVALID_MEDIA_TYPE`、`INVALID_MEDIA_METADATA`、`FILE_TOO_LARGE`、`MEDIA_IN_USE`、`MEDIA_RECOVERY_FAILED`。
