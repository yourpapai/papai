<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Debug Dashboard UX Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all 17 findings from `docs/ux-reviews/DebugApp.md` in three phases: shared foundations → interaction layer → layout & content.

**Architecture:** Phase 1 fixes shared primitives (`DataTable`, `TreeView`, `SummaryList`) with settings/admin re-shoots as regression proof. Phase 2 wires debug-page interaction state (focus rings, selected rows, filtered counts) off the existing `dashboard.selectedDetail`. Phase 3 adds responsive layout, disconnect feedback, structured detail views, and polish. All visual work is verified through Storybook stories + `bun shoot` screenshots; logic gets `bun:test` unit/mount tests.

**Tech Stack:** Svelte 5 (runes), TypeScript, Bun test (`bun:test` + svelte `mount`/`unmount`), Storybook + `@crvy/strybk` visual specs, pino-free client code.

**Spec:** [`docs/superpowers/specs/2026-08-01-debug-dashboard-ux-remediation-design.md`](../specs/2026-08-01-debug-dashboard-ux-remediation-design.md)

## Global Constraints

- New `.ts` / `.svelte` files must carry the 4-line BUSL license header (see any existing file; `bun run license:headers` enforces).
- Import paths in TypeScript use the `.js` extension.
- Never add lint-disable or type-ignore comments; fix the underlying issue.
- Svelte 5 runes only (`$props`, `$derived`, `$state`, `$effect`) — match existing components.
- Client tests run via `bun run test:client` (browser conditions); single-file form shown per task.
- After adding/renaming any story: `bun shoot:gen` before `bun shoot`.
- Formatter is `oxfmt` (`bun run format`), not prettier.
- Storybook must be running (`bun storybook`) for any `bun shoot` step; verify with `curl -s -o /dev/null -w "%{http_code}" http://localhost:6006/` → `200`.
- Every commit: `bun run lint && bun run typecheck` must pass first (commit hooks run them anyway).

---

## Phase 1 — Shared foundations

### Task 1: DataTable keyboard reachability + stronger selected style

**Files:**
- Modify: `client/shared/ui/DataTable.svelte`
- Test: `tests/client/shared/ui/DataTable.test.ts`

**Interfaces:**
- Consumes: existing `DataTable` props (`onRowClick?`, `selectedKey?`, `rowKey?`).
- Produces: clickable rows gain `tabindex="0"` + Enter/Space activation; CSS classes `ui-datatable__tr--clickable:focus-visible` and strengthened `ui-datatable__tr--selected` (used by Task 6).

- [ ] **Step 1: Write the failing tests** — append to `tests/client/shared/ui/DataTable.test.ts` inside the existing `describe('DataTable.svelte')` block:

```ts
  test('clickable rows are keyboard-focusable and Enter fires onRowClick', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const clicks: Row[] = []
    const rows: Row[] = [{ id: 'r1', name: 'one', count: 1 }]
    const component = mount(DataTable, {
      target,
      props: { columns, rows, onRowClick: (row: Row) => clicks.push(row) },
    })
    const tr = target.querySelector<HTMLTableRowElement>('tbody tr')!
    expect(tr.tabIndex).toBe(0)
    tr.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(clicks).toEqual([{ id: 'r1', name: 'one', count: 1 }])
    void unmount(component)
  })

  test('Space fires onRowClick', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const clicks: Row[] = []
    const rows: Row[] = [{ id: 'r1', name: 'one', count: 1 }]
    const component = mount(DataTable, {
      target,
      props: { columns, rows, onRowClick: (row: Row) => clicks.push(row) },
    })
    const tr = target.querySelector<HTMLTableRowElement>('tbody tr')!
    tr.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    expect(clicks).toEqual([{ id: 'r1', name: 'one', count: 1 }])
    void unmount(component)
  })

  test('non-clickable rows are not focusable', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const rows: Row[] = [{ id: 'r1', name: 'one', count: 1 }]
    const component = mount(DataTable, { target, props: { columns, rows } })
    const tr = target.querySelector<HTMLTableRowElement>('tbody tr')!
    expect(tr.tabIndex).toBe(-1)
    void unmount(component)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/DataTable.test.ts`
Expected: FAIL — first two tests see `clicks` stay empty (`tabIndex` assertion may also fail).

- [ ] **Step 3: Implement** — in `client/shared/ui/DataTable.svelte`, add a `keyRow` factory next to `clickRow` (after line 82):

```ts
  function keyRow(row: Row): (event: KeyboardEvent) => void {
    return (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      if (event.target !== event.currentTarget) return
      event.preventDefault()
      onRowClick?.(row)
    }
  }
```

Change the `<tr>` (lines 116-120) to:

```svelte
        <tr
          class="ui-datatable__tr"
          class:ui-datatable__tr--selected={selectedKey !== undefined && selectedKey === key}
          class:ui-datatable__tr--clickable={onRowClick !== undefined}
          tabindex={onRowClick !== undefined ? 0 : null}
          onclick={onRowClick ? clickRow(row) : null}
          onkeydown={onRowClick ? keyRow(row) : null}>
```

Add to the `<style>` block, next to `.ui-datatable__tr--clickable`:

```css
  .ui-datatable__tr--clickable:focus-visible {
    outline: var(--focus-ring);
    outline-offset: var(--focus-ring-offset);
  }
```

Strengthen the selected style (replace the existing `.ui-datatable__tr--selected` rule):

```css
  .ui-datatable__tr--selected {
    background: rgba(93, 217, 122, 0.06);
    box-shadow: inset 2px 0 0 var(--accent);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/DataTable.test.ts`
Expected: PASS (all tests, including the 3 new ones).

- [ ] **Step 5: Re-shoot DataTable stories** (selected style changed)

Run: `bun shoot -g DataTable`
Expected: all DataTable visual tests pass; read `.storybook-shots/shared/ui/DataTable.spec.ts/shared-ui-DataTable-clickable-with-selection-1.png` and confirm the selected row shows the accent left edge.

- [ ] **Step 6: Commit**

```bash
git add client/shared/ui/DataTable.svelte tests/client/shared/ui/DataTable.test.ts
git commit -m "feat(shared): keyboard-reachable DataTable rows, stronger selected style"
```

### Task 2: TreeView closing bracket on its own row

**Files:**
- Modify: `client/shared/TreeView.svelte`
- Test: `tests/client/shared/TreeView.test.ts` (create)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `.tree-closing` row class; markup shape relied on by Task 15 (dead-CSS cleanup must not re-break it).

- [ ] **Step 1: Write the failing test** — create `tests/client/shared/TreeView.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import TreeView from '../../../client/shared/TreeView.svelte'

describe('TreeView.svelte', () => {
  test('expanded container renders its closing bracket on a dedicated row', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(TreeView, { target, props: { label: 'payload', value: { a: 1 } } })
    const closing = target.querySelector('.tree-closing')
    expect(closing).not.toBeNull()
    expect(closing?.textContent?.trim()).toBe('}')
    void unmount(component)
  })

  test('collapsing a container hides its closing row', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(TreeView, { target, props: { label: 'payload', value: { a: 1 } } })
    const toggle = target.querySelector<HTMLElement>('.tree-toggle')!
    toggle.click()
    flushSync()
    expect(target.querySelector('.tree-closing')).toBeNull()
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/TreeView.test.ts`
Expected: FAIL — `.tree-closing` not found.

- [ ] **Step 3: Implement** — in `client/shared/TreeView.svelte`, replace lines 68-82 (the `{#if !collapsed}` block and inline closing bracket) with:

```svelte
    {#if !collapsed}
      {#if depth >= MAX_DEPTH}
        <span class="tree-bracket"> ... </span>
      {:else}
        <span class="tree-children">
          {#each entries as [k, v] (k)}
            <div class="tree-row" style="padding-left: {(depth + 1) * 12}px">
              <Self value={v} label={k} depth={depth + 1} />
            </div>
          {/each}
        </span>
        <div class="tree-row tree-closing" style="padding-left: {depth * 12 + 18}px">
          <span class="tree-bracket">{bracketClose}</span>
        </div>
      {/if}
    {/if}
```

