<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0269: Storybook Per-App CSS Fidelity

## Status

Implemented (with divergence)

## Date

2026-07-07

## Context

Storybook stories did not match the real app's styling. The root cause was structural: `package.json`'s `storybook:prepare` built the one global stylesheet every story shared by concatenation — `cat base.css tokens.css admin.css debug.css transcript.css > public/storybook-base.css` — and `.storybook/preview-head.html` linked that single sheet for all stories. Two defects followed:

1. **`client/settings/settings.css` was omitted entirely**, so settings-only global classes (`.t-label`, `.t-subhead`, `.t-body`, `.t-help`, and settings' own `.status-*` / `.placeholder`) never applied in stories.
2. **All four apps' CSS were merged into one sheet.** The real app loads exactly one app's CSS per page (`settings.html` → `/settings.css`, `admin.html` → `/admin.css`, …) plus shared base/tokens, but several classes are defined **differently** per app and collide when merged — e.g. `.placeholder` is `color: var(--text-muted)` in settings, `color: var(--fg2)` in admin, and `color: var(--border); font-style: italic` in debug. In the merged sheet the last-concatenated definition wins for **every** story, so settings stories rendered `.placeholder` in debug's italic gray. A single merged sheet cannot faithfully mirror per-app CSS.

The design (`docs/superpowers/specs/2026-07-07-storybook-per-app-css-fidelity-design.md`) and plan (`docs/superpowers/plans/2026-07-07-storybook-per-app-css-fidelity.md`) resolved both by making each story load **base + tokens + only its own app's CSS**, resolved from the story title's first segment (`shared/`, `settings/`, `admin/`, `debug/`, `transcript/` — verified a total map, no un-prefixed titles), and removing the merged `storybook-base.css` path. The original design delivered this by importing each global stylesheet via Vite `?raw` and setting a single `<style id="sb-app-globals">`'s `textContent` before render.

## Decision Drivers

- **Match the real app's per-page CSS composition.** Each story must see base+tokens plus exactly one app's globals — the same sheet that app's HTML page serves — not a merged cross-app sheet.
- **Stop omitting `settings.css`.** Settings-only globals (`.t-label`, `.placeholder`, `.t-subhead`, …) must apply in settings stories; screenshots must reflect the real settings styling.
- **Eliminate cross-app collisions.** No story may inherit another app's winning definition for a class defined per-app (`.placeholder` is the worked example); per-app isolation, not a merged sheet, is the only faithful model.
- **Total, override-free resolution.** Every story title is app-prefixed, so the first title segment is a total key; no per-story `parameters` override should be required, and any future un-prefixed title must fall back safely to base+tokens.
- **Screenshots capture the styled state.** Whatever injection mechanism ships, the CSS must be applied before `bun shoot` captures the story (the shoot driver waits on storyRendered + fonts, not on stylesheet load), so injection timing is load-bearing.
- **Stay within hook-protected lint/type rules.** No `lint-disable`/`type-ignore` (hook policy blocks them); any chosen mechanism must pass oxlint's type-aware pass and tsc without suppressions.

## Considered Options

### Option 1 — Per-app CSS per story, resolved by title prefix (chosen)

Give each story base+tokens+only-its-own-app-CSS. Resolve the app from the story title's first segment via a pure `appAreaFor` mapping; inject the resolved sheet per story from the preview iframe; drop the merged `storybook-base.css` cat step and its `preview-head.html` link.

- **Pros:** directly resolves both defects (settings.css omission + cross-app collisions); mirrors the real app's per-page composition exactly; the pure mapping is unit-testable without a browser; resolution is total and a safe base+tokens fallback covers any future un-prefixed title.
- **Cons:** adds a per-story injection step whose timing must be correct for screenshots; re-baselines every story (a large but corrective churn).

### Option 2 — Keep one merged sheet, just add `settings.css` to the cat

Append `settings.css` to the existing `cat … > public/storybook-base.css` so settings-only classes are present, but leave all apps merged.

- **Pros:** smallest diff; no per-story machinery.
- **Cons:** does not address the collision defect — with settings.css added, `.placeholder` is still defined four ways in one sheet and the last-concatenated definition still wins for every story; the merged-sheet model is the structural defect, not the missing file alone.

### Option 3 — Inline `?raw` CSS strings into a per-story `<style>` (the plan's original mechanism)

Import each global stylesheet via Vite's native `?raw`, compose `base + tokens + appCssFor(title)` as a string, and set one `<style id="sb-app-globals">`'s `textContent` synchronously before render; gate the raw imports behind an ambient `declare module '*?raw'`.

- **Pros:** fresh-from-source on every build (no `public/` artifact, no drift); synchronous string injection makes the screenshot-timing concern trivial.
- **Cons:** oxlint's type-aware pass reports `TS2307` for Vite's `*?raw` wildcard ambient module (tsc resolves it, oxlint does not), and the lint config is hook-protected so it cannot be scoped off without a `lint-disable`. **Abandoned at build time for this reason** — recorded in both the plan and the spec "Implementation note" blocks.

## Decision

The chosen Option 1 shipped in full — every story renders with base+tokens + only its own app's CSS, and the merged-sheet path is gone — but via the **static per-app stylesheets + `<link>` swap** mechanism (not Option 3's inline `?raw` strings). What shipped:

