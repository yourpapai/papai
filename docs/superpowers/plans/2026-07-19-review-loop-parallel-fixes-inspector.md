<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Review-Loop: Parallel Fixes + Post-Fix Diff Inspection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a K-worker git worktree pool for parallel issue fixing and an inspector agent step that gates the merge of any fix into the primary worktree, plus the observability needed to measure them.

**Architecture:** Two coupled additions to `review-loop/`: (1) a `WorkerPool` module that owns K worktrees and dispatches issues with file-set awareness, integrating into a unified retry loop in `processIssue` that treats build-failure and inspector-rejection as the same kind of retry signal; (2) an inspector agent that runs after a build passes and before a merge, returning `{addresses, reasoning, confidence}`. Bad fixes are discarded before they reach the integration branch.

**Tech Stack:** Bun, TypeScript (strict, `.js` import extensions), Zod v4, real git for worktree manipulation, `bun:test` for tests.

**Companion spec:** `docs/superpowers/specs/2026-07-19-review-loop-parallel-fixes-inspector-design.md` (read before starting; this plan elides rationale that the spec covers).

## Global Constraints

- Runtime **Bun**; validation **Zod v4**.
- Strict TypeScript; **use `.js` extension in import paths**.
- Error extraction: `error instanceof Error ? error.message : String(error)`.
- **Never add lint-disable or type-ignore comments** — hook policy blocks them; fix the underlying issue.
- A `max-lines` / `max-lines-per-function` failure is a **design signal**: split the file or extract functions.
- Review-loop workspace scripts: `bun run review-loop:test`, `bun run review-loop:typecheck`, `bun run review-loop:lint`, `bun run review-loop:format:check`. Per-file: `bun test tests/review-loop/<file>`.
- TDD resolver gates `review-loop/src/**` → `tests/review-loop/**`. Write the test first.
- Commit after every green task. Never commit with failing checks (the pre-commit hook runs lint/typecheck/format/license-headers).
- The check command for verification (from `config.json`): `export CI=true; bun build:client && bun check:full`.

## File Structure

**New files — implementation:**

- `review-loop/src/worker-pool.ts` — Pool lifecycle: K worktrees, acquire/release, file-set-aware dispatch, rebase+ff merge with primary mutex.
- `review-loop/src/issue-inspector.ts` — Thin wrapper around `runAgent` for the inspector; builds the diff input and emits `inspect_complete`.

**New files — tests:**

- `tests/review-loop/worker-pool.test.ts` — Pool lifecycle, dispatch, merge-back, concurrency.
- `tests/review-loop/issue-inspector.test.ts` — Inspector invocation, prompt structure, schema validation.

**Modified — schema/trace foundation:**

- `review-loop/src/issue-schema.ts` — Add `InspectorResultSchema`.
- `review-loop/src/trace-log.ts` — Extend `DecisionsSchema`, `RoundMetricSchema`; add `inspect_complete` to `TraceEventSchema`.
- `review-loop/src/loop-trace.ts` — Add `tallyInspector`, `tallyPhaseMs`, `tallyUsage`, `emitInspectComplete`.

**Modified — agent-runner / live-renderer:**

- `review-loop/src/agent-runner.ts` — Change `runAgent` return type to `AgentRunResult<T>`; accumulate `usage` from existing event stream.
- `review-loop/src/live-renderer.ts` — `ProgressReporter.live` accepts `readonly string[]`; TTY repaints multiple lines.

**Modified — issue processor + prompts:**

- `review-loop/src/prompt-templates.ts` — Add `buildInspectPrompt`, `buildRetryFixWithInspectorFeedbackPrompt`.
- `review-loop/src/issue-processor.ts` — Replace serial `processNextIssue` recursion with pool dispatch; refactor `processIssue` to attempt-counter loop with unified retry budget; add inspector gate.
- `review-loop/src/run-state.ts` — Add `inspectPath` derived field.

**Modified — pool support:**

- `review-loop/src/worktree.ts` — Add `rebaseOnto`, `mergeFastForward`, `cleanWorkerWorktrees` helpers.

**Modified — config / CLI / reporting:**

- `review-loop/src/config.ts` — Add `poolSize` (default 3) and optional `inspector` slot.
- `review-loop/src/cli.ts` — Construct `WorkerPool`; tear down on cleanup; add `--pool-size` and `--no-inspect` flags; clean stale worker worktrees at start.
- `review-loop/src/summary.ts` — Inspector stats, per-phase wall-clock, total cost in `summary.txt` and `metrics.json`.
- `review-loop/config.example.json` — Document new fields.

**Modified — loop-controller / existing callers:**

- `review-loop/src/loop-controller.ts` — Pass pool to issue processor; extract `.value` from updated `runAgent` return type.

**Modified — issue-matcher (return-type change ripple):**

- `review-loop/src/issue-matcher.ts` — Extract `.value` from updated `runAgent`.

**Modified — test helpers:**

- `tests/review-loop/test-helpers.ts` — Add `mockSpawnForFixerAndInspector` shared helper.
- `tests/review-loop/issue-processor.test.ts` — Cover all state-graph branches.
- `tests/review-loop/loop-trace.test.ts` — Cover new tally helpers.
- `tests/review-loop/trace-log.test.ts` — Cover extended schemas.
- `tests/review-loop/summary.test.ts` — Cover extended report.
- `tests/review-loop/prompt-templates.test.ts` — Cover new prompts.
- `tests/review-loop/config.test.ts` — Cover `poolSize` default + `inspector` fallback.
- `tests/review-loop/agent-runner.test.ts` — Cover `AgentRunResult<T>`.
- `tests/review-loop/live-renderer.test.ts` — Cover array `live()`.
- `tests/review-loop/loop-controller.test.ts` — Cover pool construction.
- `tests/review-loop/fake-agent-integration.test.ts` — 3-4 slow end-to-end tests.

---

## Task 1: Inspector schema + prompt templates

Pure additions: a Zod schema for the inspector result and two prompt builders. No behavior change, no callers yet. This is the foundation for Task 4.

**Files:**

- Modify: `review-loop/src/issue-schema.ts`
- Modify: `review-loop/src/prompt-templates.ts`
- Test: `tests/review-loop/issue-schema.test.ts`
- Test: `tests/review-loop/prompt-templates.test.ts`

**Interfaces:**

- Produces: `InspectorResultSchema`, `InspectorResult` type, `buildInspectPrompt(issue, diff, fixerReasoning, outputPath): string`, `buildRetryFixWithInspectorFeedbackPrompt(issue, inspectorReasoning, outputPath, checkCommand): string`.

- [ ] **Step 1: Write the failing schema test**

Add to `tests/review-loop/issue-schema.test.ts` (create if absent):

```typescript
import { describe, expect, test } from 'bun:test'

import { InspectorResultSchema } from '../../review-loop/src/issue-schema.js'

describe('InspectorResultSchema', () => {
  test('accepts a valid inspector result', () => {
    const parsed = InspectorResultSchema.parse({
      addresses: true,
      reasoning: 'The diff at line 12 fixes the race by adding the lock.',
      confidence: 0.9,
    })
    expect(parsed.addresses).toBe(true)
  })

  test('rejects missing reasoning', () => {
    expect(() => InspectorResultSchema.parse({ addresses: false, confidence: 0.5 })).toThrow()
  })

  test('rejects confidence out of range', () => {
    expect(() => InspectorResultSchema.parse({ addresses: true, reasoning: 'ok', confidence: 1.5 })).toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/review-loop/issue-schema.test.ts -t "InspectorResultSchema"`
Expected: FAIL — `InspectorResultSchema` is not exported.

- [ ] **Step 3: Add the schema to `issue-schema.ts`**

Append after `FixerResultSchema`:

```typescript
export const InspectorResultSchema = z.object({
  addresses: z.boolean(),
  reasoning: z.string().min(1),
  confidence: z.number().min(0).max(1),
})

export type InspectorResult = z.infer<typeof InspectorResultSchema>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/review-loop/issue-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing prompt tests**

Add to `tests/review-loop/prompt-templates.test.ts` (create if absent):

```typescript
import { describe, expect, test } from 'bun:test'

import { buildInspectPrompt, buildRetryFixWithInspectorFeedbackPrompt } from '../../review-loop/src/prompt-templates.js'
import type { ReviewerIssue } from '../../review-loop/src/issue-schema.js'

const issue: ReviewerIssue = {
  title: 'Race in queue',
  severity: 'high',
  summary: 's',
  whyItMatters: 'w',
  evidence: 'src/q.ts 1-2',
  file: 'src/q.ts',
  lineStart: 1,
  lineEnd: 2,
  suggestedFix: 'lock',
  confidence: 0.9,
}

describe('buildInspectPrompt', () => {
  test('includes issue JSON, diff, fixer reasoning, output path, and schema', () => {
    const prompt = buildInspectPrompt(issue, 'diff content here', 'fixer reasoning', 'out.json')
    expect(prompt).toContain('You are an inspector')
    expect(prompt).toContain('Race in queue')
    expect(prompt).toContain('diff content here')
    expect(prompt).toContain('fixer reasoning')
    expect(prompt).toContain('out.json')
    expect(prompt).toContain('"addresses": boolean')
    expect(prompt).toContain('Do not flag unrelated problems')
  })
})

describe('buildRetryFixWithInspectorFeedbackPrompt', () => {
  test('includes inspector reasoning and the agree-with-inspector branch', () => {
    const prompt = buildRetryFixWithInspectorFeedbackPrompt(
      issue,
      'inspector said: this is wrong',
      'out.json',
      'bun check:full',
    )
    expect(prompt).toContain('rejected by an inspector')
    expect(prompt).toContain('inspector said: this is wrong')
    expect(prompt).toContain('verdict "invalid", "needs_human", or "plan_drift"')
    expect(prompt).toContain('bun check:full')
    expect(prompt).toContain('final attempt')
  })
})
```

- [ ] **Step 6: Run the prompt tests to verify they fail**

Run: `bun test tests/review-loop/prompt-templates.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 7: Implement `buildInspectPrompt`**

In `review-loop/src/prompt-templates.ts`, add after `buildRetryFixPrompt`:

```typescript
export function buildInspectPrompt(
  issue: ReviewerIssue,
  diff: string,
  fixerReasoning: string,
  outputPath: string,
): string {
  return [
    'You are an inspector. Your ONLY job: decide whether the diff below actually addresses the issue described.',
    'Do not flag unrelated problems. Do not assess code quality. Do not run checks.',
    'A build check has already passed — assume the code compiles and tests pass.',
    '',
    'Return addresses=true ONLY if you can point to specific lines in the diff that resolve the specific complaint in the issue.',
    'Return addresses=false if the diff is cosmetic, addresses a different problem, or leaves the core complaint untouched.',
    'When addresses=false, your reasoning MUST be actionable: explain what the fixer should have done differently.',
    '',
    `Write your result as JSON to: ${outputPath}`,
    'Use this exact schema:',
    '{"addresses": boolean, "reasoning": string, "confidence": number}',
    '',
    'Issue:',
    JSON.stringify(issue, null, 2),
    '',
    'Fixer reasoning (what the fixer claims it did):',
    fixerReasoning,
    '',
    'Diff (baseline..HEAD):',
    diff,
  ].join('\n\n')
}
```

- [ ] **Step 8: Implement `buildRetryFixWithInspectorFeedbackPrompt`**

In `review-loop/src/prompt-templates.ts`, append:

