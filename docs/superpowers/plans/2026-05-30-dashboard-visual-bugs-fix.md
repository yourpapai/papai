<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Dashboard Visual Bugs Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the live Svelte dashboard visually match the JSX design prototypes in `client/assets/`, resolving 10 visual bug findings without changing backend behaviour.

**Architecture:** Four sequential PRs. PR 1 adds two new shared primitives (`MetricCard`, `DataTable`) and hardens `Bars`. PR 2 rebuilds 8 admin sections in place and adds two MSW handler families. PR 3 fixes three debug bugs (TURNS columns, SessionCard line-bleed, DebugApp story rename). PR 4 polishes (TreeView story padding, audit-doc updates). Every change preserves `data-testid` attributes and public component props so existing tests keep passing.

**Tech Stack:** Svelte 5 (runes), TypeScript strict mode, Bun test runner, Storybook v9 with `@storybook/svelte-vite`, MSW for story network mocking. CSS uses tokens from `client/shared/tokens.css` (e.g. `--fg`, `--fg3`, `--accent`, `--border`, `--hair`, `--surface`, `--font-mono`).

**Companion documents:**

- Design spec: [docs/superpowers/specs/2026-05-30-dashboard-visual-bugs-fix-design.md](../specs/2026-05-30-dashboard-visual-bugs-fix-design.md)
- Findings report: [docs/design/dashboard-visual-bugs-2026-05-30.md](../../design/dashboard-visual-bugs-2026-05-30.md)
- Prototype reference: [client/assets/bs-admin-helpers.jsx](../../../client/assets/bs-admin-helpers.jsx) (MetricCard at line 23), [client/assets/bs-design-system.jsx](../../../client/assets/bs-design-system.jsx) (token + primitive sheet)

---

## File structure

```
client/shared/ui/
  MetricCard.svelte                          [PR 1, Task 1] NEW
  MetricCard.stories.svelte                  [PR 1, Task 1] NEW
  DataTable.svelte                           [PR 1, Task 2] NEW
  DataTable.stories.svelte                   [PR 1, Task 2] NEW
  Bars.svelte                                [PR 1, Task 3] MODIFY
  Bars.stories.svelte                        [PR 1, Task 3] MODIFY

tests/client/shared/ui/
  MetricCard.test.ts                         [PR 1, Task 1] NEW
  DataTable.test.ts                          [PR 1, Task 2] NEW
  Bars.test.ts                               [PR 1, Task 3] MODIFY

client/stories/msw/
  handlers.ts                                [PR 2, Tasks 4-5] MODIFY
  scenarios.ts                               [PR 2, Task 6]   MODIFY

client/admin/sections/
  OverviewSection.svelte                     [PR 2, Task 7]  REWRITE
  StatsSection.svelte                        [PR 2, Task 8]  MODIFY
  BillingSection.svelte                      [PR 2, Task 9]  REWRITE
  MemosSection.svelte                        [PR 2, Task 10] REWRITE
  RemindersSection.svelte                    [PR 2, Task 11] REWRITE
  IdentitiesSection.svelte                   [PR 2, Task 12] REWRITE
  GroupsSection.svelte                       [PR 2, Task 13] REWRITE
  SystemSection.svelte                       [PR 2, Task 14] REWRITE
  InstancesSection.svelte                    [PR 2, Task 15] MODIFY

client/admin/components/
  StatsPanel.svelte                          [PR 2, Task 8]  REWRITE

client/debug/components/
  TurnsPanel.svelte                          [PR 3, Task 16] REWRITE
  SessionCard.svelte                         [PR 3, Task 17] MODIFY
  ../DebugApp.stories.svelte                 [PR 3, Task 18] MODIFY

client/shared/
  TreeView.stories.svelte                    [PR 4, Task 19] MODIFY

docs/design/
  dashboard-ui-audit.md                      [PR 4, Task 20] MODIFY
  dashboard-visual-bugs-2026-05-30.md        [PR 4, Task 21] MODIFY
  dashboard-prototype-vs-storybook-screenshot-plan.md  [PR 4, Task 21] MODIFY
```

---

## Conventions used in every task

**Branch naming.** Each PR uses its own branch:

- PR 1: `fix/dashboard-primitives-metriccard-datatable`
- PR 2: `fix/dashboard-admin-sections-rebuild`
- PR 3: `fix/dashboard-debug-turns-and-session`
- PR 4: `fix/dashboard-polish-treeview-and-docs`

**Test runner.** Tests under `tests/client/` run with `bun test:client`. The TDD hook pipeline triggers automatically on writes to `src/` and `client/` files — you don't run lint/format manually unless the hook surfaces issues.

**Svelte 5 imports for tests.** `mount` and `unmount` come from `svelte`, not `svelte/internal`. See `tests/client/shared/ui/Bars.test.ts` for the canonical pattern.

**Storybook story format.** Use `@storybook/addon-svelte-csf` (already configured). The pattern is `<script module>` defining `meta`, then named `<Story name="..." />` blocks. See `client/shared/ui/Bars.stories.svelte` for the canonical pattern in this repo.

**Commit message format.** Prefix with `feat:` for new components, `fix:` for bug fixes, `refactor:` for restructures with no behaviour change, `chore:` for doc/test/config tweaks. Body in present tense.

**Reference prototype always.** When writing the new Svelte component, open the matching prototype file side-by-side (e.g. `client/assets/bs-admin-helpers.jsx` for MetricCard) and match colors, font sizes, paddings exactly.

---

# PR 1 — Primitives layer

Branch: `fix/dashboard-primitives-metriccard-datatable`

After all three tasks land, run `bun storybook` and verify `shared-ui-metriccard--default`, `shared-ui-datatable--default`, and `shared-ui-bars--default` all render without error.

---

### Task 1: Add `MetricCard.svelte` primitive

**Files:**

- Create: `client/shared/ui/MetricCard.svelte`
- Create: `client/shared/ui/MetricCard.stories.svelte`
- Create: `tests/client/shared/ui/MetricCard.test.ts`

**Prototype reference:** `client/assets/bs-admin-helpers.jsx:23` (lines 23–39 define the JSX `MetricCard` helper this is being ported from).

- [ ] **Step 1: Create new branch**

```bash
git checkout -b fix/dashboard-primitives-metriccard-datatable
```

- [ ] **Step 2: Write the failing test**

Create `tests/client/shared/ui/MetricCard.test.ts` with:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import MetricCard from '../../../../client/shared/ui/MetricCard.svelte'

describe('MetricCard.svelte', () => {
  test('renders label and value', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(MetricCard, {
      target,
      props: { label: 'subjects', value: 36 },
    })
    expect(target.textContent).toContain('subjects')
    expect(target.textContent).toContain('36')
    void unmount(component)
  })

  test('renders sub line when provided', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(MetricCard, {
      target,
      props: { label: 'tokens', value: '2.41M', sub: '1.92M in · 487K out' },
    })
    expect(target.textContent).toContain('1.92M in')
    expect(target.textContent).toContain('487K out')
    void unmount(component)
  })

  test('omits sub line when undefined', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(MetricCard, {
      target,
      props: { label: 'llm calls', value: 1089 },
    })
    expect(target.querySelector('.ui-metric-card__sub')).toBeNull()
    void unmount(component)
  })

  test('applies accent color to value when provided', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(MetricCard, {
      target,
      props: { label: 'live', value: 4, accent: 'var(--accent)' },
    })
    const value = target.querySelector<HTMLElement>('.ui-metric-card__value')
    expect(value?.style.color).toBe('var(--accent)')
    void unmount(component)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test:client tests/client/shared/ui/MetricCard.test.ts`

Expected: FAIL with `Cannot find module '.../client/shared/ui/MetricCard.svelte'`.

- [ ] **Step 4: Create the component**

Create `client/shared/ui/MetricCard.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    label: string
    value: string | number | Snippet
    sub?: string
    accent?: string
  }

  let { label, value, sub, accent }: Props = $props()
</script>

<div class="ui-metric-card">
  <div class="ui-metric-card__label">{label}</div>
  <div class="ui-metric-card__value" style:color={accent ?? 'var(--fg)'}>
    {#if typeof value === 'function'}
      {@render (value as Snippet)()}
    {:else}
      {value}
    {/if}
  </div>
  {#if sub !== undefined}
    <div class="ui-metric-card__sub">{sub}</div>
  {/if}
</div>

<style>
  .ui-metric-card {
    display: flex;
    flex-direction: column;
    padding: 14px 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    min-width: 0;
  }
  .ui-metric-card__label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    color: var(--fg3);
  }
  .ui-metric-card__value {
    font-family: var(--font-mono);
    font-size: 26px;
    font-weight: 600;
    letter-spacing: -0.02em;
    margin-top: 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ui-metric-card__sub {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg3);
    margin-top: 4px;
  }
</style>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test:client tests/client/shared/ui/MetricCard.test.ts`

Expected: PASS — 4 tests pass.

- [ ] **Step 6: Add the story**

Create `client/shared/ui/MetricCard.stories.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import MetricCard from './MetricCard.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/MetricCard',
    component: MetricCard,
  })
</script>

<Story name="default">
  <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; padding: 20px; background: var(--bg);">
    <MetricCard label="subjects" value={36} sub="32 dm · 4 group" />
    <MetricCard label="llm calls" value="1,089" sub="892 main · 197 small" accent="var(--accent)" />
    <MetricCard label="tools" value="4,390" sub="4,184 ok · 206 fail" />
    <MetricCard label="tokens" value="2.41M" sub="1.92M in · 487K out" />
  </div>
</Story>

<Story name="single">
  <div style="padding: 20px; max-width: 240px; background: var(--bg);">
    <MetricCard label="active 30d" value={7} sub="of 36" />
  </div>
</Story>

<Story name="no-sub">
  <div style="padding: 20px; max-width: 240px; background: var(--bg);">
    <MetricCard label="storage" value="184 MB" />
  </div>
</Story>
```

- [ ] **Step 7: Verify story renders**

Run `bun storybook` in a separate terminal. Open `http://localhost:6006/?path=/story/shared-ui-metriccard--default`. Verify three metric cards render with 26px green numerals, caps labels, and grey sub-lines.

- [ ] **Step 8: Commit**

