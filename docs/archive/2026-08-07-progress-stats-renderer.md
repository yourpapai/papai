<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Progress & Stats Renderer Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add run-level aggregate stats (tokens, est. cost, tool calls, lines added/removed, elapsed) to the live footer and end-of-run summaries of the `review-loop` and `mutation-improve` CLIs, persisted to `metrics.json` / `state.json`.

**Architecture:** A pure, dependency-free `RunStats` aggregate (`review-loop/src/run-stats.ts`) accumulates per-label and total stats; the existing hand-rolled `LiveRenderer` holds an instance and renders aggregate segments in its persistent status line. Cost is estimated from a `pricing` table in each workspace's `config.json` (opencode events always report `cost: 0`). Diff stats are measured with `git diff --numstat` at each merge point. Spec: `docs/superpowers/specs/2026-08-07-progress-stats-renderer-design.md`.

**Tech Stack:** Bun, TypeScript (`.js` import extensions), Zod v4, bun:test. No new runtime dependencies.

## Global Constraints

- No new runtime dependencies in either workspace's `package.json`.
- Every new source file starts with the BUSL-1.1 header (hook-enforced):
  ```ts
  // SPDX-License-Identifier: BUSL-1.1
  // Copyright (c) 2026 Dmitriy Lazarev
  // Use of this software is governed by the Business Source License 1.1.
  // See LICENSE in the project root for details.
  ```
- New `ProgressReporter` members MUST be optional — test fakes across both suites construct minimal reporters.
- Error extraction idiom: `error instanceof Error ? error.message : String(error)`.
- Tests: `bun:test`, DI-first, no wall-clock timing assertions. Run focused tests from the repo root: `bun test tests/review-loop/<file>.test.ts`.
- Workspace checks: `bun run review-loop:typecheck && bun run review-loop:lint` (and `mutation-improve:` equivalents) from the repo root.
- TDD is hook-enforced for `review-loop/src/**` and `mutation-improve/src/**` — write the failing test first in every task.

## Spec refinements locked in this plan

1. **Model resolution is per-usage-delta, not once at CLI start.** `line-handler` knows `RunAgentOptions.model` per agent call and forwards it in the usage delta; review-loop's four agent configs may use different models, so a single CLI-start model would misprice.
2. **mutation-improve summary table columns:** file, before→after, outcome, `+a/-r` (per-iteration diff IS available, labeled `iter-N`). Per-file token columns from the spec mockup are NOT available — agent labels are role-based (`select`/`improve`), so tokens aggregate by role; the totals row carries overall tokens/cost/tools.

---

### Task 1: `cost.ts` — pricing table + estimation

**Files:**
- Create: `review-loop/src/cost.ts`
- Test: `tests/review-loop/cost.test.ts`

**Interfaces:**
- Produces: `PriceEntrySchema`, `PricingTableSchema`, `PriceEntry`, `PricingTable`, `matchPrice(pricing, model): PriceEntry | undefined`, `estimateCostUsd(price, input, output): number`. Consumed by Tasks 3, 6.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { estimateCostUsd, matchPrice, PricingTableSchema } from '../../review-loop/src/cost.js'

describe('matchPrice', () => {
  const pricing = { 'claude-sonnet-*': { input: 3, output: 15 }, 'gpt-4o': { input: 2.5, output: 10 } }

  test('exact match wins over glob', () => {
    const table = { ...pricing, 'claude-sonnet-4': { input: 1, output: 1 } }
    expect(matchPrice(table, 'claude-sonnet-4')).toEqual({ input: 1, output: 1 })
  })

  test('glob match', () => {
    expect(matchPrice(pricing, 'claude-sonnet-4-20250514')).toEqual({ input: 3, output: 15 })
  })

  test('provider-prefixed model still globs when pattern covers it', () => {
    expect(matchPrice({ 'anthropic/claude-*': { input: 3, output: 15 } }, 'anthropic/claude-sonnet-4')).toEqual({
      input: 3,
      output: 15,
    })
  })

  test('no match returns undefined', () => {
    expect(matchPrice(pricing, 'llama-3')).toBeUndefined()
  })
})

describe('estimateCostUsd', () => {
  test('computes per-1M-token pricing', () => {
    expect(estimateCostUsd({ input: 3, output: 15 }, 100_000, 10_000)).toBeCloseTo(0.45, 10)
  })
})

