# Dashboard Redesign — PR 1: Tokens + Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the "Telemetry" design tokens as CSS custom properties and a new `client/shared/ui/` primitive library (14 Svelte 5 components), then migrate existing CSS files and shared Svelte primitives onto the tokens. No layout or routing changes.

**Architecture:** Tokens ship as a single `tokens.css` declaring CSS custom properties on `:root`, prepended to the existing CSS bundle pipeline. All hex colors in `base.css` / `admin.css` / `debug.css` migrate to `var(--…)`. New primitives are slot-driven Svelte 5 components in `client/shared/ui/`, each with a happy-dom smoke test that mirrors the existing `tests/client/shared/Modal.test.ts` pattern. Existing primitives (`Modal`, `Confirm`, `PanelShell`, `PropertiesTable`, `StatusDot`, `TreeView`) keep their APIs; only their CSS migrates.

**Tech Stack:** Svelte 5 (runes + snippets), Bun test runner (`bun:test`), happy-dom (`tests/client-setup.ts`), CSS custom properties on `:root`. No new runtime dependencies.

**Reference spec:** `docs/superpowers/specs/2026-05-22-dashboard-redesign-design.md` sections 5 and 6.

---

## File Structure

**Create:**
- `client/shared/tokens.css` — single `:root { … }` block declaring all design tokens
- `client/shared/ui/Dot.svelte` — 6px round status dot
- `client/shared/ui/HR.svelte` — hairline rule
- `client/shared/ui/Caption.svelte` — caps caption (10–11px, fg3)
- `client/shared/ui/KV.svelte` — key/value row
- `client/shared/ui/Pill.svelte` — status pill with optional dot
- `client/shared/ui/Btn.svelte` — button with 5 variants × 3 sizes
- `client/shared/ui/Input.svelte` — text input with prefix slot
- `client/shared/ui/Select.svelte` — display-only chevron with native `<select>` for a11y
- `client/shared/ui/Seg.svelte` — segmented buttons
- `client/shared/ui/Panel.svelte` — panel with caps title, count, action slot
- `client/shared/ui/Spark.svelte` — SVG sparkline
- `client/shared/ui/Bars.svelte` — SVG bar chart
- `client/shared/ui/Shell.svelte` — page shell wrapper
- `client/shared/ui/TopBar.svelte` — top bar with brand + status + secondary rows
- `tests/client/shared/ui/Dot.test.ts` through `TopBar.test.ts` — one per primitive

**Modify:**
- `scripts/build-client.ts` — prepend `tokens.css` to the CSS bundle (single edit)
- `client/shared/base.css` — replace hex with `var(--…)`; tighten modal border radius to 2px; remove drop shadows
- `client/admin/admin.css` — replace hex with `var(--…)`; remove rounded radii (6–8px → 0/2px); remove gradient-style hover backgrounds
- `client/debug/debug.css` — replace hex with `var(--…)` (largest file at 1149 lines; one find-replace per unique color)
- `client/shared/Modal.svelte` — no structural change; CSS only
- `client/shared/Confirm.svelte` — no structural change; CSS only
- `client/shared/PanelShell.svelte` — no structural change; CSS only
- `client/shared/PropertiesTable.svelte` — no structural change; CSS only
- `client/shared/StatusDot.svelte` — no structural change; CSS only
- `client/shared/TreeView.svelte` — no structural change; CSS only

**Tests stay green:** `tests/client/shared/Modal.test.ts`, `tests/client/shared/Confirm.test.ts`, `tests/client/admin/AdminApp.test.ts`, `tests/client/admin/StatsPanel.test.ts`. None of these inspect colors — they inspect classes, text content, and event behavior.

---

## Task 1: Add `tokens.css` and wire it into the CSS bundle

**Files:**
- Create: `client/shared/tokens.css`
- Modify: `scripts/build-client.ts`

- [ ] **Step 1: Create `client/shared/tokens.css`**

```css
/* SPDX-License-Identifier: BUSL-1.1 */
/* Copyright (c) 2026 Dmitriy Lazarev */
/* Use of this software is governed by the Business Source License 1.1. */
/* See LICENSE in the project root for details. */

:root {
  /* canvas, surfaces */
  --bg: #0b0e10;
  --surface: #14181b;
  --raised: #1a1f23;
  --inset: #0e1214;

  /* borders */
  --hair: #1f262a;
  --border: #2a3338;
  --strong: #3a464d;

  /* foreground */
  --fg: #e6ebee;
  --fg2: #9aa5ac;
  --fg3: #5e6970;
  --fg4: #3a4248;

  /* accent + semantic */
  --accent: #5dd97a;
  --accent-soft: rgba(93, 217, 122, 0.10);
  --accent-dim: rgba(93, 217, 122, 0.55);
  --warn: #e5a93a;
  --warn-soft: rgba(229, 169, 58, 0.10);
  --danger: #e85c5c;
  --danger-soft: rgba(232, 92, 92, 0.10);
  --info: #6cb6ff;
  --info-soft: rgba(108, 182, 255, 0.10);

  /* type */
  --font-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', ui-monospace, Menlo, monospace;

  /* spacing scale (4px base) */
  --s1: 4px;
  --s2: 8px;
  --s3: 12px;
  --s4: 16px;
  --s5: 20px;
  --s6: 24px;
  --s7: 32px;
  --s8: 40px;
  --s9: 48px;
}
```

- [ ] **Step 2: Wire `tokens.css` into the CSS bundle**

Open `scripts/build-client.ts` and find the bundle assembly block. It currently reads `baseCssPath` and `localCssPath` and joins them. Add a new `tokensCssPath` shared by both entrypoints, read it, and prepend it to the parts array.

Current code (around the per-entrypoint config and the `cssParts` assembly):

```ts
const cssParts = []
if (baseCss) cssParts.push(baseCss)
if (localCss) cssParts.push(localCss)
```

Change to:

```ts
const tokensCss = fs.readFileSync(path.join(ROOT, 'client/shared/tokens.css'), 'utf8')
const cssParts = [tokensCss]
if (baseCss) cssParts.push(baseCss)
if (localCss) cssParts.push(localCss)
```

(Read the file once before the loop, or once inside the loop — both fine. The above shows the inline read for clarity.)

- [ ] **Step 3: Run the build and confirm both CSS bundles contain `:root`**

Run: `bun build:client`
Expected: completes without error, writes `public/debug.css` and `public/admin.css`.

Verify:

```bash
grep -c '^:root {' public/debug.css public/admin.css
```

Expected: each file reports `1`.

- [ ] **Step 4: Run the client test suite to confirm nothing regressed**

Run: `bun test:client`
Expected: all existing tests pass. Tokens land before any consumer uses them, so behavior is unchanged.