```bash
git add client/shared/ui/MetricCard.svelte \
        client/shared/ui/MetricCard.stories.svelte \
        tests/client/shared/ui/MetricCard.test.ts
git commit -m "$(cat <<'EOF'
feat(shared/ui): add MetricCard primitive

Ports the MetricCard helper from client/assets/bs-admin-helpers.jsx
to a reusable Svelte primitive. Caps label, 26px hero numeral,
optional sub line, optional accent color. Used by admin sections
in PR 2 to replace ad-hoc KV chrome.
EOF
)"
```

---

### Task 2: Add `DataTable.svelte` primitive

**Files:**

- Create: `client/shared/ui/DataTable.svelte`
- Create: `client/shared/ui/DataTable.stories.svelte`
- Create: `tests/client/shared/ui/DataTable.test.ts`

**Prototype reference:** `client/assets/bs-design-system.jsx` "TABLE · DENSE" section and `client/assets/bs-admin-billing-table.jsx`.

- [ ] **Step 1: Write the failing test**

Create `tests/client/shared/ui/DataTable.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import DataTable from '../../../../client/shared/ui/DataTable.svelte'

interface Row {
  id: string
  name: string
  count: number
}

const columns = [
  { key: 'id' as const, label: 'ID' },
  { key: 'name' as const, label: 'Name' },
  { key: 'count' as const, label: 'Count', align: 'right' as const },
]

describe('DataTable.svelte', () => {
  test('renders one tr per row plus header row', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const rows: Row[] = [
      { id: 'a', name: 'alpha', count: 1 },
      { id: 'b', name: 'beta', count: 2 },
    ]
    const component = mount(DataTable, { target, props: { columns, rows } })
    expect(target.querySelectorAll('thead tr').length).toBe(1)
    expect(target.querySelectorAll('tbody tr').length).toBe(2)
    void unmount(component)
  })

  test('renders column labels in th', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(DataTable, { target, props: { columns, rows: [] } })
    const ths = target.querySelectorAll('thead th')
    expect(ths[0]?.textContent?.trim()).toBe('ID')
    expect(ths[1]?.textContent?.trim()).toBe('Name')
    expect(ths[2]?.textContent?.trim()).toBe('Count')
    void unmount(component)
  })

  test('renders cell values', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const rows: Row[] = [{ id: 'x1', name: 'xenon', count: 42 }]
    const component = mount(DataTable, { target, props: { columns, rows } })
    expect(target.textContent).toContain('xenon')
    expect(target.textContent).toContain('42')
    void unmount(component)
  })

  test('fires onRowClick when row clicked', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const clicks: Row[] = []
    const rows: Row[] = [{ id: 'r1', name: 'one', count: 1 }]
    const component = mount(DataTable, {
      target,
      props: { columns, rows, onRowClick: (row: Row) => clicks.push(row) },
    })
    const tr = target.querySelector<HTMLTableRowElement>('tbody tr')
    tr?.click()
    expect(clicks).toEqual([{ id: 'r1', name: 'one', count: 1 }])
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client tests/client/shared/ui/DataTable.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Create the component**

Create `client/shared/ui/DataTable.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts" generics="Row extends Record<string, unknown>">
  import type { Snippet } from 'svelte'

  type Align = 'left' | 'right' | 'center'

  interface Column<R extends Record<string, unknown>> {
    key: keyof R & string
    label: string
    align?: Align
    width?: string
  }

  interface Props {
    columns: Column<Row>[]
    rows: Row[]
    cell?: Snippet<[Row, Column<Row>]>
    onRowClick?: (row: Row) => void
    selectedKey?: string
    rowKey?: keyof Row & string
    empty?: Snippet
  }

  let { columns, rows, cell, onRowClick, selectedKey, rowKey, empty }: Props = $props()

  function clickRow(row: Row): (event: MouseEvent) => void {
    return (event: MouseEvent) => {
      // Only fire row-click when click target is a td (not a child link/button).
      const target = event.target
      if (target instanceof HTMLElement && target.closest('a, button')) return
      onRowClick?.(row)
    }
  }
</script>

