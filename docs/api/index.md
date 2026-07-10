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
- `GET /api/client/cases`
- `GET /api/client/cases/:id`
- `GET /api/client/artists?type=host|singer|actor`
- `GET /api/client/artists/:id`
- `POST /api/client/track/page-view`

案例响应包含按 `sortOrder` 排序的 `media`，每项为 `{ id, mediaType, url, width, height, sortOrder }`。本轮小程序不展示该列表。

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

| 字段 | 类型 | 尺寸 |
|---|---|---|
| 默认 Banner、Banner 占位图、Banner 图片 | 图片 | 1420×580 |
| 菜单图标、菜单占位图 | 图片 | 176×176 |
| 案例封面、案例封面占位图 | 图片 | 460×320 |
| 人员头像 | 图片 | 尺寸不限但必须可解析 |
| 案例详情媒体 | 图片或视频 | 尺寸不限但必须可解析 |

## Other Admin APIs

- `POST /api/admin/auth/login`、`POST /api/admin/auth/logout`、`GET /api/admin/auth/me`
- `GET /api/admin/dashboard/overview`
- `GET|PUT /api/admin/site-config`
- `GET|POST|PUT|DELETE /api/admin/announcements`
- `GET|POST|PUT|DELETE /api/admin/banners`
- `GET|POST|PUT|DELETE /api/admin/menu-items`
- `GET|POST|PUT|DELETE /api/admin/cases`
- `GET|POST|PUT|DELETE /api/admin/artists`

案例创建/更新请求使用有序 `detailMediaAssetIds: number[]`。所有业务资源字段提交整数资源 ID。

媒体错误码：`DUPLICATE_RESOURCE_NAME`、`MD5_MISMATCH`、`HASH_COLLISION`、`INVALID_MEDIA_TYPE`、`INVALID_MEDIA_METADATA`、`INVALID_MEDIA_DIMENSION`、`FILE_TOO_LARGE`、`MEDIA_IN_USE`、`MEDIA_RECOVERY_FAILED`。
