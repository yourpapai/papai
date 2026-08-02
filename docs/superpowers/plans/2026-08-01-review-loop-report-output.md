<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Review-loop Report Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the review-loop CLI's final report (verdict-first, zero-suppressed, per-issue groups, artifact paths) and live rendering (streamed per-issue lines + counter-enriched status tick).

**Architecture:** In-place extension of existing modules. A new pure formatting module `review-loop/src/issue-format.ts` holds all issue-line rendering; `ProgressReporter` gains an optional `issue()`/`statusSuffix()` seam that `LiveRenderer` implements with a counter bag; `loop-controller`/`issue-processor*`/`commit-attempt` emit structured events; `buildSummary` is rewritten to consume the ledger snapshot + run dir.

**Tech Stack:** Bun runtime + `bun:test`, strict TypeScript, zod (unchanged schemas).

**Spec:** `docs/superpowers/specs/2026-08-01-review-loop-report-output-design.md`

## Global Constraints

- New source files MUST start with the BUSL-1.1 header (see any existing `review-loop/src/*.ts` file — `// SPDX-License-Identifier: BUSL-1.1` + 3 comment lines).
- Strict TypeScript; use `.js` extension in all import paths.
- Never add lint-disable or type-ignore comments.
- Error extraction convention: `error instanceof Error ? error.message : String(error)`.
- TDD: the repo write-hook maps `review-loop/src/**` to `tests/review-loop/**`; write the failing test BEFORE the implementation in every task.
- Commit style follows history: `feat(review-loop): …`, `refactor(review-loop): …`, `test(review-loop): …`.
- Run tests from the repo root. Single file: `bun test tests/review-loop/<file>.test.ts`. Full workspace suite: `bun run review-loop:test`. Typecheck: `bun run review-loop:typecheck`.
- `review-loop/src/trace-log.ts` exports the `Severity` type (`'critical' | 'high' | 'medium' | 'low'`); `ReviewerIssue['severity']` is the same union.
- Unicode marks used: `✓` (U+2713), `✗` (U+2717), `!`, `·` (U+00B7), `…` (U+2026), `—` (U+2014), `▶` (U+25B6). Reuse the existing constants in `live-renderer.ts` where they exist (`MIDDLE_DOT`, `ELLIPSIS`).

---

### Task 1: Issue line formatting module (`issue-format.ts`)

**Files:**
- Create: `review-loop/src/issue-format.ts`
- Test: `tests/review-loop/issue-format.test.ts`

**Interfaces:**
- Consumes: `LedgerIssueStatus` from `review-loop/src/issue-ledger.js` (type-only import).
- Produces (used by Tasks 2–4):
  - `shortIssueId(id: string): string` — first 8 chars.
  - `IssueRef` — `{ id: string; severity: string; file: string; line: number; title: string }`.
  - `formatIssueRef(ref: IssueRef): string` — `#<id8> [<severity>] <file>:<line> — <title>` with `[severity]` padded to 10 chars.
  - `formatFoundLine(ref: IssueRef): string` — `'  + ' + formatIssueRef(ref)`.
  - `formatDecidedLine(args: { id: string; verdict: string; note?: string }): string` — `<mark> #<id8> → <label>[ (note)]`.
  - `IssueGroup` — `'needsHuman' | 'fixed' | 'rejected' | 'alreadyFixed' | 'open'`.
  - `GROUP_ORDER: readonly IssueGroup[]` — `['needsHuman', 'fixed', 'rejected', 'alreadyFixed', 'open']`.
  - `GROUP_LABEL: Record<IssueGroup, string>` — `{ needsHuman: 'needs human', fixed: 'fixed', rejected: 'rejected', alreadyFixed: 'already fixed', open: 'open' }`.
  - `GROUP_MARK: Record<IssueGroup, string>` — `{ needsHuman: '!', fixed: '✓', rejected: '✗', alreadyFixed: '·', open: '·' }`.
  - `groupForStatus(status: LedgerIssueStatus): IssueGroup` — `needs_human→needsHuman`, `closed→fixed`, `rejected→rejected`, `already_fixed→alreadyFixed`, everything else (`discovered`, `verified`, `fixed_pending_review`, `reopened`)→`open`.

- [ ] **Step 1: Write the failing test**

Create `tests/review-loop/issue-format.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  formatDecidedLine,
  formatFoundLine,
  formatIssueRef,
  groupForStatus,
  shortIssueId,
} from '../../review-loop/src/issue-format.js'

const ref = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  severity: 'high',
  file: 'src/auth/login.ts',
  line: 42,
  title: 'Token refresh race on 401',
}

describe('shortIssueId', () => {
  test('takes the first 8 characters', () => {
    expect(shortIssueId(ref.id)).toBe('a1b2c3d4')
    expect(shortIssueId('short')).toBe('short')
  })
})

describe('formatIssueRef', () => {
  test('renders id, padded severity, file:line, and title', () => {
    expect(formatIssueRef(ref)).toBe('#a1b2c3d4 [high]     src/auth/login.ts:42 — Token refresh race on 401')
  })
  test('critical severity fills the pad exactly', () => {
    expect(formatIssueRef({ ...ref, severity: 'critical' })).toBe(
      '#a1b2c3d4 [critical] src/auth/login.ts:42 — Token refresh race on 401',
    )
  })
})

describe('formatFoundLine', () => {
  test('prefixes with indented plus', () => {
    expect(formatFoundLine(ref)).toBe('  + #a1b2c3d4 [high]     src/auth/login.ts:42 — Token refresh race on 401')
  })
})

describe('formatDecidedLine', () => {
  test('maps known verdicts to marks and labels', () => {
    expect(formatDecidedLine({ id: ref.id, verdict: 'fixed' })).toBe('✓ #a1b2c3d4 → fixed')
    expect(formatDecidedLine({ id: ref.id, verdict: 'invalid' })).toBe('✗ #a1b2c3d4 → rejected')
    expect(formatDecidedLine({ id: ref.id, verdict: 'needs_human' })).toBe('! #a1b2c3d4 → needs human')
    expect(formatDecidedLine({ id: ref.id, verdict: 'already_fixed' })).toBe('· #a1b2c3d4 → already fixed')
    expect(formatDecidedLine({ id: ref.id, verdict: 'plan_drift' })).toBe('! #a1b2c3d4 → plan drift')
    expect(formatDecidedLine({ id: ref.id, verdict: 'no_commit' })).toBe('· #a1b2c3d4 → no change')
  })
  test('appends note in parentheses', () => {
    expect(formatDecidedLine({ id: ref.id, verdict: 'needs_human', note: 'merge conflict' })).toBe(
      '! #a1b2c3d4 → needs human (merge conflict)',
    )
  })
  test('unknown verdict falls back to dot mark and raw verdict', () => {
    expect(formatDecidedLine({ id: ref.id, verdict: 'mystery' })).toBe('· #a1b2c3d4 → mystery')
  })
})

describe('groupForStatus', () => {
  test('maps ledger statuses to report groups', () => {
    expect(groupForStatus('needs_human')).toBe('needsHuman')
    expect(groupForStatus('closed')).toBe('fixed')
    expect(groupForStatus('rejected')).toBe('rejected')
    expect(groupForStatus('already_fixed')).toBe('alreadyFixed')
    expect(groupForStatus('discovered')).toBe('open')
    expect(groupForStatus('verified')).toBe('open')
    expect(groupForStatus('fixed_pending_review')).toBe('open')
    expect(groupForStatus('reopened')).toBe('open')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/review-loop/issue-format.test.ts`
