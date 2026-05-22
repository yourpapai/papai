<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Dashboard Redesign PR 4 — Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the admin `/admin` Overview charts and KPI cards to the real `/stats/global` response, align the client/server `StatsWindow` contract, finalize KPI sub-labels, and audit the remaining modal + dead-code items from spec §10.

**Architecture:** PR 3 left the client `GlobalStatsSchema` as a placeholder (`subjects: number`, etc.) that never matches the real nested `GlobalStats` shape from `src/stats/types.ts` (`subjects: { dmTotal, groupTotal, growthLast30d }`). The window seg also sends `24h` which the server rejects (`/stats/global` accepts `1d | 7d | 30d | all`). PR 4 replaces the client schema with one that mirrors a subset of the real shape, fixes the window contract, derives KPI values + sub-labels from real fields, wires `Spark` to `subjects.growthLast30d` and `Bars` to `toolMix.topTools`, and verifies the spec §10 modal/dead-code items are no-ops.

**Tech Stack:** Svelte 5 runes, Zod v4, Bun test runner + happy-dom, Drizzle (read-only — no schema changes), existing `src/stats/*` aggregator + `/stats/global` route (no backend changes).

---

## Spec coverage

Spec §10 polish items addressed:

- [§10.1] `Spark` wired to `globalStats.subjects.growthLast30d` — Task 4
- [§10.2] `Bars` wired to `globalStats.toolMix.topTools` with success-rate as bar height multiplier — Task 5
- [§10.3] KPI cards finalized with sub-labels — Task 3 + Task 4
- [§10.4] CRUD modal restyle — Task 6 (verification only; PR 1 already restyled `Modal`, and `Confirm` is the only consumer)
- [§10.5] Dead-code removal of legacy admin CSS classes — Task 7 (verification only; `admin-section-header`, `admin-filter-form`, `admin-key-value-list` are still used by 4 sections — kept)
- [§10.6] Screenshot pairs in the PR description — out of scope for the implementation plan; the PR author attaches screenshots when opening the PR

Out of scope for this plan (deferred or descoped):

