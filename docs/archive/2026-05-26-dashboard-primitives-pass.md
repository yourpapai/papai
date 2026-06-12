<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Dashboard Primitives Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the highest-leverage cross-cutting issues from [docs/design/dashboard-ui-audit.md](../../design/dashboard-ui-audit.md) — fix shared UI primitives, define missing CSS, style the broken TreeView/PropertiesTable, and remove the `.panel` CSS-class collision that double-pads six admin sections.

**Architecture:** All changes scoped to `client/shared/ui/`, `client/shared/`, `client/shared/base.css`, `client/admin/admin.css`, and `client/admin/sections/`. No behavioral changes to fetchers, state stores, or APIs. Strictly visual/structural — every existing test must continue to pass; new tests are added per primitive change.

**Tech Stack:** Svelte 5 (runes + Snippets), CSS custom properties from [tokens.css](../../../client/shared/tokens.css), Bun test runner (`bun:test`) with happy-dom (`tests/client-setup.ts`), `mount`/`unmount` from `svelte`.

**Test policy:** The project's TDD hook gates writes to `src/` and `client/`. Every primitive prop change has a corresponding unit test exercising the new behavior. Pure-CSS additions (hover pseudo-classes, undefined class definitions, TreeView/PropertiesTable styling) are validated by (a) asserting the rule string is present in the component's exported CSS via DOM inspection of compiled output where feasible, and (b) updated `.stories.svelte` variants for manual review. Where DOM inspection of CSS rules isn't reliable in happy-dom, the test asserts the _class is applied_ and the [audit doc](../../design/dashboard-ui-audit.md#) is updated to reflect the fix.

**Commit cadence:** One commit per task. Each commit must leave `bun test:client` green for the touched suites.

---

## File Map

**Modified primitives**

- `client/shared/ui/Btn.svelte` — add `:hover` rules per variant; add `icon` Snippet prop
- `client/shared/ui/Panel.svelte` — add `pad` prop forwarded to `.ui-panel__body` padding
- `client/shared/ui/KV.svelte` — broaden `v` prop to `string | number | Snippet`
- `client/shared/ui/TopBar.svelte` — make `statusRow` optional

**Modified shared**

- `client/shared/TreeView.svelte` — add scoped `<style>` block defining the `tree-*` classes used in template
- `client/shared/PropertiesTable.svelte` — same for its referenced classes
- `client/shared/base.css` — add `.status-success` rule; add `.truncation-banner` rule
- `client/admin/admin.css` — **remove** legacy `.panel` rule; add `.masked-value` / `.masked-hint` rules

**Migrated admin sections** (drop `class="panel"` from outer `<section>`, wrap body in `<Panel>` primitive where the audit requires it)

- `client/admin/sections/BillingSection.svelte`
- `client/admin/sections/GroupsSection.svelte`
- `client/admin/sections/IdentitiesSection.svelte`
- `client/admin/sections/MemosSection.svelte`
- `client/admin/sections/RemindersSection.svelte`
- `client/admin/sections/SystemSection.svelte`

**New / updated tests**

- `tests/client/shared/ui/Btn.test.ts` — extend with hover rule + icon prop assertions
- `tests/client/shared/ui/Panel.test.ts` — extend with `pad` prop assertion
- `tests/client/shared/ui/KV.test.ts` — extend with Snippet `v` assertion
- `tests/client/shared/ui/TopBar.test.ts` — extend with optional `statusRow` assertion
- `tests/client/shared/TreeView.test.ts` (existing in `tests/client/debug/components/`) — extend with class presence
- `tests/client/admin/sections/*.test.ts` — new tests asserting the outer `<section>` no longer carries `panel` class

**Updated stories**

- `client/shared/ui/Btn.stories.svelte` — add `Btn With Icon` variant
- `client/shared/ui/Panel.stories.svelte` — add `Padded body` variant
- `client/shared/ui/KV.stories.svelte` — add `KV with Pill value` variant
- `client/shared/ui/TopBar.stories.svelte` — add `Without status row` variant
- `client/shared/TreeView.stories.svelte` — verify styled output
- `client/admin/components/CredentialsForm.stories.svelte` — verify `status-success` / masked styles render

