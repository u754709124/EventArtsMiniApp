# Stage 2 API and Database Plan

## Goal
Implement the Fastify API, Prisma SQLite schema, seed data, admin auth, CMS CRUD, media upload validation, client home/details, and PV analytics.

## Files
- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/seed.ts`
- `apps/api/src/app.ts`
- `apps/api/src/server.ts`
- `apps/api/src/modules/*`
- `apps/api/test/api.test.ts`
- `docs/api/index.md`
- `docs/stages/02-api-and-database.md`

## Prisma Models
Implement exactly:
- `admin_users`
- `site_config`
- `media_assets`
- `announcements`
- `banners`
- `menu_items`
- `artists`
- `activity_cases`
- `page_view_events`
- `operation_logs`

## API Behavior
1. All responses use the shared envelope.
2. Admin login returns JWT for `Authorization: Bearer`.
3. Admin routes reject missing/invalid tokens.
4. Client home returns enabled announcements/banners/menus and featured enabled cases sorted by requested sort fields.
5. Media upload requires `usage`; image usages with fixed dimensions are rejected if dimensions mismatch.
6. `person_avatar`, `video`, and `other` record file metadata without fixed dimension rejection.
7. Referenced media assets cannot be deleted.
8. Page view tracking inserts a row; dashboard overview counts today/week/month PV.

## Seed Data
- Admin `admin/admin123456`.
- Default site config.
- Test announcement.
- Five menus matching the fixed enum.
- At least three featured cases.
- At least one host, singer, and actor.
- Use generated assets when available; otherwise seed local placeholder records.

## Tests
Vitest with `app.inject()` must cover:
1. Admin login success.
2. Admin login failure.
3. Unauthorized admin access fails.
4. Client home shape.
5. Disabled announcement hidden.
6. Disabled Banner hidden.
7. Disabled menu hidden.
8. Menu enum validation.
9. Featured cases and activity cases share `activity_cases`.
10. Non-featured case hidden from home featured.
11. Wrong image size upload fails.
12. Correct image size upload succeeds.
13. Referenced media delete fails.
14. Page-view increments dashboard PV.

## Commit Sequence
- `feat(api): add prisma schema and seed data`
- `feat(api): implement admin auth and guards`
- `feat(api): implement media upload with dimension validation`
- `feat(api): implement cms crud endpoints`
- `feat(api): implement client home and detail endpoints`
- `feat(api): implement page view analytics`
- `test(api): add backend integration tests`
