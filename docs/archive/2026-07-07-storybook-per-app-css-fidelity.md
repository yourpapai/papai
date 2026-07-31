<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Storybook Per-App CSS Fidelity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each Storybook story render with `base + tokens + only its own app's CSS` (matching what the real app serves), instead of a single merged sheet that omits `settings.css` and collapses per-app CSS into one file.

**Architecture:** `preview.ts` imports each global stylesheet via Vite `?raw`, and a loader injects one `<style id="sb-app-globals">` per story = `base + tokens + appCssFor(title)`, resolved by the story title's first segment. The merged `storybook-base.css` cat step and its `preview-head.html` link are removed.

> **Implementation note (as-built).** The `?raw` import mechanism in Task 1 was abandoned
> because oxlint's type-aware pass can't resolve Vite's `*?raw` ambient module (`TS2307`) and
> the lint config is hook-protected. As shipped, `storybook:prepare` instead generates one
> static `public/storybook-<area>.css` per app (base+tokens+app) plus `storybook-shared.css`,
> and the preview loader swaps a single `<link id="sb-app-globals">` per story (keyed by
> `appAreaFor`), **awaiting the sheet's `load` before render** so screenshots capture the
> styled state. Same per-app fidelity; no typed CSS imports. Commits: `f2ec66c6d`,
> `b7f5b2fd7`, `82b967681`.

**Tech Stack:** Storybook 9 (`@storybook/svelte-vite`, Vite builder); TypeScript (`.js` import extensions); Bun test runner; `bun shoot` (Playwright) screenshots.

**Spec:** [`docs/superpowers/specs/2026-07-07-storybook-per-app-css-fidelity-design.md`](../specs/2026-07-07-storybook-per-app-css-fidelity-design.md)

---

## Background the engineer needs

- **Root cause:** `package.json` `storybook:prepare` does `cat base.css tokens.css admin.css debug.css transcript.css > public/storybook-base.css` (omits `settings.css`, merges all apps). `.storybook/preview-head.html` links that one file. `.placeholder` differs per app (settings `--text-muted`; debug `--border` + italic), so the merged sheet makes debug's win for settings stories. `public/` is gitignored — the artifact isn't committed.
- **All story titles are app-prefixed** (`shared/`, `settings/`, `admin/`, `debug/`, `transcript/`) — verified, no un-prefixed titles — so a first-segment map is total.
- `preview.ts` currently exposes a `loaders: [fixturesLoader]` array; loaders run before each story renders and receive the story `context` (with `title`) in the preview iframe (so `document` is available). This is the injection point.
- **Client tests** run via `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' <path>`. Formatter is `oxfmt` (`bun run format`), never prettier. `.js` import extensions; no lint-disable/type-ignore. Every new source/test file needs the SPDX license header block.
- Commit to the current branch (`master`) — authorized.

## File structure

| File                                    | Task | Change                                                                        |
| --------------------------------------- | ---- | ----------------------------------------------------------------------------- |
| `client/stories/app-area.ts`            | 1    | **New.** Pure `appAreaFor(title)` mapping (no CSS import → unit-testable).    |
| `client/stories/vite-raw.d.ts`          | 1    | **New.** Ambient `declare module '*?raw'` so tsc accepts the raw CSS imports. |
| `.storybook/preview.ts`                 | 1    | Import CSS via `?raw`; loader injects `base+tokens+appCss` per story.         |
| `.storybook/preview-head.html`          | 1    | Remove the `/storybook-base.css` `<link>`.                                    |
| `package.json`                          | 1    | `storybook:prepare`: drop the `cat … storybook-base.css` segment.             |
| `tests/client/stories/app-area.test.ts` | 1    | **New.** Unit test for `appAreaFor`.                                          |
| `.storybook-shots/**` (gitignored)      | 2    | Full re-baseline.                                                             |

---

## Task 1: Per-app CSS injection + cleanup + unit test

**Files:** as above (Task 1 rows).

- [ ] **Step 1: Write the failing unit test**

Create `tests/client/stories/app-area.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { appAreaFor } from '../../../client/stories/app-area.js'

describe('appAreaFor', () => {
  test('maps app-prefixed titles to their area (first segment wins)', () => {
    expect(appAreaFor('settings/sections/ByokSection')).toBe('settings')
    expect(appAreaFor('settings/sections/admin/AdminByokSection')).toBe('settings')
    expect(appAreaFor('admin/AdminApp')).toBe('admin')
    expect(appAreaFor('debug/components/LogExplorer')).toBe('debug')
    expect(appAreaFor('transcript/TranscriptApp')).toBe('transcript')
  })

  test('returns null for shared and unmapped areas', () => {
    expect(appAreaFor('shared/ui/Field')).toBeNull()
    expect(appAreaFor('Whatever/Else')).toBeNull()
    expect(appAreaFor('Nobar')).toBeNull()
  })
})
```

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/stories/app-area.test.ts`
Expected: FAIL — `client/stories/app-area.js` does not exist.

- [ ] **Step 2: Create the pure mapping**

Create `client/stories/app-area.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type AppArea = 'settings' | 'admin' | 'debug' | 'transcript'