describe('PricingTableSchema', () => {
  test('rejects negative prices', () => {
    expect(PricingTableSchema.safeParse({ m: { input: -1, output: 1 } }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/review-loop/cost.test.ts`
Expected: FAIL — module `../../review-loop/src/cost.js` not found.

- [ ] **Step 3: Implement `review-loop/src/cost.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const PriceEntrySchema = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
})
export const PricingTableSchema = z.record(z.string(), PriceEntrySchema)
export type PriceEntry = z.infer<typeof PriceEntrySchema>
export type PricingTable = z.infer<typeof PricingTableSchema>

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

export function matchPrice(pricing: PricingTable, model: string): PriceEntry | undefined {
  const exact = pricing[model]
  if (exact !== undefined) return exact
  for (const [pattern, entry] of Object.entries(pricing)) {
    if (pattern.includes('*') && globToRegExp(pattern).test(model)) return entry
  }
  return undefined
}

export function estimateCostUsd(price: PriceEntry, input: number, output: number): number {
  return (input / 1_000_000) * price.input + (output / 1_000_000) * price.output
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/review-loop/cost.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run review-loop:typecheck && bun run review-loop:lint
git add review-loop/src/cost.ts tests/review-loop/cost.test.ts
git commit -m "feat(review-loop): add pricing-table cost estimation module"
```

---

### Task 2: `diff-stats.ts` — numstat parsing + merge diff measurement

**Files:**
- Create: `review-loop/src/diff-stats.ts`
- Test: `tests/review-loop/diff-stats.test.ts`

**Interfaces:**
- Produces: `DiffStats { added: number; removed: number }`, `ExecGitFn`, `parseNumstat(output): DiffStats`, `headSha(execGit, cwd): Promise<string>`, `measureDiffSince(execGit, cwd, beforeSha): Promise<DiffStats>`. Consumed by Tasks 3 (type), 7, 9.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { headSha, measureDiffSince, parseNumstat, type ExecGitFn } from '../../review-loop/src/diff-stats.js'

describe('parseNumstat', () => {
  test('sums added/removed across files', () => {
    expect(parseNumstat('10\t2\tsrc/a.ts\n3\t0\tsrc/b.ts\n')).toEqual({ added: 13, removed: 2 })
  })

  test('binary lines (-) count as zero', () => {
    expect(parseNumstat('-\t-\timg.png\n5\t1\tsrc/a.ts\n')).toEqual({ added: 5, removed: 1 })
  })

  test('rename lines parse', () => {
    expect(parseNumstat('4\t2\tsrc/{old.ts => new.ts}\n')).toEqual({ added: 4, removed: 2 })
  })

  test('empty output is zero', () => {
    expect(parseNumstat('')).toEqual({ added: 0, removed: 0 })
  })
})

describe('headSha / measureDiffSince', () => {
  test('headSha trims rev-parse output', async () => {
    const execGit: ExecGitFn = (_cwd, args) => {
      expect(args).toEqual(['rev-parse', 'HEAD'])
      return Promise.resolve({ stdout: '  abc123\n', stderr: '' })
    }
    await expect(headSha(execGit, '/repo')).resolves.toBe('abc123')
  })

  test('measureDiffSince runs numstat against beforeSha..HEAD', async () => {
    const execGit: ExecGitFn = (_cwd, args) => {
      expect(args).toEqual(['diff', '--numstat', 'abc123..HEAD'])
      return Promise.resolve({ stdout: '7\t3\tsrc/a.ts\n', stderr: '' })
    }
    await expect(measureDiffSince(execGit, '/repo', 'abc123')).resolves.toEqual({ added: 7, removed: 3 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/review-loop/diff-stats.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `review-loop/src/diff-stats.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface DiffStats {
  added: number
  removed: number
}

export type ExecGitFn = (cwd: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>

export function parseNumstat(output: string): DiffStats {
  let added = 0
  let removed = 0
  for (const line of output.split('\n')) {
    if (line.trim() === '') continue
    const [a, r] = line.split('\t')
    const addN = Number(a)
    const remN = Number(r)
    if (Number.isFinite(addN)) added += addN
    if (Number.isFinite(remN)) removed += remN
  }
  return { added, removed }
}

export async function headSha(execGit: ExecGitFn, cwd: string): Promise<string> {
  const { stdout } = await execGit(cwd, ['rev-parse', 'HEAD'])
  return stdout.trim()
}

export async function measureDiffSince(execGit: ExecGitFn, cwd: string, beforeSha: string): Promise<DiffStats> {
  const { stdout } = await execGit(cwd, ['diff', '--numstat', `${beforeSha}..HEAD`])
  return parseNumstat(stdout)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/review-loop/diff-stats.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run review-loop:typecheck && bun run review-loop:lint
git add review-loop/src/diff-stats.ts tests/review-loop/diff-stats.test.ts
git commit -m "feat(review-loop): add git numstat diff-stats module"
```

---

### Task 3: `run-stats.ts` — the pure aggregate

**Files:**
- Create: `review-loop/src/run-stats.ts`
- Test: `tests/review-loop/run-stats.test.ts`

**Interfaces:**
- Consumes: `matchPrice`, `estimateCostUsd`, `PricingTable` (Task 1); `DiffStats` (Task 2).
- Produces: `LabelStats`, `StatsTotals`, `StatsSnapshot`, `PersistedStats`, `PersistedStatsSchema`, `RunStatsOptions`, `class RunStats { addUsage(label, delta: UsageInput); addToolCalls(label, n); addDiff(label, diff); snapshot(): StatsSnapshot; persist(): PersistedStats; static rehydrate(persisted, options): RunStats }`. Consumed by Tasks 4, 5, 8, 9, 10.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { RunStats } from '../../review-loop/src/run-stats.js'

describe('RunStats', () => {
  test('accumulates usage per label and in totals', () => {
    const stats = new RunStats({ startedAt: 0, now: () => 0 })
    stats.addUsage('select', { input: 100, output: 10, reasoning: 5 })
    stats.addUsage('improve', { input: 200, output: 20, reasoning: 0 })
    stats.addUsage('improve', { input: 50, output: 5, reasoning: 1 })
    const snap = stats.snapshot()
    expect(snap.totals.input).toBe(350)
    expect(snap.totals.output).toBe(35)
    expect(snap.totals.reasoning).toBe(6)
    expect(snap.perLabel['improve']).toMatchObject({ input: 250, output: 25 })
  })

  test('clamps NaN and negative values to zero', () => {
    const stats = new RunStats({ startedAt: 0, now: () => 0 })
    stats.addUsage('a', { input: Number.NaN, output: -5, reasoning: 3 })
    stats.addToolCalls('a', -2)
    stats.addDiff('a', { added: Number.NaN, removed: -1 })
    const snap = stats.snapshot()
    expect(snap.totals).toMatchObject({ input: 0, output: 0, reasoning: 3, toolCalls: 0, added: 0, removed: 0 })
  })

  test('accumulates tool calls and diff per label', () => {
    const stats = new RunStats({ startedAt: 0, now: () => 0 })
    stats.addToolCalls('fixer-w1', 3)
    stats.addToolCalls('fixer-w1', 2)
    stats.addDiff('worker-1', { added: 10, removed: 4 })
    const snap = stats.snapshot()
    expect(snap.totals.toolCalls).toBe(5)
    expect(snap.totals.added).toBe(10)
    expect(snap.perLabel['fixer-w1']?.toolCalls).toBe(5)
    expect(snap.perLabel['worker-1']).toMatchObject({ added: 10, removed: 4 })
  })

  test('estimates cost from pricing table and per-delta model', () => {
    const stats = new RunStats({ pricing: { 'm-*': { input: 3, output: 15 } }, startedAt: 0, now: () => 0 })
    stats.addUsage('a', { input: 100_000, output: 10_000, reasoning: 0, model: 'm-x' })
    expect(stats.snapshot().totals.estimatedCostUsd).toBeCloseTo(0.45, 10)
  })

  test('omits cost when no pricing entry matches', () => {
    const stats = new RunStats({ pricing: { 'm-*': { input: 3, output: 15 } }, startedAt: 0, now: () => 0 })
    stats.addUsage('a', { input: 100, output: 10, reasoning: 0, model: 'other' })
    expect(stats.snapshot().totals.estimatedCostUsd).toBeUndefined()
  })

  test('omits cost when no pricing configured', () => {
    const stats = new RunStats({ startedAt: 0, now: () => 0 })
    stats.addUsage('a', { input: 100, output: 10, reasoning: 0, model: 'm-x' })
    expect(stats.snapshot().totals.estimatedCostUsd).toBeUndefined()
  })

  test('constructor model is the fallback when delta has none', () => {
    const stats = new RunStats({ pricing: { 'm-*': { input: 3, output: 15 } }, model: 'm-x', startedAt: 0, now: () => 0 })
    stats.addUsage('a', { input: 1_000_000, output: 0, reasoning: 0 })
    expect(stats.snapshot().totals.estimatedCostUsd).toBeCloseTo(3, 10)
  })

  test('snapshot returns fresh objects each call', () => {
    const stats = new RunStats({ startedAt: 0, now: () => 0 })
    stats.addUsage('a', { input: 1, output: 1, reasoning: 0 })
    const first = stats.snapshot()
    first.totals.input = 999
    ;(first.perLabel['a'] as { input: number }).input = 999
    expect(stats.snapshot().totals.input).toBe(1)
    expect(stats.snapshot().perLabel['a']?.input).toBe(1)
  })

  test('elapsedMs comes from now - startedAt', () => {
    const stats = new RunStats({ startedAt: 1000, now: () => 61_000 })
    expect(stats.snapshot().totals.elapsedMs).toBe(60_000)
  })

  test('persist + rehydrate round-trips totals and perLabel', () => {
    const stats = new RunStats({ pricing: { 'm-*': { input: 3, output: 15 } }, startedAt: 0, now: () => 0 })
    stats.addUsage('a', { input: 100_000, output: 10_000, reasoning: 0, model: 'm-x' })
    stats.addToolCalls('a', 4)
    stats.addDiff('iter-1', { added: 7, removed: 2 })
    const restored = RunStats.rehydrate(stats.persist(), { pricing: { 'm-*': { input: 3, output: 15 } } })
    const snap = restored.snapshot()
    expect(snap.totals).toMatchObject({ input: 100_000, output: 10_000, toolCalls: 4, added: 7, removed: 2 })
    expect(snap.totals.estimatedCostUsd).toBeCloseTo(0.45, 10)
    expect(snap.perLabel['iter-1']).toMatchObject({ added: 7, removed: 2 })
  })

  test('rehydrate with undefined starts empty', () => {
    const stats = RunStats.rehydrate(undefined, {})
    expect(stats.snapshot().totals.input).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/review-loop/run-stats.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `review-loop/src/run-stats.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { estimateCostUsd, matchPrice, type PricingTable } from './cost.js'
import type { DiffStats } from './diff-stats.js'

export interface UsageInput {
  input: number
  output: number
  reasoning: number
  model?: string
}

export interface LabelStats {
  input: number
  output: number
  reasoning: number
  toolCalls: number
  added: number
  removed: number
}

export interface StatsTotals extends LabelStats {
  estimatedCostUsd?: number
}

export interface StatsSnapshot {
  totals: StatsTotals & { elapsedMs: number }
  perLabel: Record<string, LabelStats>
}

export const LabelStatsSchema = z.object({
  input: z.number(),
  output: z.number(),
  reasoning: z.number(),
  toolCalls: z.number(),
  added: z.number(),
  removed: z.number(),
})

export const PersistedStatsSchema = z.object({
  totals: LabelStatsSchema.extend({ estimatedCostUsd: z.number().optional() }),
  perLabel: z.record(z.string(), LabelStatsSchema),
})
export type PersistedStats = z.infer<typeof PersistedStatsSchema>

export interface RunStatsOptions {
  pricing?: PricingTable
  model?: string
  startedAt?: number
  now?: () => number
}

function clamp(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0
}

function emptyLabelStats(): LabelStats {
  return { input: 0, output: 0, reasoning: 0, toolCalls: 0, added: 0, removed: 0 }
}

export class RunStats {
  private readonly pricing: PricingTable | undefined
  private readonly model: string | undefined
  private readonly startedAt: number
  private readonly now: () => number
  private readonly totals: LabelStats = emptyLabelStats()
  private readonly perLabel = new Map<string, LabelStats>()
  private estimatedCost = 0
  private hasCost = false

  constructor(options: RunStatsOptions = {}) {
    this.pricing = options.pricing
    this.model = options.model
    this.now = options.now ?? Date.now
    this.startedAt = options.startedAt ?? this.now()
  }

  static rehydrate(persisted: PersistedStats | undefined, options: RunStatsOptions = {}): RunStats {
    const stats = new RunStats(options)
    if (persisted === undefined) return stats
    for (const [label, entry] of Object.entries(persisted.perLabel)) {
      stats.perLabel.set(label, { ...entry })
    }
    stats.totals.input = persisted.totals.input
    stats.totals.output = persisted.totals.output
    stats.totals.reasoning = persisted.totals.reasoning
    stats.totals.toolCalls = persisted.totals.toolCalls
    stats.totals.added = persisted.totals.added
    stats.totals.removed = persisted.totals.removed
    if (persisted.totals.estimatedCostUsd !== undefined) {
      stats.estimatedCost = persisted.totals.estimatedCostUsd
      stats.hasCost = true
    }
    return stats
  }

  addUsage(label: string, delta: UsageInput): void {
    const entry = this.labelEntry(label)
    entry.input += clamp(delta.input)
    entry.output += clamp(delta.output)
    entry.reasoning += clamp(delta.reasoning)
    this.totals.input += clamp(delta.input)
    this.totals.output += clamp(delta.output)
    this.totals.reasoning += clamp(delta.reasoning)
    const model = delta.model ?? this.model
    if (this.pricing !== undefined && model !== undefined) {
      const price = matchPrice(this.pricing, model)
      if (price !== undefined) {
        this.estimatedCost += estimateCostUsd(price, clamp(delta.input), clamp(delta.output))
        this.hasCost = true
      }
    }
  }

  addToolCalls(label: string, n: number): void {
    const delta = Math.floor(clamp(n))
    this.labelEntry(label).toolCalls += delta
    this.totals.toolCalls += delta
  }

  addDiff(label: string, diff: DiffStats): void {
    const entry = this.labelEntry(label)
    entry.added += clamp(diff.added)
    entry.removed += clamp(diff.removed)
    this.totals.added += clamp(diff.added)
    this.totals.removed += clamp(diff.removed)
  }

  snapshot(): StatsSnapshot {
    return {
      totals: { ...this.totals, ...this.costField(), elapsedMs: Math.max(0, this.now() - this.startedAt) },
      perLabel: Object.fromEntries([...this.perLabel].map(([label, entry]) => [label, { ...entry }])),
    }
  }

  persist(): PersistedStats {
    return {
      totals: { ...this.totals, ...this.costField() },
      perLabel: Object.fromEntries([...this.perLabel].map(([label, entry]) => [label, { ...entry }])),
    }
  }

  private costField(): { estimatedCostUsd?: number } {
    return this.hasCost ? { estimatedCostUsd: this.estimatedCost } : {}
  }

  private labelEntry(label: string): LabelStats {
    let entry = this.perLabel.get(label)
    if (entry === undefined) {
      entry = emptyLabelStats()
      this.perLabel.set(label, entry)
    }
    return entry
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/review-loop/run-stats.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run review-loop:typecheck && bun run review-loop:lint
git add review-loop/src/run-stats.ts tests/review-loop/run-stats.test.ts
git commit -m "feat(review-loop): add RunStats aggregate with cost estimation and rehydration"
```

---

### Task 4: Reporter seam + `LiveRenderer` stats wiring and footer segments

**Files:**
- Modify: `review-loop/src/progress-log.ts:13-30`
- Modify: `review-loop/src/live-renderer.ts` (constructor L68-71, `usage` L120-126, `statusLine` L161-179)
- Test: `tests/review-loop/live-renderer.test.ts` (extend), `tests/review-loop/progress-log.test.ts` (extend if it type-checks the interface; otherwise renderer test covers it)

**Interfaces:**
- Consumes: `RunStats` (Task 3), `DiffStats` (Task 2).
- Produces: `UsageDelta` gains optional `label?: string; model?: string`; `ProgressReporter` gains `readonly stats?: RunStats` and `diff?(label: string, diff: DiffStats): void`; `new LiveRenderer(stream, stats?)`. Consumed by Tasks 5, 7, 8, 9.

- [ ] **Step 1: Write the failing test** (append a new describe block to `tests/review-loop/live-renderer.test.ts`; `makeStream` helper already exists at the top of that file)

```ts
import { RunStats } from '../../review-loop/src/run-stats.js'

describe('LiveRenderer stats', () => {
  test('routes usage deltas into RunStats with label and model', () => {
    const { stream } = makeStream()
    const stats = new RunStats({ pricing: { 'm-*': { input: 3, output: 15 } } })
    const r = new LiveRenderer(stream, stats)
    r.usage({ input: 100_000, output: 10_000, reasoning: 0, cost: 0, label: 'improve', model: 'm-x' })
    expect(stats.snapshot().perLabel['improve']?.input).toBe(100_000)
    expect(stats.snapshot().totals.estimatedCostUsd).toBeCloseTo(0.45, 10)
  })

  test('diff() routes into RunStats', () => {
    const { stream } = makeStream()
    const stats = new RunStats()
    const r = new LiveRenderer(stream, stats)
    r.diff('iter-1', { added: 12, removed: 3 })
    expect(stats.snapshot().totals.added).toBe(12)
  })

  test('status line gains cost, tools and diff segments (TTY)', () => {
    const { output, stream } = makeStream({ isTTY: true, columns: 300 })
    const stats = new RunStats({ pricing: { 'm-*': { input: 3, output: 15 } } })
    const r = new LiveRenderer(stream, stats)
    r.usage({ input: 100_000, output: 10_000, reasoning: 0, cost: 0, label: 'improve', model: 'm-x' })
    stats.addToolCalls('improve', 7)
    r.diff('iter-1', { added: 12, removed: 3 })
    r.slot('improve', '  improve   ▶ read a.ts · 1s · 1 tool')
    const last = output.at(-1) ?? ''
    expect(last).toContain('in 100.0k / out 10.0k')
    expect(last).toContain('~$0.45 est')
    expect(last).toContain('tools 7')
    expect(last).toContain('+12/-3')
  })

  test('cost segment hidden when no pricing matches', () => {
    const { output, stream } = makeStream({ isTTY: true, columns: 300 })
    const stats = new RunStats()
    const r = new LiveRenderer(stream, stats)
    r.usage({ input: 100_000, output: 10_000, reasoning: 0, cost: 0, label: 'improve' })
    r.slot('improve', 'x')
    expect(output.at(-1) ?? '').not.toContain('est')
  })

  test('works without stats (legacy single-arg construction)', () => {
    const { output, stream } = makeStream({ isTTY: true, columns: 300 })
    const r = new LiveRenderer(stream)
    r.usage({ input: 5, output: 2, reasoning: 0, cost: 0 })
    r.slot('a', 'x')
    expect(output.at(-1) ?? '').toContain('in 5 / out 2')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/review-loop/live-renderer.test.ts`
Expected: FAIL — `new LiveRenderer(stream, stats)` extra arg type error / `r.diff is not a function`.

- [ ] **Step 3: Implement**

`review-loop/src/progress-log.ts` — extend `UsageDelta` and `ProgressReporter`:

```ts
import type { DiffStats } from './diff-stats.js'
import type { RunStats } from './run-stats.js'
import type { Severity } from './trace-log.js'

// ...IssueProgressEvent unchanged...

export interface UsageDelta {
  input: number
  output: number
  reasoning: number
  cost: number
  label?: string
  model?: string
}

export interface ProgressReporter {
  readonly dynamic: boolean
  readonly stats?: RunStats
  event(message: string): void
  live(lines: readonly string[]): void
  clearLive(): void
  log(message: string): void
  issue?(event: IssueProgressEvent): void
  statusSuffix?(): string
  slot?(key: string, line: string | null): void
  usage?(delta: UsageDelta): void
  diff?(label: string, diff: DiffStats): void
}
```

`review-loop/src/live-renderer.ts` — constructor, `stats` property, `usage`, new `diff`, statusLine segments:

```ts
import { formatDecidedLine, formatFoundLine } from './issue-format.js'
import { activitySummary, formatDuration, formatTokenCount, MIDDLE_DOT, truncate } from './live-format.js'
import type { DiffStats } from './diff-stats.js'
import type { IssueProgressEvent, ProgressReporter, UsageDelta } from './progress-log.js'
import type { RunStats } from './run-stats.js'

// in class LiveRenderer:
  readonly stats: RunStats | undefined

  constructor(stream: RendererStream, stats?: RunStats) {
    this.stream = stream
    this.tty = stream.isTTY === true
    this.stats = stats
  }

  usage(delta: UsageDelta): void {
    this.touch()
    this.usageTotals.input += delta.input
    this.usageTotals.output += delta.output
    this.usageTotals.reasoning += delta.reasoning
    this.usageTotals.cost += delta.cost
    this.stats?.addUsage(delta.label ?? 'agent', delta)
  }

  diff(label: string, diffStats: DiffStats): void {
    this.stats?.addDiff(label, diffStats)
  }
```

In `statusLine()`, after the existing `in … / out …` push (L174-176), append:

```ts
    const snap = this.stats?.snapshot()
    if (snap !== undefined) {
      if (snap.totals.estimatedCostUsd !== undefined) {
        parts.push(`~$${snap.totals.estimatedCostUsd.toFixed(2)} est`)
      }
      if (snap.totals.toolCalls > 0) parts.push(`tools ${snap.totals.toolCalls}`)
      if (snap.totals.added > 0 || snap.totals.removed > 0) {
        parts.push(`+${snap.totals.added}/-${snap.totals.removed}`)
      }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/review-loop/live-renderer.test.ts tests/review-loop/progress-log.test.ts`
Expected: PASS (old + new).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run review-loop:typecheck && bun run review-loop:lint && bun run mutation-improve:typecheck
git add review-loop/src/progress-log.ts review-loop/src/live-renderer.ts tests/review-loop/live-renderer.test.ts
git commit -m "feat(review-loop): wire RunStats into LiveRenderer footer segments"
```

---

### Task 5: `line-handler` forwards label/model and tool-call increments

**Files:**
- Modify: `review-loop/src/line-handler.ts` (`LiveCtx` L20-34, `applyEvent` step_finish L73-90, `createLineHandler` ctx init L96-110)
- Test: `tests/review-loop/line-handler.test.ts` (extend)

**Interfaces:**
- Consumes: `UsageDelta.label/model` + `ProgressReporter.stats` (Task 4).
- Produces: `LiveCtx` gains `readonly model: string` and `reportedToolCalls: number`. No external consumers beyond the handler.

- [ ] **Step 1: Write the failing test** (append to `tests/review-loop/line-handler.test.ts`, inside `describe('createLineHandler reporter wiring')` which already has `makeReporter`; event JSON shapes below match the existing fixtures in this file — `step_finish` requires `part.reason`, `tool_use` uses `part.callID` + `part.state`)

```ts
  test('step_finish delta carries label/model and tool calls accumulate per step', () => {
    const cwd = makeTempDir('line-handler-stats-')
    const stats = new RunStats()
    const deltas: UsageDelta[] = []
    const reporter = makeReporter({
      stats,
      usage: (d) => {
        deltas.push(d)
      },
    })
    const handler = createLineHandler({ ...makeOptions(cwd, path.join(cwd, 'agent.log')), reporter })
    const stepStart = JSON.stringify({ type: 'step_start', timestamp: 1, part: {} })
    const stepFinish = JSON.stringify({
      type: 'step_finish',
      part: { reason: 'stop', tokens: { input: 5, output: 2, reasoning: 1 }, cost: 0 },
    })
    const tool = (id: string) =>
      JSON.stringify({
        type: 'tool_use',
        part: { tool: 'read', callID: id, state: { status: 'running', input: { filePath: '/a/cli.ts' } } },
      })
    handler.onLine(stepStart)
    handler.onLine(tool('c1'))
    handler.onLine(stepFinish)
    handler.onLine(stepStart)
    handler.onLine(tool('c2'))
    handler.onLine(tool('c1')) // duplicate callID from a later step must not double-count
    handler.onLine(stepFinish)
    expect(deltas).toEqual([
      { input: 5, output: 2, reasoning: 1, cost: 0, label: 'drain', model: 'm' },
      { input: 5, output: 2, reasoning: 1, cost: 0, label: 'drain', model: 'm' },
    ])
    expect(stats.snapshot().totals.toolCalls).toBe(2)
    expect(stats.snapshot().perLabel['drain']?.input).toBe(10)
  })
```

Also update the EXISTING test `step_finish forwards usage to the reporter` (line-handler.test.ts:68-84): its `toEqual([{ input: 5, output: 2, reasoning: 1, cost: 0.5 }])` assertion breaks because the delta gains `label`/`model`. Change the expectation to:

```ts
    expect(deltas).toEqual([{ input: 5, output: 2, reasoning: 1, cost: 0.5, label: 'drain', model: 'm' }])
```

Add the import at the top of the test file:

```ts
import { RunStats } from '../../review-loop/src/run-stats.js'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/review-loop/line-handler.test.ts`
Expected: FAIL — toolCalls 0 / deltas lack label.

- [ ] **Step 3: Implement**

`review-loop/src/line-handler.ts`:

```ts
export interface LiveCtx {
  readonly label: string
  readonly model: string
  readonly logPath: string
  readonly reporter: ProgressReporter | undefined
  startedAt: number
  toolCount: number
  reportedToolCalls: number
  tool: string
  arg: string
  readonly seenCalls: Set<string>
  timer: ReturnType<typeof setInterval> | null
  usage: AgentUsage
  firstStepAt: number | null
  logChain: Promise<void>
}
```

In `applyEvent` `case 'step_finish':`, replace the `reporter.usage?.({...})` call with:

```ts
        reporter.usage?.({
          input: evt.tokens.input,
          output: evt.tokens.output,
          reasoning: evt.tokens.reasoning,
          cost: evt.cost,
          label: ctx.label,
          model: ctx.model,
        })
        const newToolCalls = ctx.toolCount - ctx.reportedToolCalls
        if (newToolCalls > 0) {
          ctx.reportedToolCalls = ctx.toolCount
          reporter.stats?.addToolCalls(ctx.label, newToolCalls)
        }
```

In `createLineHandler` ctx initializer add `model: options.model,` and `reportedToolCalls: 0,`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/review-loop/line-handler.test.ts tests/review-loop/agent-runner.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run review-loop:typecheck && bun run review-loop:lint
git add review-loop/src/line-handler.ts tests/review-loop/line-handler.test.ts
git commit -m "feat(review-loop): forward label/model and tool-call increments from line handler"
```

---

### Task 6: `pricing` config schema (both workspaces) + example configs

**Files:**
- Modify: `review-loop/src/config.ts:19-32`
- Modify: `mutation-improve/src/config.ts:19-40`
- Modify: `review-loop/config.example.json`
- Modify: `mutation-improve/config.example.json`
- Test: `tests/review-loop/config.test.ts` (extend), `tests/mutation-improve/config.test.ts` (extend)

**Interfaces:**
- Consumes: `PricingTableSchema` (Task 1).
- Produces: `ReviewLoopConfig.pricing?: PricingTable`, `MutationImproveConfig.pricing?: PricingTable`. Consumed by Tasks 8, 9.

- [ ] **Step 1: Write the failing tests**

`tests/review-loop/config.test.ts` (this suite tests the Zod schema directly — follow that pattern):

```ts
  test('accepts an optional pricing table', () => {
    const parsed = ReviewLoopConfigSchema.parse({
      workDir: '.review-loop',
      reviewer: { model: 'm1' },
      fixer: { model: 'm2' },
      matcher: { model: 'm3' },
      pricing: { 'm-*': { input: 3, output: 15 } },
    })
    expect(parsed.pricing).toEqual({ 'm-*': { input: 3, output: 15 } })
  })

  test('pricing is undefined when omitted', () => {
    const parsed = ReviewLoopConfigSchema.parse({
      workDir: '.review-loop',
      reviewer: { model: 'm1' },
      fixer: { model: 'm2' },
      matcher: { model: 'm3' },
    })
    expect(parsed.pricing).toBeUndefined()
  })

  test('rejects a malformed pricing entry', () => {
    expect(() =>
      ReviewLoopConfigSchema.parse({
        workDir: '.review-loop',
        reviewer: { model: 'm1' },
        fixer: { model: 'm2' },
        matcher: { model: 'm3' },
        pricing: { 'm-*': { input: 'x' } },
      }),
    ).toThrow()
  })
```

Mirror the same three tests in `tests/mutation-improve/config.test.ts` against `MutationImproveConfigSchema` (use that suite's existing minimal valid config object as the base and add `pricing`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/review-loop/config.test.ts tests/mutation-improve/config.test.ts`
Expected: FAIL — `pricing` is stripped/undefined on parse (Zod strips unknown keys), so the first assertion fails.

- [ ] **Step 3: Implement**

`review-loop/src/config.ts`:

```ts
import { PricingTableSchema } from './cost.js'

export const ReviewLoopConfigSchema = z.object({
  // ...existing fields...
  matcher: AgentConfigSchema,
  pricing: PricingTableSchema.optional(),
})
```

`mutation-improve/src/config.ts`:

```ts
import { PricingTableSchema } from '../../review-loop/src/cost.js'

export const MutationImproveConfigSchema = z.object({
  // ...existing fields...
  prBranchPrefix: z.string().min(1).default('mutation-improve'),
  pricing: PricingTableSchema.optional(),
})
```

Add to both `config.example.json` files (top-level, after the agent/agent blocks):

```json
  "pricing": {
    "anthropic/claude-sonnet-*": { "input": 3, "output": 15 },
    "anthropic/claude-opus-*": { "input": 15, "output": 75 }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/review-loop/config.test.ts tests/mutation-improve/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run review-loop:typecheck && bun run review-loop:lint && bun run mutation-improve:typecheck && bun run mutation-improve:lint
git add review-loop/src/config.ts mutation-improve/src/config.ts review-loop/config.example.json mutation-improve/config.example.json tests/review-loop/config.test.ts tests/mutation-improve/config.test.ts
git commit -m "feat: add optional pricing table to review-loop and mutation-improve config schemas"
```

---

### Task 7: review-loop — worker-pool merge diff measurement

**Files:**
- Modify: `review-loop/src/worker-pool.ts` (`mergeWorkerIntoPrimary` L86-98, `createWorkerPool` L147-176)
- Test: `tests/review-loop/worker-pool.test.ts` (extend; uses real temp git repos via `setupPrimary` + `createReviewLoopConfigFixture`)

**Interfaces:**
- Consumes: `headSha`, `measureDiffSince`, `DiffStats` (Task 2).
- Produces: `WorkerPoolHooks { onMergeDiff?: (workerId: number, diff: DiffStats) => void; warn?: (message: string) => void }`; `createWorkerPool(config, runState, hooks?)`. Consumed by Task 8 (cli wiring).

- [ ] **Step 1: Write the failing test** (append to `tests/review-loop/worker-pool.test.ts`; mirrors the existing temp-repo fixture style)

```ts
test('mergeWorkerIntoPrimary reports numstat diff via onMergeDiff hook', async () => {
  const repoRoot = makeTempDir('pool-')
  const config = createReviewLoopConfigFixture(repoRoot, { poolSize: 1 })
  const runState = await createRunState(config, path.join(repoRoot, 'plan.md'))
  await setupPrimary(repoRoot, runState.runId, runState.worktreePath)

  const diffs: Array<{ workerId: number; added: number; removed: number }> = []
  const pool = await createWorkerPool(config, runState, {
    onMergeDiff: (workerId, diff) => diffs.push({ workerId, ...diff }),
    warn: () => undefined,
  })
  const worker = await pool.acquire('src/a.ts')
  writeFileSync(path.join(worker.worktreePath, 'src-a.ts'), 'line1\nline2\nline3\n')
  await execGit(worker.worktreePath, ['add', '.'])
  await execGit(worker.worktreePath, ['commit', '-m', 'worker change'])
  const result = await pool.mergeWorkerIntoPrimary(worker)
  expect(result.ok).toBe(true)
  expect(diffs).toEqual([{ workerId: worker.id, added: 3, removed: 0 }])
  await pool.close()
})

test('mergeWorkerIntoPrimary without hooks still merges', async () => {
  const repoRoot = makeTempDir('pool-')
  const config = createReviewLoopConfigFixture(repoRoot, { poolSize: 1 })
  const runState = await createRunState(config, path.join(repoRoot, 'plan.md'))
  await setupPrimary(repoRoot, runState.runId, runState.worktreePath)
  const pool = await createWorkerPool(config, runState)
  const worker = await pool.acquire('src/a.ts')
  writeFileSync(path.join(worker.worktreePath, 'x.ts'), 'x\n')
  await execGit(worker.worktreePath, ['add', '.'])
  await execGit(worker.worktreePath, ['commit', '-m', 'x'])
  expect((await pool.mergeWorkerIntoPrimary(worker)).ok).toBe(true)
  await pool.close()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/review-loop/worker-pool.test.ts`
Expected: FAIL — `createWorkerPool` accepts no third arg; no hook invoked (`diffs` stays empty).

- [ ] **Step 3: Implement** (`review-loop/src/worker-pool.ts`)

```ts
import { headSha, measureDiffSince, type DiffStats } from './diff-stats.js'

export interface WorkerPoolHooks {
  onMergeDiff?: (workerId: number, diff: DiffStats) => void
  warn?: (message: string) => void
}

function mergeWorkerIntoPrimary(
  internals: PoolInternals,
  primaryWorktreePath: string,
  primaryBranch: string,
  worker: Worker,
  hooks: WorkerPoolHooks,
): Promise<{ ok: true } | { ok: false; conflictFiles: string[] }> {
  return withPrimaryLock(internals, async () => {
    const rebase = await rebaseOnto(worker.worktreePath, primaryBranch, worker.branch)
    if (!rebase.ok) return { ok: false, conflictFiles: rebase.conflictFiles }
    const before = await headSha(execGit, primaryWorktreePath)
    await mergeFastForward(primaryWorktreePath, worker.branch)
    try {
      const diff = await measureDiffSince(execGit, primaryWorktreePath, before)
      hooks.onMergeDiff?.(worker.id, diff)
    } catch (error) {
      hooks.warn?.(`[worker-${worker.id}] merge diff stats failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    return { ok: true }
  })
}

export async function createWorkerPool(
  config: ReviewLoopConfig,
  runState: RunState,
  hooks: WorkerPoolHooks = {},
): Promise<WorkerPool> {
  // ...unchanged body except:
    mergeWorkerIntoPrimary: (worker: Worker) =>
      mergeWorkerIntoPrimary(internals, primaryWorktreePath, primaryBranch, worker, hooks),
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/review-loop/worker-pool.test.ts`
Expected: PASS (old + 2 new).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run review-loop:typecheck && bun run review-loop:lint
git add review-loop/src/worker-pool.ts tests/review-loop/worker-pool.test.ts
git commit -m "feat(review-loop): report merge numstat diffs from worker pool"
```

---

### Task 8: review-loop — cli wiring, summary totals line, metrics.json `runStats`, resume rehydrate

**Files:**
- Modify: `review-loop/src/summary.ts` (`MetricsJson` L26-42, `buildTimingLine` area, `buildSummary` L211-230, `buildMetricsJson` L232-258)
- Modify: `review-loop/src/cli.ts` (`writeRunArtifacts` L164-189, `executeReviewLoop` L191-221, `runCli` L223-250)
- Test: `tests/review-loop/summary.test.ts` (extend), `tests/review-loop/cli.test.ts` (extend for `writeRunArtifacts` + `readPersistedRunStats`)

**Interfaces:**
- Consumes: `RunStats`, `PersistedStats`, `StatsSnapshot` (Task 3); `WorkerPoolHooks` (Task 7); `config.pricing` (Task 6).
- Produces: `MetricsJson.runStats?: PersistedStats`; `SummaryInput.stats?: StatsSnapshot`; `writeRunArtifacts(runDir, result, options)` where `options` gains `stats?: RunStats`; exported `readPersistedRunStats(runDir): Promise<PersistedStats | undefined>`.

- [ ] **Step 1: Write the failing tests**

`tests/review-loop/summary.test.ts` (uses the existing `inputOf(overrides)` fixture at line 88):

```ts
test('buildSummary appends a Stats line when stats are present', () => {
  const summary = buildSummary(
    inputOf({
      stats: {
        totals: {
          input: 228_800,
          output: 41_200,
          reasoning: 0,
          toolCalls: 37,
          added: 412,
          removed: 87,
          estimatedCostUsd: 1.02,
          elapsedMs: 252_000,
        },
        perLabel: {},
      },
    }),
  )
  expect(summary).toContain('Stats: tools 37 · +412/-87 · ~$1.02 est')
})

test('buildSummary omits the Stats line when stats are absent', () => {
  expect(buildSummary(inputOf())).not.toContain('Stats:')
})

test('buildMetricsJson includes runStats when provided', () => {
  const runStats = {
    totals: { input: 1, output: 2, reasoning: 0, toolCalls: 3, added: 4, removed: 5, estimatedCostUsd: 0.01 },
    perLabel: {},
  }
  const metrics = buildMetricsJson('clean', 1, 0, [], { poolSize: 1, inspect: false }, runStats)
  expect(metrics.runStats).toEqual(runStats)
})
```

`tests/review-loop/cli.test.ts`:

```ts
test('writeRunArtifacts persists runStats into metrics.json and a Stats line into summary.txt', async () => {
  const runDir = makeTempDir('rl-artifacts-')
  const stats = new RunStats({ pricing: { 'm-*': { input: 3, output: 15 } }, startedAt: 0, now: () => 60_000 })
  stats.addUsage('reviewer', { input: 100_000, output: 10_000, reasoning: 0, model: 'm-x' })
  stats.addToolCalls('reviewer', 5)
  await writeRunArtifacts(
    runDir,
    { doneReason: 'clean', rounds: 1, metrics: [], ledger: { issues: {} } },
    { poolSize: 1, inspect: false, wallMs: 60_000, stats },
  )
  const metrics = JSON.parse(await readFile(path.join(runDir, 'metrics.json'), 'utf8'))
  expect(metrics.runStats.totals.toolCalls).toBe(5)
  expect(metrics.runStats.totals.estimatedCostUsd).toBeCloseTo(0.45, 10)
  const summary = await readFile(path.join(runDir, 'summary.txt'), 'utf8')
  expect(summary).toContain('Stats: tools 5')
})

test('readPersistedRunStats returns undefined when metrics.json is missing or has no runStats', async () => {
  const runDir = makeTempDir('rl-nostats-')
  await expect(readPersistedRunStats(runDir)).resolves.toBeUndefined()
})
```

(The `writeRunArtifacts` result fixture `{ doneReason: 'clean', rounds: 1, metrics: [], ledger: { issues: {} } }` must satisfy `ReviewLoopResult` — check `review-loop/src/loop-controller.ts` for the exact type and adjust field names if they differ. `console.log(summary)` inside `writeRunArtifacts` will print during the test; that is acceptable — existing cli tests already tolerate it.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/review-loop/summary.test.ts tests/review-loop/cli.test.ts`
Expected: FAIL — no `stats` on SummaryInput / no 6th param / no `readPersistedRunStats` export.

- [ ] **Step 3: Implement**

`review-loop/src/summary.ts`:

```ts
import type { PersistedStats, StatsSnapshot } from './run-stats.js'

export interface MetricsJson {
  // ...existing fields...
  runStats?: PersistedStats
}

export interface SummaryInput {
  // ...existing fields...
  stats?: StatsSnapshot
}

function buildStatsLine(stats: StatsSnapshot | undefined): string | null {
  if (stats === undefined) return null
  const t = stats.totals
  const parts: string[] = []
  if (t.toolCalls > 0) parts.push(`tools ${t.toolCalls}`)
  if (t.added > 0 || t.removed > 0) parts.push(`+${t.added}/-${t.removed}`)
  if (t.estimatedCostUsd !== undefined) parts.push(`~$${t.estimatedCostUsd.toFixed(2)} est`)
  if (parts.length === 0) return null
  return `Stats: ${parts.join(' · ')}`
}
```

In `buildSummary`, after `const inspectorLine = …` block, add:

```ts
  const statsLine = buildStatsLine(input.stats)
  if (statsLine !== null) lines.push(statsLine)
```

In `buildMetricsJson`, add a 6th optional parameter and field:

```ts
export function buildMetricsJson(
  doneReason: ReviewLoopResult['doneReason'],
  rounds: number,
  closed: number,
  metrics: readonly RoundMetric[],
  options: SummaryOptions,
  runStats?: PersistedStats,
): MetricsJson {
  // ...existing body...
  return {
    // ...existing fields...
    ...(runStats === undefined ? {} : { runStats }),
  }
}
```

`review-loop/src/cli.ts`:

```ts
import { RunStats, type PersistedStats } from './run-stats.js'

export async function readPersistedRunStats(runDir: string): Promise<PersistedStats | undefined> {
  try {
    const raw = JSON.parse(await readFile(path.join(runDir, 'metrics.json'), 'utf8')) as { runStats?: PersistedStats }
    return raw.runStats
  } catch {
    return undefined
  }
}
```

`writeRunArtifacts` — extend options and both writes:

```ts
export async function writeRunArtifacts(
  runDir: string,
  result: ReviewLoopResult,
  options: { poolSize: number; inspect: boolean; wallMs: number; stats?: RunStats },
): Promise<void> {
  // ...
  const summary = buildSummary({
    // ...existing fields...
    stats: options.stats?.snapshot(),
  })
  // ...
      JSON.stringify(
        buildMetricsJson(result.doneReason, result.rounds, closed, result.metrics ?? [], options, options.stats?.persist()),
        null,
        2,
      )
}
```

`executeReviewLoop` — pass stats through from the reporter:

```ts
  await writeRunArtifacts(runState.runDir, result, {
    poolSize: config.poolSize,
    inspect,
    wallMs: Date.now() - startedAt,
    stats: log.stats,
  })
```

`runCli` — construct stats with rehydration, pass into renderer and pool:

```ts
  const priorStats = args.resumeRunId === undefined ? undefined : await readPersistedRunStats(runState.runDir)
  const stats = RunStats.rehydrate(priorStats, { pricing: config.pricing })
  const log = new LiveRenderer(process.stdout, stats)
  // ...
  const pool = await createWorkerPool(config, runState, {
    onMergeDiff: (workerId, diff) => log.diff(`worker-${workerId}`, diff),
    warn: (message) => log.event(message),
  })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/review-loop/summary.test.ts tests/review-loop/cli.test.ts tests/review-loop/worker-pool.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, full review-loop suite, commit**

```bash
bun run review-loop:typecheck && bun run review-loop:lint && bun run review-loop:test
git add review-loop/src/summary.ts review-loop/src/cli.ts tests/review-loop/summary.test.ts tests/review-loop/cli.test.ts
git commit -m "feat(review-loop): persist run stats to metrics.json and print Stats line in summary"
```

---

### Task 9: mutation-improve — state stats schema, pipeline merge diff, cli save wrap

**Files:**
- Modify: `mutation-improve/src/run-state.ts` (schema L33-44)
- Modify: `mutation-improve/src/pipeline.ts` (`PipelineDeps.log` L53, `finalizePhase` L163-202)
- Modify: `mutation-improve/src/cli.ts` (`buildPipelineDeps` L141-172, `runCli` L208-249)
- Test: `tests/mutation-improve/run-state.test.ts` (extend), `tests/mutation-improve/pipeline.test.ts` (extend)

**Interfaces:**
- Consumes: `RunStats`, `PersistedStats`, `PersistedStatsSchema` (Task 3); `headSha`, `measureDiffSince`, `DiffStats` (Task 2); `config.pricing` (Task 6).
- Produces: `PersistedRunState.stats?: PersistedStats`; `PipelineDeps.log` gains `diff?(label, diff)`; `persistStats(state, stats): void` (exported from `run-state.ts`). Consumed by Task 10.

- [ ] **Step 1: Write the failing tests**

`tests/mutation-improve/run-state.test.ts` (uses the suite's existing `baseConfig(repoRoot, workDir)` + `makeTempDir` fixture style):

```ts
test('state.json round-trips the optional stats block', async () => {
  const repoRoot = makeTempDir('run-state-stats-')
  const config = baseConfig(repoRoot, path.join(repoRoot, '.mutation-improve'))
  const state = await createRunState(config)
  const stats = new RunStats({ pricing: { 'm-*': { input: 3, output: 15 } } })
  stats.addUsage('improve', { input: 100_000, output: 10_000, reasoning: 0, model: 'm-x' })
  stats.addDiff('iter-1', { added: 301, removed: 12 })
  persistStats(state, stats)
  await saveRunState(state)
  const loaded = await loadRunState(state.workDir, state.runId)
  expect(loaded.stats?.totals.input).toBe(100_000)
  expect(loaded.stats?.totals.estimatedCostUsd).toBeCloseTo(0.45, 10)
  expect(loaded.stats?.perLabel['iter-1']).toMatchObject({ added: 301, removed: 12 })
})

test('state.json without a stats block loads with stats undefined', async () => {
  const repoRoot = makeTempDir('run-state-nostats-')
  const config = baseConfig(repoRoot, path.join(repoRoot, '.mutation-improve'))
  const state = await createRunState(config)
  const loaded = await loadRunState(state.workDir, state.runId)
  expect(loaded.stats).toBeUndefined()
})
```

(Add `persistStats` to the existing `run-state.js` import block and import `RunStats` from `../../review-loop/src/run-stats.js`.)

`tests/mutation-improve/pipeline.test.ts` (uses the existing `happyDeps()` fake pattern):

```ts
test('finalize measures merge diff and reports it via log.diff', async () => {
  const deps = happyDeps()
  const diffs: Array<{ label: string; added: number; removed: number }> = []
  deps.log = { log: () => undefined, diff: (label: string, d: { added: number; removed: number }) => diffs.push({ label, ...d }) }
  deps.execGit = (_cwd: string, args: readonly string[]) => {
    if (args[0] === 'rev-parse') return Promise.resolve({ stdout: 'abc123\n', stderr: '' })
    if (args[0] === 'diff') return Promise.resolve({ stdout: '301\t12\ttests/x.test.ts\n', stderr: '' })
    return Promise.resolve({ stdout: '', stderr: '' })
  }
  const outcome = await runIteration(deps, 1)
  expect(outcome.outcome).toBe('improved')
  expect(diffs).toEqual([{ label: 'iter-1', added: 301, removed: 12 }])
})

test('merge conflict reports no diff', async () => {
  const deps = happyDeps()
  const diffs: unknown[] = []
  deps.log = { log: () => undefined, diff: () => diffs.push(1) }
  deps.mergeWorktree = () => Promise.resolve({ ok: false, conflictFiles: ['scripts/mutation/baseline.json'] })
  const outcome = await runIteration(deps, 1)
  expect(outcome.gate).toBe('merge')
  expect(diffs).toEqual([])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/mutation-improve/run-state.test.ts tests/mutation-improve/pipeline.test.ts`
Expected: FAIL — `persistStats` not exported; `log.diff` never called.

- [ ] **Step 3: Implement**

`mutation-improve/src/run-state.ts`:

```ts
import { PersistedStatsSchema, type PersistedStats, type RunStats } from '../../review-loop/src/run-stats.js'

export const PersistedRunStateSchema = z.object({
  // ...existing fields...
  status: z.enum(['running', 'completed', 'aborted']),
  stats: PersistedStatsSchema.optional(),
})

export function persistStats(state: MutationImproveRunState, stats: RunStats): void {
  state.stats = stats.persist()
}
```

`mutation-improve/src/pipeline.ts`:

```ts
import { headSha, measureDiffSince, type DiffStats } from '../../review-loop/src/diff-stats.js'

// in PipelineDeps:
  log: { log: (msg: string) => void; issue?: unknown; diff?: (label: string, diff: DiffStats) => void }

// in finalizePhase, around the merge (current L173-185):
  const beforeSha = await headSha(deps.execGit, deps.config.repoRoot)
  const merge = await deps.mergeWorktree(deps.config.repoRoot, branchFor(deps, iter))
  if (!merge.ok) {
    return {
      iter,
      outcome: 'failed',
      file,
      beforeScore,
      afterScore,
      gate: 'merge',
      reason: `conflict: ${merge.conflictFiles.join(', ')}`,
    }
  }
  try {
    const diff = await measureDiffSince(deps.execGit, deps.config.repoRoot, beforeSha)
    deps.log.diff?.(`iter-${iter}`, diff)
  } catch (error) {
    deps.log.log(`[stats] merge diff unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
```

`mutation-improve/src/cli.ts`:

```ts
import { RunStats } from '../../review-loop/src/run-stats.js'
import { createRunState, loadRunState, persistStats, saveRunState, type MutationImproveRunState } from './run-state.js'

// buildPipelineDeps gains a stats parameter and wraps saveRunState:
function buildPipelineDeps(
  config: MutationImproveConfig,
  runState: MutationImproveRunState,
  log: LiveRenderer,
  cappedRegistry: CappedRegistryStore,
  stats: RunStats,
): PipelineDeps {
  return {
    // ...existing fields...
    saveRunState: async (state) => {
      persistStats(state, stats)
      await saveRunState(state)
    },
    log,
  }
}

// in runCli, replace the LiveRenderer construction + deps build:
  const stats = RunStats.rehydrate(runState.stats, { pricing: config.pricing })
  const log = new LiveRenderer(process.stdout, stats)
  const deps = buildPipelineDeps(config, runState, log, cappedRegistry, stats)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/mutation-improve/run-state.test.ts tests/mutation-improve/pipeline.test.ts`
Expected: PASS. Also run `bun test tests/mutation-improve` to confirm existing pipeline fakes tolerate the two extra `execGit` calls (the sequence fakes clamp to their last entry, and `parseNumstat` treats non-numstat output as zeros — both safe by design).

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run mutation-improve:typecheck && bun run mutation-improve:lint && bun test tests/mutation-improve
git add mutation-improve/src/run-state.ts mutation-improve/src/pipeline.ts mutation-improve/src/cli.ts tests/mutation-improve/run-state.test.ts tests/mutation-improve/pipeline.test.ts
git commit -m "feat(mutation-improve): persist run stats in state.json and measure merge diffs per iteration"
```

---

### Task 10: mutation-improve — terminal run summary

**Files:**
- Create: `mutation-improve/src/summary.ts`
- Modify: `mutation-improve/src/cli.ts` (`runCli` tail, L244-248)
- Test: `tests/mutation-improve/summary.test.ts` (create)

**Interfaces:**
- Consumes: `StatsSnapshot` (Task 3); `MutationImproveRunState` + `IterationResult`; `formatDuration`, `formatTokenCount` from `review-loop/src/live-format.js`.
- Produces: `buildRunSummary(input: { runState: MutationImproveRunState; results: readonly IterationResult[]; stats: StatsSnapshot; aborted: boolean }): string`.

- [ ] **Step 1: Write the failing test**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { IterationResult } from '../../mutation-improve/src/pipeline.js'
import type { MutationImproveRunState } from '../../mutation-improve/src/run-state.js'
import { buildRunSummary } from '../../mutation-improve/src/summary.js'
import { RunStats } from '../../review-loop/src/run-stats.js'

function makeRunState(): MutationImproveRunState {
  return {
    runId: 'run-1',
    runDir: '/tmp/x',
    workDir: '/tmp',
    statePath: '/tmp/x/state.json',
    repoRoot: '/tmp',
    base: 'master',
    threshold: 0.95,
    count: 2,
    currentIteration: 2,
    doneSet: ['src/a.ts'],
    merged: [
      { file: 'src/a.ts', beforeScore: 0.612, afterScore: 0.784, iter: 1 },
      { file: 'src/b.ts', beforeScore: 0.55, afterScore: 0.667, iter: 2, capped: true },
    ],
    failed: [{ iter: 3, file: 'src/c.ts', gate: 'build', reason: 'tsc failed' }],
    status: 'completed',
  }
}

describe('buildRunSummary', () => {
  test('renders per-file rows, failures and totals', () => {
    const stats = new RunStats({ pricing: { 'm-*': { input: 3, output: 15 } }, startedAt: 0, now: () => 760_000 })
    stats.addUsage('improve', { input: 228_800, output: 41_200, reasoning: 0, model: 'm-x' })
    stats.addToolCalls('improve', 37)
    stats.addDiff('iter-1', { added: 301, removed: 12 })
    const results: IterationResult[] = [
      { iter: 1, outcome: 'improved', file: 'src/a.ts' },
      { iter: 2, outcome: 'capped', file: 'src/b.ts' },
      { iter: 3, outcome: 'failed', file: 'src/c.ts', gate: 'build' },
    ]
    const summary = buildRunSummary({ runState: makeRunState(), results, stats: stats.snapshot(), aborted: false })
    expect(summary).toContain('src/a.ts')
    expect(summary).toContain('61.2% → 78.4%')
    expect(summary).toContain('improved')
    expect(summary).toContain('+301/-12')
    expect(summary).toContain('capped')
    expect(summary).toContain('src/c.ts')
    expect(summary).toContain('build')
    expect(summary).toContain('in 228.8k / out 41.2k')
    expect(summary).toContain('~$1.30 est')
    expect(summary).toContain('tools 37')
    expect(summary).toContain('12m40s')
  })

  test('omits cost when unpriced and marks aborted runs', () => {
    const stats = new RunStats({ startedAt: 0, now: () => 1000 })
    const summary = buildRunSummary({ runState: makeRunState(), results: [], stats: stats.snapshot(), aborted: true })
    expect(summary).toContain('aborted')
    expect(summary).not.toContain('est')
  })
})
```

(Cost arithmetic: 228_800 in × $3/1M = 0.6864; 41_200 out × $15/1M = 0.618; total 1.3044 → `~$1.30 est`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/mutation-improve/summary.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `mutation-improve/src/summary.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { formatDuration, formatTokenCount } from '../../review-loop/src/live-format.js'
import type { StatsSnapshot } from '../../review-loop/src/run-stats.js'
import type { IterationResult } from './pipeline.js'
import type { MutationImproveRunState } from './run-state.js'

export interface RunSummaryInput {
  runState: MutationImproveRunState
  results: readonly IterationResult[]
  stats: StatsSnapshot
  aborted: boolean
}

function pct(score: number): string {
  return `${(score * 100).toFixed(1)}%`
}

function mergedRow(entry: MutationImproveRunState['merged'][number], stats: StatsSnapshot): string {
  const outcome = entry.capped === true ? 'capped' : 'improved'
  const diff = stats.perLabel[`iter-${entry.iter}`]
  const diffPart = diff !== undefined && (diff.added > 0 || diff.removed > 0) ? `+${diff.added}/-${diff.removed}` : '-'
  return `  ${entry.file}  ${pct(entry.beforeScore)} → ${pct(entry.afterScore)}  ${outcome}  ${diffPart}`
}

function totalsLine(stats: StatsSnapshot): string {
  const t = stats.totals
  const parts = [`in ${formatTokenCount(t.input)} / out ${formatTokenCount(t.output)}`]
  if (t.estimatedCostUsd !== undefined) parts.push(`~$${t.estimatedCostUsd.toFixed(2)} est`)
  if (t.toolCalls > 0) parts.push(`tools ${t.toolCalls}`)
  if (t.added > 0 || t.removed > 0) parts.push(`+${t.added}/-${t.removed}`)
  parts.push(formatDuration(t.elapsedMs))
  return `Totals: ${parts.join(' · ')}`
}

export function buildRunSummary(input: RunSummaryInput): string {
  const { runState, results, stats, aborted } = input
  const status = aborted ? 'aborted' : runState.failed.length > 0 ? 'completed with failures' : 'completed'
  const lines = [
    `Run summary (${runState.runId}) — ${status}: ${runState.merged.length} merged, ${runState.failed.length} failed, ${results.length} iterations`,
  ]
  for (const entry of runState.merged) {
    lines.push(mergedRow(entry, stats))
  }
  for (const f of runState.failed) {
    lines.push(`  ${f.file ?? '(no file)'}  failed at ${f.gate}: ${f.reason}`)
  }
  lines.push(totalsLine(stats))
  return lines.join('\n')
}
```

`mutation-improve/src/cli.ts` — in `runCli`, after the `try/finally` that saves state and before the finalize/exit-code block:

```ts
  console.log(buildRunSummary({ runState, results, stats: stats.snapshot(), aborted }))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/mutation-improve/summary.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
bun run mutation-improve:typecheck && bun run mutation-improve:lint
git add mutation-improve/src/summary.ts mutation-improve/src/cli.ts tests/mutation-improve/summary.test.ts
git commit -m "feat(mutation-improve): print end-of-run terminal summary with aggregate stats"
```

---

### Task 11: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run both full suites and all checks**

```bash
bun run review-loop:test
bun run mutation-improve:test
bun run review-loop:typecheck && bun run review-loop:lint && bun run review-loop:format:check
bun run mutation-improve:typecheck && bun run mutation-improve:lint && bun run mutation-improve:format:check
```

Expected: all green. Fix any format drift with `bun run review-loop:format` / `bun run mutation-improve:format` and commit as `style: apply oxfmt`.

- [ ] **Step 2: Smoke-run the live footer manually (optional, TTY only)**

```bash
bun run mutation-improve:start -- --count 1 --threshold 0
```

Expected: status line shows `in …k / out …k · ~$… est · tools N · +a/-b` segments while an iteration runs (cost segment only when `pricing` is configured in `mutation-improve/config.json`); end of run prints the `Run summary` block. `--threshold 0` makes every file already-at-threshold → exercises the skip path quickly; a full improved-path smoke can use the default threshold.

- [ ] **Step 3: Commit any residual fixes**

```bash
git status --short
git add -A && git commit -m "chore: final verification fixes for progress stats renderer"
```
