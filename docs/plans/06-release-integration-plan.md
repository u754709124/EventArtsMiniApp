# Stage 6 Release Integration Plan

## Goal
Run final checks, fix integration issues, complete build/deploy documentation, and finalize phase-one delivery.

## Files
- `docs/stages/06-weapp-build-and-deploy.md`
- All stage docs commit hash sections.
- README updates if commands or environment changed.

## Final Command Order
1. `pnpm install`
2. `pnpm lint`
3. `pnpm test`
4. `pnpm e2e`
5. `pnpm --filter api build`
6. `pnpm --filter admin build`
7. `pnpm --filter miniapp build:h5`
8. `pnpm build:weapp`

## Required Verification Checklist
- Menu enum is exactly host/singer/actor/activity_case/contact.
- TabBar fixed with 首页/分类/案例/我的.
- Admin save immediately affects client home after refresh.
- Image upload dimension validation happens on backend.
- Referenced media cannot be deleted.
- Home API failure shows retry error state.
- Image load failure shows placeholders.
- Featured cases use `activity_cases`.
- H5 design review screenshot exists.
- Weapp build output exists.

## Release Doc Content
`docs/stages/06-weapp-build-and-deploy.md` must include:
- Build commands.
- WeChat DevTools import directory.
- Production environment variables.
- API Base URL configuration.
- Image/video storage notes.
- Launch checklist.
- Known limitations and extension points.

## Commit
`chore(release): finalize phase one delivery`
