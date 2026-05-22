<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Stats Global — LLM Totals + main/small Split Implementation Plan

**Goal:** Extend `/stats/global` with an `llmUsage` aggregate (totalCalls, mainCalls, smallCalls, embeddingCalls, inputTokensTotal, outputTokensTotal) and render an "llm calls" KPI on the admin Overview surface with a `N main · N small` sub-label.

**Architecture:** New sync Drizzle aggregator (`src/stats/global-llm.ts`) that GROUPs `llm_usage_events` by `model_role` for the active window. Wired into `getGlobalStats()` alongside existing aggregators. Client schema extended optionally; new KPI card swapped in OverviewSection.

**Tech Stack:** Drizzle + bun:sqlite, Zod v4, Svelte 5 runes, bun:test.

**Anonymity:** Response is counts and token sums only. The `model` text column is read internally for the GROUP BY but never returned (we group by `model_role` enum, not `model`). No `chatUserId`, `turnId`, `responseId`, `finishReason`, or `error` fields exit the boundary.

---

### Task 1: Add `LlmUsageGlobal` type

**Files:**

- Modify: `src/stats/types.ts` (add interface, add to `GlobalStats`)

- [ ] **Step 1: Add the interface and reference it from `GlobalStats`**

In `src/stats/types.ts`, after `ToolMixGlobal` (around line 184), insert:

```ts
export interface LlmUsageGlobal {
  totalCalls: number
  mainCalls: number
  smallCalls: number
  embeddingCalls: number
  inputTokensTotal: number
  outputTokensTotal: number
}
```

Then add the field to `GlobalStats`:

```ts
export interface GlobalStats {
  generatedAt: number
  window: StatsWindow
  subjects: GlobalSubjects
  active: ActiveSubjectCounts
  distributions: GlobalDistributions
  storage: StorageFootprint
  identityMix: IdentityMixStats
  surfaceMix: SurfaceMixStats
  webFetches: WebFetchHostsGlobal
  toolMix: ToolMixGlobal
  llmUsage: LlmUsageGlobal
}
```

- [ ] **Step 2: Run typecheck — expect failures in `src/stats/index.ts`**

Run: `bun typecheck`
Expected: error in `src/stats/index.ts` — `llmUsage` missing from returned object in `computeGlobalStats`.

---

### Task 2: Write the aggregator with TDD

**Files:**

- Create: `src/stats/global-llm.ts`
- Test: `tests/stats/global-llm.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/stats/global-llm.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { llmUsageEvents } from '../../src/db/schema.js'
import { llmUsageGlobal } from '../../src/stats/global-llm.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const ONE_DAY = 24 * 60 * 60 * 1000

describe('llmUsageGlobal', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns zeroes when llm_usage_events is empty', () => {
    const result = llmUsageGlobal('all')
    expect(result).toEqual({
      totalCalls: 0,
      mainCalls: 0,
      smallCalls: 0,
      embeddingCalls: 0,
      inputTokensTotal: 0,
      outputTokensTotal: 0,
    })
  })

  test('aggregates counts and tokens grouped by model role for window=all', () => {
    const now = Date.now()
    getDrizzleDb()
      .insert(llmUsageEvents)
      .values([
        rowAt(now, 'main', 100, 50),
        rowAt(now, 'main', 200, 80),
        rowAt(now, 'small', 30, 10),
        rowAt(now, 'embedding', 0, 0),
      ])
      .run()

    const result = llmUsageGlobal('all')
    expect(result.totalCalls).toBe(4)
    expect(result.mainCalls).toBe(2)
    expect(result.smallCalls).toBe(1)
    expect(result.embeddingCalls).toBe(1)
    expect(result.inputTokensTotal).toBe(330)
    expect(result.outputTokensTotal).toBe(140)
  })

  test('applies window cutoff for 1d/7d/30d', () => {
    const now = Date.now()
    getDrizzleDb()
      .insert(llmUsageEvents)
      .values([
        rowAt(now - 2 * 60 * 60 * 1000, 'main', 10, 5),
        rowAt(now - 3 * ONE_DAY, 'main', 20, 10),
        rowAt(now - 20 * ONE_DAY, 'main', 40, 20),
        rowAt(now - 60 * ONE_DAY, 'main', 80, 40),
      ])
      .run()

    expect(llmUsageGlobal('1d', now).totalCalls).toBe(1)
    expect(llmUsageGlobal('7d', now).totalCalls).toBe(2)
    expect(llmUsageGlobal('30d', now).totalCalls).toBe(3)
    expect(llmUsageGlobal('all', now).totalCalls).toBe(4)
  })

  test('treats null input/output token columns as zero contributions', () => {
    const now = Date.now()
    getDrizzleDb()
      .insert(llmUsageEvents)
      .values([
        {
          eventId: 'n1',
          occurredAt: now,
          storageContextId: 'u1',
          contextType: 'dm',
          chatUserId: 'u1',
          model: 'm',
          modelRole: 'main',
          inputTokens: null,
          outputTokens: null,
          durationMs: 1,
        },
      ])
      .run()

    const r = llmUsageGlobal('all')
    expect(r.totalCalls).toBe(1)
    expect(r.inputTokensTotal).toBe(0)
    expect(r.outputTokensTotal).toBe(0)
  })
})

function rowAt(
  occurredAt: number,
  modelRole: 'main' | 'small' | 'embedding',
  inputTokens: number,
  outputTokens: number,
): typeof llmUsageEvents.$inferInsert {
  return {
    eventId: `e-${occurredAt}-${modelRole}-${Math.random()}`,
    occurredAt,
    storageContextId: 'u1',
    contextType: 'dm',
    chatUserId: 'u1',
    model: modelRole === 'embedding' ? 'embed-1' : modelRole === 'small' ? 'small-1' : 'main-1',
    modelRole,
    inputTokens,
    outputTokens,
    durationMs: 1,
  }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/stats/global-llm.test.ts`