/**
 * Resolve a Storybook story's app area from its title's first segment.
 * Returns null for `shared/*` and any unmapped prefix (those get base+tokens only).
 */
export function appAreaFor(title: string): AppArea | null {
  const first = title.split('/')[0]
  if (first === 'settings' || first === 'admin' || first === 'debug' || first === 'transcript') {
    return first
  }
  return null
}
```

Run the test again:
`bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/stories/app-area.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 3: Add the ambient `?raw` module declaration**

Create `client/stories/vite-raw.d.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

declare module '*?raw' {
  const src: string
  export default src
}
```

- [ ] **Step 4: Rewrite `preview.ts` to inject per-app CSS**

Replace the entire contents of `.storybook/preview.ts` with:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Preview } from '@storybook/svelte-vite'
import { initialize } from 'msw-storybook-addon'

import adminCss from '../client/admin/admin.css?raw'
import debugCss from '../client/debug/debug.css?raw'
import baseCss from '../client/shared/base.css?raw'
import tokensCss from '../client/shared/tokens.css?raw'
import settingsCss from '../client/settings/settings.css?raw'
import { appAreaFor } from '../client/stories/app-area.js'
import { fixturesLoader } from '../client/stories/decorators/withFixtures.js'
import { assertFixturesMatchSchemas } from '../client/stories/fixtures/schemas.js'
import { installIntersectionObserverStub } from '../client/stories/stubs/intersection-observer.js'
import { installSseStub } from '../client/stories/stubs/sse.js'
import transcriptCss from '../client/transcript/transcript.css?raw'

// Fail fast at preview boot if any fixture has drifted from its live schema.
assertFixturesMatchSchemas()

initialize({ onUnhandledRequest: 'bypass' })
installSseStub()
installIntersectionObserverStub()

// Shared globals every app bundles; injected for every story.
const SHARED_CSS = `${baseCss}\n${tokensCss}`

// Per-app global CSS — a story gets exactly one, matching what the real app serves.
const APP_CSS: Record<string, string> = {
  settings: settingsCss,
  admin: adminCss,
  debug: debugCss,
  transcript: transcriptCss,
}

// Upsert a single <style> so each story renders with base+tokens + only its own app's CSS.
// Runs as a loader (before render) so screenshots capture the styled state.
function applyAppGlobals(title: string): void {
  const area = appAreaFor(title)
  const appCss = area !== null ? (APP_CSS[area] ?? '') : ''
  let styleEl = document.getElementById('sb-app-globals')
  if (styleEl === null) {
    styleEl = document.createElement('style')
    styleEl.id = 'sb-app-globals'
    document.head.appendChild(styleEl)
  }
  styleEl.textContent = `${SHARED_CSS}\n${appCss}`
}

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
  },
  loaders: [
    (context) => {
      applyAppGlobals(context.title)
      return {}
    },
    fixturesLoader,
  ],
}