```typescript
export function buildRetryFixWithInspectorFeedbackPrompt(
  issue: ReviewerIssue,
  inspectorReasoning: string,
  outputPath: string,
  checkCommand: string,
): string {
  return [
    'Your previous fix was rejected by an inspector.',
    'The inspector said:',
    inspectorReasoning,
    '',
    'You have two options:',
    '1. If the inspector is RIGHT and the issue cannot be auto-fixed cleanly, return verdict "invalid", "needs_human", or "plan_drift" with reasoning. Do not edit anything.',
    '2. If the inspector is WRONG or you can fix differently, produce a corrected fix. Edit only what is necessary; run the check command to confirm.',
    `After fixing, run \`${checkCommand}\` to verify the build passes.`,
    'This is your final attempt. If you cannot make it work, return verdict "needs_human" — do not leave a broken tree.',
    `Write your result as JSON to: ${outputPath}`,
    'Use this exact schema:',
    '{"verdict": "valid" | "invalid" | "already_fixed" | "needs_human" | "plan_drift", "fixability": "auto" | "manual", "reasoning": string, "targetFiles": string[], "fixed": boolean, "commitSha": string | null, "commitMessage": string, "severity": "critical" | "high" | "medium" | "low"}',
    '',
    'Issue:',
    JSON.stringify(issue, null, 2),
  ].join('\n\n')
}
```

- [ ] **Step 9: Run prompt tests + typecheck + lint**

Run: `bun test tests/review-loop/prompt-templates.test.ts && bun run review-loop:typecheck && bun run review-loop:lint`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add review-loop/src/issue-schema.ts review-loop/src/prompt-templates.ts tests/review-loop/issue-schema.test.ts tests/review-loop/prompt-templates.test.ts
git commit -m "feat(review-loop): add inspector schema and prompt templates"
```

---

## Task 2: Trace/metric foundation (schemas + tally helpers)

Extend `trace-log.ts` schemas and add tally helpers in `loop-trace.ts`. No callers yet — Task 4 onwards wires them.

**Files:**

- Modify: `review-loop/src/trace-log.ts`
- Modify: `review-loop/src/loop-trace.ts`
- Test: `tests/review-loop/trace-log.test.ts`
- Test: `tests/review-loop/loop-trace.test.ts`

**Interfaces:**

- Produces: `PhaseMsSchema`, `UsageTotalsSchema`; extended `DecisionsSchema` with `inspector_rejected`; extended `RoundMetricSchema` with `inspector`, `phaseMs`, `usage`. Helpers: `tallyInspector(collector, addresses)`, `tallyPhaseMs(collector, phase, ms)`, `tallyUsage(collector, usage)`, `emitInspectComplete(trace, round, issueId, addresses, confidence, reasoning)`.

- [ ] **Step 1: Write the failing schema test**

Add to `tests/review-loop/trace-log.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'

import { DecisionsSchema, RoundMetricSchema, TraceEventSchema } from '../../review-loop/src/trace-log.js'

describe('extended schemas', () => {
  test('DecisionsSchema includes inspector_rejected', () => {
    const parsed = DecisionsSchema.parse({
      fixed: 0,
      invalid: 0,
      already_fixed: 0,
      needs_human: 0,
      plan_drift: 0,
      no_commit: 0,
      inspector_rejected: 2,
    })
    expect(parsed.inspector_rejected).toBe(2)
  })

  test('RoundMetricSchema includes inspector, phaseMs, usage', () => {
    const parsed = RoundMetricSchema.parse({
      round: 1,
      newIssues: 1,
      cumulativeOpen: 1,
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
    })
    expect(parsed.inspector.runs).toBe(0)
    expect(parsed.phaseMs.review).toBe(0)
    expect(parsed.usage.costUsd).toBe(0)
  })

  test('TraceEventSchema accepts inspect_complete', () => {
    const parsed = TraceEventSchema.parse({
      ts: '2026-07-19T00:00:00.000Z',
      round: 1,
      phase: 'inspect',
      event: 'inspect_complete',
      issueId: 'rec-1',
      addresses: true,
      confidence: 0.9,
      reasoning: 'ok',
    })
    expect(parsed.event).toBe('inspect_complete')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/review-loop/trace-log.test.ts -t "extended schemas"`
Expected: FAIL — `inspector_rejected` not in schema; `inspector`/`phaseMs`/`usage` not in `RoundMetricSchema`; `inspect_complete` not a trace event.

- [ ] **Step 3: Extend `trace-log.ts` schemas**

In `review-loop/src/trace-log.ts`:

1. Add `inspector_rejected: z.number().int().nonnegative()` to `DecisionsSchema`.
2. Update `emptyDecisions()` to include `inspector_rejected: 0`.
3. Add new schemas above `RoundMetricSchema`:

```typescript
export const PhaseMsSchema = z.object({
  review: z.number().int().nonnegative(),
  match: z.number().int().nonnegative(),
  verify: z.number().int().nonnegative(),
  build: z.number().int().nonnegative(),
  inspect: z.number().int().nonnegative(),
  fix: z.number().int().nonnegative(),
})
export type PhaseMs = z.infer<typeof PhaseMsSchema>

export const UsageTotalsSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
})
export type UsageTotals = z.infer<typeof UsageTotalsSchema>
```

4. Extend `RoundMetricSchema` with the three new fields:

```typescript
export const RoundMetricSchema = z.object({
  round: z.number().int().positive(),
  newIssues: z.number().int().nonnegative(),
  cumulativeOpen: z.number().int().nonnegative(),
  noProgressRounds: z.number().int().nonnegative(),
  decisions: DecisionsSchema,
  reviewerSeverity: SeverityCountsSchema,
  fixerSeverity: SeverityCountsSchema,
  inspector: z.object({ runs: z.number().int().nonnegative(), rejected: z.number().int().nonnegative() }),
  phaseMs: PhaseMsSchema,
  usage: UsageTotalsSchema,
})
```

5. Add `inspect_complete` to `TraceEventSchema` discriminated union (place it after `build_complete`):

```typescript
z.object({
  ...base,
  event: z.literal('inspect_complete'),
  issueId: z.string(),
  addresses: z.boolean(),
  confidence: z.number(),
  reasoning: z.string(),
}),
```

- [ ] **Step 4: Run the schema test to verify it passes**

Run: `bun test tests/review-loop/trace-log.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing tally helper tests**

Add to `tests/review-loop/loop-trace.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'

import {
  emitInspectComplete,
  newCollector,
  tallyInspector,
  tallyPhaseMs,
  tallyUsage,
} from '../../review-loop/src/loop-trace.js'
import { createCapturingTraceLogger } from '../../review-loop/src/trace-log.js'

describe('tallyInspector', () => {
  test('increments runs on every call; rejected only when addresses=false', () => {
    const c = newCollector()
    tallyInspector(c, true)
    tallyInspector(c, false)
    expect(c.inspector.runs).toBe(2)
    expect(c.inspector.rejected).toBe(1)
  })
})

describe('tallyPhaseMs', () => {
  test('accumulates ms per phase bucket', () => {
    const c = newCollector()
    tallyPhaseMs(c, 'review', 100)
    tallyPhaseMs(c, 'review', 50)
    tallyPhaseMs(c, 'build', 200)
    expect(c.phaseMs.review).toBe(150)
    expect(c.phaseMs.build).toBe(200)
  })
})

describe('tallyUsage', () => {
  test('accumulates tokens and cost', () => {
    const c = newCollector()
    tallyUsage(c, { inputTokens: 100, outputTokens: 50, reasoningTokens: 10, costUsd: 0.01, wallMs: 1000 })
    tallyUsage(c, { inputTokens: 200, outputTokens: 25, reasoningTokens: 5, costUsd: 0.02, wallMs: 500 })
    expect(c.usage.inputTokens).toBe(300)
    expect(c.usage.outputTokens).toBe(75)
    expect(c.usage.reasoningTokens).toBe(15)
    expect(c.usage.costUsd).toBeCloseTo(0.03)
  })
})

describe('emitInspectComplete', () => {
  test('appends an inspect_complete event with truncated reasoning', () => {
    const { logger, events } = createCapturingTraceLogger()
    emitInspectComplete(logger, 1, 'rec-1', false, 0.8, 'x'.repeat(300))
    expect(events).toHaveLength(1)
    const evt = events[0]!
    expect(evt.event).toBe('inspect_complete')
    expect(evt.addresses).toBe(false)
    expect(evt.reasoning.length).toBeLessThanOrEqual(200)
  })
})
```

- [ ] **Step 6: Run the helper tests to verify they fail**

Run: `bun test tests/review-loop/loop-trace.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 7: Extend `RoundCollector` and add the helpers**

In `review-loop/src/loop-trace.ts`:

1. Update imports to include `PhaseMs`, `UsageTotals` from `./trace-log.js`.
2. Extend `RoundCollector`:

```typescript
export interface RoundCollector {
  decisions: Decisions
  reviewerSeverity: SeverityCounts
  fixerSeverity: SeverityCounts
  inspector: { runs: number; rejected: number }
  phaseMs: PhaseMs
  usage: UsageTotals
}
```

3. Update `newCollector()`:

```typescript
export function newCollector(): RoundCollector {
  return {
    decisions: emptyDecisions(),
    reviewerSeverity: emptySeverityCounts(),
    fixerSeverity: emptySeverityCounts(),
    inspector: { runs: 0, rejected: 0 },
    phaseMs: { review: 0, match: 0, verify: 0, build: 0, inspect: 0, fix: 0 },
    usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0 },
  }
}
```

4. Add the tally helpers and `emitInspectComplete` (place after `tallyReviewerIssues`):

```typescript
export function tallyInspector(collector: RoundCollector, addresses: boolean): void {
  collector.inspector.runs += 1
  if (!addresses) collector.inspector.rejected += 1
}

export function tallyPhaseMs(collector: RoundCollector, phase: keyof PhaseMs, ms: number): void {
  collector.phaseMs[phase] += ms
}

export function tallyUsage(
  collector: RoundCollector,
  usage: { inputTokens: number; outputTokens: number; reasoningTokens: number; costUsd: number; wallMs: number },
): void {
  collector.usage.inputTokens += usage.inputTokens
  collector.usage.outputTokens += usage.outputTokens
  collector.usage.reasoningTokens += usage.reasoningTokens
  collector.usage.costUsd += usage.costUsd
}

export function emitInspectComplete(
  trace: TraceLogger,
  round: number,
  issueId: string,
  addresses: boolean,
  confidence: number,
  reasoning: string,
): void {
  void trace.append({
    ts: nowIso(),
    round,
    phase: 'inspect',
    event: 'inspect_complete',
    issueId,
    addresses,
    confidence,
    reasoning: truncate(reasoning, 200),
  })
}
```

- [ ] **Step 8: Run helper tests + typecheck + lint**

Run: `bun test tests/review-loop/loop-trace.test.ts tests/review-loop/trace-log.test.ts && bun run review-loop:typecheck && bun run review-loop:lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add review-loop/src/trace-log.ts review-loop/src/loop-trace.ts tests/review-loop/trace-log.test.ts tests/review-loop/loop-trace.test.ts
git commit -m "feat(review-loop): add inspector/phase/usage schemas and tally helpers"
```

---

## Task 3: `runAgent` return-type change (`AgentRunResult<T>`)

Change `runAgent` to return `{ value, usage }` so callers can record per-run cost. Touches 3 existing callers (reviewer, fixer, matcher); usage is discarded at callsites for now — Task 4 and Task 7 will wire it.

**Files:**

- Modify: `review-loop/src/agent-runner.ts`
- Modify: `review-loop/src/loop-controller.ts` (reviewer callsite)
- Modify: `review-loop/src/issue-matcher.ts` (matcher callsite)
- Modify: `review-loop/src/issue-processor.ts` (fixer callsite — minimal change, just extract `.value`)
- Test: `tests/review-loop/agent-runner.test.ts`

**Interfaces:**

- Produces: `AgentUsage` type (`{ inputTokens, outputTokens, reasoningTokens, costUsd, wallMs }`); `AgentRunResult<T>` type (`{ value: T; usage: AgentUsage }`). `runAgent<T>(options): Promise<AgentRunResult<T>>`.

- [ ] **Step 1: Write the failing return-type test**

Add to `tests/review-loop/agent-runner.test.ts` (read the existing file first to match its setup style):

