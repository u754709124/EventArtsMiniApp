# Stage 3 Admin CMS Plan

## Goal
Implement the React + Vite + Ant Design admin system for phase-one CMS operations.

## Files
- `apps/admin/src/main.tsx`
- `apps/admin/src/api/client.ts`
- `apps/admin/src/auth/*`
- `apps/admin/src/layout/AdminLayout.tsx`
- `apps/admin/src/pages/*`
- `apps/admin/src/components/*`
- `docs/stages/03-admin-cms.md`

## Routes
- `/login`
- `/dashboard`
- `/site-config`
- `/announcements`
- `/banners`
- `/menu-items`
- `/cases`
- `/artists`
- `/media-assets`

## Implementation Steps
1. Scaffold Vite React TS with Ant Design and React Router.
2. Implement API client using `VITE_API_BASE_URL`, shared response envelope, token persistence, and 401 handling.
3. Implement login page with username/password validation and error feedback.
4. Implement protected layout with sidebar, header, logout, and route guard.
5. Implement dashboard PV cards for today/week/month.
6. Implement site config form with media selectors.
7. Implement CRUD pages with Ant Design tables, pagination, loading/error/empty states, create/edit drawers, status toggles, sort fields, and delete confirmation.
8. Implement menu dynamic config forms:
   - host/singer/actor: `defaultSort`, `pageSize`
   - activity_case: `category`, `onlyFeatured`, `pageSize`
   - contact: `phone`, `address`, `wechat`, `description`
9. Implement media library upload with usage select, client-side image dimension pre-check, preview, and delete error display.

## E2E Hooks
Use stable `data-testid` attributes for login, dashboard PV cards, CRUD create/edit/delete buttons, menu type select, dynamic config fields, media upload, and save buttons.

## Tests
- `pnpm --filter admin build`
- Admin Playwright scenarios in Stage 5.

## Commit Sequence
- `feat(admin): add auth layout and api client`
- `feat(admin): add dashboard overview`
- `feat(admin): add site config management`
- `feat(admin): add announcement banner and menu management`
- `feat(admin): add case artist and media management`
