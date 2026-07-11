# Standalone Detail Page Management Long-Term Goal

Date: 2026-07-11
Planner route: `planner` (`gpt-5.6-sol`, xhigh, read-only)
Branch at refresh: `codex/phase-one-delivery`
Baseline HEAD: `e86c9d8574b5e953bdbfbdced6c04705e754d5c4`
Baseline commit: `e86c9d8 fix(ui): repair carousels and image previews`

## Objective

Convert the owner-bound detail page system into an independent, self-contained,
reusable detail-page entity. Announcements, home banners, artists, and activity
cases store only nullable `detailPageId` references. Every new client entrance
navigates to `/pages/detail/index?id=<detailPageId>` and renders through the
existing shared detail renderer, sanitizer, media relationships, preview, rich
text, BANNER, and video capabilities.

## Current Baseline

- The worktree already contains partial shared, API, migration, seed, and admin
  implementation.
- `AGENTS.md` has user-owned local changes and must not be overwritten.
- `DetailPageConfig` has been partially expanded toward an independent entity.
- Admin detail-page list/designer/reference components have been added but need
  review, hardening, and tests.
- Miniapp common `/pages/detail/index` and unified navigation helper are not yet
  implemented.
- Legacy miniapp entrances still use owner detail routes or deprecated
  `linkType` / `linkTarget` behavior.
- Tests and docs still contain owner-bound assumptions.

## Long-Term Acceptance Criteria

### Database

- Preserve `detail_page_configs`, `detail_page_banner_media`, and
  `detail_page_content_media` physical tables, existing IDs, HTML, media IDs,
  and relation order.
- `DetailPageConfig` includes `name`, `pageType`, and full Hero fields:
  `heroTitle`, `heroTypeLabel`, `heroSubtitle`, `heroBadge`, `heroTagsJson`,
  `heroLocation`, and `heroMetaJson`.
- `ownerType` and `ownerId` remain nullable deprecated migration fields.
- `announcements`, `banners`, `artists`, and `activity_cases` have nullable,
  indexed, real `detailPageId` foreign keys with `ON DELETE RESTRICT`.
- Migration `20260711_standalone_detail_pages_v1` supports fresh DBs, legacy DBs,
  repeated execution, failure rollback, owner-bound backfill, and safe BANNER
  link mapping only when the target already has a detail page.
- `PRAGMA foreign_key_check` returns no rows after migration.

### API

- Admin detail pages support list/search/filter/options/get/create/update/delete,
  references, and preview.
- Client `GET /api/client/detail-pages/:id` returns a self-contained
  `DetailPageConfigDto` and does not depend on an owner object.
- Detail page create/update are transactional across config rows, BANNER media
  relations, content media relations, and rich-text media parsing.
- Delete checks references and also converts concurrent database FK failures to
  controlled `409` responses.
- Business write APIs for announcements, banners, artists, and activity cases
  accept only `detailPageId: number | null` as the new detail reference input.
- Business list/home DTOs expose `detailPageId` and `hasDetailPage` without
  embedding full detail configs.
- New runtime navigation never uses `ownerType`, `ownerId`, `linkType`, or
  `linkTarget` as fallback.

### Admin

- Sidebar entry `详情页管理` exists.
- Routes exist for `/detail-pages`, `/detail-pages/new`, and
  `/detail-pages/:id/edit`.
- List supports search, type filter, reference count, edit, delete protection,
  and reference-source inspection.
- Designer uses a desktop split layout with live mobile preview, right-side
  configuration, sticky save toolbar, save status, duplicate-submit prevention,
  validation feedback, and dirty-state protection.
- `DetailPageReferenceField` is shared by announcement, banner, artist, and case
  forms and renders the required control shape:
  `[ select detail page ] [新建] [跳转页面]`.
- Business forms no longer embed full detail configuration. Banner forms no
  longer edit old navigation fields.

### Miniapp

- Register and implement `/pages/detail/index`.
- The public detail route fetches by detail-page ID and renders the returned DTO
  through the existing `DetailPageRenderer`.
- One navigation helper is used by announcements, home banners, artist cards,
  case cards, and featured case cards.
- `detailPageId = null` means no click handler, no detail request, no fallback,
  no toast, and non-clickable visual affordance.
- Home BANNER no longer parses `linkType` or `linkTarget`.
- Legacy artist/case detail routes are compatibility jump pages: if a business
  record has `detailPageId`, redirect/replace to the public route; otherwise
  show `暂无详情`.
- The public route handles invalid IDs, 404, unknown page types, retry, request
  races, images, and videos.

