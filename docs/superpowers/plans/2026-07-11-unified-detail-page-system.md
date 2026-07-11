# Unified Detail Page System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify one shared detail-page configuration system for artists and activity cases with `banner_rich_text` and `rich_text` renderers, secure rich media, compatible SQLite migration, common admin editing, common Taro rendering, seeded examples, visual evidence, and complete documentation.

**Architecture:** Shared TypeScript owns the type registry, input union, DTOs, labels, and renderer keys. The API owns persistence, migration, HTML sanitization/normalization, media relationships, ordered block generation, preview validation, and transactional business integration. Admin and miniapp consume the same contracts through common feature modules; artist and case pages only provide owner-specific fields and hero adapters.

**Tech Stack:** TypeScript 5.9, Zod 4, Fastify 5, Prisma 6/SQLite, `sanitize-html` plus `parse5`, React 19/Ant Design 6/Tiptap 3, Taro 4/React 18, Sharp, Vitest, Playwright.

## Global Constraints

- Authoritative source spec: `/Users/chdon/.codex/attachments/ff554df2-e8c1-46bb-b75e-2e53b94ca773/pasted-text.txt`, SHA-256 `e2f4c737bdfc9ae01ea9b8ecfb4b98e35c44f6ece76ece94f804ffed5ab74639`.
- Reference image: `/private/var/folders/c2/2x76090s30vbtc2sg0fyxsj00000gn/T/codex-clipboard-19ddfc0d-299a-4ec2-99b2-a74b1dc36e5d.png`, `898×1751`, SHA-256 `49f23ba827eb253dec7347672fc49076d6df3ade991624ea7cfef6ded071ff39`.
- Audited clean baseline: branch `codex/phase-one-delivery`, commit `656a562629948cc4c8df5847ddd7878aace60342` (`feat: implement unified artist lists`).
- Never hard reset, overwrite uncommitted user work, delete the artist list, rewrite the working upload system, or refactor unrelated pages.
- Preserve Artist and ActivityCase legacy detail fields as deprecated compatibility data; new content has exactly one source of truth in common detail tables.
- New artist/case forms require explicit type selection; migrated existing records auto-load their type, including an empty-content “详情待补充” state.
- `banner_rich_text`: trimmed non-empty subtitle, 1–6 unique image banners, non-empty sanitized rich text.
- `rich_text`: non-empty sanitized rich text, no effective subtitle, no banners, no banner DOM/skeleton/space/negative margin.
- Media IDs are trusted only after database lookup. Rich-text media IDs are extracted from sanitized HTML; submitted `src` is always rewritten from `MediaAsset.url`.
- Sanitization must use a real parser, reject dangerous protocols/temp URLs, preserve only the specified tags/classes/data attribute/styles, and reject semantically empty content.
- Taro pages use Taro components/APIs and must build for H5 and WeChat; `Video` blocks are separate from RichText blocks.
- The provided reference image overrides generic design-system recommendations. UI quality gates add 44px/88rpx touch targets, visible focus/labels, feedback, stable layout, safe areas, and no horizontal overflow.
- No favorite/share/consult/booking/fixed business action bar or residual bottom spacer on artist/case detail pages.
- Before each implementation commit run relevant focused tests; before final integration run every command in Task 15.

---

## Recovery Protocol

On every continuation:

1. Read this file and the source spec hash/path above.
2. Run `git status --short`, `git branch --show-current`, `git rev-parse HEAD`, and `git log -1 --oneline`.
3. Inspect unchecked tasks plus the latest `docs/stages/08-detail-page-system.md` evidence.
4. Preserve unrelated changes; only stage files named by the completed task.
5. Run the task's focused verification before changing its checkbox to `[x]`.
6. Do not claim completion until Task 15 proves every source-spec completion item.

## Selected Design and Alternatives

