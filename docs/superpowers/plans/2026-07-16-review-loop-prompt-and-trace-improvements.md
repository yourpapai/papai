<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Review-Loop Prompt, Correctness, Trace & Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a structured trace + per-round decision/severity metrics (with burndown) to the review-loop, fix the remaining correctness bugs surfaced by reconciliation and Run 1, and apply conservative research-validated prompt improvements — all without breaking the existing output contract (changes are additive).

**Architecture:** A new `trace-log.ts` defines a `TraceEvent` discriminated union + `RoundMetric` accumulator + a `TraceLogger` injected (DI) into the loop alongside the existing `spawn`/`exec`/`log`. The loop emits per-phase events and accumulates per-round metrics; `summary.ts` derives `metrics.json` + an ASCII burndown. Correctness fixes touch `loop-controller.ts` (no-commit guard, `resetWorktreeTo` at revert sites, matcher bounding, agent-composed commit messages), `issue-ledger.ts` (verdict→status mapping), `worktree.ts` (`resetWorktreeTo`), `issue-schema.ts` (additive `commitMessage`/`severity`/`plan_drift`), and `cli.ts` (SIGKILL escalation). Prompts are rewritten in `prompt-templates.ts` preserving the fake-agent routing sentinels.

**Tech Stack:** Bun + TypeScript (strict), Zod v4, `bun:test`, DI-first testing. Run all commands from the **repo root**.

**Spec:** `docs/superpowers/specs/2026-07-16-review-loop-prompt-and-trace-improvements-design.md`

**Verification commands (repo root):**

- Single test file: `bun test tests/review-loop/<file>.test.ts`
- Full suite: `bun run review-loop:test`
- Typecheck: `bun run review-loop:typecheck`
- Lint: `bun run review-loop:lint`
- Format: `bun run review-loop:format`

**Sentinel-preservation contract (applies to Task 6):** the fake-agent mocks in `loop-controller.test.ts` and `progress-log.test.ts` route responses by prompt substrings. Every rewritten prompt MUST still contain: `"Review the current implementation"` (reviewer), `"Verify and fix"` (fixer), `"build error"` (retry), `"Match newly found"` (matcher).

---

## Task 1: Trace logging core (`trace-log.ts`)

**Files:**

- Create: `review-loop/src/trace-log.ts`
- Test: `tests/review-loop/trace-log.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/review-loop/trace-log.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { readFile, rm, mkdir } from 'node:fs/promises'
import path from 'node:path'

import {
  TraceEventSchema,
  RoundMetricSchema,
  createFileTraceLogger,
  createCapturingTraceLogger,
  emptyDecisions,
  emptySeverityCounts,
} from '../../review-loop/src/trace-log.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

describe('trace-log', () => {
  test('createFileTraceLogger appends JSONL and swallows fs errors', async () => {
    const dir = makeTempDir('trace-')
    const tracePath = path.join(dir, 'trace.jsonl')
    const logger = createFileTraceLogger(tracePath)
    await logger.append({
      ts: '2026-07-16T00:00:00Z',
      round: 1,
      phase: 'round',
      event: 'round_start',
      maxRounds: 10,
      maxNoProgressRounds: 2,
      checkCommand: 'bun check:full',
    })
    const raw = await readFile(tracePath, 'utf8')
    expect(raw.trim()).toBe(
      '{"ts":"2026-07-16T00:00:00Z","round":1,"phase":"round","event":"round_start","maxRounds":10,"maxNoProgressRounds":2,"checkCommand":"bun check:full"}',
    )

    // fs failure must not throw
    await mkdir(path.join(dir, 'nested'), { recursive: true })
    const badPath = path.join(dir, 'nested') // a directory, not a file
    await expect(
      createFileTraceLogger(badPath).append({
        ts: 'x',
        round: 1,
        phase: 'round',
        event: 'loop_end',
        doneReason: 'clean',
        rounds: 1,
        burndown: [],
      }),
    ).resolves.toBeUndefined()
    void rm(path.join(dir, 'nested'), { recursive: true }).catch(() => {})
  })

  test('TraceEventSchema validates every event variant; bad shape rejected', () => {
    const good = [
      { ts: 'x', round: 1, phase: 'r', event: 'review_complete', issueCount: 0, issues: [] },
      { ts: 'x', round: 1, phase: 'r', event: 'match_complete', newCount: 0, matchedCount: 0 },
      {
        ts: 'x',
        round: 1,
        phase: 'r',
        event: 'verify_complete',
        issueId: 'i',
        verdict: 'valid',
        fixability: 'auto',
        reviewerSeverity: 'high',
        fixerSeverity: 'medium',
        reasoning: 'r',
        targetFiles: [],
      },
      { ts: 'x', round: 1, phase: 'r', event: 'build_complete', issueId: 'i', passed: true, attempt: 1, durationMs: 5 },
      { ts: 'x', round: 1, phase: 'r', event: 'fix_complete', issueId: 'i', fixed: true, commitSha: 'abc', attempt: 1 },
    ] as const
    for (const e of good) expect(TraceEventSchema.safeParse(e).success).toBe(true)

    expect(TraceEventSchema.safeParse({ event: 'nope' }).success).toBe(false)
  })

  test('RoundMetricSchema validates a metric with decisions + dual severity', () => {
    const metric = {
      round: 1,
      newIssues: 3,
      cumulativeOpen: 3,
      noProgressRounds: 0,
      decisions: emptyDecisions(),
      reviewerSeverity: { ...emptySeverityCounts(), high: 2, low: 1 },
      fixerSeverity: { ...emptySeverityCounts(), high: 1 },
    }
    expect(RoundMetricSchema.safeParse(metric).success).toBe(true)
  })

  test('createCapturingTraceLogger records events in order', async () => {
    const { logger, events } = createCapturingTraceLogger()
    await logger.append({ ts: 'a', round: 1, phase: 'r', event: 'match_complete', newCount: 1, matchedCount: 0 })
    await logger.append({ ts: 'b', round: 1, phase: 'r', event: 'match_complete', newCount: 0, matchedCount: 1 })
    expect(events).toHaveLength(2)
    expect(events[0]!.ts).toBe('a')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

`bun test tests/review-loop/trace-log.test.ts`
Expected: FAIL — module `trace-log.js` not found.

- [ ] **Step 3: Write `review-loop/src/trace-log.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { appendFile } from 'node:fs/promises'

import { z } from 'zod'

export const SeveritySchema = z.enum(['critical', 'high', 'medium', 'low'])
export type Severity = z.infer<typeof SeveritySchema>