### Tests

- Shared contract tests cover independent detail input, Hero fields, nullable
  `detailPageId`, DTO shape, and deprecated compatibility boundaries.
- API tests cover CRUD, four business references, shared references, deletion
  protection, client detail fetch, media relations, and migration invariants.
- Admin tests cover list, designer, preview, dirty state, reference field, and
  four form integrations.
- Miniapp tests cover public route, unified entrances, unlinked states, Swiper
  non-navigation, and legacy route compatibility.
- Full verification must use actual command results, not historical evidence.

### Docs

- Update README, API docs, stage docs, and detail-page design docs to describe
  the independent detail-page architecture.
- Document deprecated fields, four FKs, unified route, designer, reference
  selector, delete protection, migration, and rollback behavior.
- Remove or rewrite owner-bound claims such as nested business `detailPage`
  writes.

## Current Implementation Gaps

1. Migration has not been executed or verified against a copied legacy DB.
2. Migration snapshot validation needs stronger checks for detail IDs,
   `richTextHtml`, page type, Hero data, media relation IDs, and relation order.
3. `hasTargetSchema()` should verify all target columns, indexes, and four real
   FKs, not just the presence of `detailPageId`.
4. Unmapped legacy BANNER links need an auditable migration outcome.
5. `createDetailPage()` and `updateDetailPage()` need single-transaction writes.
6. Detail reference count currently double-counts artists and needs correction.
7. Delete needs to map database FK race failures to `409`, not generic server
   errors.
8. Admin designer dirty protection and save ergonomics need hardening.
9. Admin live preview should avoid drifting into a third preview surface.
10. Reference selector needs stale option handling, search race protection, and
    stronger cross-tab refresh behavior.
11. Miniapp public detail route, config entry, and navigation helper are absent.
12. Miniapp home, artist list, case list, and featured cases still navigate via
    legacy owner routes or deprecated BANNER link fields.
13. Old artist/case detail pages still render owner-derived detail content
    instead of acting as compatibility jump pages.
14. Tests and docs still encode owner-bound behavior.

## Recommended Route

Planner recommends `GPT55_XHIGH` because the work includes SQLite table rebuilds,
data preservation, real foreign keys, transactional consistency, public API
contract changes, concurrent delete behavior, and rollback complexity.

Parent decision note: an earlier implementation agent already produced partial
changes in this worktree. Continue with a single implementation owner at a time,
and have the parent review all changes, write or update tests, run verification,
and report actual results.

## Ordered Execution Plan

1. Persist this refreshed long-term goal and add it to the plan index.
2. Review and tighten shared and Prisma contracts.
3. Harden SQLite migration and add legacy/new/repeated migration tests.
4. Make detail create/update transactional and fix reference counting/deletion
   consistency.
5. Complete API CRUD, business reference behavior, client detail endpoint, and
   seed data.
6. Finish admin list/designer/reference field behavior and tests.
7. Implement miniapp `/pages/detail/index`, unified navigation helper, and all
   public entrances.
8. Convert old artist/case detail routes into compatibility jump pages.
9. Rewrite affected shared/API/admin/miniapp tests.
10. Update README, API docs, design docs, stage docs, and final evidence.
11. Run required verification, fix failures, and record real command outcomes.

## Verification Matrix

Required commands to run and record when implementation is ready:

```bash
pnpm install
pnpm db:push
pnpm db:seed
pnpm lint
pnpm test
pnpm e2e
pnpm --filter api build
pnpm --filter admin build
pnpm --filter miniapp build:h5
pnpm build:weapp
pnpm release:check
```

Focused checks:

- Shared contract tests for independent detail DTOs and nullable references.
- API migration tests for fresh DB, legacy DB copy, repeated migration, and FK
  validation.
- API service tests for transactional rollback, media relation preservation,
  reference counting, and deletion protection.
- Admin tests for designer, preview, reference selector, and four form bindings.
- Miniapp tests for public detail route, no-detail non-clickable states, and old
  route compatibility.

## Risks And Rollback

- SQLite rebuild mistakes can lose existing detail/media data.
- Running new API code before schema upgrade may query missing columns.
- Non-transactional detail writes can create partially saved detail pages.
- Delete races must be handled by database FK errors as well as service checks.
- Old clients may keep writing legacy BANNER fields; new navigation must ignore
  them.
- Rolling back only application code is unsafe after independent detail pages are
  created with nullable owners.
- Back up SQLite and uploads before production migration; validate on a database
  copy before upgrading the real environment.