- **Selected:** a shared registry/contracts module, API feature service, shared admin feature components, and shared Taro renderer. This is the only option that meets the explicit no-duplication and future-renderer requirements without changing owner tables for each page type.
- **Rejected:** add `detailType`, banners, rich HTML, sanitizer, and renderer separately to Artist and ActivityCase. It creates two data sources and contradicts the specification.
- **Rejected for phase one:** persist a fully generic JSON block/page-builder engine. It adds schema/editor/rendering scope beyond the two required page types; ordered `blocks` remain a derived transport representation.

## Locked File Structure and Interfaces

### Shared

- Create `packages/shared/src/detail-pages.ts`: registry, values, labels, request union, DTOs, type guards, and form helpers.
- Create `packages/shared/test/detail-pages.test.ts`: registry and schema contract tests.
- Modify `packages/shared/src/index.ts`: re-export detail pages; use `detailPage` in artist/case request and DTO contracts; add `detail.banner` and `detail.richText` media rules.

Core shared interfaces:

```ts
export const detailPageTypeValues = ["banner_rich_text", "rich_text"] as const;
export const detailOwnerTypeValues = ["artist", "activity_case"] as const;
export type DetailPageType = (typeof detailPageTypeValues)[number];
export type DetailOwnerType = (typeof detailOwnerTypeValues)[number];
export type DetailPageInput =
  | { type: "banner_rich_text"; heroSubtitle: string; bannerAssetIds: number[]; richTextHtml: string }
  | { type: "rich_text"; richTextHtml: string };
export type DetailPageConfigDto = {
  type: DetailPageType;
  typeLabel: string;
  rendererKey: "bannerRichText" | "richText";
  schemaVersion: number;
  heroSubtitle: string;
  banners: DetailPageBannerDto[];
  richTextHtml: string;
  blocks: DetailPageBlockDto[];
};
```

### API

- Create `apps/api/src/detail-pages/detail-page-types.ts`: Prisma transaction-compatible types and domain errors.
- Create `apps/api/src/detail-pages/detail-page-sanitizer.ts`: sanitize/normalize/semantic-content checks and canonical media URL rewrite.
- Create `apps/api/src/detail-pages/detail-page-parser.ts`: extract media references and split ordered richText/video blocks.
- Create `apps/api/src/detail-pages/detail-page-serializer.ts`: Prisma payload to stable DTO.
- Create `apps/api/src/detail-pages/detail-page-service.ts`: owner validation plus transactional get/upsert/delete/preview.
- Create `apps/api/src/detail-pages/detail-page-migration.ts`: idempotent legacy conversion and migration ledger.
- Create `apps/api/test/detail-page-contract.test.ts`, `detail-page-service.test.ts`, and `detail-page-migration.test.ts`.
- Modify Prisma schema, SQLite initializer, media reference functions, seed, `app.ts`, existing API tests, package manifest, and lockfile.

Service interface:

```ts
export type DetailPageDb = Prisma.TransactionClient | AppPrismaClient;
export async function getDetailPageConfig(db: DetailPageDb, ownerType: DetailOwnerType, ownerId: number): Promise<DetailPageConfigDto | null>;
export async function getRequiredDetailPageConfig(db: DetailPageDb, ownerType: DetailOwnerType, ownerId: number): Promise<DetailPageConfigDto>;
export async function upsertDetailPageConfig(db: DetailPageDb, ownerType: DetailOwnerType, ownerId: number, input: DetailPageInput): Promise<DetailPageConfigDto>;
export async function deleteDetailPageConfig(db: DetailPageDb, ownerType: DetailOwnerType, ownerId: number): Promise<void>;
export async function previewDetailPageConfig(db: DetailPageDb, input: DetailPageInput): Promise<DetailPageConfigDto>;
```

### Admin

- Refactor media library selection into reusable existing `MediaLibraryModal`/`MediaUploadAction` inputs without duplicating upload code.
- Create `apps/admin/src/detail-pages/` components, extensions, styles, tests, and form utilities.
- Split artist/case form configuration from `main.tsx` only as needed; other CRUD pages stay in place.
- Tiptap is controlled by `value`/`onChange`, uses custom image/video nodes retaining `data-media-asset-id`, and destroys one editor instance cleanly under StrictMode.