export const SeverityCountsSchema = z.object({
  critical: z.number().int().nonnegative(),
  high: z.number().int().nonnegative(),
  medium: z.number().int().nonnegative(),
  low: z.number().int().nonnegative(),
})
export type SeverityCounts = z.infer<typeof SeverityCountsSchema>

export const DecisionsSchema = z.object({
  fixed: z.number().int().nonnegative(),
  invalid: z.number().int().nonnegative(),
  already_fixed: z.number().int().nonnegative(),
  needs_human: z.number().int().nonnegative(),
  plan_drift: z.number().int().nonnegative(),
  no_commit: z.number().int().nonnegative(),
})
export type Decisions = z.infer<typeof DecisionsSchema>

export function emptyDecisions(): Decisions {
  return { fixed: 0, invalid: 0, already_fixed: 0, needs_human: 0, plan_drift: 0, no_commit: 0 }
}

export function emptySeverityCounts(): SeverityCounts {
  return { critical: 0, high: 0, medium: 0, low: 0 }
}

export const RoundMetricSchema = z.object({
  round: z.number().int().positive(),
  newIssues: z.number().int().nonnegative(),
  cumulativeOpen: z.number().int().nonnegative(),
  noProgressRounds: z.number().int().nonnegative(),
  decisions: DecisionsSchema,
  reviewerSeverity: SeverityCountsSchema,
  fixerSeverity: SeverityCountsSchema,
})
export type RoundMetric = z.infer<typeof RoundMetricSchema>

const base = {
  ts: z.string(),
  round: z.number().int().nonnegative(),
  phase: z.string(),
}

export const TraceEventSchema = z.discriminatedUnion('event', [
  z.object({
    ...base,
    event: z.literal('round_start'),
    maxRounds: z.number().int().positive(),
    maxNoProgressRounds: z.number().int().positive(),
    checkCommand: z.string(),
  }),
  z.object({
    ...base,
    event: z.literal('review_complete'),
    issueCount: z.number().int().nonnegative(),
    issues: z.array(
      z.object({
        title: z.string(),
        severity: SeveritySchema,
        file: z.string(),
        confidence: z.number(),
      }),
    ),
  }),
  z.object({
    ...base,
    event: z.literal('match_complete'),
    newCount: z.number().int().nonnegative(),
    matchedCount: z.number().int().nonnegative(),
  }),
  z.object({
    ...base,
    event: z.literal('verify_complete'),
    issueId: z.string(),
    verdict: z.string(),
    fixability: z.string(),
    reviewerSeverity: SeveritySchema.nullable(),
    fixerSeverity: SeveritySchema.nullable(),
    reasoning: z.string(),
    targetFiles: z.array(z.string()),
  }),
  z.object({
    ...base,
    event: z.literal('build_complete'),
    issueId: z.string(),
    passed: z.boolean(),
    attempt: z.number().int().positive(),
    durationMs: z.number().int().nonnegative(),
  }),
  z.object({
    ...base,
    event: z.literal('fix_complete'),
    issueId: z.string(),
    fixed: z.boolean(),
    commitSha: z.string().nullable(),
    attempt: z.number().int().positive(),
  }),
  RoundMetricSchema.extend({ ...base, event: z.literal('round_summary') }),
  z.object({
    ...base,
    event: z.literal('loop_end'),
    doneReason: z.string(),
    rounds: z.number().int().nonnegative(),
    burndown: z.array(RoundMetricSchema),
  }),
])
export type TraceEvent = z.infer<typeof TraceEventSchema>

export interface TraceLogger {
  append(e: TraceEvent): Promise<void>
}

export function createFileTraceLogger(tracePath: string): TraceLogger {
  return {
    async append(e: TraceEvent): Promise<void> {
      try {
        await appendFile(tracePath, `${JSON.stringify(e)}\n`)
      } catch {
        // Trace must never break a run.
      }
    },
  }
}

