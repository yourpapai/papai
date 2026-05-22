<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Dashboard Redesign — PR 2: `/debug` Shell + Right Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the `/debug` page as a three-column Telemetry shell — `DebugTopBar` on top, sessions/traces left rail, panels in the center, swappable detail rail on the right. Collapse the five separate `<Modal>` overlays + five `selected*` state cells into a single `selectedDetail: SelectedDetail` discriminated union rendered by a new `DebugDetailRail`. Replace the per-group `ContextChips` button row with a simpler `Seg(all|dm|group)` filter wired to `dashboard.scopeFilter`.

**Architecture:** All new structure is composition over the primitives shipped in PR 1 (`Shell`, `TopBar`, `Panel`, `Pill`, `Btn`, `Seg`, `Caption`, `KV`, `Dot`, `HR`). The existing per-detail components (`TurnDetail`, `TraceDetail`, `SessionDetail`, `LogDetail`, `FailureDetail`) are reused as-is — only their containers change. The dashboard state shape gets two surgical edits: `activeContext: string` → `scopeFilter: 'all' | 'dm' | 'group'`, and a new `selectedDetail: SelectedDetail` cell. Per-group filtering granularity is intentionally dropped per spec §7 (YAGNI).

**Tech Stack:** Svelte 5 (runes + snippets), Bun test runner (`bun:test`), happy-dom. No new dependencies. Reuses every primitive from PR 1.

**Reference spec:** `docs/superpowers/specs/2026-05-22-dashboard-redesign-design.md` section 7.

**Reference prototype:** `client/assets/bs-debug.jsx` (synthetic layout target) and `client/assets/bs-debug-*.jsx` (per-panel prototypes — informational only).

---

## File Structure

**Create:**

- `client/debug/components/DebugTopBar.svelte` — composes `<Shell>` + `<TopBar>` with debug-specific `statusRow` and `secondaryRow` snippets.
- `client/debug/components/DebugDetailRail.svelte` — pattern-matches `SelectedDetail.kind` and embeds the appropriate detail component plus a header (caps caption + entity id + ghost `✕` button).
- `tests/client/debug/components/DebugTopBar.test.ts`
- `tests/client/debug/components/DebugDetailRail.test.ts`

**Modify:**

- `client/debug/dashboard-types.ts` — drop `activeContext: string`; add `scopeFilter: 'all' | 'dm' | 'group'`; add `SelectedDetail` discriminated union and `selectedDetail: SelectedDetail` field.
- `client/debug/debug.svelte.ts` — initial state: replace `activeContext: 'all'` with `scopeFilter: 'all'`, add `selectedDetail: null`.
- `client/debug/components/TurnsPanel.svelte` — replace `matchesContext(turn, dashboard.activeContext)` with `matchesScope(turn, dashboard.scopeFilter)`; drop the `group:<id>` branch.
- `client/debug/components/NotificationsPanel.svelte` — same edit.
- `client/debug/components/ToolFailuresPanel.svelte` — same edit.
- `client/debug/DebugApp.svelte` — full rewrite: use `DebugTopBar`, three-column grid, single `selectedDetail` cell + `DebugDetailRail` in the right rail, `LiveContextCard` under it. All five `<Modal>` overlays and five `selected*` cells removed.
- `client/debug/debug.css` — drop `.header*`, `.context-chips`, `.panel-grid`, `#left-panel`, old `main` grid; add `.debug-grid`, `.debug-grid__left`, `.debug-grid__center`, `.debug-grid__right`, `.debug-detail-rail`. Center inner row (`Notifications | Failures`) stays as a sub-grid.

**Delete:**

- `client/debug/components/Header.svelte` (replaced by `DebugTopBar`).
- `client/debug/components/ContextChips.svelte` (replaced by `Seg` in `DebugTopBar.secondaryRow`).
- `tests/client/debug/components/Header.test.ts` (if it exists — check before deleting).
- `tests/client/debug/components/ContextChips.test.ts` (if it exists — check before deleting).

**Tests stay green:**

- `tests/client/debug/components/TurnsPanel.test.ts` — needs one edit: `state.activeContext = 'dm'` → `state.scopeFilter = 'dm'`.
- `tests/client/debug/components/DebugApp.test.ts` — needs one edit: `activeContext: 'all'` → `scopeFilter: 'all'` plus `selectedDetail: null`.
- `tests/client/debug/handlers.test.ts` — same rename.
- `tests/client/debug/sse.test.ts` — same rename.
- `tests/client/debug/debug.svelte.test.ts` — assertion update: `state.activeContext` → `state.scopeFilter`.
- `tests/client/debug/dashboard-types.test.ts` — add coverage for new `SelectedDetail` union if the test file declares state-shape checks.

