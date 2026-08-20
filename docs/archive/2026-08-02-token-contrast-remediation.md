<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Token Contrast Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the design system's dim text tokens above the WCAG 4.5:1 contrast floor and add a test that keeps them there.

**Architecture:** Four value changes in `client/shared/tokens.css` fix all 110 call sites at once, because the defect is in the token values rather than at any call site. A new test parses the stylesheet, resolves `var()` aliases to hex, and asserts every text token against every surface token. The value change alters every screenshot containing dim text, so a visual audit and re-baseline follow.

**Tech Stack:** Bun test runner (`bun:test`), Playwright + `@crvy/strybk` for Storybook screenshots, CSS custom properties, `oxfmt` formatter.

**Spec:** [`docs/superpowers/specs/2026-08-02-token-contrast-remediation-design.md`](../specs/2026-08-02-token-contrast-remediation-design.md)

## Global Constraints

- The contrast floor is **4.5:1**, applied flat — no large-text (3:1) exemption anywhere in the gate.
- The new dim value is exactly `#828d84`. Do not substitute a different color.
- `--fg3`, `--fg4`, and `--fg-hint` become `var(--text-dim)` aliases. Do **not** delete these declarations — a separate cycle handles alias deletion, and `tests/client/shared/tokens.test.ts:49` asserts `--fg3:` and `--fg4:` are still present.
- Do **not** change any file outside `client/shared/tokens.css` and `tests/client/shared/token-contrast.test.ts`. In particular: no call-site edits, no `--fg3` → `--text-dim` sweep, no component API changes.
- `client/shared/ui/KV.svelte:21`'s `dim` prop becomes inert. This is expected and stays as-is.
- Never add lint-disable or type-ignore comments — the hook policy blocks them.
- Use `.js` extensions in TypeScript import paths.
- Storybook must be running (`bun storybook`) for any Playwright task.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `client/shared/tokens.css` (modify, lines 21 and 85–86) | The four token value changes. Single `:root` block, 87 lines, no theme variants — every value is declared exactly once. |
| `tests/client/shared/token-contrast.test.ts` (create) | WCAG 1.4.3 gate: parses tokens.css, resolves aliases, asserts 40 text×surface pairs. Sibling to `control-target-size.test.ts`, which is the local precedent for one-accessibility-criterion-per-file. |
| `tests/client/shared/tokens.test.ts` (unchanged) | Declaration-presence checks only. Its `--fg3:`/`--fg4:` assertions still pass after the retune because the declarations survive as aliases. Listed here so nobody "fixes" it. |
| `.storybook-shots/**` (regenerated, untracked) | Local Playwright baselines. Gitignored — never committed, so re-baselining produces no diff. |

---

## Task 1: Contrast gate and token retune

**Files:**

- Create: `tests/client/shared/token-contrast.test.ts`
- Modify: `client/shared/tokens.css:21`, `client/shared/tokens.css:85-86`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `--text-dim` resolves to `#828d84`; `--fg3`, `--fg4`, and `--fg-hint` all resolve to the same value through `var(--text-dim)`. Task 2 depends on those being the rendered colors.

- [ ] **Step 1: Confirm the starting baseline is clean**

The audit in Task 2 is only readable if the pre-change baselines all pass. Verify that first, before editing anything.

Run: `bunx playwright test`

Expected: `454 passed`. If `DebugApp` fails on a live uptime counter, that is a known false positive — discount it. Any *other* failure means the baseline is dirty; stop and report rather than proceeding, because a dirty baseline makes Task 2's pass/fail partition meaningless.

- [ ] **Step 2: Write the failing test**

Create `tests/client/shared/token-contrast.test.ts` with exactly this content:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * WCAG 2.1 AA SC 1.4.3 (Contrast, Minimum). Applied flat, with no large-text
 * exemption: every `--fg3`/`--fg4` call site in the codebase renders text at
 * 10–12px, so a 3:1 branch would be a loophole no real site could use.
 */
const MIN_RATIO = 4.5

const TOKENS = readFileSync(fileURLToPath(new URL('../../../client/shared/tokens.css', import.meta.url)), 'utf8')

/**
 * These two lists are the contract. CSS carries no semantics saying which
 * custom property is text and which is a background, so the test declares it.
 * Adding a text token means adding it here — that is the point.
 */