export function createCapturingTraceLogger(): { logger: TraceLogger; events: TraceEvent[] } {
  const events: TraceEvent[] = []
  return {
    logger: {
      async append(e: TraceEvent): Promise<void> {
        events.push(e)
      },
    },
    events,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

`bun test tests/review-loop/trace-log.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add review-loop/src/trace-log.ts tests/review-loop/trace-log.test.ts
git commit -m "feat(review-loop): add trace-log module (events, RoundMetric, file logger)"
```

---

## Task 2: Add `tracePath` to `RunState`

**Files:**

- Modify: `review-loop/src/run-state.ts`
- Test: `tests/review-loop/run-state.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/review-loop/run-state.test.ts` inside the `describe`:

```typescript
test('synthesizes tracePath from runDir on create and load (additive, no migration)', async () => {
  const repoRoot = makeTempDir('run-state-')
  const config = createReviewLoopConfigFixture(repoRoot)
  const planPath = path.join(repoRoot, 'plan.md')

  const state = await createRunState(config, planPath)
  expect(state.tracePath).toBe(path.join(state.runDir, 'trace.jsonl'))

  const reloaded = await loadRunState(config.workDir, state.runId)
  expect(reloaded.tracePath).toBe(state.tracePath)
})
```

- [ ] **Step 2: Run test to verify it fails**

`bun test tests/review-loop/run-state.test.ts`
Expected: FAIL — `state.tracePath` is `undefined`.

- [ ] **Step 3: Add `tracePath` to `RunState`**

In `review-loop/src/run-state.ts`, add `tracePath: string` to the `RunState extends PersistedRunState` interface (next to `logPath`), then set `tracePath: path.join(runDir, 'trace.jsonl')` in **both** `createRunState` and `loadRunState` return objects (mirror the existing `logPath` line). Do **not** add it to `PersistedRunStateSchema` (it is synthesized from `runDir`, like the other paths).

- [ ] **Step 4: Run test to verify it passes**

`bun test tests/review-loop/run-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add review-loop/src/run-state.ts tests/review-loop/run-state.test.ts
git commit -m "feat(review-loop): synthesize tracePath on RunState (additive)"
```

---

## Task 3: Additive schema fields (`commitMessage`, `severity`, `plan_drift`)

**Files:**

- Modify: `review-loop/src/issue-schema.ts`
- Test: `tests/review-loop/issue-schema.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/review-loop/issue-schema.test.ts`:

```typescript
test('FixerResultSchema accepts optional commitMessage and severity', () => {
  const base = {
    verdict: 'valid',
    fixability: 'auto',
    reasoning: 'r',
    targetFiles: [],
    fixed: true,
  } as const
  expect(FixerResultSchema.safeParse(base).success).toBe(true)
  expect(
    FixerResultSchema.safeParse({ ...base, commitMessage: 'fix(review-loop): tighten guard', severity: 'high' })
      .success,
  ).toBe(true)
})

test('VerifierDecisionSchema accepts plan_drift verdict (additive)', () => {
  expect(
    VerifierDecisionSchema.safeParse({
      verdict: 'plan_drift',
      fixability: 'manual',
      reasoning: 'code diverged from plan',
      targetFiles: [],
    }).success,
  ).toBe(true)
})
```

Ensure the file imports `FixerResultSchema, VerifierDecisionSchema` (add to the existing import if missing).

- [ ] **Step 2: Run test to verify it fails**

`bun test tests/review-loop/issue-schema.test.ts`
Expected: FAIL — `plan_drift` rejected by enum; `commitMessage`/`severity` not the failure but fields absent (parse still succeeds, so add an assertion that they round-trip). Adjust the first test to also assert the parsed value carries the fields:

```typescript
const parsed = FixerResultSchema.parse({ ...base, commitMessage: 'fix(review-loop): x', severity: 'low' })
expect(parsed.commitMessage).toBe('fix(review-loop): x')
expect(parsed.severity).toBe('low')
```

- [ ] **Step 3: Modify `review-loop/src/issue-schema.ts`**

Change the verdict enum to include `plan_drift`:

```typescript
export const VerifierDecisionSchema = z.object({
  verdict: z.enum(['valid', 'invalid', 'already_fixed', 'needs_human', 'plan_drift']),
  fixability: z.enum(['auto', 'manual']),
  reasoning: z.string().min(1),
  targetFiles: z.array(z.string().min(1)),
})
```

Extend `FixerResultSchema`:

```typescript
export const FixerResultSchema = VerifierDecisionSchema.extend({
  fixed: z.boolean(),
  commitSha: z.string().nullable().optional(),
  commitMessage: z.string().optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
})
```

- [ ] **Step 4: Run test to verify it passes**

`bun test tests/review-loop/issue-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck the workspace**

`bun run review-loop:typecheck`
Expected: no errors. (The `FixerResult` type now has optional `commitMessage`/`severity`; `VerifierDecision.verdict` includes `plan_drift` — downstream consumers are updated in later tasks.)

- [ ] **Step 6: Commit**

```bash
git add review-loop/src/issue-schema.ts tests/review-loop/issue-schema.test.ts
git commit -m "feat(review-loop): additive commitMessage/severity fields + plan_drift verdict"
```

---

## Task 4: `resetWorktreeTo` helper

**Files:**

- Modify: `review-loop/src/worktree.ts`
- Test: `tests/review-loop/worktree.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/review-loop/worktree.test.ts` (inside its existing `describe`; reuse its repo-setup helper if present, else use `execGit` + `makeTempDir`):

```typescript
test('resetWorktreeTo resets to a sha AND removes untracked files', async () => {
  const repo = makeTempDir('wt-')
  await execGit(repo, ['init'])
  await execGit(repo, ['config', 'user.email', 't@t.com'])
  await execGit(repo, ['config', 'user.name', 'T'])
  writeFileSync(path.join(repo, 'a.txt'), 'a')
  await execGit(repo, ['add', '.'])
  await execGit(repo, ['commit', '-m', 'init'])
  const baseline = (await execGit(repo, ['rev-parse', 'HEAD'])).stdout.trim()

  // second commit + an untracked scratch file
  writeFileSync(path.join(repo, 'b.txt'), 'b')
  await execGit(repo, ['add', '.'])
  await execGit(repo, ['commit', '-m', 'second'])
  writeFileSync(path.join(repo, 'scratch.txt'), 'leak')

  await resetWorktreeTo(repo, baseline)

  expect((await execGit(repo, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(baseline)
  const status = (await execGit(repo, ['status', '--porcelain'])).stdout.trim()
  expect(status).toBe('') // no untracked scratch.txt
})
```

Add imports: `resetWorktreeTo` from the source module, plus `writeFileSync` from `node:fs` and `path`, `execGit`, `makeTempDir` as already used in that file.

- [ ] **Step 2: Run test to verify it fails**

`bun test tests/review-loop/worktree.test.ts`
Expected: FAIL — `resetWorktreeTo` is not exported.

- [ ] **Step 3: Add the helper to `review-loop/src/worktree.ts`**

```typescript
export async function resetWorktreeTo(worktreePath: string, sha: string): Promise<void> {
  await execGit(worktreePath, ['reset', '--hard', sha])
  await execGit(worktreePath, ['clean', '-fd'])
}
```

- [ ] **Step 4: Run test to verify it passes**

`bun test tests/review-loop/worktree.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add review-loop/src/worktree.ts tests/review-loop/worktree.test.ts
git commit -m "feat(review-loop): resetWorktreeTo (reset --hard <sha> + clean -fd)"
```

---

## Task 5: Verdict→status mapping (`valid+manual` and `plan_drift` → terminal)

**Files:**

- Modify: `review-loop/src/issue-ledger.ts`
- Test: `tests/review-loop/issue-ledger.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/review-loop/issue-ledger.test.ts`:

```typescript
test('valid + manual maps to needs_human (terminal); valid + auto maps to verified', () => {
  recordVerification(ledger, idOfFirstIssue, {
    verdict: 'valid',
    fixability: 'manual',
    reasoning: 'real but not auto-fixable',
    targetFiles: [],
  })
  expect(firstRecord().status).toBe('needs_human')

  recordVerification(ledger, idOfSecondIssue, {
    verdict: 'valid',
    fixability: 'auto',
    reasoning: 'real, will fix',
    targetFiles: [],
  })
  expect(secondRecord().status).toBe('verified')
})

test('plan_drift maps to needs_human (terminal)', () => {
  recordVerification(ledger, idOfFirstIssue, {
    verdict: 'plan_drift',
    fixability: 'manual',
    reasoning: 'code diverged from plan',
    targetFiles: [],
  })
  expect(firstRecord().status).toBe('needs_human')
})
```

Use whatever small helpers that suite already has to create a ledger + two issues and fetch records by id (mirror the existing tests in that file). If none exist, create two records inline via `applyMatchedIssues` with two distinct `ReviewerIssue` fixtures.

- [ ] **Step 2: Run test to verify it fails**

`bun test tests/review-loop/issue-ledger.test.ts`
Expected: FAIL — `valid` maps to `verified` regardless of fixability; `plan_drift` throws in the default branch.

- [ ] **Step 3: Modify `mapVerifierDecisionToLedgerStatus` in `review-loop/src/issue-ledger.ts`**

Change its signature to take the full decision so it can read `fixability`, and update `recordVerification` to pass it:

```typescript
export function recordVerification(ledger: IssueLedger, id: string, decision: VerifierDecision): void {
  const record = ledger.snapshot.issues[id]
  if (record === undefined) {
    throw new Error(`Unknown issue id ${id}`)
  }
  record.verifierDecision = decision
  record.status = mapVerifierDecisionToLedgerStatus(decision)
}

function mapVerifierDecisionToLedgerStatus(decision: VerifierDecision): LedgerIssueStatus {
  switch (decision.verdict) {
    case 'valid':
      return decision.fixability === 'manual' ? 'needs_human' : 'verified'
    case 'already_fixed':
      return 'already_fixed'
    case 'needs_human':
      return 'needs_human'
    case 'plan_drift':
      return 'needs_human'
    case 'invalid':
      return 'rejected'
    default:
      throw new Error('Unhandled verifier verdict')
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

`bun test tests/review-loop/issue-ledger.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite to catch any caller breakage**

`bun run review-loop:test`
Expected: PASS (callers pass a full `VerifierDecision`, which they already construct).

- [ ] **Step 6: Commit**

```bash
git add review-loop/src/issue-ledger.ts tests/review-loop/issue-ledger.test.ts
git commit -m "fix(review-loop): valid+manual and plan_drift verdicts map to terminal needs_human"
```

---

## Task 6: Rewrite the four prompts (preserve sentinels)

**Files:**

- Modify: `review-loop/src/prompt-templates.ts`
- Test: `tests/review-loop/prompt-templates.test.ts`

- [ ] **Step 1: Write/extend the failing tests**

In `tests/review-loop/prompt-templates.test.ts`, keep the existing sentinel/path assertions and ADD content-contract assertions:

```typescript
test('reviewer prompt keeps sentinel + gains evidence/scope/severity/convention clauses', () => {
  const p = buildReviewPrompt('/plan.md', '/issues.json')
  expect(p).toContain('Review the current implementation') // sentinel
  expect(p).toContain('AGENTS.md')
  expect(p).toContain('evidence') // evidence-gating
  expect(p).toContain('critical') && expect(p).toContain('low') // severity calibration
})

test('fixer prompt keeps sentinel, drops commit instruction, asks for commitMessage + severity', () => {
  const p = buildFixPrompt(issue, '/result.json', 'bun check:full')
  expect(p).toContain('Verify and fix') // sentinel
  expect(p).toContain('commitMessage')
  expect(p).toContain('severity')
  expect(p).toContain('plan_drift')
  expect(p).not.toContain('commit with message') // agent no longer commits
})

test('retry prompt inlines schema (no "same schema as before") + final-attempt', () => {
  const p = buildRetryFixPrompt(issue, '/result.json', 'TypeError: x', 'bun check:full')
  expect(p).toContain('build error') // sentinel
  expect(p).toContain('"verdict"')
  expect(p).not.toContain('same schema as before')
  expect(p).toContain('final attempt')
})
```

(Leave the existing matcher prompt tests; add `expect(p).toContain('underlying')` if a matcher test exists, else add one importing `buildMatcherPrompt` from `issue-matcher.js`.)

- [ ] **Step 2: Run tests to verify they fail**

`bun test tests/review-loop/prompt-templates.test.ts`
Expected: FAIL on the new assertions.

- [ ] **Step 3: Rewrite `review-loop/src/prompt-templates.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReviewerIssue } from './issue-schema.js'

export function buildReviewPrompt(planPath: string, outputPath: string): string {
  return [
    `Review the current implementation against the implementation plan at: ${planPath}.`,
    `Read the plan first, then evaluate the implementation against it; cite which plan requirement each issue relates to.`,
    `Write your findings as JSON to: ${outputPath}`,
    '',
    'In scope: bugs, security, error-handling gaps, plan-conformance, and violations of the repo conventions in AGENTS.md (already in your context) — e.g. the logging rules, the no-lint-disable rule, .js import paths, and the max-lines design signal.',
    'NOT in scope (do not report): style/formatting a linter owns, naming preferences, or "correct but I would write it differently."',
    '',
    'Evidence rule: only report an issue for files/lines you have actually opened and read. `evidence` must quote the offending source line(s); `file`/`lineStart`/`lineEnd` must point at code you opened. Before raising an issue, verify the impact you claim (e.g. check .gitignore before asserting something "will be committed by git add -A"; trace the control flow before claiming a missing keyword matters). If you cannot cite exact evidence or verify the impact, lower `confidence` or omit the issue.',
    '',
    'Severity calibration — critical: data loss / security / crash / blocks the plan goal; high: likely bug or breaks a requirement; medium: conditional correctness risk or maintainability; low: minor. Include all severity levels.',
    '',
    'Use this exact schema:',
    '{"issues": [{"title": string, "severity": "critical" | "high" | "medium" | "low", "summary": string, "whyItMatters": string, "evidence": string, "file": string, "lineStart": number, "lineEnd": number, "suggestedFix": string, "confidence": number}]}',
    'If there are no issues, write: {"issues": []}',
  ].join('\n\n')
}

export function buildFixPrompt(issue: ReviewerIssue, outputPath: string, checkCommand: string): string {
  return [
    'Verify and fix the issue below.',
    'First, verify whether this issue is valid, already fixed, or a false positive.',
    `If valid and auto-fixable, fix it and run \`${checkCommand}\` to confirm. Edit only what is necessary — no drive-by refactors; scope edits to targetFiles.`,
    'If non-trivial, run a check that reproduces the issue before and confirms resolution after. When you edit a shared helper, enumerate all of its call sites in your reasoning and confirm each still works.',
    'Do NOT commit and do NOT edit the plan/spec. If the issue is really that the code diverged from the plan/spec but is not a code defect (extra files, different structure), do not change anything — return verdict "plan_drift" with reasoning describing the divergence.',
    `Write your result as JSON to: ${outputPath}`,
    'Use this exact schema:',
    '{"verdict": "valid" | "invalid" | "already_fixed" | "needs_human" | "plan_drift", "fixability": "auto" | "manual", "reasoning": string, "targetFiles": string[], "fixed": boolean, "commitSha": string | null, "commitMessage": string, "severity": "critical" | "high" | "medium" | "low"}',
    '- verdict "valid" means a real defect that you fixed; a real but not-auto-fixable issue is "needs_human".',
    '- commitMessage: a single-line conventional-commit subject describing the ACTUAL changes you made (the orchestrator commits; you do not).',
    '- severity: your independently-assessed severity (may differ from the reviewer). Omit only for "invalid".',
    'If not fixable automatically, do not modify any files.',
    '',
    'Issue:',
    JSON.stringify(issue, null, 2),
  ].join('\n\n')
}

export function buildRetryFixPrompt(
  issue: ReviewerIssue,
  outputPath: string,
  buildError: string,
  checkCommand: string,
): string {
  return [
    'Your previous fix broke the build. Fix the build error and try again.',
    `After fixing, run \`${checkCommand}\` to verify the build passes.`,
    'This is your final attempt. If you cannot make the build pass, report "needs_human" and leave the tree buildable — do not leave a broken tree.',
    `Write your updated result as JSON to: ${outputPath}`,
    'Use this exact schema:',
    '{"verdict": "valid" | "invalid" | "already_fixed" | "needs_human" | "plan_drift", "fixability": "auto" | "manual", "reasoning": string, "targetFiles": string[], "fixed": boolean, "commitSha": string | null, "commitMessage": string, "severity": "critical" | "high" | "medium" | "low"}',
    '',
    'Build error output:',
    buildError,
    '',
    'Original issue:',
    JSON.stringify(issue, null, 2),
  ].join('\n\n')
}
```

In `review-loop/src/issue-matcher.ts`, strengthen `buildMatcherPrompt` (keep the `"Match newly found"` sentinel on the first line):

```typescript
return [
  'Match newly found issues to existing issues from the ledger by the underlying problem (same root cause / same location), not surface wording. When in doubt, link to an existing issue; set existingId to null only for genuinely new, unrelated problems.',
  'Some existing issues may already be rejected / needs_human / already_fixed — still match re-reports to them by underlying problem; the loop decides whether to re-process.',
  'Write the result as JSON to:',
  outputPath,
  'Use this exact schema:',
  '{"matches": [{"newIssueIndex": number, "existingId": string | null}]}',
  '',
  'New issues:',
  newSummary,
  '',
  'Existing issues:',
  existingSummary || '(none)',
].join('\n')
```

- [ ] **Step 4: Run tests to verify they pass**

`bun test tests/review-loop/prompt-templates.test.ts && bun test tests/review-loop/issue-matcher.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add review-loop/src/prompt-templates.ts review-loop/src/issue-matcher.ts tests/review-loop/prompt-templates.test.ts
git commit -m "feat(review-loop): conservative prompt rewrites (evidence-gating, severity, commitMessage, plan_drift)"
```

---

## Task 7: Loop — inject trace + accumulate metrics + emit events

**Files:**

- Modify: `review-loop/src/loop-controller.ts`
- Test: `tests/review-loop/loop-controller.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test that asserts the trace receives the expected event sequence and `ReviewLoopResult.metrics` is populated:

```typescript
test('emits trace events and returns per-round metrics', async () => {
  const repoRoot = makeTempDir('loop-ctrl-')
  const config = createReviewLoopConfigFixture(repoRoot)
  const planPath = path.join(repoRoot, 'plan.md')
  writeFileSync(planPath, '# Plan')
  const runState = await createRunState(config, planPath)
  const ledger = await createIssueLedger(runState.runDir)
  await setupGitRepo(runState.worktreePath)

  const { logger, events } = createCapturingTraceLogger()

  const result = await runReviewLoop({
    config,
    runState,
    ledger,
    spawn: createMockSpawn({
      reviewerIssues: [[issue], []],
      fixerResults: [{ verdict: 'valid', fixability: 'auto', fixed: true }],
      onFixer: (cwd) => {
        writeFileSync(path.join(cwd, 'fixed.ts'), 'x\n')
        return Promise.resolve()
      },
    }),
    exec: createMockExec(true),
    log: silentReporter(),
    trace: logger,
  })

  const types = events.map((e) => e.event)
  expect(types).toContain('round_start')
  expect(types).toContain('review_complete')
  expect(types).toContain('round_summary')
  expect(types).toContain('loop_end')
  expect(result.metrics).toBeDefined()
  expect(result.metrics!.map((m) => m.round)).toEqual([1, 2])
  const r1 = result.metrics![0]!
  expect(r1.newIssues).toBe(1)
  expect(r1.reviewerSeverity.high).toBe(1) // the `issue` fixture is severity 'high'
})
```

Add imports: `createCapturingTraceLogger` from `trace-log.js`, and `TraceLogger` type.

- [ ] **Step 2: Run test to verify it fails**

`bun test tests/review-loop/loop-controller.test.ts`
Expected: FAIL — `trace` is not a known dep; `result.metrics` is `undefined`.

- [ ] **Step 3: Modify `review-loop/src/loop-controller.ts`**

(a) Add `trace: TraceLogger` to `ReviewLoopDeps`, and `metrics?: RoundMetric[]` to `ReviewLoopResult`. Import `TraceLogger`, `RoundMetric`, `emptyDecisions`, `emptySeverityCounts`, and `Severity` from `trace-log.js`.

(b) Add a tiny timestamp helper:

```typescript
function nowIso(): string {
  return new Date().toISOString()
}
```

(c) Thread an accumulator + per-round counters through `runRound`. Add a mutable context object:

```typescript
interface RoundCollector {
  decisions: import('./trace-log.js').Decisions
  reviewerSeverity: import('./trace-log.js').SeverityCounts
  fixerSeverity: import('./trace-log.js').SeverityCounts
}
function newCollector(): RoundCollector {
  return { decisions: emptyDecisions(), reviewerSeverity: emptySeverityCounts(), fixerSeverity: emptySeverityCounts() }
}
```

(d) In `runReviewLoop`, create `const metrics: RoundMetric[] = []` and pass `{ metrics }`-style into `runRound`. Concretely, change `runRound(round, deps)` to `runRound(round, deps, metrics)`.

(e) In `runRound`: create `const collector = newCollector()`. After `runReviewStep`, count reviewer severity from `newIssues`:

```typescript
for (const i of newIssues) collector.reviewerSeverity[i.severity] += 1
```

After `runMatchAndRecord`, compute `const newCount = matches where existingId === null` — simplest: `const newCount = newIssues.length - matchedCount` where `matchedCount` comes from the matcher result. (If you do not currently return matches from `runMatchAndRecord`, return them as a second value.)

(f) Pass `collector` and `round` into `processNextIssue` → `processIssue` so that after each `recordVerification`, it increments `collector.decisions[verdict]` (map `valid+fixed`→`fixed`, `valid+!fixed`→`needs_human` is already the ledger mapping; use the recorded `record.status` or the verdict directly) and `collector.fixerSeverity[result.severity]++` when `result.severity` is set. Also emit `verify_complete`, `build_complete`, and `fix_complete` trace events at the matching sites (fire-and-forget `void deps.trace.append(...)`).

(g) At the end of `runRound` (before each `return`), push a `RoundMetric` and emit `round_summary`:

```typescript
const metric: RoundMetric = {
  round,
  newIssues: newCount,
  cumulativeOpen: countOpen(deps.ledger),
  noProgressRounds: deps.runState.noProgressRounds,
  decisions: collector.decisions,
  reviewerSeverity: collector.reviewerSeverity,
  fixerSeverity: collector.fixerSeverity,
}
metrics.push(metric)
void deps.trace.append({ ts: nowIso(), round, phase: 'round', event: 'round_summary', ...metric })
```

where `countOpen` counts non-terminal records in the ledger (`!TERMINAL_STATUSES.has(status)`). Emit `round_start` at the top of `runRound` and `loop_end` (with `burndown: metrics`) at each terminal return.

(h) Set `terminalResult` to include `metrics`.

- [ ] **Step 4: Update existing `runReviewLoop` call sites to pass `trace`**

The only call site is `cli.ts` (updated in Task 10). For now, the loop-controller test passes `trace`; other tests that call `runReviewLoop` must also pass `trace: createCapturingTraceLogger().logger` (or a no-op logger). Add a `silentTrace` helper to `tests/review-loop/test-helpers.ts`:

```typescript
import type { TraceLogger, TraceEvent } from '../../review-loop/src/trace-log.js'
export function silentTrace(): TraceLogger {
  return { async append(_: TraceEvent) {} }
}
```

and pass `trace: silentTrace()` to every existing `runReviewLoop({...})` call in `loop-controller.test.ts` and `progress-log.test.ts` (this keeps them compiling before Task 8 fixes behavior).

- [ ] **Step 5: Run the loop-controller test to verify the new test passes**

`bun test tests/review-loop/loop-controller.test.ts`
Expected: the new trace/metrics test PASSES. Some pre-existing tests may now FAIL because they lack `onFixer` commits — that is the no-commit guard from Task 8; defer fixing those to Task 8 (do not fix here). If the new test itself fails because the fake fixer didn't commit, ensure the new test's `onFixer` writes a file (it does).

- [ ] **Step 6: Commit**

```bash
git add review-loop/src/loop-controller.ts tests/review-loop/loop-controller.test.ts tests/review-loop/progress-log.test.ts tests/review-loop/test-helpers.ts
git commit -m "feat(review-loop): inject TraceLogger, accumulate RoundMetric, emit trace events"
```

---

## Task 8: Loop correctness — no-commit guard, `resetWorktreeTo`, matcher bounding, commitMessage

**Files:**

- Modify: `review-loop/src/loop-controller.ts`
- Test: `tests/review-loop/loop-controller.test.ts` (fix 3 breaking tests + add new ones)

- [ ] **Step 1: Write the failing tests**

(a) No-commit guard:

```typescript
test('does not mark fixed when fixer reports fixed:true but changes nothing', async () => {
  const repoRoot = makeTempDir('loop-ctrl-')
  const config = createReviewLoopConfigFixture(repoRoot, { maxRounds: 1, maxNoProgressRounds: 1 })
  const planPath = path.join(repoRoot, 'plan.md')
  writeFileSync(planPath, '# Plan')
  const runState = await createRunState(config, planPath)
  const ledger = await createIssueLedger(runState.runDir)
  await setupGitRepo(runState.worktreePath)

  const { logger, events } = createCapturingTraceLogger()
  await runReviewLoop({
    config,
    runState,
    ledger,
    spawn: createMockSpawn({
      reviewerIssues: [[issue]],
      fixerResults: [{ verdict: 'valid', fixability: 'auto', fixed: true }],
      // NO onFixer: tree stays clean, HEAD does not advance
    }),
    exec: createMockExec(true),
    log: silentReporter(),
    trace: logger,
  })

  const rec = Object.values(ledger.snapshot.issues)[0]!
  expect(rec.fixAttempts).toBe(0) // not marked fixed
  const fixEvents = events.filter((e) => e.event === 'fix_complete')
  expect(fixEvents.some((e) => e.event === 'fix_complete' && e.fixed === false)).toBe(true)
})
```

Capture `events` via `const { events } = createCapturingTraceLogger()` and pass its `logger` as `trace` instead of `silentTrace()` in this test.

(b) Commit message from agent:

```typescript
test('uses agent commitMessage when provided, fallback to title when absent', async () => {
  // (covered by updating the existing 'auto-commits uncommitted fixer changes' test to assert the commit subject
  //  equals the agent-provided commitMessage; add a second variant where the fixer omits commitMessage)
})
```

Concretely, extend `createMockSpawn` to accept an optional `commitMessage` per fixer result and write it into `result.json`; then assert the loop's commit subject via `git show --format=%s HEAD`.

- [ ] **Step 2: Run tests to verify they fail**

`bun test tests/review-loop/loop-controller.test.ts`
Expected: FAIL — no-commit guard not implemented; the 3 pre-existing tests that rely on `fixed:true` without a commit also fail.

- [ ] **Step 3: Fix the 3 breaking pre-existing tests** by giving their fake fixer a real commit via `onFixer`. For each of these tests, add an `onFixer` that writes a file (so `ensureFixerChangesCommitted` commits it):

- "runs until reviewer reports no issues"
- "retries fix when build check fails"
- "persists ledger after each issue" (its first fixer action is a no-op → make it write a file)

Pattern to insert into each `createMockSpawn({...})`:

```typescript
        onFixer: (cwd) => { writeFileSync(path.join(cwd, 'fixed.ts'), 'ok\n'); return Promise.resolve() },
```

(For the retry test, the file is written on both attempts; the first is reverted by the build-failure path, the retry's is committed.)

Do the same for any test in `progress-log.test.ts` that uses `fixed:true` without `onFixer`.

- [ ] **Step 4: Implement the fixes in `review-loop/src/loop-controller.ts`**

(a) Import `resetWorktreeTo` from `worktree.js` and replace the three bare `execGit(..., ['reset', '--hard', baselineSha])` calls (in `processIssue` and `retryFixAfterBuildFailure`) with `await resetWorktreeTo(deps.runState.worktreePath, baselineSha)`.

(b) Update `ensureFixerChangesCommitted` to take the agent's `commitMessage` and sanitize:

```typescript
function sanitizeSubject(text: string): string {
  const oneLine = text.split(/\r?\n/)[0] ?? ''
  return oneLine.replace(/[`"']/g, '').trim().slice(0, 100)
}

async function ensureFixerChangesCommitted(
  deps: ReviewLoopDeps,
  record: LedgerIssueRecord,
  commitMessage: string | undefined,
): Promise<void> {
  const status = (await execGit(deps.runState.worktreePath, ['status', '--porcelain'])).stdout.trim()
  if (status.length === 0) return
  await execGit(deps.runState.worktreePath, ['add', '-A'])
  const subject = sanitizeSubject(commitMessage ?? `fix(review-loop): ${record.issue.title}`)
  await execGit(deps.runState.worktreePath, ['commit', '-m', subject])
  deps.log.log(`[fix] "${shortTitle(record)}" \u2192 auto-committed uncommitted changes`)
}
```

(c) No-commit guard — in `processIssue` after the build passes:

```typescript
if (buildResult.passed) {
  await ensureFixerChangesCommitted(deps, record, result.commitMessage)
  const postSha = (await execGit(deps.runState.worktreePath, ['rev-parse', 'HEAD'])).stdout.trim()
  if (postSha === baselineSha) {
    collector.decisions.no_commit += 1
    void deps.trace.append({
      ts: nowIso(),
      round,
      phase: 'fix',
      event: 'fix_complete',
      issueId: record.id,
      fixed: false,
      commitSha: null,
      attempt: 1,
    })
    deps.log.log(`[fix] "${shortTitle(record)}" \u2192 no change (fixed:true was a false claim)`)
    return { fixed: false }
  }
  recordFixAttempt(deps.ledger, record.id)
  void deps.trace.append({
    ts: nowIso(),
    round,
    phase: 'fix',
    event: 'fix_complete',
    issueId: record.id,
    fixed: true,
    commitSha: postSha,
    attempt: 1,
  })
  deps.log.log(`[fix] "${shortTitle(record)}" \u2192 fixed`)
  return { fixed: true }
}
```

(Thread `round` and `collector` into `processIssue`/`processNextIssue` signatures — they already receive `deps`; add the two params.)

(d) Matcher bounding — in `runMatchAndRecord`, replace `const existingRecords = Object.values(deps.ledger.snapshot.issues)` with a bounded selection:

```typescript
const RECENT_ROUNDS = 2
const existingRecords = Object.values(deps.ledger.snapshot.issues).filter((r) => {
  if (!TERMINAL_STATUSES.has(r.status)) return true // always keep actionable
  return round - r.latestSeenRound <= RECENT_ROUNDS // keep recent terminal, drop stale
})
```

- [ ] **Step 5: Run the full loop-controller suite**

`bun test tests/review-loop/loop-controller.test.ts`
Expected: PASS (including the previously-breaking tests now fixed, and the new guard/matcher tests).

- [ ] **Step 6: Run the whole review-loop suite**

`bun run review-loop:test`
Expected: PASS. (If `progress-log.test.ts` still fails on a `fixed:true`-without-commit case, apply the same `onFixer` fix.)

- [ ] **Step 7: Commit**

```bash
git add review-loop/src/loop-controller.ts tests/review-loop/loop-controller.test.ts tests/review-loop/progress-log.test.ts
git commit -m "fix(review-loop): no-commit guard, resetWorktreeTo at reverts, matcher bounding, agent commitMessage"
```

---

## Task 9: `metrics.json` + burndown in `summary.ts`

**Files:**

- Modify: `review-loop/src/summary.ts`
- Test: `tests/review-loop/summary.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/review-loop/summary.test.ts`:

```typescript
test('emits a burndown block when metrics are present', () => {
  const summary = formatSummary({
    doneReason: 'max_rounds',
    rounds: 2,
    ledger: makeSnapshot(['closed']),
    metrics: [
      {
        round: 1,
        newIssues: 3,
        cumulativeOpen: 3,
        noProgressRounds: 0,
        decisions: { fixed: 1, invalid: 0, already_fixed: 0, needs_human: 0, plan_drift: 0, no_commit: 0 },
        reviewerSeverity: { critical: 0, high: 2, medium: 1, low: 0 },
        fixerSeverity: { critical: 0, high: 1, medium: 0, low: 0 },
      },
      {
        round: 2,
        newIssues: 1,
        cumulativeOpen: 1,
        noProgressRounds: 1,
        decisions: { fixed: 0, invalid: 1, already_fixed: 0, needs_human: 0, plan_drift: 0, no_commit: 0 },
        reviewerSeverity: { critical: 0, high: 0, medium: 1, low: 0 },
        fixerSeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      },
    ],
  })
  expect(summary).toContain('Burndown')
  expect(summary).toContain('round  new')
})
```

- [ ] **Step 2: Run test to verify it fails**

`bun test tests/review-loop/summary.test.ts`
Expected: FAIL — no burndown block.

- [ ] **Step 3: Modify `review-loop/src/summary.ts`**

Import `RoundMetric` from `trace-log.js`. Change `formatSummary`'s param type to accept `metrics?: RoundMetric[]`, keep the existing body, then append a burndown block when `result.metrics` is present:

```typescript
const sevWeight: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 }
function avgSeverity(counts: SeverityCounts, total: number): string {
  if (total === 0) return '-'
  const sum = counts.critical * 4 + counts.high * 3 + counts.medium * 2 + counts.low
  return (sum / total).toFixed(1)
}

function burndownBlock(metrics: RoundMetric[]): string {
  const header = 'round  new  open  fixed  rejected  needs_human  plan_drift  avgRev  avgFix'
  const rows = metrics.map((m) =>
    [
      String(m.round).padEnd(6),
      String(m.newIssues).padEnd(4),
      String(m.cumulativeOpen).padEnd(5),
      String(m.decisions.fixed).padEnd(6),
      String(m.decisions.invalid).padEnd(9),
      String(m.decisions.needs_human).padEnd(12),
      String(m.decisions.plan_drift).padEnd(11),
      avgSeverity(m.reviewerSeverity, m.newIssues).padEnd(7),
      avgSeverity(m.fixerSeverity, m.decisions.fixed + m.decisions.invalid),
    ].join(''),
  )
  return ['Burndown:', header, ...rows].join('\n')
}
```

At the end of `formatSummary`, before returning: `if (result.metrics !== undefined && result.metrics.length > 0) { lines.push('', burndownBlock(result.metrics)) }`.

- [ ] **Step 4: Add a `buildMetricsJson` helper** (emits `<runDir>/metrics.json`) and call it from `cli.ts` in Task 10. Keep it in `summary.ts`. Extract a shared `countStatuses(snapshot)` helper that both `formatSummary` and `buildMetricsJson` use so the totals are not duplicated:

```typescript
export function buildMetricsJson(result: ReviewLoopResult): unknown {
  const records = Object.values(result.ledger.issues)
  return {
    doneReason: result.doneReason,
    rounds: result.rounds,
    burndown: result.metrics ?? [],
    totals: countStatuses(records),
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

`bun test tests/review-loop/summary.test.ts`
Expected: PASS (existing tests still pass since `metrics` is optional).

- [ ] **Step 6: Commit**

```bash
git add review-loop/src/summary.ts tests/review-loop/summary.test.ts
git commit -m "feat(review-loop): metrics.json + ASCII burndown block in summary"
```

---

## Task 10: CLI — construct trace logger, pass deps, SIGKILL escalation

**Files:**

- Modify: `review-loop/src/cli.ts`
- Test: `tests/review-loop/cli.test.ts`

- [ ] **Step 1: Write the failing tests**

(a) SIGKILL escalation — add to the `realSpawn` describe in `tests/review-loop/cli.test.ts`:

```typescript
test('SIGKILLs a child that ignores SIGTERM after the grace period', async () => {
  const start = Date.now()
  const result = await realSpawn('sh', ['-c', "trap '' TERM; sleep 30"], {
    cwd: process.cwd(),
    timeout: 300,
    killGraceMs: 200,
  })
  expect(result.exitCode).toBe(1)
  expect(result.stderr).toContain('timed out')
  expect(Date.now() - start).toBeLessThan(5000) // did not hang for the full sleep
})
```

(b) Trace logger wired — add a smoke assertion that `runCli` (or a unit test of the deps-assembly) passes a `trace` logger. Simplest: assert `createFileTraceLogger` is invoked with `runState.tracePath` by extracting the deps-assembly into a testable function is out of scope; instead assert via the existing `kills`/`finalize` style that `tracePath` is created. Keep this lightweight: extend an existing `runReviewLoop`-mocking test to assert `trace` was passed.

- [ ] **Step 2: Run tests to verify they fail**

`bun test tests/review-loop/cli.test.ts`
Expected: FAIL — `killGraceMs` not honored; `trace` not passed.

- [ ] **Step 3: Modify `review-loop/src/cli.ts`**

(a) Import `createFileTraceLogger` and `buildMetricsJson`. In `runCli`, after `prepareWorktree`, construct `const trace = createFileTraceLogger(runState.tracePath)` and pass `trace` into the `runReviewLoop({ ..., trace })` call. After the run, write metrics: `await writeFile(path.join(runState.runDir, 'metrics.json'), JSON.stringify(buildMetricsJson(result), null, 2) + '\n')` (wrap in try/catch — metrics are best-effort).

(b) SIGKILL escalation — change `realSpawn`'s options type to accept `killGraceMs?: number` and update the timeout handler:

```typescript
export const realSpawn: SpawnFn = (command, args, options, onLine): Promise<SpawnResult> => {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '',
      stderr = '',
      pending = '',
      timedOut = false
    const grace = options.killGraceMs ?? 5000
    let killTimer: ReturnType<typeof setTimeout> | null = null
    const timer =
      options.timeout !== undefined && options.timeout > 0
        ? setTimeout(() => {
            timedOut = true
            child.kill('SIGTERM')
            killTimer = setTimeout(() => child.kill('SIGKILL'), grace)
          }, options.timeout)
        : null
    // ... (keep existing stdout/stderr/onLine handling unchanged) ...
    const finish = (code: number, signal: NodeJS.Signals | null) => {
      if (killTimer !== null) clearTimeout(killTimer)
      if (timer !== null) clearTimeout(timer)
      // ... existing resolve logic ...
    }
    child.on('close', (code, signal) => {
      if (killTimer !== null) clearTimeout(killTimer)
      if (timer !== null) clearTimeout(timer)
      if (pending.length > 0) onLine?.(pending)
      if (timedOut) {
        resolve({ exitCode: 1, stdout, stderr: `${stderr}Process timed out after ${options.timeout}ms\n` })
        return
      }
      resolve({ exitCode: code ?? (signal === null ? 0 : 1), stdout, stderr })
    })
  })
}
```

Also update the `SpawnFn` type in `agent-runner.ts` options to include `killGraceMs?: number` (additive).

- [ ] **Step 4: Run tests to verify they pass**

`bun test tests/review-loop/cli.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add review-loop/src/cli.ts review-loop/src/agent-runner.ts tests/review-loop/cli.test.ts
git commit -m "feat(review-loop): wire trace logger + metrics.json; SIGKILL escalation on timeout"
```

---

## Task 11: Final verification

- [ ] **Step 1: Full suite**

`bun run review-loop:test`
Expected: all PASS.

- [ ] **Step 2: Typecheck + lint + format**

`bun run review-loop:typecheck && bun run review-loop:lint && bun run review-loop:format:check`
Expected: clean.

- [ ] **Step 3: Sentinel audit**

Grep the four prompts to confirm each sentinel is present exactly where the fake-agent router expects:

```bash
rg -n 'Review the current implementation|Verify and fix|build error|Match newly found' review-loop/src
```

Expected: reviewer/fixer/retry/matcher each carry their sentinel.

- [ ] **Step 4: Commit any format fixes**

```bash
git add -u
git commit -m "chore(review-loop): final format/sentinel verification" || echo "nothing to commit"
```

---

## Notes for the executor

- **Additive only.** Every schema/path change is optional or enum-extending; old `ledger.json`/`state.json`/`result.json` files still load. No migration.
- **Trace never throws.** All `deps.trace.append(...)` calls are `void`-discarded; the file logger swallows fs errors.
- **Sentinels are load-bearing.** Do not rephrase the four routing phrases (Task 6, Step 3 preserves them verbatim).
- **The no-commit guard (Task 8) changes fake-fixer test semantics:** any test asserting a `fixed:true` outcome must now cause a real commit via `onFixer` writing a file. Three `loop-controller.test.ts` tests + any `progress-log.test.ts` parallels are updated in Task 8 Step 3.
- **Deferred (separate follow-up spec):** issue categories, severity-gated early-stop, `needs_human.md` — see the spec's Drift Log.
