# Admin Navigation And Forms

The admin CMS now uses a single navigation config in `apps/admin/src/navigation/menu-config.tsx`.
That config drives the Ant Design sidebar, selected/open keys, route matching,
breadcrumbs, page titles, and sidebar `data-testid` values.

## Navigation

- 数据看板
- 首页运营: 首页配置, 公告管理, 首页轮播, 分类菜单
- 内容管理: 人员管理, 案例管理, 详情页管理
- 素材管理: 素材库

The sidebar persists collapse state in `event-arts-admin-sider-collapsed` and
open groups in `event-arts-admin-menu-open-keys`. Child routes such as
`/artists/new`, `/artists/:id/edit`, and `/detail-pages/:id/edit` match their
own list menu item.

## Forms

Short operational records stay in drawers. Artists and cases use independent
create/edit pages with grouped fields, a sticky action bar, dirty navigation
protection, and complete-record edit hydration via authenticated `GET /:id`
admin endpoints.

Status fields show Chinese enabled/disabled labels. Duration fields are entered
in seconds in the admin UI while API payloads continue to use milliseconds.
The category menu form keeps the `/menu-items` route and adds a home-display
switch backed by `showOnHome`; disabling the switch hides the item only from
the home page, while status disabled hides it from all client pages.