### Miniapp

- Create `apps/miniapp/src/components/detail-page/` common renderer, navigation, hero, content, video, skeleton, adapters/types, and SCSS.
- Artist/case detail routes only fetch, handle state/races/PV, build `DetailHeroViewModel`, and invoke `DetailPageRenderer`.
- Keep `apps/miniapp/src/pages/artists/list.tsx` and `list.scss` behavior stable.

## Task 1: Shared Registry, Schemas, and DTOs

**Files:** create `packages/shared/src/detail-pages.ts`, `packages/shared/test/detail-pages.test.ts`; modify `packages/shared/src/index.ts`, `packages/shared/test/contracts.test.ts`.

- [x] Write failing tests for exact enum arrays, unique renderer keys, labels, required banner/subtitle, 1–6 count, duplicates, rich-text-only banner rejection, missing/unknown type, media-field rules, and DTO type construction.
- [x] Run `pnpm --filter @event-arts/shared test`; observed 7 expected failures caused by missing detail exports/contracts.
- [x] Implement the registry with exhaustive `satisfies Record<DetailPageType, DetailPageTypeDefinition>` and Zod discriminated union. Structural Zod validation rejects malformed shape; sanitized semantic emptiness remains an API service check.
- [x] Replace new Artist create/update `detail` input with nested `detailPage`; define case create/update shared schemas instead of private API-only schemas; retain deprecated response `detail` fields.
- [x] Run shared test/build: 19 tests passed and TypeScript build passed. Commit is intentionally grouped with the first API integration boundary so the workspace never records a knowingly broken cross-package commit.

## Task 2: Prisma Models and SQLite Schema Skeleton

**Files:** modify `apps/api/prisma/schema.prisma`, `apps/api/src/sqlite-schema.ts`, `apps/api/src/seed.ts`; create migration test file.

- [x] Write failing tests proving new database initialization creates `schema_migrations`, `detail_page_configs`, `detail_page_banner_media`, `detail_page_content_media`, constraints, and indexes twice without error.
- [x] Add the three Prisma models exactly as the source spec, MediaAsset reverse relations, unique `(ownerType, ownerId)`, restrictive asset relations, and cascading config relations; do not remove legacy columns/tables.
- [x] Add matching `CREATE TABLE/INDEX IF NOT EXISTS` statements and migration ID `20260710_detail_page_config_v1`.
- [x] Ensure reset seed deletes detail configs before owners/assets.
- [x] Run Prisma generation, migration-focused tests, and API typecheck; included in verified backend commit boundary.

## Task 3: Sanitizer, Parser, and Blocks

**Files:** create sanitizer/parser/types tests and modules; modify `apps/api/package.json`, `pnpm-lock.yaml`.

- [x] Add `sanitize-html`, `parse5`, and TypeScript typings with versions locked by pnpm.
- [x] Write failing cases for allowed tags/classes/styles, event/script/style/iframe/SVG removal, dangerous link/source protocols, base64/blob/file/temp URL rejection, only `data-media-asset-id`, semantic empty HTML, canonical `src`, image/video type mismatch, missing media, duplicate references, and ordered block splitting.
- [x] Implement parsing without regex-only HTML interpretation. Preserve text before/after nested video; consecutive HTML becomes one richText block; each top-level video becomes a `video` block with dimensions and no autoplay/loop.
- [x] Ensure inline style normalization bounds size/width/height, rejects fixed/sticky/absolute page overlays, negative dimensions, expressions, URLs, and unreasonable z-index.
- [x] Run focused tests; included in verified backend commit boundary.

## Task 4: Legacy Data Migration

**Files:** create `detail-page-migration.ts` and tests; modify `sqlite-schema.ts`.