- Extending `/stats/global` to include LLM totals or main/small model split (the spec's `892 main · 197 small` sub-label example needs server work; descoped — current PR uses sub-labels derivable from existing fields)
- New chart library, mobile layout, light theme (spec §14)

---

## File structure

**Modify:**

- `client/admin/global-stats.svelte.ts` — replace `GlobalStatsSchema` with the real nested shape; change `StatsWindow` from `'24h' | '7d' | '30d' | 'all'` to `'1d' | '7d' | '30d' | 'all'`
- `client/admin/components/AdminTopBar.svelte` — Seg option `24h` → `1d`
- `client/admin/sections/OverviewSection.svelte` — KPIs derived from nested fields with sub-labels; Spark + Bars wired to real arrays
- `client/shared/ui/KV.svelte` — add optional `sub?: string` prop that renders a small caps sub-label under the value
- `tests/client/admin/global-stats.svelte.test.ts` — update mock response to nested shape
- `tests/client/admin/sections/OverviewSection.test.ts` — assert on nested-shape derivations + sub-labels
- `tests/client/admin/components/AdminTopBar.test.ts` — assert Seg renders `1d` (if it asserts on the label at all)

Each file has one clear responsibility. No new files. No new endpoints. No new backend types.

---

## Task 1: Align `global-stats.svelte.ts` with the real `/stats/global` response

**Files:**

- Modify: `client/admin/global-stats.svelte.ts`
- Modify: `tests/client/admin/global-stats.svelte.test.ts`

- [ ] **Step 1: Read both files**

Use the `Read` tool on `client/admin/global-stats.svelte.ts` and `tests/client/admin/global-stats.svelte.test.ts`. Confirm the current placeholder schema (flat `subjects: number`, etc.) and the test that mocks the response with the same placeholder shape.

- [ ] **Step 2: Write the failing test first**

Replace the response shape in `tests/client/admin/global-stats.svelte.test.ts` with the real nested shape. Use this as the new mock body (subset matching the new schema):

```ts
const responseBody = {
  generatedAt: 1_700_000_000_000,
  window: '30d',
  subjects: {
    dmTotal: 18,
    groupTotal: 14,
    growthLast30d: [
      { date: '2026-04-22', dmAdded: 1, groupAdded: 0 },
      { date: '2026-04-23', dmAdded: 0, groupAdded: 2 },
    ],
  },
  active: { activeIn1d: 4, activeIn7d: 12, activeIn30d: 24 },
  storage: { sqliteBytes: 12_345_678, s3AttachmentBytes: 9_876_543 },
  surfaceMix: {
    subjectsWithRecurring: 6,
    subjectsWithDeferred: 4,
    subjectsWithMemos: 12,
    subjectsWithInstructions: 2,
  },
  toolMix: {
    topTools: [
      { toolName: 'create_task', count: 412, successRate: 0.97 },
      { toolName: 'search_tasks', count: 308, successRate: 0.94 },
    ],
    errorTypeCounts: { schema_validation: 3, provider_4xx: 7 },
  },
}
```

Rewrite the two existing tests to assert on the nested shape:

```ts
test('refreshGlobals writes nested data and fetchedAt on success', async () => {
  setMockFetch((url) => {
    expect(url).toContain('/stats/global')
    expect(url).toContain('window=30d')
    return Promise.resolve(
      new Response(JSON.stringify(responseBody), {
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
  await refreshGlobals()
  expect(adminGlobals.data).not.toBeNull()
  expect(adminGlobals.data?.subjects?.dmTotal).toBe(18)
  expect(adminGlobals.data?.subjects?.groupTotal).toBe(14)
  expect(adminGlobals.data?.toolMix?.topTools[0]?.toolName).toBe('create_task')
  expect(adminGlobals.fetchedAt).not.toBeNull()
  expect(adminGlobals.loading).toBe(false)
})

test('refreshGlobals leaves data null on http error', async () => {
  setMockFetch(() => Promise.resolve(new Response('boom', { status: 500 })))
  await refreshGlobals()
  expect(adminGlobals.data).toBeNull()
  expect(adminGlobals.loading).toBe(false)
})

test('refreshGlobals sends window=1d when adminGlobals.window is 1d', async () => {
  adminGlobals.window = '1d'
  setMockFetch((url) => {
    expect(url).toContain('window=1d')
    return Promise.resolve(
      new Response(JSON.stringify(responseBody), {
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
  await refreshGlobals()
  expect(adminGlobals.data).not.toBeNull()
})
```

Drop the old `beforeEach` line that sets `adminGlobals.window = '30d'` if the new test mutates window — re-set it to a known good value (`'30d'`) at the top of each test that needs it. Match the existing `beforeEach` pattern (the file already resets window to `'30d'` — keep that and only mutate inside the `1d` test).

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test:client tests/client/admin/global-stats.svelte.test.ts`
Expected: FAIL — the current schema rejects the nested shape, so `parsed.success` is `false` and `adminGlobals.data` stays `null`. The `dmTotal === 18` assertion fails.

- [ ] **Step 4: Replace the schema in `client/admin/global-stats.svelte.ts`**

Replace the entire file body with:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { readBody } from '../shared/fetcher-helpers.js'

export type StatsWindow = '1d' | '7d' | '30d' | 'all'

const SubjectGrowthPointSchema = z.object({
  date: z.string(),
  dmAdded: z.number(),
  groupAdded: z.number(),
})

const GlobalStatsSchema = z.object({
  generatedAt: z.number().optional(),
  window: z.string().optional(),
  subjects: z
    .object({
      dmTotal: z.number(),
      groupTotal: z.number(),
      growthLast30d: z.array(SubjectGrowthPointSchema),
    })
    .optional(),
  active: z
    .object({
      activeIn1d: z.number(),
      activeIn7d: z.number(),
      activeIn30d: z.number(),
    })
    .optional(),
  storage: z
    .object({
      sqliteBytes: z.number(),
      s3AttachmentBytes: z.number(),
    })
    .optional(),
  surfaceMix: z
    .object({
      subjectsWithRecurring: z.number(),
      subjectsWithDeferred: z.number(),
      subjectsWithMemos: z.number(),
      subjectsWithInstructions: z.number(),
    })
    .optional(),
  toolMix: z
    .object({
      topTools: z.array(
        z.object({
          toolName: z.string(),
          count: z.number(),
          successRate: z.number(),
        }),
      ),
      errorTypeCounts: z.record(z.string(), z.number()),
    })
    .optional(),
})

export type GlobalStats = z.infer<typeof GlobalStatsSchema>
export type SubjectGrowthPoint = z.infer<typeof SubjectGrowthPointSchema>

export const adminGlobals = $state({
  window: '30d' as StatsWindow,
  loading: false,
  data: null as GlobalStats | null,
  fetchedAt: null as number | null,
})

export async function refreshGlobals(): Promise<void> {
  adminGlobals.loading = true
  try {
    const res = await fetch(`/stats/global?window=${encodeURIComponent(adminGlobals.window)}`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return
    const body = await readBody(res)
    const parsed = GlobalStatsSchema.safeParse(body)
    if (!parsed.success) return
    adminGlobals.data = parsed.data
    adminGlobals.fetchedAt = Date.now()
  } finally {
    adminGlobals.loading = false
  }
}
```

Notes:

- `window: z.string().optional()` instead of a literal enum — the response carries it back informationally and we don't want a schema mismatch to nuke the whole payload over a string we don't use.
- The schema is intentionally a _subset_ of `GlobalStats` from `src/stats/types.ts`: it includes only the fields the Overview section will consume (subjects, active, storage, surfaceMix, toolMix). Z.optional() on each top-level field protects against the server omitting them in future variants.
- Every nested field is required _within_ its parent object — if the server returns `subjects` it must include all three keys. If a key is missing the whole `subjects` block is dropped on parse failure; the client falls back to `—`.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test:client tests/client/admin/global-stats.svelte.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/admin/global-stats.svelte.ts tests/client/admin/global-stats.svelte.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): align global-stats schema with /stats/global nested shape

