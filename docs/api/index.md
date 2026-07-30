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
{
  "success": false,
  "error": { "code": "INTERNAL_ERROR", "message": "服务异常，请稍后再试", "requestId": "..." }
}
```

API CORS 使用显式 allowlist。带 `Origin` 的浏览器请求仅允许 `CORS_ALLOWED_ORIGINS` 中的 origin；未知、畸形或通配 origin 返回 `403/FORBIDDEN`。无 `Origin` 的服务端请求由 `CORS_ALLOW_REQUESTS_WITHOUT_ORIGIN` 控制。

CORS、`Origin`、`Referer`、`User-Agent`、自定义 Header 或 IP 白名单都不是小程序客户端身份依据；它们只能作为浏览器跨域或风控辅助信号。生产 `/api/client/**` 的身份边界以微信 `wx.login` code 经服务端 `code2Session` 校验后签发的短期客户端会话为准。AppSecret 只存在 API 服务端环境变量中；`session_key` 不返回前端，不作为客户端 token，也不得写入示例、日志或错误响应。

## Admin Auth And Rate Limits

首次管理员不再由 seed 创建。部署时使用 `pnpm --filter api admin:bootstrap -- --username <name> --password-stdin` 从标准输入创建首个管理员；该命令仅在没有管理员时成功，强密码要求为 12-128 字符、无空白、至少包含大小写字母/数字/符号中的三类。

- `POST /api/admin/auth/login`：body `{ "username": string, "password": string }`，成功返回 `{ "token": string, "id": number, "username": string }`。失败登录按客户端 IP + 规范化用户名限流，默认 15 分钟内最多 5 次失败；命中后返回 `429/RATE_LIMITED` 和 `Retry-After`。
- `POST /api/admin/auth/logout`：需要管理员 token，撤销当前服务器端 session。
- `GET /api/admin/auth/me`：需要管理员 token，返回当前管理员。
- `POST /api/admin/auth/change-password`：需要管理员 token，body `{ "currentPassword": string, "newPassword": string, "confirmPassword": string }`。新密码必须满足强密码策略；修改成功后撤销该管理员的所有服务器端 session，并返回 `{ "revokedSessionCount": number }`。

管理员 token 有效期为 2 小时，JWT 内含 `jti`，每次受保护请求都会校验服务器端 session 状态。登出、修改密码和备份恢复会写撤销状态；被撤销、过期或不存在的 session 即使 JWT 未过期也不能继续访问后台接口。

### Admin RBAC and password recovery

后台角色固定为 `SUPER_ADMIN | ADMIN | USER`。`SUPER_ADMIN` 使用隐式全部菜单权限；`ADMIN` 和 `USER` 保存叶子菜单授权，菜单组只在提交时展开，不是未来子菜单的通配符。`change-password` 是所有账户固有能力，`user-management` 属于 `SUPER_ADMIN`/`ADMIN`；`backups`、`system-config`、`scheduled-tasks` 是可授予的敏感菜单，只能由 `SUPER_ADMIN` 显式授予，`ADMIN` 即使拥有这些菜单也不能继续下放。服务端按实时数据库角色、状态、session 和授权执行每个 HTTP 方法的策略；JWT 中伪造的角色或权限字段无效。

- `GET /api/admin/users`：`SUPER_ADMIN` 查看全部后台账户；`ADMIN` 只查看 `USER`。
- `POST /api/admin/users`：创建待激活 `ADMIN`/`USER` 并返回一次性 `activationLink`。`SUPER_ADMIN` 可创建二者；`ADMIN` 只能创建 `USER` 并下放自身可委派权限。
- `GET /api/admin/users/:publicId`、`PATCH /api/admin/users/:publicId`：读取或修改允许管理的账户。`SUPER_ADMIN` 可管理其他 `SUPER_ADMIN`/`ADMIN`/`USER`，但不能 Web 自助管理自身；涉及 `SUPER_ADMIN` 的角色/状态变更要求当前密码和显式确认。角色/状态变化会撤销目标 session 与未使用链接；系统始终保留至少一个启用的 `SUPER_ADMIN`。
- `PUT /api/admin/users/:publicId/permissions`：保存叶子菜单权限并撤销目标 session 与未使用链接。
- `POST /api/admin/users/:publicId/reset-links`：body `{ "purpose": "activation" | "recovery", "currentPassword": string, "confirmation": true }`。`SUPER_ADMIN` 可为 `ADMIN`/`USER` 生成链接；`ADMIN` 仅可为 `USER` 生成；同级、向上、向下越权、自助签发以及任何 `SUPER_ADMIN` Web 链接均拒绝。
- `POST /api/admin/users/:publicId/reset-links/revoke`：撤销目标尚未使用的激活/恢复链接。
- `POST /api/admin/auth/reset-password`：公开消费一次性 fragment token，body `{ "token": string, "newPassword": string, "confirmPassword": string }`。消费成功后 token 原子标记为已用，并撤销目标全部剩余 session/token。

恢复 URL 使用 `/admin/reset-password#token=...`，fragment 在页面读取后立即从地址栏清除，不进入 Referer、浏览器存储、日志、通知或快照。token 至少含 256 bit 随机量，数据库仅保存 SHA-256 hash，默认有效期 30 分钟（可配置范围 5–60 分钟）。

三条运维路径不得混用：`admin:bootstrap` 仅创建空库中的首个 `SUPER_ADMIN`；`pnpm --filter api admin:password:reset -- --username <name> --password-stdin` 只重置现有 `SUPER_ADMIN`；`ADMIN`/`USER` 忘记密码必须使用上述一次性恢复链接。

## Admin Notifications

`POST /api/admin/notifications` 和 `GET /api/admin/notifications?page=1&pageSize=20&level=error` 都要求管理员 Bearer token，并返回统一成功/失败响应。通知请求只接受：

```json
{
  "clientEventId": "4cb86b19-bdb3-4317-9dac-498fefdb6abf",
  "level": "success",
  "message": "保存成功",
  "occurredAt": "2026-07-17T12:00:00.000Z"
}
```

`level` 为 `success | error | warning | info`，消息最长 500 字符。服务端只使用鉴权会话中的管理员 ID，不接受客户端指定 `adminId`；`(adminId, clientEventId)` 唯一，因此断网重试不会生成重复历史。超过服务器时间 5 分钟的事件会被拒绝，早于滚动 7×24 小时的补传返回 `persisted: false, reason: "expired"`，客户端应丢弃。

GET 只返回当前管理员最近滚动 7×24 小时的消息，按 `occurredAt DESC, id DESC` 排序；`pageSize` 最大 100。可选查询参数 `level` 只接受 `success | error | warning | info`，过滤在数据库计数和分页前完成；不传时保持全量通知列表行为。后台右上角“日志查看”使用 `level=error`，因此分页总数只统计失败日志。读写路径会清理过期记录，也可运行 `pnpm --filter api admin:notifications:cleanup -- --dry-run` 查看待清理数量，移除 `--dry-run` 后执行清理。通知表属于当前身份平面：新 v3 备份不包含该表，导入影响预检会显示保留当前系统，恢复和 reset seed 保留/重建目标环境通知。

应用层限流使用固定窗口策略。登录限流默认由 `LOGIN_RATE_LIMIT_WINDOW_MS=900000` 和 `LOGIN_RATE_LIMIT_MAX_FAILURES=5` 控制；客户端用户统计限流默认由 `ANALYTICS_RATE_LIMIT_WINDOW_MS=60000` 和 `ANALYTICS_RATE_LIMIT_MAX_REQUESTS=60` 控制。

## Client

- `POST /api/client/auth/wechat`
- `GET /api/client/home`
- `GET /api/client/announcements/:id`
- `GET /api/client/detail-pages/:id`
- `GET /api/client/menu-items`
- `GET /api/client/cases?q=&category=`
- `GET /api/client/cases/:id`
- `GET /api/client/articles?q=&category=&page=&pageSize=`
- `GET /api/client/artists?category=&q=&location=&tag=`（`category` 省略时返回全部启用人员；旧 `type=host|singer|actor` 仅作为兼容别名）
- `GET /api/client/artists/:id`
- `POST /api/client/track/page-view`

### Client Auth

`POST /api/client/auth/wechat` 是 `/api/client/**` 唯一不要求客户端会话的生产例外。小程序端先调用 `wx.login` 取得一次性登录凭证，再把该凭证作为请求体 `code` 提交给 API。请求体只允许一个字段：`code: string`，trim 后 1-512 字符。该接口沿用统一响应信封；成功响应的 `data` 形状为 `{ token: string, tokenType: "Bearer", expiresInSeconds: number, expiresAt: ISODateTimeString }`。响应不包含 `session_key`、AppSecret、微信上游原始响应或 openid。

登录交换错误码契约：

| 状态    | `error.code`              | 含义                                                   |
| ------- | ------------------------- | ------------------------------------------------------ |
| 400     | `VALIDATION_ERROR`        | 请求体缺失、字段多余或格式不合法                       |
| 401     | `INVALID_WECHAT_CODE`     | code 无效、过期、重复使用、微信拒绝或目标 AppID 不匹配 |
| 429     | `RATE_LIMITED`            | 登录交换请求过于频繁；响应包含 `Retry-After`           |
| 502/504 | `WECHAT_AUTH_UNAVAILABLE` | 微信上游不可用、超时或服务端微信配置不可用             |
| 500     | `INTERNAL_ERROR`          | 未知服务端错误；只返回脱敏 `requestId`                 |

除 `POST /api/client/auth/wechat` 外，生产 `/api/client/**` 请求必须带 `Authorization: Bearer <client-session-token>`。无 token、伪造 Header/Origin/Referer/User-Agent、未知 token、管理员 JWT、过期 token 或已撤销 token 都返回 401；客户端会话错误码为 `CLIENT_AUTH_REQUIRED`、`CLIENT_SESSION_EXPIRED` 或 `CLIENT_SESSION_REVOKED`。客户端 token 与管理员 token 语义隔离，不能访问 `/api/admin/**`，管理员 token 也不能访问 `/api/client/**`。

服务端 `wechat` verifier 调用微信 `jscode2session` 适配器，使用服务端环境变量中的 AppID/AppSecret 和小程序提交的临时 code 换取微信登录结果。测试环境使用注入式 fake verifier，不访问真实微信网络，也不需要真实 AppSecret。当前自动化覆盖 adapter URL、参数、超时/错误映射和 fake provider 行为；真实微信平台联调、request 合法域名和生产 AppSecret 有效性仍属于上线前人工/G15 验证项。

客户端会话 token 是服务端生成的 opaque random Bearer token。数据库 `client_sessions` 只保存 `tokenHash`、AppID、`openidHash`、`unionidHash`、创建/过期时间和撤销状态；不保存 raw token、微信 code、`session_key`、openid 或 unionid。token 默认 30 分钟过期，不设 refresh token；撤销、过期、未知和格式错误的 token 均不能访问客户端 API。

登录交换使用应用层固定窗口限流，默认复用 `LOGIN_RATE_LIMIT_WINDOW_MS` / `LOGIN_RATE_LIMIT_MAX_FAILURES`。微信上游超时映射为 `504/WECHAT_AUTH_UNAVAILABLE`，微信服务不可用或服务端 verifier 配置不可用映射为 `502/WECHAT_AUTH_UNAVAILABLE`，微信拒绝 code 或 AppID 不匹配映射为 `401/INVALID_WECHAT_CODE`；安全日志只记录脱敏原因、requestId、错误码、会话 ID 和派生 hash。

相关生产配置：

| 环境变量                         | 默认值   | 说明                                                                      |
| -------------------------------- | -------- | ------------------------------------------------------------------------- |
| `WECHAT_MINIAPP_APP_ID`          | 空       | 生产必填，必须是目标微信小程序 AppID；缺失、占位或格式异常时 API 启动失败 |
| `WECHAT_MINIAPP_APP_SECRET`      | 空       | 生产必填，只保存在 API 服务端；缺失或占位时 API 启动失败                  |
| `WECHAT_AUTH_VERIFIER_MODE`      | `wechat` | `wechat` 使用生产 verifier；`fake` 只允许 dev/test，生产启用会启动失败    |
| `CLIENT_SESSION_TTL_SECONDS`     | `1800`   | 客户端会话有效期，默认 30 分钟                                            |
| `WECHAT_CODE2SESSION_TIMEOUT_MS` | `3000`   | 服务端调用微信 `code2Session` 的上游超时                                  |

`POST /api/client/track/page-view` 请求体继续兼容 `{ "pagePath": string, "scene"?: string }`；`pagePath` trim 后为 1–256 字符，`scene` 若提供则 trim 后为 1–64 字符，成功响应继续使用空对象数据的统一信封。该接口必须携带有效客户端会话；统计身份只取服务端微信登录校验后会话中的 `appId + openidHash`。`pagePath` 和 `scene` 只做兼容校验，不参与去重，也不写入新日统计表。同一 AppID 下同一微信用户在同一北京时间自然日只计一次，无论页面、场景、客户端会话或请求次数如何；跨日可再次计数。写入由数据库复合唯一约束和原子 upsert 保证并发幂等。新统计不存储原始 openid、unionid、微信 code、token、IP 或 User-Agent；旧匿名页面事件不回填且不参与新指标。

案例详情的兼容 `media` 从独立详情页派生；小程序以公共 `/api/client/detail-pages/:id` 返回的 `blocks` 为准，不直接渲染兼容列表。

`GET /api/client/home` 只返回 `status=enabled` 且 `showOnHome=true` 的菜单，并额外返回 `recentActivities` 和 `featuredArticles`。`recentActivities` 来自独立 `recent_activities` 表，返回全部启用记录，按 `sortOrder ASC, id ASC` 排序；服务端只做人工启停和排序，不按活动日期过滤，也不提供客户端列表接口。`featuredArticles` 最多 2 条启用且精选的文章，排序为 `featuredSortOrder ASC, publishedAt DESC, id ASC`。`GET /api/client/menu-items` 返回全部启用菜单，供分类页展示。菜单字段包含 `showOnHome`，后台仍使用 `/api/admin/menu-items` 管理。`GET /api/client/cases?q=&category=` 的 `q` 会 trim，空白等同未传，并在标题、分类、标签、简介和地点中做大小写不敏感匹配；`category` 会按案例分类精确筛选。

`recentActivities` 单条字段：

```json
{
  "id": 1,
  "title": "春日草坪婚礼执行",
  "tag": "婚礼方案",
  "coverUrl": "http://127.0.0.1:3001/uploads/seed/example.png",
  "summary": "户外仪式、晚宴串联与暖场演出成套执行...",
  "eventDate": "2026-04-18T09:00:00.000Z",
  "location": "杭州・西湖区",
  "detailPageId": 1,
  "hasDetailPage": true,
  "sortOrder": 1,
  "status": "enabled"
}
```

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

`GET /api/client/artists` 仅返回启用人员，并以 `sortOrder`、`id` 升序排序。`category` 是可选人员分类；省略时返回全部启用人员，传入时按人员记录的 `type` 分类精确筛选。旧查询参数 `type=host|singer|actor` 仅作为兼容别名，服务端会分别映射为 `主持人`、`歌手`、`演员`；其他任意合法分类字符串应使用 `category`。可选 `q` 会匹配姓名、分类、演绎地点、左上标签、下方标签和描述；`location`、`tag` 分别精确筛选地点和标签。

列表和详情都返回以下人员基础字段，客户端不会收到数据库中的原始 `tagsJson` 字符串；只有 `GET /api/client/artists/:id` 额外返回 `detailPage`，并把兼容 `detail` 从其富文本派生：

```json
{
  "id": 1,
  "name": "林然",
  "type": "主持人",
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

资源引用统计包含站点配置、首页 BANNER、菜单图标、案例封面、文章封面、人员列表封面、旧案例详情媒体和公共详情页 BANNER/富文本媒体。文章封面来源类型为 `article_cover`。EdgeOne 预热记录不属于业务资源占用；删除零业务引用资源时会一并清理其预热记录。

近日活动管理接口使用 `/api/admin/recent-activities`，需要 `recent-activities` 菜单权限。支持 `GET ?q=&status=&page=&pageSize=`、`GET /:id`、`POST`、`PUT /:id`、`DELETE /:id` 和 `POST /reorder`。创建/更新字段为 `title`、`tag`、`coverAssetId`、`summary`、`eventDate`、`location`、可空 `detailPageId`、`sortOrder`、`status`。封面保存使用 `recentActivity.cover` 媒体规则，删除保护来源类型为 `recent_activity_cover`；详情页反向引用来源类型为 `recent_activity`。

## Admin Backups

备份管理接口均需要管理员 `Bearer` token。备份目录和导入暂存目录均位于 `BACKUP_DIR`，不会通过 `/uploads` 静态暴露；除受保护的单备份附件下载响应外，接口不返回本地文件路径、归档内容或 raw SQL。

- `GET /api/admin/backups`：返回 `{ "backups": BackupDto[] }`，不返回备份目录、本地路径或公共下载 URL。
- `GET /api/admin/backups/:id/download`：仅允许下载状态为 `ready` 且重新通过 manifest、普通文件、大小和 SHA-256 校验的备份。成功响应为流式 `.tar.gz` 附件，不套用 JSON success 信封，并设置 `Content-Disposition`、`Cache-Control: no-store` 和 `X-Content-Type-Options: nosniff`；失败仍返回统一 JSON failure 信封。下载期间同一备份不可删除。
- `POST /api/admin/backups`：body `{ "note"?: string }`，创建 v3 `backupKind: "manual"`、`dataScope: "non_identity"` 一致性备份并返回 `{ "backup": BackupDto }`。
- `POST /api/admin/backups/import`：multipart 字段 `file` 或 `archive` 上传 `.tar`/`.tar.gz` 外部备份。服务端先解包到 `BACKUP_DIR/.imports` 隔离暂存区，完整预检通过后发布为普通 `import-*` 备份条目，并返回 `{ "backup": BackupDto, "preflight": BackupPreflightSummary }`。
- `POST /api/admin/backups/:id/restore`：body `{ "backupId": "<same-id>", "confirmation": "RESTORE_FULL_BACKUP" }`。确认字符串和路径 ID 必须完全匹配；缺失或错误确认会在创建恢复点、进入维护模式或修改 DB/uploads 前失败。
- `DELETE /api/admin/backups/:id`：body `{ "backupId": "<same-id>", "confirmation": "DELETE_BACKUP" }`，只删除 `ready`/`failed` 等可删除状态；`verifying`、`restoring` 等状态返回 `409/BACKUP_CONFLICT`。

新备份格式版本为 `formatVersion: 3`，并声明 `identityRestorePolicy: "preserve_target"`、`dataScope: "non_identity"` 和 `backupKind: "manual" | "automatic" | "restore_snapshot" | "imported"`。每个备份发布为后台专用备份目录中的私有目录，包含 `database.sqlite`、`uploads/...` 文件副本和 `manifest.json`。数据库快照使用 SQLite `VACUUM INTO` 一致性机制生成，禁止直接复制活动数据库文件。仓库已知的旧版 `formatVersion: 1` 和 `formatVersion: 2` 可通过兼容适配器导入、预检和恢复，未知旧 schema 一律拒绝。

v3 本地备份不包含身份和运行态数据：`admin_users`、`admin_menu_permissions`、`admin_sessions`、`admin_password_reset_tokens`、`admin_notifications`、`client_sessions`、`daily_user_visits`、`page_view_events`、`operation_logs`、`edgeone_prefetch_attempts`、`edgeone_prefetch_resources` 和 `scheduled_task_states` 不进入快照；`media_assets.createdBy` 在快照中置空。旧 v1/v2 归档可能包含上述历史身份表，但恢复仍按 `preserve_target` 处理，候选身份永远不会上线。

`manifest.json` 包含：

- `app`：应用名称和版本。
- `schema`：SQLite provider、SQLite 版本、`userVersion`、schema hash 和 migration id。
- `createdBy`、`createdAt`、`note`；v3 使用匿名创建者（`后台管理员`、`系统任务` 或 `恢复前安全快照`），旧 v1/v2 保留历史识别型创建者以便兼容读取。
- `database`：快照路径、大小、SHA-256、`snapshotMethod: "sqlite-vacuum-into"`、page size 和 page count。
- `uploads`：每个收集文件的安全相对路径、大小、SHA-256 和修改时间。
- `totalBytes`、`totalFiles` 和整备份内容 SHA-256。

uploads 收集只包含普通文件，排除备份目录、`.tmp`、`.trash`、隐藏文件/目录、临时扩展名、符号链接、目录和任何越过 uploads root 的路径。创建过程先写入备份目录下的 staging 目录，完成文件校验和 manifest 校验后再原子发布；失败会清理 staging，不会留下 partial published backup。并发创建会安全拒绝为 `409/BACKUP_CONFLICT`。

导入预检会拒绝绝对路径、`..`、反斜杠路径、符号链接、硬链接、PAX/长名扩展、设备文件、不支持 tar 类型、过多文件、过大展开体积、过高展开比、版本不兼容、manifest schema 错误、文件大小或 SHA-256 不匹配、SQLite `integrity_check`/`foreign_key_check` 失败、schema metadata 不兼容，以及媒体库 `media_assets.filename` 与归档 `uploads/...` 清单不一致。预检摘要只包含版本、备份类型、数据范围、创建者、数据库大小、uploads 数量、表级影响行数和检查状态；v3 显示“不含身份数据”，旧 v1/v2 显示完整数据兼容恢复说明。

恢复执行顺序为：确认请求体和路径 ID、进入维护模式并阻止业务写入、重新预检候选备份、自动创建 `backupKind: "restore_snapshot"` 恢复点、把候选 DB/uploads 物化到生产目录旁的 `.new` 路径、将目标环境当前 `admin_users`、`admin_menu_permissions`、管理员个人通知和身份运行态注入候选库、清空全部管理员 session/reset token、切换 SQLite 与 uploads、切换后再次校验。候选备份中的账户、密码 hash、角色、权限、通知、session、reset token、客户端会话、访问事件、操作日志和任务状态永远不会成为线上身份或运行态；业务数据与 uploads 正常恢复。历史操作者只按稳定 `publicId` 映射，无法映射的可空引用置空。切换失败会尽力将 `.old` 状态回滚到生产路径；成功响应包含 `restoreId`、原始 `backupId`、`snapshotBackupId`、`revokedSessionCount` 和 `revokedResetTokenCount`。

创建、下载、删除、导入和恢复成功/失败均写当前数据库的 `operation_logs`，并通过结构化安全日志记录 `backup_create_*`、`backup_download_*`、`backup_delete_*`、`backup_import_*`、`backup_restore_*` 事件；日志包含来源、操作者、结果和 requestId，但不记录归档内容、敏感请求体、Authorization、Cookie、JWT、本地路径或部署 secret。`operation_logs` 不进入 v3 备份快照。`backupKind: "automatic"` 仅用于兼容已有自动归档，当前服务不再自动创建此类备份。

`system_config` 随 SQLite 快照一起备份，但其中只有 AES-256-GCM 密文；备份归档不包含 `EDGEONE_CREDENTIAL_ENCRYPTION_KEY`。恢复带有 EdgeOne 配置的数据库时必须向 API 提供创建密文时的同一主密钥，否则旧凭证不可解密。主密钥应通过数据库备份之外的 secret 管理系统独立恢复。

## Admin EdgeOne Configuration And Usage

以下接口均需要管理员 Bearer token，并返回 `Cache-Control: no-store`：

- `GET /api/admin/system-config/edgeone`
- `PUT /api/admin/system-config/edgeone`
- `GET /api/admin/dashboard/overview`
- `POST /api/admin/edgeone/prefetch`
- `GET /api/admin/edgeone/prefetch`
- `POST /api/admin/edgeone/prefetch/reconcile`

`GET /api/admin/system-config/edgeone` 只返回安全元数据：

```json
{
  "zoneId": "zone-example",
  "secretIdMasked": "AKID****1234",
  "secretIdConfigured": true,
  "secretKeyConfigured": true,
  "updatedAt": "2026-07-16T08:00:00.000Z"
}
```

未配置时 `zoneId`、`secretIdMasked`、`updatedAt` 为 `null`，两个 configured 字段为 `false`。接口永远不返回完整 SecretId、SecretKey、密文封套或主密钥。

`PUT /api/admin/system-config/edgeone` 请求体：

```json
{
  "zoneId": "zone-example",
  "secretId": "<CAM SecretId，仅首次或轮换时提交>",
  "secretKey": "<CAM SecretKey，仅首次或轮换时提交>"
}
```

首次保存必须同时提供 SecretId 和 SecretKey；后续省略任一凭证表示沿用当前密文对应的值。服务端先用候选凭证验证 `DescribePlans` 中目标 Zone 只归属于一个有效套餐，再验证 `DescribeBillingData` 的 `acc_flux`、`smt_flux`、`sec_request_clean` 三个指标；全部成功后才在单一事务中写入密文和操作日志。验证或写入失败时旧配置逐字段保持不变。

错误状态：格式或首次凭证缺失为 `400`；无效凭证、权限不足、Zone/套餐/周期不可用为安全化 `422`；腾讯云网络、限流或上游异常为 `502`；本地主密钥缺失、错误或密文不可认证为 `503`。公开错误响应不包含腾讯云错误码或 RequestId；服务端失败日志只记录操作名、本地 request ID、稳定业务错误码及经白名单校验的腾讯云错误码/RequestId，不记录 SDK 原始 message、stack、请求参数、SecretId 或 SecretKey。

Dashboard 响应保留三个本地指标，并增加 `edgeOne` 联合状态：

```json
{
  "todayUniqueUsers": 1,
  "weekDailyUniqueUsers": 5,
  "monthDailyUniqueUsers": 18,
  "edgeOne": {
    "status": "ready",
    "zoneId": "zone-example",
    "fetchedAt": "2026-07-16T08:00:00.000Z",
    "last24Hours": {
      "startTime": "2026-07-15T08:00:00.000Z",
      "endTime": "2026-07-16T08:00:00.000Z",
      "trafficBytes": 2500000000,
      "requestCount": 3200000
    },
    "package": {
      "planId": "plan-example",
      "planType": "prepaid",
      "planStatus": "normal",
      "periodStart": "2026-07-01T00:00:00.000Z",
      "periodEnd": "2026-08-01T00:00:00.000Z",
      "trafficUsedBytes": 9500000000,
      "trafficCapacityBytes": 10000000000,
      "requestUsed": 8000000,
      "requestCapacity": 10000000
    }
  }
}
```

`edgeOne.status` 还可能是 `{ "status": "not_configured" }`，或 `{ "status": "error", "code": string, "message": string }`。EdgeOne 局部错误不会改变三个本地统计字段，也不会把整个聚合响应改为 5xx。

近 24 小时取“最近一个已完整结束的北京时间整点”向前精确 24 小时，三个指标均使用 `hour` 粒度；流量为 `acc_flux + smt_flux`，请求数为 `sec_request_clean`。发送给腾讯云的时间固定为无毫秒的 `YYYY-MM-DDTHH:mm:ss+08:00`。套餐查询继续使用 `day`，保留实际订阅周期起点和当前结束点的秒级边界，不扩成自然日。套餐流量地区系数为 `CH=1`、`NA/EU=1.71`、`AS1=2.49`、`AS2=2.68`、`AS3=2.78`、`MidEast/AF/SA=2.91`；流量额度严格只取 `SecTrafficCapacity`，请求额度严格只取 `SecRequestCapacity`，不得与 `AccTrafficCapacity`、`SmartTrafficCapacity` 等字段相加。预付费按 `EnabledTime` 锚定的订阅月；下月不存在同一日期时按腾讯云规则补齐 31 天，例如 3 月 31 日至 5 月 1 日。企业后付费按 `Asia/Shanghai` 自然月；未知地区、周期或异常数值返回 error，不做估算。API 返回原始 Byte/请求次数，Admin 用十进制 GB/M 保留两位小数；腾讯云计费数据可能延迟约 3 小时。

API 服务端环境变量 `EDGEONE_CREDENTIAL_ENCRYPTION_KEY` 必须是规范 Base64 编码的 32 字节随机密钥。生产缺失或非法时启动失败；开发/测试缺失时禁止保存配置。推荐使用 `openssl rand -base64 32` 生成，并在发布代码前通过部署 secret 管理配置。

CAM 最小策略：

```json
{
  "version": "2.0",
  "statement": [
    {
      "effect": "allow",
      "action": ["teo:DescribePlans"],
      "resource": ["*"]
    },
    {
      "effect": "allow",
      "action": ["teo:DescribeBillingData", "teo:CreatePrefetchTask", "teo:DescribePrefetchTasks"],
      "resource": ["qcs::teo::uin/<主账号UIN>:zone/<ZoneId>"]
    }
  ]
}
```

不授予缓存刷新、配置修改或 EdgeOne 全量管理权限；资源表达式以[腾讯云 CAM 文档](https://cloud.tencent.com/document/product/598/99327)为准。

### Admin EdgeOne Prefetch

`POST /api/admin/edgeone/prefetch` 请求体为 `{ "assetIds": [1, 2] }`；省略 `assetIds` 时服务端按素材 ID 扫描，直到达到实际提交上限。显式 ID 最多 100 个且仍受 `EDGEONE_PREFETCH_MAX_BATCH_SIZE` 限制。响应按素材给出 `submitted/skipped/ineligible/failed` 汇总和安全错误码，不返回 CAM 凭证、上游原始错误或可由浏览器直接提交的目标参数。

`GET /api/admin/edgeone/prefetch` 支持 `assetIds=1,2`、`mediaType`、`status`、`page`、`pageSize`。状态为 `reserved | submitting | processing | success | failed | timeout | canceled | invalid`。Admin 会丢弃列表中的目标 URL 和内容版本，仅展示素材级状态、更新时间和安全错误。

`POST /api/admin/edgeone/prefetch/reconcile` 立即执行一次对账；生产调度器应运行：

```bash
pnpm --filter api edgeone:prefetch:reconcile
```

幂等键由 Zone、素材 ID、MD5、可信目标哈希和固定模式组成。`reserved/submitting/processing/success` 不重复提交；`failed/timeout` 在最大次数和退避窗口内重试；`canceled/invalid` 为终态。服务端使用数据库唯一约束、租约和条件更新处理并发，不以 EdgeOne 的当前缓存驻留状态作为判定依据。目标只由服务端可信数据构造，要求 HTTPS、同主机且无 userinfo/query/fragment。

预热开关默认关闭。接口在 `EDGEONE_PREFETCH_ENABLED=false` 时拒绝写入；回滚应关闭开关并停止调度器，保留历史表供恢复后继续对账。真实腾讯云联调必须在 production-like 环境使用受限 CAM 和少量公开素材完成。

### Admin Scheduled Tasks

- `GET /api/admin/scheduled-tasks`：返回 `{ "items": ScheduledTaskDto[] }`。
- `POST /api/admin/scheduled-tasks/:taskKey/run`：body 必须为空，按服务端目录立即执行并返回 task key、状态、开始/完成 ISO 时间和安全结果摘要。

两条接口都要求管理员 Bearer token，并设置 `Cache-Control: no-store`。目录固定为：

| taskKey | 名称 | cron | CLI |
| --- | --- | --- | --- |
| `admin-session-cleanup` | 管理员会话清理 | `2 * * * *` | `pnpm --filter api admin:sessions:cleanup` |
| `admin-notification-cleanup` | 管理员消息清理 | `10 3 * * *` | `pnpm --filter api admin:notifications:cleanup` |
| `analytics-cleanup` | 访问统计清理 | `20 3 * * *` | `pnpm --filter api analytics:cleanup` |
| `edgeone-prefetch-reconcile` | EdgeOne 预热对账 | `*/5 * * * *` | `pnpm --filter api edgeone:prefetch:reconcile` |

cron 统一按 `Asia/Shanghai` 解释；真实 API server 在 Fastify ready 时启动内置调度器，在关闭时停止调度器。`nextExecutionAt` 是严格晚于服务器当前时间的计划值，`lastExecutionAt` 和 `lastFinishedAt` 来自统一 runner 的真实持久化记录，上线前历史不可追溯时为 `null`。自动调度、管理端立即执行与四条清理/对账 CLI 复用同一处理器并写入 `scheduled_task_states`；同 task key 使用可续租、可过期恢复的原子数据库租约，忙碌返回 `409/SCHEDULED_TASK_BUSY`，未知 key 返回 `404/SCHEDULED_TASK_NOT_FOUND`，任务失败返回脱敏的 `500/SCHEDULED_TASK_FAILED`。浏览器不能提交命令、cron、路径、参数、环境变量或 EdgeOne 目标/凭证。直接调用 `buildApp` 默认不启动后台计时器，测试只有显式启用时才运行调度器；一期单 API 进程部署不得再为相同目录配置重复的外部 cron。

## Media Field Rules

| 字段                       | 类型       | 推荐尺寸 / 约束                                       |
| -------------------------- | ---------- | ----------------------------------------------------- |
| Banner 占位图、Banner 图片 | 图片       | 推荐 1420×580；尺寸不限但必须可解析                   |
| 菜单图标、菜单占位图       | 图片       | 推荐 176×176；尺寸不限但必须可解析                    |
| 案例封面、案例封面占位图   | 图片       | 推荐 460×320；尺寸不限但必须可解析                    |
| 文章封面                   | 图片       | 尺寸不限但必须可解析                                  |
| 人员列表封面图             | 图片       | 推荐 690×480；尺寸不限但必须可解析                    |
| 案例详情媒体               | 图片或视频 | 尺寸不限但必须可解析                                  |
| 详情 BANNER                | 图片       | 尺寸不限但必须可解析；每页 1–6 张，禁止视频与重复 ID  |
| 详情富文本媒体             | 图片或视频 | 尺寸不限但必须可解析；HTML 节点类型必须与资源类型一致 |

## Other Admin APIs

- `POST /api/admin/auth/login`、`POST /api/admin/auth/logout`、`GET /api/admin/auth/me`
- `GET /api/admin/dashboard/overview`
- `GET /api/admin/scheduled-tasks`
- `POST /api/admin/scheduled-tasks/:taskKey/run`
- `GET|PUT /api/admin/system-config/edgeone`
- `GET|POST /api/admin/backups`
- `GET /api/admin/backups/:id/download`
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

`GET /api/admin/dashboard/overview` 的三个本地字段中，`todayUniqueUsers` 是当前北京时间自然日的去重微信用户数；`weekDailyUniqueUsers` 是本周周一至今天的每日去重用户数之和；`monthDailyUniqueUsers` 是本月第一日至今天的每日去重用户数之和。同一用户跨日会在周期累计中再次贡献一次。本地部分只聚合 `daily_user_visits`，不包含旧匿名事件，不返回 PV、估算值或采样参数；EdgeOne 字段见前述联合状态契约。

公告、首页 BANNER、人员、案例和文章创建/更新请求只提交 `detailPageId: number | null` 来选择独立详情页。旧 `detail`、`detailMediaAssetIds`、BANNER `linkType/linkTarget` 不再是新表单的详情来源。所有媒体字段仍提交整数资源 ID。分类菜单接口保留 `/api/admin/menu-items`，菜单创建默认 `showOnHome: true`；关闭后仅从首页隐藏，分类页仍展示，`status=disabled` 时前台均不展示。`GET /api/admin/case-categories` 返回已有案例分类的去重字符串数组，供分类菜单和案例表单选择。`GET /api/admin/articles/categories?q=&limit=` 返回 `{ "categories": string[] }`，来源是 `articles.category`，包含启用和停用文章分类，没有文章分类表。

菜单类型共有 5 种：`artist`、`activity_case`、`article`、`detail_page`、`contact`。`artist` 可在 `configJson.category` 中提交可选人员分类字符串，省略或提交空值时跳转到全部人员列表。`contact` 继续使用既有 `configJson`，可提交 `phone`、`address`、`wechat`、`description`；各字符串保存前 trim，空白值规范化为空配置，客户端按菜单 `id` 读取并逐项显示。创建或更新 `detail_page` 时提交严格配置：

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

`banner_rich_text` 的 `hero.subtitle` 可省略、为空字符串或纯空白，服务端统一 trim 并在 DTO 中输出 string；仍要求 1–6 个唯一图片 ID 和语义非空富文本。兼容输入 `heroSubtitle` 使用相同规则。空 `hero.typeLabel` 不再回退为详情页类型中文名，主标题仍可回退详情页名称。`rich_text` 只接受 `richTextHtml`，不接受宣传语或 BANNER。HTML 中图片/视频必须提供正整数 `data-media-asset-id`；API 不信任客户端 `src`，会从 `MediaAsset.url` 重写。允许协议、HTML/CSS 白名单和迁移细节见 `docs/design/detail-page-system.md`。

### Admin artist APIs

`POST /api/admin/artists` 创建人员时提交以下字段；其中 `tags`、`summary` 可省略：

```json
{
  "name": "林然",
  "type": "主持人",
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

`name`、`type`、`location`、`badge` 会 trim 后校验非空；`type` 是人员分类字符串，不再限制为固定枚举，旧 `host`、`singer`、`actor` 会兼容归一为中文分类。`location` 最长 30 字，`badge` 和单个标签最长 12 字。`tags` 为去空、去重后的 0 至 4 项，创建缺省时规范化为 `[]`；`summary` 最长 120 字，创建缺省或纯空白时规范化为 `""`。`avatarAssetId` 是有效的图片资源 ID，并在后台文案中称为“列表封面图”。`detailPageId` 可为 `null`，非空时必须引用已存在详情页；`PUT /api/admin/artists/:id` 支持基础字段和 `detailPageId` 局部更新。更新时省略 `tags`/`summary` 保持原值，显式提交 `[]`/空白字符串则清空。

后台人员列表和创建/更新响应都会返回安全的 `tags: string[]`，同时保留已解析为数组的兼容 `tagsJson`；服务端只通过统一的标签序列化方法写入一次 JSON，避免双重编码。

媒体错误码：`DUPLICATE_RESOURCE_NAME`、`MD5_MISMATCH`、`HASH_COLLISION`、`INVALID_MEDIA_TYPE`、`INVALID_MEDIA_METADATA`、`FILE_TOO_LARGE`、`MEDIA_IN_USE`、`MEDIA_RECOVERY_FAILED`。