```typescript
import { describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

import { runAgent, type SpawnFn } from '../../review-loop/src/agent-runner.js'
import { z } from 'zod'

function mockSpawnWithStepFinish(outputPath: string): SpawnFn {
  return (_cmd, _args, opts) => {
    // Emit a step_finish event line, then write the result file.
    const stepFinish = JSON.stringify({
      type: 'step_finish',
      part: { reason: 'stop', tokens: { input: 100, output: 50, reasoning: 10 }, cost: 0.01 },
    })
    // Two step_finish events to test accumulation:
    return new Promise((resolve) => {
      setTimeout(() => {
        writeFileSync(path.join(opts.cwd, outputPath), JSON.stringify({ ok: true }))
        resolve({ exitCode: 0, stdout: `${stepFinish}\n${stepFinish}\n`, stderr: '' })
      }, 10)
    })
  }
}

describe('runAgent return type', () => {
  test('returns AgentRunResult with value and usage', async () => {
    const tmp = await import('node:os').then((o) => o.tmpdir())
    const cwd = await import('node:fs/promises').then((f) => f.mkdtemp(path.join(tmp, 'agent-')))
    const outputPath = path.join(cwd, 'result.json')
    const result = await runAgent({
      spawn: mockSpawnWithStepFinish('.review-loop/result.json'),
      model: 'm',
      cwd,
      prompt: 'p',
      outputPath,
      outputSchema: z.object({ ok: z.boolean() }),
      label: 'test',
      logPath: path.join(cwd, 'agent.log'),
      extraArgs: [],
    })
    expect(result.value.ok).toBe(true)
    expect(result.usage.inputTokens).toBe(200)
    expect(result.usage.outputTokens).toBe(100)
    expect(result.usage.costUsd).toBeCloseTo(0.02)
    expect(result.usage.wallMs).toBeGreaterThanOrEqual(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/review-loop/agent-runner.test.ts -t "AgentRunResult"`
Expected: FAIL — `result.value` is undefined because `runAgent` returns `T` directly today.

- [ ] **Step 3: Update `runAgent` to return `AgentRunResult<T>`**

In `review-loop/src/agent-runner.ts`:

1. Add the new types at the top of the file (after the existing `SpawnFn` type):

```typescript
export interface AgentUsage {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  costUsd: number
  wallMs: number
}

export interface AgentRunResult<T> {
  value: T
  usage: AgentUsage
}
```

2. Add a usage accumulator field to `LiveCtx`:

```typescript
interface LiveCtx {
  // ...existing fields...
  usage: AgentUsage
  firstStepAt: number | null
}
```

3. Update `createLineHandler` initialization to include `usage` and `firstStepAt: null`:

```typescript
const ctx: LiveCtx = {
  // ...existing fields...
  usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0, wallMs: 0 },
  firstStepAt: null,
}
```

4. Update `applyEvent` for `step_start` to record `firstStepAt`:

```typescript
case 'step_start':
  if (ctx.firstStepAt === null) ctx.firstStepAt = Date.now()
  if (ctx.startedAt === 0) { /* existing */ }
  break
```

5. Update `applyEvent` for `step_finish` to accumulate usage:

```typescript
case 'step_finish':
  ctx.usage.inputTokens += evt.tokens.input
  ctx.usage.outputTokens += evt.tokens.output
  ctx.usage.reasoningTokens += evt.tokens.reasoning
  ctx.usage.costUsd += evt.cost
  // ...existing reporter.event(formatStepFooter(...))...
  break
```

6. Change `runAgent` to compute `wallMs` and return the wrapped result. Replace the current `runAgent` body:

```typescript
export async function runAgent<T>(options: RunAgentOptions<T>): Promise<AgentRunResult<T>> {
  const handler = createLineHandler(options)
  const finalize = (value: T): AgentRunResult<T> => ({
    value,
    usage: {
      ...handler.ctx.usage,
      wallMs: handler.ctx.firstStepAt === null ? 0 : Date.now() - handler.ctx.firstStepAt,
    },
  })
  try {
    const first = await runAttempt(options)
    if (first.ok) return finalize(first.value)
    if (first.timedOut) throw first.error
    options.onRetry?.()
    const second = await runAttempt(options)
    if (second.ok) return finalize(second.value)
    throw second.error
  } finally {
    handler.dispose()
  }
}
```

Note: `handler.ctx` needs to be accessible — adjust the `LineHandler` interface to expose `ctx` as a readonly field if it isn't already.

- [ ] **Step 4: Update the 3 existing callers to extract `.value`**

In `review-loop/src/loop-controller.ts:109`:

```typescript
const reviewResult = (
  await runAgent({
    /* ... */
  })
).value
```

In `review-loop/src/issue-matcher.ts` (find the `runAgent` call):

```typescript
const matches = (
  await runAgent({
    /* ... */
  })
).value
```

In `review-loop/src/issue-processor.ts` `runFixer`:

```typescript
function runFixer(deps: IssueProcessorDeps, prompt: string, label: string): Promise<FixerResult> {
  return runAgent({
    /* ... */
  }).then((r) => r.value)
}
```

(Keeps the existing `runFixer` signature unchanged — usage is discarded for now; Task 4 captures it.)

- [ ] **Step 5: Run all review-loop tests + typecheck**

Run: `bun run review-loop:test && bun run review-loop:typecheck`
Expected: PASS. All existing tests still pass with `.value` extraction; the new return-type test passes.

- [ ] **Step 6: Commit**

```bash
git add review-loop/src/agent-runner.ts review-loop/src/loop-controller.ts review-loop/src/issue-matcher.ts review-loop/src/issue-processor.ts tests/review-loop/agent-runner.test.ts
git commit -m "refactor(review-loop): runAgent returns AgentRunResult with usage data"
```

---

## Task 4: Inspector integration with unified retry budget

The biggest task: add the inspector gate between build-pass and merge, and refactor `processIssue` to a single attempt-counter loop where build-failure and inspector-rejection share the retry budget.

Serial execution preserved (no pool yet — Task 6 adds it).

**Files:**

- Create: `review-loop/src/issue-inspector.ts`
- Modify: `review-loop/src/run-state.ts` (add `inspectPath`)
- Modify: `review-loop/src/issue-processor.ts` (refactor `processIssue`, add inspector gate, thread usage into collector)
- Test: `tests/review-loop/issue-inspector.test.ts`
- Test: `tests/review-loop/issue-processor.test.ts` (extend with all state-graph branches)
- Test: `tests/review-loop/test-helpers.ts` (add `mockSpawnForFixerAndInspector`)

**Interfaces:**

- Consumes: `InspectorResultSchema` (Task 1); `buildInspectPrompt`, `buildRetryFixWithInspectorFeedbackPrompt` (Task 1); `tallyInspector`, `tallyPhaseMs`, `tallyUsage`, `emitInspectComplete` (Task 2); `AgentRunResult<T>.usage` (Task 3).
- Produces: `runInspector(deps, worker, issue, baselineSha, fixerReasoning): Promise<InspectorResult & { usage: AgentUsage }>` exported from `issue-inspector.ts`. New `RetryReason` discriminated union in `issue-processor.ts`. Updated `processIssue` that threads `Worker`-shaped handle (a thin interface introduced here; Task 6's `WorkerPool` will satisfy it).

- [ ] **Step 1: Add `inspectPath` to `run-state.ts`**

In `review-loop/src/run-state.ts`:

1. Add `inspectPath: string` to the `RunState` interface (after `resultPath`).
2. In `createRunState`, set `inspectPath: path.join(runDir, 'inspect.json')`.
3. In `loadRunState`, set `inspectPath: path.join(runDir, 'inspect.json')`.

- [ ] **Step 2: Write failing inspector wrapper test**

Create `tests/review-loop/issue-inspector.test.ts`:

```typescript
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { SpawnFn, SpawnResult } from '../../review-loop/src/agent-runner.js'
import type { ReviewerIssue } from '../../review-loop/src/issue-schema.js'
import { runInspector } from '../../review-loop/src/issue-inspector.js'
import { createRunState } from '../../review-loop/src/run-state.js'
import { execGit } from '../../review-loop/src/worktree.js'
import { cleanupTempDirs, createReviewLoopConfigFixture, makeTempDir, silentReporter } from './test-helpers.js'
import { createCapturingTraceLogger } from '../../review-loop/src/trace-log.js'

afterEach(cleanupTempDirs)

const issue: ReviewerIssue = {
  title: 'x',
  severity: 'low',
  summary: 's',
  whyItMatters: 'w',
  evidence: 'e',
  file: 'src/q.ts',
  lineStart: 1,
  lineEnd: 2,
  suggestedFix: 'f',
  confidence: 0.9,
}

function mockSpawnInspect(addresses: boolean): SpawnFn {
  return (_cmd, args, opts) => {
    const prompt = args[args.length - 1] ?? ''
    const outputPath = prompt.match(/JSON to:\s*(\S+)/u)?.[1]
    if (prompt.includes('You are an inspector') && outputPath !== undefined) {
      writeFileSync(path.join(opts.cwd, outputPath), JSON.stringify({ addresses, reasoning: 'mock', confidence: 0.8 }))
    }
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' } satisfies SpawnResult)
  }
}

async function setupRepo(repoPath: string): Promise<void> {
  mkdirSync(repoPath, { recursive: true })
  await execGit(repoPath, ['init'])
  await execGit(repoPath, ['config', 'user.email', 't@t.com'])
  await execGit(repoPath, ['config', 'user.name', 'T'])
  writeFileSync(path.join(repoPath, 'README.md'), 'hi')
  await execGit(repoPath, ['add', '.'])
  await execGit(repoPath, ['commit', '-m', 'init'])
}

describe('runInspector', () => {
  test('returns InspectorResult with addresses=true when agent accepts', async () => {
    const repoRoot = makeTempDir('inspector-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const runState = await createRunState(config, path.join(repoRoot, 'plan.md'))
    await setupRepo(runState.worktreePath)
    const { logger } = createCapturingTraceLogger()
    const result = await runInspector(
      {
        spawn: mockSpawnInspect(true),
        cwd: runState.worktreePath,
        issue,
        baselineSha: 'HEAD',
        outputPath: runState.inspectPath,
        logPath: runState.logPath,
        reporter: silentReporter(),
        model: 'm',
        extraArgs: [],
      },
      1,
      'rec-1',
      logger,
    )
    expect(result.addresses).toBe(true)
    expect(result.usage).toBeDefined()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test tests/review-loop/issue-inspector.test.ts`
Expected: FAIL — `runInspector` does not exist.

- [ ] **Step 4: Create `issue-inspector.ts`**

Create `review-loop/src/issue-inspector.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { agentWritePath, runAgent, type AgentUsage, type SpawnFn } from './agent-runner.js'
import { execGit } from './worktree.js'
import { buildInspectPrompt } from './prompt-templates.js'
import { InspectorResultSchema, type InspectorResult, type ReviewerIssue } from './issue-schema.js'
import { emitInspectComplete, tallyInspector } from './loop-trace.js'
import type { RoundCollector } from './loop-trace.js'
import type { ProgressReporter } from './progress-log.js'
import type { TraceLogger } from './trace-log.js'

export interface RunInspectorDeps {
  spawn: SpawnFn
  cwd: string
  issue: ReviewerIssue
  baselineSha: string
  outputPath: string
  logPath: string
  reporter: ProgressReporter
  model: string
  extraArgs: readonly string[]
  timeoutMs?: number
}

export async function runInspector(
  deps: RunInspectorDeps,
  round: number,
  issueId: string,
  trace: TraceLogger,
  collector?: RoundCollector,
): Promise<InspectorResult & { usage: AgentUsage }> {
  const { stdout: diff } = await execGit(deps.cwd, ['diff', `${deps.baselineSha}..HEAD'])
  const result = await runAgent({
    spawn: deps.spawn,
    model: deps.model,
    cwd: deps.cwd,
    prompt: buildInspectPrompt(deps.issue, diff, '', agentWritePath(deps.outputPath)),
    outputPath: deps.outputPath,
    outputSchema: InspectorResultSchema,
    label: 'inspector',
    reporter: deps.reporter,
    logPath: deps.logPath,
    extraArgs: deps.extraArgs,
    timeoutMs: deps.timeoutMs,
  })
  emitInspectComplete(trace, round, issueId, result.value.addresses, result.value.confidence, result.value.reasoning)
  collector && tallyInspector(collector, result.value.addresses)
  return { ...result.value, usage: result.usage }
}
```

Note: `fixerReasoning` is wired into the prompt in Task 4 Step 8 when `processIssue` is refactored. For this isolated test, it's empty — the test asserts shape only.

- [ ] **Step 5: Run the inspector test to verify it passes**

Run: `bun test tests/review-loop/issue-inspector.test.ts`
Expected: PASS.

- [ ] **Step 6: Add `mockSpawnForFixerAndInspector` shared helper**

Append to `tests/review-loop/test-helpers.ts`:

```typescript
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import type { SpawnFn, SpawnResult } from '../../review-loop/src/agent-runner.js'
import type { Verdict } from '../../review-loop/src/issue-schema.js'

