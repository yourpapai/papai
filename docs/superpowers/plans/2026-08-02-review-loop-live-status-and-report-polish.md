<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Review-loop Live Status Line + Report Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent multi-line live status area (status line + per-activity slot lines, TTY-only), silence per-tool noise in piped output, and fix final-report defects (burndown alignment, always-zero cost, zero-activity rows, missing wall clock).

**Architecture:** In-place extension of the seam landed in `2026-08-01-review-loop-report-output.md`. `ProgressReporter` gains optional `slot(key, line | null)` and `usage(delta)`; `LiveRenderer` keeps a slot map and renders a `[status line, ...slot lines]` block with multi-line ANSI redraw; `line-handler`/`withLivePhase` route progress through slots. Report fixes are pure formatting in `summary.ts`/`summary-burndown.ts` plus a `wallMs` measurement in `cli.ts`.

**Tech Stack:** Bun runtime + `bun:test`, strict TypeScript, zod (unchanged schemas).

**Spec:** `docs/superpowers/specs/2026-08-02-review-loop-live-status-and-report-polish-design.md`

## Global Constraints

- New source files MUST start with the BUSL-1.1 header (see any existing `review-loop/src/*.ts` file — `// SPDX-License-Identifier: BUSL-1.1` + 3 comment lines).
- Strict TypeScript; use `.js` extension in all import paths.
- Never add lint-disable or type-ignore comments.
- Error extraction convention: `error instanceof Error ? error.message : String(error)`.
- TDD: the repo write-hook maps `review-loop/src/**` to `tests/review-loop/**`; write the failing test BEFORE the implementation in every task.
- Commit style follows history: `feat(review-loop): …`, `fix(review-loop): …`, `test(review-loop): …`.
- Run tests from the repo root. Single file: `bun test tests/review-loop/<file>.test.ts`. Full workspace suite: `bun run review-loop:test`. Typecheck: `bun run review-loop:typecheck`.
- Unicode marks in use: `✓` (U+2713), `✗` (U+2717), `!`, `·` (U+00B7), `…` (U+2026), `—` (U+2014), `▶` (U+25B6). This plan adds `×` (U+00D7) for activity counts (`fix×2`). Reuse the existing constants in `live-renderer.ts` where they exist (`MIDDLE_DOT`, `ELLIPSIS`).
- `noUncheckedIndexedAccess` is on: tuple/array index access yields `T | undefined` — handle it (no `!` assertions).

---

### Task 1: Burndown column alignment + zero-activity row suppression

**Files:**
- Modify: `review-loop/src/summary-burndown.ts` (full rewrite — header/rows generated from shared widths; `burndownIsEmpty` removed)
- Modify: `review-loop/src/summary.ts` (call site: use `burndownBlock` return value, drop `burndownIsEmpty` import)
- Test: `tests/review-loop/summary-burndown.test.ts` (rewritten)
- Test: `tests/review-loop/summary.test.ts` (one new test)

**Interfaces:**
- Consumes: `RoundMetric` from `./trace-log.js` (unchanged).
- Produces (used by `summary.ts`): `burndownBlock(metrics: readonly RoundMetric[]): string` — returns `''` when no non-zero rows remain; otherwise the `Burndown:` block. `burndownIsEmpty` is **deleted**; no other consumer exists (verified: only `summary.ts` imported it).

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `tests/review-loop/summary-burndown.test.ts` with:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { burndownBlock } from '../../review-loop/src/summary-burndown.js'
import type { RoundMetric } from '../../review-loop/src/trace-log.js'

function zeroMetric(round: number): RoundMetric {
  return {
    round,
    newIssues: 0,
    cumulativeOpen: 0,
    noProgressRounds: 0,
    decisions: {
      fixed: 0,
      invalid: 0,
      already_fixed: 0,
      needs_human: 0,
      plan_drift: 0,
      no_commit: 0,
      inspector_rejected: 0,
    },
    reviewerSeverity: { critical: 0, high: 0, medium: 0, low: 0 },
    fixerSeverity: { critical: 0, high: 0, medium: 0, low: 0 },
    inspector: { runs: 0, rejected: 0 },
    phaseMs: { review: 0, match: 0, verify: 0, build: 0, inspect: 0, fix: 0 },
    usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0 },
  }
}

function busyMetric(round: number): RoundMetric {
  const metric = zeroMetric(round)
  metric.newIssues = 4
  metric.cumulativeOpen = 2
  metric.decisions.fixed = 2
  metric.decisions.invalid = 1
  metric.reviewerSeverity = { critical: 0, high: 1, medium: 2, low: 1 }
  metric.fixerSeverity = { critical: 0, high: 1, medium: 1, low: 1 }
  metric.phaseMs = { review: 178_300, match: 0, verify: 0, build: 0, inspect: 0, fix: 0 }
  metric.usage = { inputTokens: 120_000, outputTokens: 8_000, reasoningTokens: 3_000, costUsd: 1.234 }
  return metric
}

