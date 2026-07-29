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
- Production client APIs under `/api/client/**` require a server-issued WeChat miniapp client session, except the explicit WeChat login exchange endpoint. Admin APIs require administrator `Authorization: Bearer <token>`.

## Database and Migration Rules

- Prisma schema is the source of truth.
- SQLite is used for local development and tests.
- EdgeOne CAM credentials belong only to the singleton server-side `SystemConfig`; never place them in client-facing `SiteConfig`. Database backups contain only AES-256-GCM ciphertext and require the original external encryption key to restore.
- Seeds must be idempotent for demo content and must not create or overwrite administrators; create the first administrator with the explicit `admin:bootstrap` command.
- Production deployments must not rely on any default administrator password; create the first administrator with `admin:bootstrap` and provide a strong production JWT secret.

## Media Rules

- The media library is purpose-neutral. Library uploads do not include `usage`; form-local uploads may include `fieldKey` for early slot validation.
- Clients preflight type, size and dimensions and calculate MD5; the backend independently recalculates MD5, extracts trusted metadata, and validates every business association.
- `media_assets` records a globally unique normalized resource name, original name, generated filename, MD5, verified MIME/media type, URL, width, height, size, tags, storage type, creator, and timestamps.
- Business forms continue to reference media by integer ID. Local filenames use collision-safe random 32-character hexadecimal names.
- Referenced media cannot be deleted; unused media can be deleted after confirmation.
- Local files go to `uploads`; production object storage remains an environment-backed adapter point.

## Admin Rules

- Token is stored for page refresh persistence.
- Unauthenticated users are redirected to login.
- All forms use required validation, success/error feedback, loading/error/empty states, paginated tables, and destructive confirmation.
- Saving CMS content must immediately invalidate/refetch data used by admin and client pages.
- Optional CMS display fields must be trimmed before persistence/rendering. When an optional field is blank, omit the corresponding client element and spacing instead of rendering fallback copy or an empty container. BANNER detail subtitles are optional; technical optional fields such as filters, pagination, sorting, status, and update payload fields are outside this display rule.
- Contact menu pages must read `phone/address/wechat/description` from the selected menu's existing `configJson`; do not hardcode contact values. If every contact display field is blank, show the explicit empty state.
- Backoffice accounts use fixed `SUPER_ADMIN`, `ADMIN`, and `USER` roles. Server-side live role/menu authorization is authoritative; frontend menu filtering is not a security boundary.
- Only `SUPER_ADMIN` may create `ADMIN`/`USER` and manage other `SUPER_ADMIN`/`ADMIN`/`USER` accounts; self-management stays on the self-service paths. `ADMIN` may create/manage only `USER` and may delegate only its own effective non-sensitive business-menu permissions. At least one enabled `SUPER_ADMIN` must remain.
- `SUPER_ADMIN` password recovery is server CLI-only and stdin-only. `ADMIN` recovery links are issued only by `SUPER_ADMIN`; `USER` recovery links are issued by `ADMIN` or `SUPER_ADMIN`. No Web reset link may target `SUPER_ADMIN`.
- New local backups are v3 `dataScope: non_identity` archives and exclude identity/session/reset/notification/log/stat/task-state tables; legacy v1/v2 restores remain compatible but must use `identityRestorePolicy: preserve_target`, preserve the target identity plane, invalidate all admin sessions/reset tokens, and never activate candidate-backup credentials.
- The daily automatic backup scheduled task has been removed. New backups are created manually or as restore safety snapshots; existing archives with `backupKind: "automatic"` remain readable and manageable for compatibility.
- EdgeOne v1 is limited to one Zone and one CAM credential pair. SecretKey may exist only in the current password input and a single API/SDK request; it must not enter URLs, browser storage, logs, errors, snapshots, or client caches. Resource prewarming is an opt-in admin workflow: only trusted HTTPS media targets may be submitted, durable identity and leases prevent duplicate submission, and reconciliation must be scheduled server-side.
- The “定时任务” page is read-only apart from confirmed immediate execution. Task metadata, cron (`Asia/Shanghai`), handlers, next-run calculation, persistent state, recoverable leases, and the in-process scheduler lifecycle are server-owned. The real API server starts the scheduler and stops it with Fastify; direct `buildApp` usage stays timer-free unless explicitly enabled. The browser may submit only a catalog task key. Do not configure duplicate external cron triggers for the same catalog in phase one.

## Supported Menus

- `artist`: 人员
- `activity_case`: 活动案例
- `article`: 文章
- `detail_page`: 详情页直达
- `contact`: 联系我们

## Failures and Scope Changes

- Show recoverable UI failures with clear retry paths.
- Home API failure shows “页面加载失败 / 请稍后重试 / 重新加载”.
- Scope changes require updating this guide, the relevant stage doc, README, and tests.
