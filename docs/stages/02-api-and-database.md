# Stage 2 - API and Database

## 阶段目标
实现 Prisma 数据库、Fastify API、认证、CMS CRUD、上传校验、PV 统计和 API 测试。

## 功能范围
用户指定的 client/admin 接口与数据表。

## 主要文件
`apps/api`、`apps/api/prisma/schema.prisma`。

## 数据结构或接口
详见 `docs/api/index.md`。

## 测试方式
`pnpm --filter api test`、`pnpm test`、`pnpm --filter api build`、`pnpm --filter api db:push`、`pnpm --filter api db:seed`。

## 验收清单
- [x] API 统一响应
- [x] 上传尺寸后端校验
- [x] 引用资源不可删除
- [x] 首页聚合过滤 disabled 数据
- [x] PV 统计返回今日、本周、本月

## 已完成事项
- 已实现 `apps/api` Fastify app factory、server entry、JWT 管理员鉴权、统一响应和错误封装。
- 已实现 Prisma schema，覆盖 `admin_users`、`site_config`、`media_assets`、`announcements`、`banners`、`menu_items`、`artists`、`activity_cases`、`page_view_events`、`operation_logs`。
- 已实现 SQLite bootstrap helper、seed 数据、默认管理员 `admin/admin123456`、默认站点配置、公告、五类菜单、三条精选案例和三类人员。
- 已实现媒体上传、Sharp 尺寸校验、引用资源删除保护、本地 `/uploads` 静态资源。
- 已实现 client home/detail/list/page-view 接口和 admin dashboard/site-config/media/CRUD 接口。
- API Vitest 使用 Fastify `app.inject()` 覆盖管理员登录成功/失败、后台未授权、首页聚合、disabled 过滤、菜单类型校验、精选案例数据源、上传尺寸成功/失败、引用资源删除失败、PV 统计。
- 验证通过：`pnpm lint`、`pnpm test`、`pnpm --filter api build`、`pnpm --filter api db:push`、`pnpm --filter api db:seed`。

## 对应 git commit hash
待回填。

## 已知问题或设计取舍
本地 SQLite；生产可迁移到托管数据库和对象存储。当前环境中 `prisma db push` 的 schema engine 对 SQLite 返回 `Schema engine error: undefined`，因此本项目保留 Prisma schema 和 Prisma Client，同时使用 `apps/api/src/sqlite-schema.ts` 作为可重复执行的本地 SQLite bootstrap；`pnpm --filter api db:push` 已包装为 Prisma Client 生成后执行该 bootstrap。
