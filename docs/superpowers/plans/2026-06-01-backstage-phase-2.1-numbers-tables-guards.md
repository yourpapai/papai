<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Backstage Phase 2.1 — Numbers, Tables & Chart Guards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt the Phase 1 kit + helpers in the `/admin` stats/billing surfaces — consolidate the three divergent `formatBytes` copies onto the shared `fmtBytes`, fix the `SubjectsTable` alignment/number-format bugs (A1/A4) by routing it through `DataTable` + `fmtNum`, harden the active-subjects (A5) and surface-mix (A6) widgets with the over-capacity-aware `Stat` and `Meter`, and add regression-guard tests for the already-fixed tool-calls chart/header bugs (A2/A3/C1).

**Architecture:** Pure consumer-side adoption in `client/admin/`. No new kit components (those shipped in Phase 1). Each task is a refactor of one existing Svelte component plus its test; behavior-preserving except the deliberately-flagged byte-format change.

**Tech Stack:** Bun, Svelte 5 (runes), TypeScript (strict), `bun:test` + happy-dom.

**Spec:** `docs/superpowers/specs/2026-06-01-backstage-admin-ui-fixes-design.md` (§5 Layer 1 consolidation, §7 findings A1, A4, A5, A6, A2, A3, C1, and the data-correctness note).

**Depends on:** Phase 1 (commits `018529c1`..`e46b13ec`) — `fmtNum`, `fmtBytes` in `client/shared/helpers.ts`; `Stat`, `Meter`, `StatusPill` in `client/shared/ui/`.

---

## Conventions (apply to every task)