<table class="ui-datatable">
  <thead>
    <tr>
      {#each columns as col (col.key)}
        <th
          class="ui-datatable__th ui-datatable__th--{col.align ?? 'left'}"
          style:width={col.width ?? null}>{col.label}</th>
      {/each}
    </tr>
  </thead>
  <tbody>
    {#if rows.length === 0}
      {#if empty}
        <tr>
          <td colspan={columns.length} class="ui-datatable__empty">
            {@render empty()}
          </td>
        </tr>
      {/if}
    {:else}
      {#each rows as row, i (rowKey ? row[rowKey] : i)}
        {@const key = rowKey ? String(row[rowKey]) : String(i)}
        <tr
          class="ui-datatable__tr"
          class:ui-datatable__tr--selected={selectedKey !== undefined && selectedKey === key}
          class:ui-datatable__tr--clickable={onRowClick !== undefined}
          onclick={onRowClick ? clickRow(row) : null}>
          {#each columns as col (col.key)}
            <td class="ui-datatable__td ui-datatable__td--{col.align ?? 'left'}">
              {#if cell}
                {@render cell(row, col)}
              {:else}
                {String(row[col.key] ?? '')}
              {/if}
            </td>
          {/each}
        </tr>
      {/each}
    {/if}
  </tbody>
</table>

<style>
  .ui-datatable {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-mono);
  }
  .ui-datatable__th {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--fg3);
    padding: 8px 12px;
    border-bottom: 1px solid var(--hair);
    text-align: left;
  }
  .ui-datatable__th--right {
    text-align: right;
  }
  .ui-datatable__th--center {
    text-align: center;
  }
  .ui-datatable__td {
    font-size: 13px;
    color: var(--fg);
    padding: 10px 12px;
    border-bottom: 1px solid var(--hair);
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ui-datatable__td--right {
    text-align: right;
  }
  .ui-datatable__td--center {
    text-align: center;
  }
  .ui-datatable__tr--clickable {
    cursor: pointer;
  }
  .ui-datatable__tr--clickable:hover {
    background: rgba(255, 255, 255, 0.02);
  }
  .ui-datatable__tr--selected {
    background: rgba(93, 217, 122, 0.06);
  }
  .ui-datatable__empty {
    padding: 24px 12px;
    text-align: center;
    color: var(--fg3);
    font-size: 12px;
  }
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test:client tests/client/shared/ui/DataTable.test.ts`

Expected: PASS — 4 tests pass.

- [ ] **Step 5: Add the story**

Create `client/shared/ui/DataTable.stories.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'

  import DataTable from './DataTable.svelte'

  const { Story } = defineMeta({
    title: 'shared/ui/DataTable',
    component: DataTable,
  })

  interface Row {
    subject: string
    id: string
    type: 'dm' | 'group'
    tokIn: number
    tokOut: number
  }

  const columns = [
    { key: 'subject', label: 'Subject' },
    { key: 'id', label: 'ID' },
    { key: 'type', label: 'Type' },
    { key: 'tokIn', label: 'Tok in', align: 'right' as const },
    { key: 'tokOut', label: 'Tok out', align: 'right' as const },
  ]

  const rows: Row[] = [
    { subject: 'dl@papai', id: 'u_8f4a92', type: 'dm', tokIn: 412811, tokOut: 84220 },
    { subject: 'priya.r', id: 'u_a02f17', type: 'dm', tokIn: 287402, tokOut: 61104 },
    { subject: 'eng-stand', id: 'g_eng-stand', type: 'group', tokIn: 198220, tokOut: 42811 },
  ]
</script>

<Story name="default">
  <div style="padding: 20px; background: var(--bg); width: 720px;">
    <DataTable {columns} {rows} />
  </div>
</Story>

<Story name="empty">
  {#snippet emptyState()}<span>No data yet.</span>{/snippet}
  <div style="padding: 20px; background: var(--bg); width: 720px;">
    <DataTable {columns} rows={[]} empty={emptyState} />
  </div>
</Story>

<Story name="clickable-with-selection">
  <div style="padding: 20px; background: var(--bg); width: 720px;">
    <DataTable
      {columns}
      {rows}
      rowKey="id"
      selectedKey="u_8f4a92"
      onRowClick={(row) => console.log('clicked', row)} />
  </div>
</Story>
```

- [ ] **Step 6: Verify story renders**

Open `http://localhost:6006/?path=/story/shared-ui-datatable--default`. Verify caps headers (10px, grey), 13px rows, hairline separators, right-aligned numeric cols.

- [ ] **Step 7: Commit**

```bash
git add client/shared/ui/DataTable.svelte \
        client/shared/ui/DataTable.stories.svelte \
        tests/client/shared/ui/DataTable.test.ts
git commit -m "$(cat <<'EOF'
feat(shared/ui): add DataTable primitive

Dense-row table matching the prototype's design-system table:
caps th, 13px td, hairline borders, no zebra, optional row click
and selection highlight, custom cell snippet support, empty-state
snippet. Replaces ad-hoc <table class="admin-table"> usage in
admin sections.
EOF
)"
```

---

### Task 3: Harden `Bars.svelte` for empty/undefined data

**Files:**

- Modify: `client/shared/ui/Bars.svelte`
- Modify: `tests/client/shared/ui/Bars.test.ts`
- Modify: `client/shared/ui/Bars.stories.svelte`

- [ ] **Step 1: Write the failing test**

Append to `tests/client/shared/ui/Bars.test.ts` (after the existing test block, inside the same `describe`):

```ts
test('renders empty svg for undefined data', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const component = mount(Bars, { target, props: { data: undefined, width: 200, height: 40 } })
  expect(target.querySelector('svg')).not.toBeNull()
  expect(target.querySelectorAll('rect').length).toBe(0)
  void unmount(component)
})

test('renders one rect for single-value data', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const component = mount(Bars, { target, props: { data: [5], width: 200, height: 40 } })
  expect(target.querySelectorAll('rect').length).toBe(1)
  void unmount(component)
})

test('renders flat baseline for all-zero data', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const component = mount(Bars, { target, props: { data: [0, 0, 0, 0], width: 200, height: 40 } })
  expect(target.querySelectorAll('rect').length).toBe(4)
  void unmount(component)
})

test('svg uses viewBox when width is omitted', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const component = mount(Bars, { target, props: { data: [1, 2, 3] } })
  const svg = target.querySelector('svg')
  expect(svg?.getAttribute('viewBox')).not.toBeNull()
  void unmount(component)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test:client tests/client/shared/ui/Bars.test.ts`

Expected: 4 new tests FAIL — `data` is required, no viewBox.

- [ ] **Step 3: Update the component**

Replace `client/shared/ui/Bars.svelte` with:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  interface Props {
    data: number[] | undefined
    width?: number
    height?: number
    color?: string
  }

  let { data, width, height = 56, color = 'var(--accent)' }: Props = $props()

  const safeData = $derived(data ?? [])
  const max = $derived(Math.max(...safeData, 1))
  const intrinsicW = $derived(width ?? Math.max(safeData.length * 10, 100))
  const bw = $derived(safeData.length > 0 ? intrinsicW / safeData.length : 0)
</script>

{#if width !== undefined}
  <svg {width} {height} class="ui-bars" aria-hidden="true">
    {#each safeData as v, i (i)}
      {@const h = (v / max) * (height - 4)}
      <rect x={i * bw + 1} y={height - h} width={bw - 2} height={h} fill={color} fill-opacity="0.85" />
    {/each}
  </svg>
{:else}
  <svg viewBox="0 0 {intrinsicW} {height}" preserveAspectRatio="none" class="ui-bars ui-bars--fluid" aria-hidden="true">
    {#each safeData as v, i (i)}
      {@const h = (v / max) * (height - 4)}
      <rect x={i * bw + 1} y={height - h} width={bw - 2} height={h} fill={color} fill-opacity="0.85" />
    {/each}
  </svg>
{/if}

<style>
  .ui-bars {
    display: block;
  }
  .ui-bars--fluid {
    width: 100%;
    height: auto;
  }
</style>
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `bun test:client tests/client/shared/ui/Bars.test.ts`

Expected: PASS — all tests pass (existing 1 + new 4 = 5 tests).

- [ ] **Step 5: Add edge-case stories**

Append to `client/shared/ui/Bars.stories.svelte` (inside the existing module, alongside existing Story blocks):

```svelte
<Story name="empty-edge">
  <div style="padding: 20px; background: var(--bg);">
    <Bars data={[]} width={200} height={40} />
  </div>
</Story>

<Story name="single-bar">
  <div style="padding: 20px; background: var(--bg);">
    <Bars data={[5]} width={200} height={40} />
  </div>
</Story>

<Story name="flat">
  <div style="padding: 20px; background: var(--bg);">
    <Bars data={[0, 0, 0, 0]} width={200} height={40} />
  </div>
</Story>

<Story name="fluid">
  <div style="padding: 20px; background: var(--bg); width: 600px;">
    <Bars data={[3, 7, 2, 9, 5, 11, 6, 4]} height={56} />
  </div>
</Story>
```

- [ ] **Step 6: Commit**

```bash
git add client/shared/ui/Bars.svelte \
        client/shared/ui/Bars.stories.svelte \
        tests/client/shared/ui/Bars.test.ts
git commit -m "$(cat <<'EOF'
fix(shared/ui): harden Bars against undefined and degenerate data

- Accept data: number[] | undefined; treat undefined as []
- Switch to viewBox-based SVG when width is omitted, so the chart
  fluidly fills its container instead of staying at a fixed 240px
- Add aria-hidden="true" since the chart is purely decorative
- New stories: empty-edge, single-bar, flat, fluid

Fixes the OverviewSection "one solid green rectangle" symptom
documented in docs/design/dashboard-visual-bugs-2026-05-30.md §2.1.
EOF
)"
```

- [ ] **Step 7: Open PR 1**

```bash
git push -u origin fix/dashboard-primitives-metriccard-datatable
gh pr create --title "Dashboard primitives: MetricCard, DataTable, Bars hardening" \
  --body "$(cat <<'EOF'
## Summary

- New `MetricCard.svelte` primitive (port of prototype `bs-admin-helpers.jsx:23`)
- New `DataTable.svelte` primitive (dense-row table from prototype design-system page)
- `Bars.svelte` accepts undefined data and supports fluid (viewBox) rendering

PR 1 of 4 in the dashboard visual bugs fix series. See
[docs/superpowers/specs/2026-05-30-dashboard-visual-bugs-fix-design.md](docs/superpowers/specs/2026-05-30-dashboard-visual-bugs-fix-design.md).

## Test plan

- [ ] `bun test:client tests/client/shared/ui/MetricCard.test.ts` passes
- [ ] `bun test:client tests/client/shared/ui/DataTable.test.ts` passes
- [ ] `bun test:client tests/client/shared/ui/Bars.test.ts` passes
- [ ] Stories render at `shared-ui-metriccard--default`, `shared-ui-datatable--default`, `shared-ui-bars--fluid`
EOF
)"
```

Wait for PR 1 to merge before proceeding to PR 2.

---

# PR 2 — Admin section rebuilds + MSW fixtures

Branch: `fix/dashboard-admin-sections-rebuild` (branch off master after PR 1 merges).

After all tasks land, `bun storybook` → `admin-adminapp--default` shows no 404 banners and every section has `<Panel>` chrome.

---

### Task 4: Add `pluginConfigHandlers` MSW family

**Files:**

- Modify: `client/stories/msw/handlers.ts`

**Schema reference:** `client/admin/plugin-config-fetcher-schemas.ts` (lines 8–28).

- [ ] **Step 1: Create new branch off latest master**

```bash
git checkout master && git pull
git checkout -b fix/dashboard-admin-sections-rebuild
```

- [ ] **Step 2: Append the handler family to `handlers.ts`**

Open `client/stories/msw/handlers.ts`. After the last existing `export const ...Handlers: HandlerFamily = {…}` block, append:

```ts
const pluginConfigSnapshot = {
  plugins: [
    {
      pluginId: 'task-provider-kaneo',
      keys: [
        { key: 'credential', label: 'Credential', value: '****', sensitive: true, required: true },
        { key: 'workspaceId', label: 'Workspace ID', value: 'ws_4f2a', sensitive: false, required: true },
      ],
    },
    {
      pluginId: 'task-provider-youtrack',
      keys: [{ key: 'token', label: 'API token', value: null, sensitive: true, required: true }],
    },
    {
      pluginId: 'hello-world',
      keys: [],
    },
  ],
}

export const pluginConfigHandlers: HandlerFamily = {
  populated: [
    http.get('/admin/plugin-config', () => HttpResponse.json(pluginConfigSnapshot)),
    http.post('/admin/plugin-config', () =>
      HttpResponse.json({ ok: true, pluginId: 'task-provider-kaneo', key: 'credential', updatedAt: 1717000000000 }),
    ),
  ],
  empty: [
    http.get('/admin/plugin-config', () => HttpResponse.json({ plugins: [] })),
    http.post('/admin/plugin-config', () => HttpResponse.json({ ok: true, pluginId: '', key: '', updatedAt: 0 })),
  ],
  error: [
    http.get('/admin/plugin-config', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
    http.post('/admin/plugin-config', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
  ],
  loading: [
    http.get('/admin/plugin-config', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(pluginConfigSnapshot)
    }),
  ],
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `bun typecheck`

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add client/stories/msw/handlers.ts
git commit -m "feat(stories/msw): add pluginConfigHandlers family

Adds populated/empty/error/loading variants for GET/POST
/admin/plugin-config. Fixes the '404 request failed' banner
visible in admin-adminapp stories."
```

---

### Task 5: Add `instancesHandlers` MSW family

**Files:**

- Modify: `client/stories/msw/handlers.ts`

**Schema reference:** `client/admin/instance-fetcher-schemas.ts` (lines 7–80+).

- [ ] **Step 1: Append the handler family to `handlers.ts`**

Open `client/stories/msw/handlers.ts`. After the `pluginConfigHandlers` block from Task 4, append:

```ts
const platformInstancesSnapshot = {
  instances: [
    {
      id: 'pi-telegram-main',
      type: 'telegram',
      config: { bot_token: '****' },
      status: 'active',
      createdAt: '2026-04-01T00:00:00.000Z',
    },
  ],
}

const taskInstancesSnapshot = {
  instances: [
    {
      id: 'ti-kaneo-main',
      type: 'task-provider-kaneo',
      config: { client_url: 'https://kaneo.local' },
      status: 'active',
      createdAt: '2026-04-01T00:00:00.000Z',
      referencingContextCount: 7,
      unresolvedReason: null,
    },
  ],
}

const adminsSnapshot = {
  admins: [{ userId: 'u_admin1', platformInstanceId: 'pi-telegram-main', createdAt: '2026-04-01T00:00:00.000Z' }],
}

const platformProviderTypes = {
  types: [
    {
      type: 'telegram',
      displayName: 'Telegram',
      instanceConfigSchema: [{ key: 'bot_token', label: 'Bot token', required: true, sensitive: true }],
      contextConfigSchema: [],
      capabilities: ['groupMessages'],
      traits: { observedGroupMessages: 'all', maxMessageLength: 4096 },
      source: 'builtin',
    },
  ],
}

const taskProviderTypes = {
  types: [
    {
      type: 'task-provider-kaneo',
      displayName: 'Kaneo',
      instanceConfigSchema: [{ key: 'client_url', label: 'Client URL', required: true, sensitive: false }],
      contextConfigSchema: [{ key: 'credential', label: 'Credential', required: true, sensitive: true }],
      capabilities: ['createTask', 'listTasks'],
      traits: [],
      source: { plugin: 'task-provider-kaneo' },
    },
  ],
}

export const instancesHandlers: HandlerFamily = {
  populated: [
    http.get('/api/platform-instances', () => HttpResponse.json(platformInstancesSnapshot)),
    http.get('/api/task-instances', () => HttpResponse.json(taskInstancesSnapshot)),
    http.get('/api/admins', () => HttpResponse.json(adminsSnapshot)),
    http.get('/api/platform-provider-types', () => HttpResponse.json(platformProviderTypes)),
    http.get('/api/task-provider-types', () => HttpResponse.json(taskProviderTypes)),
    http.post('/api/platform-instances', () => HttpResponse.json({ ok: true }, { status: 201 })),
    http.post('/api/task-instances', () => HttpResponse.json({ ok: true }, { status: 201 })),
    http.post('/api/platform-instances/apply', () =>
      HttpResponse.json({ applied: 0, started: [], stopped: [], removed: [] }),
    ),
  ],
  empty: [
    http.get('/api/platform-instances', () => HttpResponse.json({ instances: [] })),
    http.get('/api/task-instances', () => HttpResponse.json({ instances: [] })),
    http.get('/api/admins', () => HttpResponse.json({ admins: [] })),
    http.get('/api/platform-provider-types', () => HttpResponse.json({ types: [] })),
    http.get('/api/task-provider-types', () => HttpResponse.json({ types: [] })),
  ],
  error: [
    http.get('/api/platform-instances', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
    http.get('/api/task-instances', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
    http.get('/api/admins', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
    http.get('/api/platform-provider-types', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
    http.get('/api/task-provider-types', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
  ],
  loading: [
    http.get('/api/platform-instances', async () => {
      await delay(NEVER_RESOLVE_MS)
      return HttpResponse.json(platformInstancesSnapshot)
    }),
  ],
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `bun typecheck`

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add client/stories/msw/handlers.ts
git commit -m "feat(stories/msw): add instancesHandlers family

Adds populated/empty/error/loading variants for the
/api/platform-instances, /api/task-instances, /api/admins,
and provider-types endpoints. Fixes the '404 request failed'
banner in InstancesSection inside admin-adminapp stories."
```

---

### Task 6: Wire new handler families into `admin-*` scenarios

**Files:**

- Modify: `client/stories/msw/scenarios.ts`

- [ ] **Step 1: Update imports and scenario maps**

Replace the contents of `client/stories/msw/scenarios.ts` with:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { HttpHandler } from 'msw'

import { adminHandlers, billingHandlers, instancesHandlers, pluginConfigHandlers, statsHandlers } from './handlers.js'

export const scenarios = {
  'admin-populated': [
    ...adminHandlers.populated,
    ...billingHandlers.populated,
    ...statsHandlers.populated,
    ...pluginConfigHandlers.populated,
    ...instancesHandlers.populated,
  ],
  'admin-empty': [
    ...adminHandlers.empty,
    ...billingHandlers.empty,
    ...statsHandlers.empty,
    ...pluginConfigHandlers.empty,
    ...instancesHandlers.empty,
  ],
  'admin-error': [
    ...adminHandlers.error,
    ...billingHandlers.error,
    ...statsHandlers.error,
    ...pluginConfigHandlers.error,
    ...instancesHandlers.error,
  ],
  'billing-populated': [...billingHandlers.populated],
  'billing-empty': [...billingHandlers.empty],
  'billing-error': [...billingHandlers.error],
  'billing-loading': [...billingHandlers.loading],
  'stats-populated': [...statsHandlers.populated],
  'stats-empty': [...statsHandlers.empty],
  'stats-error': [...statsHandlers.error],
  'plugin-config-populated': [...pluginConfigHandlers.populated],
  'plugin-config-empty': [...pluginConfigHandlers.empty],
  'plugin-config-error': [...pluginConfigHandlers.error],
  'instances-populated': [...instancesHandlers.populated],
  'instances-empty': [...instancesHandlers.empty],
  'instances-error': [...instancesHandlers.error],
} satisfies Record<string, readonly HttpHandler[]>

export type ScenarioName = keyof typeof scenarios
```

- [ ] **Step 2: Verify TypeScript and tests**

Run: `bun typecheck && bun test:client`

Expected: no new errors, all existing tests pass.

- [ ] **Step 3: Verify in Storybook**

In a separate terminal: `bun storybook`. Open `http://localhost:6006/iframe.html?id=admin-adminapp--default&viewMode=story`. The "request failed with status 404" banners should be gone (sections will still look broken until Tasks 7+; this task verifies only that the network mocks fire).

- [ ] **Step 4: Commit**

```bash
git add client/stories/msw/scenarios.ts
git commit -m "feat(stories/msw): wire plugin-config and instances into admin scenarios

The admin-populated / admin-empty / admin-error scenarios now
spread the pluginConfigHandlers and instancesHandlers families.
Removes 404 banners from admin-adminapp stories."
```

---

### Task 7: Rebuild `OverviewSection.svelte`

**Files:**

- Modify: `client/admin/sections/OverviewSection.svelte`
- Verify: `tests/client/admin/sections/OverviewSection.test.ts` keeps passing.

**Prototype reference:** `client/assets/bs-admin-overview-metrics.jsx`, `bs-admin-growth.jsx`, `bs-admin-surface-mix.jsx`.

- [ ] **Step 1: Read existing tests to identify required `data-testid`s**

Run: `grep -n "data-testid\|getByTestId\|querySelector" tests/client/admin/sections/OverviewSection.test.ts`

Note every `data-testid` referenced. The rewrite must preserve those on equivalent elements.

- [ ] **Step 2: Replace the component**

Replace `client/admin/sections/OverviewSection.svelte` with:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Bars from '../../shared/ui/Bars.svelte'
  import MetricCard from '../../shared/ui/MetricCard.svelte'
  import Panel from '../../shared/ui/Panel.svelte'
  import Spark from '../../shared/ui/Spark.svelte'

  import { adminGlobals } from '../global-stats.svelte.js'

  const subjectsTotal = $derived(
    adminGlobals.data?.subjects === undefined
      ? '—'
      : String(adminGlobals.data.subjects.dmTotal + adminGlobals.data.subjects.groupTotal),
  )
  const subjectsSub = $derived(
    adminGlobals.data?.subjects === undefined
      ? undefined
      : `${adminGlobals.data.subjects.dmTotal} dm · ${adminGlobals.data.subjects.groupTotal} group`,
  )

  const llmTotal = $derived(
    adminGlobals.data?.llmUsage === undefined
      ? '—'
      : adminGlobals.data.llmUsage.totalCalls.toLocaleString(),
  )
  const llmSub = $derived(
    adminGlobals.data?.llmUsage === undefined
      ? undefined
      : `${adminGlobals.data.llmUsage.mainCalls} main · ${adminGlobals.data.llmUsage.smallCalls} small`,
  )

  const toolTotals = $derived.by(() => {
    const tools = adminGlobals.data?.toolMix?.topTools
    if (tools === undefined) return null
    let total = 0
    let ok = 0
    for (const t of tools) {
      total += t.count
      ok += Math.round(t.count * t.successRate)
    }
    return { total, ok, fail: total - ok }
  })
  const toolTotal = $derived(toolTotals === null ? '—' : toolTotals.total.toLocaleString())
  const toolSub = $derived(toolTotals === null ? undefined : `${toolTotals.ok} ok · ${toolTotals.fail} fail`)

  function formatBytes(n: number): string {
    if (n < 1_000) return `${n} B`
    if (n < 1_000_000) return `${(n / 1_000).toFixed(1)} KB`
    if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)} MB`
    return `${(n / 1_000_000_000).toFixed(1)} GB`
  }

  const storageTotal = $derived(
    adminGlobals.data?.storage === undefined
      ? '—'
      : formatBytes(
          adminGlobals.data.storage.sqliteBytes + adminGlobals.data.storage.s3AttachmentBytes,
        ),
  )
  const storageSub = $derived(
    adminGlobals.data?.storage === undefined
      ? undefined
      : `${formatBytes(adminGlobals.data.storage.sqliteBytes)} sqlite · ${formatBytes(adminGlobals.data.storage.s3AttachmentBytes)} s3`,
  )

  // Tokens are not always present; show placeholder if unavailable.
  const tokenTotal = $derived('—')
  const tokenSub = $derived<string | undefined>(undefined)

  const sparkData = $derived(
    adminGlobals.data?.subjects?.growthLast30d?.map((p) => p.dmAdded + p.groupAdded) ?? [],
  )

  const barsData = $derived.by(() => {
    const tools = adminGlobals.data?.toolMix?.topTools
    if (tools === undefined) return []
    return tools.slice(0, 8).map((t) => Math.round(t.count * t.successRate))
  })

  interface SurfaceMixRow {
    label: string
    n: number
    total: number
  }

  const surfaceMix = $derived.by<SurfaceMixRow[]>(() => {
    const sm = adminGlobals.data?.surfaceMix
    const subj = adminGlobals.data?.subjects
    if (sm === undefined || subj === undefined) return []
    const total = subj.dmTotal + subj.groupTotal
    return [
      { label: 'memos', n: sm.subjectsWithMemos, total },
      { label: 'recurring', n: sm.subjectsWithRecurring, total },
      { label: 'deferred', n: sm.subjectsWithDeferred, total },
      { label: 'instructions', n: sm.subjectsWithInstructions, total },
    ]
  })
</script>

<section id="overview" class="admin-section">
  <Panel title="overview">
    {#snippet body()}
      <div class="overview__kpis" data-testid="admin-overview-kpis">
        <MetricCard label="subjects" value={subjectsTotal} sub={subjectsSub} />
        <MetricCard label="llm calls" value={llmTotal} sub={llmSub} accent="var(--accent)" />
        <MetricCard label="tools" value={toolTotal} sub={toolSub} />
        <MetricCard label="tokens" value={tokenTotal} sub={tokenSub} />
        <MetricCard label="storage" value={storageTotal} sub={storageSub} />
      </div>
      <div class="overview__charts">
        <Panel title="subject growth · 30d">
          {#snippet body()}
            <div class="overview__chart-body">
              <Spark data={sparkData} />
              <div class="overview__bars-wrap"><Bars data={barsData} height={56} /></div>
            </div>
          {/snippet}
        </Panel>
        <Panel title="surface mix">
          {#snippet body()}
            <div class="overview__mix">
              {#each surfaceMix as row (row.label)}
                <div class="overview__mix-row">
                  <span class="overview__mix-label">{row.label}</span>
                  <div class="overview__mix-bar">
                    <div
                      class="overview__mix-fill"
                      style:width={row.total === 0 ? '0%' : `${Math.min(100, (row.n / row.total) * 100)}%`}>
                    </div>
                  </div>
                  <span class="overview__mix-count">{row.n}/{row.total}</span>
                </div>
              {/each}
            </div>
          {/snippet}
        </Panel>
      </div>
    {/snippet}
  </Panel>
</section>

<style>
  .admin-section {
    scroll-margin-top: 96px;
  }
  .overview__kpis {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 8px;
    padding: 12px;
  }
  .overview__charts {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 8px;
    padding: 0 12px 12px;
  }
  .overview__chart-body {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .overview__bars-wrap {
    width: 100%;
  }
  .overview__mix {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .overview__mix-row {
    display: grid;
    grid-template-columns: 96px 1fr 60px;
    align-items: center;
    gap: 10px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg);
  }
  .overview__mix-label {
    color: var(--fg3);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .overview__mix-bar {
    height: 6px;
    background: var(--inset);
    overflow: hidden;
  }
  .overview__mix-fill {
    height: 100%;
    background: var(--accent);
    opacity: 0.85;
  }
  .overview__mix-count {
    text-align: right;
    color: var(--fg3);
  }
</style>
```

- [ ] **Step 3: Run tests**

Run: `bun test:client tests/client/admin/sections/OverviewSection.test.ts`

Expected: PASS. If a test fails due to a removed selector, update the test to point at the new equivalent — don't reintroduce stale markup.

- [ ] **Step 4: Verify in Storybook**

Open `http://localhost:6006/?path=/story/admin-sections-overviewsection--populated`. Expect 5 metric cards in one row + a charts row below with bars + a SURFACE MIX panel.

- [ ] **Step 5: Commit**

```bash
git add client/admin/sections/OverviewSection.svelte
git commit -m "fix(admin/overview): rebuild section with MetricCard chrome

Replaces inline KV row + broken charts with 5 MetricCards + a
SUBJECT GROWTH panel (Bars) + a SURFACE MIX panel (horizontal
progress rows). Matches client/assets/bs-admin-overview-metrics.jsx
prototype. Resolves §2.1 of the visual-bugs report."
```

---

### Task 8: Rebuild `StatsPanel.svelte` and `StatsSection.svelte`

**Files:**

- Modify: `client/admin/components/StatsPanel.svelte`
- Verify: `tests/client/admin/sections/StatsSection.test.ts` keeps passing (or update).

**Prototype reference:** `client/assets/bs-admin-distributions.jsx`, `bs-admin-storage.jsx`, `bs-admin-active-subjects.jsx`.

- [ ] **Step 1: Replace `StatsPanel.svelte`**

Replace `client/admin/components/StatsPanel.svelte` with:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import type { GlobalStats, StatsWindow } from '../../shared/api-types.js'
  import Btn from '../../shared/ui/Btn.svelte'
  import DataTable from '../../shared/ui/DataTable.svelte'
  import MetricCard from '../../shared/ui/MetricCard.svelte'
  import Panel from '../../shared/ui/Panel.svelte'
  import Seg from '../../shared/ui/Seg.svelte'
  import { fetchStatsGlobal } from '../fetchers.js'

  interface StatsState {
    statsWindow: StatsWindow
    globalStats: GlobalStats | null
  }

  interface Props {
    dashboard: StatsState
  }

  let { dashboard }: Props = $props()

  const WINDOWS: StatsWindow[] = ['1d', '7d', '30d', 'all']

  let loading = $state(false)
  let error: string | null = $state(null)

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  async function loadStats(): Promise<void> {
    loading = true
    error = null
    try {
      dashboard.globalStats = await fetchStatsGlobal(dashboard.statsWindow)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  function onWindowChange(next: string): void {
    if (next === '1d' || next === '7d' || next === '30d' || next === 'all') {
      dashboard.statsWindow = next
      void loadStats()
    }
  }

  $effect(() => {
    untrack(() => {
      void loadStats()
    })
  })

  interface DistRow {
    metric: string
    n: number
    min: number
    p50: number
    p90: number
    p99: number
    max: number
    mean: number
  }

  const distRows = $derived.by<DistRow[]>(() => {
    const g = dashboard.globalStats
    if (g === null) return []
    const d = g.distributions
    return [
      {
        metric: 'memos / subject',
        n: d.memosPerSubject.count,
        min: d.memosPerSubject.min,
        p50: d.memosPerSubject.p50,
        p90: d.memosPerSubject.p90,
        p99: d.memosPerSubject.p99,
        max: d.memosPerSubject.max,
        mean: Number(d.memosPerSubject.mean.toFixed(2)),
      },
    ]
  })

  const distColumns = [
    { key: 'metric' as const, label: '' },
    { key: 'n' as const, label: 'N', align: 'right' as const },
    { key: 'min' as const, label: 'Min', align: 'right' as const },
    { key: 'p50' as const, label: 'P50', align: 'right' as const },
    { key: 'p90' as const, label: 'P90', align: 'right' as const },
    { key: 'p99' as const, label: 'P99', align: 'right' as const },
    { key: 'max' as const, label: 'Max', align: 'right' as const },
    { key: 'mean' as const, label: 'Mean', align: 'right' as const },
  ]
</script>

<div class="stats-panel" data-testid="stats-panel">
  <header class="stats-panel__header">
    <div>
      <p class="eyebrow">Anonymous analytics</p>
      <h2 data-testid="admin-section-title">Stats</h2>
    </div>
    <div class="stats-panel__controls">
      <Seg
        options={[...WINDOWS]}
        value={dashboard.statsWindow}
        onChange={onWindowChange} />
      <Btn variant="secondary" size="sm" onClick={() => { void loadStats() }} disabled={loading}>
        {#snippet children()}{loading ? 'Refreshing…' : 'Refresh'}{/snippet}
      </Btn>
      {#if error !== null}
        <span class="status-error" data-testid="stats-error">{error}</span>
      {/if}
    </div>
  </header>

  {#if dashboard.globalStats !== null}
    {@const g = dashboard.globalStats}
    <div class="stats-panel__grid">
      <Panel title="active subjects">
        {#snippet body()}
          <div class="stats-panel__metrics">
            <MetricCard label="1d" value={g.active.activeIn1d} sub={`of ${g.subjects.dmTotal + g.subjects.groupTotal}`} />
            <MetricCard label="7d" value={g.active.activeIn7d} sub={`of ${g.subjects.dmTotal + g.subjects.groupTotal}`} />
            <MetricCard label="30d" value={g.active.activeIn30d} sub={`of ${g.subjects.dmTotal + g.subjects.groupTotal}`} />
          </div>
        {/snippet}
      </Panel>

      <Panel title="storage">
        {#snippet body()}
          <div class="stats-panel__metrics">
            <MetricCard label="sqlite" value={formatBytes(g.storage.sqliteBytes)} />
            <MetricCard label="s3 attachments" value={formatBytes(g.storage.s3AttachmentBytes)} />
          </div>
        {/snippet}
      </Panel>
    </div>

    <Panel title="distributions">
      {#snippet body()}
        <DataTable columns={distColumns} rows={distRows} rowKey="metric" />
      {/snippet}
    </Panel>
  {:else if !loading && error === null}
    <span class="placeholder">No stats loaded yet</span>
  {/if}
</div>

<style>
  .stats-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .stats-panel__header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
  }
  .eyebrow {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    color: var(--fg3);
  }
  .stats-panel__header h2 {
    margin: 4px 0 0;
    font-family: var(--font-mono);
    font-size: 18px;
    font-weight: 600;
    color: var(--fg);
  }
  .stats-panel__controls {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .stats-panel__grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .stats-panel__metrics {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 8px;
    padding: 12px;
  }
  .placeholder {
    padding: 24px;
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 12px;
    text-align: center;
  }
  .status-error {
    color: var(--danger);
    font-family: var(--font-mono);
    font-size: 11px;
  }
</style>
```

- [ ] **Step 2: Run tests**

Run: `bun test:client tests/client/admin/sections/StatsSection.test.ts tests/client/admin/components/`

Expected: PASS, or update test selectors. The `data-testid="stats-window-select"` testid is replaced by Seg's interface; if any existing test inspects that testid, update it to drive Seg directly (find the `.ui-seg__btn[textContent="30d"]` and click).

- [ ] **Step 3: Verify in Storybook**

Open `http://localhost:6006/?path=/story/admin-sections-statssection--populated`. Expect: header with Seg + Refresh button, then two side-by-side panels (ACTIVE SUBJECTS + STORAGE), then DISTRIBUTIONS panel with table.

- [ ] **Step 4: Commit**

```bash
git add client/admin/components/StatsPanel.svelte
git commit -m "fix(admin/stats): rebuild stats panel with MetricCards and DataTable

Replaces dl/dt/dd + raw select/button with Seg, Btn, MetricCard,
and DataTable. Three sub-panels: ACTIVE SUBJECTS, STORAGE,
DISTRIBUTIONS. Resolves §2.2 of the visual-bugs report."
```

---

### Task 9: Rebuild `BillingSection.svelte`

**Files:**

- Modify: `client/admin/sections/BillingSection.svelte`
- Verify: existing tests under `tests/client/admin/sections/` (if any).

**Prototype reference:** `client/assets/bs-admin-billing-table.jsx`, `bs-admin-subject-detail.jsx`.

- [ ] **Step 1: Read current file**

Run: `cat client/admin/sections/BillingSection.svelte | head -60`. Identify the fetchers/state used. The existing component imports `SubjectsTable` and `SubjectDetail`; keep using them but wrap in `<Panel>` chrome.

- [ ] **Step 2: Replace the wrapper sections**

Open `client/admin/sections/BillingSection.svelte`. Replace the top-level `<section class="panel ...">` markup with:

```svelte
<section id="billing" class="admin-section">
  <Panel title="billing" subtitle="usage aggregated from llm_usage_events">
    {#snippet action()}
      <Btn variant="ghost" size="sm" onClick={() => { void exportCsv() }}>
        {#snippet children()}export csv{/snippet}
      </Btn>
    {/snippet}
    {#snippet body()}
      <SubjectsTable {...subjectsTableProps} />
    {/snippet}
  </Panel>

  {#if selectedSubject !== null}
    <Panel title={`subject detail · ${selectedSubject.subject}`}>
      {#snippet body()}
        <SubjectDetail subject={selectedSubject} {detail} />
      {/snippet}
    </Panel>
  {/if}
</section>
```

Replace these imports at top:

```ts
import Btn from '../../shared/ui/Btn.svelte'
import Panel from '../../shared/ui/Panel.svelte'
```

(Keep all existing imports for `SubjectsTable`, `SubjectDetail`, fetchers.)

If `Panel` already supports a `subtitle` prop, use it. If not (the current Panel doesn't), pass subtitle inline via the action snippet header label or drop it (the prototype includes it but it's not load-bearing).

- [ ] **Step 3: Verify Panel subtitle**

Run: `grep "subtitle" client/shared/ui/Panel.svelte`

If no result, drop the `subtitle="..."` prop above (Panel does not yet support it; do not extend Panel in this task).

- [ ] **Step 4: Run tests**

Run: `bun test:client tests/client/admin/sections/`

Expected: PASS.

- [ ] **Step 5: Verify in Storybook**

Open `http://localhost:6006/?path=/story/admin-sections-billingsection--populated` (if exists) or `admin-adminapp--default` and scroll to billing. Expect Panel chrome around the subjects table.

- [ ] **Step 6: Commit**

```bash
git add client/admin/sections/BillingSection.svelte
git commit -m "fix(admin/billing): wrap subjects table and detail in Panel chrome

SubjectsTable and SubjectDetail rendered as Panel-wrapped sections
matching the prototype's billing card. Resolves §2.3 (billing) of
the visual-bugs report."
```

---

### Task 10: Rebuild `MemosSection.svelte`

**Files:**

- Modify: `client/admin/sections/MemosSection.svelte`
- Verify: `tests/client/admin/sections/MemosSection.test.ts`.

**Prototype reference:** `client/assets/bs-admin-memos.jsx`.

- [ ] **Step 1: Read existing testids**

Run: `grep "data-testid" client/admin/sections/MemosSection.svelte tests/client/admin/sections/MemosSection.test.ts`

Note: `memos-user-id`, `memos-state`, `memos-load`, plus the section title. These must remain.

- [ ] **Step 2: Replace the component**

Replace `client/admin/sections/MemosSection.svelte` with:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { Memo } from '../../shared/api-types.js'
  import Btn from '../../shared/ui/Btn.svelte'
  import DataTable from '../../shared/ui/DataTable.svelte'
  import Input from '../../shared/ui/Input.svelte'
  import Panel from '../../shared/ui/Panel.svelte'
  import Seg from '../../shared/ui/Seg.svelte'
  import { fetchMemos } from '../fetchers.js'

  let userId = $state('')
  let state = $state<'active' | 'archived'>('active')
  let memos: Memo[] = $state([])
  let hasLoaded = $state(false)
  let loading = $state(false)
  let error: string | null = $state(null)
  let rootEl: HTMLElement | undefined = $state()
  let loaded = $state(false)

  async function loadMemos(): Promise<void> {
    if (userId.trim() === '') return
    loading = true
    error = null
    try {
      memos = await fetchMemos(userId.trim(), state)
      hasLoaded = true
    } catch (err) {
      hasLoaded = true
      error = err instanceof Error ? err.message : String(err)
      memos = []
    } finally {
      loading = false
    }
  }

  $effect(() => {
    if (rootEl === undefined) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            loaded = true
            observer.disconnect()
            return
          }
        }
      },
      { rootMargin: '0px' },
    )
    observer.observe(rootEl)
    return () => observer.disconnect()
  })

  interface MemoRow {
    id: string
    status: string
    content: string
    tags: string
  }

  const rows = $derived<MemoRow[]>(
    memos.map((m) => ({ id: m.id, status: m.status, content: m.content, tags: m.tags.join(', ') || '—' })) as MemoRow[],
  )

  const columns = [
    { key: 'id' as const, label: 'ID' },
    { key: 'status' as const, label: 'Status' },
    { key: 'content' as const, label: 'Content' },
    { key: 'tags' as const, label: 'Tags' },
  ]
</script>

<section id="memos" class="admin-section" bind:this={rootEl}>
  <Panel title="memos">
    {#snippet action()}
      <form
        class="memos__filter"
        onsubmit={(e) => {
          e.preventDefault()
          void loadMemos()
        }}>
        <Input
          data-testid="memos-user-id"
          bind:value={userId}
          placeholder="user id" />
        <Seg
          options={['active', 'archived']}
          value={state}
          onChange={(v) => { state = v as 'active' | 'archived' }} />
        <Btn
          variant="primary"
          size="sm"
          type="submit"
          disabled={userId.trim() === '' || loading}>
          {#snippet children()}{loading ? 'Loading…' : 'Load'}{/snippet}
        </Btn>
      </form>
    {/snippet}
    {#snippet body()}
      <div class="memos__body">
        {#if error !== null}
          <p class="status-error" data-testid="memos-error">{error}</p>
        {:else if !hasLoaded}
          <p class="placeholder">Enter a user ID and click Load.</p>
        {:else if memos.length === 0}
          <p class="placeholder">No memos found.</p>
        {:else}
          <DataTable {columns} {rows} rowKey="id" />
        {/if}
      </div>
    {/snippet}
  </Panel>
</section>

<style>
  .admin-section {
    scroll-margin-top: 96px;
  }
  .memos__filter {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .memos__body {
    padding: 0;
  }
  .placeholder {
    margin: 0;
    padding: 24px;
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 12px;
    text-align: center;
  }
  .status-error {
    margin: 0;
    padding: 12px;
    color: var(--danger);
    font-family: var(--font-mono);
    font-size: 12px;
  }
</style>
```

**Note on `Input`:** if `client/shared/ui/Input.svelte` does not accept `data-testid` as a passthrough prop, fall back to wrapping in a div with the testid. Verify with `head -40 client/shared/ui/Input.svelte`.

**Note on `loadInitial`:** The previous component had a `loadInitial` method that did nothing useful (`if (loaded) return; loaded = true`). It's preserved as the bare flag `loaded` for symmetry with the IntersectionObserver. If unused, the IO effect can be deleted — but keep it for behavioural parity.

- [ ] **Step 3: Run tests**

Run: `bun test:client tests/client/admin/sections/MemosSection.test.ts`

Expected: PASS, or update tests where `Seg` replaces `<select data-testid="memos-state">`. To drive `Seg` from tests, find `.ui-seg__btn` by text content and call `.click()`.

- [ ] **Step 4: Commit**

```bash
git add client/admin/sections/MemosSection.svelte
git commit -m "fix(admin/memos): rebuild with Panel + Seg + DataTable chrome

Replaces raw form + html table with Panel-wrapped section,
Seg for the active/archived picker, Btn for the load action,
and DataTable for the memo list. User-id filter UX preserved.
Resolves §2.3 (memos) of the visual-bugs report."
```

---

### Task 11: Rebuild `RemindersSection.svelte`

**Files:**

- Modify: `client/admin/sections/RemindersSection.svelte`
- Verify: `tests/client/admin/sections/RemindersSection.test.ts`.

**Prototype reference:** `client/assets/bs-admin-recurring.jsx`, `bs-admin-deferred.jsx`.

- [ ] **Step 1: Read existing testids and fetchers**

Run: `cat client/admin/sections/RemindersSection.svelte | head -80`. Note all `data-testid` attributes and which fetchers are imported.

- [ ] **Step 2: Replace the section**

Replace the component body (preserving the existing script-block fetchers + state) with this template structure (adapt variable names to whatever the existing script already declares — e.g. `recurring`, `deferred`, `loadRecurring`, etc.):

```svelte
<section id="reminders" class="admin-section">
  <header class="reminders__header">
    <Input data-testid="reminders-user-id" bind:value={userId} placeholder="user id" />
    <Btn
      variant="primary"
      size="sm"
      disabled={userId.trim() === '' || loading}
      onClick={() => { void loadAll() }}>
      {#snippet children()}{loading ? 'Loading…' : 'Load'}{/snippet}
    </Btn>
  </header>

  <div class="reminders__grid">
    <Panel title="recurring tasks" count={recurring.length}>
      {#snippet body()}
        {#if recurring.length === 0}
          <p class="placeholder">No recurring reminders</p>
        {:else}
          <ul class="reminders__list">
            {#each recurring as r (r.id)}
              <li class="reminders__row">
                <div class="reminders__row-main">
                  <span class="reminders__title">{r.title}</span>
                  <span class="reminders__sub">{r.schedule}</span>
                </div>
                <span class="reminders__status">{r.status}</span>
              </li>
            {/each}
          </ul>
        {/if}
      {/snippet}
    </Panel>

    <Panel title="deferred prompts" count={deferred.length}>
      {#snippet body()}
        {#if deferred.length === 0}
          <p class="placeholder">No deferred reminders</p>
        {:else}
          <ul class="reminders__list">
            {#each deferred as d (d.id)}
              <li class="reminders__row">
                <div class="reminders__row-main">
                  <span class="reminders__title">{d.prompt}</span>
                  <span class="reminders__sub">fires at {d.fireAt}</span>
                </div>
                <span class="reminders__status">{d.status}</span>
              </li>
            {/each}
          </ul>
        {/if}
      {/snippet}
    </Panel>
  </div>
</section>

<style>
  .admin-section {
    scroll-margin-top: 96px;
  }
  .reminders__header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 12px;
  }
  .reminders__grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding: 0 12px 12px;
  }
  .reminders__list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
  }
  .reminders__row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 12px;
    border-bottom: 1px solid var(--hair);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .reminders__row:last-child {
    border-bottom: none;
  }
  .reminders__row-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .reminders__title {
    color: var(--fg);
  }
  .reminders__sub {
    color: var(--fg3);
    font-size: 11px;
  }
  .reminders__status {
    color: var(--fg3);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 10px;
  }
  .placeholder {
    margin: 0;
    padding: 24px;
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 12px;
    text-align: center;
  }
</style>
```

Make sure the `<script>` block imports `Input`, `Btn`, `Panel`. Add a single `loadAll` helper if `loadRecurring` and `loadDeferred` exist separately:

```ts
async function loadAll(): Promise<void> {
  await Promise.all([loadRecurring(), loadDeferred()])
}
```

(Adapt to whatever helpers actually exist.)

- [ ] **Step 3: Run tests**

Run: `bun test:client tests/client/admin/sections/RemindersSection.test.ts`

Expected: PASS, or update selector access patterns.

- [ ] **Step 4: Commit**

```bash
git add client/admin/sections/RemindersSection.svelte
git commit -m "fix(admin/reminders): rebuild with two Panel grid layout

Splits the section into RECURRING TASKS and DEFERRED PROMPTS
panels side-by-side, each showing a list of rows styled like
the prototype. Shared user-id filter at the top.
Resolves §2.3 (reminders) of the visual-bugs report."
```

---

### Task 12: Rebuild `IdentitiesSection.svelte`

**Files:**

- Modify: `client/admin/sections/IdentitiesSection.svelte`
- Verify: `tests/client/admin/sections/IdentitiesSection.test.ts`.

**Prototype reference:** `client/assets/bs-admin-identity.jsx`.

- [ ] **Step 1: Read existing testids and fetcher**

Run: `cat client/admin/sections/IdentitiesSection.svelte`. Note the fetcher (likely `fetchIdentityMappings`), the columns it expects, and the testids.

- [ ] **Step 2: Replace template**

Adapt the existing script block (do not delete fetcher / state), then replace the template with:

```svelte
<section id="identity" class="admin-section">
  <Panel title="identity mappings" count={mappings.length}>
    {#snippet action()}
      <div class="identities__filter">
        <Input data-testid="identities-user-id" bind:value={userId} placeholder="user id" />
        <Btn variant="primary" size="sm" disabled={userId.trim() === '' || loading} onClick={() => { void loadIdentities() }}>
          {#snippet children()}{loading ? 'Loading…' : 'Load'}{/snippet}
        </Btn>
      </div>
    {/snippet}
    {#snippet body()}
      {#if mappings.length === 0 && hasLoaded}
        <p class="placeholder">No mappings found</p>
      {:else if !hasLoaded}
        <p class="placeholder">Enter a user ID and click Load.</p>
      {:else}
        <DataTable
          columns={[
            { key: 'user', label: 'User' },
            { key: 'provider', label: 'Provider' },
            { key: 'login', label: 'Login' },
            { key: 'method', label: 'Method' },
            { key: 'conf', label: 'Conf', align: 'right' },
          ]}
          rows={mappings}
          rowKey="user" />
      {/if}
    {/snippet}
  </Panel>
</section>
```

Import additions in script: `Btn`, `Input`, `Panel`, `DataTable`.

Add styles:

```svelte
<style>
  .admin-section {
    scroll-margin-top: 96px;
  }
  .identities__filter {
    display: flex;
    gap: 6px;
  }
  .placeholder {
    margin: 0;
    padding: 24px;
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 12px;
    text-align: center;
  }
</style>
```

If the rows shape from the fetcher does not match `{ user, provider, login, method, conf }`, adapt the `columns` and/or `derived` row-shaping inline.

- [ ] **Step 3: Run tests and commit**

```bash
bun test:client tests/client/admin/sections/IdentitiesSection.test.ts
git add client/admin/sections/IdentitiesSection.svelte
git commit -m "fix(admin/identity): rebuild with Panel + DataTable chrome

Replaces raw table with DataTable, wraps in Panel, moves filter
to header action slot. Resolves §2.3 (identity) of the visual-bugs
report."
```

---

### Task 13: Rebuild `GroupsSection.svelte`

**Files:**

- Modify: `client/admin/sections/GroupsSection.svelte`
- Verify: `tests/client/admin/sections/GroupsSection.test.ts`.

**Prototype reference:** `client/assets/bs-admin-groups.jsx`.

- [ ] **Step 1: Replace template**

Adapt the existing script (preserve `fetchGroups`, state) and replace the template with:

```svelte
<section id="groups" class="admin-section">
  <Panel title="authorized groups" count={groups.length}>
    {#snippet action()}
      <Btn variant="ghost" size="sm" onClick={() => { void loadGroups() }} disabled={loading}>
        {#snippet children()}{loading ? 'Refreshing…' : 'Refresh'}{/snippet}
      </Btn>
    {/snippet}
    {#snippet body()}
      {#if groups.length === 0}
        <p class="placeholder">No authorized groups</p>
      {:else}
        <DataTable
          columns={[
            { key: 'label', label: 'Group' },
            { key: 'addedAt', label: 'Added' },
            { key: 'action', label: '', align: 'right' },
          ]}
          rows={groupRows}
          rowKey="label" />
      {/if}
    {/snippet}
  </Panel>
</section>
```

The `action` column needs a custom render — extend with a `cell` snippet:

```svelte
{#snippet cell(row, col)}
  {#if col.key === 'action'}
    <button class="revoke" onclick={() => revoke(row.label)}>revoke</button>
  {:else}
    {row[col.key]}
  {/if}
{/snippet}
```

And add the snippet to DataTable: `<DataTable {columns} rows={groupRows} {cell} rowKey="label" />`.

Add `.revoke` CSS (or use existing `<Btn variant="danger" size="sm">`).

- [ ] **Step 2: Run tests, commit**

```bash
bun test:client tests/client/admin/sections/GroupsSection.test.ts
git add client/admin/sections/GroupsSection.svelte
git commit -m "fix(admin/groups): rebuild with Panel + DataTable + revoke action

Resolves §2.3 (groups) of the visual-bugs report."
```

---

### Task 14: Rebuild `SystemSection.svelte`

**Files:**

- Modify: `client/admin/sections/SystemSection.svelte`
- Verify: `tests/client/admin/sections/SystemSection.test.ts`.

**Prototype reference:** `client/assets/bs-admin-credentials.jsx`.

- [ ] **Step 1: Replace template**

Wrap the existing `<CredentialsForm>` and system-summary content in two `<Panel>`s:

```svelte
<section id="system" class="admin-section">
  <Panel title="llm credentials" subtitle="system_config · admin-owned">
    {#snippet body()}
      <CredentialsForm {...credentialsProps} />
    {/snippet}
  </Panel>

  <Panel title="system summary">
    {#snippet body()}
      <div class="system__summary">
        <KV k="chat provider" v={summary.chatProvider} />
        <KV k="task provider" v={summary.taskProvider} />
        <KV k="debug server" v={summary.debugServer ? 'enabled' : 'disabled'} />
        <KV k="admin user" v={summary.adminUserSet ? 'configured' : 'missing'} />
      </div>
    {/snippet}
  </Panel>
</section>

<style>
  .admin-section {
    scroll-margin-top: 96px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .system__summary {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
</style>
```

Drop `subtitle` if `Panel` doesn't accept it. Adapt props (`credentialsProps`, `summary`) to whatever the existing script declares.

- [ ] **Step 2: Run tests, commit**

```bash
bun test:client tests/client/admin/sections/SystemSection.test.ts
git add client/admin/sections/SystemSection.svelte
git commit -m "fix(admin/system): wrap credentials and summary in Panel chrome

Resolves §2.3 (system) of the visual-bugs report."
```

---

### Task 15: Minimal Panel wrap for `InstancesSection.svelte`

**Files:**

- Modify: `client/admin/sections/InstancesSection.svelte`
- Verify: `tests/client/admin/sections/InstancesSection.test.ts`.

Per the design spec §4.2: this is **minimal scope** — only wrap existing markup in `<Panel>` chrome and swap `<select>`/`<button>` for `<Seg>`/`<Btn>`. No structural rewrite.

- [ ] **Step 1: Import `Panel`, `Btn` if missing**

Open `client/admin/sections/InstancesSection.svelte`. At the top of the script block, ensure imports include:

```ts
import Btn from '../../shared/ui/Btn.svelte'
import Panel from '../../shared/ui/Panel.svelte'
```

- [ ] **Step 2: Wrap each existing inner subsection in `<Panel title="...">`**

Identify the three logical groups in the existing template (Platform Instances, Task Instances, Admins) — each currently rendered as bare `<table>` + form. Wrap each one as:

```svelte
<Panel title="platform instances">
  {#snippet body()}
    <!-- existing form + table markup -->
  {/snippet}
</Panel>
```

For each `<button>...</button>` not already inside a `<Btn>`, replace with `<Btn variant="secondary" size="sm" onClick={...}>{#snippet children()}...{/snippet}</Btn>`. Don't touch the inputs.

- [ ] **Step 3: Run tests, commit**

```bash
bun test:client tests/client/admin/sections/InstancesSection.test.ts
git add client/admin/sections/InstancesSection.svelte
git commit -m "fix(admin/instances): minimal Panel wrap + Btn swap

Wraps Platform Instances / Task Instances / Admins subsections in
Panel chrome and replaces raw <button> with Btn. No structural
rewrite. Resolves §2.3 (instances) partial; full rebuild deferred."
```

---

### Task 16: Open PR 2

- [ ] **Step 1: Run the full check + visual smoke**

```bash
bun check:full
bun test:client
```

Expected: green.

- [ ] **Step 2: Open PR**

```bash
git push -u origin fix/dashboard-admin-sections-rebuild
gh pr create --title "Dashboard admin sections: rebuild + MSW fixtures" \
  --body "$(cat <<'EOF'
## Summary

- Rebuilds OverviewSection, StatsSection, BillingSection, MemosSection, RemindersSection, IdentitiesSection, GroupsSection, SystemSection using new MetricCard/DataTable primitives (depends on PR #1)
- Minimal Panel-wrap pass on InstancesSection (full rebuild deferred)
- Adds pluginConfigHandlers and instancesHandlers MSW families; wires into admin-* scenarios

PR 2 of 4 in the dashboard visual bugs fix series. See
[docs/superpowers/specs/2026-05-30-dashboard-visual-bugs-fix-design.md](docs/superpowers/specs/2026-05-30-dashboard-visual-bugs-fix-design.md).

## Test plan

- [ ] `bun test:client` passes
- [ ] `admin-adminapp--default` story shows no 404 banners
- [ ] OverviewSection shows 5 MetricCards + Bars + SurfaceMix
- [ ] StatsSection shows 3 sub-panels (Active/Storage/Distributions)
- [ ] All 6 form-shaped sections show Panel chrome
EOF
)"
```

Wait for PR 2 to merge before proceeding to PR 3.

---

# PR 3 — Debug fixes

Branch: `fix/dashboard-debug-turns-and-session`.

---

### Task 17: Rebuild `TurnsPanel.svelte` columns

**Files:**

- Modify: `client/debug/components/TurnsPanel.svelte`
- Verify: `tests/client/debug/components/TurnsPanel.test.ts`.

**Prototype reference:** `client/assets/bs-debug-turns.jsx`.

- [ ] **Step 1: Create branch**

```bash
git checkout master && git pull
git checkout -b fix/dashboard-debug-turns-and-session
```

- [ ] **Step 2: Read current file and tests**

Run: `cat client/debug/components/TurnsPanel.svelte tests/client/debug/components/TurnsPanel.test.ts`. Note testids and the props shape (likely `turns: Turn[]`).

- [ ] **Step 3: Rewrite using DataTable**

Adapt the existing script (preserve props + turn shape) and replace the markup with:

```svelte
<Panel title="turns" count={turns.length}>
  {#snippet body()}
    <DataTable
      columns={[
        { key: 'time', label: 'Time' },
        { key: 'status', label: 'Status' },
        { key: 'scope', label: 'Scope' },
        { key: 'duration', label: 'Duration', align: 'right' },
        { key: 'msgs', label: 'Msgs', align: 'right' },
        { key: 'tools', label: 'Tools' },
      ]}
      rows={turnRows}
      rowKey="id"
      cell={cellRender}
      onRowClick={selectTurn} />
  {/snippet}
</Panel>

{#snippet cellRender(row, col)}
  {#if col.key === 'status'}
    <Pill variant={statusVariant(row.status)}>{row.status}</Pill>
  {:else if col.key === 'tools'}
    {#each row.toolList.slice(0, 3) as t (t)}
      <Pill variant="default" size="sm">{t}</Pill>
    {/each}
    {#if row.toolList.length > 3}
      <span class="turns__overflow">+{row.toolList.length - 3}</span>
    {/if}
  {:else if col.key === 'duration'}
    {row.duration}ms
  {:else}
    {row[col.key] ?? ''}
  {/if}
{/snippet}
```

Add a derived `turnRows` that flattens each Turn into `{ id, time, status, scope, duration, msgs, toolList }`. Add imports: `DataTable`, `Pill`, `Panel`. Add a `statusVariant(status: string)` helper mapping `running → 'info'`, `error → 'danger'`, `ok → 'success'`, `cancelled → 'warn'`.

- [ ] **Step 4: Run tests**

Run: `bun test:client tests/client/debug/components/TurnsPanel.test.ts`

Expected: PASS, or update tests where columns or testids changed.

- [ ] **Step 5: Verify in Storybook**

Open `http://localhost:6006/?path=/story/debug-components-turnspanel--default`. Expect a 6-column table.

- [ ] **Step 6: Commit**

```bash
git add client/debug/components/TurnsPanel.svelte
git commit -m "fix(debug/turns): restore 6-column table layout

Rebuilds with DataTable: Time, Status (pill), Scope, Duration,
Msgs, Tools (pill chips with +N overflow). Matches prototype
bs-debug-turns.jsx. Resolves §2.5 of the visual-bugs report."
```

---

### Task 18: Fix `SessionCard.svelte` line-bleed

**Files:**

- Modify: `client/debug/components/SessionCard.svelte`

- [ ] **Step 1: Read current file**

```bash
cat client/debug/components/SessionCard.svelte
```

Identify the `<style>` block.

- [ ] **Step 2: Diagnose via inspection**

Start `bun storybook` and `bunx serve client/assets -p 5174`. Open `http://localhost:6006/iframe.html?id=debug-debugapp--populated&viewMode=story`. Use the browser devtools (or `mcp__Claude_Preview__preview_inspect` if available) to inspect a `.session-card` (or whatever the root class is) and confirm: missing `padding-bottom`, wrong `line-height`, or missing `border-bottom`.

- [ ] **Step 3: Apply CSS fix**

Edit the `<style>` block. The expected fix is one of:

```css
.session-card {
  /* ensure each row has its own block, doesn't share line-box with next */
  display: block;
  padding: 10px 12px;
  border-bottom: 1px solid var(--hair);
  line-height: 1.45;
}
.session-card__sub {
  display: block;
  margin-top: 2px;
}
```

Match property names to the actual existing classes in the file.

- [ ] **Step 4: Verify visually**

Reload `http://localhost:6006/iframe.html?id=debug-debugapp--populated&viewMode=story`. Confirm session rows now have visible separation. Also confirm `debug-components-sessioncard--default` still renders cleanly.

- [ ] **Step 5: Commit**

```bash
git add client/debug/components/SessionCard.svelte
git commit -m "fix(debug/session-card): repair row line-bleed in DebugApp

Adds explicit padding-bottom and hairline border-bottom so
session rows don't visually merge when stacked. Resolves §2.6
of the visual-bugs report."
```

---

### Task 19: Rename `DebugApp` story `populated` → `default`

**Files:**

- Modify: `client/debug/DebugApp.stories.svelte`

- [ ] **Step 1: Rename the story**

Open `client/debug/DebugApp.stories.svelte`. Find `<Story name="populated">` and change the name attribute to `"default"`. Keep all other stories as-is.

- [ ] **Step 2: Verify**

Run `bun storybook` (already running). Confirm `http://localhost:6006/?path=/story/debug-debugapp--default` resolves; `populated` no longer exists.

- [ ] **Step 3: Commit and open PR**

```bash
git add client/debug/DebugApp.stories.svelte
git commit -m "chore(debug/story): rename populated → default

Matches AdminApp story naming. Resolves §2.7 of the visual-bugs
report."

git push -u origin fix/dashboard-debug-turns-and-session
gh pr create --title "Dashboard debug fixes: TurnsPanel columns, SessionCard line-bleed, story rename" \
  --body "$(cat <<'EOF'
## Summary

- TurnsPanel: restored 6-column table layout via DataTable
- SessionCard: fixed row line-bleed when stacked in DebugApp
- DebugApp.stories: renamed `populated` → `default` to match AdminApp

PR 3 of 4 in the dashboard visual bugs fix series.

## Test plan

- [ ] `bun test:client` passes
- [ ] `debug-components-turnspanel--default` shows 6 columns
- [ ] `debug-debugapp--default` exists and renders without row overlap
EOF
)"
```

Wait for PR 3 to merge before proceeding to PR 4.

---

# PR 4 — Polish

Branch: `fix/dashboard-polish-treeview-and-docs`.

---

### Task 20: Add padding to TreeView stories

**Files:**

- Modify: `client/shared/TreeView.stories.svelte`

- [ ] **Step 1: Create branch**

```bash
git checkout master && git pull
git checkout -b fix/dashboard-polish-treeview-and-docs
```

- [ ] **Step 2: Wrap each story body in padded container**

Open `client/shared/TreeView.stories.svelte`. For each `<Story>` block, wrap the body content in:

```svelte
<div style="padding: 20px; background: var(--bg); min-height: 200px;">
  <!-- existing TreeView content -->
</div>
```

- [ ] **Step 3: Verify**

Run `bun storybook`. Open `http://localhost:6006/?path=/story/shared-treeview--nested-object`. Confirm top rows (`id: 1`, `ok: true`) and `payload:` root are no longer clipped at the iframe edge.

- [ ] **Step 4: Commit**

```bash
git add client/shared/TreeView.stories.svelte
git commit -m "fix(shared/treeview): add story decorator padding

Top rows were getting clipped at the iframe edge in the TreeView
story; wrapping in a 20px-padded container fixes it. Resolves
§2.8 of the visual-bugs report."
```

---

### Task 21: Update `dashboard-ui-audit.md`

**Files:**

- Modify: `docs/design/dashboard-ui-audit.md`

- [ ] **Step 1: Drop PropertiesTable from broken list**

Open `docs/design/dashboard-ui-audit.md`. In § 1.7 ("Conflicting shared components") find the row for `PropertiesTable.svelte`. Replace its existing description (`uses tree-* classes never defined in CSS — visually broken`) with:

```
| `PropertiesTable.svelte`                 | ✅ RESOLVED (2026-05-30 visual sweep): renders correctly with type-coloured cells; no `tree-*` class drift observed |
```

For `TreeView.svelte`, change the description to:

```
| `TreeView.svelte`                        | Story decorator padding missing — top rows clipped at iframe edge. Fixed in PR 4 of the visual-bugs series; see `docs/design/dashboard-visual-bugs-2026-05-30.md` §2.8 |
```

- [ ] **Step 2: Commit**

```bash
git add docs/design/dashboard-ui-audit.md
git commit -m "docs(design): update audit per 2026-05-30 visual sweep

- Drop PropertiesTable from 'broken' list (renders correctly)
- Reframe TreeView issue as story-decorator padding"
```

---

### Task 22: Update visual-bugs report and screenshot-plan with resolution markers

**Files:**

- Modify: `docs/design/dashboard-visual-bugs-2026-05-30.md`
- Modify: `docs/design/dashboard-prototype-vs-storybook-screenshot-plan.md`

- [ ] **Step 1: Mark findings as resolved**

Open `docs/design/dashboard-visual-bugs-2026-05-30.md`. At the top of each numbered finding (§2.1–§2.10), prepend `**✅ RESOLVED (PR <N>):** ` followed by the PR title.

For §2.10 (DesignSystem has no Storybook equivalent), prepend `**⏸ DEFERRED:** authoring decided not in scope; see spec §4.6.`.

- [ ] **Step 2: Update the screenshot plan §8**

Open `docs/design/dashboard-prototype-vs-storybook-screenshot-plan.md`. In §8 "Known gaps the visual sweep will surface", replace the prediction header with:

```
## 8. Known gaps — RESOLVED 2026-05-30

These predictions all surfaced in the visual sweep and are tracked in
[docs/design/dashboard-visual-bugs-2026-05-30.md](dashboard-visual-bugs-2026-05-30.md).
Fixes shipped in PRs 1–4 (see
[docs/superpowers/plans/2026-05-30-dashboard-visual-bugs-fix.md](../superpowers/plans/2026-05-30-dashboard-visual-bugs-fix.md)).
```

- [ ] **Step 3: Commit and open PR**

```bash
git add docs/design/dashboard-visual-bugs-2026-05-30.md \
        docs/design/dashboard-prototype-vs-storybook-screenshot-plan.md
git commit -m "docs(design): mark visual-bug findings resolved

Annotates each §2.1–§2.10 finding with the merging PR and links
the screenshot plan to the implementation plan."

git push -u origin fix/dashboard-polish-treeview-and-docs
gh pr create --title "Dashboard polish: TreeView padding + doc updates" \
  --body "$(cat <<'EOF'
## Summary

- TreeView story decorator padding (fixes top-row clipping)
- Audit doc updated (drop PropertiesTable, reframe TreeView claim)
- Visual-bugs report and screenshot plan get resolution markers

PR 4 of 4 in the dashboard visual bugs fix series.
EOF
)"
```

---

# Final verification (after PR 4 merges)

- [ ] **Run the full visual screenshot sweep**

With both servers running (`bun storybook`, `bunx serve client/assets -p 5174`), use `mcp__Claude_Preview__preview_*` (or any browser):

1. Capture `http://localhost:6006/iframe.html?id=admin-adminapp--default&viewMode=story` at 1500×3200.
2. Capture `http://localhost:5174/backstage.html` scrolled to the admin artboard.
3. Place side-by-side; confirm no structural deltas.
4. Capture `http://localhost:6006/iframe.html?id=debug-debugapp--default&viewMode=story` at 1500×1600.
5. Capture `http://localhost:5174/backstage.html` scrolled to the debug artboard.
6. Place side-by-side; confirm TURNS panel is 6 columns and SESSIONS rail rows don't overlap.

- [ ] **Confirm spec acceptance criteria (spec §7)**

All findings §2.1–§2.9 ✅; §2.10 marked ⏸.

The codebase is now ready for the next workstream (e2e + component + screenshot regression testing) the user mentioned.