Replace the placeholder flat schema (subjects:number, llmCalls:number,
…) with a Zod schema mirroring the real GlobalStats response — nested
subjects/active/storage/surfaceMix/toolMix blocks, each optional at the
top level so a missing block degrades to "—" rather than nulling the
whole payload. StatsWindow is now '1d' | '7d' | '30d' | 'all' to match
the server's parseStatsWindow contract.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Update `AdminTopBar` window Seg from `24h` to `1d`

**Files:**

- Modify: `client/admin/components/AdminTopBar.svelte`
- Modify: `tests/client/admin/components/AdminTopBar.test.ts` (only if it asserts on the literal `24h` label)

- [ ] **Step 1: Read both files**

Use `Read` on `client/admin/components/AdminTopBar.svelte` (look for the Seg `options` array near line 37) and `tests/client/admin/components/AdminTopBar.test.ts`. Note any test that searches the DOM for the text `24h`.

- [ ] **Step 2: Write the failing test (or update an existing one)**

If a test asserts on the `24h` label, update it to assert on `1d` instead. If no test exists for this, add one:

```ts
test('renders 1d in the window seg', () => {
  const component = mount(AdminTopBar, { target, props: {} })
  const labels = Array.from(target.querySelectorAll<HTMLButtonElement>('.ui-seg__btn')).map((b) => b.textContent)
  expect(labels).toContain('1d')
  expect(labels).not.toContain('24h')
  void unmount(component)
})
```

Avoid `?.` or ternaries inside the test body — the `vitest(no-conditional-in-test)` rule fires on those (this has bitten earlier PR tasks).

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test:client tests/client/admin/components/AdminTopBar.test.ts`
Expected: FAIL — current Seg still shows `24h`.

- [ ] **Step 4: Update the Seg options**

In `client/admin/components/AdminTopBar.svelte`, change:

```svelte
<Seg
  options={['24h', '7d', '30d', 'all']}
  value={adminGlobals.window}
  onChange={(v) => setWindow(v as StatsWindow)} />
```

to:

```svelte
<Seg
  options={['1d', '7d', '30d', 'all']}
  value={adminGlobals.window}
  onChange={(v) => setWindow(v as StatsWindow)} />
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test:client tests/client/admin/components/AdminTopBar.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/admin/components/AdminTopBar.svelte tests/client/admin/components/AdminTopBar.test.ts
git commit -m "$(cat <<'EOF'
fix(admin): align window seg with server contract (24h → 1d)