Note: the previous trailing `<span class="tree-bracket">{bracketClose}</span>` after the `{#if !collapsed}` block is removed entirely; when collapsed the markup stays `▶ { }` inline because the closing span only existed outside the `{:else}` branch — verify the final file renders `{#if entries.length === 0}` → `{}{` `}` for empties and `▶ {` + `}` for collapsed. The collapsed case keeps an inline closing bracket: leave the existing `<span class="tree-bracket">{bracketClose}</span>` that renders when collapsed in place — i.e. the closing span becomes:

```svelte
    {#if collapsed}
      <span class="tree-bracket">{bracketClose}</span>
    {/if}
```

placed where the old unconditional closing span was.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/TreeView.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Re-shoot TreeView + debug detail stories** (bracket layout changed)

Run: `bun shoot -g 'TreeView|TurnDetail|FailureDetail|DebugDetailRail'`
Expected: pass; read `.storybook-shots/debug/components/DebugDetailRail.spec.ts/debug-components-DebugDetailRail-Turn-selected-1.png` and confirm closing brackets sit on their own rows, left-aligned with their opening line.

- [ ] **Step 6: Commit**

```bash
git add client/shared/TreeView.svelte tests/client/shared/TreeView.test.ts
git commit -m "fix(shared): TreeView closing brackets on aligned own rows"
```

### Task 3: SummaryList wraps long values

**Files:**
- Modify: `client/shared/ui/SummaryList.svelte`
- Modify: `client/shared/ui/SummaryList.stories.svelte`

**Interfaces:**
- Consumes: nothing.
- Produces: no API change; visual-only. Consumed by Task 12/13 detail views.

- [ ] **Step 1: Add the long-value story** — append to `client/shared/ui/SummaryList.stories.svelte`:

```svelte
<Story
  name="Long unbroken values"
  args={{
    items: [
      { k: 'User ID', v: 'tg:1001234567890' },
      { k: 'Response ID', v: 'resp_0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d' },
      { k: 'Model', v: 'gpt-4o-mini' },
    ],
  }}
/>
```

Wrap every story in this file in a 320px container so the narrow rail case is exercised — change the new story to:

```svelte
<Story name="Long unbroken values">
  <div style="padding: 20px; background: var(--bg); width: 320px;">
    <SummaryList
      items={[
        { k: 'User ID', v: 'tg:1001234567890' },
        { k: 'Response ID', v: 'resp_0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d' },
        { k: 'Model', v: 'gpt-4o-mini' },
      ]} />
  </div>
</Story>
```

(Use only the second form — a template story — not `args`; delete the first snippet. The file already imports `SummaryList` in its module script.)

- [ ] **Step 2: Regenerate the visual spec and shoot the baseline**

Run: `bun shoot:gen && bun shoot -g SummaryList`
Expected: pass; read `.storybook-shots/shared/ui/SummaryList.spec.ts/shared-ui-SummaryList-Long-unbroken-values-1.png` and confirm values clip/overflow (this is the failing visual baseline).

- [ ] **Step 3: Implement** — in `client/shared/ui/SummaryList.svelte` `<style>`:

```css
  .ui-summary__row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    padding: 8px 0;
    border-bottom: 1px solid var(--hair);
    min-width: 0;
  }
```

```css
  .ui-summary__v {
    font-size: 12px;
    color: var(--fg);
    text-align: right;
    min-width: 0;
    word-break: break-all;
  }
```

- [ ] **Step 4: Re-shoot and verify**

Run: `bun shoot -g SummaryList`
Expected: pass; re-read the Long-unbroken-values PNG — values wrap within the 320px container, nothing clipped.

- [ ] **Step 5: Commit**

```bash
git add client/shared/ui/SummaryList.svelte client/shared/ui/SummaryList.stories.svelte tests/visual/shared/ui/SummaryList.spec.ts
git commit -m "fix(shared): SummaryList wraps long unbroken values"
```

### Task 4: Phase 1 verification (consumers + gates)

**Files:** none modified.

- [ ] **Step 1: Re-shoot every consumer of the changed components**

Run: `bun shoot -g 'DataTable|TreeView|SummaryList|SettingsApp|AdminApp|DebugApp'`
Expected: all pass.

- [ ] **Step 2: Eyeball the composed consumers**

Read `.storybook-shots/settings/SettingsApp.spec.ts/` `Personal-ready` shot and `.storybook-shots/admin/AdminApp.spec.ts/` default shot; confirm no layout/selection artifacts from the DataTable/SummaryList changes.

- [ ] **Step 3: Run client tests + gates**

Run: `bun run test:client && bun run lint && bun run typecheck`
Expected: all pass.

- [ ] **Step 4: Finding checkoff** — Phase 1 closes M9, M10, and the DataTable half of H2. Note this in the Phase 2 starting commit message or PR description.

---

## Phase 2 — Interaction layer

### Task 5: Focus rings on debug list rows

**Files:**
- Modify: `client/debug/debug.css`
- Modify: `tests/visual/debug/components/SessionsList.spec.ts` (manual region only, below `// @generated-end auto-screenshots`)

**Interfaces:**
- Consumes: `--focus-ring`, `--focus-ring-offset` from `client/shared/tokens.css:39`.
- Produces: shared `:focus-visible` rule reused by Task 6's selected rows (focus and selected are independent styles).

- [ ] **Step 1: Add the keyboard-focus visual test** — append below the generated region in `tests/visual/debug/components/SessionsList.spec.ts`:

```ts
test('SessionCard — keyboard focus ring', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'debug-components-sessioncard--default')
  await sharedPage.keyboard.press('Tab')
  await expect(sharedPage).toHaveScreenshot()
})
```

- [ ] **Step 2: Shoot the failing baseline**

Run: `bun shoot -g 'SessionCard — keyboard focus ring'`
Expected: pass (new baseline written); read the PNG — the card shows no focus ring.

- [ ] **Step 3: Implement** — append to `client/debug/debug.css`:

```css
/* --- Shared row interaction states --- */

.session-card:focus-visible,
.trace-row:focus-visible,
.failure-row:focus-visible,
.log-entry:focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-ring-offset);
}
```

- [ ] **Step 4: Re-shoot and verify the ring**

Run: `bun shoot -g 'SessionCard — keyboard focus ring'`
Expected: pass; read the PNG — a visible outline ring surrounds the focused card. (If Tab lands elsewhere, adjust the test to tab until `.session-card:focus` matches via `sharedPage.locator('.session-card:focus-visible')` wait — real keyboard input does trigger `:focus-visible`.)

- [ ] **Step 5: Commit**

```bash
git add client/debug/debug.css tests/visual/debug/components/SessionsList.spec.ts
git commit -m "fix(debug): visible keyboard focus rings on list rows"
```

### Task 6: Selected-row wiring across all five lists

**Files:**
- Modify: `client/debug/components/TurnsPanel.svelte`
- Modify: `client/debug/components/SessionCard.svelte`
- Modify: `client/debug/components/SessionsList.svelte`
- Modify: `client/debug/components/TraceList.svelte`
- Modify: `client/debug/components/ToolFailuresPanel.svelte`
- Modify: `client/debug/components/LogExplorer.svelte`
- Modify: `client/debug/debug.css`
- Test: `tests/client/debug/components/TurnsPanel.test.ts` (create)
- Test: `tests/client/debug/components/SessionCard.test.ts` (create)
- Modify stories: `TurnsPanel.stories.svelte`, `SessionsList.stories.svelte`, `TraceList.stories.svelte`, `ToolFailuresPanel.stories.svelte`, `LogExplorer.stories.svelte`

**Interfaces:**
- Consumes: Task 1's `ui-datatable__tr--selected` style; `SELECTED_TURN` fixture from `client/stories/fixtures/debug.ts:81`.
- Produces: `SessionCard` gains prop `selected?: boolean`; debug.css gains `.session-card.selected, .trace-row.selected, .failure-row.selected, .log-entry.selected` rule.