const TEXT = ['--text', '--text-muted', '--text-dim', '--fg', '--fg2', '--fg3', '--fg4', '--fg-hint']
const SURFACE = ['--bg', '--surface-1', '--surface-2', '--surface-hover', '--inset']

const DECL = /(--[\w-]+):\s*([^;]+);/gu

/** Every `--name: value` pair in the file, values untrimmed of `var()` wrappers. */
function declarations(): Map<string, string> {
  const out = new Map<string, string>()
  for (const [, name, value] of TOKENS.matchAll(DECL)) out.set(name!, value!.trim())
  return out
}

/** Follows `var(--x)` chains until a hex literal is reached. */
function resolve(name: string, decls: Map<string, string>): string {
  let value = decls.get(name)
  for (let hop = 0; hop < 10; hop++) {
    if (value === undefined) throw new Error(`token ${name} is not declared in tokens.css`)
    const alias = /^var\((--[\w-]+)\)$/u.exec(value)
    if (!alias) return value
    value = decls.get(alias[1]!)
  }
  throw new Error(`token ${name} did not resolve to a literal within 10 hops`)
}

/** sRGB channel linearization, per the WCAG relative-luminance definition. */
function channel(byte: number): number {
  const c = byte / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/iu.exec(hex)
  if (!m) throw new Error(`expected a 6-digit hex color, got ${hex}`)
  const digits = m[1]!
  const r = channel(Number.parseInt(digits.slice(0, 2), 16))
  const g = channel(Number.parseInt(digits.slice(2, 4), 16))
  const b = channel(Number.parseInt(digits.slice(4, 6), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function ratio(fg: string, bg: string): number {
  const a = luminance(fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

describe('token contrast (WCAG SC 1.4.3)', () => {
  const decls = declarations()

  for (const fg of TEXT) {
    for (const bg of SURFACE) {
      test(`${fg} on ${bg} clears ${MIN_RATIO}:1`, () => {
        expect(ratio(resolve(fg, decls), resolve(bg, decls))).toBeGreaterThanOrEqual(MIN_RATIO)
      })
    }
  }

  test('resolve() reports an undeclared token instead of silently passing', () => {
    expect(() => resolve('--not-a-token', decls)).toThrow('not declared in tokens.css')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/token-contrast.test.ts`

Expected: **15 failures out of 41 tests.** `--text-dim`, `--fg3`, and `--fg4` each fail on all five surfaces. The reported numbers should be `3.43`–`4.15` for the dim trio and `1.58`–`1.92` for `--fg4`. If the failure count or the ratios differ, the parser is wrong — fix the test before touching tokens.

- [ ] **Step 4: Apply the token retune**

In `client/shared/tokens.css`, change line 21 from:

```css
  --text-dim: #6b766e;
```

to:

```css
  --text-dim: #828d84; /* 4.70:1 on --surface-hover, 5.69:1 on --bg — WCAG SC 1.4.3 floor */
```

Then change lines 85–86 from:

```css
  --fg4: #3a4248;
  --fg-hint: #8b978c; /* instructional hint text — ≥4.5:1 on --surface-1/-2 (measures ~6:1) */
```

to:

```css
  --fg4: var(--text-dim); /* was #3a4248 at 1.58:1 — below even the 3:1 non-text floor */
  --fg-hint: var(--text-dim); /* redundant once --text-dim itself clears 4.5:1 */
```

Leave line 84 (`--fg3: var(--text-dim);`) alone — it already aliases correctly and inherits the new value.

- [ ] **Step 5: Run the contrast test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/token-contrast.test.ts`

Expected: `41 pass, 0 fail`.

- [ ] **Step 6: Run the full client suite**

Run: `bun run test:client`

Expected: all pass. `tests/client/shared/tokens.test.ts` must still pass untouched — its `--fg3:` and `--fg4:` presence assertions hold because the declarations survive as aliases. If it fails, a declaration was deleted; restore it.

- [ ] **Step 7: Format and commit**

```bash
bun run format
git add client/shared/tokens.css tests/client/shared/token-contrast.test.ts
git commit -m "fix(a11y): raise dim text tokens above the 4.5:1 contrast floor"
```

---

## Task 2: Visual audit and re-baseline

**Files:**

- Modify: none. This task changes no tracked file.
- Regenerate: `.storybook-shots/**` (gitignored, untracked)

**Interfaces:**

- Consumes: the retuned tokens from Task 1 — `--text-dim`, `--fg3`, `--fg4`, and `--fg-hint` all rendering as `#828d84`.
- Produces: a written audit finding (pass/fail partition, sampled diffs, hierarchy judgment) and refreshed local baselines. No code artifact.

Storybook must be running. Start it with `bun storybook` if it is not.

- [ ] **Step 1: Run the strict suite and capture the failure list**

Run: `bunx playwright test`

Expected: a **large** number of failures. That is the intended outcome — every screenshot containing dim text now differs from its baseline. Record which spec files failed and which passed; that partition is the audit.

- [ ] **Step 2: Verify the pass set is genuinely dim-text-free**

Pick three spec files that **passed** in Step 1. For each, find the component it screenshots and confirm it contains no `--fg3`, `--fg4`, `--fg-hint`, or `--text-dim` reference:

```bash
grep -n 'fg3\|fg4\|fg-hint\|text-dim' client/path/to/Component.svelte
```

Expected: no matches, for all three. A pass on a component that *does* use those tokens means the screenshot is not exercising the changed code — the same class of defect as the `CodingMcpSection` viewport leak, where a green result meant nothing. Stop and report if you find one.

- [ ] **Step 3: Read a sample of diff images across all four SPAs**

Playwright writes `*-diff.png` next to failures under `test-results/`. Read at least one diff from each of settings, admin, debug, and transcript. Debug matters most — it carries 12 of the 22 `--fg4` sites.

```bash
ls test-results/**/*-diff.png
```

Expected: every diff shows **color change only**. A color-only edit cannot move geometry, so any reflow, wrapping change, or shifted element means a token is being consumed somewhere it should not be. Stop and report if you see reflow.

- [ ] **Step 4: Judge whether the ramp still reads as hierarchy**

From the same sampled images, look at any view showing `--text-muted` next to `--text-dim` content. The gate proves 4.70:1; it cannot prove the dim tier still looks subordinate.

Expected: dim text is visibly lighter-weight than muted text. If the two now read as the same tier, **do not lower `--text-dim`** — that would reintroduce the failure. Report it instead; the remedy is lifting `--text-muted`, which is a design decision outside this plan.

- [ ] **Step 5: Re-baseline**

Run: `bun shoot`

Expected: snapshots rewritten. Note that `bun shoot` is `playwright test --update-snapshots`, and `--update-snapshots` consumes a positional argument — so `bun shoot <path>` silently misbehaves. Use `bun shoot -g <pattern>` if you need to narrow it.

- [ ] **Step 6: Confirm the strict suite is green again**

Run: `bunx playwright test`

Expected: `454 passed`, discounting the known `DebugApp` uptime-counter false positive.

- [ ] **Step 7: Run the full check gate**

Run: `bun run check:full`

Expected: `12/12 checks passed`.

- [ ] **Step 8: Record the audit**

There is nothing to commit — `.storybook-shots/` is gitignored and no tracked file changed in this task. Report the audit result: how many specs failed in Step 1, which three passes were verified dim-text-free in Step 2, which SPAs were sampled in Step 3, and the hierarchy judgment from Step 4.

---

## Notes for the implementer

**Why no call-site changes.** Every one of the 110 call sites correctly asks for "the dim text color." The color was illegible. Fixing this at call sites would leave the broken value in the token file for the next author. If you find yourself editing a `.svelte` file, you are outside the plan.

**Why the aliases stay.** `--fg3` and `--fg4` remain declared so the debug and admin SPAs keep resolving, and because `tests/client/shared/tokens.test.ts:49` asserts their presence. Deleting them is a separate, pixel-neutral cycle whose whole value is that it produces zero screenshot diffs — merging it here would make both changes unverifiable.

**Why `KV`'s `dim` prop is left broken.** After the retune, `dim ? var(--fg4) : var(--fg3)` picks the same color either way. Changing a component API inside a token change blurs the diff. It is recorded in the spec as follow-up.
