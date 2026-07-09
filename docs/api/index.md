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
- `GET /api/client/home`
- `GET /api/client/announcements/:id`
- `GET /api/client/cases`
- `GET /api/client/cases/:id`
- `GET /api/client/artists`
- `GET /api/client/artists/:id`
- `POST /api/client/track/page-view`

`POST /api/client/track/page-view` body:
```json
{ "pagePath": "/pages/index/index", "scene": "home" }
```

## Admin
- `POST /api/admin/auth/login`
- `POST /api/admin/auth/logout`
- `GET /api/admin/auth/me`
- `GET /api/admin/dashboard/overview`
- `GET /api/admin/site-config`
- `PUT /api/admin/site-config`
- `GET /api/admin/media-assets`
- `POST /api/admin/media-assets/upload`
- `DELETE /api/admin/media-assets/:id`
- CRUD endpoints for announcements, banners, menu-items, cases, artists.