- [ ] **Step 1: Write the failing tests** — create `tests/client/debug/components/TurnsPanel.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import TurnsPanel from '../../../../client/debug/components/TurnsPanel.svelte'
import type { DashboardState, Turn } from '../../../../client/debug/dashboard-types.js'

function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    turnId: 't-1',
    scope: { kind: 'user', userId: 'tg:1001' },
    startedAt: 0,
    endedAt: 1234,
    status: 'ok',
    incomingMessageCount: 1,
    toolCalls: [],
    reply: { durationMs: 1234 },
    ...overrides,
  }
}

function makeDashboard(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    connected: true,
    stats: { startedAt: 0, totalMessages: 0, totalLlmCalls: 0, totalToolCalls: 0 },
    sessions: new Map(),
    wizards: new Map(),
    scheduler: {},
    pollers: {},
    messageCache: {},
    llmTraces: [],
    logScopes: new Set(),
    turns: [makeTurn(), makeTurn({ turnId: 't-2' })],
    notifications: [],
    toolFailures: [],
    activeConfigEditors: new Set(),
    scopeFilter: 'all',
    selectedDetail: null,
    activeLogFilter: { include: [], exclude: [], level: 0 },
    logScopeCounts: [],
    logs: [],
    ...overrides,
  }
}

describe('TurnsPanel.svelte', () => {
  test('marks the row matching selectedDetail as selected', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const turn = makeTurn({ turnId: 't-2' })
    const dashboard = makeDashboard({
      turns: [makeTurn(), turn],
      selectedDetail: { kind: 'turn', payload: turn },
    })
    const c = mount(TurnsPanel, { target, props: { dashboard, onShowTurn: () => {}, onShowLogsForTurn: () => {} } })
    const selected = target.querySelectorAll('tr.ui-datatable__tr--selected')
    expect(selected.length).toBe(1)
    void unmount(c)
  })

  test('marks nothing when a different detail kind is selected', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const dashboard = makeDashboard()
    const c = mount(TurnsPanel, { target, props: { dashboard, onShowTurn: () => {}, onShowLogsForTurn: () => {} } })
    expect(target.querySelector('tr.ui-datatable__tr--selected')).toBeNull()
    void unmount(c)
  })
})
```

Create `tests/client/debug/components/SessionCard.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import SessionCard from '../../../../client/debug/components/SessionCard.svelte'
import type { Session } from '../../../../client/debug/dashboard-types.js'

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    userId: 'tg:1001',
    lastAccessed: Date.now(),
    historyLength: 3,
    factsCount: 1,
    summary: null,
    configKeys: [],
    ...overrides,
  }
}

describe('SessionCard.svelte', () => {
  test('applies the selected class when selected is true', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(SessionCard, {
      target,
      props: { userId: 'tg:1001', session: makeSession(), selected: true, onSelect: () => {} },
    })
    expect(target.querySelector('.session-card.selected')).not.toBeNull()
    void unmount(c)
  })

  test('no selected class by default', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(SessionCard, {
      target,
      props: { userId: 'tg:1001', session: makeSession(), onSelect: () => {} },
    })
    expect(target.querySelector('.session-card.selected')).toBeNull()
    void unmount(c)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/debug/components/TurnsPanel.test.ts tests/client/debug/components/SessionCard.test.ts`
Expected: FAIL — no selected classes rendered.

- [ ] **Step 3: Implement**

`client/debug/components/TurnsPanel.svelte` — add the derived id and pass it through:

```ts
  const selectedTurnId = $derived(
    dashboard.selectedDetail?.kind === 'turn' ? dashboard.selectedDetail.payload.turnId : undefined,
  )
```

```svelte
    <DataTable
      {columns}
      rows={turnRows}
      rowKey="id"
      selectedKey={selectedTurnId}
      cell={cellRender}
      onRowClick={selectTurn}>
```

`client/debug/components/SessionCard.svelte` — new prop + class:

```ts
  interface Props {
    userId: string
    session: Session
    wizard?: DashboardWizard
    isOperator?: boolean
    selected?: boolean
    onSelect: () => void
  }

  let { userId, session, wizard, isOperator = false, selected = false, onSelect }: Props = $props()
```

```svelte
<div
  class="session-card"
  class:active={isActive}
  class:selected
  class:operator={isOperator}
  ...
```

`client/debug/components/SessionsList.svelte` — compute per-card:

```svelte
        <SessionCard
          {userId}
          {session}
          wizard={dashboard.wizards.get(userId)}
          isOperator={userId === dashboard.operatorUserId}
          selected={dashboard.selectedDetail?.kind === 'session' && dashboard.selectedDetail.payload.userId === userId}
          onSelect={() => onSelect(userId, session)} />
```

`client/debug/components/TraceList.svelte` — on the `.trace-row` div add:

```svelte
            class:selected={dashboard.selectedDetail?.kind === 'trace' && dashboard.selectedDetail.payload === trace}
```

`client/debug/components/ToolFailuresPanel.svelte` — on the `.failure-row` div add:

```svelte
          class:selected={dashboard.selectedDetail?.kind === 'failure' && dashboard.selectedDetail.payload === f}
```

`client/debug/components/LogExplorer.svelte` — on the `.log-entry` div add:

```svelte
            class:selected={dashboard.selectedDetail?.kind === 'log' && dashboard.selectedDetail.payload.index === fl.originalIndex}
```

`client/debug/debug.css` — extend the shared interaction block from Task 5:

```css
.session-card.selected,
.trace-row.selected,
.failure-row.selected,
.log-entry.selected {
  background: rgba(93, 217, 122, 0.06);
  box-shadow: inset 2px 0 0 var(--accent);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/debug/components/`
Expected: PASS.

- [ ] **Step 5: Add Selected stories** — one per list, e.g. in `TurnsPanel.stories.svelte`:

```svelte
<Story
  name="Selected"
  args={{
    dashboard: makeDashboardState({ selectedDetail: SELECTED_TURN }),
    onShowTurn: noop,
    onShowLogsForTurn: noop,
  }}
/>
```

(`SELECTED_TURN` is already exported from `client/stories/fixtures/debug.ts:81`; import it.) Analogous stories: `SessionsList` with `selectedDetail: { kind: 'session', payload: { userId: 'tg:1001', session: makeSession() } }` (import `makeSession` from the fixtures), `TraceList` with `{ kind: 'trace', payload: makeLlmTrace() }` — careful: selected matching for traces/failures is object identity, so the story must select the *same object instance* the fixture state contains. Add fixture exports instead:

In `client/stories/fixtures/debug.ts` (already exports `SELECTED_TURN`), add:

```ts
export const SELECTED_TRACE: SelectedDetail = { kind: 'trace', payload: makeLlmTrace() }
export const SELECTED_FAILURE: SelectedDetail = { kind: 'failure', payload: makeToolFailure() }
```

and build those stories with `makeDashboardState({ llmTraces: [trace1, trace2... ] })` where the selected payload instance is in the list — simplest: `const trace = makeLlmTrace(); makeDashboardState({ llmTraces: [trace], selectedDetail: { kind: 'trace', payload: trace } })` inline in each story file. For `LogExplorer`: `selectedDetail: { kind: 'log', payload: { entry: makeLogEntry(), index: 0 } }` (index-based, no identity issue).

- [ ] **Step 6: Regenerate specs and shoot**

Run: `bun shoot:gen && bun shoot -g 'debug/components/(TurnsPanel|SessionsList|TraceList|ToolFailuresPanel|LogExplorer)'`
Expected: pass; read one Selected PNG (e.g. TurnsPanel Selected) and confirm the accent-edged selected row.

- [ ] **Step 7: Commit**

```bash
git add client/debug client/stories/fixtures/debug.ts tests/client/debug/components tests/visual/debug
git commit -m "feat(debug): selected-row indication across all detail-rail lists"
```

### Task 7: Filtered panel counts

**Files:**
- Create: `client/debug/panel-count.ts`
- Test: `tests/client/debug/panel-count.test.ts`
- Modify: `client/debug/components/TurnsPanel.svelte`, `ToolFailuresPanel.svelte`, `NotificationsPanel.svelte`

**Interfaces:**
- Produces: `panelCount(filtered: number, total: number, scopeFilter: ScopeFilter): string` — `'42'` when `scopeFilter === 'all'`, else `'7/42'`.

