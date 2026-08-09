<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Single-Line Live Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scrolling per-step live output in review-loop/mutation-improve with one updating line per unit of work that freezes as a permanent summary line when the unit finishes.

**Architecture:** Add `commit(key, line?)` to the shared `ProgressReporter`/`LiveRenderer` (converts a slot's live line into a permanent scrolled line). `line-handler` stops emitting per-step footers, folds cumulative tokens into the live line, and commits on dispose (opt-out via `commitOnDispose: false`). mutation-improve runs all phases of an iteration under one constant slot key `'iter'` and commits one summary line per iteration from `runPipeline`.

**Tech Stack:** Bun, TypeScript, bun:test.

Spec: `docs/superpowers/specs/2026-08-09-single-line-live-renderer-design.md`

## Global Constraints

- Strict TypeScript; **use `.js` extension in import paths**.
- New source files need the license header:
  ```ts
  // SPDX-License-Identifier: BUSL-1.1
  // Copyright (c) 2026 Dmitriy Lazarev
  // Use of this software is governed by the Business Source License 1.1.
  // See LICENSE in the project root for details.
  ```
- Tests: `bun:test` runner, DI-first. Test lint forbids conditionals/`??` inside test bodies (`no-conditional-in-test`) — use non-null assertions (`output[0]!`) instead.
- TDD hooks map `review-loop/src/**` → `tests/review-loop/**` and `mutation-improve/src/**` → `tests/mutation-improve/**`. Write the failing test first.
- Never add lint-disable or type-ignore comments.
- Non-TTY behavior change is deliberate: `slot()`/`live()` intermediate updates become no-ops; only `event()`/`commit()` print.
- Run tests from repo root: `bun test tests/review-loop/<file>` / `bun test tests/mutation-improve/<file>`.

---

### Task 1: `commit(key, line?)` in the shared renderer

**Files:**
- Modify: `review-loop/src/progress-log.ts` (ProgressReporter interface, line ~24-36)
- Modify: `review-loop/src/live-renderer.ts` (add `commit`, change non-TTY `live()`)
- Test: `tests/review-loop/live-renderer.test.ts`

**Interfaces:**
- Consumes: existing `LiveRenderer` internals (`slots`, `clearBlock`, `renderBlock`, `writeSafe`, `touch`).
- Produces: `ProgressReporter.commit?(key: string, line?: string): void` — used by line-handler (Task 2) and mutation-improve pipeline (Task 3).

- [ ] **Step 1: Write the failing tests**

Append to `tests/review-loop/live-renderer.test.ts`:

```ts
describe('LiveRenderer commit', () => {
  test('non-TTY commit prints the line once', () => {
    const { stream, output } = makeStream()
    const r = new LiveRenderer(stream)
    r.slot('iter', '  improve    ▶ read a.ts')
    r.commit('iter', 'iter 1 ✓ improved · src/x.ts')
    expect(output).toEqual(['iter 1 ✓ improved · src/x.ts\n'])
  })

  test('non-TTY live() intermediate updates are suppressed', () => {
    const { stream, output } = makeStream()
    const r = new LiveRenderer(stream)
    r.live(['working'])
    r.live(['still working'])
    expect(output).toEqual([])
  })

  test('TTY commit freezes the slot content as a permanent line', () => {
    const { stream, output } = makeStream({ isTTY: true, columns: 120 })
    const r = new LiveRenderer(stream)
    r.slot('a', 'line-a')
    r.commit('a')
    expect(output[output.length - 1]).toBe('line-a\n')
  })

  test('TTY commit with a replacement line prints it instead of the slot content', () => {
    const { stream, output } = makeStream({ isTTY: true, columns: 120 })
    const r = new LiveRenderer(stream)
    r.slot('a', 'line-a')
    r.commit('a', 'iter 1 ✓ improved')
    const joined = output.join('')
    expect(output[output.length - 1]).toBe('iter 1 ✓ improved\n')
    expect(joined).not.toContain('line-a\n')
  })

  test('TTY commit with a line but no slot still prints it', () => {
    const { stream, output } = makeStream({ isTTY: true, columns: 120 })
    const r = new LiveRenderer(stream)
    r.commit('iter', 'iter 1 ✗ failed · exception: boom')
    expect(output).toEqual(['iter 1 ✗ failed · exception: boom\n'])
  })

  test('commit with neither slot nor line is a no-op', () => {
    const { stream, output } = makeStream({ isTTY: true, columns: 120 })
    const r = new LiveRenderer(stream)
    r.commit('missing')
    expect(output).toEqual([])
  })

  test('a slot opened after commit renders as a fresh live line', () => {
    const { stream, output } = makeStream({ isTTY: true, columns: 120 })
    const r = new LiveRenderer(stream)
    r.slot('a', 'line-a')
    r.commit('a')
    r.slot('a', 'line-b')
    const last = output[output.length - 1]!
    expect(last).toContain('line-b')
    expect(last.startsWith('\r')).toBe(true)
  })
})
```

Also update the two existing non-TTY `live()` tests (behavior intentionally changes):

Replace the test at line 54-58 (`'non-TTY live scrolls with newline'`) with:

```ts
  test('non-TTY live is a no-op', () => {
    const { output, stream } = makeStream()
    new LiveRenderer(stream).live(['x'])
    expect(output).toEqual([])
  })
```

Replace the test at line 86-99 (`'ProgressReporter.live accepts an array of lines (one per active worker)'`) with a TTY variant:

```ts
  test('ProgressReporter.live accepts an array of lines (one per active worker)', () => {
    const { stream, output } = makeStream({ isTTY: true, columns: 120 })
    const r = new LiveRenderer(stream)
    r.live(['line 1', 'line 2'])
    const joined = output.join('')
    expect(joined).toContain('line 1')
    expect(joined).toContain('line 2')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/review-loop/live-renderer.test.ts`
Expected: FAIL — `r.commit is not a function` (and the two updated tests fail against old behavior).

- [ ] **Step 3: Implement `commit` and non-TTY `live()` suppression**

In `review-loop/src/progress-log.ts`, add to the `ProgressReporter` interface (after `slot?`):

```ts
  slot?(key: string, line: string | null): void
  /**
   * Freezes a slot's live line as one permanent scrolled line and frees the key.
   * `line` replaces the slot content when given. With neither slot nor line: no-op.
   * In non-dynamic mode the line (if any) is printed and slot state is ignored.
   */
  commit?(key: string, line?: string): void
```

In `review-loop/src/live-renderer.ts`, add the method to `LiveRenderer` (after `slot`):

```ts
  commit(key: string, line?: string): void {
    this.touch()
    const finalLine = line ?? this.slots.get(key)
    this.slots.delete(key)
    if (finalLine === undefined) {
      if (this.dynamic) this.renderBlock()
      return
    }
    if (!this.dynamic) {
      this.writeSafe(`${finalLine}\n`)
      return
    }
    this.clearBlock()
    this.writeSafe(`${finalLine}\n`)
    this.renderBlock()
  }
```

And change the non-dynamic branch of `live()` to a no-op:

```ts
  live(lines: readonly string[]): void {
    if (!this.dynamic) {
      return
    }
    this.writeBlock([...lines])
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/review-loop/live-renderer.test.ts`
Expected: PASS (all tests, including the unchanged pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add review-loop/src/progress-log.ts review-loop/src/live-renderer.ts tests/review-loop/live-renderer.test.ts
git commit -m "feat(review-loop): add LiveRenderer.commit to freeze slots as permanent lines"
```

---

### Task 2: Tokens + done-marker on the live line; line-handler stops scrolling step footers

`formatLiveLine` and its only production caller (`line-handler.ts`) change in the same commit so every commit stays green. `formatStepFooter` (only used by line-handler) is removed.

**Files:**
- Modify: `review-loop/src/live-format.ts` (`formatLiveLine` signature, export `ARROW`/`CHECK`, delete `formatStepFooter`)
- Modify: `review-loop/src/agent-runner.ts` (`RunAgentOptions` gains `slotKey?`, `commitOnDispose?`)
- Modify: `review-loop/src/line-handler.ts` (slot key, no step-footer event, commit-on-dispose)
- Test: `tests/review-loop/live-format.test.ts`
- Test: `tests/review-loop/line-handler.test.ts`

**Interfaces:**
- Consumes: `ProgressReporter.commit?` from Task 1.
- Produces:
  - `formatLiveLine(label, tool, arg, elapsedMs, toolCount, usage: LiveUsage, done?: boolean): string` and `interface LiveUsage { input: number; output: number }`
  - exported `ARROW` (`▶`) and `CHECK` (`✓`) consts — consumed by mutation-improve's `iter-line.ts` in Task 3.
  - `RunAgentOptions.slotKey?: string` (defaults to `label`) and `RunAgentOptions.commitOnDispose?: boolean` (defaults to `true`) — consumed by mutation-improve's `cli.ts` in Task 3.

- [ ] **Step 1: Update the live-format tests (failing)**

In `tests/review-loop/live-format.test.ts`:

Remove `formatStepFooter` from the import list (line 8-16) and delete the whole `describe('formatStepFooter', ...)` block (lines 122-135).

Replace the `describe('formatLiveLine', ...)` block (lines 101-120) with:

```ts
describe('formatLiveLine', () => {
  test('renders label, tool, arg, elapsed, count', () => {
    const line = formatLiveLine('fixer', 'edit', 'cli.ts', 42000, 3, { input: 0, output: 0 })
    expect(line).toContain('fixer')
    expect(line).toContain('edit cli.ts')
    expect(line).toContain('42s')
    expect(line).toContain('3 tools')
  })
  test('no tool yet shows thinking', () => {
    expect(formatLiveLine('reviewer', '', '', 2000, 0, { input: 0, output: 0 })).toContain('thinking')
  })
  test('renders exact line with singular tool count', () => {
    expect(formatLiveLine('reviewer', 'read', 'a.ts', 1000, 1, { input: 0, output: 0 })).toBe(
      `  reviewer   ▶ read a.ts · 1s · 1 tool`,
    )
  })
  test('renders exact line when arg is empty', () => {
    expect(formatLiveLine('fixer', 'edit', '', 5000, 2, { input: 0, output: 0 })).toBe(
      `  fixer      ▶ edit · 5s · 2 tools`,
    )
  })
  test('appends cumulative tokens once non-zero', () => {
    expect(formatLiveLine('improve', 'bash', 'bun test', 5000, 41, { input: 850_000, output: 12_000 })).toBe(
      `  improve    ▶ bash bun test · 5s · 41 tools · in 850.0k / out 12.0k`,
    )
  })
  test('hides the token segment while both counts are zero', () => {
    expect(formatLiveLine('improve', 'read', 'a.ts', 5000, 1, { input: 0, output: 0 })).not.toContain('in ')
  })
  test('done=true swaps the arrow for a check mark', () => {
    const line = formatLiveLine('improve', 'read', 'a.ts', 5000, 1, { input: 5, output: 2 }, true)
    expect(line).toBe(`  improve    ✓ read a.ts · 5s · 1 tool · in 5 / out 2`)
  })
})
```

- [ ] **Step 2: Update the line-handler tests (failing)**

In `tests/review-loop/line-handler.test.ts`:

Replace the test `'tool progress goes to reporter.slot and dispose clears it'` (lines 125-144) with:

```ts
  test('tool progress goes to reporter.slot and dispose commits it with a done marker', async () => {
    const cwd = makeTempDir('line-handler-slot-')
    const slots: Array<readonly [string, string | null]> = []
    const commits: Array<readonly [string, string | undefined]> = []
    const reporter = makeReporter({
      slot: (key, line) => {
        slots.push([key, line] as const)
      },
      commit: (key, line) => {
        commits.push([key, line] as const)
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
    expect(slots.some(matchesDrainRead)).toBe(true)
    await handler.dispose()
    expect(commits).toHaveLength(1)
    expect(commits[0]![0]).toBe('drain')
    expect(commits[0]![1]).toContain('✓')
    expect(commits[0]![1]).toContain('read')
    expect(slots.every(([, line]) => line !== null)).toBe(true)
  })

  test('commitOnDispose:false leaves the slot live (no commit, no clear)', async () => {
    const cwd = makeTempDir('line-handler-keep-')
    const slots: Array<readonly [string, string | null]> = []
    const commits: Array<readonly [string, string | undefined]> = []
    const reporter = makeReporter({
      slot: (key, line) => {
        slots.push([key, line] as const)
      },
      commit: (key, line) => {
        commits.push([key, line] as const)
      },
    })
    const handler = createLineHandler({
      ...makeOptions(cwd, path.join(cwd, 'agent.log')),
      reporter,
      slotKey: 'iter',
      commitOnDispose: false,
    })
    handler.onLine(JSON.stringify({ type: 'step_start', timestamp: 1, part: {} }))
    handler.onLine(
      JSON.stringify({
        type: 'tool_use',
        part: { tool: 'read', callID: 'c1', state: { status: 'running', input: { filePath: '/a/cli.ts' } } },
      }),
    )
    await handler.dispose()
    expect(commits).toEqual([])
    expect(slots).toHaveLength(1)
    expect(slots.every(([, line]) => line !== null)).toBe(true)
  })

  test('slotKey overrides the slot identity', async () => {
    const cwd = makeTempDir('line-handler-key-')
    const slots: Array<readonly [string, string | null]> = []
    const reporter = makeReporter({
      slot: (key, line) => {
        slots.push([key, line] as const)
      },
    })
    const handler = createLineHandler({
      ...makeOptions(cwd, path.join(cwd, 'agent.log')),
      reporter,
      slotKey: 'iter',
      commitOnDispose: false,
    })
    handler.onLine(JSON.stringify({ type: 'step_start', timestamp: 1, part: {} }))
    handler.onLine(
      JSON.stringify({
        type: 'tool_use',
        part: { tool: 'read', callID: 'c1', state: { status: 'running', input: { filePath: '/a/cli.ts' } } },
      }),
    )
    expect(slots).toHaveLength(1)
    expect(slots.every(([key]) => key === 'iter')).toBe(true)
    await handler.dispose()
  })

  test('step_finish emits no permanent event, but re-renders the live line with cumulative tokens', async () => {
    const cwd = makeTempDir('line-handler-tokens-')
    const events: string[] = []
    const slots: Array<readonly [string, string | null]> = []
    const reporter = makeReporter({
      event: (msg) => {
        events.push(msg)
      },
      slot: (key, line) => {
        slots.push([key, line] as const)
      },
    })
    const handler = createLineHandler({ ...makeOptions(cwd, path.join(cwd, 'agent.log')), reporter })
    handler.onLine(JSON.stringify({ type: 'step_start', timestamp: 1, part: {} }))
    handler.onLine(
      JSON.stringify({
        type: 'step_finish',
        part: { reason: 'stop', tokens: { input: 5, output: 2, reasoning: 1 }, cost: 0 },
      }),
    )
    expect(events).toEqual([])
    const last = slots[slots.length - 1]![1]!
    expect(last).toContain('in 5 / out 2')
    await handler.dispose()
  })

  test('an agent that died before its first step clears the slot instead of committing', async () => {
    const cwd = makeTempDir('line-handler-unstarted-')
    const slots: Array<readonly [string, string | null]> = []
    const commits: Array<readonly [string, string | undefined]> = []
    const reporter = makeReporter({
      slot: (key, line) => {
        slots.push([key, line] as const)
      },
      commit: (key, line) => {
        commits.push([key, line] as const)
      },
    })
    const handler = createLineHandler({ ...makeOptions(cwd, path.join(cwd, 'agent.log')), reporter })
    await handler.dispose()
    expect(commits).toEqual([])
    expect(slots).toEqual([['drain', null]])
  })

  test('a reporter without commit falls back to clearing the slot on dispose', async () => {
    const cwd = makeTempDir('line-handler-nocommit-')
    const slots: Array<readonly [string, string | null]> = []
    const reporter = makeReporter({
      slot: (key, line) => {
        slots.push([key, line] as const)
      },
    })
    const handler = createLineHandler({ ...makeOptions(cwd, path.join(cwd, 'agent.log')), reporter })
    handler.onLine(JSON.stringify({ type: 'step_start', timestamp: 1, part: {} }))
    await handler.dispose()
    expect(slots[slots.length - 1]).toEqual(['drain', null])
  })
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/review-loop/live-format.test.ts tests/review-loop/line-handler.test.ts`
Expected: FAIL — argument-count/type errors on `formatLiveLine`, `commit is not a function`-ish assertion failures, `formatStepFooter` still imported by line-handler is fine but its format test block was deleted.

- [ ] **Step 4: Implement the live-format changes**

In `review-loop/src/live-format.ts`:

Change the const declarations (lines 9-10) to exports:

```ts
export const ARROW = '▶'
export const CHECK = '✓'
```

Replace `formatLiveLine` and delete `formatStepFooter` (lines 78-92):

```ts
export interface LiveUsage {
  input: number
  output: number
}

export function formatLiveLine(
  label: string,
  tool: string,
  arg: string,
  elapsedMs: number,
  toolCount: number,
  usage: LiveUsage,
  done = false,
): string {
  const marker = done ? CHECK : ARROW
  const toolPart = tool === '' ? 'thinking' : arg === '' ? tool : `${tool} ${arg}`
  const tools = `${toolCount} tool${toolCount === 1 ? '' : 's'}`
  const head = `  ${label.padEnd(10)} ${marker} ${toolPart} ${MIDDLE_DOT} ${formatDuration(elapsedMs)} ${MIDDLE_DOT} ${tools}`
  if (usage.input === 0 && usage.output === 0) return head
  return `${head} ${MIDDLE_DOT} in ${formatTokenCount(usage.input)} / out ${formatTokenCount(usage.output)}`
}
```

- [ ] **Step 5: Implement the agent-runner options**

In `review-loop/src/agent-runner.ts`, add to `RunAgentOptions` (after `label: string`):

```ts
  label: string
  /**
   * Slot identity for live rendering; defaults to `label`. Callers that run
   * several agents as one on-screen unit (mutation-improve's iteration) pass a
   * shared key so each agent's live line replaces the previous one in place.
   */
  slotKey?: string
  /**
   * When false, dispose leaves the slot live instead of committing it — the
   * unit's owner (e.g. the mutation-improve pipeline) commits once at the end.
   */
  commitOnDispose?: boolean
```

- [ ] **Step 6: Implement the line-handler changes**

In `review-loop/src/line-handler.ts`:

1. Update the import (line 10): remove `formatStepFooter`:

```ts
import { formatLiveLine, formatToolArg } from './live-format.js'
```

2. Add to `LiveCtx` (after `label`):

```ts
  readonly label: string
  readonly slotKey: string
  readonly commitOnDispose: boolean
```

3. Replace `renderLive` and add `liveLine` above it:

```ts
function liveLine(ctx: LiveCtx, done: boolean): string {
  const elapsed = ctx.startedAt === 0 ? 0 : Date.now() - ctx.startedAt
  return formatLiveLine(ctx.label, ctx.tool, ctx.arg, elapsed, ctx.toolCount, {
    input: ctx.usage.inputTokens,
    output: ctx.usage.outputTokens,
  }, done)
}

function renderLive(ctx: LiveCtx): void {
  const reporter = ctx.reporter
  if (reporter === undefined) {
    return
  }
  const line = liveLine(ctx, false)
  if (reporter.slot === undefined) {
    reporter.live([line])
  } else {
    reporter.slot(ctx.slotKey, line)
  }
}
```

4. In `applyStepFinish`, replace the trailing `reporter.clearLive(); reporter.event(formatStepFooter(...))` (lines 72-75) with a live-line refresh so cumulative tokens appear:

```ts
  renderLive(ctx)
```

5. In `createLineHandler`, initialize the new ctx fields (inside the `ctx` object literal):

```ts
    label: options.label,
    slotKey: options.slotKey ?? options.label,
    commitOnDispose: options.commitOnDispose ?? true,
```

6. Replace the reporter block in `dispose`:

```ts
    const reporter = ctx.reporter
    if (reporter !== undefined) {
      if (reporter.slot === undefined) {
        reporter.clearLive()
      } else if (ctx.commitOnDispose && ctx.startedAt !== 0 && reporter.commit !== undefined) {
        reporter.commit(ctx.slotKey, liveLine(ctx, true))
      } else if (ctx.commitOnDispose) {
        // Never started (died before the first step) or the reporter predates
        // commit(): nothing worth freezing — clear instead.
        reporter.slot(ctx.slotKey, null)
      }
      // commitOnDispose === false: leave the slot live for the unit's owner.
    }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `bun test tests/review-loop/live-format.test.ts tests/review-loop/line-handler.test.ts tests/review-loop/live-renderer.test.ts tests/review-loop/agent-runner.test.ts tests/review-loop/fake-agent-integration.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add review-loop/src/live-format.ts review-loop/src/agent-runner.ts review-loop/src/line-handler.ts tests/review-loop/live-format.test.ts tests/review-loop/line-handler.test.ts
git commit -m "feat(review-loop): fold step footers into the live line, commit on dispose"
```

---

### Task 3: mutation-improve — one `'iter'` line per iteration

**Files:**
- Create: `mutation-improve/src/iter-line.ts`
- Modify: `mutation-improve/src/pipeline.ts` (widen `log` dep type; commit in `runPipeline`)
- Modify: `mutation-improve/src/cli.ts` (slotKey/commitOnDispose on agent runners; wrap build/mutate gates in `withIterPhase`)
- Test: `tests/mutation-improve/iter-line.test.ts` (create)
- Test: `tests/mutation-improve/pipeline.test.ts` (add commit assertions)

**Interfaces:**
- Consumes: `ARROW`, `CHECK`, `formatDuration`, `formatTokenCount` (unused here, do not import), `truncate`, `MIDDLE_DOT` from `review-loop/src/live-format.js`; `RunAgentOptions.slotKey`/`commitOnDispose` from Task 2; `ProgressReporter.commit` from Task 1.
- Produces:
  - `ITER_SLOT_KEY: 'iter'` (constant)
  - `formatIterLine(outcome: IterationResult, elapsedMs: number): string`
  - `withIterPhase<T>(log: IterSlotLog, label: string, fn: () => Promise<T>): Promise<T>`
  - `interface IterSlotLog { dynamic?: boolean; slot?: (key: string, line: string | null) => void }`

- [ ] **Step 1: Write the failing iter-line tests**

Create `tests/mutation-improve/iter-line.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { formatIterLine, ITER_SLOT_KEY, withIterPhase } from '../../mutation-improve/src/iter-line.js'
import type { IterationResult } from '../../mutation-improve/src/pipeline.js'

describe('formatIterLine', () => {
  test('improved shows mark, file, scores, duration', () => {
    const outcome: IterationResult = {
      iter: 3,
      outcome: 'improved',
      file: 'src/providers/config-validation.ts',
      beforeScore: 0.622,
      afterScore: 0.979,
    }
    expect(formatIterLine(outcome, 60_000)).toBe(
      'iter 3 ✓ improved · src/providers/config-validation.ts · 62.2%→97.9% · 1m00s',
    )
  })

  test('capped uses the same shape with the capped label', () => {
    const outcome: IterationResult = {
      iter: 1,
      outcome: 'capped',
      file: 'src/reply-context.ts',
      beforeScore: 0.5,
      afterScore: 0.7606,
    }
    expect(formatIterLine(outcome, 1300_000)).toBe(
      'iter 1 ✓ capped · src/reply-context.ts · 50.0%→76.1% · 21m40s',
    )
  })

  test('skipped shows the before score against the threshold', () => {
    const outcome: IterationResult = { iter: 5, outcome: 'skipped', file: 'src/foo.ts', beforeScore: 0.912 }
    expect(formatIterLine(outcome, 123_000)).toBe('iter 5 – skipped · src/foo.ts · 91.2% ≥ threshold · 2m03s')
  })

  test('failed shows gate and truncated reason', () => {
    const outcome: IterationResult = {
      iter: 7,
      outcome: 'failed',
      file: 'src/tools/compaction/result-store.ts',
      gate: 'exception',
      reason: 'improve exited with code 1: boom',
    }
    expect(formatIterLine(outcome, 1800_000)).toBe(
      'iter 7 ✗ failed · src/tools/compaction/result-store.ts · exception: improve exited with code 1: boom · 30m00s',
    )
  })

  test('failed without a file omits the file segment', () => {
    const outcome: IterationResult = { iter: 2, outcome: 'failed', gate: 'exception', reason: 'worktree add failed' }
    expect(formatIterLine(outcome, 1000)).toBe('iter 2 ✗ failed · exception: worktree add failed · 1s')
  })

  test('a very long failure reason is truncated with an ellipsis', () => {
    const outcome: IterationResult = {
      iter: 8,
      outcome: 'failed',
      file: 'src/x.ts',
      gate: 'build',
      reason: 'x'.repeat(500),
    }
    const line = formatIterLine(outcome, 1000)
    expect(line).toContain('…')
    expect(line.length).toBeLessThan(260)
  })
})

describe('withIterPhase', () => {
  test('returns the wrapped result', async () => {
    const result = await withIterPhase({ dynamic: true, slot: () => {} }, 'build', () => Promise.resolve(42))
    expect(result).toBe(42)
  })

  test('ticks the iter slot immediately with the phase label', async () => {
    const slots: Array<readonly [string, string | null]> = []
    await withIterPhase(
      {
        dynamic: true,
        slot: (key, line) => {
          slots.push([key, line] as const)
        },
      },
      'build',
      () => Promise.resolve('done'),
    )
    expect(slots[0]![0]).toBe(ITER_SLOT_KEY)
    expect(slots[0]![1]).toContain('build')
    expect(slots.every(([, line]) => line !== null)).toBe(true)
  })

  test('non-dynamic log runs fn without touching the slot', async () => {
    const slots: string[] = []
    const result = await withIterPhase(
      {
        dynamic: false,
        slot: () => {
          slots.push('x')
        },
      },
      'build',
      () => Promise.resolve('ran'),
    )
    expect(result).toBe('ran')
    expect(slots).toEqual([])
  })

  test('a log without slot runs fn untouched', async () => {
    const result = await withIterPhase({}, 'mutate', () => Promise.resolve('ran'))
    expect(result).toBe('ran')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/mutation-improve/iter-line.test.ts`
Expected: FAIL — module `../../mutation-improve/src/iter-line.js` does not exist.

- [ ] **Step 3: Create `mutation-improve/src/iter-line.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { ARROW, CHECK, formatDuration, MIDDLE_DOT, truncate } from '../../review-loop/src/live-format.js'
import type { IterationResult } from './pipeline.js'

/**
 * All phases of one iteration (select agent → improve agent → build/mutate
 * gates → build-fix retries) render into this single slot: iterations are
 * strictly sequential with at most one agent running, so one constant key
 * suffices. runPipeline commits it once per iteration via formatIterLine.
 */
export const ITER_SLOT_KEY = 'iter'

const CROSS = '✗'
const DASH = '–'
const GEQ = '≥'
const REASON_MAX = 160

export interface IterSlotLog {
  dynamic?: boolean
  slot?: (key: string, line: string | null) => void
}

function pct(score: number): string {
  return `${(score * 100).toFixed(1)}%`
}

export function formatIterLine(outcome: IterationResult, elapsedMs: number): string {
  const head = `iter ${outcome.iter}`
  const filePart = outcome.file === undefined ? [] : [outcome.file]
  const duration = formatDuration(elapsedMs)
  switch (outcome.outcome) {
    case 'improved':
    case 'capped': {
      const scores =
        outcome.beforeScore === undefined || outcome.afterScore === undefined
          ? []
          : [`${pct(outcome.beforeScore)}→${pct(outcome.afterScore)}`]
      return [`${head} ${CHECK} ${outcome.outcome}`, ...filePart, ...scores, duration].join(` ${MIDDLE_DOT} `)
    }
    case 'skipped': {
      const score = outcome.beforeScore === undefined ? [] : [`${pct(outcome.beforeScore)} ${GEQ} threshold`]
      return [`${head} ${DASH} skipped`, ...filePart, ...score, duration].join(` ${MIDDLE_DOT} `)
    }
    case 'failed': {
      const gate = outcome.gate ?? 'error'
      const detail = outcome.reason === undefined ? gate : `${gate}: ${truncate(outcome.reason, REASON_MAX)}`
      return [`${head} ${CROSS} failed`, ...filePart, detail, duration].join(` ${MIDDLE_DOT} `)
    }
  }
}

/**
 * Renders a non-agent phase (build gate, mutation run) into the iteration's
 * slot with a 1s ticker, replacing withLivePhase for mutation-improve: that
 * helper emits a permanent start event and clears the slot at the end, both
 * wrong for the one-line-per-iteration model. The slot is left live on
 * completion; the pipeline's commit (or the next phase's tick) replaces it.
 */
export async function withIterPhase<T>(log: IterSlotLog, label: string, fn: () => Promise<T>): Promise<T> {
  if (log.slot === undefined || log.dynamic !== true) return fn()
  const slot = log.slot
  const start = Date.now()
  const tick = (): void => {
    slot(ITER_SLOT_KEY, `  ${label.padEnd(10)} ${ARROW} ${formatDuration(Date.now() - start)}`)
  }
  tick()
  const timer = setInterval(tick, 1000)
  try {
    return await fn()
  } finally {
    clearInterval(timer)
  }
}
```

Note: the skipped line renders `91.2% ≥ threshold` using only the measured before-score; the threshold value itself is intentionally not shown, so it is not a parameter.

- [ ] **Step 4: Run iter-line tests to verify they pass**

Run: `bun test tests/mutation-improve/iter-line.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing pipeline commit tests**

Append to `tests/mutation-improve/pipeline.test.ts` (inside a new top-level describe at the end of the file):

```ts
describe('pipeline iteration commit line', () => {
  const commitLog = (): { log: PipelineDeps['log']; commits: Array<readonly [string, string | undefined]> } => {
    const commits: Array<readonly [string, string | undefined]> = []
    return {
      commits,
      log: {
        log: () => undefined,
        commit: (key: string, line?: string) => {
          commits.push([key, line] as const)
        },
      },
    }
  }

  test('commits an improved summary line after a merged iteration', async () => {
    const deps = happyDeps()
    const { log, commits } = commitLog()
    deps.log = log
    await runPipeline(deps)
    expect(commits).toHaveLength(1)
    expect(commits[0]![0]).toBe('iter')
    expect(commits[0]![1]).toContain('iter 1 ✓ improved')
    expect(commits[0]![1]).toContain('src/live-status/tool-status-labels.ts')
    expect(commits[0]![1]).toContain('46.0%→97.0%')
  })

  test('commits a failed summary line when the score gate fails', async () => {
    const deps = happyDeps()
    deps.measureScore = sequenceMeasure([0.46, 0.46])
    deps.runImproveAgent = (): Promise<{ value: Result; usage: AgentUsage }> =>
      Promise.resolve({ value: { ...result, residuals: [] }, usage: emptyUsage() })
    const { log, commits } = commitLog()
    deps.log = log
    await runPipeline(deps)
    expect(commits).toHaveLength(1)
    expect(commits[0]![1]).toContain('iter 1 ✗ failed')
    expect(commits[0]![1]).toContain('score:')
  })

  test('commits a skipped summary line when the file is already at threshold', async () => {
    const deps = happyDeps()
    deps.measureScore = sequenceMeasure([0.97])
    const { log, commits } = commitLog()
    deps.log = log
    await runPipeline(deps)
    expect(commits).toHaveLength(1)
    expect(commits[0]![1]).toContain('iter 1 – skipped')
    expect(commits[0]![1]).toContain('97.0% ≥ threshold')
  })

  test('a merge-abort still commits the failed line for its iteration', async () => {
    const deps = happyDeps()
    deps.mergeWorktree = (): Promise<{ ok: false; conflictFiles: string[] }> =>
      Promise.resolve({ ok: false, conflictFiles: ['scripts/mutation/baseline.json'] })
    const { log, commits } = commitLog()
    deps.log = log
    const { aborted } = await runPipeline(deps)
    expect(aborted).toBe(true)
    expect(commits).toHaveLength(1)
    expect(commits[0]![1]).toContain('✗ failed')
    expect(commits[0]![1]).toContain('merge:')
  })

  test('a log without commit runs the pipeline unchanged', async () => {
    const deps = happyDeps()
    const { results, aborted } = await runPipeline(deps)
    expect(aborted).toBe(false)
    expect(results[0]?.outcome).toBe('improved')
  })
})
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `bun test tests/mutation-improve/pipeline.test.ts`
Expected: FAIL — `commits` stays empty (no commit call in the pipeline yet); the widened `log` type may also fail typecheck until Step 7.

- [ ] **Step 7: Implement the pipeline commit**

In `mutation-improve/src/pipeline.ts`:

1. Add the import:

```ts
import { formatIterLine, ITER_SLOT_KEY } from './iter-line.js'
```

2. Widen the `log` field of `PipelineDeps`:

```ts
  log: {
    log: (msg: string) => void
    issue?: unknown
    diff?: (label: string, diff: DiffStats) => void
    slot?: (key: string, line: string | null) => void
    commit?: (key: string, line?: string) => void
  }
```

3. In `runPipeline`'s `runFrom`, time the iteration and commit its line (replacing the current `const outcome = await runIteration(deps, iter)` line):

```ts
    deps.runState.currentIteration = iter
    const iterStart = Date.now()
    const outcome = await runIteration(deps, iter)
    deps.log.commit?.(ITER_SLOT_KEY, formatIterLine(outcome, Date.now() - iterStart))
    results.push(outcome)
```

- [ ] **Step 8: Wire cli.ts (agent slotKey + gate tickers)**

In `mutation-improve/src/cli.ts`:

1. Add the import:

```ts
import { ITER_SLOT_KEY, withIterPhase } from './iter-line.js'
```

2. In `selectRunner`'s `runAgent` options, add after `label: 'select',`:

```ts
      slotKey: ITER_SLOT_KEY,
      commitOnDispose: false,
```

3. In `improveRunner`'s `runAgent` options, add after `label: 'improve',`:

```ts
      slotKey: ITER_SLOT_KEY,
      commitOnDispose: false,
```

4. Wrap the gate deps in `buildPipelineDeps`:

```ts
    runBuildCheck: (worktreePath: string) =>
      withIterPhase(log, 'build', () => {
        const exec = createShellExec(worktreePath, config.checkCommand, config.buildTimeoutMs)
        return runBuildCheck({ exec: () => exec() })
      }),
    measureScore: (worktreePath: string, srcFile: string) =>
      withIterPhase(log, 'mutate', () => {
        const exec = createShellExec(worktreePath, `${config.mutateFileCommand} ${srcFile}`, config.mutateTimeoutMs)
        return measureMutationScore({ exec: () => exec() }, path.join(worktreePath, 'reports', 'paired'), srcFile)
      }),
```

- [ ] **Step 9: Run the full mutation-improve + review-loop suites**

Run: `bun test tests/mutation-improve tests/review-loop`
Expected: PASS. (cli.ts wiring has no dedicated unit test — `selectRunner`/`improveRunner` are closures; coverage comes from the line-handler option tests in Task 2 and the pipeline commit tests here.)

- [ ] **Step 10: Commit**

```bash
git add mutation-improve/src/iter-line.ts mutation-improve/src/pipeline.ts mutation-improve/src/cli.ts tests/mutation-improve/iter-line.test.ts tests/mutation-improve/pipeline.test.ts
git commit -m "feat(mutation-improve): one live line per iteration with committed summary"
```

---

### Task 4: Docs + full gate

**Files:**
- Modify: `review-loop/AGENTS.md` and `review-loop/CLAUDE.md` (same content mirrored — check both; they are identical duplicates in this repo)
- Modify: `mutation-improve/AGENTS.md` and `mutation-improve/CLAUDE.md`

- [ ] **Step 1: Update review-loop docs**

In `review-loop/AGENTS.md` (and mirror into `review-loop/CLAUDE.md`), extend the "Run Stats" section with one sentence:

```markdown
The `LiveRenderer` folds all agent progress into one live line per slot key; `commit(key, line?)` freezes a slot as a permanent scrolled line (line-handler commits on agent dispose unless `commitOnDispose: false`). Non-TTY output prints only `event()`/`commit()` lines — `slot()`/`live()` updates are suppressed.
```

- [ ] **Step 2: Update mutation-improve docs**

In `mutation-improve/AGENTS.md` (and mirror into `mutation-improve/CLAUDE.md`), append to the Pipeline section:

```markdown
Live output: every phase of an iteration renders into the single `'iter'` slot (`src/iter-line.ts`); `runPipeline` commits one summary line per iteration (`iter N ✓ improved · file · before→after · duration`), so a run's scrolled output is bounded by iteration count.
```

- [ ] **Step 3: Run workspace gates**

Run from repo root:

```bash
bun run review-loop:typecheck && bun run review-loop:lint && bun run review-loop:format:check
bun run mutation-improve:typecheck && bun run mutation-improve:lint && bun run mutation-improve:format:check
bun test tests/review-loop tests/mutation-improve
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add review-loop/AGENTS.md review-loop/CLAUDE.md mutation-improve/AGENTS.md mutation-improve/CLAUDE.md
git commit -m "docs: document single-line live renderer commit model"
```

---

## Self-Review Notes (already applied)

- Spec coverage: §1 renderer commit → Task 1; §2 line-handler/format → Task 2; §3 mutation-improve wiring → Task 3; docs → Task 4. Error-handling rows are covered by Task 1/2 tests (no-slot commit, died-before-first-step, broken stream pre-covered by the existing EPIPE test).
- Type consistency: `commit?(key: string, line?: string): void` identical in Tasks 1-3; `slotKey`/`commitOnDispose` names identical in Tasks 2-3; `formatIterLine(outcome, elapsedMs)` signature identical in iter-line.ts, pipeline.ts, and tests.
- `withLivePhase` (`review-loop/src/live-renderer.ts`) is intentionally untouched — review-loop's build-checker still uses it.