1. **Pure `appAreaFor` mapping (`client/stories/app-area.ts`).** `AppArea = 'settings' | 'admin' | 'debug' | 'transcript'`; `appAreaFor(title)` returns the title's first segment when it is one of those four, else `null` (covers `shared/*` and any unmapped prefix). No CSS import, so it is unit-testable without a browser.
2. **Unit test (`tests/client/stories/app-area.test.ts`).** Asserts app-prefixed titles map to their area with first-segment-wins (incl. `settings/sections/admin/AdminByokSection` → `settings`), and `shared/*` / unknown prefixes → `null`.
3. **Per-story `<link>` swap in `preview.ts`.** A loader upserts a single `<link id="sb-app-globals" rel="stylesheet">`, points it at `/storybook-<area>.css` (resolved by `appAreaFor`, falling back to `storybook-shared.css`), and **resolves only once the sheet's `load` event fires** (resolving on `error` too, so a missing sheet never hangs the preview). Storybook awaits loaders before render, so screenshots capture the styled state.
4. **Per-app sheet generation in `storybook:prepare`.** `package.json` now `cat`s `base+tokens` into `public/storybook-shared.css` and `base+tokens+<app>` into `public/storybook-{settings,admin,debug,transcript}.css`. The old `cat … > public/storybook-base.css` segment is removed.
5. **Merged-sheet path removed.** `.storybook/preview-head.html` is emptied (the `<link rel="stylesheet" href="/storybook-base.css" />` is gone); no committed-file cleanup was needed (`public/` is gitignored).

## Consequences

### Positive

