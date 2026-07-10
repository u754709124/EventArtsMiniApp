# Stage 4 Miniapp Home Plan

## Goal
Implement the Taro miniapp/H5 frontend with the phase-one homepage, fixed TabBar, base pages, API integration, and fallback states.

## Files
- `apps/miniapp/config/*`
- `apps/miniapp/src/app.config.ts`
- `apps/miniapp/src/app.tsx`
- `apps/miniapp/src/app.scss`
- `apps/miniapp/src/components/*`
- `apps/miniapp/src/pages/*`
- `apps/miniapp/src/services/*`
- `apps/miniapp/src/assets/generated/*`
- `docs/stages/04-miniapp-home.md`

## Routes
- `/pages/index/index`
- `/pages/announcement/detail`
- `/pages/cases/list`
- `/pages/cases/detail`
- `/pages/artists/list`
- `/pages/artists/detail`
- `/pages/contact/index`
- `/pages/category/index`
- `/pages/mine/index`

## Home Sections
1. Custom title area with status/capsule-safe top spacing.
2. Announcement bar hidden when empty, fixed when one, auto-rotating with flip class when multiple.
3. Banner carousel with default image, indicator dots, swipe support, fixed `710rpx x 290rpx`, `aspectFill`.
4. Menu card with five supported menu types, `88rpx x 88rpx` icons, wrapping grid.
5. Featured cases section with “更多案例”, empty state, image fallback, detail navigation.
6. Fixed four-item TabBar.

## Behavior
- Load `GET /api/client/home`.
- After successful mount, call `POST /api/client/track/page-view`.
- Interface failure shows “页面加载失败 / 请稍后重试 / 重新加载”.
- Image error swaps to the placeholder configured for that form field.
- Menu routes:
  - `host` -> `/pages/artists/list?type=host`
  - `singer` -> `/pages/artists/list?type=singer`
  - `actor` -> `/pages/artists/list?type=actor`
  - `activity_case` -> `/pages/cases/list`
  - `contact` -> `/pages/contact/index`

## Tests
- `pnpm --filter miniapp build:h5`
- `pnpm build:weapp`
- Miniapp H5 Playwright scenarios in Stage 5.

## Commit Sequence
- `feat(miniapp): add app routing and fixed tabbar`
- `feat(miniapp): implement home api client and states`
- `feat(miniapp): implement title announcement banner menu and cases`
- `feat(miniapp): add announcement case artist and contact pages`