Expected: FAIL — module `src/stats/global-llm.js` not found.

- [ ] **Step 3: Implement the aggregator**

Create `src/stats/global-llm.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { sql } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { llmUsageEvents } from '../db/schema.js'
import type { LlmUsageGlobal, StatsWindow } from './types.js'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

function cutoffFor(window: StatsWindow, now: number): number | null {
  switch (window) {
    case '1d':
      return now - ONE_DAY_MS
    case '7d':
      return now - 7 * ONE_DAY_MS
    case '30d':
      return now - 30 * ONE_DAY_MS
    case 'all':
      return null
  }
}

export function llmUsageGlobal(window: StatsWindow, now: number = Date.now()): LlmUsageGlobal {
  const cutoff = cutoffFor(window, now)
  const baseQuery = getDrizzleDb()
    .select({
      role: llmUsageEvents.modelRole,
      calls: sql<number>`count(*)`.as('calls'),
      inputTokens: sql<number>`coalesce(sum(${llmUsageEvents.inputTokens}), 0)`.as('input_tokens'),
      outputTokens: sql<number>`coalesce(sum(${llmUsageEvents.outputTokens}), 0)`.as('output_tokens'),
    })
    .from(llmUsageEvents)

  const rows =
    cutoff === null
      ? baseQuery.groupBy(llmUsageEvents.modelRole).all()
      : baseQuery
          .where(sql`${llmUsageEvents.occurredAt} >= ${cutoff}`)
          .groupBy(llmUsageEvents.modelRole)
          .all()

  let mainCalls = 0
  let smallCalls = 0
  let embeddingCalls = 0
  let inputTokensTotal = 0
  let outputTokensTotal = 0
  for (const r of rows) {
    if (r.role === 'main') mainCalls = Number(r.calls)
    else if (r.role === 'small') smallCalls = Number(r.calls)
    else if (r.role === 'embedding') embeddingCalls = Number(r.calls)
    inputTokensTotal += Number(r.inputTokens)
    outputTokensTotal += Number(r.outputTokens)
  }

  return {
    totalCalls: mainCalls + smallCalls + embeddingCalls,
    mainCalls,
    smallCalls,
    embeddingCalls,
    inputTokensTotal,
    outputTokensTotal,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/stats/global-llm.test.ts`
Expected: PASS — all 4 tests green.

---

### Task 3: Wire aggregator into orchestrator

**Files:**

- Modify: `src/stats/index.ts`

- [ ] **Step 1: Import and wire**

In `src/stats/index.ts`, add to the import group:

```ts
import { llmUsageGlobal } from './global-llm.js'
```

In `computeGlobalStats`, add `llmUsage` to the returned object:

```ts
function computeGlobalStats(window: StatsWindow): GlobalStats {
  return {
    generatedAt: Date.now(),
    window,
    subjects: subjectsGlobal(),
    active: activeSubjectCounts(),
    distributions: distributionsGlobal(),
    storage: storageGlobal(),
    identityMix: identityMixGlobal(),
    surfaceMix: surfaceMixGlobal(),
    webFetches: webFetchesGlobal(),
    toolMix: toolMixGlobal(),
    llmUsage: llmUsageGlobal(window),
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `bun typecheck`
Expected: PASS.

- [ ] **Step 3: Run stats test suite**

Run: `bun test tests/stats/`
Expected: PASS for new test + no regressions.

---

### Task 4: Extend the client Zod schema

**Files:**

- Modify: `client/admin/global-stats.svelte.ts`

- [ ] **Step 1: Add the optional `llmUsage` block**

In `client/admin/global-stats.svelte.ts`, append to the `GlobalStatsSchema` object (alongside the other `.optional()` blocks):

```ts
  llmUsage: z
    .object({
      totalCalls: z.number(),
      mainCalls: z.number(),
      smallCalls: z.number(),
      embeddingCalls: z.number(),
      inputTokensTotal: z.number(),
      outputTokensTotal: z.number(),
    })
    .optional(),