- [ ] **Step 1: Write the failing test** — create `tests/client/debug/panel-count.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { panelCount } from '../../client/debug/panel-count.js'

describe('panelCount', () => {
  test('returns bare total when filter is all', () => {
    expect(panelCount(5, 5, 'all')).toBe('5')
  })

  test('returns filtered/total when a scope filter is active', () => {
    expect(panelCount(1, 5, 'dm')).toBe('1/5')
    expect(panelCount(0, 5, 'group')).toBe('0/5')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/debug/panel-count.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — create `client/debug/panel-count.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ScopeFilter } from './dashboard-types.js'

/**
 * Panel header count that stays honest under the top-bar scope filter:
 * bare total when unfiltered, `filtered/total` when a dm/group filter hides rows.
 */
export function panelCount(filtered: number, total: number, scopeFilter: ScopeFilter): string {
  return scopeFilter === 'all' ? String(total) : `${filtered}/${total}`
}
```

- [ ] **Step 4: Wire into the three panels** — in `TurnsPanel.svelte`:

```svelte
<Panel title="turns" count={panelCount(filtered.length, dashboard.turns.length, dashboard.scopeFilter)}>
```

(with `import { panelCount } from '../panel-count.js'`). In `ToolFailuresPanel.svelte`:

```svelte
<Panel title="tool failures" count={panelCount(filtered.length, dashboard.toolFailures.length, dashboard.scopeFilter)}>
```

In `NotificationsPanel.svelte`:

```svelte
<Panel title="notifications" count={panelCount(filtered.length, dashboard.notifications.length, dashboard.scopeFilter)}>
```

- [ ] **Step 5: Run tests + shoot a filtered state**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/debug/panel-count.test.ts`
Expected: PASS.
Then add a manual test below the generated region of `tests/visual/debug/components/TurnsPanel.spec.ts`:

```ts
test('TurnsPanel — filtered count', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'debug-components-turnspanel--populated')
  await sharedPage.getByRole('button', { name: 'group' }).click()
  await expect(sharedPage).toHaveScreenshot()
})
```

(The Seg in the top bar isn't rendered inside the TurnsPanel story — instead create a `Filtered` story: `args={{ dashboard: makeDashboardState({ scopeFilter: 'dm' }), ... }}` and shoot that; the manual click test applies only to composed `DebugApp` stories. Use the story approach, regenerate, and shoot: `bun shoot:gen && bun shoot -g 'TurnsPanel'`.)

Expected: pass; read the Filtered PNG — header reads `turns 1/2`.

- [ ] **Step 6: Commit**

```bash
git add client/debug/panel-count.ts client/debug/components tests/client/debug/panel-count.test.ts tests/visual/debug
git commit -m "fix(debug): panel header counts reflect active scope filter"
```

### Task 8: Scope-chip legend + activity-scope caption

**Files:**
- Modify: `client/debug/components/ScopeFilter.svelte`
- Modify: `client/debug/components/DebugTopBar.svelte`
- Test: `tests/client/debug/components/ScopeFilter.test.ts` (create)

**Interfaces:** none (leaf change).

- [ ] **Step 1: Write the failing test** — create `tests/client/debug/components/ScopeFilter.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import ScopeFilter from '../../../../client/debug/components/ScopeFilter.svelte'

describe('ScopeFilter.svelte', () => {
  test('renders the tri-state legend', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(ScopeFilter, {
      target,
      props: { scopes: [{ scope: 'bot', count: 3 }], include: [], exclude: [], onChange: () => {} },
    })
    expect(target.textContent).toContain('click to include')
    void unmount(c)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/debug/components/ScopeFilter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — in `ScopeFilter.svelte`, above the `.scope-filter` div:

```svelte
<div class="scope-filter__hint">click to include · again to exclude · again to clear</div>
```

with style:

```css
  .scope-filter__hint {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--fg3);
    padding: 0 4px 4px;
  }
```

In `DebugTopBar.svelte`, immediately before the `<Seg` add a caption label:

```svelte
      <span class="debug-topbar__lbl">activity scope</span>
      <Seg
```

- [ ] **Step 4: Run test + shoot**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/debug/components/ScopeFilter.test.ts && bun shoot -g 'DebugTopBar|LogExplorer'`
Expected: test PASS; shots pass.

- [ ] **Step 5: Commit**

```bash
git add client/debug/components/ScopeFilter.svelte client/debug/components/DebugTopBar.svelte tests/client/debug/components/ScopeFilter.test.ts
git commit -m "fix(debug): scope-chip legend, activity-scope caption on Seg"
```

### Task 9: Operator/active disambiguation + accessible names on icon buttons

**Files:**
- Modify: `client/debug/components/SessionCard.svelte`
- Modify: `client/shared/ui/Btn.svelte`
- Modify: `client/debug/components/DebugDetailRail.svelte`
- Modify: `client/debug/components/LogExplorer.svelte`
- Test: `tests/client/shared/ui/Btn.test.ts` (extend)

**Interfaces:**
- Produces: `Btn` gains optional prop `ariaLabel?: string` (rendered as `aria-label`) — additive; consumed here by the rail ✕ and log-badge ×, available everywhere.

- [ ] **Step 1: Write the failing test** — append inside the describe block of `tests/client/shared/ui/Btn.test.ts` (match its existing mount pattern):

```ts
  test('renders aria-label when ariaLabel is provided', () => {
    // same target setup as neighboring tests
    const c = mount(Btn, { target, props: { ariaLabel: 'Close detail', children: placeholderChildren } })
    expect(target.querySelector('button')?.getAttribute('aria-label')).toBe('Close detail')
    void unmount(c)
  })
```