---

## Task 1: Update `dashboard-types.ts` (types only, no logic)

**Files:**

- Modify: `client/debug/dashboard-types.ts`

- [ ] **Step 1: Read the current file**

Run: `cat client/debug/dashboard-types.ts | head -120`
Identify the `DashboardState` interface (around line 101) and confirm the current `activeContext: string` field on line 116.

- [ ] **Step 2: Apply the type edits**

Replace lines 101–118 of `client/debug/dashboard-types.ts` with the following. Keep all imports and the leading `DashboardWizard` / `DashboardStats` types untouched.

```ts
export type ScopeFilter = 'all' | 'dm' | 'group'

export type SelectedDetail =
  | { kind: 'turn'; payload: Turn }
  | { kind: 'trace'; payload: LlmTrace }
  | { kind: 'session'; payload: { userId: string; session: Session } }
  | { kind: 'log'; payload: { entry: LogEntry; index: number } }
  | { kind: 'failure'; payload: ToolFailure }
  | null

export interface DashboardState {
  connected: boolean
  stats: DashboardStats
  sessions: Map<string, Session>
  wizards: Map<string, DashboardWizard>
  scheduler: SchedulerInfo
  pollers: PollersInfo
  messageCache: MessageCacheInfo
  llmTraces: LlmTrace[]
  logs: LogEntry[]
  logScopes: Set<string>
  turns: Turn[]
  notifications: Notification[]
  toolFailures: ToolFailure[]
  activeConfigEditors: Set<string>
  scopeFilter: ScopeFilter
  selectedDetail: SelectedDetail
  activeLogFilter: { turnId?: string }
}
```

- [ ] **Step 3: Run typecheck — expect failures (this is intentional)**

Run: `bun typecheck 2>&1 | grep -E "(activeContext|scopeFilter|selectedDetail)" | head -30`
Expected: a list of files still referencing the removed `activeContext` — this is the work list for the next tasks.

- [ ] **Step 4: Do NOT commit yet**

Hold the commit until the rename has propagated through every consumer in subsequent tasks. The branch is intentionally red between tasks 1 and 6.

---

## Task 2: Update `debug.svelte.ts` initial state

**Files:**

- Modify: `client/debug/debug.svelte.ts`

- [ ] **Step 1: Locate the state initializer**

Open `client/debug/debug.svelte.ts`. Find the `$state` initializer block (around line 23, where `activeContext: 'all'` sits).

- [ ] **Step 2: Replace `activeContext` with `scopeFilter` and add `selectedDetail`**

Change the initializer so that:

- `activeContext: 'all'` becomes `scopeFilter: 'all'`
- A new `selectedDetail: null` field is added (no type annotation needed — the `DashboardState` interface drives it; if a type cast is required, use `null satisfies SelectedDetail`).

If the file lacks a `SelectedDetail` import, add it to the existing import line from `./dashboard-types.js`.

- [ ] **Step 3: Run typecheck on this file specifically**