- [x] Build fixtures for empty, artist-only, case mixed image/video, existing-config, failure rollback, and non-empty unsupported `legacyMediaJson` databases.
- [x] Convert HTML safely; escape pure text into paragraphs preserving line breaks; allow migrated empty detail without blocking startup.
- [x] Convert ordered `ActivityCaseMedia` into canonical img/video nodes after legacy text, avoid duplicate media already in HTML, validate HTML/relation equality, then delete only successfully migrated legacy rows.
- [x] Execute migration transactionally and insert migration ledger only after all owners succeed; report owner type/id and reason on unexplainable input.
- [x] Run migration repeatedly and assert record/legacy-field preservation, no duplicate configs/links, no half state, and no orphans; included in verified backend commit boundary.

## Task 5: DetailPageService and Serialization

**Files:** create service/serializer/types and tests.

- [x] Write service tests for owner validation, same numeric ID across owner types, banner image enforcement/order, media URL rewrite, relationship diffing, rich-text switch cleanup, owner delete cleanup, transaction rollback, unknown type/config errors, and legacy derived response fields.
- [x] Implement the 20-step save sequence from the source spec using the supplied transaction client only.
- [x] Serialize arrays deterministically; `rich_text` always returns `heroSubtitle: ""` and `banners: []`; derive blocks on every read.
- [x] Add orphan audit helper used by migration tests/release checks.
- [x] Run focused service tests; included in verified backend commit boundary.

## Task 6: Artist/Case and Preview API Integration

**Files:** modify `apps/api/src/app.ts`, shared contracts, `apps/api/test/api.test.ts`; optionally create focused route registration module if `app.ts` remains over 1,000 lines.

- [x] Write route tests for admin create/update/delete transactions, list summary columns, enabled client detail, config-missing/unknown-type errors, and `POST /api/admin/detail-pages/preview` no-write behavior; existing enabled/disabled route behavior remains covered.
- [x] Integrate artist and case creates/updates/deletes in one Prisma transaction with DetailPageService. New routes accept only nested `detailPage`.
- [x] Admin lists return `detailPageType`, label, banner count, detail media count, and `hasRichText`.
- [x] Client details return `detailPage`; deprecated top-level `detail` and case `media` derive from the new config.
- [x] Map domain errors to stable Chinese `400/404/409` envelopes and never default an unknown page type.
- [x] Run API tests; 73/73 pass at the backend checkpoint.

## Task 7: Media Reference Reporting and Protection

**Files:** modify `apps/api/src/media.ts`, relevant API DTO/tests, admin MediaPage if reference-source UI is returned.

- [x] Extend count/query SQL and Prisma counts with banner/content relations while ensuring migrated legacy case rows do not double-count.
- [x] Return named reference sources distinguishing “详情页 BANNER” and “详情页富文本”.
- [x] Test direct delete, existing unused scan/batch delete, type switch, and owner deletion cleanup/reference counts.
- [x] Run media/API tests; included in verified backend commit boundary.

## Task 8: Reference Assets, Slicing, and Seed Data

**Files:** create `scripts/slice-artist-detail-assets.ts`, generated asset directory, manifest/contact sheet; modify root scripts, `assets.ts`, seed, docs design references.

- [x] Copy the 898×1751 reference into `docs/design/reference-artist-detail-original.png` without baking status/navigation/text UI into banner assets.
- [x] Implement deterministic Sharp manifest cropping, coordinate-grid output, component crops, three banner focal variants, and contact sheet. Record every crop coordinate and output MD5.
- [x] Add `assets:slice:artist-detail`; run twice and compare hashes.
- [x] Seed 林然 banner-rich-text with three banners and full specified template, another rich-text artist, one banner case with image/video, and one rich-text case with media. Resolve actual media IDs before composing HTML and use stable SeedRecord keys.
- [x] Test repeated seed has stable counts/relationships and missing file errors are explicit; commit `feat(seed): add reusable detail page examples`.

## Task 9: Reusable Admin Media Selection and Banner Field

**Files:** modify existing media components; create `MediaPickerModal.tsx`, `DetailBannerField.tsx`, admin tests/styles.

