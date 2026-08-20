<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Control Target Size Floor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise every bare interactive control in the shared UI kit to the WCAG 2.2 AA SC 2.5.8 floor of 24 CSS px, sourced from a new control-height token scale, and add a test that keeps it there.

**Architecture:** Three new `--control-h-{sm,md,lg}` tokens in `client/shared/tokens.css` become the single source of control height. Four primitives (`Btn`, `SegmentedControl`, `IconButton`, `Seg`) stop hardcoding pixel heights and read the tokens instead; only the `sm` step changes value (22px → 24px), plus `Seg` gains a `min-height` it never had. A new Bun test enforces both the numeric floor and the no-hardcoded-height discipline, with a closed-world ratchet over `client/shared/ui/*.svelte` so a future primitive cannot silently reintroduce the problem.

**Tech Stack:** Bun test runner (`bun:test`), Svelte 5 single-file components, plain CSS custom properties, Playwright + Storybook for visual verification (`bun shoot`).

**Spec:** [`docs/superpowers/specs/2026-07-31-control-target-size-design.md`](../specs/2026-07-31-control-target-size-design.md)

## Global Constraints

- The floor is **24px** — WCAG 2.2 AA SC 2.5.8 (Target Size, Minimum). Not 44px (that is SC 2.5.5, AAA).
- Every new file starts with the repo SPDX header. For `.ts` files that is four `//` comment lines; copy the exact block from `tests/no-demo-mode.test.ts:1-4`. `bun run license:headers` checks this.
- The formatter is **oxfmt** (`bun run format`), not prettier. Run it before committing.
- **Never add lint-disable or type-ignore comments** — a hook blocks them. Fix the underlying issue.
- Test runner is `bun:test`. No Jest, no Vitest.
- **Tests under `tests/client/` need the browser-conditions invocation** — a plain `bun test <path>` does not match this repo's client-test discovery config. Run a single client test file with:
  ```bash
  bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' <path>
  ```
  (`bun test:client` is the same invocation over the whole `tests/client/` directory.)
- Screenshot baselines under `.storybook-shots/**` are **gitignored and always regenerated** with `--update-snapshots`. They are an agent visual-feedback loop, not a committed regression gate — never `git add` them.
- Only `sm`-sized controls change rendered size. `md` and `lg` are refactors at identical values and must produce no visual difference.

---

### Task 1: Control-height token scale

Adds the three tokens. No component reads them yet, so nothing renders differently.

**Files:**

- Modify: `client/shared/tokens.css:38-51` (the `/* ---- layout & sizing ---- */` block)
- Test: `tests/client/shared/tokens.test.ts:28-44` (the existing "defines layout + sizing tokens" test)

**Interfaces:**

- Consumes: nothing.
- Produces: CSS custom properties `--control-h-sm` (`24px`), `--control-h-md` (`28px`), `--control-h-lg` (`34px`), defined on `:root` in `client/shared/tokens.css`. Tasks 2 and 3 depend on these exact names.

- [ ] **Step 1: Extend the existing token test to require the new names**

In `tests/client/shared/tokens.test.ts`, add three entries to the end of the array in the `defines layout + sizing tokens` test, after `'--row-h'`:

```ts
  test('defines layout + sizing tokens', () => {
    for (const t of [
      '--content-max',
      '--table-max',
      '--gap-group',
      '--gap-section',
      '--gap-field',
      '--gap-inline',
      '--gap-tight',
      '--radius',
      '--radius-control',
      '--radius-pill',
      '--row-h',
      '--control-h-sm',
      '--control-h-md',
      '--control-h-lg',
    ]) {
      expect(css).toContain(`${t}:`)
    }
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/tokens.test.ts`

Expected: FAIL on `defines layout + sizing tokens` — `expect(received).toContain("--control-h-sm:")`, because `tokens.css` has no such declaration.

- [ ] **Step 3: Add the tokens**

In `client/shared/tokens.css`, inside `:root`, add the three declarations immediately after `--row-h: 44px;` (the last line of the layout & sizing block):

```css
  --row-h: 44px;
  --control-h-sm: 24px; /* WCAG 2.2 AA SC 2.5.8 target-size floor */
  --control-h-md: 28px;
  --control-h-lg: 34px;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/tokens.test.ts`