Run: `bun tsc --noEmit client/debug/debug.svelte.ts 2>&1 | tail -10`
Expected: no errors local to this file. (Other files still reference `activeContext` — that's tasks 3–5.)

- [ ] **Step 4: Hold the commit (still red downstream)**

---

## Task 3: Migrate `TurnsPanel.svelte`

**Files:**

- Modify: `client/debug/components/TurnsPanel.svelte`

- [ ] **Step 1: Locate `matchesContext`**

Read `client/debug/components/TurnsPanel.svelte`. The function on line 32–40 takes `(turn: Turn, activeContext: string)` and includes a `group:<id>` branch.

- [ ] **Step 2: Rename and simplify**

Rename `matchesContext` to `matchesScope`, change its signature to `(turn: Turn, scope: ScopeFilter)`, and remove the `group:<id>` branch entirely. The whole helper becomes:

```ts
function matchesScope(turn: Turn, scope: ScopeFilter): boolean {
  if (scope === 'all') return true
  if (scope === 'dm') return turn.scope.kind === 'user'
  return turn.scope.kind === 'group'
}
```

Update the `$derived` call site:

```ts
const filtered = $derived(dashboard.turns.filter((t) => matchesScope(t, dashboard.scopeFilter)))
```

Add a `ScopeFilter` type import from `../dashboard-types.js` if the file does not already include it.

- [ ] **Step 3: Run the existing TurnsPanel test**

Run: `bun test:client tests/client/debug/components/TurnsPanel.test.ts 2>&1 | tail -20`
Expected: FAIL on the line `state.activeContext = 'dm'` — that test still uses the old field. Leave the test alone; Task 6 updates all callers in one sweep.

- [ ] **Step 4: Hold the commit**

---

## Task 4: Migrate `NotificationsPanel.svelte`

**Files:**

- Modify: `client/debug/components/NotificationsPanel.svelte`

- [ ] **Step 1: Apply the same rename**

Replace `matchesContext(scope: Notification['scope'], activeContext: string)` with:

```ts
function matchesScope(scope: Notification['scope'], filter: ScopeFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'dm') return scope.kind === 'user'
  return scope.kind === 'group'
}
```

Update the `$derived` call site to read `dashboard.scopeFilter` and call `matchesScope(n.scope, dashboard.scopeFilter)`.

Add the `ScopeFilter` import from `../dashboard-types.js`.

- [ ] **Step 2: Hold the commit**

---

## Task 5: Migrate `ToolFailuresPanel.svelte`

**Files:**

- Modify: `client/debug/components/ToolFailuresPanel.svelte`

- [ ] **Step 1: Apply the same rename**

Mirror Task 4 against this file. Helper becomes:

```ts
function matchesScope(scope: ToolFailure['scope'], filter: ScopeFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'dm') return scope.kind === 'user'
  return scope.kind === 'group'
}
```

Update the `$derived` call site.

- [ ] **Step 2: Hold the commit**

---

## Task 6: Update tests that reference `activeContext`

**Files:**

- Modify: `tests/client/debug/handlers.test.ts`
- Modify: `tests/client/debug/sse.test.ts`
- Modify: `tests/client/debug/debug.svelte.test.ts`
- Modify: `tests/client/debug/components/TurnsPanel.test.ts`
- Modify: `tests/client/debug/components/DebugApp.test.ts`

- [ ] **Step 1: Find every occurrence**

Run: `grep -rn "activeContext" tests/client/debug/`
Expected: 6 lines across 5 files.

- [ ] **Step 2: Rename each**

For each occurrence:

- `activeContext: 'all'` → `scopeFilter: 'all'`
- `activeContext: 'dm'` → `scopeFilter: 'dm'`
- `state.activeContext = 'dm'` → `state.scopeFilter = 'dm'`
- `expect(state.activeContext).toBe('all')` → `expect(state.scopeFilter).toBe('all')`

Also: in each `mockState`/`createState` helper that builds a `DashboardState` literal, add `selectedDetail: null` next to the new `scopeFilter` field (otherwise TypeScript will refuse the literal against the updated interface).

- [ ] **Step 3: Run the migrated tests**

Run: `bun test:client tests/client/debug/`
Expected: all debug tests pass (the source-side changes from Tasks 1–5 align with these renamed callers).

- [ ] **Step 4: Run full client test suite**

Run: `bun test:client 2>&1 | tail -5`
Expected: green. The branch is now consistent again.

- [ ] **Step 5: Commit**

```bash
git add client/debug/dashboard-types.ts client/debug/debug.svelte.ts \
        client/debug/components/TurnsPanel.svelte \
        client/debug/components/NotificationsPanel.svelte \
        client/debug/components/ToolFailuresPanel.svelte \
        tests/client/debug/handlers.test.ts tests/client/debug/sse.test.ts \
        tests/client/debug/debug.svelte.test.ts \
        tests/client/debug/components/TurnsPanel.test.ts \
        tests/client/debug/components/DebugApp.test.ts
git commit -m "$(cat <<'EOF'
refactor(debug): replace activeContext with scopeFilter and add selectedDetail

Drop per-group filtering granularity (YAGNI per spec section 7) and
introduce a SelectedDetail discriminated union to back the upcoming
right-rail rewrite. ContextChips and the five Modal blocks still
exist — they get removed in tasks 9 and 10 once the new components
are in place.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Build `DebugTopBar.svelte` (TDD)

**Files:**

- Create: `client/debug/components/DebugTopBar.svelte`
- Create: `tests/client/debug/components/DebugTopBar.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import DebugTopBar from '../../../../client/debug/components/DebugTopBar.svelte'
import type { DashboardState } from '../../../../client/debug/dashboard-types.js'

function makeState(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    connected: true,
    stats: { startedAt: Date.now(), totalMessages: 0, totalLlmCalls: 0, totalToolCalls: 0 },
    sessions: new Map(),
    wizards: new Map(),
    scheduler: { running: true, tickCount: 1 },
    pollers: { scheduledRunning: true, alertsRunning: true },
    messageCache: { size: 0, pendingWrites: 0 },
    llmTraces: [],
    logs: [],
    logScopes: new Set(),
    turns: [],
    notifications: [],
    toolFailures: [],
    activeConfigEditors: new Set(),
    scopeFilter: 'all',
    selectedDetail: null,
    activeLogFilter: {},
    ...overrides,
  }
}