Expected: FAIL — module `../../review-loop/src/issue-format.js` not found.

- [ ] **Step 3: Write the implementation**

Create `review-loop/src/issue-format.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { LedgerIssueStatus } from './issue-ledger.js'

const CHECK = '✓'
const CROSS = '✗'
const DOT = '·'
const BANG = '!'

export function shortIssueId(id: string): string {
  return id.slice(0, 8)
}

export interface IssueRef {
  id: string
  severity: string
  file: string
  line: number
  title: string
}

export function formatIssueRef(ref: IssueRef): string {
  return `#${shortIssueId(ref.id)} ${`[${ref.severity}]`.padEnd(10)} ${ref.file}:${ref.line} — ${ref.title}`
}

export function formatFoundLine(ref: IssueRef): string {
  return `  + ${formatIssueRef(ref)}`
}

const DECIDED_MARK: Record<string, string> = {
  fixed: CHECK,
  invalid: CROSS,
  already_fixed: DOT,
  needs_human: BANG,
  plan_drift: BANG,
  no_commit: DOT,
}

const DECIDED_LABEL: Record<string, string> = {
  fixed: 'fixed',
  invalid: 'rejected',
  already_fixed: 'already fixed',
  needs_human: 'needs human',
  plan_drift: 'plan drift',
  no_commit: 'no change',
}

export function formatDecidedLine(args: { id: string; verdict: string; note?: string }): string {
  const mark = DECIDED_MARK[args.verdict] ?? DOT
  const label = DECIDED_LABEL[args.verdict] ?? args.verdict
  const note = args.note === undefined ? '' : ` (${args.note})`
  return `${mark} #${shortIssueId(args.id)} → ${label}${note}`
}

export type IssueGroup = 'needsHuman' | 'fixed' | 'rejected' | 'alreadyFixed' | 'open'

export const GROUP_ORDER: readonly IssueGroup[] = ['needsHuman', 'fixed', 'rejected', 'alreadyFixed', 'open']

export const GROUP_LABEL: Record<IssueGroup, string> = {
  needsHuman: 'needs human',
  fixed: 'fixed',
  rejected: 'rejected',
  alreadyFixed: 'already fixed',
  open: 'open',
}

export const GROUP_MARK: Record<IssueGroup, string> = {
  needsHuman: BANG,
  fixed: CHECK,
  rejected: CROSS,
  alreadyFixed: DOT,
  open: DOT,
}