Expected: PASS — 4 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
bun run format
git add client/shared/tokens.css tests/client/shared/tokens.test.ts
git commit -m "feat(tokens): add --control-h-{sm,md,lg} control-height scale"
```

---

### Task 2: Primitives read the token scale

This is the task that changes pixels: every `size="sm"` button and every segmented control grows 2px, and `Seg` buttons gain a 24px floor they never had.

**Files:**

- Create: `tests/client/shared/control-target-size.test.ts`
- Modify: `client/shared/ui/Btn.svelte:105-119`
- Modify: `client/shared/ui/SegmentedControl.svelte:56-66`
- Modify: `client/shared/ui/IconButton.svelte:29-35`
- Modify: `client/shared/ui/Seg.svelte:35-44`

**Interfaces:**

- Consumes: `--control-h-sm` / `--control-h-md` / `--control-h-lg` from Task 1.
- Produces: `tests/client/shared/control-target-size.test.ts` exporting nothing, but defining module-level constants that Task 3 extends — `UI_DIR` (absolute path string ending in `/`), `HEIGHT_PX` (global `RegExp`), `INTERACTIVE` (`string[]` of `.svelte` filenames), `readUi(file: string): string`, and `literalHeights(css: string): string[]`.

- [ ] **Step 1: Write the failing guard test**

Create `tests/client/shared/control-target-size.test.ts` with exactly this content:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** WCAG 2.2 AA SC 2.5.8 (Target Size, Minimum). */
const MIN_TARGET_PX = 24

const UI_DIR = fileURLToPath(new URL('../../../client/shared/ui/', import.meta.url))
const TOKENS = readFileSync(fileURLToPath(new URL('../../../client/shared/tokens.css', import.meta.url)), 'utf8')

/**
 * Matches a literal pixel height declaration. The lookbehind keeps `line-height`
 * and `max-height` out: neither constrains how small a target can render.
 */
const HEIGHT_PX = /(?<![\w-])(?:min-height|height):\s*(\d+(?:\.\d+)?)px/gu

const CONTROL_TOKEN = /--control-h-([a-z]+):\s*(\d+(?:\.\d+)?)px/gu

/** Primitives whose whole box is the click target — their height must come from the scale. */
const INTERACTIVE = ['Btn.svelte', 'IconButton.svelte', 'Seg.svelte', 'SegmentedControl.svelte']

const readUi = (file: string): string => readFileSync(`${UI_DIR}${file}`, 'utf8')

const literalHeights = (css: string): string[] => [...css.matchAll(HEIGHT_PX)].map((m) => m[0])

describe('control target size', () => {
  test('the height scanner sees real declarations and ignores look-alikes', () => {
    expect(literalHeights('.a { height: 22px; }')).toEqual(['height: 22px'])
    expect(literalHeights('.a {\n  min-height: 120px;\n}')).toEqual(['min-height: 120px'])
    expect(literalHeights('.a { line-height: 22px; max-height: 40px; }')).toEqual([])
    expect(literalHeights('.a { height: var(--control-h-sm); }')).toEqual([])
  })

  test('every --control-h-* token clears the WCAG minimum', () => {
    const found = [...TOKENS.matchAll(CONTROL_TOKEN)].map((m) => ({ name: m[1], px: Number(m[2]) }))
    expect(found.map((t) => t.name)).toEqual(['sm', 'md', 'lg'])
    for (const token of found) {
      expect(token.px).toBeGreaterThanOrEqual(MIN_TARGET_PX)
    }
  })

  test('interactive primitives take their height from the control-height scale', () => {
    for (const file of INTERACTIVE) {
      const css = readUi(file)
      expect({ file, literals: literalHeights(css) }).toEqual({ file, literals: [] })
      expect({ file, usesScale: css.includes('var(--control-h-') }).toEqual({ file, usesScale: true })
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/control-target-size.test.ts`

Expected: FAIL — 2 pass, 1 fail. The scanner and token tests pass (Task 1 added the tokens); `interactive primitives take their height from the control-height scale` fails on the first offender, `Btn.svelte`, reporting `literals: ["height: 22px"]` against the expected `[]`.

- [ ] **Step 3: Point `Btn` at the scale**

In `client/shared/ui/Btn.svelte`, replace the three size rules:

```css
  .ui-btn--sm {
    padding: 3px 8px;
    font-size: 11px;
    height: var(--control-h-sm);
  }
  .ui-btn--md {
    padding: 5px 12px;
    font-size: 12px;
    height: var(--control-h-md);
  }
  .ui-btn--lg {
    padding: 8px 16px;
    font-size: 13px;
    height: var(--control-h-lg);
  }
```

The padding stays as-is: `client/shared/base.css:5-9` sets `box-sizing: border-box` universally, so `height` is the full box and the vertical padding is inert under the component's `inline-flex` centering.

- [ ] **Step 4: Point `SegmentedControl` at the scale**

In `client/shared/ui/SegmentedControl.svelte`, in the `.ui-seg__opt` rule, replace `height: 22px;` with:

```css
    height: var(--control-h-sm);
```

- [ ] **Step 5: Point `IconButton` at the scale**

In `client/shared/ui/IconButton.svelte`, in the `.ui-iconbtn` rule, replace the `width: 28px;` / `height: 28px;` pair with:

```css
    width: var(--control-h-md);
    height: var(--control-h-md);
```

It is square and already at 28px, so this is a rename with no visual change.

- [ ] **Step 6: Give `Seg` a floor**

`client/shared/ui/Seg.svelte` declares no height at all — `.ui-seg__btn` is `font-size: 11px` plus `padding: 4px 10px`, which computes to roughly 21–22px. A text scan cannot detect that, so it is fixed explicitly. Add one line to the `.ui-seg__btn` rule, after `padding`:

```css
  .ui-seg__btn {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    padding: 4px 10px;
    min-height: var(--control-h-sm);
    color: var(--fg3);
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
  }
```

A native `<button>` centers its content vertically, so no flex properties are needed.

- [ ] **Step 7: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/control-target-size.test.ts`

Expected: PASS — 3 pass, 0 fail.

- [ ] **Step 8: Prove the guard actually guards**

Temporarily lower the floor and confirm the test catches it:

```bash
sed -i '' 's/--control-h-sm: 24px/--control-h-sm: 22px/' client/shared/tokens.css
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/control-target-size.test.ts
```

Expected: FAIL on `every --control-h-* token clears the WCAG minimum` — `expect(22).toBeGreaterThanOrEqual(24)`.

Restore it:

```bash
sed -i '' 's/--control-h-sm: 22px/--control-h-sm: 24px/' client/shared/tokens.css
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/control-target-size.test.ts
```

Expected: PASS — 3 pass, 0 fail.

- [ ] **Step 9: Commit**

```bash
bun run format
git add tests/client/shared/control-target-size.test.ts client/shared/ui/Btn.svelte client/shared/ui/SegmentedControl.svelte client/shared/ui/IconButton.svelte client/shared/ui/Seg.svelte
git commit -m "fix(ui): raise sm controls to the 24px WCAG target-size floor"
```

---

### Task 3: Closed-world ratchet

Without this, the guard only polices the four files someone remembered to list. With it, any *new* primitive in `client/shared/ui/` that hardcodes a height fails the suite until it is either tokenized or consciously exempted with a written reason.

**Files:**

- Modify: `tests/client/shared/control-target-size.test.ts` (append one constant and one test)

**Interfaces:**

- Consumes: `UI_DIR`, `INTERACTIVE`, `readUi`, `literalHeights` from Task 2.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Write the failing ratchet test with an empty exemption map**

In `tests/client/shared/control-target-size.test.ts`, add `Glob` to the imports:

```ts
import { Glob } from 'bun'
```

Add this constant below `INTERACTIVE`:

```ts
/**
 * Files allowed to hardcode a px height because the value is not a click target.
 * Adding an entry is a deliberate act and must carry a reason.
 */
const EXEMPT: Record<string, string> = {}
```

And add this test inside the existing `describe('control target size', ...)` block, after the last test:

```ts
  test('no shared primitive hardcodes a height outside the interactive set or the exemption list', async () => {
    const glob = new Glob('*.svelte')
    const offenders: string[] = []
    for await (const file of glob.scan({ cwd: UI_DIR })) {
      if (file.endsWith('.stories.svelte')) continue
      if (INTERACTIVE.includes(file)) continue
      if (literalHeights(readUi(file)).length > 0) offenders.push(file)
    }
    expect(offenders.sort()).toEqual(Object.keys(EXEMPT).sort())
  })
```

Exact equality, not a subset check: it fails on an unknown offender *and* on an exemption that has gone stale.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/control-target-size.test.ts`

Expected: FAIL on the new test — received `["Checkbox.svelte", "EmptyState.svelte", "ErrorState.svelte", "Meter.svelte"]`, expected `[]`.

- [ ] **Step 3: Record the four exemptions with reasons**

Replace the empty `EXEMPT` map with:

```ts
/**
 * Files allowed to hardcode a px height because the value is not a click target.
 * Adding an entry is a deliberate act and must carry a reason.
 */
const EXEMPT: Record<string, string> = {
  'Checkbox.svelte': '16px box sits inside a clickable <label>, which is the actual target',
  'EmptyState.svelte': 'min-height on a layout container, not a target',
  'ErrorState.svelte': 'min-height on a layout container, not a target',
  'Meter.svelte': '5px progress bar, non-interactive',
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/control-target-size.test.ts`

Expected: PASS — 4 pass, 0 fail.

- [ ] **Step 5: Prove the ratchet catches a new offender**

```bash
printf '\n<style>\n  .probe { height: 20px; }\n</style>\n' >> client/shared/ui/Dot.svelte
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/control-target-size.test.ts
```

Expected: FAIL — received includes `"Dot.svelte"`, which is in neither `INTERACTIVE` nor `EXEMPT`.

Revert the probe and re-run:

```bash
git checkout client/shared/ui/Dot.svelte
bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/control-target-size.test.ts
```