describe('DebugTopBar.svelte', () => {
  let target: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>'
    target = document.body.querySelector<HTMLElement>('#root')!
  })

  test('renders brand "papai ::debug" and a connected pill', () => {
    const dashboard = makeState({ connected: true })
    const component = mount(DebugTopBar, { target, props: { dashboard } })
    expect(target.textContent).toContain('papai')
    expect(target.textContent).toContain('::debug')
    expect(target.textContent).toContain('connected')
    void unmount(component)
  })

  test('renders a disconnected pill with danger tone when disconnected', () => {
    const dashboard = makeState({ connected: false })
    const component = mount(DebugTopBar, { target, props: { dashboard } })
    expect(target.textContent).toContain('disconnected')
    expect(target.querySelector('.ui-pill--danger')).not.toBeNull()
    void unmount(component)
  })

  test('renders msgs / llm / tools counters', () => {
    const dashboard = makeState({
      stats: { startedAt: Date.now(), totalMessages: 42, totalLlmCalls: 7, totalToolCalls: 13 },
    })
    const component = mount(DebugTopBar, { target, props: { dashboard } })
    const text = target.textContent ?? ''
    expect(text).toContain('42')
    expect(text).toContain('7')
    expect(text).toContain('13')
    void unmount(component)
  })

  test('Seg in the secondary row reflects scopeFilter and writes back on click', () => {
    const dashboard = makeState({ scopeFilter: 'all' })
    const component = mount(DebugTopBar, { target, props: { dashboard } })
    const active = target.querySelector('.ui-seg__btn--active')
    expect(active?.textContent).toBe('all')
    const dmBtn = Array.from(target.querySelectorAll<HTMLButtonElement>('.ui-seg__btn')).find(
      (b) => b.textContent === 'dm',
    )!
    dmBtn.click()
    expect(dashboard.scopeFilter).toBe('dm')
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run the failing test**

Run: `bun test:client tests/client/debug/components/DebugTopBar.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `client/debug/components/DebugTopBar.svelte`**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'
  import Pill from '../../shared/ui/Pill.svelte'
  import Seg from '../../shared/ui/Seg.svelte'
  import TopBar from '../../shared/ui/TopBar.svelte'

  import { formatUptime } from '../../shared/helpers.js'
  import type { DashboardState, ScopeFilter } from '../dashboard-types.js'

  interface Props {
    dashboard: DashboardState
  }

  let { dashboard }: Props = $props()

  let uptimeTick = $state(0)
  $effect(() => {
    const id = setInterval(() => {
      uptimeTick += 1
    }, 10000)
    return () => clearInterval(id)
  })

  const uptime = $derived.by(() => {
    void uptimeTick
    return formatUptime(dashboard.stats.startedAt)
  })

  const schedulerLabel = $derived.by(() => {
    const sched = dashboard.scheduler
    const running = sched.running ?? false
    const tickPart = sched.tickCount === undefined ? '' : ` · tick #${sched.tickCount}`
    return `${running ? 'running' : 'stopped'}${tickPart}`
  })
</script>

