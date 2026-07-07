<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design — Storybook per-app CSS fidelity

**Date:** 2026-07-07
**Status:** Approved (design); ready for implementation planning

## 1. Goal

Make every Storybook story render with the **same global CSS the real app serves for that story's area** — matching typography, colors, CSS variables, sizes, gaps, and every other global class. Today stories render against a single merged stylesheet that both omits `settings.css` and collapses per-app CSS into one sheet, so section stories (and their screenshots) don't match the real app.

## 2. Root cause

`package.json`'s `storybook:prepare` builds the global sheet by concatenation:

```
cat client/shared/base.css client/shared/tokens.css client/admin/admin.css \
    client/debug/debug.css client/transcript/transcript.css > public/storybook-base.css
```

`.storybook/preview-head.html` links that one file for all stories. Two problems:

1. **`client/settings/settings.css` is omitted entirely** — so settings-only global classes (`.t-label`, `.t-subhead`, `.t-body`, `.t-help`, and settings' own `.status-*`/`.placeholder`) never apply in stories.
2. **All apps' CSS are merged into one sheet.** The real app loads exactly one app's CSS per page (`settings.html` → `/settings.css`, `admin.html` → `/admin.css`, …) plus the shared base/tokens. Several classes are defined **differently** per app and collide when merged — e.g. `.placeholder` is `color: var(--text-muted)` in settings, `color: var(--fg2)` in admin, and `color: var(--border); font-style: italic` in debug. In the merged sheet the last-concatenated definition wins for **every** story, so (with the current order) settings stories render `.placeholder` in debug's italic gray. A single merged sheet cannot faithfully mirror per-app CSS.

`bun storybook` runs `storybook:prepare` first, so the sheet is regenerated (not stale) — the defect is structural, not staleness. `public/` is gitignored, so the artifact isn't committed.

## 3. Architecture — per-app CSS injected per story

Each story loads **base + tokens + only its own app's CSS**, reproducing the real app's per-page composition.

### 3.1 Source-of-truth imports (`preview.ts`)

Import each global stylesheet as a raw string via Vite's native `?raw` (plain CSS, no `@import`, no PostCSS needed — `?raw` yields the exact source):

```ts
import baseCss from '../client/shared/base.css?raw'
import tokensCss from '../client/shared/tokens.css?raw'
import settingsCss from '../client/settings/settings.css?raw'
import adminCss from '../client/admin/admin.css?raw'
import debugCss from '../client/debug/debug.css?raw'
import transcriptCss from '../client/transcript/transcript.css?raw'
```

This is fresh from source on every build — no `public/` artifact, no drift.

### 3.2 App resolution (title-prefix — total, no overrides)

Every story's `defineMeta` `title` is prefixed with its area: verified that **all** stories start with one of `shared/`, `settings/`, `admin/`, `debug/`, `transcript/` (no un-prefixed titles exist). So the app is the first title segment:

```ts
function appCssFor(title: string): string {
  const area = title.split('/')[0]
  const map: Record<string, string> = {
    settings: settingsCss,
    admin: adminCss,
    debug: debugCss,
    transcript: transcriptCss,
  }
  // `shared/*` and anything unmapped get base+tokens only.
  return map[area] ?? ''
}
```

No per-story `parameters` override is required (there are no outliers). If a future story is added with an un-prefixed title, it safely falls back to base+tokens only.

### 3.3 Per-story injection

A single global decorator (or Storybook 9 preview `beforeEach`, whichever the framework applies before first paint) upserts one `<style id="sb-app-globals">` in the preview `document.head` on each story render:

```
styleEl.textContent = baseCss + '\n' + tokensCss + '\n' + appCssFor(context.title)
```

Because base+tokens are always included and only one app's CSS is ever present, cross-app collisions are impossible and injection is synchronous (content set before the story renders → no async flash for screenshots). The implementation must confirm the chosen hook runs before the story's first paint (so `bun shoot` captures the styled state); if a bare `beforeEach` proves to run too late for the very first story, fall back to a decorator that sets the style during render.

### 3.4 Remove the merged path

- `package.json` `storybook:prepare`: drop the `cat … > public/storybook-base.css` segment; keep `mkdir -p public && msw init public/ --no-save`.
- `.storybook/preview-head.html`: remove the `<link rel="stylesheet" href="/storybook-base.css" />`. (Leave the file empty or delete it if the framework tolerates its absence.)
- No committed-file cleanup — `public/` is gitignored.

## 4. Testing & verification

- **Unit test** for `appCssFor` (extract it to an importable module, e.g. `.storybook/app-css.ts`, so it's testable without a browser): `settings/sections/ByokSection` → settings CSS; `settings/sections/admin/AdminByokSection` → settings CSS (first segment wins); `admin/...` → admin; `debug/...` → debug; `transcript/...` → transcript; `shared/ui/Field` → base+tokens only (empty app CSS); unknown prefix → empty.
- **Smoke check** early: confirm `?raw` CSS imports resolve under `@storybook/svelte-vite` (build/serve Storybook once, verify a settings story shows `.t-label` uppercase and `.placeholder` non-italic text-muted).
- **Full re-baseline** via `bun shoot` (all stories). This is a large but **corrective** churn:
  - **settings/** stories change the most — `.placeholder` no longer debug-italic-gray; `.t-label`/`.t-subhead`/`.t-body`/`.t-help` now styled; any settings-only global now applies.
  - **admin/ debug/ transcript/** stories lose any cross-app bleed (they now see only their own app CSS + shared).
  - **shared/** stories should be unchanged (they already depend only on base+tokens).
- **Spot-check** one story per area by reading the re-shot PNG: a settings section (placeholder/label corrected), an admin section, a debug component, a transcript component, and a shared primitive (unchanged) — confirming each renders with its own app's globals.
- `.storybook-shots/` is gitignored; nothing to commit there.

## 5. Risks & mitigations

- **`?raw` support / content correctness.** Native Vite feature; the CSS is plain (no `@import`/PostCSS). Mitigation: the early smoke check (§4) validates it before the rest of the work.
- **Injection timing for screenshots.** Mitigation: synchronous string injection via the pre-paint hook; §3.3 names the decorator fallback if `beforeEach` is too late.
- **Large re-baseline.** Expected and corrective. Mitigation: spot-check per area; the change is CSS-wiring only (no component/logic changes), so any per-story content difference is a pure styling correction.
- **A future un-prefixed story title.** Mitigation: `appCssFor` falls back to base+tokens (safe, shared-only); the unit test documents the contract.

## 6. Definition of done

- `preview.ts` injects `base + tokens + <own-app CSS>` per story, resolved by title prefix; no story renders another app's global CSS.
- The merged `storybook-base.css` cat step and its `preview-head.html` link are removed.
- `appCssFor` has a passing unit test; a settings story visibly shows `.t-label` uppercase and `.placeholder` as text-muted (not debug italic).
- All stories re-baselined; per-area spot-checks confirm fidelity; `bun run check` passes.