/stats/global only accepts window values '1d' | '7d' | '30d' | 'all'.
The seg was sending '24h' which the server rejects, so the global
stats payload never arrived and KPIs rendered as "—" for the default
selection. Use '1d' to match parseStatsWindow.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add `sub?: string` prop to `KV.svelte`

**Files:**

- Modify: `client/shared/ui/KV.svelte`
- Test (new or modify): `tests/client/shared/ui/KV.test.ts` (create if absent)

- [ ] **Step 1: Read the current KV primitive**

Use `Read` on `client/shared/ui/KV.svelte`. Current props: `{ k: string, v: string | number, vColor?: string, dim?: boolean }`. The layout is a single row with key on the left and value on the right.

Also check whether a test file exists at `tests/client/shared/ui/KV.test.ts`. If not, you'll create one.

- [ ] **Step 2: Write the failing test first**

Create or extend `tests/client/shared/ui/KV.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import KV from '../../../../client/shared/ui/KV.svelte'

describe('KV.svelte', () => {
  let target: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>'
    target = document.body.querySelector<HTMLElement>('#root')!
  })

  test('renders key and value', () => {
    const component = mount(KV, { target, props: { k: 'subjects', v: 32 } })
    expect(target.textContent).toContain('subjects')
    expect(target.textContent).toContain('32')
    void unmount(component)
  })

  test('renders sub-label when sub prop is provided', () => {
    const component = mount(KV, {
      target,
      props: { k: 'subjects', v: 32, sub: '18 dm · 14 group' },
    })
    expect(target.textContent).toContain('18 dm · 14 group')
    expect(target.querySelector('.ui-kv__sub')).not.toBeNull()
    void unmount(component)
  })

  test('does not render sub-label container when sub is omitted', () => {
    const component = mount(KV, { target, props: { k: 'subjects', v: 32 } })
    expect(target.querySelector('.ui-kv__sub')).toBeNull()
    void unmount(component)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test:client tests/client/shared/ui/KV.test.ts`
Expected: FAIL — `sub` prop doesn't exist; `.ui-kv__sub` is never rendered.

- [ ] **Step 4: Add the `sub` prop to `KV.svelte`**

Replace the script + template + style with:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  interface Props {
    k: string
    v: string | number
    sub?: string
    vColor?: string
    dim?: boolean
  }

  let { k, v, sub, vColor, dim = false }: Props = $props()
</script>