export default preview
```

Note: import order follows the repo convention (external packages, then `?raw` asset imports, then local `.js` modules) — run `bun run format` if the linter reorders them.

- [ ] **Step 5: Remove the merged-sheet `<link>`**

Replace the entire contents of `.storybook/preview-head.html` with a single empty line (remove the `<link rel="stylesheet" href="/storybook-base.css" />`). The per-app CSS is now injected by the loader; no global link remains.

- [ ] **Step 6: Drop the cat from `storybook:prepare`**

In `package.json`, change the `storybook:prepare` script from:

```
"storybook:prepare": "mkdir -p public && msw init public/ --no-save && cat client/shared/base.css client/shared/tokens.css client/admin/admin.css client/debug/debug.css client/transcript/transcript.css > public/storybook-base.css",
```

to:

```
"storybook:prepare": "mkdir -p public && msw init public/ --no-save",
```

- [ ] **Step 7: Typecheck + format + unit test**

Run: `bun run format` (oxfmt), then `bun run check`.
Expected: lint/typecheck/format/license all pass. If tsc flags the `?raw` imports, confirm `client/stories/vite-raw.d.ts` is in the tsconfig include set (it is under `client/`); fix without suppressions.
Re-run the unit test to confirm it still passes:
`bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/stories/app-area.test.ts`

- [ ] **Step 8: Commit**

```bash
git add client/stories/app-area.ts client/stories/vite-raw.d.ts .storybook/preview.ts .storybook/preview-head.html package.json tests/client/stories/app-area.test.ts
git commit -m "feat(storybook): render each story with its own app's global CSS"
```

---

## Task 2: Restart Storybook, smoke-check, full re-baseline

**Files:** `.storybook-shots/**` (gitignored — nothing committed here).

This task validates `?raw` + injection on a real render, then re-baselines all stories. It requires a **clean Storybook restart** (the previously-running instance still has the old `/storybook-base.css` `<link>` in its iframe; HMR won't remove it).

- [ ] **Step 1: Restart Storybook cleanly**

Kill any process on port 6006, then start fresh so `storybook:prepare` runs without the cat and `preview.ts` reloads:

```bash
lsof -ti:6006 | xargs kill 2>/dev/null; true
```

Then start Storybook in the background: `bun storybook` (leave it running). Poll until it serves:

```bash
until [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:6006 2>/dev/null)" = "200" ]; do sleep 2; done; echo up
```

If Storybook fails to boot, the most likely cause is a `?raw` import path — fix and restart. (A boot failure here is the early smoke signal that `?raw` resolves.)

- [ ] **Step 2: Smoke-check a settings story**

Run: `bun shoot -g SettingsFieldShell`
Read `.storybook-shots/settings/components/SettingsFieldShell.spec.ts/settings-components-SettingsFieldShell-Editor-open-required-1.png` (or another settings PNG) and confirm the **settings** globals now apply: the required `*` is accent, and (on a story with a `.placeholder`) placeholder text is `--text-muted`, NOT debug's italic gray. Also shoot `bun shoot -g ByokSection` and confirm its "Loading"/"Disabled" `.placeholder` text is a solid muted color (not italic). If the settings globals are NOT applied (e.g. still italic placeholder), STOP and report — the injection isn't working.

- [ ] **Step 3: Full re-baseline**

Run: `bun shoot` (all stories). Expect it to pass (it writes new baselines with `--update-snapshots`). This is a large, intended churn.

- [ ] **Step 4: Per-area spot-check**

Read one re-shot PNG from each area and confirm each renders with its own app's globals (and shared is unchanged):

- **settings/** — a section PNG (e.g. `ByokSection`): `.placeholder` non-italic muted, `.t-label` uppercase where used.
- **admin/** — an admin section/component PNG: renders cleanly, no missing globals.
- **debug/** — a debug component PNG: its own `.placeholder` (italic) still applies (debug's intended style).
- **transcript/** — a transcript PNG: renders cleanly.
- **shared/** — a shared primitive (e.g. `Field`, `Btn`): unchanged vs before (depends only on base+tokens).

If any area's story is visibly missing its expected globals, STOP and report DONE_WITH_CONCERNS with the PNG.

- [ ] **Step 5: Final check**

Run: `bun run check` — expect pass (nothing new staged; confirms the tree is clean of tracked changes).
Confirm `git status --short` shows no tracked changes (only gitignored `.storybook-shots`/`public` differences).

- [ ] **Step 6: No commit**

`.storybook-shots/` is gitignored, so this task normally commits nothing. If `bun run check`/`bun run format` altered a tracked file, commit that:

```bash
git add -A && git commit -m "chore(storybook): formatting after per-app CSS change"
```

Otherwise report that no commit was needed.

---

## Self-review — spec coverage

- **§3.1 raw imports** → Task 1 Step 4 (`?raw` imports in preview.ts). ✅
- **§3.2 app resolution (title prefix, total, no overrides)** → Task 1 Step 2 (`appAreaFor`) + Step 1 (unit test incl. `settings/sections/admin/*` → settings, `shared/*` → null). ✅
- **§3.3 per-story injection (single `<style>`, synchronous via loader)** → Task 1 Step 4 (`applyAppGlobals` loader). ✅
- **§3.4 remove merged path** → Task 1 Step 5 (preview-head link) + Step 6 (cat). ✅
- **§4 unit test + smoke + full re-baseline + per-area spot-check** → Task 1 Step 1 (unit) + Task 2 Steps 2–4. ✅
- **Risks: `?raw` support / injection timing** → Task 2 Step 1 (boot = `?raw` smoke) + Step 2 (render smoke); loader runs before render. ✅

**Type/name consistency:** `appAreaFor` returns `AppArea | null`; `APP_CSS` keyed by the same area strings; `SHARED_CSS` = base+tokens; the loader reads `context.title`. The `?raw` ambient module makes tsc accept the CSS imports. No placeholders remain.
