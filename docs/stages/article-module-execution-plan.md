# Article Module Execution Plan

## Baseline Audit

- Branch: `codex/phase-one-delivery`
- HEAD: `72186a22b960e6bfc5cabad01e66ae4250ae52d6`
- Last commit: `72186a2 fix(admin): contain table horizontal overflow`
- Initial dirty files: `AGENTS.md`
- `.codex` is read-only in this sandbox, so this plan is persisted under `docs/stages/`.

## Constraints

- Preserve existing user changes and do not reset or checkout over the worktree.
- Do not add an article category table, article rich text renderer, article detail renderer, slug, comments, likes, author, or workflow.
- Reuse `DetailPageConfig`, `DetailPageReferenceField`, `/pages/detail/index?id=<detailPageId>`, `DetailPageRenderer`, and the existing media library.
- Keep the existing home modules, menu groups, people, cases, announcements, banners, media behavior, and detail page behavior intact.
- Article categories come from normalized `Article.category` values only.

## Implementation Slices

1. Audit required code paths and current contracts.
2. Add shared article schemas, DTOs, category normalization, article menu config, and date formatting helpers.
3. Add Prisma and SQLite article storage with idempotent migration and foreign key/index coverage.
4. Add API article services/routes, serializers, category endpoints, media references, detail-page references, home featured articles, and seed data.
5. Add admin article routes, menu entry, list page, editor page, category autocomplete, media/detail page fields, and article menu config support.
6. Add miniapp ArticleCard, article list page, menu navigation, home featured article section, and shared date display.
7. Update tests across shared, API, admin E2E, and miniapp H5 E2E.
8. Update docs and generate requested screenshots from real running app state.
9. Run install, database, test, E2E, build, and release verification commands that exist in `package.json`.

## Validation Targets

- `pnpm install`
- `pnpm db:push`
- `pnpm db:seed`
- `pnpm lint`
- `pnpm test`
- `pnpm e2e`
- `pnpm --filter api build`
- `pnpm --filter admin build`
- `pnpm --filter miniapp build:h5`
- `pnpm build:weapp`
- `pnpm release:check`

If a command is absent or blocked by unrelated local failures, record the exact command, key failure, and substitute verification.

## Implementation Result

- Added shared Article schemas/DTOs, category normalization, `article` menu type/config, `article.cover` media field, `article_cover` media source, and `article` detail-page reference source.
- Added Prisma `Article` model and idempotent SQLite `articles` table/index bootstrap.
- Added client/admin Article APIs, home `featuredArticles`, article categories, media deletion protection, detail-page deletion protection, and seed data.
- Added Admin “文章管理” routes, sidebar entry, list filters, editor fields, article category autocomplete, article menu config Select with stable “全部文章” internal value, `MediaField fieldKey="article.cover"`, and `DetailPageReferenceField`.
- Added miniapp shared `ArticleCard`, `/pages/articles/list`, article menu `navigateTo` query handling, home featured article section, and shared local time formatter.
- Added `docs/design/article-module.md`. Final screenshot evidence is expected at `docs/design/actual-home-h5.png`, `docs/design/actual-articles-list-h5.png`, `docs/design/admin-articles-list.png`, `docs/design/admin-article-editor.png`, and `docs/design/admin-article-menu-config.png`.
- Seed reuses existing generated horizontal images/icons; 复用已有资源，未使用参考图切片。

## Validation Actually Run

- `pnpm --filter api prisma:generate` passed.
- `pnpm --filter @event-arts/shared test` passed.
- `pnpm --filter api test` passed.
- `pnpm --filter miniapp test` passed.
- `pnpm --filter admin test` passed.
- `pnpm --filter api build` passed.
- `pnpm --filter admin build` passed after fixing a local TypeScript inference issue in menu config normalization.
- `pnpm --filter miniapp build:h5` passed.
- `pnpm install` passed; pnpm printed a non-fatal registry metadata fetch warning while reporting the lockfile was already up to date.
- `pnpm db:push` passed.
- `pnpm db:seed` passed.
- `pnpm lint` passed.
- `pnpm test` passed.
- `pnpm e2e` passed with 43 tests.
- `pnpm build:weapp` passed.
- `pnpm release:check` passed.
- Temporary screenshot capture via Playwright passed; generated `docs/design/actual-home-h5.png`, `docs/design/actual-articles-list-h5.png`, `docs/design/admin-articles-list.png`, `docs/design/admin-article-editor.png`, and `docs/design/admin-article-menu-config.png`.
