# Stage 1 Assets and Design Plan

## Goal
Persist the supplied homepage reference, generate deterministic test assets, and record asset dimensions for seed data and UI fallback behavior.

## Files
- `docs/design/reference-home.png`
- `scripts/slice-home-assets.ts`
- `apps/miniapp/src/assets/generated/*`
- `docs/design/assets-manifest.json`
- `docs/stages/01-assets-and-design.md`

## Implementation Steps
1. Copy the attached reference image to `docs/design/reference-home.png`.
2. Implement `scripts/slice-home-assets.ts` with Sharp.
3. Generate:
   - `banner-default.png` `1420x580`
   - `placeholder-banner.png` `1420x580`
   - `icon-host.png` `176x176`
   - `icon-singer.png` `176x176`
   - `icon-actor.png` `176x176`
   - `icon-case.png` `176x176`
   - `icon-contact.png` `176x176`
   - `placeholder-icon.png` `176x176`
   - `case-1.png` `460x320`
   - `case-2.png` `460x320`
   - `case-3.png` `460x320`
   - `placeholder-case.png` `460x320`
4. Use cover resize and neutral warm backgrounds where the screenshot crop is smaller than target.
5. Write `docs/design/assets-manifest.json` with source crop, output size, expected size, and pass/fail.
6. Update Stage 1 doc with crop strategy and validation result.

## Tests
- `pnpm assets:slice`
- Manifest must show every output `valid: true`.

## Commit
`feat(assets): generate homepage test assets`
