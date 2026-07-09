# Stage 0 Foundation Plan

## Goal
Create the monorepo baseline, shared contracts, project standards, and durable documentation required by every later agent.

## Files
- Root: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`, `prettier.config.cjs`, `.gitignore`, `.env.example`.
- Docs: `AGENTS.md`, `README.md`, `docs/stages/*.md`, `docs/api/index.md`.
- Shared: `packages/shared/src/index.ts`, `packages/shared/test/contracts.test.ts`.

## Implementation Steps
1. Create pnpm workspace with `apps/*` and `packages/*`.
2. Add root scripts: `dev:api`, `dev:admin`, `dev:h5`, `build:weapp`, `lint`, `test`, `e2e`, `assets:slice`, `release:check`.
3. Add TypeScript strict baseline and ESLint/Prettier config.
4. Add `AGENTS.md` with project goals, owned paths, test rules, API conventions, media rules, and menu enum.
5. Add `README.md` setup, database, dev, build, test, default admin, production warnings, upload/object storage notes.
6. Add stage docs with the required sections and unchecked acceptance lists.
7. Add shared enums/types/Zod schemas and contract tests.

## Tests
- `pnpm --filter @event-arts/shared test`
- `pnpm lint`
- `pnpm test`

## Commit
`chore(repo): initialize monorepo standards and stage docs`