export function mockSpawnForFixerAndInspector(opts: {
  fixerVerdict?: Verdict
  fixerFixed?: boolean
  inspectorAddresses?: boolean
  inspectorCallCount?: { current: number } // mutable counter for sequential test scenarios
  fixerCallCount?: { current: number }
}): SpawnFn {
  return (_cmd, args, spawnOpts) => {
    const prompt = args[args.length - 1] ?? ''
    const outputPath = prompt.match(/(?:to|JSON to):\s*(\S+)/u)?.[1]
    if (outputPath === undefined) return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' } satisfies SpawnResult)

    if (prompt.includes('You are an inspector')) {
      opts.inspectorCallCount && (opts.inspectorCallCount.current += 1)
      writeFileSync(
        path.join(spawnOpts.cwd, outputPath),
        JSON.stringify({
          addresses: opts.inspectorAddresses ?? true,
          reasoning: 'mock inspector reasoning',
          confidence: 0.9,
        }),
      )
    } else if (prompt.includes('Verify and fix') || prompt.includes('rejected by an inspector')) {
      opts.fixerCallCount && (opts.fixerCallCount.current += 1)
      writeFileSync(
        path.join(spawnOpts.cwd, outputPath),
        JSON.stringify({
          verdict: opts.fixerVerdict ?? 'valid',
          fixability: 'auto',
          fixed: opts.fixerFixed ?? true,
          reasoning: 'mock fixer reasoning',
          targetFiles: [],
          commitSha: 'abc',
          commitMessage: 'fix: mock',
          severity: 'low',
        }),
      )
      writeFileSync(path.join(spawnOpts.cwd, 'fixed.ts'), 'ok\n')
    }
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' } satisfies SpawnResult)
  }
}
```

- [ ] **Step 7: Write failing state-graph tests**

Extend `tests/review-loop/issue-processor.test.ts`. Add tests for each state-graph branch (one test per branch). Examples:

```typescript
import { describe, expect, test } from 'bun:test'

describe('processIssue unified retry budget', () => {
  test('fixer verdict invalid → terminal rejected, no inspector call', async () => {
    // Setup repo, runState, ledger with one issue.
    // mockSpawnForFixerAndInspector({ fixerVerdict: 'invalid', fixerFixed: false })
    // Run processPendingIssues.
    // Assert: ledger record status === 'rejected'; no inspect.json written.
  })

  test('fixer valid + build pass + inspector accepts → merged, fixed', async () => {
    // mockSpawnForFixerAndInspector({ inspectorAddresses: true })
    // Assert: status === 'fixed_pending_review'; commit on worktree branch.
  })

  test('fixer valid + build pass + inspector rejects → retry with feedback', async () => {
    // Two-call mock: first inspector addresses=false, second addresses=true.
    // Assert: 2 fixer calls, 2 inspector calls, final status fixed_pending_review.
  })

  test('fixer retry + inspector rejects again → terminal needs_human', async () => {
    // Both inspector calls addresses=false.
    // Assert: status === 'needs_human'.
  })

  test('fixer retry returns verdict invalid (agrees with inspector) → terminal rejected', async () => {
    // First fixer valid+fixed, inspector rejects. Second fixer verdict=invalid.
    // Assert: status === 'rejected'; only 2 fixer calls.
  })

  test('fixer valid + build fails (attempt 1) → retry with build error', async () => {
    // First build fails, second passes. Inspector accepts.
    // Assert: 2 fixer calls, 1 inspector call (only after build passes), fixed.
  })

  test('fixer retry + build fails → terminal needs_human', async () => {
    // Both builds fail.
    // Assert: status === 'needs_human'; no inspector call.
  })
})
```

(Fill in each test with the full setup pattern from the existing `processPendingIssues` test in that file — same `setupRepo`, `createRunState`, `createIssueLedger`, etc.)

- [ ] **Step 8: Refactor `processIssue` to unified attempt loop**

In `review-loop/src/issue-processor.ts`, replace the existing `processIssue`, `retryFixAfterBuildFailure`, and `processNextIssue` functions with the unified version. Add the imports for the inspector:

```typescript
import { runInspector } from './issue-inspector.js'
import type { RetryReason } from './issue-processor.js' // self-import for type alias
```

Add the discriminated union near the top of the file:

```typescript
export type RetryReason =
  | { kind: 'build_failure'; buildError: string }
  | { kind: 'inspector_rejection'; inspectorReasoning: string }

const MAX_ATTEMPTS = 2
```

Define a thin worker-handle interface that Task 6's `WorkerPool.Worker` will satisfy (for now, both serial and pool paths can construct one):

```typescript
export interface IssueWorker {
  readonly worktreePath: string
  headSha(): Promise<string>
  resetToBaseline(sha: string): Promise<void>
}
```

Replace `processIssue` with:

```typescript
async function processIssue(
  record: LedgerIssueRecord,
  deps: IssueProcessorDeps,
  worker: IssueWorker,
  round: number,
  collector: RoundCollector,
): Promise<{ fixed: boolean }> {
  let attempt = 1
  let retryReason: RetryReason | null = null

  while (true) {
    const baselineSha = await worker.headSha()
    const prompt = buildAttemptPrompt(deps, record, retryReason)
    const fixerStart = Date.now()
    const fixerResult = (await runFixerRaw(deps, prompt, `fixer${attempt > 1 ? `-retry` : ''}`)).value
    tallyPhaseMs(collector, 'verify', Date.now() - fixerStart)
    tallyUsage(collector, (await runFixerRaw(deps, prompt, `fixer-usage-only${attempt}`)).usage)
    recordVerify(deps, round, record, fixerResult)

    // Branch A: fixer verdict says don't fix
    if (!fixerResult.fixed || fixerResult.verdict !== 'valid') {
      await worker.resetToBaseline(baselineSha)
      tallyFixOutcome(collector, fixerResult)
      deps.log.log(`[fix] "${shortTitle(record)}" → ${fixerResult.verdict}`)
      emitFixComplete(deps.trace, round, record.id, false, null, attempt)
      return { fixed: false }
    }

    // Branch B: build check
    const buildStart = Date.now()
    const buildResult = await runBuildWithLogging(deps)
    tallyPhaseMs(collector, 'build', Date.now() - buildStart)
    emitBuildComplete(deps.trace, round, record.id, buildResult.passed, attempt, Date.now() - buildStart)

    if (!buildResult.passed) {
      if (attempt >= MAX_ATTEMPTS) {
        await worker.resetToBaseline(baselineSha)
        recordNeedsHuman(deps, round, record, `Build failed after retry: ${buildResult.stderr}`, fixerResult)
        tallyDecision(collector, 'needs_human', false)
        tallyFixerSeverity(collector, fixerResult.severity)
        deps.log.log(`[fix] "${shortTitle(record)}" → needs_human (build failed)`)
        emitFixComplete(deps.trace, round, record.id, false, null, attempt)
        return { fixed: false }
      }
      retryReason = { kind: 'build_failure', buildError: buildResult.stderr }
      attempt += 1
      await worker.resetToBaseline(baselineSha)
      continue
    }

    // Branch C: inspector gate
    const inspectStart = Date.now()
    const inspectorConfig = deps.config.inspector ?? deps.config.fixer
    const inspectorResult = await runInspector(
      {
        spawn: deps.spawn,
        cwd: worker.worktreePath,
        issue: record.issue,
        baselineSha,
        outputPath: deps.runState.inspectPath,
        logPath: deps.runState.logPath,
        reporter: deps.log,
        model: inspectorConfig.model,
        extraArgs: inspectorConfig.extraArgs,
        timeoutMs: inspectorConfig.timeoutMs ?? deps.config.agentTimeoutMs,
      },
      round,
      record.id,
      deps.trace,
      collector,
    )
    tallyPhaseMs(collector, 'inspect', Date.now() - inspectStart)
    tallyUsage(collector, inspectorResult.usage)

    if (!inspectorResult.addresses) {
      if (attempt >= MAX_ATTEMPTS) {
        await worker.resetToBaseline(baselineSha)
        recordNeedsHuman(deps, round, record, `Inspector rejected twice: ${inspectorResult.reasoning}`, fixerResult)
        tallyDecision(collector, 'inspector_rejected', false)
        tallyFixerSeverity(collector, fixerResult.severity)
        deps.log.log(`[fix] "${shortTitle(record)}" → needs_human (inspector rejected)`)
        emitFixComplete(deps.trace, round, record.id, false, null, attempt)
        return { fixed: false }
      }
      retryReason = { kind: 'inspector_rejection', inspectorReasoning: inspectorResult.reasoning }
      attempt += 1
      await worker.resetToBaseline(baselineSha)
      continue
    }

    // Branch D: commit + finalize
    const mergeStart = Date.now()
    const postSha = await ensureFixerChangesCommitted(deps, record, fixerResult.commitMessage)
    tallyPhaseMs(collector, 'fix', Date.now() - mergeStart)
    if (postSha === baselineSha) {
      collector.decisions.no_commit += 1
      tallyFixerSeverity(collector, fixerResult.severity)
      emitFixComplete(deps.trace, round, record.id, false, null, attempt)
      deps.log.log(`[fix] "${shortTitle(record)}" → no change (fixed:true was a false claim)`)
      return { fixed: false }
    }
    recordFixAttempt(deps.ledger, record.id)
    tallyFixOutcome(collector, fixerResult)
    deps.log.log(
      attempt === 1 ? `[fix] "${shortTitle(record)}" → fixed` : `[fix] "${shortTitle(record)}" → fixed (after retry)`,
    )
    emitFixComplete(deps.trace, round, record.id, true, postSha, attempt)
    return { fixed: true }
  }
}

function buildAttemptPrompt(
  deps: IssueProcessorDeps,
  record: LedgerIssueRecord,
  retryReason: RetryReason | null,
): string {
  if (retryReason === null) {
    return buildFixPrompt(record.issue, agentWritePath(deps.runState.resultPath), deps.config.checkCommand)
  }
  if (retryReason.kind === 'build_failure') {
    return buildRetryFixPrompt(
      record.issue,
      agentWritePath(deps.runState.resultPath),
      retryReason.buildError,
      deps.config.checkCommand,
    )
  }
  return buildRetryFixWithInspectorFeedbackPrompt(
    record.issue,
    retryReason.inspectorReasoning,
    agentWritePath(deps.runState.resultPath),
    deps.config.checkCommand,
  )
}
```

Note: `runFixer` was a thin wrapper. To capture both `.value` and `.usage`, expose a new internal helper `runFixerRaw(deps, prompt, label): Promise<AgentRunResult<FixerResult>>` that returns the full result. Step 9 below addresses the double-call issue.

- [ ] **Step 9: Fix the double-call issue — capture usage in one call**

The Step 8 snippet above calls `runFixerRaw` twice to get value then usage. That's wrong. Replace the two calls with one:

```typescript
const fixerStart = Date.now()
const fixerAgentResult = await runFixerRaw(deps, prompt, `fixer${attempt > 1 ? `-retry` : ''}`)
tallyPhaseMs(collector, 'verify', Date.now() - fixerStart)
tallyUsage(collector, fixerAgentResult.usage)
const fixerResult = fixerAgentResult.value
recordVerify(deps, round, record, fixerResult)
```

And add the `runFixerRaw` helper next to `runFixer`:

```typescript
function runFixerRaw(deps: IssueProcessorDeps, prompt: string, label: string): Promise<AgentRunResult<FixerResult>> {
  return runAgent({
    spawn: deps.spawn,
    model: deps.config.fixer.model,
    cwd: deps.runState.worktreePath,
    prompt,
    outputPath: deps.runState.resultPath,
    outputSchema: FixerResultSchema,
    label,
    reporter: deps.log,
    logPath: deps.runState.logPath,
    extraArgs: deps.config.fixer.extraArgs,
    timeoutMs: deps.config.fixer.timeoutMs ?? deps.config.agentTimeoutMs,
  })
}
```

Remove the old `runFixer` wrapper (now unused).

- [ ] **Step 10: Update `processPendingIssues` to construct an `IssueWorker` from the existing single worktree**

```typescript
function singleWorkerFromState(runState: RunState): IssueWorker {
  return {
    worktreePath: runState.worktreePath,
    headSha: () => execGit(runState.worktreePath, ['rev-parse', 'HEAD']).then((r) => r.stdout.trim()),
    resetToBaseline: (sha) => resetWorktreeTo(runState.worktreePath, sha),
  }
}