- [x] Preserve every existing MediaField flow while exposing type-filtered selection/upload callbacks for editor and banners.
- [x] Implement 1–6 image tiles with thumbnail, name, dimensions, index, duplicate prevention, remove, DnD ordering, and keyboard up/down fallback; value is ordered `number[]` only.
- [x] Add stable test IDs and validate `detail.banner` both client-side and server-side.
- [x] Run admin unit/build plus existing media E2E subset; commits `021d94b` and review fix `96136f2`. Admin 14/14, build, and lint pass; the legacy E2E reached the media paths but its final save/list assertions remain gated on Tasks 11–12 contract integration and updated seed pagination.

## Task 10: Controlled Rich Text Editor

**Files:** create `RichTextEditorField.tsx`, Tiptap extensions/components/styles/tests; modify admin package/lock.

- [x] Install compatible Tiptap 3 packages and pin the resolved versions. Use `immediatelyRender: false`/single lifecycle semantics appropriate for StrictMode.
- [x] Implement paragraphs, H1–H4, font size/color, bold/italic/underline/strike, align, lists, blockquote, horizontal rule, link, clear format, undo/redo.
- [x] Implement custom asset image and video nodes with numeric `data-media-asset-id`, canonical current URL, class, alt for images, controls/preload for video, and no autoplay/loop/iframe/base64/blob.
- [x] Expose a controlled Ant Form input supporting value, change, disabled, reset, clear, edit refill, unmount destroy, and type-switch preservation without scraping the DOM.
- [x] Unit test command output, external value changes, one instance under StrictMode, and stable custom attributes; commits `fa15c4a`, `e5fe9fe`, and `bb68a63`, independent review clean.

## Task 11: Dynamic Detail Form and Preview

**Files:** create `DetailPageTypeSelect.tsx`, `DetailPageConfigFields.tsx`, `DetailPagePreview.tsx`, utilities/types/styles; modify API client.

- [x] When type is absent render only `detail-page-type` and `detail-page-empty-hint`; do not mount editor/banner/subtitle/preview and block submit.
- [x] Render exact fields per registry config. On banner→rich switch with banners, confirm; cancel restores type; confirm changes form draft only; save removes relations. Rich→banner preserves HTML and requires subtitle/banner.
- [x] Apply artist/case reference templates only after overwrite confirmation, with real selected MediaAsset IDs.
- [x] Preview posts the unsaved nested input to the production sanitizer endpoint, renders a 375px shared mobile structure, and never mutates form data.
- [x] Add required stable test IDs and accessibility labels/focus feedback; commit `92cd5eb feat(admin): add dynamic detail configuration`. Focused admin verification is 14/14 and admin build passes.

## Task 12: Artist and Case Admin Integration

**Files:** split/create artist/case CRUD modules as needed, modify `main.tsx`, styles and E2E.

- [x] Preserve all artist list fields and case basic fields; remove new-form `detail` TextArea and `detailMediaAssetIds` controls.
- [x] Add common `DetailPageConfigFields` after status/order, auto-fill migrated detail DTOs, and show detail-type summary columns.
- [x] Ensure saved payload contains only `detailPage` nested detail data and hidden fields do not leak.
- [x] Cover explicit selection, banner sorting, image/video insertion, preview, refill, both switch directions, and Chinese validation in Playwright spec. Real Playwright execution remains blocked by the shared `tsx` IPC sandbox issue.
- [x] Run admin build and commit `1c309d5 feat(admin): integrate shared artist and case details`; after Task 11 files were committed, focused integration verification is 14/14 and admin build passes. Admin E2E is listed but not executed because of the same webServer blocker.

## Task 13: Common Taro Renderer and Route Integration

**Files:** create `apps/miniapp/src/components/detail-page/*`; modify artist/case detail pages, services, PageState/AppImage only where common behavior needs it.

