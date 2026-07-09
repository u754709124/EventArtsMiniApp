# Stage 5 E2E and Design Review Plan

## Goal
Verify API/Admin/Miniapp behavior end to end and record design review evidence.

## Files
- `playwright.config.ts`
- `tests/e2e/admin.spec.ts`
- `tests/e2e/miniapp-h5.spec.ts`
- `tests/e2e/helpers/*`
- `docs/design/actual-home-h5.png`
- `docs/stages/05-e2e-and-design-review.md`

## Setup
Playwright starts:
- API on `127.0.0.1:3001`
- Admin on `127.0.0.1:5173`
- Miniapp H5 on `127.0.0.1:10086`

Tests use deterministic seed data. Avoid Ant Design class selectors; use `data-testid`.

## Admin Scenarios
1. Login page displays.
2. Unauthorized dashboard redirects to login.
3. Login enters dashboard.
4. Dashboard shows today/week/month PV.
5. Site config saves.
6. Announcement create and status update.
7. Banner create.
8. Menu create with five visible Chinese type options.
9. Dynamic config changes by menu type.
10. Case create and featured flag.
11. Wrong-size upload error.
12. Referenced media delete error.

## Miniapp H5 Scenarios
1. Home loads.
2. App name/subtitle from API.
3. No announcement hides bar.
4. Announcement displays.
5. Multi-announcement switches content or flip class.
6. No Banner uses default.
7. Indicator dots display.
8. Five menu types display.
9. Five menu navigation flows.
10. Featured cases display.
11. Case detail navigation.
12. Home API failure and reload button.
13. Image failure fallback.

## Design Review
Capture `docs/design/actual-home-h5.png` at a mobile viewport. Record module comparison for title, announcement, banner, menu card, featured cases, and TabBar.

## Tests
- `pnpm e2e`

## Commit Sequence
- `test(e2e): add admin and miniapp h5 coverage`
- `docs(test): document qa checklist and design review`