export async function processPendingIssues(
  deps: IssueProcessorDeps,
  round: number,
  collector: RoundCollector,
  pending: readonly LedgerIssueRecord[],
): Promise<number> {
  const worker = singleWorkerFromState(deps.runState)
  let fixed = 0
  for (const record of pending) {
    const result = await processIssue(record, deps, worker, round, collector)
    await saveIssueLedger(deps.ledger)
    if (result.fixed) fixed += 1
  }
  return fixed
}
```

- [ ] **Step 11: Run all issue-processor tests**

Run: `bun test tests/review-loop/issue-processor.test.ts`
Expected: PASS — all state-graph branches covered.

- [ ] **Step 12: Run full review-loop suite + typecheck + lint**

Run: `bun run review-loop:test && bun run review-loop:typecheck && bun run review-loop:lint`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add review-loop/src/issue-inspector.ts review-loop/src/issue-processor.ts review-loop/src/run-state.ts tests/review-loop/issue-inspector.test.ts tests/review-loop/issue-processor.test.ts tests/review-loop/test-helpers.ts
git commit -m "feat(review-loop): inspector gate with unified retry budget"
```

---

## Task 5: Worker pool module

New module: K git worktrees, acquire/release with file-set awareness, rebase+ff merge-back, primary-branch mutex.

**Files:**

- Create: `review-loop/src/worker-pool.ts`
- Modify: `review-loop/src/worktree.ts` (add `rebaseOnto`, `mergeFastForward`, `cleanWorkerWorktrees`)
- Modify: `review-loop/src/config.ts` (add `poolSize` default)
- Test: `tests/review-loop/worker-pool.test.ts`
- Test: `tests/review-loop/config.test.ts`

**Interfaces:**

- Consumes: `execGit`, `resetWorktreeTo` from `worktree.ts`; `ReviewLoopConfig.poolSize`; `RunState.worktreePath` (primary), `RunState.runId`.
- Produces: `Worker` interface, `WorkerPool` interface, `createWorkerPool(config, runState): Promise<WorkerPool>`.

- [ ] **Step 1: Add `poolSize` to config**

In `review-loop/src/config.ts`, add to `ReviewLoopConfigSchema`:

```typescript
poolSize: z.number().int().positive().default(3),
```

- [ ] **Step 2: Write failing config test**

Add to `tests/review-loop/config.test.ts`:

```typescript
test('poolSize defaults to 3 when absent', () => {
  const parsed = ReviewLoopConfigSchema.parse({
    workDir: '.review-loop',
    reviewer: { model: 'm' },
    fixer: { model: 'm' },
    matcher: { model: 'm' },
  })
  expect(parsed.poolSize).toBe(3)
})

test('poolSize respects provided value', () => {
  const parsed = ReviewLoopConfigSchema.parse({
    workDir: '.review-loop',
    poolSize: 5,
    reviewer: { model: 'm' },
    fixer: { model: 'm' },
    matcher: { model: 'm' },
  })
  expect(parsed.poolSize).toBe(5)
})
```

- [ ] **Step 3: Run config test to verify it passes**

Run: `bun test tests/review-loop/config.test.ts`
Expected: PASS (the schema field was added in Step 1).

- [ ] **Step 4: Add worktree helpers**

In `review-loop/src/worktree.ts`, append:

```typescript
export async function rebaseOnto(
  repoRoot: string,
  ontoRef: string,
  branch: string,
): Promise<{ ok: true } | { ok: false; conflictFiles: string[] }> {
  const { stdout, stderr } = await execGit(repoRoot, ['rebase', ontoRef, branch])
  // git rebase prints conflicts to stdout, errors to stderr
  const combined = `${stdout}\n${stderr}`
  if (combined.includes('CONFLICT') || combined.includes('could not apply')) {
    await execGit(repoRoot, ['rebase', '--abort']).catch(() => {})
    const conflictFiles = parseConflictFiles(combined)
    return { ok: false, conflictFiles }
  }
  return { ok: true }
}

export async function mergeFastForward(repoRoot: string, branch: string): Promise<string> {
  const { stdout } = await execGit(repoRoot, ['merge', '--ff-only', branch])
  // The new HEAD SHA is on the line starting with "Updating" or we re-read it
  const head = await execGit(repoRoot, ['rev-parse', 'HEAD'])
  return head.stdout.trim()
}

function parseConflictFiles(output: string): string[] {
  const files = new Set<string>()
  for (const line of output.split('\n')) {
    const m = line.match(/^(?:CONFLICT .*:|both modified:|added by them:|added by us:)\s+(.+)$/u)
    if (m !== null) files.add(m[1]!.trim())
  }
  return [...files]
}

export async function cleanWorkerWorktrees(repoRoot: string, runId: string): Promise<void> {
  // Remove stale worker worktrees from a crashed prior run.
  const { stdout } = await execGit(repoRoot, ['worktree', 'list', '--porcelain'])
  const lines = stdout.split('\n')
  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      const wtPath = line.slice('worktree '.length)
      if (wtPath.includes(`${runId}-worker-`)) {
        await execGit(repoRoot, ['worktree', 'remove', wtPath, '--force']).catch(() => {})
      }
    }
  }
}
```

- [ ] **Step 5: Write the failing pool tests**

Create `tests/review-loop/worker-pool.test.ts`:

```typescript
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { createReviewLoopConfigFixture, cleanupTempDirs, makeTempDir } from './test-helpers.js'
import { createWorkerPool } from '../../review-loop/src/worker-pool.js'
import { createRunState } from '../../review-loop/src/run-state.js'
import { execGit, createWorktree } from '../../review-loop/src/worktree.js'

afterEach(cleanupTempDirs)

async function setupPrimary(repoRoot: string, runId: string, runStatePath: string): Promise<void> {
  mkdirSync(repoRoot, { recursive: true })
  await execGit(repoRoot, ['init'])
  await execGit(repoRoot, ['config', 'user.email', 't@t.com'])
  await execGit(repoRoot, ['config', 'user.name', 'T'])
  writeFileSync(path.join(repoRoot, 'README.md'), 'init')
  await execGit(repoRoot, ['add', '.'])
  await execGit(repoRoot, ['commit', '-m', 'init'])
  // Create the primary worktree (mimics cli.ts setup)
  await createWorktree(repoRoot, runStatePath, runId)
}

describe('WorkerPool', () => {
  test('creates K worker worktrees + branches at construction; closes cleanly', async () => {
    const repoRoot = makeTempDir('pool-')
    const config = createReviewLoopConfigFixture(repoRoot, { poolSize: 3 })
    const runState = await createRunState(config, path.join(repoRoot, 'plan.md'))
    await setupPrimary(repoRoot, runState.runId, runState.worktreePath)

    const pool = await createWorkerPool(config, runState)
    for (let i = 1; i <= 3; i++) {
      const workerPath = path.join(config.workDir, 'worktrees', `${runState.runId}-worker-${i}`)
      expect(existsSync(workerPath)).toBe(true)
    }

    await pool.close()
    for (let i = 1; i <= 3; i++) {
      const workerPath = path.join(config.workDir, 'worktrees', `${runState.runId}-worker-${i}`)
      expect(existsSync(workerPath)).toBe(false)
    }
  })

  test('acquire returns a free worker; release makes it available again', async () => {
    // ...setup...
    const pool = await createWorkerPool(config, runState)
    const w = await pool.acquire('src/a.ts')
    expect(w.busy).toBe(true)
    pool.release(w)
    const w2 = await pool.acquire('src/a.ts')
    expect(w2.id).toBe(w.id)
    await pool.close()
  })

  test('acquire blocks when all busy; resolves on release', async () => {
    // K=1 pool; second acquire blocks until first releases.
    const config = createReviewLoopConfigFixture(repoRoot, { poolSize: 1 })
    const pool = await createWorkerPool(config, runState)
    const w1 = await pool.acquire('src/a.ts')
    let acquired = false
    const p = pool.acquire('src/b.ts').then((w) => {
      acquired = true
      return w
    })
    expect(acquired).toBe(false)
    pool.release(w1)
    const w2 = await p
    expect(acquired).toBe(true)
    await pool.close()
  })

  test('acquire prefers workers whose peers are not touching the requested file', async () => {
    const config = createReviewLoopConfigFixture(repoRoot, { poolSize: 2 })
    const pool = await createWorkerPool(config, runState)
    const w1 = await pool.acquire('src/a.ts') // locks src/a.ts on worker 1
    const w2 = await pool.acquire('src/b.ts') // locks src/b.ts on worker 2
    pool.release(w1) // worker 1 free again
    const w3 = await pool.acquire('src/b.ts') // asks for src/b.ts → worker 1 is preferred (peer has b.ts locked)
    expect(w3.id).toBe(w1.id)
    await pool.close()
  })

  test('mergeWorkerIntoPrimary fast-forwards when primary has not moved', async () => {
    const pool = await createWorkerPool(config, runState)
    const w = await pool.acquire('src/a.ts')
    writeFileSync(path.join(w.worktreePath, 'fix.txt'), 'fixed')
    await execGit(w.worktreePath, ['add', '.'])
    await execGit(w.worktreePath, ['commit', '-m', 'fix'])
    const result = await pool.mergeWorkerIntoPrimary(w)
    expect(result.ok).toBe(true)
    pool.release(w)
    await pool.close()
  })

  test('mergeWorkerIntoPrimary rebases when primary moved, then ff-merges', async () => {
    // Worker commits to its branch, then primary advances (another worker merges),
    // then this worker merges — should succeed via rebase.
    const config = createReviewLoopConfigFixture(repoRoot, { poolSize: 2 })
    const pool = await createWorkerPool(config, runState)
    const w1 = await pool.acquire('src/a.ts')
    const w2 = await pool.acquire('src/b.ts')
    // w1 makes a fix touching a.txt, merges
    writeFileSync(path.join(w1.worktreePath, 'a.txt'), 'a')
    await execGit(w1.worktreePath, ['add', '.'])
    await execGit(w1.worktreePath, ['commit', '-m', 'a'])
    await pool.mergeWorkerIntoPrimary(w1)
    pool.release(w1)
    // w2 makes a fix touching b.txt, merges (primary has moved)
    writeFileSync(path.join(w2.worktreePath, 'b.txt'), 'b')
    await execGit(w2.worktreePath, ['add', '.'])
    await execGit(w2.worktreePath, ['commit', '-m', 'b'])
    const result = await pool.mergeWorkerIntoPrimary(w2)
    expect(result.ok).toBe(true)
    pool.release(w2)
    await pool.close()
  })

  test('mergeWorkerIntoPrimary returns conflictFiles on overlapping edit', async () => {
    // Both workers edit the SAME file at the SAME line → rebase conflict.
    const config = createReviewLoopConfigFixture(repoRoot, { poolSize: 2 })
    const pool = await createWorkerPool(config, runState)
    const w1 = await pool.acquire('src/same.txt')
    writeFileSync(path.join(w1.worktreePath, 'src/same.txt'), 'w1 edit\n')
    await execGit(w1.worktreePath, ['add', '.'])
    await execGit(w1.worktreePath, ['commit', '-m', 'w1'])
    await pool.mergeWorkerIntoPrimary(w1)
    pool.release(w1)
    const w2 = await pool.acquire('src/other.txt') // different file, but we'll edit same.txt
    writeFileSync(path.join(w2.worktreePath, 'src/same.txt'), 'w2 conflicting edit\n')
    await execGit(w2.worktreePath, ['add', '.'])
    await execGit(w2.worktreePath, ['commit', '-m', 'w2'])
    const result = await pool.mergeWorkerIntoPrimary(w2)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.conflictFiles.length).toBeGreaterThan(0)
    }
    pool.release(w2)
    await pool.close()
  })
})
```