(Adapt `placeholderChildren` to whatever children-snippet pattern the existing `Btn.test.ts` uses — copy it verbatim from a neighboring test.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/Btn.test.ts`
Expected: FAIL — `aria-label` is null.

- [ ] **Step 3: Implement**

`client/shared/ui/Btn.svelte` — add to props interface and destructuring:

```ts
    ariaLabel?: string
```

```svelte
<button
  class="ui-btn ui-btn--{variant} ui-btn--{size}"
  class:ui-btn--busy={busy}
  {type}
  {disabled}
  aria-busy={busy}
  aria-label={ariaLabel}
  onclick={handleClick}
  data-testid={testid}
>
```

`client/debug/components/DebugDetailRail.svelte:53`:

```svelte
      <Btn variant="ghost" size="sm" ariaLabel="Close detail" onClick={onClear}>{#snippet children()}✕{/snippet}</Btn>
```

`client/debug/components/LogExplorer.svelte:143`:

```svelte
            <Btn variant="ghost" size="sm" ariaLabel="Clear turn filter" onClick={clearTurnFilter}>{#snippet children()}×{/snippet}</Btn>
```

`client/debug/components/SessionCard.svelte` — delete the `.session-card.operator` rule (border + background) from its `<style>` and remove the now-unused `class:operator={isOperator}` binding; keep the `you` badge (`.operator-badge` styles stay).

- [ ] **Step 4: Run tests + shoot**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/ui/Btn.test.ts tests/client/debug/components/ && bun shoot -g 'SessionCard|DebugDetailRail|LogExplorer'`
Expected: all pass; read the SessionCard default PNG — operator styling no longer draws an accent border (the `you` badge remains where applicable).

- [ ] **Step 5: Commit**

```bash
git add client/shared/ui/Btn.svelte client/debug/components tests/client/shared/ui/Btn.test.ts
git commit -m "fix(debug+shared): distinct operator signifier, aria names on icon buttons"
```

### Task 10: Phase 2 verification

**Files:** none modified.

- [ ] **Step 1: Full debug re-shoot**

Run: `bun shoot -g 'debug/'`
Expected: all pass.

- [ ] **Step 2: Read key shots** — `DebugApp-Detail-selected` (selected row + rail), `SessionsList` focus-ring shot, `TurnsPanel` Filtered shot. Confirm H2/H3/M6 visuals.

- [ ] **Step 3: Gates**

Run: `bun run test:client && bun run lint && bun run typecheck`
Expected: pass. Checkoff: H2, H3, M6, M7, M11, L14, L15 closed.

---

## Phase 3 — Layout & content

### Task 11: Shared duration formatter

**Files:**
- Modify: `client/shared/helpers.ts`
- Test: `tests/client/shared/helpers.test.ts` (extend)
- Modify: `client/debug/components/TurnsPanel.svelte`, `client/debug/components/TraceList.svelte`

**Interfaces:**
- Produces: `formatDuration(ms: number): string` — `'<1000'` → `"950ms"`, `>= 1000` → `"1.2s"` (one decimal via `fmtNum`), invalid/negative → `"—"`. Consumed by TurnsPanel, TraceList, and Task 12's TurnDetail.

- [ ] **Step 1: Write the failing test** — append to `tests/client/shared/helpers.test.ts`:

```ts
describe('formatDuration', () => {
  test('sub-second renders as ms', () => {
    expect(formatDuration(950)).toBe('950ms')
  })

  test('seconds render with one decimal', () => {
    expect(formatDuration(1234)).toBe('1.2s')
    expect(formatDuration(540)).toBe('540ms')
  })

  test('invalid input renders a dash', () => {
    expect(formatDuration(Number.NaN)).toBe('—')
    expect(formatDuration(-5)).toBe('—')
  })
})
```

(add `formatDuration` to the existing import from `client/shared/helpers.js`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/helpers.test.ts`
Expected: FAIL — `formatDuration is not a function`.

- [ ] **Step 3: Implement** — append to `client/shared/helpers.ts`:

```ts
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${fmtNum(ms / 1000, 1)}s`
}
```

- [ ] **Step 4: Adopt** — in `TurnsPanel.svelte` replace `{row.durationMs}ms` with `{formatDuration(row.durationMs)}` (import it); in `TraceList.svelte` replace `{fmtNum(trace.duration / 1000, 1)}s` with `{formatDuration(trace.duration)}` (update imports; drop now-unused `fmtNum` there).

- [ ] **Step 5: Run tests + shoot**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/shared/helpers.test.ts && bun shoot -g 'TurnsPanel|TraceList'`
Expected: PASS; shots show `1.2s` in the turns table Duration column.

- [ ] **Step 6: Commit**

```bash
git add client/shared/helpers.ts client/debug/components/TurnsPanel.svelte client/debug/components/TraceList.svelte tests/client/shared/helpers.test.ts
git commit -m "feat(shared): formatDuration, consistent duration display in debug"
```

### Task 12: Scope-label helper + structured TurnDetail

**Files:**
- Create: `client/debug/scope-label.ts`
- Test: `tests/client/debug/scope-label.test.ts`
- Modify: `client/debug/components/TurnsPanel.svelte` (adopt helper)
- Modify: `client/debug/components/TurnDetail.svelte`
- Test: `tests/client/debug/components/TurnDetail.test.ts` (create)
- Modify: `tests/visual/debug/components/TurnDetail.spec.ts` (manual region)

**Interfaces:**
- Produces: `formatScope(scope: Turn['scope']): string` — `dm:<userId>` / `group:<groupId>[/<threadId>]` / `global` (same semantics as the current TurnsPanel `scopeLabel`). TurnDetail keeps `showRaw` local state; raw tree behind a `Btn` toggle.

- [ ] **Step 1: Write the failing tests** — create `tests/client/debug/scope-label.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { formatScope } from '../../client/debug/scope-label.js'

describe('formatScope', () => {
  test('user scope renders dm label', () => {
    expect(formatScope({ kind: 'user', userId: 'tg:1001' })).toBe('dm:tg:1001')
    expect(formatScope({ kind: 'user' })).toBe('dm')
  })

  test('group scope renders group label with optional thread', () => {
    expect(formatScope({ kind: 'group', groupId: 'g1' })).toBe('group:g1')
    expect(formatScope({ kind: 'group', groupId: 'g1', threadId: 'th7' })).toBe('group:g1/th7')
    expect(formatScope({ kind: 'group' })).toBe('group')
  })

  test('global scope renders global', () => {
    expect(formatScope({ kind: 'global' })).toBe('global')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/debug/scope-label.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper** — create `client/debug/scope-label.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Turn } from './dashboard-types.js'

/** Compact scope label shared by the turns table and the detail views. */
export function formatScope(scope: Turn['scope']): string {
  const { kind } = scope
  if (kind === 'user') {
    const userId = 'userId' in scope ? scope.userId : undefined
    return userId ? `dm:${userId}` : 'dm'
  }
  if (kind === 'group') {
    const groupId = 'groupId' in scope ? scope.groupId : undefined
    const threadId = 'threadId' in scope ? scope.threadId : undefined
    const base = groupId ? `group:${groupId}` : 'group'
    return threadId ? `${base}/${threadId}` : base
  }
  return 'global'
}
```

(Adjust the narrowing to the real `Scope` union shape from `src/debug/event-bus.ts` as re-exported via `client/shared/api-types.ts` — the TurnsPanel `scopeLabel` at `TurnsPanel.svelte:31-39` is the source of truth for the field access; move its body here and delete it from TurnsPanel.)

- [ ] **Step 4: Adopt in TurnsPanel** — replace the local `scopeLabel` function with `formatScope` (imported), keeping the `scopeLabel(turn)` call sites working via `formatScope(turn.scope)`.

- [ ] **Step 5: Write the failing TurnDetail test** — create `tests/client/debug/components/TurnDetail.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import TurnDetail from '../../../../client/debug/components/TurnDetail.svelte'
import type { Turn } from '../../../../client/debug/dashboard-types.js'

function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    turnId: 't-1',
    scope: { kind: 'user', userId: 'tg:1001' },
    startedAt: 0,
    endedAt: 1234,
    status: 'ok',
    incomingMessageCount: 1,
    toolCalls: [{ name: 'create_task', durationMs: 120, ok: true }],
    reply: { durationMs: 1234 },
    ...overrides,
  }
}

describe('TurnDetail.svelte', () => {
  test('renders formatted fields and hides the raw tree by default', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(TurnDetail, { target, props: { turn: makeTurn() } })
    expect(target.textContent).toContain('t-1')
    expect(target.textContent).toContain('dm:tg:1001')
    expect(target.textContent).toContain('1.2s')
    expect(target.textContent).toContain('create_task')
    expect(target.querySelector('.tree-container')).toBeNull()
    void unmount(c)
  })

  test('show raw toggle reveals the tree', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(TurnDetail, { target, props: { turn: makeTurn() } })
    const btn = [...target.querySelectorAll('button')].find((b) => b.textContent?.includes('show raw'))!
    btn.click()
    flushSync()
    expect(target.querySelector('.tree-container')).not.toBeNull()
    void unmount(c)
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/debug/components/TurnDetail.test.ts`
Expected: FAIL — raw tree renders immediately / no formatted fields.

- [ ] **Step 7: Implement** — replace `client/debug/components/TurnDetail.svelte` content with:

```svelte
<script lang="ts">
  import { formatDuration, formatTime } from '../../shared/helpers.js'
  import Btn from '../../shared/ui/Btn.svelte'
  import StatusPill from '../../shared/ui/StatusPill.svelte'
  import SummaryList from '../../shared/ui/SummaryList.svelte'
  import TreeView from '../../shared/TreeView.svelte'
  import { formatScope } from '../scope-label.js'
  import type { Turn } from '../dashboard-types.js'

  interface Props {
    turn: Turn
  }

  let { turn }: Props = $props()

  let showRaw = $state(false)

  const durationMs = $derived((turn.endedAt ?? Date.now()) - turn.startedAt)

  const basicInfo = $derived([
    { k: 'Turn ID', v: turn.turnId },
    { k: 'Scope', v: formatScope(turn.scope) },
    { k: 'Status', v: turn.status, pill: true },
    { k: 'Started', v: formatTime(turn.startedAt) },
    { k: 'Ended', v: turn.endedAt === undefined ? '—' : formatTime(turn.endedAt) },
    { k: 'Duration', v: formatDuration(durationMs) },
    { k: 'Messages', v: String(turn.incomingMessageCount) },
  ])
</script>

<div class="session-detail-section">
  <h4>Basic Info</h4>
  <SummaryList items={basicInfo} />
</div>

{#if turn.error !== undefined && turn.error !== ''}
  <div class="session-detail-section">
    <h4>Error</h4>
    <pre class="tool-json error">{turn.error}</pre>
  </div>
{/if}

{#if turn.toolCalls.length > 0}
  <div class="session-detail-section">
    <h4>Tool Calls ({turn.toolCalls.length})</h4>
    <div class="tool-calls-list">
      {#each turn.toolCalls as tc, i (i)}
        <div class="tool-call-item" class:error={!tc.ok}>
          <div class="tool-call-summary">
            <span class="tool-name">{tc.name}</span>
            <span class="tool-duration">{formatDuration(tc.durationMs)}</span>
            <StatusPill status={tc.ok ? 'ok' : 'failed'} />
          </div>
        </div>
      {/each}
    </div>
  </div>
{/if}

<div class="session-detail-section">
  <Btn variant="ghost" size="sm" onClick={() => (showRaw = !showRaw)}>
    {#snippet children()}{showRaw ? 'hide raw' : 'show raw'}{/snippet}
  </Btn>
  {#if showRaw}
    <div class="tree-container">
      <TreeView value={turn} />
    </div>
  {/if}
</div>
```

(Verify the `Turn`/`ToolCall` field names — `tc.name`, `tc.durationMs`, `tc.ok` — against `client/shared/api-types.ts` `ToolCall`; the TurnsPanel row builder at `TurnsPanel.svelte:77` uses `tc.name`, and the fixture uses `{ name, durationMs, ok }`.)

- [ ] **Step 8: Run tests + add raw-expanded visual test + shoot**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/debug/components/TurnDetail.test.ts tests/client/debug/scope-label.test.ts`
Expected: PASS.
Append to `tests/visual/debug/components/TurnDetail.spec.ts` below the generated region:

```ts
test('TurnDetail — raw expanded', async ({ sharedPage }) => {
  await switchStory(sharedPage, 'debug-components-turndetail--completed')
  await sharedPage.getByText('show raw').click()
  await expect(sharedPage).toHaveScreenshot()
})
```

Run: `bun shoot -g 'TurnDetail|DebugDetailRail'`
Expected: pass; read the TurnDetail Completed PNG — structured SummaryList with status pill, no raw JSON.

- [ ] **Step 9: Commit**

```bash
git add client/debug/scope-label.ts client/debug/components tests/client/debug
git commit -m "feat(debug): structured TurnDetail with collapsible raw tree"
```

### Task 13: Structured FailureDetail

**Files:**
- Modify: `client/debug/components/FailureDetail.svelte`
- Test: `tests/client/debug/components/FailureDetail.test.ts` (create)

**Interfaces:**
- Consumes: `formatScope` (Task 12), `Btn`, `SummaryList`, `TreeView`, `formatTime`.

- [ ] **Step 1: Write the failing test** — create `tests/client/debug/components/FailureDetail.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import FailureDetail from '../../../../client/debug/components/FailureDetail.svelte'
import type { ToolFailure } from '../../../../client/debug/dashboard-types.js'

function makeFailure(overrides: Partial<ToolFailure> = {}): ToolFailure {
  return {
    timestamp: 0,
    scope: { kind: 'user', userId: 'tg:1001' },
    data: { toolName: 'create_task', error: 'project not found', errorType: 'validation', retriable: false },
    ...overrides,
  }
}

describe('FailureDetail.svelte', () => {
  test('renders formatted fields and hides the raw tree by default', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(FailureDetail, { target, props: { failure: makeFailure() } })
    expect(target.textContent).toContain('create_task')
    expect(target.textContent).toContain('project not found')
    expect(target.textContent).toContain('dm:tg:1001')
    expect(target.textContent).toContain('non-retriable')
    expect(target.querySelector('.tree-container')).toBeNull()
    void unmount(c)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/debug/components/FailureDetail.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — replace `client/debug/components/FailureDetail.svelte` content with:

```svelte
<script lang="ts">
  import { formatTime } from '../../shared/helpers.js'
  import Btn from '../../shared/ui/Btn.svelte'
  import SummaryList from '../../shared/ui/SummaryList.svelte'
  import TreeView from '../../shared/TreeView.svelte'
  import { formatScope } from '../scope-label.js'
  import type { ToolFailure } from '../dashboard-types.js'

  interface Props {
    failure: ToolFailure
  }

  let { failure }: Props = $props()

  let showRaw = $state(false)

  const toolName = $derived(typeof failure.data['toolName'] === 'string' ? failure.data['toolName'] : 'unknown')
  const errorText = $derived(typeof failure.data['error'] === 'string' ? failure.data['error'] : '')
  const retriable = $derived(
    failure.data['retriable'] === true ? 'retriable' : failure.data['retriable'] === false ? 'non-retriable' : undefined,
  )

  const basicInfo = $derived.by(() => {
    const items = [
      { k: 'Tool', v: toolName },
      { k: 'Time', v: formatTime(failure.timestamp) },
      { k: 'Scope', v: formatScope(failure.scope) },
    ]
    if (retriable !== undefined) items.push({ k: 'Retriable', v: retriable })
    return items
  })
</script>

<div class="session-detail-section">
  <h4>Tool Failure</h4>
  <SummaryList items={basicInfo} />
</div>

{#if errorText !== ''}
  <div class="session-detail-section">
    <h4>Error</h4>
    <pre class="tool-json error">{errorText}</pre>
  </div>
{/if}

<div class="session-detail-section">
  <Btn variant="ghost" size="sm" onClick={() => (showRaw = !showRaw)}>
    {#snippet children()}{showRaw ? 'hide raw' : 'show raw'}{/snippet}
  </Btn>
  {#if showRaw}
    <div class="tree-container">
      <TreeView value={failure} />
    </div>
  {/if}
</div>
```

- [ ] **Step 4: Run test + shoot**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/debug/components/FailureDetail.test.ts && bun shoot -g 'FailureDetail|DebugDetailRail'`
Expected: PASS; read the FailureDetail Default PNG — structured view, no raw JSON.

- [ ] **Step 5: Commit**

```bash
git add client/debug/components/FailureDetail.svelte tests/client/debug/components/FailureDetail.test.ts
git commit -m "feat(debug): structured FailureDetail with collapsible raw tree"
```

### Task 14: Responsive breakpoints

**Files:**
- Modify: `client/debug/debug.css`
- Modify: `client/debug/components/DebugTopBar.svelte` (scoped style)

**Interfaces:** none.

- [ ] **Step 1: Shoot the failing narrow baselines**

Run: `bun shoot -g 'DebugApp —'`
Expected: pass (baselines exist from the review); re-read `.storybook-shots/debug/DebugApp.spec.ts/DebugApp-—-narrow-640px-1.png` — confirm the overlap/overflow is still present.

- [ ] **Step 2: Implement** — append to `client/debug/debug.css`:

```css
@media (max-width: 720px) {
  .debug-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .debug-grid__center-row {
    grid-template-columns: minmax(0, 1fr);
  }
  #sessions {
    max-height: none;
  }
}
```

In `DebugTopBar.svelte` `<style>` append:

```css
  @media (max-width: 720px) {
    .debug-topbar__status,
    .debug-topbar__secondary {
      flex-wrap: wrap;
      gap: 8px;
    }
  }
```

- [ ] **Step 3: Re-shoot narrow + desktop**

Run: `bun shoot -g 'DebugApp'`
Expected: pass; read both narrow PNGs — single stacked column, no overlap, failure text wraps normally; read the desktop `debug-DebugApp-Default-1.png` — unchanged three-column layout.

- [ ] **Step 4: Commit**

```bash
git add client/debug/debug.css client/debug/components/DebugTopBar.svelte
git commit -m "fix(debug): 720px responsive collapse for dashboard grid and top bar"
```

### Task 15: Disconnect banner, stale stats, logs-error note

**Files:**
- Modify: `client/debug/dashboard-types.ts`
- Modify: `client/debug/DebugApp.svelte`
- Modify: `client/debug/components/DebugTopBar.svelte`
- Modify: `client/debug/components/LogExplorer.svelte`
- Modify: `client/debug/debug.css`
- Test: `tests/client/debug/components/LogExplorer.test.ts` (extend)

**Interfaces:**
- Produces: `DashboardState.logsError?: string` — set by `DebugApp` when the initial log fetch fails, rendered by `LogExplorer`. Fixtures need no change (optional field).

- [ ] **Step 1: Write the failing test** — append inside the describe block of `tests/client/debug/components/LogExplorer.test.ts`:

```ts
  test('shows the logs-error note when logsError is set', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const dashboard = { ...makeDashboard(), logsError: 'initial log load failed' }
    const c = mount(LogExplorer, { target, props: { dashboard, onSelectLog: () => {} } })
    expect(target.textContent).toContain('initial log load failed')
    void unmount(c)
  })
```

(`makeDashboard` is the local factory already in that file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/debug/components/LogExplorer.test.ts`
Expected: FAIL (type error: `logsError` unknown, or assertion fails).

- [ ] **Step 3: Implement**

`client/debug/dashboard-types.ts` — add to `DashboardState` (after `logScopeCounts`):

```ts
  /** Set when the initial log bootstrap fetch failed; live SSE may still deliver events. */
  logsError?: string
```

`client/debug/DebugApp.svelte` — in the filter `$effect`, set/clear the flag:

```ts
    void untrack(async () => {
      try {
        const parsed = parseLogsArray(await fetchInitialLogs(dashboard.activeLogFilter))
        dashboard.logs = parsed
        dashboard.logScopeCounts = await fetchScopes()
        for (const scope of collectScopes(parsed)) dashboard.logScopes.add(scope)
        dashboard.logsError = undefined
      } catch {
        // SSE will populate from live events; tell the user the bootstrap failed.
        dashboard.logsError = 'initial log load failed — live stream may still deliver events'
      }
    })
```

`client/debug/components/LogExplorer.svelte` — after the `bufferStats` span block:

```svelte
      {#if dashboard.logsError !== undefined}
        <span class="log-bufferstat log-bufferstat--error">{dashboard.logsError}</span>
      {/if}
```

with scoped style:

```css
  .log-bufferstat--error {
    color: var(--warn);
  }
```

`client/debug/DebugApp.svelte` — banner above the grid (first child of the `children` snippet):

```svelte
    {#if !dashboard.connected}
      <div class="debug-banner" role="status">stream disconnected — showing last buffered data, reconnecting…</div>
    {/if}
```

`client/debug/debug.css` — append:

```css
.debug-banner {
  margin: 12px 16px 0;
  padding: 8px 12px;
  border: 1px solid var(--danger);
  border-radius: 2px;
  background: var(--danger-soft);
  color: var(--danger);
  font-family: var(--font-mono);
  font-size: 12px;
}
```

`client/debug/components/DebugTopBar.svelte` — dim stale stats: change the status row div to

```svelte
    <div class="debug-topbar__status" class:stale={!dashboard.connected}>
```

and append to its scoped style:

```css
  .debug-topbar__status.stale .debug-topbar__stat {
    color: var(--fg3);
  }
```

- [ ] **Step 4: Run test + shoot disconnected story**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/debug/components/LogExplorer.test.ts && bun shoot -g 'DebugApp'`
Expected: PASS; read `debug-DebugApp-Disconnected-empty-1.png` — red banner visible under the top bar, stat counters dimmed.

- [ ] **Step 5: Commit**

```bash
git add client/debug/dashboard-types.ts client/debug/DebugApp.svelte client/debug/components client/debug/debug.css tests/client/debug/components/LogExplorer.test.ts
git commit -m "feat(debug): disconnect banner, stale-stat dimming, logs-error note"
```

### Task 16: Empty-state hints everywhere

**Files:**
- Modify: `client/debug/components/TurnsPanel.svelte`, `TraceList.svelte`, `NotificationsPanel.svelte`, `ToolFailuresPanel.svelte`, `LiveContextCard.svelte`, `SessionsList.svelte`
- Test: `tests/client/debug/components/ToolFailuresPanel.test.ts` (create, one assertion)

**Interfaces:** consumes shared `EmptyState` `hint` prop (already exists at `client/shared/ui/EmptyState.svelte:12`).

- [ ] **Step 1: Write the failing test** — create `tests/client/debug/components/ToolFailuresPanel.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import ToolFailuresPanel from '../../../../client/debug/components/ToolFailuresPanel.svelte'
import type { DashboardState } from '../../../../client/debug/dashboard-types.js'

function makeDashboard(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    connected: true,
    stats: { startedAt: 0, totalMessages: 0, totalLlmCalls: 0, totalToolCalls: 0 },
    sessions: new Map(),
    wizards: new Map(),
    scheduler: {},
    pollers: {},
    messageCache: {},
    llmTraces: [],
    logScopes: new Set(),
    turns: [],
    notifications: [],
    toolFailures: [],
    activeConfigEditors: new Set(),
    scopeFilter: 'all',
    selectedDetail: null,
    activeLogFilter: { include: [], exclude: [], level: 0 },
    logScopeCounts: [],
    logs: [],
    ...overrides,
  }
}

describe('ToolFailuresPanel.svelte', () => {
  test('empty state explains itself', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(ToolFailuresPanel, { target, props: { dashboard: makeDashboard(), onShowFailure: () => {} } })
    expect(target.textContent).toContain('No failures')
    expect(target.textContent).toContain('buffered window')
    void unmount(c)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/debug/components/ToolFailuresPanel.test.ts`
Expected: FAIL — no hint text.

- [ ] **Step 3: Implement** — hints per panel:

`ToolFailuresPanel.svelte`:
```svelte
<EmptyState title="No failures" hint="no tool failures in the buffered window" />
```

`TurnsPanel.svelte`:
```svelte
<EmptyState title="No turns" hint="turns appear here as messages are processed" />
```

`TraceList.svelte`:
```svelte
<EmptyState title="No traces" hint="LLM traces appear here after the next model call" />
```

`NotificationsPanel.svelte`:
```svelte
<EmptyState title="No notifications" hint="outbound replies and typing events appear here as they happen" />
```

`LiveContextCard.svelte`:
```svelte
<EmptyState title="No active sessions" hint="config editors and setup wizards appear here while active" />
```

`SessionsList.svelte` — currently renders nothing when empty; add an empty branch inside the Panel body:

```svelte
    {#snippet body()}
      {#if entries.length === 0}
        <EmptyState title="No sessions" hint="sessions appear here as users talk to the bot" />
      {:else}
        {#each entries as [userId, session] (userId)}
          <SessionCard
            {userId}
            {session}
            wizard={dashboard.wizards.get(userId)}
            isOperator={userId === dashboard.operatorUserId}
            selected={dashboard.selectedDetail?.kind === 'session' && dashboard.selectedDetail.payload.userId === userId}
            onSelect={() => onSelect(userId, session)} />
        {/each}
      {/if}
    {/snippet}
```

(add `import EmptyState from '../../shared/ui/EmptyState.svelte'`.)

- [ ] **Step 4: Run test + shoot empties**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/debug/components/ && bun shoot -g 'Empty|Disconnected'`
Expected: PASS; read one empty PNG (e.g. ToolFailuresPanel Empty) — hint text under the title.

- [ ] **Step 5: Commit**

```bash
git add client/debug/components tests/client/debug/components/ToolFailuresPanel.test.ts
git commit -m "fix(debug): actionable hints on every empty state"
```

### Task 17: Dead CSS removal + style consolidation

**Files:**
- Modify: `client/debug/debug.css` (deletions)
- Modify: `client/debug/components/SessionCard.svelte`, `TraceList.svelte`, `ToolFailuresPanel.svelte`, `NotificationsPanel.svelte`, `LogExplorer.svelte`, `SessionDetail.svelte` (scoped style gains)

**Interfaces:** consumes Task 5/6 interaction rules — those stay in `debug.css` (they span four components); everything single-component moves into that component's scoped block.

- [ ] **Step 1: Verify dead selectors** — each of these must return zero matches outside `debug.css` before deletion:

Run: `rg -n "placeholder|turn-row|turn-summary|turn-log-link|log-autoscroll|log-toolbar|log-filters" client/debug --glob '!debug.css'`
Run: `rg -n "config-table" client/debug --glob '!debug.css'`
Expected: no matches (any match = keep that block).

- [ ] **Step 2: Delete dead blocks from `debug.css`** — remove: `.placeholder` (17-20), turn rows (22-99: `.turn-row` … `.turn-log-link`), notification rows stay until Step 3 moves them, `#log-autoscroll` (388-405), `.log-toolbar` (273-297), `.log-filters` (292-323), `#log-entries` global dup (325-330), global `.log-entry`/`.log-meta`/`.log-msg` base rules (332-360) — keep `.log-debug/.log-info/.log-warn/.log-error` level-color rules for now (moved in Step 4), `#sessions h2, #llm-trace h2` (185-193 — Panel renders `.ui-panel__title`, not `h2`), `.config-table` block (477-507 — SessionDetail now uses DataTable), and the `.tree-toggle`/`.tree-*` rules duplicated by `TreeView.svelte` scoped styles (keep `.tree-container`; delete `.tree-table`, `.tree-key-cell`, `.tree-value-cell`, `.tree-empty`, `.tree-toggle`, `.tree-children`, `.tree-bracket`, `.tree-key`, `.tree-string`, `.tree-number`, `.tree-boolean`, `.tree-null`, `.tree-undefined`, `.tree-array`, `.tree-object`).

- [ ] **Step 3: Move single-component row styles into scoped blocks**

- `NotificationsPanel.svelte`: move `.notification-row`, `.notification-time`, `.notification-type`, `.notification-text` from `debug.css` into a new scoped `<style>` (verbatim rules).
- `ToolFailuresPanel.svelte`: move `.failure-row`, `.failure-summary`, `.failure-time`, `.failure-tool`, `.failure-error`.
- `TraceList.svelte`: move `.trace-row`, `.trace-summary`, `.trace-time`, `.trace-user`, `.trace-model`, `.trace-duration`.
- `SessionCard.svelte`: move `.session-card` base (border-left, padding `6px 8px` — reconcile with the scoped `padding: 10px 12px`: keep `10px 12px`, drop `6px 8px`), `.session-card:hover`, `.session-card.active`, `.session-card .user-id`, `.session-card .session-detail`, `.session-card .wizard-badge` from `debug.css` into its existing scoped block; change `.session-detail` color from `var(--fg4)` to `var(--fg3)` (covers the L16 session-card part).
- `LogExplorer.svelte`: move the level-color rules (`.log-debug .log-meta, .log-debug .log-msg`, `.log-info …`, `.log-warn …`, `.log-error …`) into its scoped block.

- [ ] **Step 4: SessionDetail facts get their own classes** — in `SessionDetail.svelte`, replace the facts markup's `tool-calls-list` / `tool-call-item` / `tool-call-summary` / `tool-name` / `tool-id` classes with `facts-list` / `fact-item` / `fact-summary` / `fact-title` / `fact-id`, and add scoped styles mirroring the layout (flex column `gap: 12px`; item `background: var(--raised); border-left: 3px solid var(--accent); padding: 12px;` etc.). Move `.instructions-list`/`.instruction-item` and `.history-list`/`.history-item` rules from `debug.css` into `SessionDetail.svelte` scoped (they have no other consumer — verify with `rg -n "instruction-item|history-item" client/debug --glob '!debug.css'`). Change `.history-meta` and `.instruction-meta` color from `var(--fg3)`/current value to `var(--fg3)` if currently `var(--fg4)` (L16 part).

- [ ] **Step 5: Shoot everything debug + read three shots**

Run: `bun shoot -g 'debug/'`
Expected: pass; read `SessionsList Populated`, `NotificationsPanel Populated`, `SessionDetail With-facts-and-config` PNGs — visually identical to before (modulo the `fg3` bump), nothing unstyled.

- [ ] **Step 6: Gates + commit**

Run: `bun run lint && bun run typecheck && bun run format`

```bash
git add client/debug
git commit -m "refactor(debug): delete dead css, co-locate component styles"
```

### Task 18: Contrast bumps + poller pill text

**Files:**
- Modify: `client/debug/components/DebugTopBar.svelte`
- Modify: `client/debug/components/LogExplorer.svelte` (`.log-history__note` color)
- Test: `tests/client/debug/components/DebugTopBar.test.ts` (create)

**Interfaces:** none.

- [ ] **Step 1: Write the failing test** — create `tests/client/debug/components/DebugTopBar.test.ts` (follow the `ScopeFilter.test.ts` mount pattern; construct a minimal `DashboardState` like `ToolFailuresPanel.test.ts`):

```ts
  test('poller pills include on/off state in text', () => {
    // dashboard with pollers: { scheduledRunning: true, alertsRunning: false }
    expect(target.textContent).toContain('scheduled · on')
    expect(target.textContent).toContain('alerts · off')
  })
```

(Full file required: license header, imports for `DebugTopBar.svelte` + `DashboardState`, the `makeDashboard` factory, and the describe block.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/debug/components/DebugTopBar.test.ts`
Expected: FAIL — pills render bare `scheduled` / `alerts`.

- [ ] **Step 3: Implement** — in `DebugTopBar.svelte` change the two poller pills:

```svelte
      <Pill tone={dashboard.pollers.scheduledRunning ? 'accent' : 'mute'} dot>{#snippet children()}scheduled · {dashboard.pollers.scheduledRunning ? 'on' : 'off'}{/snippet}</Pill>
      <Pill tone={dashboard.pollers.alertsRunning ? 'accent' : 'mute'} dot>{#snippet children()}alerts · {dashboard.pollers.alertsRunning ? 'on' : 'off'}{/snippet}</Pill>
```

In `LogExplorer.svelte` scoped style change `.log-history__note` color from `var(--fg4)` to `var(--fg3)`.

- [ ] **Step 4: Run test + shoot**

Run: `bun --conditions=browser test --preload ./tests/client-setup.ts --path-ignore-patterns '' tests/client/debug/components/DebugTopBar.test.ts && bun shoot -g 'DebugTopBar'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/debug/components tests/client/debug/components/DebugTopBar.test.ts
git commit -m "fix(debug): poller state in pill text, fg3 floor for meta text"
```

### Task 19: Final verification + finding checkoff

**Files:** none modified.

- [ ] **Step 1: Full gates**

Run: `bun run test:client && bun run lint && bun run typecheck && bun run format`
Expected: all pass.

- [ ] **Step 2: Full debug + shared + composed re-shoot**

Run: `bun shoot -g 'debug/|DataTable|TreeView|SummaryList|SettingsApp|AdminApp'`
Expected: all pass.

- [ ] **Step 3: Walk the 17 findings against shots and source**

For each finding in `docs/ux-reviews/DebugApp.md`, confirm closure: H1 (narrow PNGs stack cleanly), H2 (focus-ring PNGs + DataTable tests), H3 (Selected PNGs), H4 (Disconnected PNG shows banner + dimmed stats), M5 (Turn/Failure detail PNGs structured), M6 (Filtered count PNG), M7 (activity-scope caption in TopBar PNG), M8 (Empty PNGs show hints), M9 (bracket rows in rail PNG), M10 (SummaryList long-values PNG), M11 (legend in ScopeFilter source + LogExplorer PNG), L12 (debug.css shrunk; `rg -c "" client/debug/debug.css` well under 1046 lines), L13 (`1.2s` in turns PNG), L14 (operator has badge only), L15 (aria-labels in source), L16 (no `fg4` on the bumped selectors), L17 (`scheduled · on` in TopBar PNG).

- [ ] **Step 4: Record the checkoff** — include the 17/17 finding list in the final commit message or PR description (no edits to the report-only review doc).

```bash
git commit --allow-empty -m "docs(debug): close all 17 findings from docs/ux-reviews/DebugApp.md"
```

(Or fold into the PR description if a PR follows immediately.)

---

## Self-Review Notes

- **Spec coverage:** all 17 findings + all three phases mapped (see finding→task table in the spec; every finding has a closing task: H1→14, H2→1+5, H3→6, H4→15, M5→12+13, M6→7, M7→8, M8→16, M9→2, M10→3, M11→8, L12→17, L13→11, L14→9, L15→9, L16→17+18, L17→18).
- **Type consistency:** `panelCount`, `formatScope`, `formatDuration`, `Btn ariaLabel`, `SessionCard selected`, `DashboardState.logsError` defined once and consumed with the same names across tasks.
- **Known execution-time verifications** (flagged inline where they occur): exact `Scope` union narrowing in `scope-label.ts`; `ToolCall` field names; `Btn.test.ts` children-snippet pattern; `TreeView.svelte` collapsed-bracket placement.