```

- [ ] **Step 2: Run typecheck**

Run: `bun typecheck`
Expected: PASS.

---

### Task 5: Render the "llm calls" KPI card (TDD)

**Files:**

- Modify: `client/admin/sections/OverviewSection.svelte`
- Test: `tests/client/admin/sections/OverviewSection.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `tests/client/admin/sections/OverviewSection.test.ts`:

```ts
test('renders llm calls total + main/small sub-label', () => {
  adminGlobals.data = {
    subjects: { dmTotal: 0, groupTotal: 0, growthLast30d: [] },
    active: { activeIn1d: 0, activeIn7d: 0, activeIn30d: 0 },
    storage: { sqliteBytes: 0, s3AttachmentBytes: 0 },
    toolMix: { topTools: [], errorTypeCounts: {} },
    llmUsage: {
      totalCalls: 1089,
      mainCalls: 892,
      smallCalls: 197,
      embeddingCalls: 0,
      inputTokensTotal: 100,
      outputTokensTotal: 200,
    },
  }
  const component = mount(OverviewSection, { target, props: {} })
  expect(target.textContent).toContain('1089')
  expect(target.textContent).toContain('892 main · 197 small')
  void unmount(component)
})

test('llm calls KPI degrades to em-dash when llmUsage absent', () => {
  adminGlobals.data = {
    subjects: { dmTotal: 1, groupTotal: 0, growthLast30d: [] },
    active: { activeIn1d: 0, activeIn7d: 0, activeIn30d: 0 },
    storage: { sqliteBytes: 0, s3AttachmentBytes: 0 },
    toolMix: { topTools: [], errorTypeCounts: {} },
  }
  const component = mount(OverviewSection, { target, props: {} })
  const llmKpi = target.querySelector('.admin-overview__kpis')!
  expect(llmKpi.textContent).toContain('llm calls')
  expect(llmKpi.textContent).toContain('—')
  void unmount(component)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test:client tests/client/admin/sections/OverviewSection.test.ts`
Expected: FAIL — "llm calls" not present in rendered output.

- [ ] **Step 3: Add the KPI card**

In `client/admin/sections/OverviewSection.svelte`, in the `<script>` block add:

```ts
const llmTotal = $derived(adminGlobals.data?.llmUsage?.totalCalls ?? '—')
const llmSub = $derived(
  adminGlobals.data?.llmUsage === undefined
    ? undefined
    : `${adminGlobals.data.llmUsage.mainCalls} main · ${adminGlobals.data.llmUsage.smallCalls} small`,
)
```

Change the `.admin-overview__kpis` block grid to 5 columns and add the KV:

```svelte
      <div class="admin-overview__kpis">
        <KV k="subjects" v={subjectsTotal} sub={subjectsSub} />
        <KV k="active 30d" v={activeTotal} sub={activeSub} />
        <KV k="llm calls" v={llmTotal} sub={llmSub} />
        <KV k="tool calls" v={toolTotal} sub={toolSub} />
        <KV k="storage" v={storageTotal} sub={storageSub} />
      </div>
```

And update the CSS:

```css
.admin-overview__kpis {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
  padding: 12px;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test:client tests/client/admin/sections/OverviewSection.test.ts`
Expected: PASS — all (existing + 2 new) tests green.

---

### Task 6: Full verification + commit

- [ ] **Step 1: Run full check suite**

Run: `bun check:full`
Expected: PASS across lint, typecheck, format, knip, tests.

- [ ] **Step 2: Commit**

```bash
git add src/stats/types.ts src/stats/global-llm.ts src/stats/index.ts \
        client/admin/global-stats.svelte.ts client/admin/sections/OverviewSection.svelte \
        tests/stats/global-llm.test.ts tests/client/admin/sections/OverviewSection.test.ts \
        docs/superpowers/plans/2026-05-23-stats-global-llm-totals.md
git commit -m "$(cat <<'EOF'
feat(stats): add llmUsage to /stats/global and Overview KPI

Group llm_usage_events by model_role for windowed call/token totals;
surface as a fifth Overview KPI with "N main · N small" sub-label.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

## Out of scope

- Per-subject LLM-role split (already covered by billing aggregator).
- Charts/sparklines for LLM-call trend over time.
- Provider/cost dimensions.