---

## Task 1: Btn — :hover styles for all five variants

**Files:**

- Modify: `client/shared/ui/Btn.svelte` (style block, lines ~46–95)
- Modify: `tests/client/shared/ui/Btn.test.ts` (append test)

- [ ] **Step 1: Write the failing test**

Append to `tests/client/shared/ui/Btn.test.ts`:

```typescript
test('Btn.svelte source contains :hover rules for every variant', async () => {
  const url = new URL('../../../../client/shared/ui/Btn.svelte', import.meta.url)
  const source = await Bun.file(url).text()
  for (const variant of ['primary', 'secondary', 'outline', 'ghost', 'danger'] as const) {
    expect(source).toContain(`.ui-btn--${variant}:hover`)
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/shared/ui/Btn.test.ts`
Expected: FAIL — substring `.ui-btn--primary:hover` not found in source.

- [ ] **Step 3: Add :hover rules to Btn.svelte**

Append to the `<style>` block in `client/shared/ui/Btn.svelte`, after the size rules:

```css
.ui-btn--primary:hover:not(:disabled) {
  background: #7be595;
  border-color: #7be595;
}
.ui-btn--secondary:hover:not(:disabled) {
  background: var(--strong);
}
.ui-btn--outline:hover:not(:disabled) {
  background: var(--raised);
}
.ui-btn--ghost:hover:not(:disabled) {
  background: var(--raised);
}
.ui-btn--danger:hover:not(:disabled) {
  background: var(--danger-soft);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/client/shared/ui/Btn.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/shared/ui/Btn.svelte tests/client/shared/ui/Btn.test.ts
git commit -m "fix(ui): add Btn :hover styles for all five variants"
```

---

## Task 2: Btn — `icon` Snippet prop

**Files:**

- Modify: `client/shared/ui/Btn.svelte`
- Modify: `tests/client/shared/ui/Btn.test.ts`
- Modify: `client/shared/ui/Btn.stories.svelte`

- [ ] **Step 1: Write the failing test**

Append to `tests/client/shared/ui/Btn.test.ts`:

```typescript
test('renders icon Snippet before children when provided', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const component = mount(Btn, {
    target,
    props: {
      children: textSnippet('Save'),
      icon: createRawSnippet(() => ({ render: () => '<span data-testid="icon">+</span>' })),
    },
  })
  const btn = target.querySelector<HTMLButtonElement>('.ui-btn')!
  const icon = btn.querySelector('[data-testid="icon"]')
  expect(icon).not.toBeNull()
  // Icon should appear before the children text node
  expect(btn.innerHTML.indexOf('data-testid="icon"')).toBeLessThan(btn.innerHTML.indexOf('Save'))
  void unmount(component)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/shared/ui/Btn.test.ts`
Expected: FAIL — `icon` prop not in `Props` interface (Svelte will warn or it renders without the icon).

- [ ] **Step 3: Add `icon` prop to Btn.svelte**

Edit `client/shared/ui/Btn.svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte'

  type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
  type Size = 'sm' | 'md' | 'lg'

  interface Props {
    children: Snippet
    icon?: Snippet
    variant?: Variant
    size?: Size
    onClick?: () => void
    type?: 'button' | 'submit'
    disabled?: boolean
  }

  let {
    children,
    icon,
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
  {#if icon}<span class="ui-btn__icon">{@render icon()}</span>{/if}
  {@render children()}
</button>
```

Add to the `<style>` block:

```css
.ui-btn__icon {
  display: inline-flex;
  align-items: center;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/client/shared/ui/Btn.test.ts`
Expected: PASS — all Btn tests green.

- [ ] **Step 5: Add story variant**

Append to `client/shared/ui/Btn.stories.svelte` an `Icon` variant that passes `icon` snippet rendering a `+` glyph.

- [ ] **Step 6: Commit**

```bash
git add client/shared/ui/Btn.svelte tests/client/shared/ui/Btn.test.ts client/shared/ui/Btn.stories.svelte
git commit -m "feat(ui): add icon Snippet prop to Btn"
```

