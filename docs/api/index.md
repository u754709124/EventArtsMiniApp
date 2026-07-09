# API Documentation

All APIs use JSON envelopes.

Success:
```json
{ "success": true, "data": {}, "message": "ok" }
```

Failure:
```json
{ "success": false, "error": { "code": "ERROR_CODE", "message": "错误信息" } }
```

Admin endpoints require `Authorization: Bearer <token>`. Client endpoints are public.

## Client
- `GET /api/client/home`: returns `site`, enabled `announcements`, enabled `banners`, enabled `menus`, and featured enabled `featuredCases`.
- `GET /api/client/announcements/:id`: enabled announcement detail.
- `GET /api/client/cases`: enabled activity case list.
- `GET /api/client/cases/:id`: enabled activity case detail.
- `GET /api/client/artists?type=host|singer|actor`: enabled artist list.
- `GET /api/client/artists/:id`: enabled artist detail.
- `POST /api/client/track/page-view`: records a PV event.

`POST /api/client/track/page-view` body:
```json
{ "pagePath": "/pages/index/index", "scene": "home" }
```

## Admin
- `POST /api/admin/auth/login`: body `{ "username": "admin", "password": "admin123456" }`, returns `{ token, id, username }`.
- `POST /api/admin/auth/logout`: authenticated no-op logout.
- `GET /api/admin/auth/me`: authenticated current admin.
- `GET /api/admin/dashboard/overview`: returns `{ todayPv, weekPv, monthPv }`.
- `GET /api/admin/site-config`
- `PUT /api/admin/site-config`
- `GET /api/admin/media-assets`
- `POST /api/admin/media-assets/upload`: multipart `usage` plus `file`; backend validates fixed image dimensions.
- `DELETE /api/admin/media-assets/:id`: fails with `MEDIA_IN_USE` if the asset is referenced.
- `GET|POST|PUT|DELETE /api/admin/announcements`
- `GET|POST|PUT|DELETE /api/admin/banners`
- `GET|POST|PUT|DELETE /api/admin/menu-items`
- `GET|POST|PUT|DELETE /api/admin/cases`
- `GET|POST|PUT|DELETE /api/admin/artists`

## Validation Notes
- Menu types are exactly `host`, `singer`, `actor`, `activity_case`, `contact`.
- Banner link types are exactly `none`, `announcement`, `case`, `internal`.
- Fixed image sizes:
  - `banner`, `default_banner`, `placeholder_banner`: `1420x580`
  - `menu_icon`, `placeholder_icon`: `176x176`
  - `case_cover`, `placeholder_case`: `460x320`
  - `person_avatar`, `video`, `other`: metadata only.