- [ ] **Step 5: Commit**

```bash
git add client/shared/tokens.css scripts/build-client.ts
git commit -m "$(cat <<'EOF'
feat(client): add Telemetry design tokens

Tokens live in client/shared/tokens.css and are prepended to both
debug.css and admin.css bundles by build-client. No consumer
references them yet; subsequent commits migrate existing CSS and
add primitives that read from these variables.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Migrate `client/shared/base.css` to tokens

**Files:**
- Modify: `client/shared/base.css`

Every hex color in `base.css` maps as follows. Apply each replacement.

| Old hex | New value |
|---|---|
| `#0a0a0a` (body bg) | `var(--bg)` |
| `#cccccc` (body fg) | `var(--fg)` |
| `#111111` (panel bg) | `var(--surface)` |
| `#222222` (panel border) | `var(--border)` |
| `#666666` (panel h2) | `var(--fg3)` |
| `#555555` (count-badge) | `var(--fg3)` |
| `#1a1a1a` (modal-content bg) | `var(--raised)` |
| `#333333` (modal borders) | `var(--border)` |
| `#1f1f1f` (modal-footer button bg) | `var(--raised)` |
| `#3a3a3a` (modal-footer button border) | `var(--border)` |

- [ ] **Step 1: Open the file and edit**

Open `client/shared/base.css`. Replace each hex occurrence using the table above. Also:
- `border-radius: 4px` on `.modal-content` and `.modal-footer button` → `border-radius: 2px`
- `font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace` → `font-family: var(--font-mono)`

Leave `.modal-close:hover { color: #cccccc }` and `.modal-footer button:hover { border-color: #555555 }` migrated to `var(--fg)` and `var(--fg3)` respectively.

- [ ] **Step 2: Verify no hex remains in `base.css`**

Run: `grep -nE '#[0-9a-fA-F]{3,8}' client/shared/base.css`
Expected: no output (zero hex codes left).

- [ ] **Step 3: Rebuild and run client tests**

Run: `bun build:client && bun test:client`
Expected: build succeeds; all client tests pass.

- [ ] **Step 4: Commit**

```bash
git add client/shared/base.css
git commit -m "$(cat <<'EOF'
refactor(client): migrate base.css to design tokens

Replace hardcoded hex values with var(--bg)/var(--surface)/var(--fg)
etc. Tighten modal border-radius from 4px to 2px per the Telemetry
aesthetic (radius 0 by default, 2-4px on interactive only).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Migrate `client/admin/admin.css` to tokens

**Files:**
- Modify: `client/admin/admin.css`

| Old hex | New value |
|---|---|
| `#0b0d10` (admin-shell bg, input bg) | `var(--bg)` |
| `#11151b` (topbar bg, panel bg) | `var(--surface)` |
| `#0f1318` (sidebar bg) | `var(--surface)` |
| `#20252d` (borders) | `var(--border)` |
| `#2b3543` (focus/hover borders) | `var(--strong)` |
| `#18202a` (link hover bg) | `var(--raised)` |
| `#f2f5f8` (heading fg) | `var(--fg)` |
| `#ffffff` (active link fg) | `var(--fg)` |
| `#d9e0e7` (section fg) | `var(--fg)` |
| `#aab3c0` (sidebar link fg, label fg) | `var(--fg2)` |
| `#778292` (eyebrow) | `var(--fg3)` |
| `#ff8f8f` (status-error fg) | `var(--danger)` |

Border radii change too. Apply these specific edits in addition to the hex replacements:

| Old | New |
|---|---|
| `border-radius: 8px` on `.panel` | `border-radius: 0` |
| `border-radius: 6px` on inputs/selects/buttons in `.admin-filter-form` and `.admin-section-header button` | `border-radius: 2px` |
| `border-radius: 6px` on `.admin-key-value-list div` | `border-radius: 0` |
| `border-radius: 4px` on sidebar `<a>` | `border-radius: 2px` |

- [ ] **Step 1: Apply replacements in `client/admin/admin.css`**

Replace each hex per the table. Update border-radii per the second table. Leave layout (`display: grid`, `grid-template-columns`, paddings) untouched.

- [ ] **Step 2: Verify no hex remains**

Run: `grep -nE '#[0-9a-fA-F]{3,8}' client/admin/admin.css`
Expected: no output.

- [ ] **Step 3: Rebuild and run admin tests**

Run: `bun build:client && bun test:client -t admin`
Expected: all admin client tests pass.

- [ ] **Step 4: Commit**

```bash
git add client/admin/admin.css
git commit -m "$(cat <<'EOF'
refactor(admin): migrate admin.css to design tokens

Replace hex with var(--…), drop panel border-radius from 8px to 0,
drop input/button radius from 6px to 2px. Layout grid and paddings
unchanged; structural redesign lands in PR 3.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Migrate `client/debug/debug.css` to tokens

**Files:**
- Modify: `client/debug/debug.css`

This file is 1149 lines and has the broadest palette. Apply these replacements globally across the file.

| Old hex | New value |
|---|---|
| `#111111` | `var(--surface)` |
| `#131313` | `var(--surface)` |
| `#181818` | `var(--raised)` |
| `#1a1a1a` | `var(--raised)` |
| `#222222` | `var(--border)` |
| `#333333` | `var(--border)` |
| `#cccccc` | `var(--fg)` |
| `#888888` | `var(--fg2)` |
| `#666666` | `var(--fg3)` |
| `#555555` | `var(--fg4)` |
| `#00ff88` | `var(--accent)` |
| `#0088ff` | `var(--info)` |
| `#0088ff22` | `var(--info-soft)` |
| `#ffaa00` | `var(--warn)` |
| `#ff4444` | `var(--danger)` |
| `#ff6666` | `var(--danger)` |

- [ ] **Step 1: Apply replacements**

Open `client/debug/debug.css` and apply each replacement above. Recommended approach: one find-replace pass per row, in the order shown (longest hex first to avoid prefix collisions — `#0088ff22` must come before `#0088ff`).

- [ ] **Step 2: Verify no hex remains**

Run: `grep -nE '#[0-9a-fA-F]{3,8}' client/debug/debug.css`
Expected: no output.

- [ ] **Step 3: Rebuild and run debug tests**

Run: `bun build:client && bun test:client`
Expected: all client tests pass. Debug tests do not inspect colors.

- [ ] **Step 4: Commit**