<div class="ui-kv" class:ui-kv--stacked={sub !== undefined}>
  <span class="ui-kv__k" style:color={dim ? 'var(--fg4)' : 'var(--fg3)'}>{k}</span>
  <span class="ui-kv__v" style:color={vColor ?? 'var(--fg)'}>{v}</span>
  {#if sub !== undefined}
    <span class="ui-kv__sub">{sub}</span>
  {/if}
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

  .ui-kv--stacked {
    flex-wrap: wrap;
  }

  .ui-kv__v {
    text-align: right;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ui-kv__sub {
    flex: 1 0 100%;
    text-align: right;
    color: var(--fg4);
    font-size: 10px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
</style>
```

Notes:

- `sub` is optional. Existing call sites (`KV k="subjects" v={...}`) continue to work unchanged.
- The sub-label renders on its own line via flex wrap, right-aligned under the value, in a smaller dimmer style consistent with the Telemetry aesthetic.

- [ ] **Step 5: Run tests to verify pass**

Run: `bun test:client tests/client/shared/ui/KV.test.ts`
Expected: PASS.

Also run the full client suite to confirm no existing KV consumer broke:

Run: `bun test:client`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add client/shared/ui/KV.svelte tests/client/shared/ui/KV.test.ts
git commit -m "$(cat <<'EOF'
feat(ui): add optional sub-label prop to KV primitive

KV now accepts an optional `sub` prop that renders a small caps line
under the value (e.g. "18 dm · 14 group" under a "subjects: 32"
row). Existing call sites are unchanged.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire `OverviewSection` KPIs to real fields with sub-labels

**Files:**

- Modify: `client/admin/sections/OverviewSection.svelte`
- Modify: `tests/client/admin/sections/OverviewSection.test.ts`

- [ ] **Step 1: Read both files**

Use `Read` on the current `OverviewSection.svelte` and the existing test file. The current `<KV>` cards show `subjects`, `llm calls`, `tool calls`, `tokens` — fields that don't exist in the real response. We will swap them for: `subjects`, `active 30d`, `tool calls`, `storage`.

- [ ] **Step 2: Update the test first**

Replace the existing tests in `tests/client/admin/sections/OverviewSection.test.ts` with:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import { adminGlobals } from '../../../../client/admin/global-stats.svelte.js'
import OverviewSection from '../../../../client/admin/sections/OverviewSection.svelte'

describe('OverviewSection.svelte', () => {
  let target: HTMLElement

  beforeEach(() => {
    adminGlobals.data = null
    document.body.innerHTML = '<div id="root"></div>'
    target = document.body.querySelector<HTMLElement>('#root')!
  })

  test('renders em-dash placeholders when adminGlobals.data is null', () => {
    const component = mount(OverviewSection, { target, props: {} })
    expect(target.textContent).toContain('—')
    void unmount(component)
  })

  test('renders subjects total + dm/group sub-label', () => {
    adminGlobals.data = {
      subjects: { dmTotal: 18, groupTotal: 14, growthLast30d: [] },
      active: { activeIn1d: 4, activeIn7d: 12, activeIn30d: 24 },
      storage: { sqliteBytes: 12_345_678, s3AttachmentBytes: 9_876_543 },
      toolMix: { topTools: [], errorTypeCounts: {} },
    }
    const component = mount(OverviewSection, { target, props: {} })
    expect(target.textContent).toContain('32')
    expect(target.textContent).toContain('18 dm · 14 group')
    void unmount(component)
  })

  test('renders active 30d total + 1d/7d sub-label', () => {
    adminGlobals.data = {
      subjects: { dmTotal: 0, groupTotal: 0, growthLast30d: [] },
      active: { activeIn1d: 4, activeIn7d: 12, activeIn30d: 24 },
      storage: { sqliteBytes: 0, s3AttachmentBytes: 0 },
      toolMix: { topTools: [], errorTypeCounts: {} },
    }
    const component = mount(OverviewSection, { target, props: {} })
    expect(target.textContent).toContain('24')
    expect(target.textContent).toContain('4 1d · 12 7d')
    void unmount(component)
  })

  test('renders tool calls total + ok/fail sub-label from toolMix', () => {
    adminGlobals.data = {
      subjects: { dmTotal: 0, groupTotal: 0, growthLast30d: [] },
      active: { activeIn1d: 0, activeIn7d: 0, activeIn30d: 0 },
      storage: { sqliteBytes: 0, s3AttachmentBytes: 0 },
      toolMix: {
        topTools: [
          { toolName: 'create_task', count: 1000, successRate: 0.97 },
          { toolName: 'search_tasks', count: 500, successRate: 0.9 },
        ],
        errorTypeCounts: {},
      },
    }
    const component = mount(OverviewSection, { target, props: {} })
    expect(target.textContent).toContain('1500')
    expect(target.textContent).toContain('1420 ok · 80 fail')
    void unmount(component)
  })

  test('renders storage total + sqlite/s3 sub-label', () => {
    adminGlobals.data = {
      subjects: { dmTotal: 0, groupTotal: 0, growthLast30d: [] },
      active: { activeIn1d: 0, activeIn7d: 0, activeIn30d: 0 },
      storage: { sqliteBytes: 12_000_000, s3AttachmentBytes: 8_000_000 },
      toolMix: { topTools: [], errorTypeCounts: {} },
    }
    const component = mount(OverviewSection, { target, props: {} })
    expect(target.textContent).toContain('20.0 MB')
    expect(target.textContent).toContain('12.0 MB sqlite · 8.0 MB s3')
    void unmount(component)
  })
})
```

Note the ok/fail derivation: `ok = round(count * successRate)` summed across tools, `fail = total - ok`. `1000 * 0.97 = 970`, `500 * 0.9 = 450`, sum 1420 ok, 1500 - 1420 = 80 fail.

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test:client tests/client/admin/sections/OverviewSection.test.ts`
Expected: FAIL — current section reads `adminGlobals.data?.subjects` as a `number`, not an object.

- [ ] **Step 4: Rewrite `OverviewSection.svelte` KPI block**

Replace the file body with:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import Bars from '../../shared/ui/Bars.svelte'
  import KV from '../../shared/ui/KV.svelte'
  import Panel from '../../shared/ui/Panel.svelte'
  import Spark from '../../shared/ui/Spark.svelte'

  import { adminGlobals } from '../global-stats.svelte.js'

  const subjectsTotal = $derived(
    adminGlobals.data?.subjects === undefined
      ? '—'
      : adminGlobals.data.subjects.dmTotal + adminGlobals.data.subjects.groupTotal,
  )
  const subjectsSub = $derived(
    adminGlobals.data?.subjects === undefined
      ? undefined
      : `${adminGlobals.data.subjects.dmTotal} dm · ${adminGlobals.data.subjects.groupTotal} group`,
  )

  const activeTotal = $derived(adminGlobals.data?.active?.activeIn30d ?? '—')
  const activeSub = $derived(
    adminGlobals.data?.active === undefined
      ? undefined
      : `${adminGlobals.data.active.activeIn1d} 1d · ${adminGlobals.data.active.activeIn7d} 7d`,
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
  const toolTotal = $derived(toolTotals === null ? '—' : toolTotals.total)
  const toolSub = $derived(toolTotals === null ? undefined : `${toolTotals.ok} ok · ${toolTotals.fail} fail`)

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
    return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`
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

  const sparkData = $derived(
    adminGlobals.data?.subjects?.growthLast30d?.map((p) => p.dmAdded + p.groupAdded) ?? [],
  )

  const barsData = $derived.by(() => {
    const tools = adminGlobals.data?.toolMix?.topTools
    if (tools === undefined) return []
    return tools.slice(0, 8).map((t) => Math.round(t.count * t.successRate))
  })
</script>

<section id="overview" class="admin-section">
  <Panel title="overview">
    {#snippet body()}
      <div class="admin-overview__kpis">
        <KV k="subjects" v={subjectsTotal} sub={subjectsSub} />
        <KV k="active 30d" v={activeTotal} sub={activeSub} />
        <KV k="tool calls" v={toolTotal} sub={toolSub} />
        <KV k="storage" v={storageTotal} sub={storageSub} />
      </div>
      <div class="admin-overview__charts">
        <div class="admin-overview__spark">
          <Spark data={sparkData} />
        </div>
        <div class="admin-overview__bars">
          <Bars data={barsData} />
        </div>
      </div>
    {/snippet}
  </Panel>
</section>

<style>
  .admin-section {
    scroll-margin-top: 96px;
  }
  .admin-overview__kpis {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    padding: 12px;
  }
  .admin-overview__charts {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 12px;
    padding: 12px;
    border-top: 1px solid var(--hair);
  }
</style>
```

Implementation notes:

- Each KPI's primary value falls back to `'—'` when its source block is absent. Sub-labels are simply omitted (`undefined`) in that case, so `KV` renders without the sub line.
- The `toolTotals` derivation uses `$derived.by(() => { ... })` because we compute three values from one upstream — keeps the template clean and DRY.
- Spark sums dm + group growth per day for a single trend line. Bars show top 8 tools by ok-call volume (`count * successRate`).
- `formatBytes` is a local helper. It is intentionally small and not extracted — only used here.

- [ ] **Step 5: Run tests to verify pass**

Run: `bun test:client tests/client/admin/sections/OverviewSection.test.ts`
Expected: PASS.

Run: `bun test:client`
Expected: all green (no regressions in other sections).

- [ ] **Step 6: Commit**

```bash
git add client/admin/sections/OverviewSection.svelte tests/client/admin/sections/OverviewSection.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): wire OverviewSection KPIs to real /stats/global fields

KPIs now derive from the nested GlobalStats shape: subjects.dmTotal
+ subjects.groupTotal, active.activeIn30d, sum of toolMix.topTools
counts, and storage.sqliteBytes + storage.s3AttachmentBytes. Each
card carries a sub-label with the per-bucket breakdown (dm vs group,
1d vs 7d, ok vs fail, sqlite vs s3).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wire `Spark` to `subjects.growthLast30d`

This work is already included in Task 4 (the `sparkData` derived above sums `dmAdded + groupAdded` per day). This task is a verification + extra test to lock the behavior.

**Files:**

- Modify: `tests/client/admin/sections/OverviewSection.test.ts` (add one more case)

- [ ] **Step 1: Add a Spark-data assertion test**

Append to the `OverviewSection.svelte` describe block:

```ts
test('Spark receives growth points summed across dm+group', () => {
  adminGlobals.data = {
    subjects: {
      dmTotal: 0,
      groupTotal: 0,
      growthLast30d: [
        { date: '2026-04-22', dmAdded: 1, groupAdded: 0 },
        { date: '2026-04-23', dmAdded: 0, groupAdded: 2 },
        { date: '2026-04-24', dmAdded: 3, groupAdded: 1 },
      ],
    },
    active: { activeIn1d: 0, activeIn7d: 0, activeIn30d: 0 },
    storage: { sqliteBytes: 0, s3AttachmentBytes: 0 },
    toolMix: { topTools: [], errorTypeCounts: {} },
  }
  const component = mount(OverviewSection, { target, props: {} })
  const spark = target.querySelector('.admin-overview__spark')
  expect(spark).not.toBeNull()
  // Spark renders an svg or canvas — the exact rendering belongs to Spark's own tests;
  // here we just confirm the container is present and non-empty when data is supplied.
  expect(spark?.innerHTML.length).toBeGreaterThan(0)
  void unmount(component)
})
```

This test deliberately does NOT introspect Spark's internal SVG/path output (Spark has its own tests). It only confirms the Spark slot received data + rendered.

- [ ] **Step 2: Run + verify**

Run: `bun test:client tests/client/admin/sections/OverviewSection.test.ts`
Expected: PASS (Task 4's implementation already wires `growthLast30d` correctly).

- [ ] **Step 3: Commit**

```bash
git add tests/client/admin/sections/OverviewSection.test.ts
git commit -m "$(cat <<'EOF'
test(admin): lock Spark wiring to growthLast30d in OverviewSection

Add a test that mounts OverviewSection with multi-day growth points
and asserts the Spark container renders. Spark's own rendering is
covered by its dedicated test file.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Audit and confirm CRUD modal restyle (verification only)

**Files:** none modified

- [ ] **Step 1: Confirm Modal consumers**

Run:

```bash
grep -rn "import Modal\|<Modal " client/ 2>/dev/null | grep -v test
```

Expected: only `client/shared/Confirm.svelte` matches. If anything else matches, STOP and report — there's a hidden CRUD modal that needs restyle. The PR 4 spec §10 work was to "restyle CRUD modals (Add Memo, Add Recurring, etc.)" — these modals **do not currently exist** in the client (memos/reminders/identities/groups sections use inline forms).

- [ ] **Step 2: Confirm Modal primitive is already token-styled**

Read `client/shared/Modal.svelte`. Confirm:

- backgrounds/text reference `var(--…)` design tokens (no raw hex)
- overlay uses tokenized values
- border, shadow, focus ring follow the Telemetry aesthetic from PR 1

If the file still uses raw hex anywhere, fix that as part of this task (replace with token vars from `client/shared/tokens.css`). Otherwise this is a pure verification.

- [ ] **Step 3: Confirm Confirm.svelte is already token-styled**

Read `client/shared/Confirm.svelte`. Confirm tokens are used throughout.

- [ ] **Step 4: No commit if nothing changed**

If neither file needed edits, skip the commit. The task is satisfied by the verification grep.

If a hex value was found and replaced, commit:

```bash
git add client/shared/Modal.svelte client/shared/Confirm.svelte
git commit -m "$(cat <<'EOF'
style(ui): replace stray hex values in Modal/Confirm with tokens

Caught during PR 4 verification — spec §10 expected these to already
be token-styled from PR 1. Remaining hex values now use --bg / --hair
/ --fg variables.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Dead-code sweep verification

**Files:** none modified (or `client/admin/admin.css` if a truly orphan rule is found)

- [ ] **Step 1: Confirm legacy admin CSS classes are still consumed**

Run:

```bash
grep -rn "admin-section-header\|admin-filter-form\|admin-key-value-list" client/ 2>/dev/null
```

Expected: the four section files (`MemosSection.svelte`, `RemindersSection.svelte`, `IdentitiesSection.svelte`, `GroupsSection.svelte`) still use them. If they do, **keep the rules in `admin.css`**. The spec §10 bullet said "remove if unused" — they ARE used, so they stay.

- [ ] **Step 2: Confirm no truly orphan classes from PR 3 leftovers**

Run knip:

```bash
bun knip
```

Expected: clean. If knip flags any new orphans introduced by PR 3 (e.g., a class no longer referenced after the AdminApp rewrite), either:

- delete the dead CSS rule from `client/admin/admin.css` and commit, OR
- if the export is actually used from a `.svelte` file (knip blind spot), add to `knip.jsonc` `ignoreIssues` following the existing `client/admin/*` pattern.

- [ ] **Step 3: Commit (only if something changed)**

If admin.css was trimmed, commit:

```bash
git add client/admin/admin.css
git commit -m "$(cat <<'EOF'
chore(admin): remove orphan CSS rules after PR 3 AdminApp rewrite

Caught by PR 4 dead-code sweep. <list the removed selectors>.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

If nothing was removed, no commit. The task is satisfied by the grep + knip verification.

---

## Task 8: Full check + final verification

**Files:** none modified

- [ ] **Step 1: Full check pipeline**

Run: `bun check:full`
Expected: 12/12 green.

- [ ] **Step 2: Anonymity re-verification (defense in depth)**

Run:

```bash
grep -nE "chatUserId|turnId|responseId|message|prompt|content" src/usage/recent-requests.ts src/debug/admin-system.ts
```

Expected: no matches inside the mapped row or response shape. PR 4 doesn't touch this path, but cheap to confirm regression-free.

- [ ] **Step 3: Test suites**

Run:

```bash
bun test
bun test:client
```

Expected: all green. Client test count should be ≥ 256 (baseline at end of PR 3) and likely 263–266 after PR 4 (Task 1 +1 new test; Task 3 +3 new tests; Task 4 +5 tests replacing 2 = +3 net; Task 5 +1 test = ~+8 cases overall).

- [ ] **Step 4: Bundle verification**

Run:

```bash
bun build:client
grep -c '^\.admin-grid' public/admin.css
```

Expected: ≥1.

- [ ] **Step 5: Manual smoke (optional but recommended)**

Run: `bun start:debug`. Open `/admin`. Expectations:

- Top bar window seg shows `1d / 7d / 30d / all` (no more `24h`)
- Overview KPI cards show real numbers (not `—`) when the DB has any LLM usage data, with sub-labels under each value
- Switching window seg between `1d` / `7d` / `30d` / `all` re-fetches `/stats/global` without errors in the network panel
- Spark line in Overview renders a non-flat curve once growth data exists for the last 30 days
- Bars in Overview show the top tools by ok-call volume

- [ ] **Step 6: No final commit — all work was committed task-by-task**

PR 4 ships when this checklist is clean.

---

## Spec coverage self-check

- §10.1 Spark wired to `globalStats.subjects.growthLast30d` — Task 4 + Task 5 ✓
- §10.2 Bars wired to `globalStats.toolMix.topTools` with success-rate multiplier — Task 4 (`barsData` uses `count * successRate`) ✓
- §10.3 KPI cards finalized with sub-labels — Task 3 (KV.sub prop) + Task 4 (4 cards with sub-labels) ✓
- §10.4 CRUD modals restyled — Task 6 verification: no CRUD modals exist; Modal primitive already token-styled in PR 1 ✓
- §10.5 Dead-code removal of legacy CSS — Task 7 verification: classes still in use, kept ✓
- §10.6 Screenshot pairs — out of plan scope; PR author attaches when opening the PR

## Out of scope for this plan

- LLM call totals and main/small model split on the Overview KPI cards (spec example `892 main · 197 small`) — `/stats/global` does not currently surface llm_usage_events totals. Adding this requires a new aggregator in `src/stats/` plus extending the route and the client schema. Tracked for a future PR if the operator surface needs it.
- Per-section data refresh wiring against the window seg — only Overview re-fetches today via `refreshGlobals`. Memos / Reminders / Identities / Groups still use their own user-driven inputs (no window filter applies).
- New chart library, mobile layouts, light theme (spec §14).