(Fill in the `// ...setup...` markers with the same setup pattern as the first test.)

- [ ] **Step 6: Run the tests to verify they fail**

Run: `bun test tests/review-loop/worker-pool.test.ts`
Expected: FAIL — `createWorkerPool` does not exist.

- [ ] **Step 7: Create `worker-pool.ts`**

Create `review-loop/src/worker-pool.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import type { ReviewLoopConfig } from './config.js'
import type { RunState } from './run-state.js'
import { execGit, rebaseOnto, mergeFastForward, removeWorktree } from './worktree.js'

export interface Worker {
  readonly id: number
  readonly worktreePath: string
  readonly branch: string
  busy: boolean
  lockedFiles: ReadonlySet<string>
  headSha(): Promise<string>
  resetToBaseline(sha: string): Promise<void>
}

export interface WorkerPool {
  acquire(primaryFile: string): Promise<Worker>
  release(worker: Worker): void
  mergeWorkerIntoPrimary(worker: Worker): Promise<{ ok: true } | { ok: false; conflictFiles: string[] }>
  primaryHead(): Promise<string>
  primaryWorktreePath: string
  primaryBranch: string
  close(): Promise<void>
}

interface PoolInternals {
  workers: Worker[]
  waiters: Array<() => void>
  primaryMutex: Promise<void>
}

export async function createWorkerPool(config: ReviewLoopConfig, runState: RunState): Promise<WorkerPool> {
  const primaryBranch = `review-loop/${runState.runId}`
  const primaryWorktreePath = runState.worktreePath
  const primarySha = (await execGit(primaryWorktreePath, ['rev-parse', 'HEAD'])).stdout.trim()

  const internals: PoolInternals = {
    workers: [],
    waiters: [],
    primaryMutex: Promise.resolve(),
  }

  for (let i = 1; i <= config.poolSize; i++) {
    const id = i
    const worktreePath = path.join(config.workDir, 'worktrees', `${runState.runId}-worker-${id}`)
    const branch = `${primaryBranch}-worker-${id}`
    await execGit(primaryWorktreePath, ['worktree', 'add', worktreePath, '-b', branch, primarySha])
    internals.workers.push({
      id,
      worktreePath,
      branch,
      busy: false,
      lockedFiles: new Set(),
      headSha: () => execGit(worktreePath, ['rev-parse', 'HEAD']).then((r) => r.stdout.trim()),
      resetToBaseline: async (sha: string) => {
        await execGit(worktreePath, ['reset', '--hard', sha])
        await execGit(worktreePath, ['clean', '-fdx', '-e', '.review-loop'])
      },
    })
  }

  const withPrimaryLock = <T>(fn: () => Promise<T>): Promise<T> => {
    let release!: () => void
    const next = new Promise<void>((r) => {
      release = r
    })
    const prev = internals.primaryMutex
    internals.primaryMutex = next
    return prev.then(() => fn()).finally(release)
  }

  const peersTouchFile = (worker: Worker, file: string): boolean => {
    for (const w of internals.workers) {
      if (w === worker || !w.busy) continue
      if (w.lockedFiles.has(file)) return true
    }
    return false
  }

  return {
    primaryWorktreePath,
    primaryBranch,

    async acquire(primaryFile: string): Promise<Worker> {
      while (true) {
        const free = internals.workers.filter((w) => !w.busy)
        if (free.length > 0) {
          const safe = free.find((w) => !peersTouchFile(w, primaryFile)) ?? free[0]!
          safe.busy = true
          safe.lockedFiles = new Set([primaryFile])
          return safe
        }
        await new Promise<void>((resolve) => internals.waiters.push(resolve))
      }
    },

    release(worker: Worker): void {
      worker.busy = false
      worker.lockedFiles = new Set()
      const next = internals.waiters.shift()
      if (next !== undefined) next()
    },

    async mergeWorkerIntoPrimary(worker: Worker): Promise<{ ok: true } | { ok: false; conflictFiles: string[] }> {
      return withPrimaryLock(async () => {
        const rebase = await rebaseOnto(primaryWorktreePath, primaryBranch, worker.branch)
        if (!rebase.ok) return { ok: false, conflictFiles: rebase.conflictFiles }
        await mergeFastForward(primaryWorktreePath, worker.branch)
        return { ok: true }
      })
    },

    primaryHead(): Promise<string> {
      return withPrimaryLock(() => execGit(primaryWorktreePath, ['rev-parse', 'HEAD']).then((r) => r.stdout.trim()))
    },

    async close(): Promise<void> {
      for (const w of internals.workers) {
        await removeWorktree(primaryWorktreePath, w.worktreePath, w.branch.replace('review-loop/', ''))
      }
      internals.workers.length = 0
    },
  }
}
```

- [ ] **Step 8: Run pool tests + typecheck**

Run: `bun test tests/review-loop/worker-pool.test.ts && bun run review-loop:typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add review-loop/src/worker-pool.ts review-loop/src/worktree.ts review-loop/src/config.ts tests/review-loop/worker-pool.test.ts tests/review-loop/config.test.ts
git commit -m "feat(review-loop): worker pool with file-set-aware dispatch"
```

---

## Task 6: Pool integration into `issue-processor`

Replace the serial `for (const record of pending)` loop with `pool.acquire` + dispatch. Each issue's `processIssue` runs on its own worker; the merge happens inside `processIssue` after the inspector accepts.

**Files:**

- Modify: `review-loop/src/issue-processor.ts` (replace `singleWorkerFromState` loop with pool dispatch + merge-back)
- Modify: `review-loop/src/loop-controller.ts` (construct pool, pass to processor, tear down)
- Test: `tests/review-loop/issue-processor.test.ts` (parallel dispatch tests)
- Test: `tests/review-loop/loop-controller.test.ts` (pool construction/cleanup)

**Interfaces:**

- Consumes: `WorkerPool`, `Worker`, `createWorkerPool` from `worker-pool.ts` (Task 5); `IssueWorker` interface from Task 4 (the `Worker` from the pool satisfies it structurally).
- Produces: Updated `processPendingIssues` that takes `pool: WorkerPool` in `IssueProcessorDeps`; merge happens inside `processIssue` on success.

- [ ] **Step 1: Add `WorkerPool` to `IssueProcessorDeps`**

In `review-loop/src/issue-processor.ts`:

1. Update the `IssueProcessorDeps` interface:

```typescript
export interface IssueProcessorDeps {
  config: ReviewLoopConfig
  runState: RunState
  ledger: IssueLedger
  spawn: SpawnFn
  exec: ShellExecFn
  log: ProgressReporter
  trace: TraceLogger
  pool: WorkerPool
  inspect?: boolean // false when --no-inspect is passed; defaults to true
}
```

2. Add imports:

```typescript
import type { WorkerPool } from './worker-pool.js'
```

3. Remove the `singleWorkerFromState` helper (no longer needed).

- [ ] **Step 2: Update `processIssue` to use pool worker + merge**

The `IssueWorker` interface from Task 4 already matches the `Worker` interface from Task 5 structurally. Update `processIssue` to:

- Take `worker: Worker` (instead of `IssueWorker`).
- After inspector accepts and `ensureFixerChangesCommitted` succeeds, call `pool.mergeWorkerIntoPrimary(worker)`. On conflict, mark `needs_human` with merge conflict reasoning and return without consuming retry budget.

Add this code in Branch D of `processIssue` (replacing the existing `postSha === baselineSha` check):

```typescript
// Branch D: commit + merge
const mergeStart = Date.now()
const postSha = await ensureFixerChangesCommitted(deps, record, fixerResult.commitMessage)
tallyPhaseMs(collector, 'fix', Date.now() - mergeStart)
if (postSha === baselineSha) {
  collector.decisions.no_commit += 1
  tallyFixerSeverity(collector, fixerResult.severity)
  emitFixComplete(deps.trace, round, record.id, false, null, attempt)
  deps.log.log(`[fix] "${shortTitle(record)}" → no change (fixed:true was a false claim)`)
  await deps.pool.release(worker)
  return { fixed: false }
}

const mergeResult = await deps.pool.mergeWorkerIntoPrimary(worker)
if (!mergeResult.ok) {
  await worker.resetToBaseline(baselineSha)
  recordNeedsHuman(deps, round, record, `Merge conflict on ${mergeResult.conflictFiles.join(', ')}`, fixerResult)
  tallyDecision(collector, 'needs_human', false)
  tallyFixerSeverity(collector, fixerResult.severity)
  deps.log.log(`[fix] "${shortTitle(record)}" → needs_human (merge conflict)`)
  emitFixComplete(deps.trace, round, record.id, false, null, attempt)
  deps.pool.release(worker)
  return { fixed: false }
}

recordFixAttempt(deps.ledger, record.id)
tallyFixOutcome(collector, fixerResult)
deps.log.log(
  attempt === 1 ? `[fix] "${shortTitle(record)}" → fixed` : `[fix] "${shortTitle(record)}" → fixed (after retry)`,
)
emitFixComplete(deps.trace, round, record.id, true, postSha, attempt)
deps.pool.release(worker)
return { fixed: true }
```

Also: every other terminal path in `processIssue` that currently returns must call `deps.pool.release(worker)` before returning. The cleanest pattern is a `try/finally` wrapping the whole loop body:

```typescript
async function processIssue(record, deps, worker, round, collector) {
  try {
    // ... existing body, returns without calling release ...
  } finally {
    deps.pool.release(worker)
  }
}
```

Then strip the explicit `release` calls from each branch.

- [ ] **Step 3: Skip inspector when `deps.inspect === false`**

In Branch C of `processIssue`, wrap the inspector call:

```typescript
if (deps.inspect !== false) {
  // ... inspector gate as before ...
  if (!inspectorResult.addresses) {
    /* ...retry logic... */
  }
}

// Branch D: proceed to merge
```

- [ ] **Step 4: Replace `processPendingIssues` with pool dispatch**

```typescript
export async function processPendingIssues(
  deps: IssueProcessorDeps,
  round: number,
  collector: RoundCollector,
  pending: readonly LedgerIssueRecord[],
): Promise<number> {
  let fixed = 0
  let index = 0
  const inFlight: Promise<void>[] = []

  const dispatchNext = async (): Promise<void> => {
    if (index >= pending.length) return
    const record = pending[index]!
    index += 1
    const worker = await deps.pool.acquire(record.issue.file)
    try {
      const result = await processIssue(record, deps, worker, round, collector)
      await saveIssueLedger(deps.ledger)
      if (result.fixed) fixed += 1
    } finally {
      // processIssue already releases the worker; nothing to do here
    }
    // Recurse to drain the queue on this "thread"
    await dispatchNext()
  }

  // Start as many dispatch coroutines as there are initial slots available.
  // Each coroutine blocks on pool.acquire until a worker is free; pool
  // concurrency naturally bounds the in-flight count to K.
  // Start one coroutine; if the pool has more than one worker, the first
  // acquire returns instantly and the second coroutine can start. To keep
  // the implementation simple, start (poolSize) coroutines.
  const concurrency = Math.min(deps.config.poolSize, pending.length)
  for (let i = 0; i < concurrency; i++) {
    inFlight.push(dispatchNext())
  }
  await Promise.all(inFlight)
  return fixed
}
```

- [ ] **Step 5: Construct pool in `loop-controller.ts`**

In `review-loop/src/loop-controller.ts`:

1. Add `pool: WorkerPool` to `ReviewLoopDeps`.
2. Pass `pool` and `inspect` (always `true` for now — Task 8 adds the CLI flag) into `IssueProcessorDeps` where `processPendingIssues` is called (around line 188).
3. The pool construction itself lives in `cli.ts` (Task 8) — `loop-controller.ts` just receives the pool.

