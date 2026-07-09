# EventArtsMiniApp Agent Guide

## Project Goal
Deliver phase one of a WeChat mini program stack for event host and performance services. The stack includes a Taro miniapp, Fastify API, React Ant Design admin CMS, shared TypeScript contracts, automated tests, stage documents, API docs, and design review artifacts.

## Directory Responsibilities
- `apps/api`: Fastify, Prisma, SQLite, upload handling, admin/client APIs, API tests.
- `apps/admin`: React + Vite + Ant Design admin CMS.
- `apps/miniapp`: Taro + React + TypeScript + SCSS miniapp and H5 debug build.
- `packages/shared`: shared enums, DTOs, API response types, Zod schemas.
- `docs/stages`: phase delivery notes, test evidence, commit hash backfills.
- `docs/api`: interface documentation.
- `docs/design`: reference image, generated asset manifest, design review screenshots.
- `scripts`: repeatable local automation such as reference image slicing.
- `tests/e2e`: Playwright admin and miniapp H5 tests.
- `uploads`: local development media store.

## Branch and Commits
- Work on branches prefixed with `codex/`.
- Use Conventional Commits.
- Before each commit, run the relevant verification. At minimum run `pnpm lint` and `pnpm test`; for UI changes run `pnpm e2e`; for miniapp changes run `pnpm build:weapp`.
- Do not revert user changes. Coordinate with concurrent agents by staying in assigned paths.

## Testing Requirements
- API behavior is covered with Vitest and Fastify `app.inject()`.
- Admin and miniapp H5 flows are covered with Playwright.
- Tests must use deterministic seed/reset behavior.
- If a required command cannot run because of local environment limits, record the exact reason and an alternative check in the relevant stage document.

## UI Restoration Rules
- Use the attached reference as a visual guide for the home page.
- Keep miniapp layout at `750rpx` design width, `20rpx` page gutters, `710rpx` primary cards, and `710rpx x 290rpx` banner ratio.
- Use warm white background, dark primary text, brown-gold accents, red announcement summary, and restrained card shadows.
- Avoid adding phase-one features beyond top title, announcement bar, banner, 5 menu items, featured cases, and fixed TabBar.

## Taro Compatibility Rules
- Use Taro components and APIs for miniapp pages.
- H5 must be usable for automated debugging; WeChat mini program build must produce a `dist` output.
- Avoid unsupported CSS and browser-only APIs in shared page code.
- Use `navigationStyle: "custom"` for the home header and compute safe top padding from Taro runtime APIs when available.

## API Response Rules
- Success: `{ "success": true, "data": {}, "message": "ok" }`.
- Failure: `{ "success": false, "error": { "code": "ERROR_CODE", "message": "错误信息" } }`.
- Client APIs do not require login. Admin APIs require `Authorization: Bearer <token>`.

## Database and Migration Rules
- Prisma schema is the source of truth.
- SQLite is used for local development and tests.
- Seeds must be idempotent and include the default admin `admin/admin123456`.
- Production deployments must change the default password and JWT secret.

## Media Rules
- Uploads must include `usage`.
- Backend must validate fixed image dimensions with Sharp.
- `media_assets` records original name, generated filename, MIME type, media type, usage, URL, width, height, size, storage type, creator, and upload time.
- Referenced media cannot be deleted; unused media can be deleted after confirmation.
- Local files go to `uploads`; production object storage remains an environment-backed adapter point.

## Admin Rules
- Token is stored for page refresh persistence.
- Unauthenticated users are redirected to login.
- All forms use required validation, success/error feedback, loading/error/empty states, paginated tables, and destructive confirmation.
- Saving CMS content must immediately invalidate/refetch data used by admin and client pages.

## Supported Menus
- `host`: 主持人
- `singer`: 歌手
- `actor`: 演员
- `activity_case`: 活动案例
- `contact`: 联系我们

## Agent Ownership
- Backend Agent owns `apps/api` and API docs.
- Admin Agent owns `apps/admin`.
- Miniapp Agent owns `apps/miniapp`.
- Assets/Design Agent owns `scripts/slice-home-assets.ts`, generated assets, and design docs.
- QA Agent owns `tests/e2e`, Playwright config, and test evidence sections.
- Release Integration Agent owns root config, integration fixes, final verification, and commit orchestration.

## Failures and Scope Changes
- Show recoverable UI failures with clear retry paths.
- Home API failure shows “页面加载失败 / 请稍后重试 / 重新加载”.
- Scope changes require updating this guide, the relevant stage doc, README, and tests.