export function groupForStatus(status: LedgerIssueStatus): IssueGroup {
  switch (status) {
    case 'needs_human':
      return 'needsHuman'
    case 'closed':
      return 'fixed'
    case 'rejected':
      return 'rejected'
    case 'already_fixed':
      return 'alreadyFixed'
    default:
      return 'open'
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/review-loop/issue-format.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add review-loop/src/issue-format.ts tests/review-loop/issue-format.test.ts
git commit -m "feat(review-loop): add shared issue line formatting module"
```

---

### Task 2: Reporter seam + LiveRenderer counters and status suffix

**Files:**
- Modify: `review-loop/src/progress-log.ts` (add `IssueProgressEvent`, optional `issue()`/`statusSuffix()`)
- Modify: `review-loop/src/live-renderer.ts` (`formatLiveLine` suffix param, `withLivePhase` suffix, `LiveRenderer.issue()`/`statusSuffix()` + counter bag)
- Modify: `review-loop/src/line-handler.ts` (append `statusSuffix()` in `renderLive`)
- Test: `tests/review-loop/live-renderer.test.ts`

**Interfaces:**
- Consumes: `formatFoundLine`, `formatDecidedLine` from `./issue-format.js` (Task 1); `Severity` type from `./trace-log.js`.
- Produces (used by Tasks 3–4):
  - `IssueProgressEvent` (from `progress-log.js`):
    ```typescript
    type IssueProgressEvent =
      | { type: 'round'; round: number; maxRounds: number }
      | { type: 'found'; id: string; severity: Severity; file: string; line: number; title: string }
      | { type: 'decided'; id: string; verdict: string; title: string; note?: string }
    ```
  - `ProgressReporter.issue?(event: IssueProgressEvent): void`
  - `ProgressReporter.statusSuffix?(): string` — returns e.g. `round 1/3 · issues: 2 open · 1 fixed`, or `''` when nothing to show.
  - `formatLiveLine(label, tool, arg, elapsedMs, toolCount, status = '')` — new optional 6th param; appended as ` · <status>` when non-empty.

- [ ] **Step 1: Write the failing tests**

Append to `tests/review-loop/live-renderer.test.ts` (imports already exist there for `formatLiveLine`, `LiveRenderer`; add nothing new at import level — both are already imported):

```typescript
function makeStream(): { stream: RendererStream; output: string[] } {
  const output: string[] = []
  return {
    output,
    stream: {
      write(chunk: string): boolean {
        output.push(chunk)
        return true
      },
      isTTY: false,
    },
  }
}

describe('formatLiveLine status suffix', () => {
  test('appends status after tool count when provided', () => {
    const line = formatLiveLine('fixer', 'read', 'cli.ts', 5000, 3, 'round 1/3 · issues: 2 open')
    expect(line).toContain('3 tools · round 1/3 · issues: 2 open')
  })
  test('omits suffix segment when status is empty', () => {
    const line = formatLiveLine('fixer', 'read', 'cli.ts', 5000, 3)
    expect(line).toContain('3 tools')
    expect(line).not.toContain('round')
  })
})

describe('LiveRenderer.issue', () => {
  test('found events print an indented plus line', () => {
    const { stream, output } = makeStream()
    const renderer = new LiveRenderer(stream)
    renderer.issue({
      type: 'found',
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      severity: 'high',
      file: 'src/auth/login.ts',
      line: 42,
      title: 'Token refresh race on 401',
    })
    expect(output).toContain('  + #a1b2c3d4 [high]     src/auth/login.ts:42 — Token refresh race on 401\n')
  })

  test('decided events print a mark line with note', () => {
    const { stream, output } = makeStream()
    const renderer = new LiveRenderer(stream)
    renderer.issue({ type: 'decided', id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', verdict: 'needs_human', title: 't', note: 'merge conflict' })
    expect(output).toContain('! #a1b2c3d4 → needs human (merge conflict)\n')
  })
})

describe('LiveRenderer.statusSuffix', () => {
  test('is empty before any events', () => {
    const { stream } = makeStream()
    expect(new LiveRenderer(stream).statusSuffix()).toBe('')
  })

  test('shows round after a round event', () => {
    const { stream } = makeStream()
    const renderer = new LiveRenderer(stream)
    renderer.issue({ type: 'round', round: 2, maxRounds: 5 })
    expect(renderer.statusSuffix()).toBe('round 2/5')
  })

  test('counts found and decided issues, omitting zero segments', () => {
    const { stream } = makeStream()
    const renderer = new LiveRenderer(stream)
    renderer.issue({ type: 'round', round: 1, maxRounds: 3 })
    renderer.issue({ type: 'found', id: 'aaaaaaaa-0000-0000-0000-000000000000', severity: 'low', file: 'a.ts', line: 1, title: 'A' })
    renderer.issue({ type: 'found', id: 'bbbbbbbb-0000-0000-0000-000000000000', severity: 'low', file: 'b.ts', line: 2, title: 'B' })
    renderer.issue({ type: 'decided', id: 'aaaaaaaa-0000-0000-0000-000000000000', verdict: 'fixed', title: 'A' })
    expect(renderer.statusSuffix()).toBe('round 1/3 · issues: 1 open · 1 fixed')
  })

  test('decided on an empty pending count does not go negative', () => {
    const { stream } = makeStream()
    const renderer = new LiveRenderer(stream)
    renderer.issue({ type: 'decided', id: 'aaaaaaaa-0000-0000-0000-000000000000', verdict: 'invalid', title: 'A' })
    expect(renderer.statusSuffix()).toBe('issues: 1 rejected')
  })
})
```

Note: `RendererStream` is already exported from `live-renderer.ts`; add it to the existing import in the test file:

```typescript
import {
  formatDuration,
  formatLiveLine,
  formatStepFooter,
  formatToolArg,
  LiveRenderer,
  type RendererStream,
} from '../../review-loop/src/live-renderer.js'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/review-loop/live-renderer.test.ts`
Expected: FAIL — `formatLiveLine` ignores the 6th argument; `LiveRenderer.issue`/`statusSuffix` do not exist (type errors / not-a-function).

- [ ] **Step 3: Implement the seam**

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

export interface ProgressReporter {
  readonly dynamic: boolean
  event(message: string): void
  live(lines: readonly string[]): void
  clearLive(): void
  log(message: string): void
  issue?(event: IssueProgressEvent): void
  statusSuffix?(): string
}
```

In `review-loop/src/live-renderer.ts`:

1. Add imports at the top (after the existing `path` import):

```typescript
import { formatDecidedLine, formatFoundLine } from './issue-format.js'
import type { IssueProgressEvent, ProgressReporter } from './progress-log.js'
```

(The file already imports `type { ProgressReporter }` from `'./progress-log.js'` — merge `IssueProgressEvent` into that existing import instead of adding a duplicate line.)

2. Change `formatLiveLine` to accept the optional suffix:

```typescript
export function formatLiveLine(
  label: string,
  tool: string,
  arg: string,
  elapsedMs: number,
  toolCount: number,
  status = '',
): string {
  const toolPart = tool === '' ? 'thinking' : arg === '' ? tool : `${tool} ${arg}`
  const tools = `${toolCount} tool${toolCount === 1 ? '' : 's'}`
  const suffix = status === '' ? '' : ` ${MIDDLE_DOT} ${status}`
  return `  ${label.padEnd(10)} ${ARROW} ${toolPart} ${MIDDLE_DOT} ${formatDuration(elapsedMs)} ${MIDDLE_DOT} ${tools}${suffix}`
}
```

3. In `withLivePhase`, include the suffix in the tick:

```typescript
    timer = setInterval(() => {
      const status = reporter.statusSuffix?.() ?? ''
      const suffix = status === '' ? '' : ` ${MIDDLE_DOT} ${status}`
      reporter.live([`[${label}] ${formatDuration(Date.now() - start)}...${suffix}`])
    }, 1000)
```

4. Add counter state and the two methods to `LiveRenderer` (inside the class, after the `liveActive` field / before `event`):

```typescript
  private round = 0
  private maxRounds = 0
  private readonly counts = { open: 0, fixed: 0, rejected: 0, needsHuman: 0 }

  issue(event: IssueProgressEvent): void {
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
        return
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
    if (segments.length > 0) parts.push(`issues: ${segments.join(' · ')}`)
    return parts.join(' · ')
  }
```

Note: `formatFoundLine(event)` works because the `found` event carries exactly `IssueRef`'s fields (`id`, `severity`, `file`, `line`, `title`); the extra `type` property is structurally compatible since `event` is not an object literal at that call site. Same for `formatDecidedLine(event)` (`id`, `verdict`, `note?`).

In `review-loop/src/line-handler.ts`, update `renderLive` to append the suffix:

```typescript
function renderLive(ctx: LiveCtx): void {
  const reporter = ctx.reporter
  if (reporter === undefined) {
    return
  }
  const elapsed = ctx.startedAt === 0 ? 0 : Date.now() - ctx.startedAt
  reporter.live([formatLiveLine(ctx.label, ctx.tool, ctx.arg, elapsed, ctx.toolCount, reporter.statusSuffix?.() ?? '')])
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/review-loop/live-renderer.test.ts tests/review-loop/line-handler.test.ts`
Expected: PASS (new tests pass; existing line-handler tests unaffected because fake reporters without `statusSuffix` produce `''`).

- [ ] **Step 5: Typecheck**

Run: `bun run review-loop:typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add review-loop/src/progress-log.ts review-loop/src/live-renderer.ts review-loop/src/line-handler.ts tests/review-loop/live-renderer.test.ts
git commit -m "feat(review-loop): add issue event seam and live status counters to reporter"
```

---

### Task 3: Emit issue events from the loop and processors

**Files:**
- Modify: `review-loop/src/loop-controller.ts` (round event at round start; found events after match; remove `[round N] Found M issues` log)
- Modify: `review-loop/src/issue-processor-attempts.ts` (3 `log.log` decision strings → `issue()` events; drop now-unused `shortTitle` import)
- Modify: `review-loop/src/issue-processor.ts` (1 catch-all decision string → `issue()` event)
- Modify: `review-loop/src/commit-attempt.ts` (3 decision strings → `issue()` events)
- Test: `tests/review-loop/progress-log.test.ts` (fake reporter learns `issue()`; assertions updated)

**Interfaces:**
- Consumes: `ProgressReporter.issue?` + `IssueProgressEvent` (Task 2); `formatFoundLine`, `formatDecidedLine` (Task 1, test-side only).
- Produces: no new exports. Behavioral contract: every ledger-affecting decision emits exactly one `decided` event; every newly created ledger record emits exactly one `found` event; each round emits one `round` event at start.

- [ ] **Step 1: Update the failing tests first**

In `tests/review-loop/progress-log.test.ts`:

1. Extend the imports:

```typescript
import { formatDecidedLine, formatFoundLine } from '../../review-loop/src/issue-format.js'
import type { IssueProgressEvent } from '../../review-loop/src/progress-log.js'
```

2. Extend `makeReporter` (around line 127) with an `issue` method:

```typescript
function makeReporter(messages: string[]): ProgressReporter {
  return {
    dynamic: false,
    event: (message: string): void => {
      messages.push(message)
    },
    live: (lines: readonly string[]): void => {
      for (const line of lines) {
        messages.push(line)
      }
    },
    clearLive() {},
    log: (message: string): void => {
      messages.push(message)
    },
    issue: (event: IssueProgressEvent): void => {
      if (event.type === 'found') {
        messages.push(formatFoundLine(event))
      } else if (event.type === 'decided') {
        messages.push(formatDecidedLine(event))
      }
    },
  }
}
```

3. In the test `'logs round start, issue discovery, verification, fix, and done for a clean round'`, replace these two assertions:

```typescript
    expect(messages).toContain('[round 1] Found 1 issues')
    expect(messages.some((m) => m.startsWith('[fix] "Missing error handling"'))).toBe(true)
```

with:

```typescript
    expect(messages.some((m) => m.startsWith('  + #') && m.includes('src/foo.ts:10 — Missing error handling'))).toBe(true)
    expect(messages.some((m) => m.startsWith('✓ #') && m.endsWith('→ fixed'))).toBe(true)
```

4. In the test `'truncates long issue titles in log output'`, the `[fix]` line no longer exists; the decided line carries no title. Replace:

```typescript
    const fixMessage = messages.find((m) => m.startsWith('[fix]'))
    expect(fixMessage).toBeDefined()
    expect(fixMessage!.length).toBeLessThan(longTitle.length + 40)
```

with:

```typescript
    const decidedMessage = messages.find((m) => m.startsWith('✗ #') && m.endsWith('→ rejected'))
    expect(decidedMessage).toBeDefined()
    expect(decidedMessage!.length).toBeLessThan(40)
```

Also rename that test to `'decided lines stay short regardless of title length'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/review-loop/progress-log.test.ts`
Expected: FAIL — no `  + #` / `✓ #` lines are emitted yet (old `[round 1] Found 1 issues` line still present, but the new assertions look for the new shapes).

- [ ] **Step 3: Emit events from loop-controller**

In `review-loop/src/loop-controller.ts`:

1. In `runRound`, right after `await saveRunState(deps.runState)` at the top, emit the round event:

```typescript
  deps.runState.currentRound = round
  await saveRunState(deps.runState)
  deps.log.issue?.({ type: 'round', round, maxRounds: deps.config.maxRounds })
```

2. In `runMatchAndRecord`, after `await saveIssueLedger(deps.ledger)` and before the `return`, emit found events for newly created records:

```typescript
  for (const match of matches) {
    if (match.existingId !== null) continue
    const record = roundRecords[match.newIssueIndex]
    if (record === undefined) continue
    deps.log.issue?.({
      type: 'found',
      id: record.id,
      severity: record.issue.severity,
      file: record.issue.file,
      line: record.issue.lineStart,
      title: record.issue.title,
    })
  }
```

(`roundRecords` is pushed in issue-index order by `applyMatchedIssues`, so `roundRecords[match.newIssueIndex]` is the record for that issue.)

3. Delete the count log line in `runRound` (per-issue lines replace it):

```typescript
  deps.log.log(`[round ${round}] Found ${newIssues.length} issues`)
```

(The `[round ${round}] Fixed …` and `[done] …` logs stay.)

- [ ] **Step 4: Emit decided events from the processors**

In `review-loop/src/issue-processor-attempts.ts`:

1. In `runFixerAttempt`, replace:

```typescript
    deps.log.log(`[fix] "${shortTitle(record)}" → ${fixerResult.verdict}`)
```

with:

```typescript
    deps.log.issue?.({ type: 'decided', id: record.id, verdict: fixerResult.verdict, title: record.issue.title })
```

2. In `runBuildAttempt`, replace:

```typescript
      deps.log.log(`[fix] "${shortTitle(record)}" → needs_human (build failed)`)
```

with:

```typescript
      deps.log.issue?.({
        type: 'decided',
        id: record.id,
        verdict: 'needs_human',
        title: record.issue.title,
        note: 'build failed',
      })
```

3. In `runInspectorAttempt`, replace:

```typescript
      deps.log.log(
        `[fix] "${shortTitle(record)}" → needs_human (${unavailable ? 'inspector unavailable' : 'inspector rejected'})`,
      )
```

with:

```typescript
      deps.log.issue?.({
        type: 'decided',
        id: record.id,
        verdict: 'needs_human',
        title: record.issue.title,
        note: unavailable ? 'inspector unavailable' : 'inspector rejected',
      })
```

4. Remove `shortTitle` from the import of `'./issue-processor.js'` (it is now unused in this file), leaving `import { type IssueProcessorDeps } from './issue-processor.js'`.

In `review-loop/src/issue-processor.ts`, in `makeDispatcher`'s catch block, replace:

```typescript
      deps.log.log(`[fix] "${shortTitle(record)}" → needs_human (issue processing failed: ${msg})`)
```

with:

```typescript
      deps.log.issue?.({
        type: 'decided',
        id: record.id,
        verdict: 'needs_human',
        title: record.issue.title,
        note: `issue processing failed: ${msg}`,
      })
```

(The `ledger save failed` `log.log` in the second catch block stays — it is a warning, not a decision. `shortTitle` is still used there, so keep the function.)

In `review-loop/src/commit-attempt.ts`:

1. In the no-change branch, replace:

```typescript
      deps.log.log(`[fix] "${shortTitle(record)}" → no change (fixed:true was a false claim)`)
```

with:

```typescript
      deps.log.issue?.({
        type: 'decided',
        id: record.id,
        verdict: 'no_commit',
        title: record.issue.title,
        note: 'fixed:true was a false claim',
      })
```

2. In the merge-conflict branch, replace:

```typescript
      deps.log.log(`[fix] "${shortTitle(record)}" → needs_human (merge conflict)`)
```

with:

```typescript
      deps.log.issue?.({
        type: 'decided',
        id: record.id,
        verdict: 'needs_human',
        title: record.issue.title,
        note: 'merge conflict',
      })
```

3. In the success branch, replace:

```typescript
    deps.log.log(
      attempt === 1 ? `[fix] "${shortTitle(record)}" → fixed` : `[fix] "${shortTitle(record)}" → fixed (after retry)`,
    )
```

with:

```typescript
    deps.log.issue?.({
      type: 'decided',
      id: record.id,
      verdict: 'fixed',
      title: record.issue.title,
      note: attempt === 1 ? undefined : 'after retry',
    })
```

(The `auto-committed uncommitted changes` `log.log` in `ensureFixerChangesCommitted` stays — informational, not a decision — so the `shortTitle` import stays.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/review-loop/progress-log.test.ts tests/review-loop/loop-controller.test.ts tests/review-loop/issue-processor.test.ts tests/review-loop/issue-processor-attempts.test.ts tests/review-loop/commit-attempt.test.ts tests/review-loop/issue-processor-save-serialization.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + full workspace suite**

Run: `bun run review-loop:typecheck && bun run review-loop:test`
Expected: clean typecheck; full suite green.

- [ ] **Step 7: Commit**

```bash
git add review-loop/src/loop-controller.ts review-loop/src/issue-processor-attempts.ts review-loop/src/issue-processor.ts review-loop/src/commit-attempt.ts tests/review-loop/progress-log.test.ts
git commit -m "feat(review-loop): stream per-issue found/decided events instead of fix log strings"
```

---

### Task 4: Verdict-first final report (`summary.ts` rewrite + CLI wiring)

**Files:**
- Modify: `review-loop/src/summary.ts` (rewrite `buildSummary`; keep `buildMetricsJson`, `MetricsJson`, `SummaryOptions` and the aggregation helpers)
- Modify: `review-loop/src/cli.ts` (`writeRunArtifacts` passes ledger + runDir via the new input object)
- Test: `tests/review-loop/summary.test.ts` (rewritten)
- Test: `tests/review-loop/cli.test.ts` (two assertion updates)

**Interfaces:**
- Consumes: `formatIssueRef`, `GROUP_LABEL`, `GROUP_MARK`, `GROUP_ORDER`, `groupForStatus`, `IssueGroup` from `./issue-format.js` (Task 1); `formatDuration` from `./live-renderer.js`; `IssueLedgerSnapshot`, `LedgerIssueRecord` from `./issue-ledger.js`.
- Produces:
  - `SummaryInput` — `{ doneReason: ReviewLoopResult['doneReason']; rounds: number; metrics: readonly RoundMetric[]; ledger: IssueLedgerSnapshot; runDir: string; options: SummaryOptions }`.
  - `buildSummary(input: SummaryInput): string` — NEW signature (positional args gone).
  - `buildMetricsJson(doneReason, rounds, closed, metrics, options): MetricsJson` — UNCHANGED signature and behavior.

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `tests/review-loop/summary.test.ts` with:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { IssueLedgerSnapshot, LedgerIssueRecord } from '../../review-loop/src/issue-ledger.js'
import type { ReviewerIssue } from '../../review-loop/src/issue-schema.js'
import { buildMetricsJson, buildSummary, type SummaryInput } from '../../review-loop/src/summary.js'
import type { RoundMetric } from '../../review-loop/src/trace-log.js'

const issueFixture: ReviewerIssue = {
  title: 'Token refresh race on 401',
  severity: 'high',
  summary: 's',
  whyItMatters: 'w',
  evidence: 'e',
  file: 'src/auth/login.ts',
  lineStart: 42,
  lineEnd: 50,
  suggestedFix: 'f',
  confidence: 0.9,
}

let idCounter = 0
beforeEach(() => {
  idCounter = 0
})

function makeRecord(status: LedgerIssueRecord['status'], overrides?: Partial<ReviewerIssue>): LedgerIssueRecord {
  idCounter += 1
  return {
    id: `${String(idCounter).padStart(8, '0')}-0000-0000-0000-000000000000`,
    issue: { ...issueFixture, ...overrides },
    status,
    firstSeenRound: 1,
    latestSeenRound: 1,
    fixAttempts: 0,
    verifierDecision: null,
  }
}

function ledgerOf(...records: LedgerIssueRecord[]): IssueLedgerSnapshot {
  const issues: Record<string, LedgerIssueRecord> = {}
  for (const record of records) {
    issues[record.id] = record
  }
  return { issues }
}

function zeroMetric(round: number): RoundMetric {
  return {
    round,
    newIssues: 0,
    cumulativeOpen: 0,
    noProgressRounds: 0,
    decisions: { fixed: 0, invalid: 0, already_fixed: 0, needs_human: 0, plan_drift: 0, no_commit: 0, inspector_rejected: 0 },
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

function inputOf(overrides?: Partial<SummaryInput>): SummaryInput {
  return {
    doneReason: 'clean',
    rounds: 1,
    metrics: [],
    ledger: { issues: {} },
    runDir: '/repo/.review-loop/runs/run-1',
    options: { poolSize: 1, inspect: false },
    ...overrides,
  }
}

describe('buildSummary verdict', () => {
  test('clean run with no issues and one round', () => {
    const summary = buildSummary(inputOf({ metrics: [zeroMetric(1)] }))
    expect(summary).toContain('Review loop finished: clean — reviewer found no issues in 1 round.')
    expect(summary).not.toContain('Issues:')
  })

  test('done run lists the non-zero breakdown', () => {
    const ledger = ledgerOf(
      makeRecord('closed'),
      makeRecord('closed'),
      makeRecord('closed'),
      makeRecord('needs_human'),
      makeRecord('rejected'),
    )
    const summary = buildSummary(inputOf({ doneReason: 'max_rounds', rounds: 2, ledger }))
    expect(summary).toContain('Review loop finished: done — 5 issues: 3 fixed, 1 needs human, 1 rejected.')
  })

  test('issues remaining leads with the open count', () => {
    const ledger = ledgerOf(makeRecord('closed'), makeRecord('verified'), makeRecord('discovered'))
    const summary = buildSummary(inputOf({ doneReason: 'no_progress', rounds: 3, ledger }))
    expect(summary).toContain('Review loop finished: issues remaining — 2 open (1 fixed).')
  })
})

describe('buildSummary zero suppression', () => {
  test('drops zero wall-clock phases from the duration breakdown', () => {
    const summary = buildSummary(inputOf({ metrics: [busyMetric(1)] }))
    expect(summary).toContain('(review 178.3s)')
    expect(summary).not.toContain('match 0.0s')
    expect(summary).not.toContain('fix 0.0s')
  })

  test('omits the burndown table for a single all-zero round', () => {
    const summary = buildSummary(inputOf({ metrics: [zeroMetric(1)] }))
    expect(summary).not.toContain('Burndown:')
  })

  test('keeps the burndown table when a round has activity', () => {
    const summary = buildSummary(inputOf({ metrics: [busyMetric(1)] }))
    expect(summary).toContain('Burndown:')
    expect(summary).toContain('round')
  })
})

describe('buildSummary timing and cost', () => {
  test('renders duration, nonzero phases, and cost on one line', () => {
    const summary = buildSummary(inputOf({ metrics: [busyMetric(1)] }))
    expect(summary).toContain(
      'Duration: 2m58s (review 178.3s) · Cost: $1.234 (in 120000 / out 8000 / reasoning 3000)',
    )
  })
})

describe('buildSummary rounds and pool line', () => {
  test('omitted for a single round with pool size 1', () => {
    const summary = buildSummary(inputOf())
    expect(summary).not.toContain('Rounds:')
  })
  test('included when rounds > 1 or pool > 1', () => {
    expect(buildSummary(inputOf({ rounds: 2 }))).toContain('Rounds: 2')
    expect(buildSummary(inputOf({ options: { poolSize: 4, inspect: false } }))).toContain('Rounds: 1 · Pool: 4')
  })
})

describe('buildSummary issue groups', () => {
  test('groups in order with marks and issue refs', () => {
    const ledger = ledgerOf(
      makeRecord('closed', { title: 'Fixed one' }),
      makeRecord('needs_human', { title: 'Scary one', severity: 'critical' }),
      makeRecord('rejected', { title: 'Bogus one', severity: 'low' }),
    )
    const summary = buildSummary(inputOf({ rounds: 2, ledger }))
    const needsIdx = summary.indexOf('  needs human (1):')
    const fixedIdx = summary.indexOf('  fixed (1):')
    const rejectedIdx = summary.indexOf('  rejected (1):')
    expect(needsIdx).toBeGreaterThan(-1)
    expect(needsIdx).toBeLessThan(fixedIdx)
    expect(fixedIdx).toBeLessThan(rejectedIdx)
    expect(summary).toContain('! #00000002 [critical] src/auth/login.ts:42 — Scary one')
    expect(summary).toContain('✓ #00000001 [high]     src/auth/login.ts:42 — Fixed one')
    expect(summary).toContain('✗ #00000003 [low]      src/auth/login.ts:42 — Bogus one')
  })

  test('caps a group at 20 lines with a see-ledger note', () => {
    const records = Array.from({ length: 21 }, () => makeRecord('needs_human'))
    const summary = buildSummary(inputOf({ rounds: 2, ledger: ledgerOf(...records) }))
    expect(summary).toContain('  needs human (21):')
    expect(summary).toContain('    …and 1 more (see ledger.json)')
    const bangLines = summary.split('\n').filter((l) => l.startsWith('    ! #'))
    expect(bangLines).toHaveLength(20)
  })

  test('open bucket appears only when issues are left open', () => {
    const summary = buildSummary(inputOf({ doneReason: 'max_rounds', rounds: 2, ledger: ledgerOf(makeRecord('verified')) }))
    expect(summary).toContain('  open (1):')
    expect(summary).toContain('· #00000001')
  })
})

describe('buildSummary artifacts', () => {
  test('always lists the run dir and known artifact files', () => {
    const summary = buildSummary(inputOf())
    expect(summary).toContain('Artifacts (/repo/.review-loop/runs/run-1):')
    expect(summary).toContain('summary.txt · metrics.json · ledger.json · trace.jsonl · agent-output.log · state.json')
  })
})

describe('buildMetricsJson', () => {
  test('keeps the existing shape', () => {
    const json = buildMetricsJson('max_rounds', 2, 1, [busyMetric(1)], { poolSize: 1, inspect: false })
    expect(json.doneReason).toBe('max_rounds')
    expect(json.rounds).toBe(2)
    expect(json.totals.closed).toBe(1)
    expect(json.usage.inputTokens).toBe(120_000)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/review-loop/summary.test.ts`
Expected: FAIL — `buildSummary` still takes positional args / `SummaryInput` not exported.

- [ ] **Step 3: Rewrite summary.ts**

Replace the entire contents of `review-loop/src/summary.ts` with:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { IssueLedgerSnapshot, LedgerIssueRecord } from './issue-ledger.js'
import {
  formatIssueRef,
  GROUP_LABEL,
  GROUP_MARK,
  GROUP_ORDER,
  groupForStatus,
  type IssueGroup,
} from './issue-format.js'
import { formatDuration } from './live-renderer.js'
import type { ReviewLoopResult } from './loop-controller.js'
import type { PhaseMs, RoundMetric, Severity, SeverityCounts, UsageTotals } from './trace-log.js'

const SEV_WEIGHT: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 }

const PHASE_KEYS: (keyof PhaseMs)[] = ['review', 'match', 'verify', 'build', 'inspect', 'fix']

const GROUP_CAP = 20

const RUN_ARTIFACTS = ['summary.txt', 'metrics.json', 'ledger.json', 'trace.jsonl', 'agent-output.log', 'state.json']

export interface MetricsJson {
  doneReason: ReviewLoopResult['doneReason']
  rounds: number
  poolSize: number
  burndown: RoundMetric[]
  usage: UsageTotals
  phaseMs: PhaseMs
  totals: {
    open: number
    closed: number
    rejected: number
    alreadyFixed: number
    needsHuman: number
    reopened: number
    inspectorRejected: number
  }
}

export interface SummaryOptions {
  poolSize: number
  inspect: boolean
}

export interface SummaryInput {
  doneReason: ReviewLoopResult['doneReason']
  rounds: number
  metrics: readonly RoundMetric[]
  ledger: IssueLedgerSnapshot
  runDir: string
  options: SummaryOptions
}

interface IssueCounts {
  open: number
  fixed: number
  rejected: number
  needsHuman: number
  alreadyFixed: number
}

function countIssues(ledger: IssueLedgerSnapshot): IssueCounts {
  const counts: IssueCounts = { open: 0, fixed: 0, rejected: 0, needsHuman: 0, alreadyFixed: 0 }
  for (const record of Object.values(ledger.issues)) {
    switch (groupForStatus(record.status)) {
      case 'needsHuman':
        counts.needsHuman += 1
        break
      case 'fixed':
        counts.fixed += 1
        break
      case 'rejected':
        counts.rejected += 1
        break
      case 'alreadyFixed':
        counts.alreadyFixed += 1
        break
      case 'open':
        counts.open += 1
        break
    }
  }
  return counts
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function breakdownParts(counts: IssueCounts): string[] {
  const parts: string[] = []
  if (counts.fixed > 0) parts.push(`${counts.fixed} fixed`)
  if (counts.needsHuman > 0) parts.push(`${counts.needsHuman} needs human`)
  if (counts.rejected > 0) parts.push(`${counts.rejected} rejected`)
  if (counts.alreadyFixed > 0) parts.push(`${counts.alreadyFixed} already fixed`)
  return parts
}

function buildVerdict(input: SummaryInput, counts: IssueCounts, total: number): string {
  const breakdown = breakdownParts(counts).join(', ')
  if (counts.open > 0) {
    const suffix = breakdown === '' ? '' : ` (${breakdown})`
    return `Review loop finished: issues remaining — ${counts.open} open${suffix}.`
  }
  if (total === 0) {
    return `Review loop finished: clean — reviewer found no issues in ${plural(input.rounds, 'round')}.`
  }
  return `Review loop finished: done — ${plural(total, 'issue')}: ${breakdown}.`
}

function sumDecisions(metrics: readonly RoundMetric[], key: keyof RoundMetric['decisions']): number {
  return metrics.reduce((s, m) => s + m.decisions[key], 0)
}

function avgSeverity(counts: SeverityCounts, total: number): string {
  if (total === 0) return '-'
  const sum =
    counts.critical * SEV_WEIGHT.critical +
    counts.high * SEV_WEIGHT.high +
    counts.medium * SEV_WEIGHT.medium +
    counts.low * SEV_WEIGHT.low
  return (sum / total).toFixed(1)
}

function burndownBlock(metrics: readonly RoundMetric[]): string {
  const header = '  round  new  open  fixed  rejected  needs_human  plan_drift  insp_rej  avgRev  avgFix'
  const rows = metrics.map((m) => {
    const decided =
      m.decisions.fixed +
      m.decisions.invalid +
      m.decisions.already_fixed +
      m.decisions.needs_human +
      m.decisions.plan_drift +
      m.decisions.no_commit +
      m.decisions.inspector_rejected
    return [
      `  ${String(m.round).padEnd(6)}`,
      String(m.newIssues).padEnd(4),
      String(m.cumulativeOpen).padEnd(5),
      String(m.decisions.fixed).padEnd(6),
      String(m.decisions.invalid).padEnd(9),
      String(m.decisions.needs_human).padEnd(12),
      String(m.decisions.plan_drift).padEnd(11),
      String(m.decisions.inspector_rejected).padEnd(9),
      avgSeverity(m.reviewerSeverity, m.newIssues).padEnd(7),
      avgSeverity(m.fixerSeverity, decided),
    ].join('')
  })
  return ['Burndown:', header, ...rows].join('\n')
}

function burndownIsEmpty(metrics: readonly RoundMetric[]): boolean {
  return metrics.every(
    (m) =>
      m.newIssues === 0 &&
      m.cumulativeOpen === 0 &&
      m.decisions.fixed === 0 &&
      m.decisions.invalid === 0 &&
      m.decisions.already_fixed === 0 &&
      m.decisions.needs_human === 0 &&
      m.decisions.plan_drift === 0 &&
      m.decisions.no_commit === 0 &&
      m.decisions.inspector_rejected === 0,
  )
}

function aggregatePhaseMs(metrics: readonly RoundMetric[]): PhaseMs {
  const phaseMs: PhaseMs = { review: 0, match: 0, verify: 0, build: 0, inspect: 0, fix: 0 }
  for (const m of metrics) {
    for (const k of PHASE_KEYS) {
      phaseMs[k] += m.phaseMs[k]
    }
  }
  return phaseMs
}

function aggregateUsage(metrics: readonly RoundMetric[]): UsageTotals {
  return metrics.reduce(
    (acc, m) => ({
      inputTokens: acc.inputTokens + m.usage.inputTokens,
      outputTokens: acc.outputTokens + m.usage.outputTokens,
      reasoningTokens: acc.reasoningTokens + m.usage.reasoningTokens,
      costUsd: acc.costUsd + m.usage.costUsd,
    }),
    { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0 },
  )
}

function msToSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

function buildTimingLine(metrics: readonly RoundMetric[]): string {
  const phaseMs = aggregatePhaseMs(metrics)
  const totalMs = PHASE_KEYS.reduce((s, k) => s + phaseMs[k], 0)
  const parts = PHASE_KEYS.filter((k) => phaseMs[k] > 0).map((k) => `${k} ${msToSeconds(phaseMs[k])}`)
  const breakdown = parts.length === 0 ? 'no phase timing recorded' : parts.join(', ')
  const usage = aggregateUsage(metrics)
  return `Duration: ${formatDuration(totalMs)} (${breakdown}) · Cost: $${usage.costUsd.toFixed(3)} (in ${usage.inputTokens} / out ${usage.outputTokens} / reasoning ${usage.reasoningTokens})`
}

function buildRoundsLine(input: SummaryInput): string | null {
  if (input.rounds <= 1 && input.options.poolSize <= 1) return null
  const pool = input.options.poolSize > 1 ? ` · Pool: ${input.options.poolSize}` : ''
  return `Rounds: ${input.rounds}${pool}`
}

function buildInspectorLine(metrics: readonly RoundMetric[], options: SummaryOptions): string | null {
  if (!options.inspect) return null
  const runs = metrics.reduce((s, m) => s + m.inspector.runs, 0)
  if (runs === 0) return null
  const rejected = metrics.reduce((s, m) => s + m.inspector.rejected, 0)
  const rate = `${((100 * rejected) / runs).toFixed(1)}%`
  return `Inspector: ${runs} runs, ${rejected} rejected (${rate} reject rate)`
}

function issuesBlock(ledger: IssueLedgerSnapshot): string[] {
  const records = Object.values(ledger.issues)
  if (records.length === 0) return []
  const groups = new Map<IssueGroup, LedgerIssueRecord[]>()
  for (const record of records) {
    const group = groupForStatus(record.status)
    groups.set(group, [...(groups.get(group) ?? []), record])
  }
  const lines = ['Issues:']
  for (const group of GROUP_ORDER) {
    const groupRecords = groups.get(group)
    if (groupRecords === undefined || groupRecords.length === 0) continue
    lines.push(`  ${GROUP_LABEL[group]} (${groupRecords.length}):`)
    for (const record of groupRecords.slice(0, GROUP_CAP)) {
      lines.push(
        `    ${GROUP_MARK[group]} ${formatIssueRef({
          id: record.id,
          severity: record.issue.severity,
          file: record.issue.file,
          line: record.issue.lineStart,
          title: record.issue.title,
        })}`,
      )
    }
    if (groupRecords.length > GROUP_CAP) {
      lines.push(`    …and ${groupRecords.length - GROUP_CAP} more (see ledger.json)`)
    }
  }
  return lines
}

function artifactsBlock(runDir: string): string[] {
  return [`Artifacts (${runDir}):`, `  ${RUN_ARTIFACTS.join(' · ')}`]
}

export function buildSummary(input: SummaryInput): string {
  const total = Object.keys(input.ledger.issues).length
  const counts = countIssues(input.ledger)
  const lines: string[] = [buildVerdict(input, counts, total), buildTimingLine(input.metrics)]

  const roundsLine = buildRoundsLine(input)
  if (roundsLine !== null) lines.push(roundsLine)

  const inspectorLine = buildInspectorLine(input.metrics, input.options)
  if (inspectorLine !== null) lines.push(inspectorLine)

  const issues = issuesBlock(input.ledger)
  if (issues.length > 0) lines.push('', ...issues)

  if (input.metrics.length > 0 && (input.metrics.length > 1 || !burndownIsEmpty(input.metrics))) {
    lines.push('', burndownBlock(input.metrics))
  }

  lines.push('', ...artifactsBlock(input.runDir))
  return lines.join('\n')
}

export function buildMetricsJson(
  doneReason: ReviewLoopResult['doneReason'],
  rounds: number,
  closed: number,
  metrics: readonly RoundMetric[],
  options: SummaryOptions,
): MetricsJson {
  const lastMetric = metrics.length > 0 ? metrics[metrics.length - 1] : undefined
  const openFromMetrics = lastMetric === undefined ? 0 : lastMetric.cumulativeOpen
  return {
    doneReason,
    rounds,
    poolSize: options.poolSize,
    burndown: [...metrics],
    usage: aggregateUsage(metrics),
    phaseMs: aggregatePhaseMs(metrics),
    totals: {
      open: openFromMetrics,
      closed,
      rejected: sumDecisions(metrics, 'invalid'),
      alreadyFixed: sumDecisions(metrics, 'already_fixed'),
      needsHuman: sumDecisions(metrics, 'needs_human'),
      reopened: 0,
      inspectorRejected: metrics.reduce((s, m) => s + m.inspector.rejected, 0),
    },
  }
}
```

Notes for the implementer:
- `StatusCounts`, `computeStatusLines`, and `computeObservabilityLines` are deleted; their information now lives in the verdict line, the timing line, and the inspector line.
- Open counting goes through `groupForStatus`; there is deliberately no separate `isOpenStatus` helper (removed pre-dispatch as unused, YAGNI).

- [ ] **Step 4: Wire the new signature in cli.ts**

In `review-loop/src/cli.ts`, replace the body of `writeRunArtifacts`:

```typescript
export async function writeRunArtifacts(
  runDir: string,
  result: ReviewLoopResult,
  options: { poolSize: number; inspect: boolean },
): Promise<void> {
  const closed = Object.values(result.ledger.issues).filter((r) => r.status === 'closed').length
  const summary = buildSummary({
    doneReason: result.doneReason,
    rounds: result.rounds,
    metrics: result.metrics ?? [],
    ledger: result.ledger,
    runDir,
    options,
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

(Signature and the metrics.json/writeFile logic are unchanged; only the `buildSummary` call changes.)

- [ ] **Step 5: Update cli.test.ts assertions**

In `tests/review-loop/cli.test.ts`:

1. In the test `'--pool-size overrides config.poolSize'` (~line 392), replace:

```typescript
    expect(summary).toContain('Pool size: 5')
```

with:

```typescript
    expect(summary).toContain('Pool: 5')
```

2. In the stale-worker-cleanup test (~line 533), replace:

```typescript
    expect(summary).toContain('needs_human')
```

with:

```typescript
    expect(summary).toContain('needs human')
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/review-loop/summary.test.ts tests/review-loop/cli.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck + full workspace suite**

Run: `bun run review-loop:typecheck && bun run review-loop:test`
Expected: clean; whole suite green (catches any other caller of the old `buildSummary` signature).

- [ ] **Step 8: Commit**

```bash
git add review-loop/src/summary.ts review-loop/src/cli.ts tests/review-loop/summary.test.ts tests/review-loop/cli.test.ts
git commit -m "feat(review-loop): verdict-first final report with issue groups and artifact paths"
```

---

## Self-Review Notes (already applied)

- **Spec coverage:** verdict line → Task 4 `buildVerdict`; zero suppression → `buildTimingLine`/`burndownIsEmpty`/group omission; issue groups + cap → `issuesBlock`; artifacts block → `artifactsBlock`; live found/decided lines → Tasks 2–3; status line counters → Task 2 `statusSuffix` + `renderLive`/`withLivePhase`; metrics.json untouched → `buildMetricsJson` preserved; error paths unchanged → no `finalizeRun` ordering change.
- **Deviations from the first approved spec draft (already synced into the spec file):** `issue()`/`statusSuffix()` are optional on `ProgressReporter`; a third `round` event variant carries round context; artifact filenames match reality (`trace.jsonl`, `agent-output.log`, `state.json`).
- **Type consistency:** `IssueProgressEvent`, `IssueRef`, `IssueGroup`, `SummaryInput` names are used identically across tasks.