---

## Task 3: Panel — `pad` prop

**Files:**

- Modify: `client/shared/ui/Panel.svelte`
- Modify: `tests/client/shared/ui/Panel.test.ts`
- Modify: `client/shared/ui/Panel.stories.svelte`

- [ ] **Step 1: Write the failing test**

Append to `tests/client/shared/ui/Panel.test.ts`:

```typescript
test('applies pad value as inline padding to body', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const component = mount(Panel, {
    target,
    props: { body: textSnippet('x'), pad: 12 },
  })
  const bodyEl = target.querySelector<HTMLElement>('.ui-panel__body')!
  expect(bodyEl.style.padding).toBe('12px')
  void unmount(component)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/shared/ui/Panel.test.ts`
Expected: FAIL — `pad` not in Props, body padding empty.

- [ ] **Step 3: Add `pad` prop to Panel.svelte**

Edit `client/shared/ui/Panel.svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    title?: string
    count?: string | number
    body: Snippet
    action?: Snippet
    dense?: boolean
    flat?: boolean
    pad?: number
  }

  let { title, count, body, action, dense = false, flat = false, pad }: Props = $props()
</script>
```

Change the body div to forward padding:

```svelte
<div class="ui-panel__body" style:padding={pad !== undefined ? `${pad}px` : undefined}>
  {@render body()}
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/client/shared/ui/Panel.test.ts`
Expected: PASS.

- [ ] **Step 5: Add story variant**

Append to `client/shared/ui/Panel.stories.svelte` a `Padded body` variant with `pad={12}`.

- [ ] **Step 6: Commit**

```bash
git add client/shared/ui/Panel.svelte tests/client/shared/ui/Panel.test.ts client/shared/ui/Panel.stories.svelte
git commit -m "feat(ui): add pad prop to Panel body"
```

---

## Task 4: KV — `v` accepts Snippet for rich content

**Files:**

- Modify: `client/shared/ui/KV.svelte`
- Modify: `tests/client/shared/ui/KV.test.ts`
- Modify: `client/shared/ui/KV.stories.svelte`

- [ ] **Step 1: Write the failing test**

Append to `tests/client/shared/ui/KV.test.ts`:

```typescript
test('renders v as Snippet when a Snippet is provided', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const vSnippet = createRawSnippet(() => ({
    render: () => '<span data-testid="rich">pill-content</span>',
  }))
  const component = mount(KV, { target, props: { k: 'label', v: vSnippet } })
  const rich = target.querySelector('[data-testid="rich"]')
  expect(rich).not.toBeNull()
  expect(rich?.textContent).toBe('pill-content')
  void unmount(component)
})
```

(Ensure `createRawSnippet` and `Snippet` are imported at the top of the test file alongside the existing helpers.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/shared/ui/KV.test.ts`
Expected: FAIL — `v` typed as `string | number`; TS-strict will reject but happy-dom run will show the Snippet rendered as `[object Object]` or empty.

- [ ] **Step 3: Update KV.svelte to accept Snippet**

Edit `client/shared/ui/KV.svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    k: string
    v: string | number | Snippet
    sub?: string
    vColor?: string
    dim?: boolean
  }

  let { k, v, sub, vColor, dim = false }: Props = $props()
</script>

