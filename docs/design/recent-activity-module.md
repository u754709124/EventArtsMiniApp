# Recent Activity Module

Recent activities are independent home-page content records. They do not rename
or migrate `activity_case`, `/cases`, the case list, or admin case management.

## Data And API

- Prisma model/table: `RecentActivity` / `recent_activities`.
- Admin menu key: `recent-activities`.
- Admin API: `/api/admin/recent-activities` with list, detail, create, update,
  delete, and `/reorder`.
- Client API: `GET /api/client/home` includes `recentActivities`; no client list
  endpoint is added.
- Detail page references use sourceType `recent_activity`.
- Media references use field key `recentActivity.cover` and source type
  `recent_activity_cover`.

## Miniapp Home

The home page renders “近日活动” above “活动方案”. Recent activity cards reuse the
compact `CaseCard` visual system with independent test IDs:
`home-recent-activities`, `home-recent-activity-card`, image/meta descendants.
Cards navigate only when `detailPageId` is present; otherwise they are static.

The former home featured-case copy now reads:

- `活动方案`
- `更多方案`
- `暂无活动方案`

The TabBar text for `pages/cases/list` is `方案`; the route and underlying
`activity_case` menu type remain unchanged.

## Admin

The admin page uses the existing grouped record form pattern. Fields are title,
tag, cover, summary, event date, location, optional detail page, sort order, and
status. Sorting is manual and status-controlled; activity date is display
metadata only.