- Settings stories now render with `settings.css`: `.t-label` is uppercase, `.placeholder` is `--text-muted` (not debug's italic gray), and every settings-only global applies.
- Each app's stories see only their own app's CSS + shared, so per-app class collisions are impossible — admin/debug/transcript stories also lose any cross-app bleed.
- Shared stories are unchanged: they depend only on base+tokens, which `storybook-shared.css` provides verbatim.
- Resolution is total and unit-tested; a future un-prefixed title safely falls back to `storybook-shared.css` (base+tokens).
- No typed CSS imports, so the build passes oxlint/tsc without suppressions (the friction that killed Option 3).

### Negative

- `storybook:prepare` now generates five gitignored sheets instead of one — a slightly heavier prepare step, regenerated on every `bun storybook` / `build:storybook`.
- The loader became async: each story pays a stylesheet-`load` await before render (necessary because a `<link>` swap, unlike synchronous `textContent`, can't guarantee application before first paint).

### Risks

- **Screenshot fidelity rests on the `<link>` `load` event.** The `error` path also resolves, so a missing/broken sheet never hangs the preview — but it could let an unstyled screenshot pass silently. Mitigated by `storybook:prepare` regenerating the sheets immediately before serve/build.
- **`public/` is gitignored and not integrity-checked.** A hand-edited or stale generated sheet would not be caught by git; the `storybook`/`build:storybook` scripts chain `storybook:prepare` first, so the artifact is regenerated (not stale) in the normal flow, but a direct `storybook dev` invocation would skip regeneration.
- **Per-area fidelity is a runtime/visual property.** The code structure guarantees each story is *offered* only its own app's sheet, but the "it renders correctly" claim (`.t-label` uppercase, `.placeholder` non-italic) is a `bun shoot` spot-check, not statically verifiable from the tree.

## Related Decisions

- The original Storybook harness (`docs/archive/2026-05-23-storybook-harness-pr1.md`) that introduced the merged `storybook-base.css` cat step and `preview-head.html` link this work removes — the structural defect being corrected.
- The general Storybook visual-feedback loop (`docs/architecture/storybook-screenshots.md`) — the screenshot pipeline (`bun shoot`, `.storybook-shots/`) whose fidelity this work restores.

## Implementation Notes

Verified present against the shipped tree via `grep` / `glob` / `read`.

| File | Role | Evidence |
| --- | --- | --- |
| `client/stories/app-area.ts:6` | `AppArea` type union. | `read` confirms. |
| `client/stories/app-area.ts:12-18` | `appAreaFor(title)` — first-segment match → area, else `null`. | `read` confirms. |
| `tests/client/stories/app-area.test.ts:10-17` | Unit test: app-prefixed titles map to area (first segment wins, incl. `settings/sections/admin/*`). | `read` confirms. |
| `tests/client/stories/app-area.test.ts:19-23` | Unit test: `shared/*` and unmapped prefixes → `null`. | `read` confirms. |
| `.storybook/preview.ts:9` | `appAreaFor` imported from `client/stories/app-area.js`. | `read` confirms. |
| `.storybook/preview.ts:26-29` | `appGlobalsHref` builds `/storybook-${area ?? 'shared'}.css`. | `read` confirms. |
| `.storybook/preview.ts:31-40` | `ensureLink` upserts a single `<link id="sb-app-globals" rel="stylesheet">`. | `read` confirms. |
| `.storybook/preview.ts:46-59` | `applyAppGlobals` swaps the `<link>` href and returns a `Promise` that resolves on the sheet's `load`/`error` event. | `read` confirms. |
| `.storybook/preview.ts:65-71` | `loaders` runs `applyAppGlobals` before `fixturesLoader`. | `read` confirms. |
| `package.json:19` | `storybook:prepare` generates `storybook-{shared,settings,admin,debug,transcript}.css`; the `cat … storybook-base.css` segment is gone. | `read` confirms. |
| `.storybook/preview-head.html` | Empty — the `/storybook-base.css` `<link>` removed. | `read` confirms. |

Plan-vs-implementation notes:

- **The injection mechanism materially changed: static per-app stylesheets + `<link>` swap, not inline `?raw` `<style>`.** Option 3 (the plan/spec's primary design, §3.1 / Task 1 Step 4) imported each CSS via Vite `?raw` and set `styleEl.textContent = base + tokens + appCssFor(title)` synchronously. As built, `storybook:prepare` generates one static `public/storybook-<area>.css` per area (base+tokens+app) plus `storybook-shared.css` (base+tokens), and `preview.ts` swaps a single `<link href>` per story. The reason is recorded in both the plan and the spec "Implementation note" blocks: oxlint's type-aware pass reports `TS2307` for Vite's `*?raw` wildcard ambient module (tsc resolves it, oxlint does not) and the lint config is hook-protected, so it cannot be scoped off without a `lint-disable`. The per-app fidelity guarantee is unchanged; only the delivery mechanism differs.
- **`client/stories/vite-raw.d.ts` was never created.** The plan's Task 1 Step 3 specified the `declare module '*?raw'` ambient declaration. With the `?raw` approach abandoned, the file is absent (glob finds no match) — the natural consequence of the divergence above.
- **The loader is async and awaits the stylesheet's `load` event.** The plan/spec assumed synchronous string injection (content set before render). A `<link>`-swap cannot guarantee application before first paint, so `applyAppGlobals` returns a `Promise<void>` resolving on the `<link>`'s `load` (or `error`) event; Storybook awaits loaders before render, gating screenshots on the styled state. The plan's "Implementation note" block documents this (`awaiting the sheet's load before render so screenshots capture the styled state`).
- **Shared/unmapped areas resolve to a real `storybook-shared.css` sheet, not an empty app string.** The plan's `appCssFor` returned `''` for shared/unmapped, composing to `base+tokens` inside the `<style>`. As built, `appGlobalsHref` maps `area ?? 'shared'` to `/storybook-shared.css`, which `storybook:prepare` generates as `base+tokens`. Net fidelity is identical; the resolution path differs.
- **The `SHARED_CSS` / `APP_CSS` constants from the plan's `preview.ts` are absent.** They were the `?raw`-string composition; replaced by the per-app file generation in `storybook:prepare`, so `preview.ts` carries no CSS string constants.
- **`preview-head.html` is fully empty rather than "a single empty line".** The plan's Task 1 Step 5 said to replace its contents with a single empty line; the shipped file is zero bytes. Intent identical (the `<link>` is gone); the framework tolerates an empty file.

The source plan `docs/superpowers/plans/2026-07-07-storybook-per-app-css-fidelity.md` and design `docs/superpowers/specs/2026-07-07-storybook-per-app-css-fidelity-design.md` are archived alongside this ADR to `docs/archive/`.
