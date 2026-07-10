# Home Visual Calibration Plan

## Goal
Bring the Taro H5 homepage typography, component scale, and vertical rhythm into basic visual alignment with `docs/design/reference-home.png`, while preserving the phase-one data model and five-menu scope.

## Design Decision
- Preserve the `750rpx` layout baseline, `20rpx` page gutters, `710rpx x 290rpx` Banner and the five supported menu types.
- Compare logical layout, not raw PNG pixels: the reference is a 375-point mobile composition and the H5 test runs at a 430px mobile viewport with a different device scale factor.
- In H5, use a smaller safe-top fallback than WeChat because the browser does not render the capsule button. In WeChat, retain the runtime menu-button calculation.
- Keep all three featured cards visible in the horizontal row and cap text to a predictable two-line hierarchy so card heights remain comparable.

## Files
- Modify: `apps/miniapp/src/pages/index/index.tsx` - select a platform-aware header safe-top fallback.
- Modify: `apps/miniapp/src/pages/index/index.scss` - tune type scale, block spacing, and case-card text clamping.
- Modify: `tests/e2e/miniapp-h5.spec.ts` - add geometry assertions before changing production styles.
- Modify: `docs/plans/README.md` - index this plan.
- Modify: `docs/stages/04-miniapp-home.md` and `docs/stages/05-e2e-and-design-review.md` - record the completed calibration and screenshot review.

## Target Geometry At The H5 Test Viewport
- Header title top is within 30-44 CSS px; its visual role is 36rpx bold with a 24rpx subtitle.
- Announcement starts within 76-96 CSS px, and Banner starts within 112-138 CSS px; the Banner keeps its 710:290 ratio.
- Menu icons retain 88rpx visual size; five menu items occupy one row because only five phase-one menu types are seeded.
- Featured-case title and summary render at no more than two lines. The first featured-card height is at most 220 CSS px in the fixed Playwright viewport.
- The fixed four-item TabBar remains visible and no homepage content overlaps it.

## Task 1 - Establish Failing Visual Geometry Coverage

1. Add a `首页视觉尺寸与位置接近参考图` test after `首页成功加载，小程序名和副标题来自接口` in `tests/e2e/miniapp-h5.spec.ts`.
2. In the test, call `openHome(page)` and collect `getBoundingClientRect()` values for `[data-testid="home-app-name"]`, `[data-testid="home-announcement"]`, `[data-testid="home-banner"]`, `[data-testid="home-menu"]`, and the first `[data-testid="home-case-card"]`.
3. Assert `title.top` is at most `44`, `banner.top` is at most `138`, `banner.width / banner.height` is close to `710 / 290`, and the first case-card height is at most `220`.
4. Run `pnpm e2e -- --grep "首页视觉尺寸与位置接近参考图"` with the same elevated execution needed for the Taro H5 server. The existing H5 fallback and unbounded case copy must fail the title/top or card-height assertion before implementation.

## Task 2 - Calibrate The Homepage Without Changing Its Contract

1. In `useSafeTop`, return `32` for the Taro H5 environment before trying the WeChat capsule calculation. Preserve `rect.top + 12` for the mini program and the current `52` fallback for non-H5 runtime failures.
2. In `index.scss`, set an explicit 36rpx / 24rpx header scale with stable line heights; give announcement summary/content explicit 26rpx / 24rpx roles; retain the warm colors and 710rpx container geometry.
3. Tighten the case-card rhythm with 24rpx title, 20rpx summary, 20rpx metadata, 20rpx button label, 6rpx internal gaps, and two-line title/summary clamps. Keep the 226rpx x 158rpx image footprint and click behavior unchanged.
4. Run the focused visual geometry test again. It must pass without weakening its thresholds.

## Task 3 - Verify, Capture, and Document

1. Run `pnpm lint`, `pnpm test`, `pnpm e2e`, `pnpm --filter miniapp build:h5`, and `pnpm build:weapp`. Run H5/Taro commands with elevated execution if the current sandbox again blocks macOS SystemConfiguration.
2. Inspect the regenerated `docs/design/actual-home-h5.png` beside `docs/design/reference-home.png`: title/subtitle, announcement, Banner, menu icon row, featured case cards, and TabBar must retain their intended alignment and proportions.
3. Mark this plan's three tasks complete; update Stage 4 and Stage 5 with the measured scope and current screenshot path.
4. Commit the implementation and documentation with a Conventional Commit after the verification matrix passes.

## Completion
- [x] Task 1: Added deterministic H5 geometry checks for the header/Banner position and first featured-card height; both checks failed against the prior styles.
- [x] Task 2: Added an H5-only 36px safe-top, explicit header/notice line heights, a compact 224rpx card body, two-line clamps, and block-level cover images.
- [x] Task 3: `pnpm e2e` passed 20 scenarios and regenerated `docs/design/actual-home-h5.png`. Final lint, unit, and build verification is recorded in the Stage 4/5/6 documents.