- [x] Implement renderer registry keyed by shared `rendererKey`, exhaustive unknown renderer failure, `DetailHeroViewModel`, runtime safe-area/capsule navigation, predictable fallback back navigation, skeleton variants, and request-race cancellation.
- [x] `BannerRichTextRenderer`: sorted Swiper, aspectFill, 1/N page, no circular single image, slow/fixed E2E autoplay, dynamic hero, calibrated overlap, uncropped first card.
- [x] `RichTextRenderer`: no banner request/preload/DOM/page counter/height/negative margin; title navigation and normal first-card spacing, including banner-free route loading before the DTO arrives.
- [x] Render HTML blocks with Taro RichText and video blocks with Taro Video; video is 100% width, controls, no autoplay/loop, 16:9 fallback, trusted ratio, failure/retry. Images cannot overflow and image preview excludes videos.
- [x] Artist/case routes fetch only enabled DTOs, reset state between IDs, track PV, construct hero adapter, and show loading/retry/not-found/disabled/config/type/media/empty states without stale data.
- [x] Verify artist list unit/E2E remains unchanged where runnable; commits `e4780a6` and review fix `3b2d7c3`. Focused miniapp renderer test is 13/13, Task 13 review is Approved, root lint is green, and generated E2E coverage is listed under Task 14. Real Playwright execution remains separately blocked by local `tsx` IPC sandbox limits.

## Task 14: Visual Calibration, E2E, and Documentation

**Files:** extend Playwright specs/helpers; create four screenshots, overlay/diff, `docs/design/detail-page-system.md`; update API docs, README, stage docs.

- [x] Measure and document all source-spec colors/dimensions from the reference; map them to SCSS variables rather than ad-hoc component literals.
- [x] Add four H5 scenarios and assert banners/hero/page counter/overlap/videos vs exact rich-text absence behavior, back navigation, no horizontal overflow, no stale data, and no forbidden business actions/spacers. Committed as `06ab56c`; `playwright --list` sees the scenarios, while real execution is still blocked by `tsx` IPC sandbox limits.
- [ ] Capture the four named screenshots at approximately 426×922/2x with assets/fonts settled and first banner fixed.
- [ ] Produce first overlay/diff, calibrate visual tokens, recapture, and produce final `overlay-artist-detail.png`/`diff-artist-detail.png`; never claim pixel parity without these files.
- [x] Document architecture, contracts, sanitizer/style whitelist, media lifecycle, migration, editor decision, renderer/adapters, assets/measurements, platform differences, removed actions, and exact eight-step third-renderer extension process.
- [x] Commit `test(detail-pages): cover shared detail workflows` (`06ab56c`) and `docs: document unified detail pages` (`c240aba`) after static/list/build verification. Screenshot artifacts remain blocked and therefore uncommitted.

## Task 15: Full Verification and Completion Audit

- [ ] Run `pnpm install` and record resolved dependency changes.
- [ ] Run `pnpm assets:slice:artist-detail` twice and verify deterministic outputs.
- [ ] Verify new SQLite initialize, representative legacy upgrade, repeated upgrade, artist migration, case mixed-media migration, rollback, orphan audit, reference/delete protection, and repeat seed.
- [ ] Run `pnpm db:push` and `pnpm db:seed`.
- [ ] Run `pnpm lint`, `pnpm test`, and `pnpm e2e`.
- [ ] Run `pnpm --filter api build`, `pnpm --filter admin build`, `pnpm --filter miniapp build:h5`, `pnpm build:weapp`, and `pnpm release:check`.
- [ ] Inspect the actual WeChat `apps/miniapp/dist` output and every named screenshot/overlay/diff file.
- [ ] Search generated UI/source for forbidden favorite/share/consult/booking/fixed-bottom-action elements and for duplicate artist/case editor/renderer/sanitizer implementations.
- [ ] Update `docs/stages/08-detail-page-system.md` with exact commands, pass counts, artifact hashes, failures and justified unrelated exceptions.
- [ ] Re-read the 44 source-spec sections and map every completion item to file/test/runtime evidence. Keep the goal active for any missing or indirect evidence.
- [ ] Commit all verified work using Conventional Commits, record final HEAD, then produce only the 26-section structured implementation report required by source-spec section 44.
