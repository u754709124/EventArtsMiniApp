# API Documentation

所有接口使用统一响应信封。管理接口需要 `Authorization: Bearer <token>`；客户端接口公开。

```json
{ "success": true, "data": {}, "message": "ok" }
```

```json
{ "success": false, "error": { "code": "ERROR_CODE", "message": "错误信息" } }
```

## Client

- `GET /api/client/home`
- `GET /api/client/announcements/:id`
- `GET /api/client/detail-pages/:id`
- `GET /api/client/menu-items`
- `GET /api/client/cases?q=&category=`
- `GET /api/client/cases/:id`
- `GET /api/client/artists?type=host|singer|actor&q=&location=&tag=`（`type` 省略时默认为 `host`）
- `GET /api/client/artists/:id`
- `POST /api/client/track/page-view`

案例详情的兼容 `media` 从独立详情页派生；小程序以公共 `/api/client/detail-pages/:id` 返回的 `blocks` 为准，不直接渲染兼容列表。

`GET /api/client/home` 只返回 `status=enabled` 且 `showOnHome=true` 的菜单；`GET /api/client/menu-items` 返回全部启用菜单，供分类页展示。菜单字段包含 `showOnHome`，后台仍使用 `/api/admin/menu-items` 管理。`GET /api/client/cases?q=&category=` 的 `q` 会 trim，空白等同未传，并在标题、分类、标签、简介和地点中做大小写不敏感匹配；`category` 会按案例分类精确筛选。

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

## Media Field Rules

| 字段                                    | 类型       | 尺寸                                                  |
| --------------------------------------- | ---------- | ----------------------------------------------------- |
| 默认 Banner、Banner 占位图、Banner 图片 | 图片       | 1420×580                                              |
| 菜单图标、菜单占位图                    | 图片       | 176×176                                               |
| 案例封面、案例封面占位图                | 图片       | 460×320                                               |
| 人员列表封面图                          | 图片       | 推荐 690×480；尺寸不限但必须可解析                    |
| 案例详情媒体                            | 图片或视频 | 尺寸不限但必须可解析                                  |
| 详情 BANNER                             | 图片       | 尺寸不限但必须可解析；每页 1–6 张，禁止视频与重复 ID  |
| 详情富文本媒体                          | 图片或视频 | 尺寸不限但必须可解析；HTML 节点类型必须与资源类型一致 |

## Other Admin APIs

- `POST /api/admin/auth/login`、`POST /api/admin/auth/logout`、`GET /api/admin/auth/me`
- `GET /api/admin/dashboard/overview`
- `GET|PUT /api/admin/site-config`
- `GET|POST|PUT|DELETE /api/admin/announcements`
- `GET|POST|PUT|DELETE /api/admin/banners`
- `GET|POST|PUT|DELETE /api/admin/menu-items`
- `GET /api/admin/case-categories`
- `GET|POST|PUT|DELETE /api/admin/cases`
- `GET|POST|PUT|DELETE /api/admin/artists`
- `GET /api/admin/detail-pages`
- `GET /api/admin/detail-pages/options`
- `GET|POST|PUT|DELETE /api/admin/detail-pages/:id`
- `GET /api/admin/detail-pages/:id/references`
- `POST /api/admin/detail-pages/preview`

公告、首页 BANNER、人员和案例创建/更新请求只提交 `detailPageId: number | null` 来选择独立详情页。旧 `detail`、`detailMediaAssetIds`、BANNER `linkType/linkTarget` 不再是新表单的详情来源。所有媒体字段仍提交整数资源 ID。分类菜单接口保留 `/api/admin/menu-items`，菜单创建默认 `showOnHome: true`；关闭后仅从首页隐藏，分类页仍展示，`status=disabled` 时前台均不展示。`GET /api/admin/case-categories` 返回已有案例分类的去重字符串数组，供分类菜单和案例表单选择。

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

媒体错误码：`DUPLICATE_RESOURCE_NAME`、`MD5_MISMATCH`、`HASH_COLLISION`、`INVALID_MEDIA_TYPE`、`INVALID_MEDIA_METADATA`、`INVALID_MEDIA_DIMENSION`、`FILE_TOO_LARGE`、`MEDIA_IN_USE`、`MEDIA_RECOVERY_FAILED`。