```bash
git add client/debug/debug.css
git commit -m "$(cat <<'EOF'
refactor(debug): migrate debug.css to design tokens

Largest of the three CSS migrations: 16 distinct hex values mapped
to var(--…). Layout untouched; the 3-column shell lands in PR 2.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Build `Dot` primitive (TDD)

**Files:**
- Create: `client/shared/ui/Dot.svelte`
- Test: `tests/client/shared/ui/Dot.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/client/shared/ui/Dot.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import Dot from '../../../../client/shared/ui/Dot.svelte'

function render(props: Record<string, unknown>): { target: HTMLElement; component: ReturnType<typeof mount> } {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const component = mount(Dot, { target, props })
  return { target, component }
}

describe('Dot.svelte', () => {
  test('renders a 6x6 span by default with accent color', () => {
    const { target, component } = render({})
    const dot = target.querySelector('.ui-dot') as HTMLElement | null
    expect(dot).not.toBeNull()
    expect(dot!.style.width).toBe('6px')
    expect(dot!.style.height).toBe('6px')
    expect(dot!.style.background).toContain('var(--accent)')
    void unmount(component)
  })

  test('uses the provided color and size', () => {
    const { target, component } = render({ color: 'var(--danger)', size: 10 })
    const dot = target.querySelector('.ui-dot') as HTMLElement
    expect(dot.style.width).toBe('10px')
    expect(dot.style.background).toContain('var(--danger)')
    void unmount(component)
  })

  test('omits glow when glow=false', () => {
    const { target, component } = render({ glow: false })
    const dot = target.querySelector('.ui-dot') as HTMLElement
    expect(dot.style.boxShadow).toBe('none')
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test:client tests/client/shared/ui/Dot.test.ts`
Expected: FAIL with "Cannot find module '.../Dot.svelte'".

- [ ] **Step 3: Implement `client/shared/ui/Dot.svelte`**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  interface Props {
    color?: string
    size?: number
    glow?: boolean
  }

  let { color = 'var(--accent)', size = 6, glow = true }: Props = $props()
</script>

<span
  class="ui-dot"
  style:width="{size}px"
  style:height="{size}px"
  style:background={color}
  style:box-shadow={glow ? `0 0 6px ${color}` : 'none'}
></span>

<style>
  .ui-dot {
    display: inline-block;
    border-radius: 999px;
    flex-shrink: 0;
  }
</style>
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `bun test:client tests/client/shared/ui/Dot.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add client/shared/ui/Dot.svelte tests/client/shared/ui/Dot.test.ts
git commit -m "feat(ui): add Dot primitive

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Build `HR` primitive (TDD)

**Files:**
- Create: `client/shared/ui/HR.svelte`
- Test: `tests/client/shared/ui/HR.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/client/shared/ui/HR.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import HR from '../../../../client/shared/ui/HR.svelte'

function render(props: Record<string, unknown>): { target: HTMLElement; component: ReturnType<typeof mount> } {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const component = mount(HR, { target, props })
  return { target, component }
}

describe('HR.svelte', () => {
  test('renders a solid hairline by default', () => {
    const { target, component } = render({})
    const hr = target.querySelector('.ui-hr') as HTMLElement
    expect(hr).not.toBeNull()
    expect(hr.style.borderTop).toContain('solid')
    void unmount(component)
  })

  test('uses dashed style when dashed=true', () => {
    const { target, component } = render({ dashed: true })
    const hr = target.querySelector('.ui-hr') as HTMLElement
    expect(hr.style.borderTop).toContain('dashed')
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test:client tests/client/shared/ui/HR.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `client/shared/ui/HR.svelte`**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  interface Props {
    dashed?: boolean
  }

  let { dashed = false }: Props = $props()
</script>

<div class="ui-hr" style:border-top="1px {dashed ? 'dashed' : 'solid'} var(--hair)"></div>

<style>
  .ui-hr {
    width: 100%;
  }
</style>
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `bun test:client tests/client/shared/ui/HR.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/shared/ui/HR.svelte tests/client/shared/ui/HR.test.ts
git commit -m "feat(ui): add HR primitive

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Build `Caption` primitive (TDD)

**Files:**
- Create: `client/shared/ui/Caption.svelte`
- Test: `tests/client/shared/ui/Caption.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createRawSnippet, mount, unmount } from 'svelte'
import type { Snippet } from 'svelte'

import Caption from '../../../../client/shared/ui/Caption.svelte'

function textSnippet(text: string): Snippet {
  return createRawSnippet(() => ({ render: () => `<span>${text}</span>` }))
}

describe('Caption.svelte', () => {
  test('renders the snippet content uppercase with letter-spacing', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Caption, {
      target,
      props: { children: textSnippet('overview') },
    })
    const el = target.querySelector('.ui-caption') as HTMLElement
    expect(el.textContent).toContain('overview')
    expect(el.style.textTransform).toBe('uppercase')
    expect(el.style.letterSpacing).toBe('0.1em')
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test:client tests/client/shared/ui/Caption.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `client/shared/ui/Caption.svelte`**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    children: Snippet
  }

  let { children }: Props = $props()
</script>

<div
  class="ui-caption"
  style:text-transform="uppercase"
  style:letter-spacing="0.1em"
>
  {@render children()}
</div>

<style>
  .ui-caption {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    color: var(--fg3);
  }
</style>
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `bun test:client tests/client/shared/ui/Caption.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/shared/ui/Caption.svelte tests/client/shared/ui/Caption.test.ts
git commit -m "feat(ui): add Caption primitive

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: Build `KV` primitive (TDD)

**Files:**
- Create: `client/shared/ui/KV.svelte`
- Test: `tests/client/shared/ui/KV.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import KV from '../../../../client/shared/ui/KV.svelte'

describe('KV.svelte', () => {
  test('renders key on the left and value on the right', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(KV, { target, props: { k: 'subjects', v: '32' } })
    const k = target.querySelector('.ui-kv__k')
    const v = target.querySelector('.ui-kv__v')
    expect(k!.textContent).toBe('subjects')
    expect(v!.textContent).toBe('32')
    void unmount(component)
  })

  test('applies custom value color via vColor', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(KV, { target, props: { k: 'active', v: '4', vColor: 'var(--accent)' } })
    const v = target.querySelector('.ui-kv__v') as HTMLElement
    expect(v.style.color).toContain('var(--accent)')
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test:client tests/client/shared/ui/KV.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `client/shared/ui/KV.svelte`**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  interface Props {
    k: string
    v: string | number
    vColor?: string
    dim?: boolean
  }

  let { k, v, vColor, dim = false }: Props = $props()
</script>

<div class="ui-kv">
  <span class="ui-kv__k" style:color={dim ? 'var(--fg4)' : 'var(--fg3)'}>{k}</span>
  <span class="ui-kv__v" style:color={vColor ?? 'var(--fg)'}>{v}</span>
</div>

<style>
  .ui-kv {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 3px 0;
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .ui-kv__v {
    text-align: right;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `bun test:client tests/client/shared/ui/KV.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/shared/ui/KV.svelte tests/client/shared/ui/KV.test.ts
git commit -m "feat(ui): add KV primitive

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: Build `Pill` primitive (TDD)

**Files:**
- Create: `client/shared/ui/Pill.svelte`
- Test: `tests/client/shared/ui/Pill.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createRawSnippet, mount, unmount } from 'svelte'
import type { Snippet } from 'svelte'

import Pill from '../../../../client/shared/ui/Pill.svelte'

function textSnippet(text: string): Snippet {
  return createRawSnippet(() => ({ render: () => `<span>${text}</span>` }))
}

type Tone = 'accent' | 'warn' | 'danger' | 'info' | 'neutral' | 'mute'

describe('Pill.svelte', () => {
  test('renders the label text', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Pill, {
      target,
      props: { children: textSnippet('connected'), tone: 'accent', dot: true },
    })
    expect(target.textContent).toContain('connected')
    void unmount(component)
  })

  test.each<Tone>(['accent', 'warn', 'danger', 'info', 'neutral', 'mute'])(
    'applies the ui-pill--%s tone class',
    (tone) => {
      document.body.innerHTML = '<div id="root"></div>'
      const target = document.body.querySelector<HTMLElement>('#root')!
      const component = mount(Pill, { target, props: { children: textSnippet('x'), tone } })
      expect(target.querySelector(`.ui-pill--${tone}`)).not.toBeNull()
      void unmount(component)
    }
  )

  test('renders a Dot when dot=true', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Pill, {
      target,
      props: { children: textSnippet('ok'), tone: 'accent', dot: true },
    })
    expect(target.querySelector('.ui-dot')).not.toBeNull()
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test:client tests/client/shared/ui/Pill.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `client/shared/ui/Pill.svelte`**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  import Dot from './Dot.svelte'

  type Tone = 'accent' | 'warn' | 'danger' | 'info' | 'neutral' | 'mute'

  interface Props {
    children: Snippet
    tone?: Tone
    dot?: boolean
  }

  let { children, tone = 'neutral', dot = false }: Props = $props()

  const dotColor: Record<Tone, string> = {
    accent: 'var(--accent)',
    warn: 'var(--warn)',
    danger: 'var(--danger)',
    info: 'var(--info)',
    neutral: 'var(--fg3)',
    mute: 'var(--fg4)',
  }
</script>

<span class="ui-pill ui-pill--{tone}">
  {#if dot}
    <Dot color={dotColor[tone]} glow={tone === 'accent'} />
  {/if}
  {@render children()}
</span>

<style>
  .ui-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    padding: 2px 8px;
    line-height: 1.4;
    border: 1px solid transparent;
  }

  .ui-pill--accent {
    color: var(--accent);
    background: var(--accent-soft);
    border-color: rgba(93, 217, 122, 0.3);
  }
  .ui-pill--warn {
    color: var(--warn);
    background: var(--warn-soft);
    border-color: rgba(229, 169, 58, 0.3);
  }
  .ui-pill--danger {
    color: var(--danger);
    background: var(--danger-soft);
    border-color: rgba(232, 92, 92, 0.3);
  }
  .ui-pill--info {
    color: var(--info);
    background: var(--info-soft);
    border-color: rgba(108, 182, 255, 0.3);
  }
  .ui-pill--neutral {
    color: var(--fg2);
    background: transparent;
    border-color: var(--border);
  }
  .ui-pill--mute {
    color: var(--fg3);
    background: transparent;
    border-color: var(--hair);
  }
</style>
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `bun test:client tests/client/shared/ui/Pill.test.ts`
Expected: PASS (all 8 assertions: 1 label + 6 tones + 1 dot).

- [ ] **Step 5: Commit**

```bash
git add client/shared/ui/Pill.svelte tests/client/shared/ui/Pill.test.ts
git commit -m "feat(ui): add Pill primitive

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: Build `Btn` primitive (TDD)

**Files:**
- Create: `client/shared/ui/Btn.svelte`
- Test: `tests/client/shared/ui/Btn.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createRawSnippet, mount, unmount } from 'svelte'
import type { Snippet } from 'svelte'

import Btn from '../../../../client/shared/ui/Btn.svelte'

function textSnippet(text: string): Snippet {
  return createRawSnippet(() => ({ render: () => `<span>${text}</span>` }))
}

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

describe('Btn.svelte', () => {
  test.each<Variant>(['primary', 'secondary', 'outline', 'ghost', 'danger'])(
    'applies ui-btn--%s variant class',
    (variant) => {
      document.body.innerHTML = '<div id="root"></div>'
      const target = document.body.querySelector<HTMLElement>('#root')!
      const component = mount(Btn, { target, props: { children: textSnippet('x'), variant } })
      expect(target.querySelector(`.ui-btn--${variant}`)).not.toBeNull()
      void unmount(component)
    }
  )

  test.each<Size>(['sm', 'md', 'lg'])('applies ui-btn--%s size class', (size) => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Btn, { target, props: { children: textSnippet('x'), size } })
    expect(target.querySelector(`.ui-btn--${size}`)).not.toBeNull()
    void unmount(component)
  })

  test('invokes onClick when clicked', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    let clicked = false
    const component = mount(Btn, {
      target,
      props: { children: textSnippet('go'), onClick: () => { clicked = true } },
    })
    const btn = target.querySelector('.ui-btn') as HTMLButtonElement
    btn.click()
    expect(clicked).toBe(true)
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test:client tests/client/shared/ui/Btn.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `client/shared/ui/Btn.svelte`**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
  type Size = 'sm' | 'md' | 'lg'

  interface Props {
    children: Snippet
    variant?: Variant
    size?: Size
    onClick?: () => void
    type?: 'button' | 'submit'
    disabled?: boolean
  }

  let {
    children,
    variant = 'secondary',
    size = 'md',
    onClick,
    type = 'button',
    disabled = false,
  }: Props = $props()
</script>

<button
  class="ui-btn ui-btn--{variant} ui-btn--{size}"
  {type}
  {disabled}
  onclick={onClick}
>
  {@render children()}
</button>

<style>
  .ui-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-weight: 500;
    cursor: pointer;
    border-radius: 2px;
    border: 1px solid transparent;
  }
  .ui-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .ui-btn--primary {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }
  .ui-btn--secondary {
    background: var(--raised);
    color: var(--fg);
    border-color: var(--border);
  }
  .ui-btn--outline {
    background: transparent;
    color: var(--fg);
    border-color: var(--border);
  }
  .ui-btn--ghost {
    background: transparent;
    color: var(--fg2);
    border-color: transparent;
  }
  .ui-btn--danger {
    background: transparent;
    color: var(--danger);
    border-color: rgba(232, 92, 92, 0.3);
  }

  .ui-btn--sm {
    padding: 3px 8px;
    font-size: 11px;
    height: 22px;
  }
  .ui-btn--md {
    padding: 5px 12px;
    font-size: 12px;
    height: 28px;
  }
  .ui-btn--lg {
    padding: 8px 16px;
    font-size: 13px;
    height: 34px;
  }
</style>
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `bun test:client tests/client/shared/ui/Btn.test.ts`
Expected: PASS (5 variants + 3 sizes + 1 click = 9 cases).

- [ ] **Step 5: Commit**

```bash
git add client/shared/ui/Btn.svelte tests/client/shared/ui/Btn.test.ts
git commit -m "feat(ui): add Btn primitive

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 11: Build `Input` primitive (TDD)

**Files:**
- Create: `client/shared/ui/Input.svelte`
- Test: `tests/client/shared/ui/Input.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createRawSnippet, mount, unmount } from 'svelte'
import type { Snippet } from 'svelte'

import Input from '../../../../client/shared/ui/Input.svelte'

function textSnippet(text: string): Snippet {
  return createRawSnippet(() => ({ render: () => `<span>${text}</span>` }))
}

describe('Input.svelte', () => {
  test('renders an input with the given placeholder', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Input, { target, props: { value: '', placeholder: 'search…' } })
    const input = target.querySelector('input') as HTMLInputElement
    expect(input.placeholder).toBe('search…')
    void unmount(component)
  })

  test('renders the prefix snippet alongside the input', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Input, {
      target,
      props: { value: '', prefix: textSnippet('⌕') },
    })
    expect(target.querySelector('.ui-input__prefix')!.textContent).toContain('⌕')
    void unmount(component)
  })

  test('calls onInput when the input value changes', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    let last = ''
    const component = mount(Input, {
      target,
      props: { value: '', onInput: (v: string) => { last = v } },
    })
    const input = target.querySelector('input') as HTMLInputElement
    input.value = 'hi'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(last).toBe('hi')
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test:client tests/client/shared/ui/Input.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `client/shared/ui/Input.svelte`**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    value: string
    placeholder?: string
    prefix?: Snippet
    onInput?: (value: string) => void
    type?: 'text' | 'search'
    readonly?: boolean
  }

  let { value, placeholder, prefix, onInput, type = 'text', readonly = false }: Props = $props()

  function handleInput(event: Event): void {
    const next = (event.target as HTMLInputElement).value
    onInput?.(next)
  }
</script>

<div class="ui-input">
  {#if prefix}
    <span class="ui-input__prefix">{@render prefix()}</span>
  {/if}
  <input {type} {placeholder} {value} {readonly} oninput={handleInput} />
</div>

<style>
  .ui-input {
    display: flex;
    align-items: center;
    background: var(--raised);
    border: 1px solid var(--border);
    padding: 0 10px;
    border-radius: 2px;
  }
  .ui-input__prefix {
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 12px;
    margin-right: 8px;
  }
  .ui-input input {
    background: transparent;
    border: 0;
    outline: 0;
    color: var(--fg);
    font-family: var(--font-mono);
    font-size: 12px;
    flex: 1;
    padding: 6px 0;
  }
</style>
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `bun test:client tests/client/shared/ui/Input.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/shared/ui/Input.svelte tests/client/shared/ui/Input.test.ts
git commit -m "feat(ui): add Input primitive

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 12: Build `Select` primitive (TDD)

**Files:**
- Create: `client/shared/ui/Select.svelte`
- Test: `tests/client/shared/ui/Select.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import Select from '../../../../client/shared/ui/Select.svelte'

describe('Select.svelte', () => {
  test('renders one <option> per option entry', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Select, {
      target,
      props: {
        value: '30d',
        options: [
          { value: '24h', label: '24h' },
          { value: '7d', label: '7d' },
          { value: '30d', label: '30d' },
          { value: 'all', label: 'all' },
        ],
      },
    })
    const opts = target.querySelectorAll('option')
    expect(opts.length).toBe(4)
    expect((target.querySelector('select') as HTMLSelectElement).value).toBe('30d')
    void unmount(component)
  })

  test('calls onChange with the new value', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    let last = ''
    const component = mount(Select, {
      target,
      props: {
        value: '30d',
        options: [
          { value: '7d', label: '7d' },
          { value: '30d', label: '30d' },
        ],
        onChange: (v: string) => { last = v },
      },
    })
    const sel = target.querySelector('select') as HTMLSelectElement
    sel.value = '7d'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    expect(last).toBe('7d')
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test:client tests/client/shared/ui/Select.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `client/shared/ui/Select.svelte`**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  interface Option {
    value: string
    label: string
  }

  interface Props {
    value: string
    options: Option[]
    onChange?: (value: string) => void
  }

  let { value, options, onChange }: Props = $props()

  function handleChange(event: Event): void {
    onChange?.((event.target as HTMLSelectElement).value)
  }
</script>

<div class="ui-select">
  <select {value} onchange={handleChange}>
    {#each options as opt (opt.value)}
      <option value={opt.value}>{opt.label}</option>
    {/each}
  </select>
  <span class="ui-select__caret">▾</span>
</div>

<style>
  .ui-select {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: var(--raised);
    border: 1px solid var(--border);
    padding: 4px 8px 4px 10px;
    border-radius: 2px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg);
  }
  .ui-select select {
    background: transparent;
    border: 0;
    outline: 0;
    color: var(--fg);
    font: inherit;
    appearance: none;
  }
  .ui-select__caret {
    color: var(--fg3);
    font-size: 10px;
    pointer-events: none;
  }
</style>
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `bun test:client tests/client/shared/ui/Select.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/shared/ui/Select.svelte tests/client/shared/ui/Select.test.ts
git commit -m "feat(ui): add Select primitive

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 13: Build `Seg` primitive (TDD)

**Files:**
- Create: `client/shared/ui/Seg.svelte`
- Test: `tests/client/shared/ui/Seg.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import Seg from '../../../../client/shared/ui/Seg.svelte'

describe('Seg.svelte', () => {
  test('renders one button per option and marks the active one', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Seg, {
      target,
      props: { options: ['24h', '7d', '30d', 'all'], value: '30d' },
    })
    const buttons = target.querySelectorAll('.ui-seg__btn')
    expect(buttons.length).toBe(4)
    expect(target.querySelector('.ui-seg__btn--active')!.textContent).toBe('30d')
    void unmount(component)
  })

  test('clicking a button invokes onChange with its value', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    let last = ''
    const component = mount(Seg, {
      target,
      props: {
        options: ['dm', 'group'],
        value: 'dm',
        onChange: (v: string) => { last = v },
      },
    })
    const btns = Array.from(target.querySelectorAll<HTMLButtonElement>('.ui-seg__btn'))
    btns.find((b) => b.textContent === 'group')!.click()
    expect(last).toBe('group')
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test:client tests/client/shared/ui/Seg.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `client/shared/ui/Seg.svelte`**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  interface Props {
    options: string[]
    value: string
    onChange?: (value: string) => void
  }

  let { options, value, onChange }: Props = $props()
</script>

<div class="ui-seg">
  {#each options as opt (opt)}
    <button
      type="button"
      class="ui-seg__btn"
      class:ui-seg__btn--active={opt === value}
      onclick={() => onChange?.(opt)}
    >{opt}</button>
  {/each}
</div>

<style>
  .ui-seg {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 2px;
    background: var(--surface);
    padding: 2px;
  }
  .ui-seg__btn {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    padding: 4px 10px;
    color: var(--fg3);
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
  }
  .ui-seg__btn--active {
    color: var(--fg);
    background: var(--raised);
    border-color: var(--hair);
  }
</style>
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `bun test:client tests/client/shared/ui/Seg.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/shared/ui/Seg.svelte tests/client/shared/ui/Seg.test.ts
git commit -m "feat(ui): add Seg primitive

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 14: Build `Panel` primitive (TDD)

**Files:**
- Create: `client/shared/ui/Panel.svelte`
- Test: `tests/client/shared/ui/Panel.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createRawSnippet, mount, unmount } from 'svelte'
import type { Snippet } from 'svelte'

import Panel from '../../../../client/shared/ui/Panel.svelte'

function textSnippet(text: string): Snippet {
  return createRawSnippet(() => ({ render: () => `<span>${text}</span>` }))
}

describe('Panel.svelte', () => {
  test('renders title and body content', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Panel, {
      target,
      props: { title: 'sessions', body: textSnippet('row1') },
    })
    expect(target.querySelector('.ui-panel__title')!.textContent).toBe('sessions')
    expect(target.querySelector('.ui-panel__body')!.textContent).toContain('row1')
    void unmount(component)
  })

  test('renders the count when provided', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Panel, {
      target,
      props: { title: 'sessions', count: 12, body: textSnippet('rows') },
    })
    expect(target.querySelector('.ui-panel__count')!.textContent).toBe('12')
    void unmount(component)
  })

  test('renders the action snippet', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Panel, {
      target,
      props: {
        title: 'sessions',
        body: textSnippet('rows'),
        action: textSnippet('⟳'),
      },
    })
    expect(target.querySelector('.ui-panel__action')!.textContent).toContain('⟳')
    void unmount(component)
  })

  test('omits the header when title is undefined', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Panel, { target, props: { body: textSnippet('only body') } })
    expect(target.querySelector('.ui-panel__header')).toBeNull()
    expect(target.querySelector('.ui-panel__body')!.textContent).toContain('only body')
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test:client tests/client/shared/ui/Panel.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `client/shared/ui/Panel.svelte`**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    title?: string
    count?: string | number
    body: Snippet
    action?: Snippet
    dense?: boolean
    flat?: boolean
  }

  let { title, count, body, action, dense = false, flat = false }: Props = $props()
</script>

<div class="ui-panel" class:ui-panel--flat={flat}>
  {#if title !== undefined}
    <div class="ui-panel__header" class:ui-panel__header--dense={dense}>
      <div class="ui-panel__header-left">
        <span class="ui-panel__title">{title}</span>
        {#if count !== undefined}
          <span class="ui-panel__count">{count}</span>
        {/if}
      </div>
      {#if action}
        <div class="ui-panel__action">{@render action()}</div>
      {/if}
    </div>
  {/if}
  <div class="ui-panel__body">{@render body()}</div>
</div>

<style>
  .ui-panel {
    background: var(--surface);
    border: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  .ui-panel--flat {
    background: transparent;
  }
  .ui-panel__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid var(--hair);
    gap: 12px;
    flex-shrink: 0;
  }
  .ui-panel__header--dense {
    padding: 8px 12px;
  }
  .ui-panel__header-left {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .ui-panel__title {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg2);
  }
  .ui-panel__count {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg3);
  }
  .ui-panel__action {
    display: flex;
    gap: 6px;
  }
  .ui-panel__body {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
</style>
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `bun test:client tests/client/shared/ui/Panel.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 5: Commit**

```bash
git add client/shared/ui/Panel.svelte tests/client/shared/ui/Panel.test.ts
git commit -m "feat(ui): add Panel primitive

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 15: Build `Spark` primitive (TDD)

**Files:**
- Create: `client/shared/ui/Spark.svelte`
- Test: `tests/client/shared/ui/Spark.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import Spark from '../../../../client/shared/ui/Spark.svelte'

describe('Spark.svelte', () => {
  test('renders an svg with a polyline path for the data series', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Spark, {
      target,
      props: { data: [1, 2, 3, 4, 5], width: 100, height: 20 },
    })
    const svg = target.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg!.getAttribute('width')).toBe('100')
    expect(svg!.getAttribute('height')).toBe('20')
    const linePath = target.querySelector('path[data-role="line"]')
    expect(linePath).not.toBeNull()
    expect(linePath!.getAttribute('d')).toContain('M ')
    void unmount(component)
  })

  test('omits the fill path when fill=false', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Spark, {
      target,
      props: { data: [1, 2, 3], fill: false },
    })
    expect(target.querySelector('path[data-role="area"]')).toBeNull()
    expect(target.querySelector('path[data-role="line"]')).not.toBeNull()
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test:client tests/client/shared/ui/Spark.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `client/shared/ui/Spark.svelte`**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  interface Props {
    data: number[]
    width?: number
    height?: number
    color?: string
    fill?: boolean
  }

  let { data, width = 120, height = 28, color = 'var(--accent)', fill = true }: Props = $props()

  const linePath = $derived.by(() => {
    if (data.length === 0) return ''
    const max = Math.max(...data, 1)
    const min = Math.min(...data, 0)
    const range = max - min || 1
    const pts = data.map((v, i) => {
      const x = (i / Math.max(data.length - 1, 1)) * width
      const y = height - ((v - min) / range) * (height - 2) - 1
      return `${x},${y}`
    })
    return `M ${pts.join(' L ')}`
  })

  const areaPath = $derived(`${linePath} L ${width},${height} L 0,${height} Z`)
</script>

<svg {width} {height} class="ui-spark">
  {#if fill}
    <path data-role="area" d={areaPath} fill={color} fill-opacity="0.1" />
  {/if}
  <path data-role="line" d={linePath} fill="none" stroke={color} stroke-width="1.25" />
</svg>

<style>
  .ui-spark {
    display: block;
  }
</style>
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `bun test:client tests/client/shared/ui/Spark.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/shared/ui/Spark.svelte tests/client/shared/ui/Spark.test.ts
git commit -m "feat(ui): add Spark sparkline primitive

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 16: Build `Bars` primitive (TDD)

**Files:**
- Create: `client/shared/ui/Bars.svelte`
- Test: `tests/client/shared/ui/Bars.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import Bars from '../../../../client/shared/ui/Bars.svelte'

describe('Bars.svelte', () => {
  test('renders one rect per data point', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Bars, {
      target,
      props: { data: [3, 5, 7, 9], width: 200, height: 40 },
    })
    expect(target.querySelector('svg')).not.toBeNull()
    expect(target.querySelectorAll('rect').length).toBe(4)
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test:client tests/client/shared/ui/Bars.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `client/shared/ui/Bars.svelte`**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  interface Props {
    data: number[]
    width?: number
    height?: number
    color?: string
  }

  let { data, width = 240, height = 56, color = 'var(--accent)' }: Props = $props()

  const max = $derived(Math.max(...data, 1))
  const bw = $derived(data.length > 0 ? width / data.length : 0)
</script>

<svg {width} {height} class="ui-bars">
  {#each data as v, i (i)}
    {@const h = (v / max) * (height - 4)}
    <rect x={i * bw + 1} y={height - h} width={bw - 2} height={h} fill={color} fill-opacity="0.85" />
  {/each}
</svg>

<style>
  .ui-bars {
    display: block;
  }
</style>
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `bun test:client tests/client/shared/ui/Bars.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/shared/ui/Bars.svelte tests/client/shared/ui/Bars.test.ts
git commit -m "feat(ui): add Bars chart primitive

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 17: Build `Shell` primitive (TDD)

**Files:**
- Create: `client/shared/ui/Shell.svelte`
- Test: `tests/client/shared/ui/Shell.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createRawSnippet, mount, unmount } from 'svelte'
import type { Snippet } from 'svelte'

import Shell from '../../../../client/shared/ui/Shell.svelte'

function textSnippet(text: string): Snippet {
  return createRawSnippet(() => ({ render: () => `<span>${text}</span>` }))
}

describe('Shell.svelte', () => {
  test('renders the topBar slot above the children slot', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(Shell, {
      target,
      props: {
        topBar: textSnippet('TOP'),
        children: textSnippet('BODY'),
      },
    })
    const shell = target.querySelector('.ui-shell')!
    const topBar = shell.querySelector('.ui-shell__topbar')!
    const body = shell.querySelector('.ui-shell__body')!
    expect(topBar.textContent).toContain('TOP')
    expect(body.textContent).toContain('BODY')
    // topBar precedes body in DOM order
    expect(topBar.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test:client tests/client/shared/ui/Shell.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `client/shared/ui/Shell.svelte`**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    topBar: Snippet
    children: Snippet
  }

  let { topBar, children }: Props = $props()
</script>

<div class="ui-shell">
  <div class="ui-shell__topbar">{@render topBar()}</div>
  <div class="ui-shell__body">{@render children()}</div>
</div>

<style>
  .ui-shell {
    background: var(--bg);
    color: var(--fg);
    font-family: var(--font-mono);
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .ui-shell__body {
    flex: 1;
    min-height: 0;
    padding: 16px;
  }
</style>
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `bun test:client tests/client/shared/ui/Shell.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/shared/ui/Shell.svelte tests/client/shared/ui/Shell.test.ts
git commit -m "feat(ui): add Shell primitive

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 18: Build `TopBar` primitive (TDD)

**Files:**
- Create: `client/shared/ui/TopBar.svelte`
- Test: `tests/client/shared/ui/TopBar.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createRawSnippet, mount, unmount } from 'svelte'
import type { Snippet } from 'svelte'

import TopBar from '../../../../client/shared/ui/TopBar.svelte'

function textSnippet(text: string): Snippet {
  return createRawSnippet(() => ({ render: () => `<span>${text}</span>` }))
}

describe('TopBar.svelte', () => {
  test('renders the brand with page suffix and the status row', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(TopBar, {
      target,
      props: { page: 'debug', statusRow: textSnippet('[connected]') },
    })
    const brand = target.querySelector('.ui-topbar__brand')!
    expect(brand.textContent).toContain('papai')
    expect(brand.textContent).toContain('::debug')
    expect(target.querySelector('.ui-topbar__status')!.textContent).toContain('[connected]')
    void unmount(component)
  })

  test('renders the secondary row when provided', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(TopBar, {
      target,
      props: {
        page: 'admin',
        statusRow: textSnippet('s'),
        secondaryRow: textSnippet('window 30d'),
      },
    })
    expect(target.querySelector('.ui-topbar__secondary')!.textContent).toContain('window 30d')
    void unmount(component)
  })

  test('omits the secondary row when not provided', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(TopBar, {
      target,
      props: { page: 'admin', statusRow: textSnippet('s') },
    })
    expect(target.querySelector('.ui-topbar__secondary')).toBeNull()
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test:client tests/client/shared/ui/TopBar.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `client/shared/ui/TopBar.svelte`**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    page: string
    statusRow: Snippet
    secondaryRow?: Snippet
  }

  let { page, statusRow, secondaryRow }: Props = $props()
</script>

<div class="ui-topbar">
  <div class="ui-topbar__primary">
    <div class="ui-topbar__brand">
      <span class="ui-topbar__brand-name">papai</span>
      <span class="ui-topbar__brand-page">::{page}</span>
    </div>
    <div class="ui-topbar__spacer"></div>
    <div class="ui-topbar__status">{@render statusRow()}</div>
  </div>
  {#if secondaryRow}
    <div class="ui-topbar__secondary">{@render secondaryRow()}</div>
  {/if}
</div>

<style>
  .ui-topbar {
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }
  .ui-topbar__primary {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 12px 16px;
  }
  .ui-topbar__brand {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .ui-topbar__brand-name {
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 700;
    color: var(--fg);
    letter-spacing: -0.01em;
  }
  .ui-topbar__brand-page {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--accent);
    font-weight: 600;
  }
  .ui-topbar__spacer {
    flex: 1;
  }
  .ui-topbar__secondary {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 8px 16px;
    border-top: 1px solid var(--hair);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg2);
  }
</style>
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `bun test:client tests/client/shared/ui/TopBar.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/shared/ui/TopBar.svelte tests/client/shared/ui/TopBar.test.ts
git commit -m "feat(ui): add TopBar primitive

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 19: Restyle `Modal.svelte` (tokens, no shadow, 2px radius)

**Files:**
- Modify: `client/shared/Modal.svelte`

Note: `client/shared/base.css` already migrated `.modal-content` border-radius to 2px in Task 2. The Modal component itself has no inline styles — all styling lives in `base.css`. This task verifies that and ensures nothing escaped.

- [ ] **Step 1: Verify `Modal.svelte` has no inline color/border styles**

Run: `grep -nE '(background|color|border|box-shadow)' client/shared/Modal.svelte`
Expected: no output (all styles are class-based, defined in `base.css`).

If the grep finds anything, port those values to `base.css` and remove them from the Svelte file.

- [ ] **Step 2: Re-run the existing Modal test**

Run: `bun test:client tests/client/shared/Modal.test.ts`
Expected: all 9 tests pass.

- [ ] **Step 3: Visual smoke check (optional)**

Run: `bun start:debug` and open `/admin` in a browser. Click any button that opens a modal (e.g., one in System / credentials). Confirm: black-tinted backdrop, near-black raised modal surface, hairline border, 2px corner radius, no shadow.

- [ ] **Step 4: Commit (only if any changes were needed)**

If Step 1 found no inline styles and no other code changed, skip this commit. If you ported anything out of Modal.svelte into base.css, commit it:

```bash
git add client/shared/Modal.svelte client/shared/base.css
git commit -m "$(cat <<'EOF'
refactor(modal): port any remaining inline styles to base.css

Modal styling now lives entirely in base.css against design tokens.
No structural change; existing tests remain green.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 20: Restyle `Confirm.svelte` (tokens)

**Files:**
- Modify: `client/shared/Confirm.svelte`

- [ ] **Step 1: Read the current Confirm.svelte**

Open `client/shared/Confirm.svelte`. If it has a `<style>` block with hex colors, port each hex to the corresponding `var(--…)` token using the same mapping table as Task 2 (base.css migration):

| Old hex | New value |
|---|---|
| any near-black bg | `var(--surface)` or `var(--raised)` |
| any grey border | `var(--border)` |
| any greyish text | `var(--fg)` / `var(--fg2)` / `var(--fg3)` |
| any red/danger color | `var(--danger)` |
| `#cccccc` | `var(--fg)` |

Apply per-line. If the file has no inline style block (it reuses `base.css` classes), there's nothing to change.

- [ ] **Step 2: Verify no hex remains in `Confirm.svelte`**

Run: `grep -nE '#[0-9a-fA-F]{3,8}' client/shared/Confirm.svelte`
Expected: no output.

- [ ] **Step 3: Run the existing Confirm test**

Run: `bun test:client tests/client/shared/Confirm.test.ts`
Expected: all tests pass.

- [ ] **Step 4: Commit (only if changes were needed)**

```bash
git add client/shared/Confirm.svelte
git commit -m "refactor(confirm): migrate Confirm.svelte to design tokens

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

(If no changes were needed, skip this commit.)

---

## Task 21: Restyle remaining shared primitives

**Files:**
- Modify: `client/shared/PanelShell.svelte`
- Modify: `client/shared/PropertiesTable.svelte`
- Modify: `client/shared/StatusDot.svelte`
- Modify: `client/shared/TreeView.svelte`

For each file, repeat the same pattern as Task 20: find any hex colors in `<style>` blocks or inline `style:` directives and replace with the appropriate `var(--…)` token. Use the same mapping table.

- [ ] **Step 1: Verify each file uses tokens only**

Run: `grep -nE '#[0-9a-fA-F]{3,8}' client/shared/PanelShell.svelte client/shared/PropertiesTable.svelte client/shared/StatusDot.svelte client/shared/TreeView.svelte`
Expected: no output.

Per file, if hex codes appear, apply the mapping table from Task 2. For drop-shadows (`box-shadow:`), remove them — the Telemetry aesthetic forbids shadows.

- [ ] **Step 2: Run the entire client test suite**

Run: `bun test:client`
Expected: every test passes.

- [ ] **Step 3: Commit (only if changes were needed)**

```bash
git add client/shared/PanelShell.svelte client/shared/PropertiesTable.svelte client/shared/StatusDot.svelte client/shared/TreeView.svelte
git commit -m "$(cat <<'EOF'
refactor(shared): migrate remaining shared primitives to design tokens

Panel shell, properties table, status dot, and tree view all now
read colors from var(--…). No structural changes; existing
component APIs preserved.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

(If no changes were needed, skip this commit.)

---

## Task 22: Run full check suite and verify the bundle

**Files:** (none modified)

This is the final gate before declaring PR 1 done.

- [ ] **Step 1: Run the full check pipeline**

Run: `bun check:full`
Expected: no errors. (`format:check`, `lint`, license headers, etc.)

If it fails, fix the underlying issue. Do not bypass with `--no-verify`.

- [ ] **Step 2: Run the complete client test suite**

Run: `bun test:client`
Expected: every primitive test (14 new files × 2–4 tests each) plus the existing Modal/Confirm/AdminApp/StatsPanel tests all pass.

- [ ] **Step 3: Run the main unit suite**

Run: `bun test`
Expected: passes. (No backend code changed; this is a sanity check.)

- [ ] **Step 4: Build the bundles and inspect**

Run: `bun build:client`
Verify:

```bash
grep -c '^:root {' public/debug.css public/admin.css
# expected: each reports 1

grep -cE '#[0-9a-fA-F]{3,8}' public/debug.css public/admin.css
# expected: both report 0 (after token + CSS migration, the bundle holds vars only)
```

Note: the SECOND check may show a small non-zero count from Svelte component-scoped CSS that still uses hex internally. That's fine — those values will be ported as needed when /debug and /admin layouts are restructured in PR 2 and PR 3. The check is to confirm the centrally-shared CSS files (tokens + base + admin + debug page) are clean.

- [ ] **Step 5: No final commit — all work was already committed task-by-task**

PR 1 is complete. Summary on the branch should show 21 (or fewer, if some "if needed" tasks skipped) commits, each ~10–80 lines of diff.

---

## Spec Coverage Self-Check

This plan covers exactly the work in spec sections 5 (Tokens) and 6 (Primitives), plus the "restyle existing primitives" sub-bullet that supports both sections. It does NOT cover:

- Section 7 (`/debug` shell + right rail) — that's PR 2.
- Section 8 (`/admin` shell + scrollspy + recent-requests endpoint) — that's PR 3.
- Section 9 (data plumbing) — supports PR 3.
- Section 10 (polish) — that's PR 4.

After this plan ships, write the PR 2 plan with the same structure, referencing the primitives delivered here.