Expected: PASS — 4 pass, 0 fail. Confirm `git status --short client/shared/ui/Dot.svelte` prints nothing.

- [ ] **Step 6: Commit**

```bash
bun run format
git add tests/client/shared/control-target-size.test.ts
git commit -m "test(ui): ratchet hardcoded heights in the shared primitive set"
```

---

### Task 4: Visual verification sweep

The text guard enforces token discipline, not computed geometry. This task is the geometry check: confirm the only rendered change is 2–3px of control growth, and that nothing wraps, clips, or gains a scrollbar where a control sits in a constrained container.

**Files:**

- Modify: none (verification only, unless a regression is found)

**Interfaces:**

- Consumes: all of Tasks 1–3.
- Produces: nothing.

- [ ] **Step 1: Restart Storybook so it picks up the new tokens**

`bun storybook` concatenates `client/shared/tokens.css` into `public/storybook-*.css` at startup (`package.json:19-20`), and `playwright.config.ts:30` reuses an already-running server. A warm Storybook is therefore serving the **old** tokens and must be restarted:

```bash
lsof -ti tcp:6006 | xargs kill 2>/dev/null; bun storybook
```

Leave it running. Wait for `Storybook ... started`, then confirm the token reached the served CSS:

```bash
curl -s http://localhost:6006/storybook-shared.css | grep control-h
```

Expected: three lines, starting with `--control-h-sm: 24px;`.

- [ ] **Step 2: Shoot the full sweep**

In a second shell:

```bash
bun shoot
```

Expected: all specs under `tests/visual/` pass and rewrite their PNGs under `.storybook-shots/`. This is a full sweep over 103 spec files and takes several minutes. Baselines are gitignored — never stage them.

- [ ] **Step 3: Read the primitive shots and confirm the intended change**

Read these PNGs with the Read tool:

- `.storybook-shots/tests/visual/shared/ui/Btn.spec.ts/*.png`
- `.storybook-shots/tests/visual/shared/ui/Seg.spec.ts/*.png`

Expected: `sm` buttons and `Seg` buttons are visibly taller; `md` and `lg` buttons are unchanged. If a `size` comparison story exists, `sm` and `md` should still read as distinct steps.

`IconButton` and `SegmentedControl` have no `.stories.svelte`, so they have no spec of their own. Verify them through consumers instead:

- `IconButton` — `.storybook-shots/tests/visual/settings/**/*.png` section headers (it is unchanged at 28px; you are confirming *no* difference).
- `SegmentedControl` — `.storybook-shots/tests/visual/settings/sections/ToolsSection.spec.ts/*.png`. `ToolsSection` is its only consumer with a visual spec; `AnalyticsPreferencesSection` and `ConfigFieldRow` also use it but have no story, so they are out of screenshot reach.

- [ ] **Step 4: Check the constrained containers for knock-on layout damage**

+2px inside a fixed-height bar is where this change can actually break something. Read the PNGs for:

- `.storybook-shots/tests/visual/shared/ui/Toolbar.spec.ts/*.png`
- `.storybook-shots/tests/visual/shared/ui/TopBar.spec.ts/*.png`
- `.storybook-shots/tests/visual/shared/ui/DataTable.spec.ts/*.png`
- `.storybook-shots/tests/visual/settings/sections/CodeHostSection.spec.ts/*.png` — including the two `narrow` states, which are the tightest horizontal case in the review set

Looking for: controls clipped by a parent with a fixed height; a row that now wraps to two lines; a new scrollbar; vertical centering thrown off inside a bar. Anything found here is a real regression — fix it (most likely by relaxing a hardcoded parent height in that component) and re-shoot before continuing.

- [ ] **Step 5: Run the full check suite**

```bash
bun run check
```

Expected: `4/4 checks passed, 0 failed` (lint, typecheck, format:check, license-headers).

Then the test suite:

```bash
bun test:client
```

Expected: PASS — both `tokens.test.ts` and `control-target-size.test.ts` green.

- [ ] **Step 6: Commit any fixes from Step 4**

If Step 4 found nothing, there is nothing to commit and this task ends here — say so explicitly rather than committing an empty change. If it did:

```bash
bun run format
git add <the files you changed>
git commit -m "fix(ui): <what the +2px broke and how it was resolved>"
```

---

## Notes for the implementer

- **Do not stage `.storybook-shots/`.** It is gitignored on purpose; the PNGs are a feedback loop, not an artifact.
- **The mutation ratchet and coverage floor do not apply here.** Both scope to `src/` + `plugins/` production code; this change touches only `client/` and `tests/`.
- **If `bun shoot` fails to connect**, Storybook is not up on 6006. Playwright will try to start it itself, but with `reuseExistingServer: true` it may attach to a stale instance — re-do Task 4 Step 1.