describe('burndownBlock', () => {
  test('returns empty string when every round has zero activity', () => {
    expect(burndownBlock([zeroMetric(1), zeroMetric(2)])).toBe('')
  })

  test('renders header aligned with row columns', () => {
    const block = burndownBlock([busyMetric(1)])
    const lines = block.split('\n')
    expect(lines[0]).toBe('Burndown:')
    expect(lines[1]).toBe('  round new open fixed rejected needs_human plan_drift insp_rej avgRev avgFix')
    expect(lines[2]).toBe('  1     4   2    2     1        0           0          0        2.0    2.0')
  })

  test('drops zero-activity rows but keeps active ones', () => {
    const block = burndownBlock([busyMetric(1), zeroMetric(2)])
    const lines = block.split('\n')
    expect(lines).toHaveLength(3)
    expect(block).not.toContain('  2     0')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/review-loop/summary-burndown.test.ts`
Expected: FAIL — `burndownIsEmpty` is still exported (test imports only `burndownBlock`, so import works), but the current header literal is `'  round  new  open  fixed  rejected  needs_human  plan_drift  insp_rej  avgRev  avgFix'` (double spaces) and the all-zero input returns a full table instead of `''`.

- [ ] **Step 3: Rewrite summary-burndown.ts**

Replace the entire contents of `review-loop/src/summary-burndown.ts` with:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { RoundMetric, Severity, SeverityCounts } from './trace-log.js'

const SEV_WEIGHT: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 }

const HEADERS = [
  '  round',
  'new',
  'open',
  'fixed',
  'rejected',
  'needs_human',
  'plan_drift',
  'insp_rej',
  'avgRev',
  'avgFix',
] as const

/** Cell widths matching HEADERS; 0 marks the last, unpadded column. */
const WIDTHS = [8, 4, 5, 6, 9, 12, 11, 9, 7, 0] as const

function avgSeverity(counts: SeverityCounts, total: number): string {
  if (total === 0) return '-'
  const sum =
    counts.critical * SEV_WEIGHT.critical +
    counts.high * SEV_WEIGHT.high +
    counts.medium * SEV_WEIGHT.medium +
    counts.low * SEV_WEIGHT.low
  return (sum / total).toFixed(1)
}

function decidedCount(m: RoundMetric): number {
  return (
    m.decisions.fixed +
    m.decisions.invalid +
    m.decisions.already_fixed +
    m.decisions.needs_human +
    m.decisions.plan_drift +
    m.decisions.no_commit +
    m.decisions.inspector_rejected
  )
}

function rowIsZero(m: RoundMetric): boolean {
  return m.newIssues === 0 && decidedCount(m) === 0
}

function renderRow(values: readonly string[]): string {
  return values
    .map((value, i) => {
      const width = WIDTHS[i] ?? 0
      return width === 0 ? value : value.padEnd(width)
    })
    .join('')
}

function dataRow(m: RoundMetric): string {
  return renderRow([
    `  ${m.round}`,
    String(m.newIssues),
    String(m.cumulativeOpen),
    String(m.decisions.fixed),
    String(m.decisions.invalid),
    String(m.decisions.needs_human),
    String(m.decisions.plan_drift),
    String(m.decisions.inspector_rejected),
    avgSeverity(m.reviewerSeverity, m.newIssues),
    avgSeverity(m.fixerSeverity, decidedCount(m)),
  ])
}

export function burndownBlock(metrics: readonly RoundMetric[]): string {
  const rows = metrics.filter((m) => !rowIsZero(m)).map(dataRow)
  if (rows.length === 0) return ''
  return ['Burndown:', renderRow(HEADERS), ...rows].join('\n')
}
```

Note: `burndownIsEmpty` is gone; a row with `cumulativeOpen > 0` but no new issues and no decisions is now dropped (display-only change — the open count still shows in the verdict line and issues block).

- [ ] **Step 4: Update the summary.ts call site**

In `review-loop/src/summary.ts`, change the import (line 17):

```typescript
import { burndownBlock } from './summary-burndown.js'
```

and replace the burndown push in `buildSummary`:

```typescript
  const burndown = burndownBlock(input.metrics)
  if (burndown !== '') lines.push('', burndown)
```

(replacing the previous `if (input.metrics.length > 0 && (input.metrics.length > 1 || !burndownIsEmpty(input.metrics)))` block).

- [ ] **Step 5: Add the summary-level regression test**

In `tests/review-loop/summary.test.ts`, append to `describe('buildSummary zero suppression')`:

```typescript
  test('drops zero-activity rounds from a multi-round burndown', () => {
    const summary = buildSummary(inputOf({ metrics: [busyMetric(1), zeroMetric(2)] }))
    expect(summary).toContain('Burndown:')
    expect(summary).not.toContain('  2     0')
  })
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/review-loop/summary-burndown.test.ts tests/review-loop/summary.test.ts`
Expected: PASS (all tests).

- [ ] **Step 7: Typecheck**

Run: `bun run review-loop:typecheck`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add review-loop/src/summary-burndown.ts review-loop/src/summary.ts tests/review-loop/summary-burndown.test.ts tests/review-loop/summary.test.ts
git commit -m "fix(review-loop): align burndown columns and drop zero-activity rows"
```

---

### Task 2: Wall-clock duration + honest cost/token reporting

**Files:**
- Modify: `review-loop/src/summary.ts` (`SummaryInput.wallMs`, `buildTimingLine` rewrite, `formatCount` helper)
- Modify: `review-loop/src/cli.ts` (measure `startedAt`, pass `wallMs` through `writeRunArtifacts` options)
- Test: `tests/review-loop/summary.test.ts` (update `inputOf` + timing test, add zero-cost test)

**Interfaces:**
- Consumes: nothing from Task 1 (independent).
- Produces:
  - `SummaryInput` gains `wallMs: number` (top-level field, before `options`).
  - `writeRunArtifacts(runDir, result, options)` — `options` gains `wallMs: number`.
  - Timing line format: `Duration: <wall> wall · phases <sum> (<nonzero phases>) · Cost: $X (in … / out … / reasoning …)` when `costUsd > 0`, else `… · Tokens: in … / out … / reasoning …`. All token counts use `toLocaleString('en-US')` separators.

- [ ] **Step 1: Write the failing tests**

In `tests/review-loop/summary.test.ts`:

1. Add `wallMs` to `inputOf`:

```typescript
function inputOf(overrides?: Partial<SummaryInput>): SummaryInput {
  return {
    doneReason: 'clean',
    rounds: 1,
    metrics: [],
    ledger: { issues: {} },
    runDir: '/repo/.review-loop/runs/run-1',
    wallMs: 200_000,
    options: { poolSize: 1, inspect: false },
    ...overrides,
  }
}
```

2. Replace the `buildSummary timing and cost` describe block with:

```typescript
describe('buildSummary timing and cost', () => {
  test('renders wall time, phase sum, nonzero phases, and cost on one line', () => {
    const summary = buildSummary(inputOf({ metrics: [busyMetric(1)] }))
    expect(summary).toContain(
      'Duration: 3m20s wall · phases 2m58s (review 178.3s) · Cost: $1.234 (in 120,000 / out 8,000 / reasoning 3,000)',
    )
  })

  test('hides cost and shows Tokens when the reported cost is zero', () => {
    const metric = busyMetric(1)
    metric.usage = { inputTokens: 228_819, outputTokens: 9_824, reasoningTokens: 49_844, costUsd: 0 }
    const summary = buildSummary(inputOf({ metrics: [metric] }))
    expect(summary).toContain('· Tokens: in 228,819 / out 9,824 / reasoning 49,844')
    expect(summary).not.toContain('Cost:')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/review-loop/summary.test.ts`
Expected: FAIL — `SummaryInput` has no `wallMs` (type error) and the timing line is the old `Duration: 2m58s (review 178.3s) · Cost: $1.234 (in 120000 / …)` shape.

- [ ] **Step 3: Implement in summary.ts**

In `review-loop/src/summary.ts`:

1. Add `wallMs` to `SummaryInput` (after `runDir`):

```typescript
export interface SummaryInput {
  doneReason: ReviewLoopResult['doneReason']
  rounds: number
  metrics: readonly RoundMetric[]
  ledger: IssueLedgerSnapshot
  runDir: string
  wallMs: number
  options: SummaryOptions
}
```

2. Add the count formatter next to `msToSeconds`:

```typescript
function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}
```

3. Replace `buildTimingLine`:

```typescript
function buildTimingLine(metrics: readonly RoundMetric[], wallMs: number): string {
  const phaseMs = aggregatePhaseMs(metrics)
  const totalMs = PHASE_KEYS.reduce((s, k) => s + phaseMs[k], 0)
  const parts = PHASE_KEYS.filter((k) => phaseMs[k] > 0).map((k) => `${k} ${msToSeconds(phaseMs[k])}`)
  const breakdown = parts.length === 0 ? 'no phase timing recorded' : parts.join(', ')
  const usage = aggregateUsage(metrics)
  const tokens = `in ${formatCount(usage.inputTokens)} / out ${formatCount(usage.outputTokens)} / reasoning ${formatCount(usage.reasoningTokens)}`
  const cost = usage.costUsd > 0 ? `Cost: $${usage.costUsd.toFixed(3)} (${tokens})` : `Tokens: ${tokens}`
  return `Duration: ${formatDuration(wallMs)} wall · phases ${formatDuration(totalMs)} (${breakdown}) · ${cost}`
}
```

4. Update the call in `buildSummary`:

```typescript
  const lines: string[] = [buildVerdict(input, counts, total), buildTimingLine(input.metrics, input.wallMs)]
```

- [ ] **Step 4: Wire wallMs in cli.ts**

In `review-loop/src/cli.ts`:

1. `writeRunArtifacts` options gain `wallMs`, forwarded into `buildSummary`:

```typescript
export async function writeRunArtifacts(
  runDir: string,
  result: ReviewLoopResult,
  options: { poolSize: number; inspect: boolean; wallMs: number },
): Promise<void> {
  const closed = Object.values(result.ledger.issues).filter((r) => r.status === 'closed').length
  const summary = buildSummary({
    doneReason: result.doneReason,
    rounds: result.rounds,
    metrics: result.metrics ?? [],
    ledger: result.ledger,
    runDir,
    wallMs: options.wallMs,
    options: { poolSize: options.poolSize, inspect: options.inspect },
  })
  await writeFile(path.join(runDir, 'summary.txt'), `${summary}\n`)
  try {
    await writeFile(
      path.join(runDir, 'metrics.json'),
      `${JSON.stringify(buildMetricsJson(result.doneReason, result.rounds, closed, result.metrics ?? [], options), null, 2)}\n`,
    )
  } catch (error) {
    console.warn(`[review-loop] metrics.json write failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  console.log(summary)
}
```

(`buildMetricsJson` ignores the extra option field — its signature takes the whole options object positionally today only via `options.poolSize`; passing the extended object is compatible because it reads only `poolSize`.)

2. `executeReviewLoop` gains a `startedAt: number` parameter (append it after `inspect: boolean`) and passes the elapsed wall time:

```typescript
  const result = await runReviewLoop({
    config,
    runState,
    ledger,
    spawn: realSpawn,
    exec,
    log,
    trace,
    pool,
    inspect,
  })
  // Write summary/metrics/trace BEFORE finalizeRun so they always exist for
  // post-mortem, even if the final build check or merge throws.
  await writeRunArtifacts(runState.runDir, result, { poolSize: config.poolSize, inspect, wallMs: Date.now() - startedAt })
```

3. In `runCli`, capture the start time at the top of the function and pass it through:

```typescript
export async function runCli(argv: readonly string[]): Promise<void> {
  const startedAt = Date.now()
  const args = parseCliArgs(argv)
  ...
  try {
    await executeReviewLoop(config, runState, ledger, exec, log, trace, pool, !args.noInspect, startedAt)
  } finally {
    await pool.close()
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/review-loop/summary.test.ts tests/review-loop/cli.test.ts`
Expected: PASS (cli.test.ts does not call `writeRunArtifacts` directly and asserts no Duration-line content — verified).

- [ ] **Step 6: Typecheck**

Run: `bun run review-loop:typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add review-loop/src/summary.ts review-loop/src/cli.ts tests/review-loop/summary.test.ts
git commit -m "feat(review-loop): wall-clock duration and honest cost/token reporting"
```

---

### Task 3: `slot()`/`usage()` seam + LiveRenderer multi-line block

**Files:**
- Modify: `review-loop/src/progress-log.ts` (add `UsageDelta`, `slot?`, `usage?`)
- Modify: `review-loop/src/live-renderer.ts` (slot map, block redraw, `event` interleave, EPIPE downgrade)
- Test: `tests/review-loop/live-renderer.test.ts` (new describes)

**Interfaces:**
- Consumes: existing `IssueProgressEvent`, `formatFoundLine`/`formatDecidedLine` (unchanged).
- Produces (used by Tasks 4–5):
  - `UsageDelta` — `{ input: number; output: number; reasoning: number; cost: number }` (from `progress-log.js`).
  - `ProgressReporter.slot?(key: string, line: string | null): void` — set/update a per-activity live line; `null` clears it.
  - `ProgressReporter.usage?(delta: UsageDelta): void` — accumulate token totals.
  - `LiveRenderer` behavior contract: TTY renders a block `[statusLine?, ...slotLines]` (status line only while ≥1 slot is active and non-empty); non-TTY `slot()` is a no-op; `event()` clears the block, prints, redraws; any stream write throw permanently downgrades `dynamic` to `false`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/review-loop/live-renderer.test.ts`:

```typescript
describe('LiveRenderer slots', () => {
  test('non-TTY slot is a no-op', () => {
    const { stream, output } = makeStream()
    const r = new LiveRenderer(stream)
    r.slot('fixer-w1', '  fixer-w1 ▶ edit a.ts')
    expect(output).toEqual([])
  })

  test('TTY slot renders the block with the slot line', () => {
    const { stream, output } = makeStream({ isTTY: true, columns: 120 })
    const r = new LiveRenderer(stream)
    r.slot('fixer-w1', '  fixer-w1 ▶ edit a.ts')
    expect(output).toHaveLength(1)
    expect(output[0]).toContain('fixer-w1 ▶ edit a.ts')
  })

  test('redraw after a multi-line block moves the cursor up to the block top', () => {
    const { stream, output } = makeStream({ isTTY: true, columns: 120 })
    const r = new LiveRenderer(stream)
    r.slot('a', 'line-a')
    r.slot('b', 'line-b')
    r.slot('c', 'line-c')
    const redraw = output[2]!
    expect(redraw.startsWith('\r\u001b[1A')).toBe(true)
    expect(redraw).toContain('line-a')
    expect(redraw).toContain('line-c')
  })

  test('clearing the last slot erases the whole block', () => {
    const { stream, output } = makeStream({ isTTY: true, columns: 120 })
    const r = new LiveRenderer(stream)
    r.slot('a', 'line-a')
    r.slot('a', null)
    const cleared = output[1]!
    expect(cleared.startsWith('\r')).toBe(true)
    expect(cleared).not.toContain('line-a')
  })

  test('event clears the block, prints, and redraws it', () => {
    const { stream, output } = makeStream({ isTTY: true, columns: 120 })
    const r = new LiveRenderer(stream)
    r.issue({ type: 'round', round: 1, maxRounds: 2 })
    r.slot('fixer-w1', 'line-fix')
    const before = output.length
    r.event('hello')
    expect(output[before]).toContain('\u001b[2K')
    expect(output[before + 1]).toBe('hello\n')
    expect(output[before + 2]).toContain('line-fix')
    expect(output[before + 2]).toContain('round 1/2')
  })

  test('a throwing stream downgrades the renderer and never rethrows', () => {
    const stream: RendererStream = {
      write(): boolean {
        throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })
      },
      isTTY: true,
    }
    const r = new LiveRenderer(stream)
    expect(r.dynamic).toBe(true)
    expect(() => r.event('x')).not.toThrow()
    expect(r.dynamic).toBe(false)
    expect(() => r.slot('a', 'line')).not.toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/review-loop/live-renderer.test.ts`
Expected: FAIL — `r.slot` is not a function.

- [ ] **Step 3: Extend progress-log.ts**

Replace the entire contents of `review-loop/src/progress-log.ts` with:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Severity } from './trace-log.js'

export type IssueProgressEvent =
  | { type: 'round'; round: number; maxRounds: number }
  | { type: 'found'; id: string; severity: Severity; file: string; line: number; title: string }
  | { type: 'decided'; id: string; verdict: string; title: string; note?: string }

export interface UsageDelta {
  input: number
  output: number
  reasoning: number
  cost: number
}

export interface ProgressReporter {
  readonly dynamic: boolean
  event(message: string): void
  live(lines: readonly string[]): void
  clearLive(): void
  log(message: string): void
  issue?(event: IssueProgressEvent): void
  statusSuffix?(): string
  slot?(key: string, line: string | null): void
  usage?(delta: UsageDelta): void
}
```

- [ ] **Step 4: Rework LiveRenderer**

In `review-loop/src/live-renderer.ts`:

1. Update the progress-log import:

```typescript
import type { IssueProgressEvent, ProgressReporter, UsageDelta } from './progress-log.js'
```

2. Replace the `CLEAR_LINE` constant with:

```typescript
const ERASE_LINE = '\u001b[2K'
const CURSOR_DOWN = '\u001b[1B'

function cursorUp(n: number): string {
  return `\u001b[${n}A`
}
```

3. Replace the entire `LiveRenderer` class with:

```typescript
export class LiveRenderer implements ProgressReporter {
  private readonly tty: boolean
  private broken = false
  private readonly stream: RendererStream
  private renderedLines = 0
  private startedAt = 0
  private round = 0
  private maxRounds = 0
  private readonly counts = { open: 0, fixed: 0, rejected: 0, needsHuman: 0 }
  private readonly usageTotals: UsageDelta = { input: 0, output: 0, reasoning: 0, cost: 0 }
  private readonly slots = new Map<string, string>()

  constructor(stream: RendererStream) {
    this.stream = stream
    this.tty = stream.isTTY === true
  }

  get dynamic(): boolean {
    return this.tty && !this.broken
  }

  issue(event: IssueProgressEvent): void {
    this.touch()
    switch (event.type) {
      case 'round':
        this.round = event.round
        this.maxRounds = event.maxRounds
        return
      case 'found':
        this.counts.open += 1
        this.event(formatFoundLine(event))
        return
      case 'decided':
        this.counts.open = Math.max(0, this.counts.open - 1)
        if (event.verdict === 'fixed') this.counts.fixed += 1
        else if (event.verdict === 'invalid') this.counts.rejected += 1
        else if (event.verdict === 'needs_human' || event.verdict === 'plan_drift') this.counts.needsHuman += 1
        this.event(formatDecidedLine(event))
    }
  }

  statusSuffix(): string {
    const parts: string[] = []
    if (this.round > 0) parts.push(`round ${this.round}/${this.maxRounds}`)
    const segments: string[] = []
    if (this.counts.open > 0) segments.push(`${this.counts.open} open`)
    if (this.counts.fixed > 0) segments.push(`${this.counts.fixed} fixed`)
    if (this.counts.rejected > 0) segments.push(`${this.counts.rejected} rejected`)
    if (this.counts.needsHuman > 0) segments.push(`${this.counts.needsHuman} needs human`)
    if (segments.length > 0) parts.push(`issues: ${segments.join(` ${MIDDLE_DOT} `)}`)
    return parts.join(` ${MIDDLE_DOT} `)
  }

  slot(key: string, line: string | null): void {
    this.touch()
    if (line === null) {
      this.slots.delete(key)
    } else {
      this.slots.set(key, line)
    }
    if (!this.dynamic) return
    this.renderBlock()
  }

  usage(delta: UsageDelta): void {
    this.touch()
    this.usageTotals.input += delta.input
    this.usageTotals.output += delta.output
    this.usageTotals.reasoning += delta.reasoning
    this.usageTotals.cost += delta.cost
  }

  event(message: string): void {
    this.touch()
    if (!this.dynamic) {
      this.writeSafe(`${message}\n`)
      return
    }
    this.clearBlock()
    this.writeSafe(`${message}\n`)
    this.renderBlock()
  }

  log(message: string): void {
    this.event(message)
  }

  live(lines: readonly string[]): void {
    if (!this.dynamic) {
      for (const line of lines) {
        this.writeSafe(`${line}\n`)
      }
      return
    }
    this.writeBlock([...lines])
  }

  clearLive(): void {
    this.clearBlock()
  }

  private touch(): void {
    if (this.startedAt === 0) this.startedAt = Date.now()
  }

  private statusLine(): string {
    if (this.slots.size === 0) return ''
    const suffix = this.statusSuffix()
    return suffix === '' ? '' : `  ${'status'.padEnd(10)} ${suffix}`
  }

  private renderBlock(): void {
    const status = this.statusLine()
    const lines = status === '' ? [...this.slots.values()] : [status, ...this.slots.values()]
    if (lines.length === 0) {
      this.clearBlock()
      return
    }
    this.writeBlock(lines)
  }

  private writeBlock(lines: string[]): void {
    let out = '\r'
    if (this.renderedLines > 1) out += cursorUp(this.renderedLines - 1)
    out += ERASE_LINE + lines.map((line) => this.fit(line)).join(`\n${ERASE_LINE}`)
    this.writeSafe(out)
    this.renderedLines = lines.length
  }

  private clearBlock(): void {
    if (this.renderedLines === 0) return
    let out = '\r'
    if (this.renderedLines > 1) out += cursorUp(this.renderedLines - 1)
    for (let i = 0; i < this.renderedLines; i++) {
      out += ERASE_LINE
      if (i < this.renderedLines - 1) out += CURSOR_DOWN
    }
    if (this.renderedLines > 1) out += cursorUp(this.renderedLines - 1)
    this.writeSafe(out)
    this.renderedLines = 0
  }

  private writeSafe(chunk: string): void {
    if (this.broken) return
    try {
      this.stream.write(chunk)
    } catch {
      this.broken = true
    }
  }

  private fit(line: string): string {
    const max = this.stream.columns ?? 80
    return truncate(line, max)
  }
}
```

Notes for the implementer:
- `dynamic` changes from a readonly field to a getter over `tty && !broken` — the `ProgressReporter` interface's `readonly dynamic: boolean` is satisfied by a getter.
- `live(lines)` deliberately does NOT `touch()` and does NOT inject the status line: it stays a raw block write so existing tests (`'TTY live writes clear-line + content with no newline'`, `'event after a live line clears it first (TTY)'`) keep passing byte-for-byte.
- `withLivePhase` still calls `reporter.live([...])`/`clearLive()` at this point; Task 5 reroutes it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/review-loop/live-renderer.test.ts`
Expected: PASS (new slot tests + all pre-existing tests unchanged).

- [ ] **Step 6: Typecheck**

Run: `bun run review-loop:typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add review-loop/src/progress-log.ts review-loop/src/live-renderer.ts tests/review-loop/live-renderer.test.ts
git commit -m "feat(review-loop): per-activity live slots with multi-line redraw and EPIPE downgrade"
```

---

### Task 4: Status line content (activity, elapsed, tokens)

**Files:**
- Modify: `review-loop/src/live-renderer.ts` (`statusLine` full segment builder, `activitySummary`, `formatTokenCount`)
- Test: `tests/review-loop/live-renderer.test.ts` (new describes)

**Interfaces:**
- Consumes: Task 3's slot map, counters, `usageTotals`, `startedAt`.
- Produces (used by nothing else directly — internal rendering; `formatTokenCount` exported for tests):
  - `formatTokenCount(n: number): string` — `999` → `'999'`, `9824` → `'9.8k'`, `228819` → `'228.8k'`, `1500000` → `'1.50M'`.
  - Status line: `  status     <round X/Y> · <activity> · <elapsed> · <issues: …> · <in X / out Y>` — zero/absent segments omitted; `activity` derived from slot keys (`reviewer→review`, `matcher→match`, `fixer→fix`, `inspector→inspect`, `build→build`; `-w<N>`/`-retry` suffixes stripped; duplicates counted as `fix×2`; verbs joined with `+`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/review-loop/live-renderer.test.ts` (extend the top import with `formatTokenCount`):

```typescript
import {
  formatDuration,
  formatLiveLine,
  formatStepFooter,
  formatTokenCount,
  formatToolArg,
  LiveRenderer,
  type RendererStream,
} from '../../review-loop/src/live-renderer.js'
```

```typescript
describe('formatTokenCount', () => {
  test('formats compact token counts', () => {
    expect(formatTokenCount(999)).toBe('999')
    expect(formatTokenCount(1000)).toBe('1.0k')
    expect(formatTokenCount(9824)).toBe('9.8k')
    expect(formatTokenCount(228819)).toBe('228.8k')
    expect(formatTokenCount(1500000)).toBe('1.50M')
  })
})

describe('status line', () => {
  test('combines round, activity, issues, and tokens', () => {
    const { stream, output } = makeStream({ isTTY: true, columns: 200 })
    const r = new LiveRenderer(stream)
    r.issue({ type: 'round', round: 1, maxRounds: 2 })
    r.issue({
      type: 'found',
      id: 'aaaaaaaa-0000-0000-0000-000000000000',
      severity: 'low',
      file: 'a.ts',
      line: 1,
      title: 'A',
    })
    r.usage({ input: 228819, output: 9824, reasoning: 49844, cost: 0 })
    r.slot('fixer-w1', 'x')
    r.slot('fixer-w2-retry', 'y')
    const status = output[output.length - 1]!.split('\n')[0]!
    expect(status).toContain('status')
    expect(status).toContain('round 1/2')
    expect(status).toContain('fix×2')
    expect(status).toContain('issues: 1 open')
    expect(status).toContain('in 228.8k / out 9.8k')
  })

  test('maps slot keys to activity verbs', () => {
    const { stream, output } = makeStream({ isTTY: true, columns: 200 })
    const r = new LiveRenderer(stream)
    r.slot('reviewer', 'x')
    const status = output[output.length - 1]!.split('\n')[0]!
    expect(status).toContain('review')
    expect(status).not.toContain('reviewer')
  })

  test('accumulates usage across calls', () => {
    const { stream, output } = makeStream({ isTTY: true, columns: 200 })
    const r = new LiveRenderer(stream)
    r.usage({ input: 500, output: 0, reasoning: 0, cost: 0 })
    r.usage({ input: 600, output: 100, reasoning: 0, cost: 0 })
    r.slot('a', 'x')
    const status = output[output.length - 1]!.split('\n')[0]!
    expect(status).toContain('in 1.1k / out 100')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/review-loop/live-renderer.test.ts`
Expected: FAIL — `formatTokenCount` is not exported; status line lacks activity/token segments.

- [ ] **Step 3: Implement in live-renderer.ts**

1. Add after `formatStepFooter`:

```typescript
export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}
```

2. Add the `TIMES` constant next to the other mark constants:

```typescript
const TIMES = '×'
```

3. Add the activity mapper (module scope, above the class):

```typescript
const ACTIVITY_VERB: Record<string, string> = {
  reviewer: 'review',
  matcher: 'match',
  fixer: 'fix',
  inspector: 'inspect',
  build: 'build',
}

function activitySummary(keys: Iterable<string>): string {
  const counts = new Map<string, number>()
  for (const key of keys) {
    const base = key.split('-')[0] ?? key
    const verb = ACTIVITY_VERB[base] ?? base
    counts.set(verb, (counts.get(verb) ?? 0) + 1)
  }
  const parts: string[] = []
  for (const [verb, n] of counts) {
    parts.push(n === 1 ? verb : `${verb}${TIMES}${n}`)
  }
  return parts.join('+')
}
```

4. Replace the `statusLine()` method (the Task 3 minimal version) with:

```typescript
  private statusLine(): string {
    if (this.slots.size === 0) return ''
    const parts: string[] = []
    if (this.round > 0) parts.push(`round ${this.round}/${this.maxRounds}`)
    const activity = activitySummary(this.slots.keys())
    if (activity !== '') parts.push(activity)
    if (this.startedAt !== 0) parts.push(formatDuration(Date.now() - this.startedAt))
    const segments: string[] = []
    if (this.counts.open > 0) segments.push(`${this.counts.open} open`)
    if (this.counts.fixed > 0) segments.push(`${this.counts.fixed} fixed`)
    if (this.counts.rejected > 0) segments.push(`${this.counts.rejected} rejected`)
    if (this.counts.needsHuman > 0) segments.push(`${this.counts.needsHuman} needs human`)
    if (segments.length > 0) parts.push(`issues: ${segments.join(` ${MIDDLE_DOT} `)}`)
    if (this.usageTotals.input > 0 || this.usageTotals.output > 0) {
      parts.push(`in ${formatTokenCount(this.usageTotals.input)} / out ${formatTokenCount(this.usageTotals.output)}`)
    }
    if (parts.length === 0) return ''
    return `  ${'status'.padEnd(10)} ${parts.join(` ${MIDDLE_DOT} `)}`
  }
```

`statusSuffix()` stays as a public interface member (spec decision: interface compatibility) even though the status line no longer consumes it; its tests stay green.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/review-loop/live-renderer.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `bun run review-loop:typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add review-loop/src/live-renderer.ts tests/review-loop/live-renderer.test.ts
git commit -m "feat(review-loop): status line with round, activity, issues, and tokens"
```

---

### Task 5: Wire slots + usage through line-handler and withLivePhase

**Files:**
- Modify: `review-loop/src/line-handler.ts` (`renderLive` → `slot()`, `step_finish` → `usage()`, `dispose` clears slot)
- Modify: `review-loop/src/live-renderer.ts` (`withLivePhase` tick/clear via `slot()`; `formatLiveLine` drops the 6th `status` param)
- Test: `tests/review-loop/line-handler.test.ts` (new describe)
- Test: `tests/review-loop/live-renderer.test.ts` (delete the `formatLiveLine status suffix` describe; add `withLivePhase` describe)

**Interfaces:**
- Consumes: Task 3's `slot`/`usage` seam, Task 4's status line.
- Produces: no new exports. Behavioral contract: with a `slot`-capable reporter (the real `LiveRenderer`), per-tool progress lands in the label's slot; without one (test fakes), behavior is byte-identical to before (minus the removed `statusSuffix` append, which no fake implements — no observable change).

- [ ] **Step 1: Update the failing tests first**

1. In `tests/review-loop/live-renderer.test.ts`, **delete** the entire `describe('formatLiveLine status suffix', ...)` block (the 6th parameter is going away).

2. In `tests/review-loop/live-renderer.test.ts`, extend the import from `live-renderer.js` to include `withLivePhase`, add `import type { ProgressReporter } from '../../review-loop/src/progress-log.js'`, and append:

```typescript
describe('withLivePhase', () => {
  test('clears its slot when the phase ends', async () => {
    const slots: Array<readonly [string, string | null]> = []
    const reporter: ProgressReporter = {
      dynamic: true,
      event: () => {},
      live: () => {},
      clearLive: () => {},
      log: () => {},
      slot: (key, line) => {
        slots.push([key, line] as const)
      },
    }
    const { result } = await withLivePhase(reporter, 'build', () => Promise.resolve('done'))
    expect(result).toBe('done')
    expect(slots[slots.length - 1]).toEqual(['build', null])
  })
})
```

3. In `tests/review-loop/line-handler.test.ts`, extend imports:

```typescript
import type { RunAgentOptions, SpawnResult } from '../../review-loop/src/agent-runner.js'
import { createLineHandler, enqueueLog } from '../../review-loop/src/line-handler.js'
import type { ProgressReporter, UsageDelta } from '../../review-loop/src/progress-log.js'
```

and append:

```typescript
describe('createLineHandler reporter wiring', () => {
  function makeReporter(overrides: Partial<ProgressReporter>): ProgressReporter {
    return {
      dynamic: false,
      event: () => {},
      live: () => {},
      clearLive: () => {},
      log: () => {},
      ...overrides,
    }
  }

  test('step_finish forwards usage to the reporter', () => {
    const cwd = makeTempDir('line-handler-usage-')
    const deltas: UsageDelta[] = []
    const reporter = makeReporter({
      usage: (d) => {
        deltas.push(d)
      },
    })
    const handler = createLineHandler({ ...makeOptions(cwd, path.join(cwd, 'agent.log')), reporter })
    handler.onLine(
      JSON.stringify({
        type: 'step_finish',
        part: { reason: 'stop', tokens: { input: 5, output: 2, reasoning: 1 }, cost: 0.5 },
      }),
    )
    expect(deltas).toEqual([{ input: 5, output: 2, reasoning: 1, cost: 0.5 }])
  })

  test('tool progress goes to reporter.slot and dispose clears it', async () => {
    const cwd = makeTempDir('line-handler-slot-')
    const slots: Array<readonly [string, string | null]> = []
    const reporter = makeReporter({
      slot: (key, line) => {
        slots.push([key, line] as const)
      },
    })
    const handler = createLineHandler({ ...makeOptions(cwd, path.join(cwd, 'agent.log')), reporter })
    handler.onLine(JSON.stringify({ type: 'step_start', timestamp: 1, part: {} }))
    handler.onLine(
      JSON.stringify({
        type: 'tool_use',
        part: { tool: 'read', callID: 'c1', state: { status: 'running', input: { filePath: '/a/cli.ts' } } },
      }),
    )
    expect(slots.some(([key, line]) => key === 'drain' && line !== null && line.includes('read'))).toBe(true)
    await handler.dispose()
    expect(slots[slots.length - 1]).toEqual(['drain', null])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/review-loop/live-renderer.test.ts tests/review-loop/line-handler.test.ts`
Expected: FAIL — `formatLiveLine` still accepts 6 args (old suffix tests deleted, so no failure there), but the `withLivePhase` slot test fails (tick uses `live()` / clear uses `clearLive()`), `step_finish` never calls `usage()`, and `renderLive` never calls `slot()`.

- [ ] **Step 3: Revert formatLiveLine to 5 parameters**

In `review-loop/src/live-renderer.ts`, replace `formatLiveLine`:

```typescript
export function formatLiveLine(label: string, tool: string, arg: string, elapsedMs: number, toolCount: number): string {
  const toolPart = tool === '' ? 'thinking' : arg === '' ? tool : `${tool} ${arg}`
  const tools = `${toolCount} tool${toolCount === 1 ? '' : 's'}`
  return `  ${label.padEnd(10)} ${ARROW} ${toolPart} ${MIDDLE_DOT} ${formatDuration(elapsedMs)} ${MIDDLE_DOT} ${tools}`
}
```

- [ ] **Step 4: Reroute withLivePhase through slots**

In `review-loop/src/live-renderer.ts`, replace `withLivePhase`:

```typescript
export async function withLivePhase<T>(
  reporter: ProgressReporter,
  label: string,
  fn: () => Promise<T>,
): Promise<{ result: T; durationMs: number }> {
  reporter.event(`[${label}] running...`)
  const start = Date.now()
  let timer: ReturnType<typeof setInterval> | null = null
  if (reporter.dynamic) {
    timer = setInterval(() => {
      const line = `[${label}] ${formatDuration(Date.now() - start)}...`
      if (reporter.slot !== undefined) {
        reporter.slot(label, line)
      } else {
        reporter.live([line])
      }
    }, 1000)
  }
  try {
    const result = await fn()
    return { result, durationMs: Date.now() - start }
  } finally {
    if (timer !== null) {
      clearInterval(timer)
    }
    if (reporter.slot !== undefined) {
      reporter.slot(label, null)
    } else {
      reporter.clearLive()
    }
  }
}
```

(The `statusSuffix` append inside the tick is gone — the status line carries that information now.)

- [ ] **Step 5: Reroute line-handler through slots and usage**

In `review-loop/src/line-handler.ts`:

1. Replace `renderLive`:

```typescript
function renderLive(ctx: LiveCtx): void {
  const reporter = ctx.reporter
  if (reporter === undefined) {
    return
  }
  const elapsed = ctx.startedAt === 0 ? 0 : Date.now() - ctx.startedAt
  const line = formatLiveLine(ctx.label, ctx.tool, ctx.arg, elapsed, ctx.toolCount)
  if (reporter.slot !== undefined) {
    reporter.slot(ctx.label, line)
  } else {
    reporter.live([line])
  }
}
```

2. In `applyEvent`'s `step_finish` case, forward usage before the footer:

```typescript
    case 'step_finish':
      ctx.usage.inputTokens += evt.tokens.input
      ctx.usage.outputTokens += evt.tokens.output
      ctx.usage.reasoningTokens += evt.tokens.reasoning
      ctx.usage.costUsd += evt.cost
      if (reporter !== undefined) {
        reporter.usage?.({
          input: evt.tokens.input,
          output: evt.tokens.output,
          reasoning: evt.tokens.reasoning,
          cost: evt.cost,
        })
        reporter.clearLive()
        reporter.event(
          formatStepFooter(ctx.label, ctx.startedAt === 0 ? 0 : Date.now() - ctx.startedAt, ctx.toolCount, evt.tokens),
        )
      }
      break
```

(`reporter.clearLive()` stays for legacy reporters whose `event()` doesn't clear; for `LiveRenderer` it's a harmless no-op since `event()` clears and redraws itself.)

3. In `dispose`, clear only this handler's slot:

```typescript
  const dispose = async (): Promise<void> => {
    if (ctx.timer !== null) {
      clearInterval(ctx.timer)
    }
    const reporter = ctx.reporter
    if (reporter !== undefined) {
      if (reporter.slot !== undefined) {
        reporter.slot(ctx.label, null)
      } else {
        reporter.clearLive()
      }
    }
    await ctx.logChain
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/review-loop/live-renderer.test.ts tests/review-loop/line-handler.test.ts tests/review-loop/progress-log.test.ts tests/review-loop/build-checker.test.ts tests/review-loop/loop-controller.test.ts`
Expected: PASS. (`progress-log`/`loop-controller` fakes don't implement `slot`/`usage` → fallback paths keep them byte-identical; `build-checker` exercises `withLivePhase` through a fake without `slot` → same fallback.)

- [ ] **Step 7: Typecheck + full workspace suite**

Run: `bun run review-loop:typecheck && bun run review-loop:test`
Expected: clean typecheck; full suite green.

- [ ] **Step 8: Commit**

```bash
git add review-loop/src/line-handler.ts review-loop/src/live-renderer.ts tests/review-loop/line-handler.test.ts tests/review-loop/live-renderer.test.ts
git commit -m "feat(review-loop): route live progress through slots and forward usage"
```

---

## Self-review notes (already applied)

- **Spec coverage:** seam (`slot`/`usage`) → Task 3; multi-line redraw + event interleave → Task 3; EPIPE downgrade → Task 3; status line content (round/activity/elapsed/issues/tokens) → Task 4; non-TTY `slot` no-op → Task 3; `line-handler`/`withLivePhase` wiring → Task 5; burndown alignment + zero-row suppression → Task 1; cost-hidden-when-zero + separators → Task 2; wall clock → Task 2. `metrics.json` unchanged — no task touches it.
- **Type consistency:** `UsageDelta` field names (`input`/`output`/`reasoning`/`cost`) are identical in Task 3 (definition), Task 4 (tests), and Task 5 (call site). `slot(key, line | null)` signature identical everywhere. `wallMs` is a top-level `SummaryInput` field in both Task 2 test and implementation.
- **Ordering:** Tasks 1 and 2 are independent of each other and of Tasks 3–5; Task 4 requires Task 3; Task 5 requires Tasks 3–4. Executing in plan order satisfies all dependencies.