- **TDD write-hook** enforces test-first on `client/` files. For a refactor: first update/extend the component's test to assert the NEW desired output, run it to confirm it FAILS against current code (Red), then refactor (Green). If a component has no test yet, create one.
- Run a test file: `bun test:client ./tests/client/admin/<Name>.test.ts` (runs the whole client suite; find your file's lines). Ignore a single unrelated `ECONNREFUSED` in `admin-split-boundaries.test.ts`.
- No `lint-disable`/`ts-ignore`/`@ts-nocheck`. `.svelte` local TS imports use the `.js` extension. Run `bun format <files>` before committing if `format:check` complains.
- **Commit each task separately and SCOPED** (`git add <files> && git commit -m "..." -- <files>`) to the current branch (`master`). NEVER stage/touch/revert `.opencode/plugins/tdd-enforcement.ts` or `tests/opencode-tdd-enforcement.test.ts` (unrelated concurrent-session changes).
- BillingSubject type lives in `client/shared/api-types.ts`; `GlobalStats` too.

---

## ⚠️ Deliberate behavior change (Task 1)

`client/admin/sections/OverviewSection.svelte` currently formats bytes in **base-1000** (`/1_000`). `StatsPanel.svelte` and `SubjectStatsPanel.svelte` use **base-1024** with **2-dp GB**. The shared `fmtBytes` is **base-1024** and uses `toFixed(1)` only for values `< 10`, else `toFixed(0)`. Consolidating therefore changes displayed values:

- Overview: a `1_500_000`-byte value renders `1.4 MB` (1024-based) instead of `1.5 MB` (1000-based).
- All three: values `≥ 10` in a unit lose their decimal (e.g. `271.3 KB` → `271 KB`, `12.4 MB` → `12 MB`).

This is intended (one canonical formatter). Each task's test asserts the new `fmtBytes` output, and the implementer must verify the rendered values in Storybook/preview.

---

## File Structure

| File                                               | Change                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `client/admin/sections/OverviewSection.svelte`     | drop local `formatBytes`, import `fmtBytes`; replace surface-mix markup with `Meter` (A6)                          |
| `client/admin/components/StatsPanel.svelte`        | drop local `formatBytes`, import `fmtBytes`; replace active-subjects `MetricCard`s with `Stat` (A5)                |
| `client/admin/components/SubjectStatsPanel.svelte` | drop local `formatBytes`, import `fmtBytes`                                                                        |
| `client/admin/components/SubjectsTable.svelte`     | route through `DataTable` + `fmtNum`, right-align numerics, `StatusPill` for type (A1/A4)                          |
| `tests/client/admin/StatsPanel.test.ts`            | extend: `Stat` over-capacity guard (A5), single tool-calls header (A3), chart-before-table (A2), `fmtBytes` output |
| `tests/client/admin/OverviewSection.test.ts`       | create/extend: `Meter` clamp guard (A6), `fmtBytes` output                                                         |
| `tests/client/admin/SubjectsTable.test.ts`         | create/extend: right-aligned numeric cells + `fmtNum` separators + `StatusPill` type                               |
| `tests/client/admin/SubjectStatsPanel.test.ts`     | extend/confirm: `fmtBytes` output                                                                                  |

---

## Task 1: Consolidate `formatBytes` → shared `fmtBytes`

**Files:**

- Modify: `client/admin/sections/OverviewSection.svelte:50-55`, `client/admin/components/StatsPanel.svelte:34-39`, `client/admin/components/SubjectStatsPanel.svelte:22-27`
- Test: `tests/client/admin/StatsPanel.test.ts`, `tests/client/admin/OverviewSection.test.ts`, `tests/client/admin/SubjectStatsPanel.test.ts`

- [ ] **Step 1: Write/extend the failing test (StatsPanel byte output).** Add to `tests/client/admin/StatsPanel.test.ts` a test that mounts `StatsPanel` with a `globalStats` fixture whose `storage.sqliteBytes = 277806` and asserts the rendered text contains `271 KB` (the `fmtBytes` output), NOT `271.3 KB`. Use the existing fixture/mount pattern already in that file (read it first; reuse its `GlobalStats` fixture builder). Example assertion:

```ts
test('formats storage bytes via the shared fmtBytes (base-1024, no decimals >=10)', () => {
  // ...mount StatsPanel with globalStats.storage.sqliteBytes = 277806...
  expect(target.textContent).toContain('271 KB')
  expect(target.textContent).not.toContain('271.3 KB')
})
```

- [ ] **Step 2: Run** `bun test:client ./tests/client/admin/StatsPanel.test.ts` — expect the new test to FAIL (current local `formatBytes` outputs `271.3 KB`).

- [ ] **Step 3: Refactor StatsPanel.** In `client/admin/components/StatsPanel.svelte`: delete the local `formatBytes` function (lines 34-39) and add to the import block:

```ts
import { fmtBytes } from '../../shared/helpers.js'
```

Then replace the two call sites (currently `formatBytes(g.storage.sqliteBytes)` and `formatBytes(g.storage.s3AttachmentBytes)`) with `fmtBytes(...)`.

- [ ] **Step 4: Refactor SubjectStatsPanel.** In `client/admin/components/SubjectStatsPanel.svelte`: delete the local `formatBytes` (lines 22-27), add `import { fmtBytes } from '../../shared/helpers.js'`, and replace every `formatBytes(` call with `fmtBytes(`.

- [ ] **Step 5: Refactor OverviewSection.** In `client/admin/sections/OverviewSection.svelte`: delete the local base-1000 `formatBytes` (lines 50-55), add `import { fmtBytes } from '../../shared/helpers.js'`, and replace every `formatBytes(` call (lines 60-67) with `fmtBytes(`.

- [ ] **Step 6: Add/extend byte-output tests for Overview and SubjectStats.** In `tests/client/admin/OverviewSection.test.ts` (create if absent, following the `StatsPanel.test.ts` mount pattern and `adminGlobals` store usage) assert that storage `1_500_000` renders `1.4 MB` (base-1024) not `1.5 MB`. In `tests/client/admin/SubjectStatsPanel.test.ts` assert a representative `fmtBytes` value.

- [ ] **Step 7: Run all three test files** — expect PASS:

```
bun test:client ./tests/client/admin/StatsPanel.test.ts ./tests/client/admin/OverviewSection.test.ts ./tests/client/admin/SubjectStatsPanel.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add client/admin/sections/OverviewSection.svelte client/admin/components/StatsPanel.svelte client/admin/components/SubjectStatsPanel.svelte tests/client/admin/StatsPanel.test.ts tests/client/admin/OverviewSection.test.ts tests/client/admin/SubjectStatsPanel.test.ts
git commit -m "refactor(admin): consolidate byte formatting onto shared fmtBytes" -- client/admin/sections/OverviewSection.svelte client/admin/components/StatsPanel.svelte client/admin/components/SubjectStatsPanel.svelte tests/client/admin/StatsPanel.test.ts tests/client/admin/OverviewSection.test.ts tests/client/admin/SubjectStatsPanel.test.ts
```

---

## Task 2: A1/A4 — `SubjectsTable` → `DataTable` + `fmtNum`

**Files:**

- Modify: `client/admin/components/SubjectsTable.svelte` (full rewrite of markup)
- Test: `tests/client/admin/SubjectsTable.test.ts` (create if absent)

Current state (`SubjectsTable.svelte`): a raw `<table>` with no column widths, numeric cells (`{subject.totals.main.inputTokens} / {...outputTokens}`, `toolCalls`, etc.) rendered as bare integers, left-aligned, no thousands separators (A1, A4). Rows are clickable via `onclick`/`onkeydown`.

- [ ] **Step 1: Write the failing test** — `tests/client/admin/SubjectsTable.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import SubjectsTable from '../../../client/admin/components/SubjectsTable.svelte'
import type { BillingSubject } from '../../../client/shared/api-types'

function subject(over: Partial<BillingSubject> = {}): BillingSubject {
  return {
    storageContextId: 'ctx-1',
    displayName: 'трясина-рутина',
    contextType: 'group',
    totals: {
      main: { inputTokens: 301998, outputTokens: 1801 },
      small: { inputTokens: 0, outputTokens: 0 },
      embedding: { inputTokens: 12000 },
    },
    toolCalls: 385,
    lastActiveAt: Date.parse('2026-05-21T20:42:00Z'),
    ...over,
  } as BillingSubject
}

describe('SubjectsTable.svelte', () => {
  test('renders numeric token totals with thousands separators, right-aligned', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(SubjectsTable, { target, props: { subjects: [subject()], onSelect: () => {} } })
    expect(target.textContent).toContain('301,998')
    // numeric column cells are right-aligned via DataTable
    expect(target.querySelector('.ui-datatable__td--right')).not.toBeNull()
    void unmount(c)
  })

  test('renders the context type as a StatusPill', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(SubjectsTable, { target, props: { subjects: [subject()], onSelect: () => {} } })
    expect(target.querySelector('.ui-pill')).not.toBeNull()
    void unmount(c)
  })

  test('fires onSelect with the original subject when a row is clicked', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    let picked: BillingSubject | null = null
    const c = mount(SubjectsTable, {
      target,
      props: {
        subjects: [subject()],
        onSelect: (s: BillingSubject) => {
          picked = s
        },
      },
    })
    target.querySelector<HTMLElement>('.ui-datatable__tr')!.click()
    expect(picked?.storageContextId).toBe('ctx-1')
    void unmount(c)
  })
})
```

> If the real `BillingSubject` shape differs (read `client/shared/api-types.ts` first), adjust the fixture to the real fields — keep the three assertions. The `totals` sub-shape in the current component is `main.{inputTokens,outputTokens}`, `small.{inputTokens,outputTokens}`, `embedding.{inputTokens}`.

- [ ] **Step 2: Run** `bun test:client ./tests/client/admin/SubjectsTable.test.ts` — expect FAIL (no `.ui-datatable`, no separators, no `.ui-pill`).

- [ ] **Step 3: Rewrite `SubjectsTable.svelte`** to route through `DataTable`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { fmtNum, formatTime } from '../../shared/helpers.js'
  import type { BillingSubject } from '../../shared/api-types.js'
  import DataTable from '../../shared/ui/DataTable.svelte'
  import StatusPill from '../../shared/ui/StatusPill.svelte'

  interface Props {
    subjects: readonly BillingSubject[]
    onSelect: (subject: BillingSubject) => void
  }

  let { subjects, onSelect }: Props = $props()

  function displayLabel(subject: BillingSubject): string {
    if (subject.displayName !== null && subject.displayName !== '') return subject.displayName
    return subject.storageContextId
  }

  interface Row {
    storageContextId: string
    subject: string
    type: string
    main: string
    small: string
    embedding: string
    tools: string
    last: string
  }

  const rows = $derived<Row[]>(
    subjects.map((s) => ({
      storageContextId: s.storageContextId,
      subject: displayLabel(s),
      type: s.contextType,
      main: `${fmtNum(s.totals.main.inputTokens, 0)} / ${fmtNum(s.totals.main.outputTokens, 0)}`,
      small: `${fmtNum(s.totals.small.inputTokens, 0)} / ${fmtNum(s.totals.small.outputTokens, 0)}`,
      embedding: fmtNum(s.totals.embedding.inputTokens, 0),
      tools: fmtNum(s.toolCalls, 0),
      last: formatTime(new Date(s.lastActiveAt).toISOString()),
    })),
  )

  const byId = $derived(new Map(subjects.map((s) => [s.storageContextId, s])))

  const columns = [
    { key: 'subject' as const, label: 'Subject', width: '1.4fr' },
    { key: 'type' as const, label: 'Type', width: '80px' },
    { key: 'main' as const, label: 'Main in/out', align: 'right' as const },
    { key: 'small' as const, label: 'Small in/out', align: 'right' as const },
    { key: 'embedding' as const, label: 'Embedding in', align: 'right' as const },
    { key: 'tools' as const, label: 'Tools', width: '70px', align: 'right' as const },
    { key: 'last' as const, label: 'Last active', width: '96px', align: 'right' as const },
  ]

  function handleRowClick(row: Row): void {
    const found = byId.get(row.storageContextId)
    if (found !== undefined) onSelect(found)
  }
</script>

<section class="subjects-table">
  <h3>Subjects <span class="count-badge">{subjects.length}</span></h3>
  <DataTable
    {columns}
    {rows}
    rowKey="storageContextId"
    onRowClick={handleRowClick}>
    {#snippet cell(row, col)}
      {#if col.key === 'type'}
        <StatusPill status={row.type} dot={false} />
      {:else}
        {String(row[col.key] ?? '')}
      {/if}
    {/snippet}
    {#snippet empty()}No usage in the selected window{/snippet}
  </DataTable>
</section>
```

> Notes for the implementer:
>
> - `DataTable`'s `cell` snippet type is `Snippet<[Row, Column<Row>]>` — when a `cell` snippet is provided it is used for ALL columns, so the `{:else}` branch must render the default text.
> - `DataTable` already right-aligns `align: 'right'` columns (`.ui-datatable__td--right`) and applies `tabular-nums`.
> - `DataTable` guards row clicks against `a`/`button` targets; the `StatusPill` is a `span`, so clicks anywhere on a row fire `onRowClick`.
> - **Known limitation:** the previous raw table had `tabindex`/`role=button`/`onkeydown` keyboard activation; `DataTable` rows are click-only. This is a pre-existing-nicety regression; if keyboard activation must be preserved, add it to `DataTable` as a separate scoped change (out of scope here — note it in the commit body).
> - Keep the existing `<section class="subjects-table">` + `<h3>` wrapper and its `.count-badge`/`.placeholder` styles, or migrate the header to `PageHeader` in Task group 2.2. Leave the `<style>` block's still-referenced rules; drop rules that referenced the removed `<table>`/`<th>`/`<td>` if they are now dead (verify with the rendered output).

- [ ] **Step 4: Run** `bun test:client ./tests/client/admin/SubjectsTable.test.ts` — expect PASS.

- [ ] **Step 5: Visual check (preview/Storybook).** Confirm columns align, numbers right-align with separators, type shows as a pill, and row-click still opens the subject detail.

- [ ] **Step 6: Commit**

```bash
git add client/admin/components/SubjectsTable.svelte tests/client/admin/SubjectsTable.test.ts
git commit -m "fix(admin): render SubjectsTable via DataTable with right-aligned formatted numerics (A1/A4)" -- client/admin/components/SubjectsTable.svelte tests/client/admin/SubjectsTable.test.ts
```

---

## Task 3: A5 — active-subjects via `Stat` (over-capacity guard)

**Files:**

- Modify: `client/admin/components/StatsPanel.svelte` (active-subjects panel body, lines 194-202)
- Test: `tests/client/admin/StatsPanel.test.ts`

Current: three `MetricCard`s with `sub={`of ${totalSubjects}`}`. The denominator logic is already correct (Task verified in spec §7), but `MetricCard` cannot surface the "value > total" data bug. Replace with `Stat` (which flags over-capacity in warn).

- [ ] **Step 1: Extend the failing test.** In `tests/client/admin/StatsPanel.test.ts`, add a test mounting `StatsPanel` with a fixture where `active.activeIn30d = 13` and `subjects.dmTotal + subjects.groupTotal = 4` (the audit's "13 of 4" case), asserting the over state renders:

```ts
test('flags active-subject count exceeding total via Stat warn state (A5)', () => {
  // mount with active.activeIn30d=13, subjects totals summing to 4
  expect(target.querySelector('.ui-stat__value--over')).not.toBeNull()
  expect(target.textContent).toContain('exceeds total')
})
```

- [ ] **Step 2: Run** the file — expect FAIL (no `.ui-stat__value--over`; currently `MetricCard`).

- [ ] **Step 3: Refactor.** In `StatsPanel.svelte`: add `import Stat from '../../shared/ui/Stat.svelte'` and replace the active-subjects panel body:

```svelte
<Panel title="active subjects">
  {#snippet body()}
    <div class="stats-panel__metrics">
      <Stat label="1d" value={g.active.activeIn1d} of={totalSubjects} />
      <Stat label="7d" value={g.active.activeIn7d} of={totalSubjects} />
      <Stat label="30d" value={g.active.activeIn30d} of={totalSubjects} />
    </div>
  {/snippet}
</Panel>
```

(Leave the storage panel on `MetricCard` — `Stat`'s `of`-less form is value-only, but storage shows formatted byte strings without a denominator; `MetricCard` remains the right fit there.)

- [ ] **Step 4: Run** — expect PASS. Also re-run the existing StatsPanel tests to confirm no regression in the "of N" text (the new `Stat` renders `of {of}` too).

- [ ] **Step 5: Commit**

```bash
git add client/admin/components/StatsPanel.svelte tests/client/admin/StatsPanel.test.ts
git commit -m "fix(admin): render active subjects via Stat to flag over-capacity (A5)" -- client/admin/components/StatsPanel.svelte tests/client/admin/StatsPanel.test.ts
```

---

## Task 4: A6 — surface-mix via `Meter` (clamped, warn-on-over)

**Files:**

- Modify: `client/admin/sections/OverviewSection.svelte` (surface-mix block, lines 123-140; remove `.overview__mix-*` markup)
- Test: `tests/client/admin/OverviewSection.test.ts`

Current: hand-rolled `.overview__mix-row`/`-bar`/`-fill` with an inline `Math.min(100, ...)` clamp. Replace with `Meter`, which clamps to 100% and turns warn when `value > total`.

- [ ] **Step 1: Extend the failing test.** In `tests/client/admin/OverviewSection.test.ts`, mount with `surfaceMix.subjectsWithInstructions = 11` and subject total `= 4` (the audit's "instructions 11/4"), assert the `Meter` over state:

```ts
test('renders surface mix via Meter, clamping over-capacity to warn (A6)', () => {
  // mount OverviewSection with adminGlobals fixture: surfaceMix.subjectsWithInstructions=11, subjects totals summing to 4
  const overFill = target.querySelector('.ui-meter__fill--warn')
  expect(overFill).not.toBeNull()
  expect((overFill as HTMLElement).style.width).toBe('100%')
})
```

- [ ] **Step 2: Run** — expect FAIL (no `.ui-meter__fill--warn`; currently `.overview__mix-fill`).

- [ ] **Step 3: Refactor.** In `OverviewSection.svelte`: add `import Meter from '../../shared/ui/Meter.svelte'` and replace the surface-mix panel body:

```svelte
<Panel title="surface mix">
  {#snippet body()}
    <div class="overview__mix">
      {#each surfaceMix as row (row.label)}
        <Meter label={row.label} value={row.n} total={row.total} />
      {/each}
    </div>
  {/snippet}
</Panel>
```

Then delete the now-unused `.overview__mix-row`, `.overview__mix-label`, `.overview__mix-bar`, `.overview__mix-fill`, `.overview__mix-count` style rules (keep `.overview__mix` as the flex container — `Meter` provides its own label/value/track).

- [ ] **Step 4: Run** — expect PASS.

- [ ] **Step 5: Visual check.** Confirm bars clamp at 100% and turn amber when `n > total`.

- [ ] **Step 6: Commit**

```bash
git add client/admin/sections/OverviewSection.svelte tests/client/admin/OverviewSection.test.ts
git commit -m "fix(admin): render surface mix via Meter with clamped over-capacity (A6)" -- client/admin/sections/OverviewSection.svelte tests/client/admin/OverviewSection.test.ts
```

---

## Task 5: A2/A3/C1 — regression-guard tests (already-fixed)

**Files:**

- Test only: `tests/client/admin/StatsPanel.test.ts`

These bugs are already fixed in current code (verified in spec §7). Add tests that lock the fixes so a future refactor can't reintroduce them. No production change.

- [ ] **Step 1: Add the guard tests** to `tests/client/admin/StatsPanel.test.ts` (reuse the file's existing fixture/mount helpers):

```ts
test('tool-calls panel renders exactly one DataTable header row (A3 guard)', () => {
  // mount StatsPanel with globalStats whose toolMix.topTools has >=1 entry
  const headerCells = target.querySelectorAll('.ui-datatable__th')
  // exactly one header set: Tool / Calls / Success (3 columns) in the tool-calls table
  const toolHeaders = [...headerCells].filter((th) =>
    ['Tool', 'Calls', 'Success'].includes(th.textContent?.trim() ?? ''),
  )
  expect(toolHeaders.length).toBe(3)
})

test('tool-calls chart renders before the table, not overlapping (A2 guard)', () => {
  // mount with toolMix.toolCallGrowth30d non-empty and topTools non-empty
  const spark = target.querySelector('.stats-panel__sparkline')
  const table = target.querySelector('.ui-datatable')
  expect(spark).not.toBeNull()
  expect(table).not.toBeNull()
  // chart precedes the table in document order
  expect(spark!.compareDocumentPosition(table!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})
```

> C1 (zero-height bar) is already guarded by the Phase 1 `tests/client/shared/ui/Bars.test.ts` "all-zero data" / "renders empty svg" cases — no new test needed; note this in the commit body.

- [ ] **Step 2: Run** `bun test:client ./tests/client/admin/StatsPanel.test.ts` — expect PASS (these assert already-correct behavior).

- [ ] **Step 3: Commit**

```bash
git add tests/client/admin/StatsPanel.test.ts
git commit -m "test(admin): regression guards for tool-calls chart/header (A2/A3)" -- tests/client/admin/StatsPanel.test.ts
```

---

## Task 6: Read-only `/stats/*` aggregation verification (A4/A5/A6 server note)

**Files:** none (investigation only — produces a note, not code).

The audit flagged A4/A5/A6 as also server-side aggregation bugs (wrong denominators). The client logic is already correct; this task confirms the server side and records findings. **Do not change server code in this plan** — if a real bug is found, record it for a separate follow-up.

- [ ] **Step 1: Read the aggregation source.** `src/stats/index.ts` (`getGlobalStats`), and the queries feeding `active.activeIn{1,7,30}d`, `subjects.{dmTotal,groupTotal}`, and `surfaceMix.subjectsWith*`. Confirm the active-subject numerators and the surface-mix numerators use the SAME distinct-subject base as `dmTotal + groupTotal` (the denominator the UI now divides by).

- [ ] **Step 2: Write the finding** into this plan file under a new "## Verification findings (Task 6)" section: either "✅ denominators consistent — no server change needed" with the specific function/line references, or "⚠️ mismatch found: <description>" with a precise repro and a recommendation to open a separate fix task. Commit the doc update:

```bash
git add docs/superpowers/plans/2026-06-01-backstage-phase-2.1-numbers-tables-guards.md
git commit -m "docs(plan): record /stats aggregation verification findings (phase 2.1)" -- docs/superpowers/plans/2026-06-01-backstage-phase-2.1-numbers-tables-guards.md
```

---

## Task 7: Phase 2.1 gate

**Files:** none (verification only).

- [ ] **Step 1:** `bun test:client` — expect all pass (ignore one unrelated `ECONNREFUSED`).
- [ ] **Step 2:** `bun check:bundle-isolation` — expect exit 0.
- [ ] **Step 3:** `bun typecheck` — expect no errors.
- [ ] **Step 4:** `bun build:client` — expect debug/admin/settings bundles build.
- [ ] **Step 5 (optional):** `bun storybook` — confirm the admin sections render with aligned tables, clamped meters, and over-capacity warn states.

No commit — this is a gate over Tasks 1–6.

---

## Self-Review (completed during authoring)

- **Spec coverage:** §5 Layer-1 consolidation → Task 1; A1/A4 → Task 2; A5 → Task 3; A6 → Task 4; A2/A3 guards → Task 5; C1 guard → covered by Phase 1 Bars tests (noted in Task 5); data-correctness server note → Task 6.
- **Placeholder scan:** complete code for every refactor; the only "fill-in" is the implementer adapting test fixtures to the real `BillingSubject`/`GlobalStats` shapes (explicitly instructed to read `client/shared/api-types.ts` first) — this is grounding against the live type, not a placeholder.
- **Type consistency:** `fmtBytes`/`fmtNum` signatures match Phase 1 (`helpers.ts`); `DataTable` `cell` snippet signature `Snippet<[Row, Column<Row>]>` and `rowKey`/`onRowClick` props match the committed `DataTable.svelte`; `Stat` (`label,value,of`) and `Meter` (`label,value,total`) props match the committed components; `StatusPill` (`status,dot`) matches.
- **Known limitation recorded:** `DataTable` lacks keyboard row activation (Task 2 note) — flagged, not silently dropped.

## Remaining Phase 2 sub-plans (authored next, on request)

- **2.2 — Section headers (B1):** `PageHeader` in `StatsPanel`, `SystemSection`, `InstancesSection`, `PluginConfigSection` (removes the eyebrow + `<h2>` double-title).
- **2.3 — InstancesSection (B2/B3/B4/B5):** raw buttons→`Btn`, raw inputs→`Input`/`Field`, status text→`StatusPill`, `JSON.stringify` cell→`JsonCell`.
- **2.4 — Forms & status (A7, B2/B3/B4, B7, C2):** Reminders/Memos/Identities/Groups/Billing/Credentials/PluginConfig.
- **2.5 — System summary (B6):** `SystemSection` `<dl>` → `SummaryList`.
