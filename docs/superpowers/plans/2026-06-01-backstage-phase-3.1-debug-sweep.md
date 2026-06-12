<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Backstage Phase 3.1 — /debug Kit Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt the shared kit across the `/debug` surface (`client/debug/`), eliminating the same anti-patterns fixed in `/admin`: hand-rolled `<section class="panel">`/`<h2>` → `Panel`; raw `<button>` → `Btn`; raw `<input>`/`<select>` → `Input`/`Select`; plain-text status → `StatusPill`; label/value grids → `SummaryList`/`KV`; a hand-rolled config table → `DataTable`; single-line `JSON.stringify` → `JsonCell`; inline `toFixed` → `fmtNum`; `.placeholder` empties → `EmptyState`.

**Architecture:** Consumer-side adoption only; no component logic changes. One small test-driven enhancement to the shared `status-tone` map (log levels + retriable). Then one task per affected file. Deep pretty-printed JSON dumps and `TreeView` usages are intentionally left as-is (they are not the compact-cell anti-pattern; `TreeView` is the right tool for deep objects).

**Tech Stack:** Bun, Svelte 5 (runes), TypeScript (strict), `bun:test` + happy-dom.

**Spec:** `docs/superpowers/specs/2026-06-01-backstage-admin-ui-fixes-design.md` (§3 goal: sweep `/debug` for the same anti-patterns; §6 kit).

**Depends on:** Phase 1 (all kit components + helpers), Phase 2.3 (`Btn`/`Input`/`Select` `testid`, `Input` `password`).

**Already-clean files (do not touch):** `DebugApp.svelte`, `DebugTopBar.svelte`, `TurnDetail.svelte`, `FailureDetail.svelte`. `TurnsPanel.svelte` is clean except its empty-state span (Task 13).

---

## Conventions (apply to every task)

- **TDD write-hook**: test-first. Author/extend the component's test under `tests/client/debug/components/<Name>.test.ts` (create if absent, mirroring `tests/client/shared/ui/Pill.test.ts` mount/unmount style). Assert the new kit class (`.ui-panel`/`.ui-btn`/`.ui-input`/`.ui-pill`/`.ui-summary`/`.ui-datatable`/`.ui-jsoncell`/`.ui-empty`), run Red, refactor Green.
- Import paths from `client/debug/components/*.svelte`: kit is `../../shared/ui/<Name>.svelte`; helpers `../../shared/helpers.js`.
- Several debug components currently lack a BSL header. If the `license-headers` check flags a file you edit, prepend the standard 4-line HTML-comment header (as in `DebugDetailRail.svelte`).
- `bind:value` must become controlled `value` + `onInput`/`onChange` (the kit `Input`/`Select` are callback-based, not `bind:`).
- Run client suite: `bun test:client` (ignore one unrelated `ECONNREFUSED`). `.svelte` local TS imports use `.js`. No `lint-disable`/`ts-ignore`. `bun format <files>` before commit if needed.
- **Commit each task SCOPED** to `master`. NEVER touch `.opencode/plugins/tdd-enforcement.ts` or `tests/opencode-tdd-enforcement.test.ts`.

---

## Task 1: Extend `status-tone` with log levels + retriable

`/debug` renders log-level names and the failure "retriable" flag as status-like values. Add them to the shared map so `StatusPill` tones are correct.

**Files:**

- Modify: `client/shared/ui/status-tone.ts`
- Test: `tests/client/shared/ui/status-tone.test.ts`

- [ ] **Step 1: Extend the failing test:**

```ts
test.each([
  ['trace', 'mute'],
  ['debug', 'mute'],
  ['fatal', 'danger'],
  ['retriable', 'info'],
  ['non-retriable', 'mute'],
] as const)('maps debug status %s -> %s', (status, tone) => {
  expect(statusTone(status)).toBe(tone)
})
```

- [ ] **Step 2: Run** `bun test:client tests/client/shared/ui/status-tone.test.ts` — expect FAIL.

- [ ] **Step 3: Implement.** Add these entries to the `TONE_MAP` in `status-tone.ts` (keep existing entries):