```typescript
export interface ReviewLoopDeps {
  config: ReviewLoopConfig
  runState: RunState
  ledger: IssueLedger
  spawn: SpawnFn
  exec: ShellExecFn
  log: ProgressReporter
  trace: TraceLogger
  pool: WorkerPool
}
```

Where `processPendingIssues` is called:

```typescript
const fixedThisRound = await processPendingIssues(
  {
    config: deps.config,
    runState: deps.runState,
    ledger: deps.ledger,
    spawn: deps.spawn,
    exec: deps.exec,
    log: deps.log,
    trace: deps.trace,
    pool: deps.pool,
    inspect: true,
  },
  round,
  collector,
  pending,
)
```

- [ ] **Step 6: Write parallel dispatch tests**

Add to `tests/review-loop/issue-processor.test.ts`:

```typescript
test('K=2 pool processes 2 independent-file issues in parallel', async () => {
  // Use a fake pool that records acquire/release timestamps.
  // Assert: both workers acquired before either released (interleaved timestamps).
})

test('K=1 pool serializes (equivalent to today)', async () => {
  // Same fake pool with K=1. Assert: worker 2 acquired after worker 1 released.
})

test('merge conflict does not consume retry budget', async () => {
  // Fake pool whose mergeWorkerIntoPrimary returns ok:false on first call.
  // Assert: status === 'needs_human'; only 1 fixer attempt.
})
```

Use a `FakePool` test double that implements `WorkerPool` with in-memory state. Add it to `test-helpers.ts`:

```typescript
export function fakePool(opts: { size: number; mergeOk?: boolean; conflictFiles?: string[] }): {
  pool: WorkerPool
  workers: Worker[]
  acquireLog: number[]
  releaseLog: number[]
} {
  const workers: Worker[] = []
  for (let i = 1; i <= opts.size; i++) {
    workers.push({
      id: i,
      worktreePath: `/tmp/fake-${i}`,
      branch: `fake-${i}`,
      busy: false,
      lockedFiles: new Set(),
      headSha: async () => 'sha',
      resetToBaseline: async () => {},
    })
  }
  const acquireLog: number[] = []
  const releaseLog: number[] = []
  const waiters: Array<() => void> = []
  return {
    pool: {
      primaryWorktreePath: '/tmp/fake-primary',
      primaryBranch: 'fake-primary',
      async acquire(file) {
        acquireLog.push(Date.now())
        while (true) {
          const free = workers.filter((w) => !w.busy)
          if (free.length > 0) {
            const w = free[0]!
            w.busy = true
            w.lockedFiles = new Set([file])
            return w
          }
          await new Promise<void>((r) => waiters.push(r))
        }
      },
      release(worker) {
        releaseLog.push(Date.now())
        worker.busy = false
        worker.lockedFiles = new Set()
        const next = waiters.shift()
        if (next !== undefined) next()
      },
      async mergeWorkerIntoPrimary(worker) {
        return opts.mergeOk === false ? { ok: false, conflictFiles: opts.conflictFiles ?? ['x.ts'] } : { ok: true }
      },
      async primaryHead() {
        return 'primary-sha'
      },
      async close() {},
    },
    workers,
    acquireLog,
    releaseLog,
  }
}
```

- [ ] **Step 7: Update `loop-controller.test.ts` to construct a pool**

Every test in `loop-controller.test.ts` that calls `runReviewLoop` needs `pool: fakePool({ size: 1 }).pool` in the deps. Sweep the file:

- Import `fakePool` from `./test-helpers.js`.
- Add `pool: fakePool({ size: 1 }).pool` to every `ReviewLoopDeps` literal.

- [ ] **Step 8: Run all review-loop tests + typecheck**

Run: `bun run review-loop:test && bun run review-loop:typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add review-loop/src/issue-processor.ts review-loop/src/loop-controller.ts tests/review-loop/issue-processor.test.ts tests/review-loop/loop-controller.test.ts tests/review-loop/test-helpers.ts
git commit -m "feat(review-loop): parallel issue dispatch via worker pool"
```

---

## Task 7: Observability rollup (summary, metrics, live renderer)

Wire the tally helpers from Task 2 into all phases. Extend `summary.ts` and `metrics.json` with inspector stats, per-phase wall-clock, and total cost. Change `ProgressReporter.live` to take an array of lines.

**Files:**

- Modify: `review-loop/src/summary.ts`
- Modify: `review-loop/src/live-renderer.ts`
- Modify: `review-loop/src/progress-log.ts` (interface change)
- Modify: `review-loop/src/agent-runner.ts` (live() call site)
- Modify: `review-loop/src/loop-controller.ts` (thread usage into metrics)
- Test: `tests/review-loop/summary.test.ts`
- Test: `tests/review-loop/live-renderer.test.ts`

**Interfaces:**

- Consumes: `RoundMetric.phaseMs`, `RoundMetric.usage`, `RoundMetric.inspector`, `Decisions.inspector_rejected` (Task 2).
- Produces: extended `summary.txt` with `Pool size`, `Inspector: N runs, M rejected (X% reject rate)`, `Total cost`, per-phase `Wall clock` breakdown. `metrics.json` gains `poolSize`, `usage`, `phaseMs`, `inspectorRejected` totals. `ProgressReporter.live(lines: readonly string[])`.

- [ ] **Step 1: Write failing summary tests**

Add to `tests/review-loop/summary.test.ts` (read existing file first to match its fixture style):

```typescript
test('summary includes pool size, inspector stats, total cost, and phase wall-clock', () => {
  const metrics: RoundMetric[] = [
    {
      round: 1,
      newIssues: 3,
      cumulativeOpen: 3,
      noProgressRounds: 0,
      decisions: {
        fixed: 3,
        invalid: 0,
        already_fixed: 0,
        needs_human: 0,
        plan_drift: 0,
        no_commit: 0,
        inspector_rejected: 0,
      },
      reviewerSeverity: { critical: 0, high: 0, medium: 0, low: 3 },
      fixerSeverity: { critical: 0, high: 0, medium: 0, low: 3 },
      inspector: { runs: 3, rejected: 0 },
      phaseMs: { review: 1000, match: 100, verify: 500, build: 300, inspect: 200, fix: 50 },
      usage: { inputTokens: 1000, outputTokens: 500, reasoningTokens: 100, costUsd: 0.05 },
    },
  ]
  const summary = buildSummary('clean', 1, 3, metrics, { poolSize: 3, inspect: true })
  expect(summary).toContain('Pool size: 3')
  expect(summary).toContain('Inspector: 3 runs, 0 rejected')
  expect(summary).toContain('Total cost: $0.05')
  expect(summary).toContain('Wall clock:')
  expect(summary).toContain('review:')
  expect(summary).toContain('insp_rej')
})

test('metrics.json includes poolSize, usage, phaseMs, inspectorRejected totals', () => {
  const m = buildMetricsJson('clean', 1, 3, metricsFixture, { poolSize: 3, inspect: true })
  expect(m.poolSize).toBe(3)
  expect(m.usage.costUsd).toBeGreaterThan(0)
  expect(m.phaseMs.review).toBeGreaterThan(0)
  expect(m.totals.inspectorRejected).toBe(0)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/review-loop/summary.test.ts`
Expected: FAIL — functions don't accept the options arg or don't emit the new fields.

- [ ] **Step 3: Extend `summary.ts`**

Update `buildSummary` and `buildMetricsJson` signatures to take an options arg:

```typescript
export interface SummaryOptions {
  poolSize: number
  inspect: boolean
}

export function buildSummary(
  doneReason: string,
  rounds: number,
  closed: number,
  metrics: readonly RoundMetric[],
  options: SummaryOptions,
): string {
  // Aggregate totals across rounds
  const totalInspectorRuns = metrics.reduce((s, m) => s + m.inspector.runs, 0)
  const totalInspectorRejected = metrics.reduce((s, m) => s + m.inspector.rejected, 0)
  const totalCost = metrics.reduce((s, m) => s + m.usage.costUsd, 0)
  const totalIn = metrics.reduce((s, m) => s + m.usage.inputTokens, 0)
  const totalOut = metrics.reduce((s, m) => s + m.usage.outputTokens, 0)
  const totalReasoning = metrics.reduce((s, m) => s + m.usage.reasoningTokens, 0)
  const phaseMs = { review: 0, match: 0, verify: 0, build: 0, inspect: 0, fix: 0 }
  for (const m of metrics) for (const k of Object.keys(phaseMs) as (keyof typeof phaseMs)[]) phaseMs[k] += m.phaseMs[k]
  const rejectRate =
    totalInspectorRuns === 0 ? 'n/a' : `${((100 * totalInspectorRejected) / totalInspectorRuns).toFixed(1)}%`

  return [
    `Done reason: ${doneReason}`,
    `Rounds executed: ${rounds}`,
    options.poolSize > 1 ? `Pool size: ${options.poolSize}` : '',
    `Closed issues: ${closed}`,
    // ...existing fields...
    options.inspect
      ? `Inspector: ${totalInspectorRuns} runs, ${totalInspectorRejected} rejected (${rejectRate} reject rate)`
      : '',
    '',
    `Total cost: $${totalCost.toFixed(3)} (in ${totalIn} / out ${totalOut} / reasoning ${totalReasoning} tokens)`,
    'Wall clock:',
    `  review:  ${phaseMs.review}s`,
    `  match:   ${phaseMs.match}s`,
    `  verify:  ${phaseMs.verify}s`,
    `  build:   ${phaseMs.build}s`,
    `  inspect: ${phaseMs.inspect}s`,
    `  fix:     ${phaseMs.fix}s`,
    '',
    'Burndown:',
    'round  new  open  fixed  rejected  needs_human  plan_drift  insp_rej',
    ...metrics.map(
      (m) =>
        `${m.round}  ${m.newIssues}  ${m.cumulativeOpen}  ${m.decisions.fixed}  ${m.decisions.invalid}  ${m.decisions.needs_human}  ${m.decisions.plan_drift}  ${m.decisions.inspector_rejected}`,
    ),
  ]
    .filter(Boolean)
    .join('\n')
}
```

Apply the same totals aggregation in `buildMetricsJson`.

- [ ] **Step 4: Update callers in `cli.ts`**

Find where `buildSummary` and `buildMetricsJson` are called in `cli.ts` and pass the options:

```typescript
const summary = buildSummary(doneReason, rounds, closed, metrics, { poolSize: config.poolSize, inspect: !noInspect })
```

