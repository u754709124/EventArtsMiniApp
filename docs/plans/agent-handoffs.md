# Agent Handoffs

## Global Context
Read `AGENTS.md` and the relevant `docs/plans/*.md` before editing. The repository is a pnpm monorepo for a Taro miniapp, Fastify API, Ant Design admin CMS, shared contracts, and automated tests.

## Backend Agent
Owned paths:
- `apps/api/**`
- API sections in `docs/api/index.md`
- Stage 2 doc updates

Must not edit:
- `apps/admin/**`
- `apps/miniapp/**` except when documenting API consumption assumptions.

## Admin Agent
Owned paths:
- `apps/admin/**`
- Admin E2E selectors in coordination with QA
- Stage 3 doc updates

Must use shared types and documented `/api/admin/*` routes.

## Miniapp Agent
Owned paths:
- `apps/miniapp/**`
- Stage 4 doc updates

Must keep route paths exactly as specified and preserve H5/weapp compatibility.

## Assets/Design Agent
Owned paths:
- `scripts/slice-home-assets.ts`
- `docs/design/**`
- `apps/miniapp/src/assets/generated/**`
- Stage 1 and design sections in Stage 5

Must keep generated dimensions exact.

## QA Agent
Owned paths:
- `playwright.config.ts`
- `tests/e2e/**`
- Stage 5 doc updates

Must avoid brittle CSS selectors and prefer `data-testid`.

## Release Integration Agent
Owned paths:
- Root configs
- README
- Stage 6 doc
- Integration fixes across packages after reviewing conflicts

Must run and record final verification commands.