<div class="ui-kv" class:ui-kv--stacked={sub !== undefined}>
  <span class="ui-kv__k" style:color={dim ? 'var(--fg4)' : 'var(--fg3)'}>{k}</span>
  <span class="ui-kv__v" style:color={vColor ?? 'var(--fg)'}>
    {#if typeof v === 'function'}
      {@render (v as Snippet)()}
    {:else}
      {v}
    {/if}
  </span>
  {#if sub !== undefined}
    <span class="ui-kv__sub">{sub}</span>
  {/if}
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/client/shared/ui/KV.test.ts`
Expected: PASS — all KV tests green (existing string/number variants still pass through the else branch).

- [ ] **Step 5: Add story variant**

Add `KV with Pill value` to `KV.stories.svelte` demonstrating a `<Pill>` rendered through the `v` Snippet.

- [ ] **Step 6: Commit**

```bash
git add client/shared/ui/KV.svelte tests/client/shared/ui/KV.test.ts client/shared/ui/KV.stories.svelte
git commit -m "feat(ui): accept Snippet for KV.v"
```

---

## Task 5: TopBar — optional `statusRow`

**Files:**

- Modify: `client/shared/ui/TopBar.svelte`
- Modify: `tests/client/shared/ui/TopBar.test.ts`
- Modify: `client/shared/ui/TopBar.stories.svelte`

- [ ] **Step 1: Write the failing test**

Append to `tests/client/shared/ui/TopBar.test.ts`:

```typescript
test('renders without statusRow when not provided', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const component = mount(TopBar, { target, props: { page: 'admin' } })
  const status = target.querySelector('.ui-topbar__status')
  expect(status).toBeNull()
  expect(target.querySelector('.ui-topbar__brand-page')?.textContent).toBe('::admin')
  void unmount(component)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/shared/ui/TopBar.test.ts`
Expected: FAIL — currently `statusRow` is required; either TS rejection or runtime error rendering undefined Snippet.

- [ ] **Step 3: Make `statusRow` optional in TopBar.svelte**

Edit `client/shared/ui/TopBar.svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    page: string
    statusRow?: Snippet
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
    {#if statusRow}
      <div class="ui-topbar__status">{@render statusRow()}</div>
    {/if}
  </div>
  {#if secondaryRow}
    <div class="ui-topbar__secondary">{@render secondaryRow()}</div>
  {/if}
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/client/shared/ui/TopBar.test.ts`
Expected: PASS — both existing connected/disconnected story variants and the new optional case work.

- [ ] **Step 5: Add story variant**

Add `Without status row` to `TopBar.stories.svelte`.

- [ ] **Step 6: Commit**

```bash
git add client/shared/ui/TopBar.svelte tests/client/shared/ui/TopBar.test.ts client/shared/ui/TopBar.stories.svelte
git commit -m "feat(ui): make TopBar.statusRow optional"
```

---

## Task 6: Define `status-success` and `truncation-banner` CSS

**Files:**

- Modify: `client/shared/base.css`
- New test: `tests/client/shared/base-css.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/client/shared/base-css.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

describe('base.css', () => {
  test('defines status-success class', async () => {
    const url = new URL('../../../client/shared/base.css', import.meta.url)
    const css = await Bun.file(url).text()
    expect(css).toContain('.status-success')
    expect(css).toMatch(/\.status-success[^{]*\{[^}]*color:\s*var\(--accent\)/)
  })

  test('defines truncation-banner class', async () => {
    const url = new URL('../../../client/shared/base.css', import.meta.url)
    const css = await Bun.file(url).text()
    expect(css).toContain('.truncation-banner')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/shared/base-css.test.ts`
Expected: FAIL — neither class exists in base.css.

- [ ] **Step 3: Append rules to base.css**

Append to `client/shared/base.css`:

```css
.status-success {
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 12px;
}

.status-error {
  color: var(--danger);
  font-family: var(--font-mono);
  font-size: 12px;
}

.truncation-banner {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--warn);
  background: var(--warn-soft);
  color: var(--warn);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
```

(Note: `.status-error` is added defensively even though it already exists — verify via grep before appending and skip the duplicate if already present.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/client/shared/base-css.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/shared/base.css tests/client/shared/base-css.test.ts
git commit -m "fix(ui): define status-success and truncation-banner CSS"
```

---

## Task 7: Define `masked-value` and `masked-hint` CSS

**Files:**

- Modify: `client/admin/admin.css`
- New test: `tests/client/admin/admin-css.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/client/admin/admin-css.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

describe('admin.css', () => {
  test('defines masked-value class', async () => {
    const url = new URL('../../../client/admin/admin.css', import.meta.url)
    const css = await Bun.file(url).text()
    expect(css).toContain('.masked-value')
  })

  test('defines masked-hint class', async () => {
    const url = new URL('../../../client/admin/admin.css', import.meta.url)
    const css = await Bun.file(url).text()
    expect(css).toContain('.masked-hint')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/admin/admin-css.test.ts`
Expected: FAIL.

- [ ] **Step 3: Append rules to admin.css**

Append to `client/admin/admin.css`:

```css
.masked-value {
  background: var(--inset);
  border: 1px solid var(--hair);
  padding: 4px 10px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg3);
  letter-spacing: 0.04em;
}

.masked-hint {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--fg4);
  margin-left: 6px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/client/admin/admin-css.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/admin/admin.css tests/client/admin/admin-css.test.ts
git commit -m "fix(admin): define masked-value and masked-hint CSS"
```

---

## Task 8: Style TreeView

**Files:**

- Modify: `client/shared/TreeView.svelte` (add `<style>` block)
- Modify: `tests/client/debug/components/TreeView.test.ts` (add class-presence assertion)

- [ ] **Step 1: Inspect current TreeView.svelte**

Read `client/shared/TreeView.svelte` and confirm the class names referenced in the template (e.g. `tree-row`, `tree-key`, `tree-toggle`, `tree-bracket`, `tree-children`, `tree-{type}`).

- [ ] **Step 2: Write the failing test**

Append to `tests/client/debug/components/TreeView.test.ts`:

```typescript
test('TreeView source contains scoped styles for tree-row and tree-key', async () => {
  const url = new URL('../../../../client/shared/TreeView.svelte', import.meta.url)
  const source = await Bun.file(url).text()
  // Extract the <style> block
  const styleMatch = source.match(/<style[^>]*>([\s\S]*?)<\/style>/)
  expect(styleMatch).not.toBeNull()
  const css = styleMatch![1]
  expect(css).toContain('.tree-row')
  expect(css).toContain('.tree-key')
  expect(css).toContain('.tree-toggle')
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/client/debug/components/TreeView.test.ts`
Expected: FAIL — no `<style>` block exists in TreeView.svelte.

- [ ] **Step 4: Add scoped style block to TreeView.svelte**

Append to `client/shared/TreeView.svelte`:

```svelte
<style>
  .tree-row {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 2px 0;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg);
    line-height: 1.5;
  }
  .tree-key {
    color: var(--fg2);
  }
  .tree-toggle {
    display: inline-flex;
    width: 12px;
    color: var(--fg3);
    cursor: pointer;
    user-select: none;
  }
  .tree-bracket {
    color: var(--fg3);
  }
  .tree-children {
    border-left: 1px dashed var(--hair);
  }
  .tree-string {
    color: var(--accent);
  }
  .tree-number {
    color: var(--info);
  }
  .tree-boolean {
    color: var(--warn);
  }
  .tree-null {
    color: var(--fg4);
    font-style: italic;
  }
</style>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/client/debug/components/TreeView.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/shared/TreeView.svelte tests/client/debug/components/TreeView.test.ts
git commit -m "fix(ui): add scoped styles to TreeView"
```

---

## Task 9: Style PropertiesTable

**Files:**

- Modify: `client/shared/PropertiesTable.svelte`
- New test: `tests/client/shared/PropertiesTable.test.ts`

- [ ] **Step 1: Inspect current PropertiesTable.svelte**

Read `client/shared/PropertiesTable.svelte` and confirm referenced class names (`tree-empty`, `tree-container`, `tree-table`, `tree-key-cell`, `tree-value-cell`).

- [ ] **Step 2: Write the failing test**

Create `tests/client/shared/PropertiesTable.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

describe('PropertiesTable.svelte', () => {
  test('source contains scoped styles for tree-container and tree-key-cell', async () => {
    const url = new URL('../../../client/shared/PropertiesTable.svelte', import.meta.url)
    const source = await Bun.file(url).text()
    const styleMatch = source.match(/<style[^>]*>([\s\S]*?)<\/style>/)
    expect(styleMatch).not.toBeNull()
    const css = styleMatch![1]
    expect(css).toContain('.tree-container')
    expect(css).toContain('.tree-key-cell')
    expect(css).toContain('.tree-value-cell')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/client/shared/PropertiesTable.test.ts`
Expected: FAIL.

- [ ] **Step 4: Add scoped style block to PropertiesTable.svelte**

Append to `client/shared/PropertiesTable.svelte`:

```svelte
<style>
  .tree-empty {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg4);
    padding: 8px 0;
  }
  .tree-container {
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .tree-table {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 16px;
    padding: 4px 0;
  }
  .tree-key-cell {
    color: var(--fg2);
    white-space: nowrap;
  }
  .tree-value-cell {
    color: var(--fg);
    min-width: 0;
    overflow-wrap: anywhere;
  }
</style>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/client/shared/PropertiesTable.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/shared/PropertiesTable.svelte tests/client/shared/PropertiesTable.test.ts
git commit -m "fix(ui): add scoped styles to PropertiesTable"
```

---

## Task 10: Remove `.panel` CSS class collision

**Files:**

- Modify: `client/admin/admin.css` (remove `.panel { ... }` block)
- Modify: `client/admin/sections/BillingSection.svelte` (drop `panel` from outer `<section>` class)
- Modify: `client/admin/sections/GroupsSection.svelte`
- Modify: `client/admin/sections/IdentitiesSection.svelte`
- Modify: `client/admin/sections/MemosSection.svelte`
- Modify: `client/admin/sections/RemindersSection.svelte`
- Modify: `client/admin/sections/SystemSection.svelte`
- New test: `tests/client/admin/sections/section-panel-class.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/client/admin/sections/section-panel-class.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

const SECTIONS = [
  'BillingSection',
  'GroupsSection',
  'IdentitiesSection',
  'MemosSection',
  'RemindersSection',
  'SystemSection',
] as const

describe('admin sections', () => {
  test.each(SECTIONS)('%s outer <section> does not carry the legacy "panel" class', async (name) => {
    const url = new URL(`../../../../client/admin/sections/${name}.svelte`, import.meta.url)
    const source = await Bun.file(url).text()
    // Find the first <section ... class="..."> tag
    const tagMatch = source.match(/<section\b[^>]*class="([^"]*)"/)
    expect(tagMatch).not.toBeNull()
    const classes = tagMatch![1].split(/\s+/)
    expect(classes).not.toContain('panel')
  })

  test('admin.css no longer defines a bare .panel rule', async () => {
    const url = new URL('../../../../client/admin/admin.css', import.meta.url)
    const css = await Bun.file(url).text()
    // Reject `.panel {` but allow `.panel-*` / `.admin-*-panel` / `.ui-panel*`
    expect(css).not.toMatch(/(^|\s)\.panel\s*\{/m)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/client/admin/sections/section-panel-class.test.ts`
Expected: FAIL — every section currently has `panel` in its class list and admin.css has `.panel { ... }`.

- [ ] **Step 3: Remove the `.panel` rule from admin.css**

Open `client/admin/admin.css` and delete the block at lines 38–43:

```css
.panel {
  padding: 20px;
  border-radius: 0;
}
```

(Verify the exact line range with `grep -n "^\.panel" client/admin/admin.css` first — adjust if drifted.)

- [ ] **Step 4: Strip `panel` from each section's outer `<section>` class**

Apply the following edits — each is a single-line class-attribute edit:

- `BillingSection.svelte:62`:
  `class="panel billing-panel admin-section"` → `class="billing-panel admin-section"`
- `GroupsSection.svelte:57`:
  `class="panel admin-data-section admin-section"` → `class="admin-data-section admin-section"`
- `IdentitiesSection.svelte:64`:
  `class="panel admin-data-section admin-section"` → `class="admin-data-section admin-section"`
- `MemosSection.svelte:64`:
  `class="panel admin-data-section admin-section"` → `class="admin-data-section admin-section"`
- `RemindersSection.svelte:71`:
  `class="panel admin-data-section admin-section"` → `class="admin-data-section admin-section"`
- `SystemSection.svelte:47`:
  `class="panel system-section admin-section"` → `class="system-section admin-section"`

- [ ] **Step 5: Restore body padding via a scoped rule (only where the section relies on it)**

If any section needs interior padding (most do — they previously inherited 20px from `.panel`), add this scoped rule to each section's `<style>` block. The exact rule:

```css
.admin-section {
  padding: 20px;
}
```

Add this rule **once** in `client/admin/admin.css` (just under the deleted block) — it's a section-level rule, not a panel-primitive rule, and does not collide with `<Panel>`:

```css
.admin-section {
  padding: 20px;
}
```

This step preserves the visual layout while ending the naming collision.

- [ ] **Step 6: Run the test and all client tests to verify**

Run: `bun test tests/client/admin/sections/section-panel-class.test.ts`
Expected: PASS.

Then run the broader smoke:

```bash
bun test:client
```

Expected: All client tests green; no regressions in section render tests.

- [ ] **Step 7: Commit**

```bash
git add client/admin/admin.css \
        client/admin/sections/BillingSection.svelte \
        client/admin/sections/GroupsSection.svelte \
        client/admin/sections/IdentitiesSection.svelte \
        client/admin/sections/MemosSection.svelte \
        client/admin/sections/RemindersSection.svelte \
        client/admin/sections/SystemSection.svelte \
        tests/client/admin/sections/section-panel-class.test.ts
git commit -m "refactor(admin): kill .panel CSS-class collision, hoist padding to .admin-section"
```

---

## Task 11: Full client smoke + update audit doc

- [ ] **Step 1: Run full client suite**

```bash
bun test:client
```

Expected: All tests green.

- [ ] **Step 2: Run lint and format on touched files**

```bash
bun lint:agent-strict -- \
  client/shared/ui/Btn.svelte \
  client/shared/ui/Panel.svelte \
  client/shared/ui/KV.svelte \
  client/shared/ui/TopBar.svelte \
  client/shared/TreeView.svelte \
  client/shared/PropertiesTable.svelte
```

```bash
bun format client/shared/base.css client/admin/admin.css
```

- [ ] **Step 3: Build storybook to verify variants compile**

```bash
bun build:storybook
```

Expected: clean build with no Svelte/CSS errors.

- [ ] **Step 4: Update the audit doc**

Open `docs/design/dashboard-ui-audit.md` and mark resolved items:

- §1.2 (`.panel` collision) — RESOLVED, link to Task 10 commit.
- §1.3 (Btn hover) — RESOLVED, link to Task 1 commit.
- §1.4 (Btn.icon) — RESOLVED, link to Task 2 commit.
- §1.5 row "Panel.pad", "KV.v", "TopBar.statusRow" — RESOLVED, link to Tasks 3/4/5.
- §1.7 (TreeView, PropertiesTable) — RESOLVED, link to Tasks 8/9.
- §1.8 (status-success, truncation-banner, masked-value/masked-hint) — RESOLVED, link to Tasks 6/7.

Leave Tasks for `Input.prefix`, `Shell` API/min-height, `Seg.active`, rgba border-tokens, and section-level content rewrites (§2.x, §3.x in the audit) for a follow-up plan.

- [ ] **Step 5: Commit the doc update**

```bash
git add docs/design/dashboard-ui-audit.md
git commit -m "docs(design): mark primitives-pass items resolved in dashboard audit"
```

---

## Out of Scope (Follow-up Plans)

These remain from the audit and need their own plans because they touch larger surfaces:

- Debug page grid (§2.1), six debug panels bypassing `<Panel>` (§2.2), TurnsPanel/LogExplorer/TurnDetail/LiveContextCard rewrites (§2.5–§2.8).
- Admin Overview/Billing/Stats restoration (§3.3–§3.5) — needs MetricCard, SectionHeader, AdminGrowthPanel, AdminSurfaceMixPanel, AdminToolCallsPanel, AdminDistributionsPanel, AdminActiveSubjectsPanel, AdminStoragePanel.
- Memos/Recurring/Deferred/Identity card-list UX (§3.7–§3.8).
- Credentials masking and `required` Pill (§3.9).
- Storybook scenario wiring from `bs-scenarios-*.jsx` and missing MSW loading scenarios (§4).