(`noInspect` comes from Task 8's CLI flag — default it to `false` here; Task 8 wires the flag.)

- [ ] **Step 5: Write failing live-renderer tests**

Add to `tests/review-loop/live-renderer.test.ts`:

```typescript
test('ProgressReporter.live accepts an array of lines (one per active worker)', () => {
  const lines: string[][] = []
  const renderer = new LiveRenderer({ write: (s) => true, isTTY: false })
  // The non-TTY path prints each line.
  // Use a capturing stream:
  const captured: string[] = []
  const stream = {
    write: (s: string) => {
      captured.push(s)
      return true
    },
    isTTY: false,
  }
  const r = new LiveRenderer(stream)
  r.live(['line 1', 'line 2'])
  expect(captured.join('')).toContain('line 1')
  expect(captured.join('')).toContain('line 2')
})
```

- [ ] **Step 6: Change `ProgressReporter.live` signature**

In `review-loop/src/progress-log.ts`:

```typescript
export interface ProgressReporter {
  readonly dynamic: boolean
  event(message: string): void
  live(lines: readonly string[]): void
  clearLive(): void
  log(message: string): void
}
```

In `review-loop/src/live-renderer.ts`:

1. Update `LiveRenderer.live`:

```typescript
live(lines: readonly string[]): void {
  if (!this.dynamic) {
    for (const line of lines) this.stream.write(`${line}\n`)
    return
  }
  // TTY: clear N previous lines, write N new lines
  const output = lines.map((line) => `${CLEAR_LINE}\u001b[1A${this.fit(line)}`).join('\n')
  this.stream.write(output)
  this.liveActive = lines.length > 0
}
```

2. Update `silentReporter` in `tests/review-loop/test-helpers.ts`:

```typescript
export function silentReporter(): ProgressReporter {
  return {
    dynamic: false,
    event() {},
    live() {},
    clearLive() {},
    log() {},
  }
}
```

3. Update `withLivePhase` in `live-renderer.ts` (calls `reporter.live` with a single-element array):

```typescript
timer = setInterval(() => {
  reporter.live([`[${label}] ${formatDuration(Date.now() - start)}...`])
}, 1000)
```

In `review-loop/src/agent-runner.ts`:

1. Update `LiveCtx` to track the worker label/id.
2. Update `renderLive` to call `reporter.live([line])` instead of `reporter.live(line)`.
3. Update the live-renderer array to support multiple concurrent agent runs (track per-label slots in the reporter). This is the bigger change: the reporter needs to maintain a map of `{ label → currentLine }` and pass the whole map as an array on every update.

For simplicity in this task, implement a single-slot adapter first: each agent run still calls `live([line])`. A future improvement (out of scope) composes lines from multiple concurrent runs into one array. For now, accept that parallel agents interleave their live output — the trace + agent-output.log remain authoritative.

- [ ] **Step 7: Run all review-loop tests**

Run: `bun run review-loop:test && bun run review-loop:typecheck && bun run review-loop:lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add review-loop/src/summary.ts review-loop/src/live-renderer.ts review-loop/src/progress-log.ts review-loop/src/agent-runner.ts review-loop/src/loop-controller.ts review-loop/src/cli.ts tests/review-loop/summary.test.ts tests/review-loop/live-renderer.test.ts tests/review-loop/test-helpers.ts
git commit -m "feat(review-loop): observability — inspector stats, per-phase wall-clock, cost"
```

---

## Task 8: CLI flags + stale worktree cleanup

Wire `--pool-size` and `--no-inspect` flags in `cli.ts`. Construct the `WorkerPool` at run start and tear it down on exit (success or failure). Clean stale worker worktrees from prior crashed runs at startup.

**Files:**

- Modify: `review-loop/src/cli.ts`
- Modify: `review-loop/config.example.json`
- Test: `tests/review-loop/cli.test.ts`

**Interfaces:**

- Produces: `--pool-size <N>` and `--no-inspect` CLI flags; pool construction and cleanup lifecycle in `cli.ts`; `cleanWorkerWorktrees(repoRoot, runId)` called at startup.

- [ ] **Step 1: Write failing CLI flag tests**

Add to `tests/review-loop/cli.test.ts`:

```typescript
test('--pool-size overrides config.poolSize', async () => {
  // Run cli with --pool-size 5 against a config that says 3.
  // Assert: the pool's underlying workers.length === 5 (or observe via a side-effect).
  // Use the existing fake-spawn pattern from cli.test.ts.
})

test('--no-inspect skips inspector calls', async () => {
  // Run cli with --no-inspect.
  // Assert: no inspect.json written in the run dir.
})

test('stale worker worktrees from a prior run are cleaned at startup', async () => {
  // Manually create <workDir>/worktrees/<runId>-worker-1 for a non-existent run.
  // Run cli with a new runId.
  // Assert: the stale worktree was removed (or at least not adopted).
})
```

(Fill in test bodies using the existing `cli.test.ts` patterns — they invoke `cli` main with mocked spawn + exec.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/review-loop/cli.test.ts`
Expected: FAIL — flags not parsed.

- [ ] **Step 3: Parse the flags in `cli.ts`**

Find the existing `--config` / `--plan` / `--repo` / `--resume-run` / `--reset-worktree` parsing block. Add:

```typescript
let poolSizeOverride: number | undefined
let noInspect = false
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]!
  if (arg === '--pool-size') {
    poolSizeOverride = Number(argv[++i])
    if (!Number.isInteger(poolSizeOverride) || poolSizeOverride < 1)
      throw new Error('--pool-size must be a positive integer')
  } else if (arg === '--no-inspect') {
    noInspect = true
  }
}
```

Apply `poolSizeOverride` to the loaded config before constructing the pool:

```typescript
if (poolSizeOverride !== undefined) config.poolSize = poolSizeOverride
```

- [ ] **Step 4: Construct the pool after primary worktree setup**

Find the section in `cli.ts` after `createWorktree(...)` (the primary worktree). Add:

```typescript
await cleanWorkerWorktrees(runState.worktreePath, runState.runId)
const pool = await createWorkerPool(config, runState)
```

Wrap the run + finalize + merge in `try/finally` to ensure `pool.close()` runs:

```typescript
try {
  // existing: runReviewLoop, final build check, mergeWorktree, artifact writes
} finally {
  await pool.close()
}
```

- [ ] **Step 5: Pass `inspect: !noInspect` through to `processPendingIssues`**

In `loop-controller.ts`, the `IssueProcessorDeps.inspect` field (added in Task 6) needs to come from a new `ReviewLoopDeps.inspect` field. Add it:

```typescript
export interface ReviewLoopDeps {
  config: ReviewLoopConfig
  runState: RunState
  ledger: IssueLedger
  spawn: SpawnFn
  exec: ShellExecFn
  log: ProgressReporter
  trace: TraceLogger
  pool: WorkerPool
  inspect: boolean
}
```

In `cli.ts` where `ReviewLoopDeps` is constructed:

```typescript
const deps: ReviewLoopDeps = {
  // ...existing...
  pool,
  inspect: !noInspect,
}
```

In `loop-controller.ts` where `IssueProcessorDeps` is built:

```typescript
{ /* ... */, pool: deps.pool, inspect: deps.inspect }
```

- [ ] **Step 6: Update `config.example.json`**

```json
{
  "workDir": ".review-loop",
  "maxRounds": 10,
  "maxNoProgressRounds": 2,
  "poolSize": 3,
  "checkCommand": "export CI=true; bun build:client && bun check:full",
  "reviewer": { "model": "zai-coding-plan/glm-5.2", "extraArgs": [], "timeoutMs": 1800000 },
  "fixer": { "model": "zai-coding-plan/glm-5.2", "extraArgs": [] },
  "matcher": { "model": "zai-coding-plan/glm-5.2", "extraArgs": [] },
  "inspector": { "model": "zai-coding-plan/glm-5.2", "extraArgs": [] }
}
```

- [ ] **Step 7: Run all review-loop tests + typecheck + lint**

Run: `bun run review-loop:test && bun run review-loop:typecheck && bun run review-loop:lint`
Expected: PASS.

- [ ] **Step 8: Run the full check command from config**

Run: `export CI=true; bun build:client && bun check:full`
Expected: PASS — all 12 repo checks (lint, typecheck, format, license-headers, knip, test, test:client, duplicates, review-loop:\*) green.

- [ ] **Step 9: Commit**

```bash
git add review-loop/src/cli.ts review-loop/src/loop-controller.ts review-loop/config.example.json tests/review-loop/cli.test.ts
git commit -m "feat(review-loop): --pool-size and --no-inspect flags; stale worktree cleanup"
```

---

## Task 9: End-to-end integration tests (real opencode subprocess)

Slow but high-value: prove the wiring works end-to-end with the real `opencode run` path, using a scripted fake agent.

**Files:**

- Modify: `tests/review-loop/fake-agent-integration.test.ts`

**Interfaces:** none new — uses everything from Tasks 1–8.

- [ ] **Step 1: Read the existing integration test file**

Read `tests/review-loop/fake-agent-integration.test.ts` end-to-end. Match its setup style.

- [ ] **Step 2: Add 3 integration tests**

```typescript
describe('fake agent with pool + inspector', () => {
  test('3 issues, 3 workers, all inspectors accept, run completes clean', async () => {
    // Script fake agent to emit 3 valid issues, accept all fixes.
    // Assert: doneReason === 'clean'; 3 commits on the primary branch.
  })

  test('1 issue, inspector rejects, fixer retries successfully, fixed (after retry)', async () => {
    // Script: first inspector call addresses=false, second addresses=true.
    // Assert: 2 fixer calls; 2 inspector calls; final status fixed_pending_review.
  })

  test('--no-inspect skips inspector; fixer valid+build pass → merge', async () => {
    // Assert: no inspect.json written; status fixed_pending_review after 1 attempt.
  })
})
```

(Fill in scripted agent responses using the file's existing pattern.)

- [ ] **Step 3: Run the integration tests**

Run: `bun test tests/review-loop/fake-agent-integration.test.ts`
Expected: PASS (slow — ~60-120 s per test).

- [ ] **Step 4: Commit**

```bash
git add tests/review-loop/fake-agent-integration.test.ts
git commit -m "test(review-loop): end-to-end pool + inspector integration tests"
```

---

## Self-Review

**Spec coverage:**

- Pool of K worktrees → Task 5 + Task 6. ✓
- File-set aware dispatch → Task 5 Step 7 (`peersTouchFile` + `acquire` fallback). ✓
- Rebase + ff-only merge → Task 5 Step 4 (`rebaseOnto`, `mergeFastForward`) + Step 7 (`mergeWorkerIntoPrimary`). ✓
- Pool-internal mutex → Task 5 Step 7 (`withPrimaryLock`). ✓
- Inspector schema → Task 1. ✓
- Inspector prompts → Task 1. ✓
- Inspector invocation wrapper → Task 4 (`runInspector` in `issue-inspector.ts`). ✓
- Unified retry budget (MAX_ATTEMPTS=2) → Task 4 Step 8. ✓
- Rebase conflict does NOT consume retry budget → Task 6 Step 2 (Branch D merge-conflict path). ✓
- Starvation escape → Task 5 Step 7 (`?? free[0]!` fallback). ✓
- Inspector failure mode (timeout/malformed → treated as rejection) → inherited from `runAgent` (Task 3) + Task 4 Branch C (inspector failure path consumes retry budget). ✓
- Fixer can agree with inspector → Task 4 Step 8 Branch A (verdict != valid → terminal, no third attempt). ✓
- `runAgent` return-type change → Task 3. ✓
- `RoundMetric` extensions → Task 2. ✓
- `inspect_complete` trace event → Task 2. ✓
- `inspector_rejected` decision bucket → Task 2 (schema) + Task 4 (`tallyDecision('inspector_rejected', ...)`). ✓
- Summary report extensions → Task 7. ✓
- `metrics.json` extensions → Task 7. ✓
- Live renderer array-shaped `live()` → Task 7. ✓
- Config schema additions (`poolSize`, `inspector`) → Task 5 (`poolSize`) + Task 1 schema already provides `InspectorResultSchema`; `inspector: AgentConfigSchema.optional()` added in Task 4 Step 8 (inspector config fallback at callsite). ✓
- CLI flags `--pool-size`, `--no-inspect` → Task 8. ✓
- `config.example.json` update → Task 8. ✓
- Stale worker worktree cleanup → Task 5 Step 4 (`cleanWorkerWorktrees`) + Task 8 Step 4 (called at startup). ✓
- State.json compatibility (no persisted state changes for pool) → preserved: `run-state.ts` only gains `inspectPath` (Task 4 Step 1); pool reconstructed on resume. ✓
- Compatibility matrix (existing configs work, `--pool-size 1 --no-inspect` reproduces today's behavior) → Tasks 4-8. ✓

**Placeholder scan:** no TBD/TODO/`implement later`. Every code step shows the actual code or names the exact existing pattern to follow. Where tests are sketched (`// ...setup...`), the surrounding context names the existing helper (`setupRepo`, `createRunState`, `createIssueLedger`) and the existing test to copy from. This is intentional — the implementer reads the existing test file before adding new tests.

**Type consistency:**

- `InspectorResult` shape consistent across Task 1 schema, Task 4 `runInspector` return, Task 2 `tallyInspector` consumer. ✓
- `AgentRunResult<T>` consistent across Task 3 definition, Task 4 consumer, Task 7 wiring. ✓
- `WorkerPool.acquire(primaryFile: string): Promise<Worker>` consistent across Task 5 definition, Task 6 consumer. ✓
- `Worker` interface from Task 5 satisfies `IssueWorker` interface from Task 4 (`worktreePath`, `headSha`, `resetToBaseline`). ✓
- `RetryReason` discriminated union consistent across Task 4 definition and `buildAttemptPrompt` switch. ✓
- `MAX_ATTEMPTS = 2` referenced consistently in Task 4 (definition + every branch check). ✓

If any of the above drifts during implementation, treat as a bug.