```ts
  trace: 'mute',
  debug: 'mute',
  fatal: 'danger',
  retriable: 'info',
  'non-retriable': 'mute',
```

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/shared/ui/status-tone.ts tests/client/shared/ui/status-tone.test.ts
git commit -m "feat(client/ui): map log levels and retriable in statusTone" -- client/shared/ui/status-tone.ts tests/client/shared/ui/status-tone.test.ts
```

---

## Task 2: `DebugDetailRail` — close button → `Btn`

**Files:**

- Modify: `client/debug/components/DebugDetailRail.svelte`
- Test: `tests/client/debug/components/DebugDetailRail.test.ts` (extend; create if absent)

- [ ] **Step 1: Write the failing test** — mount with a `selected` failure payload and assert the close control is a `Btn`:

```ts
test('renders the close control as a kit Btn', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const c = mount(DebugDetailRail, {
    target,
    props: {
      selected: { kind: 'log', payload: { entry: { time: 0, level: 30, msg: 'x' }, index: 0 } },
      onClear: () => {},
    },
  })
  const btn = target.querySelector('.debug-detail-rail__header .ui-btn')
  expect(btn).not.toBeNull()
  void unmount(c)
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add `import Btn from '../../shared/ui/Btn.svelte'`. Replace:

```svelte
<button class="debug-detail-rail__close" onclick={onClear}>✕</button>
```

with:

```svelte
<Btn variant="ghost" size="sm" onClick={onClear}>{#snippet children()}✕{/snippet}</Btn>
```

Delete the `.debug-detail-rail__close` and `.debug-detail-rail__close:hover` style rules.

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/debug/components/DebugDetailRail.svelte tests/client/debug/components/DebugDetailRail.test.ts
git commit -m "fix(debug): close control via Btn in DebugDetailRail" -- client/debug/components/DebugDetailRail.svelte tests/client/debug/components/DebugDetailRail.test.ts
```

---

## Task 3: `LogExplorer` — `Panel` + `Toolbar` + `Select`/`Input`/`Btn`

**Files:**

- Modify: `client/debug/components/LogExplorer.svelte`
- Test: `tests/client/debug/components/LogExplorer.test.ts` (extend; create if absent)

- [ ] **Step 1: Write the failing test:**

```ts
test('renders within a Panel with kit Select/Input/Btn controls', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const dashboard = { logs: [], logScopes: new Set(), activeLogFilter: {} /* …minimal DashboardState… */ }
  const c = mount(LogExplorer, { target, props: { dashboard, onSelectLog: () => {} } })
  expect(target.querySelector('.ui-panel')).not.toBeNull()
  expect(target.querySelectorAll('.ui-select').length).toBe(2)
  expect(target.querySelector('.ui-input')).not.toBeNull()
  expect(target.querySelector('#log-explorer .ui-btn')).not.toBeNull()
  void unmount(c)
})
```

> Build the minimal `DashboardState` the component reads (`logs`, `logScopes`, `activeLogFilter.turnId`) — read `client/debug/dashboard-types.ts` for the exact shape.

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add imports:

```ts
import Btn from '../../shared/ui/Btn.svelte'
import Input from '../../shared/ui/Input.svelte'
import Panel from '../../shared/ui/Panel.svelte'
import Select from '../../shared/ui/Select.svelte'
import Toolbar from '../../shared/ui/Toolbar.svelte'
```

Replace the entire `<section id="log-explorer"> … </section>` template (lines 59-108) with:

```svelte
<section id="log-explorer">
  <Panel title="log explorer" count={filtered.length}>
    {#snippet action()}
      <Toolbar>
        <Select
          value={levelFilter}
          options={[
            { value: '0', label: 'all levels' },
            { value: '10', label: 'trace' },
            { value: '20', label: 'debug' },
            { value: '30', label: 'info' },
            { value: '40', label: 'warn' },
            { value: '50', label: 'error' },
          ]}
          onChange={(v) => (levelFilter = v)} />
        <Select
          value={scopeFilter}
          options={[{ value: '', label: 'all scopes' }, ...sortedScopes.map((s) => ({ value: s, label: s }))]}
          onChange={(v) => (scopeFilter = v)} />
        <Input value={searchQuery} placeholder="search..." onInput={(v) => (searchQuery = v)} />
        {#if dashboard.activeLogFilter.turnId !== undefined}
          <div class="log-turnid-badge">
            <span>turn:{dashboard.activeLogFilter.turnId.slice(0, 8)}</span>
            <Btn variant="ghost" size="sm" onClick={clearTurnFilter}>{#snippet children()}×{/snippet}</Btn>
          </div>
        {/if}
        <Btn variant="ghost" size="sm" onClick={clearLogs}>{#snippet children()}clear{/snippet}</Btn>
      </Toolbar>
    {/snippet}
    {#snippet body()}
      <div id="log-entries" bind:this={entriesEl} onscroll={onScroll}>
        {#each filtered as fl, i (i)}
          <div
            class="log-entry {levelClass(fl.entry.level)}"
            role="button"
            tabindex="0"
            onclick={() => onSelectLog(fl.entry, fl.originalIndex)}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelectLog(fl.entry, fl.originalIndex)
              }
            }}>
            <span class="log-meta">{formatTime(fl.entry.time)} {levelName(fl.entry.level)}{fl.entry.scope === undefined ? '' : ` ${fl.entry.scope}`}</span>
            <span class="log-msg">{fl.entry.msg}</span>
          </div>
        {/each}
      </div>
      {#if !autoScroll}
        <Btn variant="secondary" size="sm" onClick={jumpToBottom}>{#snippet children()}▼ auto-scroll{/snippet}</Btn>
      {/if}
    {/snippet}
  </Panel>
</section>
```

In the `<style>` block (in `debug.css` or scoped — check where `.log-toolbar`/`.log-filters` live; they are in `client/debug/debug.css`): leave global CSS alone, but the `.log-toolbar`/`.log-filters` wrappers are no longer emitted. Keep `#log-entries`, `.log-entry`, `.log-meta`, `.log-msg`, `.log-turnid-badge` rules.

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Visual check (preview).** Confirm filters render as kit selects/input, clear/auto-scroll are `Btn`, and the entries list + auto-scroll behavior still work.
- [ ] **Step 6: Commit**

```bash
git add client/debug/components/LogExplorer.svelte tests/client/debug/components/LogExplorer.test.ts
git commit -m "fix(debug): LogExplorer via Panel/Toolbar/Select/Input/Btn" -- client/debug/components/LogExplorer.svelte tests/client/debug/components/LogExplorer.test.ts
```

---

## Task 4: `NotificationsPanel` — `Panel` + `EmptyState` + `JsonCell`

**Files:**

- Modify: `client/debug/components/NotificationsPanel.svelte`
- Test: `tests/client/debug/components/NotificationsPanel.test.ts` (extend; create if absent)

- [ ] **Step 1: Write the failing test:**

```ts
test('renders within a Panel and shows EmptyState when there are no notifications', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const dashboard = { notifications: [], scopeFilter: 'all' }
  const c = mount(NotificationsPanel, { target, props: { dashboard } })
  expect(target.querySelector('.ui-panel')).not.toBeNull()
  expect(target.querySelector('.ui-empty')).not.toBeNull()
  void unmount(c)
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add imports `Panel`, `EmptyState`, `JsonCell` from `../../shared/ui/`. Simplify the script's `notificationText` to only handle the text branch (the JSON branch moves to `JsonCell`):

```ts
function replyText(n: Notification): string {
  const data = n.data
  if (n.type === 'reply:sent' && typeof data['text'] === 'string') return truncate(data['text'], 120)
  return ''
}

function hasData(n: Notification): boolean {
  if (n.type === 'typing:start' || n.type === 'typing:stop') return false
  return Object.keys(n.data).length > 0 && replyText(n) === ''
}
```

Replace the template (lines 34-49) with:

```svelte
<Panel title="notifications" count={dashboard.notifications.length}>
  {#snippet body()}
    {#if filtered.length === 0}
      <EmptyState title="No notifications" />
    {:else}
      {#each filtered as n, i (i)}
        <div class="notification-row">
          <span class="notification-time">{formatTime(n.timestamp)}</span>
          <span class="notification-type">{n.type}</span>
          {#if replyText(n) !== ''}
            <span class="notification-text">{replyText(n)}</span>
          {:else if hasData(n)}
            <JsonCell value={n.data} />
          {/if}
        </div>
      {/each}
    {/if}
  {/snippet}
</Panel>
```

Remove the now-unused `notificationText` function and (if no longer referenced) `truncate`.

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/debug/components/NotificationsPanel.svelte tests/client/debug/components/NotificationsPanel.test.ts
git commit -m "fix(debug): NotificationsPanel via Panel/EmptyState/JsonCell" -- client/debug/components/NotificationsPanel.svelte tests/client/debug/components/NotificationsPanel.test.ts
```

---

## Task 5: `ToolFailuresPanel` — `Panel` + `EmptyState` + `StatusPill`

**Files:**

- Modify: `client/debug/components/ToolFailuresPanel.svelte`
- Test: `tests/client/debug/components/ToolFailuresPanel.test.ts` (extend; create if absent)

- [ ] **Step 1: Write the failing test** (empty → EmptyState within Panel):

```ts
test('renders within a Panel and shows EmptyState when there are no failures', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const c = mount(ToolFailuresPanel, {
    target,
    props: { dashboard: { toolFailures: [], scopeFilter: 'all' }, onShowFailure: () => {} },
  })
  expect(target.querySelector('.ui-panel')).not.toBeNull()
  expect(target.querySelector('.ui-empty')).not.toBeNull()
  void unmount(c)
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add imports `Panel`, `EmptyState`, `StatusPill`. Replace the template (lines 27-58) with:

```svelte
<Panel title="tool failures" count={dashboard.toolFailures.length}>
  {#snippet body()}
    {#if filtered.length === 0}
      <EmptyState title="No failures" />
    {:else}
      {#each filtered as f, i (i)}
        {@const toolName = typeof f.data['toolName'] === 'string' ? f.data['toolName'] : 'unknown'}
        {@const error = typeof f.data['error'] === 'string' ? f.data['error'] : ''}
        {@const retriable = retriableLabel(f.data)}
        <div
          class="failure-row"
          role="button"
          tabindex="0"
          onclick={() => onShowFailure(f)}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onShowFailure(f)
            }
          }}>
          <div class="failure-summary">
            <span class="failure-time">{formatTime(f.timestamp)}</span>
            <span class="failure-tool">{toolName}</span>
            <span class="failure-error">{error}</span>
            {#if retriable !== ''}
              <StatusPill status={retriable} dot={false} />
            {/if}
          </div>
        </div>
      {/each}
    {/if}
  {/snippet}
</Panel>
```

Drop the `.failure-retriable` style rule.

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/debug/components/ToolFailuresPanel.svelte tests/client/debug/components/ToolFailuresPanel.test.ts
git commit -m "fix(debug): ToolFailuresPanel via Panel/EmptyState/StatusPill" -- client/debug/components/ToolFailuresPanel.svelte tests/client/debug/components/ToolFailuresPanel.test.ts
```

---

## Task 6: `LiveContextCard` — `Panel` + `EmptyState`

**Files:**

- Modify: `client/debug/components/LiveContextCard.svelte`
- Test: `tests/client/debug/components/LiveContextCard.test.ts` (extend; create if absent)

- [ ] **Step 1: Write the failing test:**

```ts
test('renders within a Panel and shows EmptyState when no active sessions', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const c = mount(LiveContextCard, {
    target,
    props: { dashboard: { activeConfigEditors: new Set(), wizards: new Map() } },
  })
  expect(target.querySelector('.ui-panel')).not.toBeNull()
  expect(target.querySelector('.ui-empty')).not.toBeNull()
  void unmount(c)
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add imports `Panel`, `EmptyState`. Replace the template (lines 14-38) with:

```svelte
<Panel title="live context">
  {#snippet body()}
    <div class="context-panel-sections">
      <div class="context-panel-section">
        {#if editorIds.length === 0 && wizards.length === 0}
          <EmptyState title="No active sessions" />
        {:else}
          <div class="context-section">
            {#each editorIds as userId (userId)}
              <div class="context-item">
                <span class="context-key">{userId}</span>
                <span class="context-value">config-editor active</span>
              </div>
            {/each}
            {#each wizards as wizard (wizard.userId)}
              <div class="context-item">
                <span class="context-key">{wizard.userId}</span>
                <span class="context-value">wizard step {wizard.currentStep}/{wizard.totalSteps}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/snippet}
</Panel>
```

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/debug/components/LiveContextCard.svelte tests/client/debug/components/LiveContextCard.test.ts
git commit -m "fix(debug): LiveContextCard via Panel/EmptyState" -- client/debug/components/LiveContextCard.svelte tests/client/debug/components/LiveContextCard.test.ts
```

---

## Task 7: `SessionsList` — `Panel`

**Files:**

- Modify: `client/debug/components/SessionsList.svelte`
- Test: `tests/client/debug/components/SessionsList.test.ts` (extend; create if absent)

- [ ] **Step 1: Write the failing test:**

```ts
test('renders the sessions list within a Panel', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const c = mount(SessionsList, {
    target,
    props: { dashboard: { sessions: new Map(), wizards: new Map() }, onSelect: () => {} },
  })
  expect(target.querySelector('.ui-panel')).not.toBeNull()
  void unmount(c)
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add `import Panel from '../../shared/ui/Panel.svelte'`. Replace the template (lines 15-26) with:

```svelte
<section id="sessions">
  <Panel title="sessions" count={dashboard.sessions.size}>
    {#snippet body()}
      {#each entries as [userId, session] (userId)}
        <SessionCard
          {userId}
          {session}
          wizard={dashboard.wizards.get(userId)}
          onSelect={() => onSelect(userId, session)} />
      {/each}
    {/snippet}
  </Panel>
</section>
```

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/debug/components/SessionsList.svelte tests/client/debug/components/SessionsList.test.ts
git commit -m "fix(debug): SessionsList via Panel" -- client/debug/components/SessionsList.svelte tests/client/debug/components/SessionsList.test.ts
```

---

## Task 8: `TraceList` — `Panel` + `fmtNum` + `EmptyState`

**Files:**

- Modify: `client/debug/components/TraceList.svelte`
- Test: `tests/client/debug/components/TraceList.test.ts` (extend; create if absent)

- [ ] **Step 1: Write the failing test:**

```ts
test('renders the trace list within a Panel and EmptyState when empty', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const c = mount(TraceList, { target, props: { dashboard: { llmTraces: [] }, onSelect: () => {} } })
  expect(target.querySelector('.ui-panel')).not.toBeNull()
  expect(target.querySelector('.ui-empty')).not.toBeNull()
  void unmount(c)
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Update the helpers import to add `fmtNum`, and add `Panel`/`EmptyState` imports:

```ts
import { fmtNum, formatTime, formatTokens } from '../../shared/helpers.js'
import EmptyState from '../../shared/ui/EmptyState.svelte'
import Panel from '../../shared/ui/Panel.svelte'
```

Replace the template (lines 13-40) with:

```svelte
<section id="llm-trace">
  <Panel title="llm trace" count={dashboard.llmTraces.length}>
    {#snippet body()}
      {#if dashboard.llmTraces.length === 0}
        <EmptyState title="No traces" />
      {:else}
        {#each dashboard.llmTraces as trace, i (i)}
          {@const isError = trace.error !== undefined && trace.error !== ''}
          <div
            class="trace-row"
            class:error={isError}
            role="button"
            tabindex="0"
            onclick={() => onSelect(trace)}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelect(trace)
              }
            }}>
            <div class="trace-summary">
              <span class="trace-time">{formatTime(trace.timestamp)}</span>
              <span class="trace-user">{trace.userId}</span>
              <span class="trace-model">{trace.model}</span>
              <span class="trace-duration">{fmtNum(trace.duration / 1000, 1)}s</span>
              <span>{trace.steps} steps · {formatTokens(trace.totalTokens.inputTokens)}↓</span>
            </div>
          </div>
        {/each}
      {/if}
    {/snippet}
  </Panel>
</section>
```

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/debug/components/TraceList.svelte tests/client/debug/components/TraceList.test.ts
git commit -m "fix(debug): TraceList via Panel/EmptyState + fmtNum duration" -- client/debug/components/TraceList.svelte tests/client/debug/components/TraceList.test.ts
```

---

## Task 9: `SessionCard` — explicit `StatusPill`

**Files:**

- Modify: `client/debug/components/SessionCard.svelte`
- Test: `tests/client/debug/components/SessionCard.test.ts` (extend; create if absent)

The active/idle state is currently only a CSS class. Add a visible `StatusPill`.

- [ ] **Step 1: Write the failing test:**

```ts
test('renders a StatusPill reflecting active/idle state', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const session = { lastAccessed: Date.now(), historyLength: 1, factsCount: 0, summary: null, configKeys: [] }
  const c = mount(SessionCard, { target, props: { userId: 'u1', session, onSelect: () => {} } })
  expect(target.querySelector('.ui-pill')).not.toBeNull()
  void unmount(c)
})
```

> Match the `Session` fixture to `client/debug/dashboard-types.ts` (read it first).

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add `import StatusPill from '../../shared/ui/StatusPill.svelte'` (this file needs a BSL header added if `license-headers` flags it — none currently). Add the pill into the card header, next to the user id:

```svelte
<div class="user-id">{userId} <StatusPill status={isActive ? 'active' : 'idle'} /></div>
```

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/debug/components/SessionCard.svelte tests/client/debug/components/SessionCard.test.ts
git commit -m "fix(debug): explicit StatusPill for SessionCard active state" -- client/debug/components/SessionCard.svelte tests/client/debug/components/SessionCard.test.ts
```

---

## Task 10: `SessionDetail` — `SummaryList` + `KV` + `DataTable`

**Files:**

- Modify: `client/debug/components/SessionDetail.svelte`
- Test: `tests/client/debug/components/SessionDetail.test.ts` (extend; create if absent)

- [ ] **Step 1: Write the failing test:**

```ts
test('renders Basic Info as a SummaryList and config as a DataTable', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const session = {
    lastAccessed: 0,
    historyLength: 3,
    hasTools: true,
    summary: null,
    config: { tz: 'UTC' },
    facts: [],
    instructions: [],
    history: [],
  }
  const c = mount(SessionDetail, { target, props: { userId: 'u1', session } })
  expect(target.querySelector('.ui-summary')).not.toBeNull()
  expect(target.querySelector('.ui-datatable')).not.toBeNull()
  void unmount(c)
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add imports:

```ts
import DataTable from '../../shared/ui/DataTable.svelte'
import KV from '../../shared/ui/KV.svelte'
import SummaryList from '../../shared/ui/SummaryList.svelte'
```

Replace the Basic Info grid (lines 30-35) with:

```svelte
<SummaryList items={[
  { k: 'User ID', v: userId },
  { k: 'Last Accessed', v: formatTime(session.lastAccessed) },
  { k: 'History Length', v: `${session.historyLength} messages` },
  { k: 'Has Tools', v: session.hasTools === true ? 'yes' : 'no' },
]} />
```

Replace the config `<table class="config-table">` (lines 48-60) with a `DataTable`. Add a derived rows array in the script:

```ts
const configRows = $derived(
  configEntries.map(([key, value]) => ({ key, value: value === null ? 'null' : String(value) })),
)
const configColumns = [
  { key: 'key' as const, label: 'Key' },
  { key: 'value' as const, label: 'Value' },
]
```

and in the template:

```svelte
<DataTable columns={configColumns} rows={configRows} rowKey="key" />
```

Replace the Fact "Last seen" label/value block (lines 75-78) with:

```svelte
<KV k="Last seen" v={formatTime(fact.lastSeen)} />
```

Leave the Summary `<pre>`, Instructions, and Conversation History (`TreeView`) sections unchanged.

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/debug/components/SessionDetail.svelte tests/client/debug/components/SessionDetail.test.ts
git commit -m "fix(debug): SessionDetail via SummaryList/KV/DataTable" -- client/debug/components/SessionDetail.svelte tests/client/debug/components/SessionDetail.test.ts
```

---

## Task 11: `TraceDetail` — `SummaryList` + `StatusPill` + `fmtNum`

**Files:**

- Modify: `client/debug/components/TraceDetail.svelte`
- Test: `tests/client/debug/components/TraceDetail.test.ts` (extend; create if absent)

Leave the deep `JSON.stringify(…, null, 2)` `<pre>` blocks and step detail as-is (multiline dumps are appropriate here). Convert only the two label/value grids, the tool-call success status, and the duration formatting.

- [ ] **Step 1: Write the failing test:**

```ts
test('renders Basic Info / Token Usage as SummaryLists and tool status as StatusPill', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const trace = {
    userId: 'u1',
    timestamp: 0,
    model: 'm',
    duration: 1500,
    steps: 1,
    totalTokens: { inputTokens: 10, outputTokens: 5 },
    toolCalls: [{ toolName: 't', durationMs: 5, success: true }],
  }
  const c = mount(TraceDetail, { target, props: { trace } })
  expect(target.querySelectorAll('.ui-summary').length).toBeGreaterThanOrEqual(2)
  expect(target.querySelector('.ui-pill')).not.toBeNull()
  void unmount(c)
})
```

> Match the `LlmTrace` shape in `client/debug/dashboard-types.ts`.

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add imports:

```ts
import { fmtNum, formatTime, formatTokens } from '../../shared/helpers.js'
import StatusPill from '../../shared/ui/StatusPill.svelte'
import SummaryList from '../../shared/ui/SummaryList.svelte'
```

Build the Basic Info items in the script (conditional rows pushed in order):

```ts
const basicInfo = $derived.by(() => {
  const items: { k: string; v: string; vColor?: string }[] = [
    { k: 'User ID', v: trace.userId },
    { k: 'Timestamp', v: formatTime(trace.timestamp) },
    { k: 'Model', v: trace.model },
  ]
  if (trace.actualModel !== undefined && trace.actualModel !== '')
    items.push({ k: 'Actual Model', v: trace.actualModel })
  items.push({ k: 'Duration', v: `${fmtNum(trace.duration / 1000, 2)}s` })
  items.push({ k: 'Steps', v: String(trace.steps) })
  if (trace.finishReason !== undefined && trace.finishReason !== '')
    items.push({ k: 'Finish Reason', v: trace.finishReason })
  if (trace.responseId !== undefined && trace.responseId !== '') items.push({ k: 'Response ID', v: trace.responseId })
  if (trace.messageCount !== undefined) items.push({ k: 'Messages', v: String(trace.messageCount) })
  if (trace.toolCount !== undefined) items.push({ k: 'Tools Available', v: String(trace.toolCount) })
  if (hasError) items.push({ k: 'Error', v: trace.error ?? '', vColor: 'var(--danger)' })
  return items
})

const tokenUsage = $derived([
  { k: 'Input', v: formatTokens(trace.totalTokens.inputTokens) },
  { k: 'Output', v: formatTokens(trace.totalTokens.outputTokens) },
  { k: 'Total', v: formatTokens(trace.totalTokens.inputTokens + trace.totalTokens.outputTokens) },
])
```

Replace the Basic Info grid (lines 16-40) with `<SummaryList items={basicInfo} />` and the Token Usage grid (lines 45-49) with `<SummaryList cols={3} items={tokenUsage} />`.

Replace the tool-call status block (lines 121-127) — drop the `statusClass`/`status` consts and the `.tool-status` span:

```svelte
<div class="tool-call-item" class:error={!tc.success}>
  <div class="tool-call-summary">
    <span class="tool-name">{tc.toolName}</span>
    <span class="tool-duration">{tc.durationMs}ms</span>
    <StatusPill status={tc.success ? 'ok' : 'failed'} />
  </div>
```

Leave step `finishReason`, the `<pre class="tool-json">` blocks, and `generated-text` untouched.

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/debug/components/TraceDetail.svelte tests/client/debug/components/TraceDetail.test.ts
git commit -m "fix(debug): TraceDetail via SummaryList/StatusPill + fmtNum" -- client/debug/components/TraceDetail.svelte tests/client/debug/components/TraceDetail.test.ts
```

---

## Task 12: `LogDetail` — `SummaryList` (level as pill)

**Files:**

- Modify: `client/debug/components/LogDetail.svelte`
- Test: `tests/client/debug/components/LogDetail.test.ts` (extend; create if absent)

- [ ] **Step 1: Write the failing test:**

```ts
test('renders the meta block as a SummaryList with the level as a pill', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const c = mount(LogDetail, { target, props: { entry: { time: 0, level: 40, msg: 'x', scope: 's' } } })
  expect(target.querySelector('.ui-summary')).not.toBeNull()
  expect(target.querySelector('.ui-pill')).not.toBeNull()
  void unmount(c)
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add `import SummaryList from '../../shared/ui/SummaryList.svelte'`. Replace the meta block (lines 24-31) with:

```svelte
<div class="log-detail-meta">
  <SummaryList items={[
    { k: 'Time', v: formatTime(entry.time) },
    { k: 'Level', v: levelName(entry.level), pill: true },
    { k: 'Scope', v: entry.scope ?? 'none' },
  ]} />
</div>
```

`levelName(40)` → `'warn'` → `StatusPill` accent/warn via `statusTone` (warn). The numeric `levelClass`/`(entry.level)` suffix is dropped; `levelClass` may become an unused import — remove it from the import if so (keep `levelName`, `formatTime`).

- [ ] **Step 4: Run** — expect PASS (and `bun knip`/typecheck clean re: `levelClass`).
- [ ] **Step 5: Commit**

```bash
git add client/debug/components/LogDetail.svelte tests/client/debug/components/LogDetail.test.ts
git commit -m "fix(debug): LogDetail meta via SummaryList with level pill" -- client/debug/components/LogDetail.svelte tests/client/debug/components/LogDetail.test.ts
```

---

## Task 13: `TurnsPanel` — empty state → `EmptyState`

**Files:**

- Modify: `client/debug/components/TurnsPanel.svelte` (empty snippet, ~lines 111-113; `<style>` ~line 154)
- Test: `tests/client/debug/components/TurnsPanel.test.ts` (extend; create if absent)

- [ ] **Step 1: Write the failing test** — mount with empty turns and assert `.ui-empty` inside the table empty slot:

```ts
test('shows an EmptyState when there are no turns', () => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const c = mount(TurnsPanel, { target, props: { dashboard: { turns: [] }, /* …minimal… */ onSelectTurn: () => {} } })
  expect(target.querySelector('.ui-empty')).not.toBeNull()
  void unmount(c)
})
```

> Read `TurnsPanel.svelte` for its exact props/`DashboardState` slice before writing the fixture.

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Refactor.** Add `import EmptyState from '../../shared/ui/EmptyState.svelte'`. Replace:

```svelte
{#snippet empty()}
  <span class="turns__placeholder">No turns</span>
{/snippet}
```

with:

```svelte
{#snippet empty()}
  <EmptyState title="No turns" />
{/snippet}
```

Delete the `.turns__placeholder` style rule.

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit**

```bash
git add client/debug/components/TurnsPanel.svelte tests/client/debug/components/TurnsPanel.test.ts
git commit -m "fix(debug): TurnsPanel empty via EmptyState" -- client/debug/components/TurnsPanel.svelte tests/client/debug/components/TurnsPanel.test.ts
```

---

## Task 14: Phase 3.1 gate

**Files:** none (verification only).

- [ ] **Step 1:** `bun test:client` — all pass (ignore one unrelated `ECONNREFUSED`).
- [ ] **Step 2:** `bun typecheck` — no errors (watch removed `levelClass`/`truncate`/`configLabel`-style unused imports).
- [ ] **Step 3:** `bun knip` — no new unused findings.
- [ ] **Step 4:** `bun check:bundle-isolation` — exit 0.
- [ ] **Step 5:** `bun build:client` — debug bundle builds.
- [ ] **Step 6 (optional):** `bun storybook` / preview `/debug` — confirm panels, kit controls, status pills, and empties render consistently with `/admin`.

No commit — gate over Tasks 1–13.

---

## Self-Review (completed during authoring)

- **Spec coverage:** every `/debug` anti-pattern from the inventory → a task: status-tone (T1), Btn (T2,T3), Input/Select (T3), Panel (T3–T8), EmptyState (T4,T6,T8,T13), StatusPill (T5,T9,T11,T12), JsonCell (T4), SummaryList/KV (T10,T11,T12), DataTable (T10), fmtNum (T8,T11). Deliberately untouched: deep `<pre>` JSON dumps + `TreeView` (not the compact-cell anti-pattern) — stated in Goal/Architecture.
- **Placeholder scan:** complete before/after for every change; fixtures are the only "fill-in" and are explicitly tied to reading `client/debug/dashboard-types.ts` (grounding, not placeholder).
- **Type consistency:** `Panel`(`title`,`count`,`action`,`body` snippets), `Btn`(`variant`,`size`,`onClick`,`children`), `Input`(`value`,`onInput`,`placeholder`), `Select`(`value`,`options`,`onChange`), `StatusPill`(`status`,`dot`), `SummaryList`(`items`,`cols`), `KV`(`k`,`v`), `DataTable`(`columns`,`rows`,`rowKey`), `JsonCell`(`value`), `EmptyState`(`title`), `fmtNum` — all match Phase 1 + Phase 2.3 APIs and existing admin usage.
- **status-tone additions** (T1) are consumed by T5 (retriable), T9 (active/idle — already mapped), T11 (ok/failed — already mapped), T12 (levelName → warn/error/info already; trace/debug/fatal added).

---

## Phase 3 decomposition (remaining: /settings)

`/settings` is a far larger surface (~52 raw buttons, ~30 inputs, 6 tables, ~25 raw `<label>` field wrappers across 16 files) and notably runs its **own `settings.css` shadow-styling layer** (`.settings-form input/button/select/label`, `.settings-table`, `.masked-value`, `.placeholder`) that duplicates the kit. It splits into two sub-plans, authored next:

- **Phase 3.2 — /settings user sections + shared `ConfigFieldRow`.** Files: `ConfigFieldRow`, `ProfileSection`, `TaskProviderSection`, `ToolsSection`, `McpSection`, `PluginsSection`, `IdentitySection`, `MembersSection`, `GroupProviderSection`. Covers: `Btn`, `Field`+`Input`/`Select`, `FormRow`, `Secret` (masked values), `StatusPill`/`Pill` (eligibility/domain-summary via local tone mappers), `DataTable` (members table), `EmptyState`, the `<dl>` provision result → `SummaryList`/`Secret`. **Prerequisite kit decisions** flagged for that plan: (a) a `textarea`/multiline mode for `Input` (AdminAnnounce message — actually settings-admin) and (b) whether a checkbox/toggle primitive is needed (`McpSection` "Enabled") — likely keep the native checkbox.
- **Phase 3.3 — /settings admin sections.** Files: `AdminAdminsSection`, `AdminAnnounceSection`, `AdminGroupsSection`, `AdminInstancesSection`, `AdminPluginsApprovalSection`, `AdminPluginsConfigSection`, `AdminSystemSection`, `AdminUsersSection`. Covers: `Btn`, `Field`+`Input`/`Select`, `DataTable` (5 tables, status cells → `StatusPill`), `Secret` (masked config/system values), `EmptyState`, plus the `textarea` decision for `AdminAnnounceSection`.
- **Cleanup (end of 3.3):** once all consumers migrate, delete the now-dead `.settings-form *`, `.settings-table`, `.masked-value`, `.placeholder` rules from `settings.css` and verify `bun check:bundle-isolation` + visual parity.