<TopBar page="debug">
  {#snippet statusRow()}
    <div class="debug-topbar__status">
      {#if dashboard.connected}
        <Pill tone="accent" dot>{#snippet children()}connected{/snippet}</Pill>
      {:else}
        <Pill tone="danger" dot>{#snippet children()}disconnected{/snippet}</Pill>
      {/if}
      <span class="debug-topbar__stat"><span class="debug-topbar__lbl">uptime</span> {uptime}</span>
      <span class="debug-topbar__stat"><span class="debug-topbar__lbl">msgs</span> {dashboard.stats.totalMessages}</span>
      <span class="debug-topbar__stat"><span class="debug-topbar__lbl">llm</span> {dashboard.stats.totalLlmCalls}</span>
      <span class="debug-topbar__stat"><span class="debug-topbar__lbl">tools</span> {dashboard.stats.totalToolCalls}</span>
      <span class="debug-topbar__sep"></span>
      <Btn variant="ghost" size="sm" onClick={() => (window.location.href = '/admin')}>
        {#snippet children()}/admin →{/snippet}
      </Btn>
    </div>
  {/snippet}
  {#snippet secondaryRow()}
    <div class="debug-topbar__secondary">
      <span class="debug-topbar__lbl">scheduler</span>
      <Pill tone={dashboard.scheduler.running ? 'accent' : 'mute'} dot>{#snippet children()}{schedulerLabel}{/snippet}</Pill>
      <span class="debug-topbar__lbl">pollers</span>
      <Pill tone={dashboard.pollers.scheduledRunning ? 'accent' : 'mute'} dot>{#snippet children()}scheduled{/snippet}</Pill>
      <Pill tone={dashboard.pollers.alertsRunning ? 'accent' : 'mute'} dot>{#snippet children()}alerts{/snippet}</Pill>
      <span class="debug-topbar__lbl">msg-cache</span>
      <span class="debug-topbar__stat">{dashboard.messageCache.size ?? 0} entries · {dashboard.messageCache.pendingWrites ?? 0} pending</span>
      <span class="debug-topbar__spacer"></span>
      <Seg
        options={['all', 'dm', 'group']}
        value={dashboard.scopeFilter}
        onChange={(v) => (dashboard.scopeFilter = v as ScopeFilter)} />
    </div>
  {/snippet}
</TopBar>

<style>
  .debug-topbar__status,
  .debug-topbar__secondary {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
  }
  .debug-topbar__stat {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg);
  }
  .debug-topbar__lbl {
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .debug-topbar__sep {
    width: 1px;
    height: 14px;
    background: var(--border);
  }
  .debug-topbar__spacer {
    flex: 1;
  }
</style>
```

- [ ] **Step 4: Run the test until green**

Run: `bun test:client tests/client/debug/components/DebugTopBar.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 5: Commit**

```bash
git add client/debug/components/DebugTopBar.svelte tests/client/debug/components/DebugTopBar.test.ts
git commit -m "$(cat <<'EOF'
feat(debug): add DebugTopBar with brand, status row, and scope Seg

Composes the shared TopBar primitive with a debug-specific status
row (connected pill, uptime/msgs/llm/tools counters, /admin link)
and secondary row (scheduler/poller pills, msg-cache, scope Seg).
The Seg writes back to dashboard.scopeFilter directly via two-way
binding on the prop reference.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Build `DebugDetailRail.svelte` (TDD)

**Files:**

- Create: `client/debug/components/DebugDetailRail.svelte`
- Create: `tests/client/debug/components/DebugDetailRail.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import DebugDetailRail from '../../../../client/debug/components/DebugDetailRail.svelte'
import type { SelectedDetail, Turn } from '../../../../client/debug/dashboard-types.js'

function mockTurn(id = 'turn_2a4f8c'): Turn {
  return {
    turnId: id,
    scope: { kind: 'user', userId: 'u_1' },
    status: 'ok',
    startedAt: Date.now(),
    durationMs: 612,
    messageCount: 1,
    toolCalls: [],
    summary: '',
  } as Turn
}

describe('DebugDetailRail.svelte', () => {
  let target: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>'
    target = document.body.querySelector<HTMLElement>('#root')!
  })

  test('renders an empty state when selectedDetail is null', () => {
    const component = mount(DebugDetailRail, {
      target,
      props: { selected: null as SelectedDetail, onClear: () => {} },
    })
    expect(target.querySelector('.debug-detail-rail__empty')).not.toBeNull()
    expect(target.querySelector('.debug-detail-rail__header')).toBeNull()
    void unmount(component)
  })

  test('renders the turn header when kind=turn', () => {
    const selected: SelectedDetail = { kind: 'turn', payload: mockTurn('turn_8800a1') }
    const component = mount(DebugDetailRail, { target, props: { selected, onClear: () => {} } })
    const header = target.querySelector('.debug-detail-rail__header')
    expect(header).not.toBeNull()
    expect(header!.textContent).toContain('turn_8800a1')
    void unmount(component)
  })

  test('clicking the ✕ button calls onClear', () => {
    const selected: SelectedDetail = { kind: 'turn', payload: mockTurn() }
    let cleared = false
    const component = mount(DebugDetailRail, {
      target,
      props: {
        selected,
        onClear: () => {
          cleared = true
        },
      },
    })
    const closeBtn = target.querySelector<HTMLButtonElement>('.debug-detail-rail__close')!
    closeBtn.click()
    expect(cleared).toBe(true)
    void unmount(component)
  })
})
```

- [ ] **Step 2: Run the failing test**

Run: `bun test:client tests/client/debug/components/DebugDetailRail.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `client/debug/components/DebugDetailRail.svelte`**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Btn from '../../shared/ui/Btn.svelte'
  import Caption from '../../shared/ui/Caption.svelte'

  import FailureDetail from './FailureDetail.svelte'
  import LogDetail from './LogDetail.svelte'
  import SessionDetail from './SessionDetail.svelte'
  import TraceDetail from './TraceDetail.svelte'
  import TurnDetail from './TurnDetail.svelte'

  import type { SelectedDetail } from '../dashboard-types.js'

  interface Props {
    selected: SelectedDetail
    onClear: () => void
  }

  let { selected, onClear }: Props = $props()

  const headerLabel = $derived.by(() => {
    if (selected === null) return ''
    switch (selected.kind) {
      case 'turn':
        return `turn · ${selected.payload.turnId}`
      case 'trace':
        return `trace · ${selected.payload.model}`
      case 'session':
        return `session · ${selected.payload.userId}`
      case 'log':
        return `log · #${selected.payload.index + 1}`
      case 'failure': {
        const tn = selected.payload.data['toolName']
        return `failure · ${typeof tn === 'string' ? tn : 'unknown'}`
      }
    }
  })
</script>

<div class="debug-detail-rail">
  {#if selected === null}
    <div class="debug-detail-rail__empty">
      <Caption>{#snippet children()}detail rail{/snippet}</Caption>
      <p class="debug-detail-rail__hint">select a turn, trace, session, log, or failure</p>
    </div>
  {:else}
    <div class="debug-detail-rail__header">
      <span class="debug-detail-rail__label">{headerLabel}</span>
      <Btn variant="ghost" size="sm" onClick={onClear}>
        {#snippet children()}✕{/snippet}
      </Btn>
    </div>
    <div class="debug-detail-rail__body">
      {#if selected.kind === 'turn'}
        <TurnDetail turn={selected.payload} />
      {:else if selected.kind === 'trace'}
        <TraceDetail trace={selected.payload} />
      {:else if selected.kind === 'session'}
        <SessionDetail userId={selected.payload.userId} session={selected.payload.session} />
      {:else if selected.kind === 'log'}
        <LogDetail entry={selected.payload.entry} />
      {:else if selected.kind === 'failure'}
        <FailureDetail failure={selected.payload} />
      {/if}
    </div>
  {/if}
</div>

<style>
  .debug-detail-rail {
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--border);
    min-height: 0;
    min-width: 0;
  }
  .debug-detail-rail__empty {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .debug-detail-rail__hint {
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 12px;
    margin: 0;
  }
  .debug-detail-rail__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid var(--hair);
  }
  .debug-detail-rail__label {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg2);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .debug-detail-rail__body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 12px 14px;
  }
</style>
```

- [ ] **Step 4: Run the test until green**

Run: `bun test:client tests/client/debug/components/DebugDetailRail.test.ts`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add client/debug/components/DebugDetailRail.svelte tests/client/debug/components/DebugDetailRail.test.ts
git commit -m "$(cat <<'EOF'
feat(debug): add DebugDetailRail discriminated-union view

One container pattern-matches on SelectedDetail.kind and embeds the
existing per-detail components (TurnDetail, TraceDetail,
SessionDetail, LogDetail, FailureDetail) without changing their
internals. Header shows a caps label and a ghost ✕ that clears the
selection via onClear.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Rewrite `DebugApp.svelte` (three-column shell, single selection)

**Files:**

- Modify: `client/debug/DebugApp.svelte`

This task replaces the file in full.

- [ ] **Step 1: Read the current file to confirm imports and effect logic**

Run: `cat client/debug/DebugApp.svelte`
Confirm: `setupEventSource`, `fetchInitialLogs`, `parseLogsArray`, `collectScopes`, and `showLogsForTurn` are the only behaviors that must be preserved. Five `<Modal>` blocks and five `selected*` cells go away.

- [ ] **Step 2: Replace the file contents**

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Shell from '../shared/ui/Shell.svelte'

  import DebugDetailRail from './components/DebugDetailRail.svelte'
  import DebugTopBar from './components/DebugTopBar.svelte'
  import LiveContextCard from './components/LiveContextCard.svelte'
  import LogExplorer from './components/LogExplorer.svelte'
  import NotificationsPanel from './components/NotificationsPanel.svelte'
  import SessionsList from './components/SessionsList.svelte'
  import ToolFailuresPanel from './components/ToolFailuresPanel.svelte'
  import TraceList from './components/TraceList.svelte'
  import TurnsPanel from './components/TurnsPanel.svelte'

  import type { DashboardState } from './dashboard-types.js'
  import { fetchInitialLogs, parseLogsArray, collectScopes } from './log-bootstrap.js'
  import { setupEventSource } from './sse.js'

  interface Props {
    dashboard: DashboardState
  }

  let { dashboard }: Props = $props()

  $effect(() => {
    void (async () => {
      try {
        const rawLogs = await fetchInitialLogs()
        const parsed = parseLogsArray(rawLogs)
        dashboard.logs = parsed
        const scopes = collectScopes(parsed)
        for (const scope of scopes) dashboard.logScopes.add(scope)
      } catch {
        // SSE will populate from live events.
      }
    })()

    const conn = setupEventSource(dashboard, (connected) => {
      dashboard.connected = connected
    })
    return () => conn.close()
  })

  function showLogsForTurn(turnId: string): void {
    dashboard.activeLogFilter.turnId = turnId
    document.getElementById('log-explorer')?.scrollIntoView({ behavior: 'smooth' })
  }
</script>

<Shell>
  {#snippet topBar()}
    <DebugTopBar {dashboard} />
  {/snippet}
  {#snippet children()}
    <div class="debug-grid">
      <aside class="debug-grid__left">
        <SessionsList
          {dashboard}
          onSelect={(userId, session) => (dashboard.selectedDetail = { kind: 'session', payload: { userId, session } })} />
        <TraceList
          {dashboard}
          onSelect={(trace) => (dashboard.selectedDetail = { kind: 'trace', payload: trace })} />
      </aside>

      <section class="debug-grid__center">
        <TurnsPanel
          {dashboard}
          onShowTurn={(turn) => (dashboard.selectedDetail = { kind: 'turn', payload: turn })}
          onShowLogsForTurn={showLogsForTurn} />
        <div class="debug-grid__center-row">
          <NotificationsPanel {dashboard} />
          <ToolFailuresPanel
            {dashboard}
            onShowFailure={(failure) => (dashboard.selectedDetail = { kind: 'failure', payload: failure })} />
        </div>
        <LogExplorer
          {dashboard}
          onSelectLog={(entry, index) => (dashboard.selectedDetail = { kind: 'log', payload: { entry, index } })} />
      </section>

      <aside class="debug-grid__right">
        <DebugDetailRail
          selected={dashboard.selectedDetail}
          onClear={() => (dashboard.selectedDetail = null)} />
        <LiveContextCard {dashboard} />
      </aside>
    </div>
  {/snippet}
</Shell>
```

- [ ] **Step 3: Run the existing `DebugApp.test.ts`**

Run: `bun test:client tests/client/debug/components/DebugApp.test.ts 2>&1 | tail -20`
Expected: PASS, after the Task 6 rename. If the test still asserts the presence of `<Modal>` overlays, simplify those assertions to check for `.debug-grid` instead. Document the simplification inline in the commit message.

- [ ] **Step 4: Run the entire debug test suite**

Run: `bun test:client tests/client/debug/ 2>&1 | tail -5`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add client/debug/DebugApp.svelte tests/client/debug/components/DebugApp.test.ts
git commit -m "$(cat <<'EOF'
feat(debug): rebuild DebugApp around DebugTopBar and DebugDetailRail

Three-column shell (260 / 1fr / 380) replaces the previous flat
`main` + five-modal layout. Selection routes through a single
dashboard.selectedDetail cell; the right rail renders the matching
detail inline. LiveContextCard moves under the detail rail. No
behavior change for session/turn/trace/log/failure detail contents
themselves.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Remove `Header.svelte` and `ContextChips.svelte`

**Files:**

- Delete: `client/debug/components/Header.svelte`
- Delete: `client/debug/components/ContextChips.svelte`
- Delete (only if they exist): `tests/client/debug/components/Header.test.ts`, `tests/client/debug/components/ContextChips.test.ts`

- [ ] **Step 1: Confirm nothing imports them**

Run: `grep -rn "Header\.svelte\|ContextChips\.svelte\|from '.*Header'\|from '.*ContextChips'" client/ tests/client/`
Expected: no matches other than (potentially) the files themselves being defined.

If any production import survives the Task 9 rewrite, **stop and report** — DebugApp.svelte was supposed to drop both.

- [ ] **Step 2: Check for orphan test files**

Run: `ls tests/client/debug/components/ | grep -E "Header|ContextChips"`

For each match, delete it. (`git rm tests/client/debug/components/<name>.test.ts`.)

- [ ] **Step 3: Delete the components**

```bash
git rm client/debug/components/Header.svelte client/debug/components/ContextChips.svelte
```

- [ ] **Step 4: Run the full client test suite**

Run: `bun test:client 2>&1 | tail -5`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore(debug): remove Header and ContextChips components

Both were superseded by DebugTopBar in the previous commit. The
top-bar now owns brand + status + secondary row + scope Seg, and
all consumers were updated in task 9.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Migrate `debug.css` to the three-column grid

**Files:**

- Modify: `client/debug/debug.css`

The old CSS still carries selectors for `.header*`, `.context-chips`, the legacy `main { display: grid; ... }`, `#left-panel`, and `.panel-grid`. Drop those and replace with grid styles for the new shell.

- [ ] **Step 1: Identify the legacy selectors**

Run: `grep -nE '^(\.header|\.context-chips|\.chip|#left-panel|\.panel-grid|main \{)' client/debug/debug.css`

Note each match. These blocks (and their nested rules) all go.

- [ ] **Step 2: Remove the legacy blocks**

In `client/debug/debug.css`, delete the rule blocks for:

- `header`, `.header-top`, `.header-stat`, `.header-infra`, `.infra-sep`, `.status-dot.connected`, `.status-dot.disconnected`
- `.context-chips`, `.chip`, `.chip.active`
- `main` (the original page-level grid)
- `#left-panel`
- `.panel-grid`

Keep every selector that the surviving components depend on (panels, log explorer rows, session card, trace list, turn rows, notifications, failures, modal close, etc.). When unsure, leave a rule in place — task 22 in PR 1 already confirmed the bundle still compiles with residual rules.

- [ ] **Step 3: Add the new grid block**

Append to `client/debug/debug.css`:

```css
.debug-grid {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr) 380px;
  grid-template-rows: auto;
  gap: 12px;
  padding: 16px;
  min-height: 0;
}
.debug-grid__left,
.debug-grid__right {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  min-height: 0;
}
.debug-grid__center {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  min-height: 0;
}
.debug-grid__center-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  min-width: 0;
}
```

- [ ] **Step 4: Rebuild and inspect the bundle**

Run: `bun build:client && grep -c '^\.debug-grid' public/debug.css`
Expected: at least `1`. The compiled bundle contains the new grid block.

- [ ] **Step 5: Run the client suite**

Run: `bun test:client 2>&1 | tail -5`
Expected: green.

- [ ] **Step 6: Manual smoke (optional)**

Run: `bun start:debug` and open `/debug`. Click a turn row, then a trace row, then a session, then a log — confirm the right-rail swaps between them and `✕` clears it. Confirm `Seg(all|dm|group)` filters the center panels. Confirm `/admin →` link navigates to `/admin`.

- [ ] **Step 7: Commit**

```bash
git add client/debug/debug.css
git commit -m "$(cat <<'EOF'
refactor(debug): replace legacy CSS with three-column grid

Drop .header* / .context-chips / .panel-grid / #left-panel /
main blocks now that DebugTopBar and the .debug-grid shell own the
page-level layout. Per-panel CSS is unchanged.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Full check + manual verification

**Files:** none modified

This is the gate before declaring PR 2 done.

- [ ] **Step 1: Full check pipeline**

Run: `bun check:full`
Expected: green. If anything fails, fix the underlying issue — never `--no-verify`.

- [ ] **Step 2: Client suite**

Run: `bun test:client`
Expected: green. Should be the PR 1 baseline plus the two new components' tests (7 new cases total: 4 DebugTopBar + 3 DebugDetailRail).

- [ ] **Step 3: Backend unit suite**

Run: `bun test`
Expected: green (no backend code changed).

- [ ] **Step 4: Build the bundle**

Run: `bun build:client`
Expected: succeeds. Verify:

```bash
grep -cE '^\.debug-grid' public/debug.css
grep -cE '^\.context-chips|^#left-panel|^\.panel-grid' public/debug.css
```

Expected: first ≥ 1, second = 0.

- [ ] **Step 5: No final commit — all work was already committed task-by-task**

PR 2 is complete. The branch holds ~6 new commits on top of PR 1.

---

## Spec Coverage Self-Check

This plan covers spec section 7 in full:

- 7.1 Layout (three-column grid 260 / 1fr / 380) — Task 9 + Task 11
- 7.2 Right-rail state machine (`SelectedDetail` discriminated union, `DebugDetailRail` pattern matcher) — Task 1 + Task 8 + Task 9
- 7.3 Top bar (brand `papai ::debug`, status pill, counters, `/admin →`, scheduler/pollers/msg-cache, scope Seg) — Task 7
- 7.4 Removed (`Header.svelte`, `ContextChips.svelte`, five `<Modal>` blocks, five `selected*` cells) — Task 9 + Task 10
- 7.5 Kept (`setupEventSource`, `dashboard.*` shape minus `activeContext`, detail-component internals, `<Modal>` and `<Confirm>` primitives) — preserved by Task 9
- 7.6 Tests (`DebugDetailRail.test.ts` new, existing per-detail tests stay green) — Task 6 + Task 8

Out of scope for this plan (and deferred to PR 3 / PR 4):

- Section 8 (`/admin` shell + scrollspy + recent-requests endpoint) — PR 3.
- Section 9 (data plumbing for `adminGlobals`) — PR 3.
- Section 10 (polish: Spark/Bars wired to real data, KPI sub-labels, modal restyle pass, dead-code sweep) — PR 4.
