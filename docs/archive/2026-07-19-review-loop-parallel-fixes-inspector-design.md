<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Review-Loop: Parallel Fixes + Post-Fix Diff Inspection — Design

**Date:** 2026-07-19
**Status:** Proposed
**Scope:** `review-loop/` throughput (K-worker pool) + correctness (per-issue inspector gate)
**Companion analysis:** `.review-loop/runs/2026-07-19T07-50-59-028Z-28f1bc3a/` (run that motivated this design)

## Overview

Two coupled improvements to the autonomous review loop:

1. **Pool of K git worktrees** with file-set-aware dispatch, replacing today's serial `processNextIssue` recursion. Bounded parallelism for the fixer/build/inspect phases per issue; primary branch integration stays serial via a pool-internal mutex.
2. **Inspector agent step** that gates the merge of any worker-branch into the primary worktree. A bad fix (one that builds but doesn't actually address the issue) is discarded before it reaches the integration branch. Inspector rejection consumes the same retry budget as build failure (unified model: max 2 fixer attempts per issue, down from "1 normal + 1 build-retry" implicit today — same cap, formalized).

A separate cluster (incremental reviewer, plan-task-aware mapping, cost budget guard) is deferred to a follow-up spec.

## Goals

- Cut wall-clock per round in proportion to issue-count independence: 3 independent-file issues that take 6 minutes serially should complete in ~2 minutes.
- Stop shipping fixes the fixer _claims_ are correct but don't actually address the reviewer's issue — the inspector rejects them before merge.
- Preserve the existing safety model: bad fixes never reach the integration branch; in-flight crashes lose only the in-flight attempt, never the run.
- Stay fully backward compatible: existing `config.json` files work unchanged (pool defaults to 3, inspector config falls back to fixer).
- Maintain deterministic test coverage of every reachable state in the per-issue lifecycle.

## Non-goals

- Per-issue worktrees (one worktree per issue). The pool model is bounded; per-issue is unbounded.
- Separate retry budgets for build-failure and inspector-rejection (explicit non-goal: unified budget is the design choice).
- Inspector flagging new problems introduced by the fix. The inspector's scope is narrow: "does this diff address the issue?" New-problem detection stays with the next round's reviewer.
- Cost budget guard. Tracked as a follow-up once per-phase accounting lands here.
- Parallelizing the reviewer or matcher. They stay single-call per round.

## Architecture

### New files

| File                                 | Purpose                                                                                                                                                                                                               |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `review-loop/src/worker-pool.ts`     | Pool lifecycle: create K worktrees at run start, dispatch issues to free workers with file-set awareness, merge back via rebase + ff-only, reset between issues, tear down at run end. Owns the primary-branch mutex. |
| `review-loop/src/issue-inspector.ts` | Inspector agent invocation: builds the prompt (issue + diff + fixer reasoning), runs `runAgent` with `InspectorResultSchema`, returns `{ addresses, reasoning, confidence }`.                                         |

### Modified files

| File                  | Change                                                                                                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `issue-processor.ts`  | Replace the recursive `processNextIssue` serial loop with `pool.acquire(file) → process → pool.release(worker)`. Add inspector gate between build-pass and merge. Unify build-retry and inspector-reject into one attempt-counter loop with `RetryReason` discriminator. |
| `issue-schema.ts`     | Add `InspectorResultSchema`. No change to existing schemas.                                                                                                                                                                                                              |
| `prompt-templates.ts` | Add `buildInspectPrompt` and `buildRetryFixWithInspectorFeedbackPrompt`. Existing prompts unchanged.                                                                                                                                                                     |
| `loop-trace.ts`       | Add `emitInspectComplete`. Add `tallyInspector`, `tallyPhaseMs`, `tallyUsage` helpers. Extend `RoundCollector`.                                                                                                                                                          |
| `trace-log.ts`        | Add `inspect_complete` to `TraceEventSchema`. Extend `RoundMetricSchema` with `inspector`, `phaseMs`, `usage`. Add `inspector_rejected` to `DecisionsSchema`.                                                                                                            |
| `config.ts`           | Add `poolSize: z.number().int().positive().default(3)`. Add optional `inspector: AgentConfigSchema.optional()`.                                                                                                                                                          |
| `run-state.ts`        | Add `inspectPath` field. No persisted-state schema changes.                                                                                                                                                                                                              |
| `worktree.ts`         | Add `rebaseOnto` and `mergeFastForward` helpers. Existing functions unchanged.                                                                                                                                                                                           |
| `summary.ts`          | Include inspector stats, per-phase wall-clock, total cost in `summary.txt` and `metrics.json`.                                                                                                                                                                           |
| `agent-runner.ts`     | Change `runAgent` return type to `AgentRunResult<T> = { value: T; usage: AgentUsage }`. Accumulate tokens/cost/wall from existing event stream.                                                                                                                          |
| `live-renderer.ts`    | Change `ProgressReporter.live` to accept `readonly string[]` (one line per active worker). TTY repaint; non-TTY prints prefixed lines.                                                                                                                                   |
| `cli.ts`              | Construct `WorkerPool` after primary worktree setup; tear down in cleanup. Add `--pool-size` and `--no-inspect` CLI flags.                                                                                                                                               |

### What doesn't change

- `cli.ts` top-level flow: prepare worktree → run loop → final build → merge to root → cleanup.
- `loop-controller.ts` per-round flow: review → match → process pending issues.
- `agent-runner.ts` invocation model: still `opencode run --auto --format json`.
- `issue-ledger.ts` schema: same statuses, same recordVerification/recordFixAttempt calls. The inspector verdict is trace-only, not persisted in the ledger.
- `issue-matcher.ts`: unchanged.
- `event-stream.ts`: unchanged. Token/cost events already parsed.

## Per-Issue Lifecycle

### State graph

```
                         ┌─────────────────────────────┐
                         │  pending (in queue)         │
                         └────────────┬────────────────┘
                                      │ pool.acquire(file)
                                      ▼
                              ┌───────────────┐
                              │ fixer attempt │ ─── non-timeout spawn failure
                              │      N        │     → internal retry (existing)
                              └───────┬───────┘     timeout → terminal ERROR
                                      │
              ┌───────────────────────┼─────────────────────────────┐
              │                       │                             │
              ▼                       ▼                             ▼
        verdict=invalid         already_fixed                  needs_human / plan_drift
        (discard, rejected)     (discard, already_fixed)       (discard, needs_human)
                                      │
                              verdict=valid, fixed=true
                                      │
                                      ▼
                              ┌───────────────┐
                              │ build check   │
                              └───────┬───────┘
                                      │
                ┌─────────────────────┼─────────────────────┐
            passes                                       fails
                │                                           │
                ▼                                           ▼
        ┌───────────────┐                          (retry budget left?)
        │ inspector     │                                  │
        └───────┬───────┘                          ┌───────┴───────┐
                │                                yes             no
   ┌────────────┼────────────┐                    │               │
   │            │            │                    ▼               ▼
addresses   does_not_addr  timeout/         reset worker,    terminal
   │            │           malformed        N++, feedback    needs_human
   │            │            │               = build error    (build failed)
   ▼            │            ▼
 merge,    (retry budget      (treat as does_not_address;
 fixed     left?)              fall through to does_not_address path)
   ✓            │
              ┌─┴────────────┐
            yes              no
             │                │
             ▼                ▼
       reset worker,     terminal needs_human
       N++, feedback      (inspector rejected
       = inspector          twice)
       reasoning
       → fixer N+1
             │
             ▼
     ┌────────────────────────────────┐
     │  fixer attempt N+1             │
     │  (sees inspector feedback)     │
     └────────────┬───────────────────┘
                  │ branch by verdict (same as attempt 1)
                  │
                  │ valid + fixed → build → inspector → ...
                  │
                  │ fixer AGREES with inspector:
                  │   invalid → terminal rejected
                  │   already_fixed → terminal already_fixed
                  │   needs_human → terminal needs_human
                  │   plan_drift → terminal needs_human
                  │
                  │ if fixer produces a new fix → continues through build/inspect,
                  │   but inspector's second verdict is FINAL (no third attempt)
```

### Rules

1. **One shared retry budget per issue: `MAX_ATTEMPTS = 2`.** Same as today's effective budget (1 normal + 1 build-retry = 2 total). The change is structural: build-failure and inspector-rejection both consume the same budget.

2. **Rebase conflict at merge does NOT consume the retry budget.** If two workers touched overlapping files despite the dispatcher's best effort, the merge fails at the git layer — not the fixer's fault. The issue is marked `needs_human` with `merge conflict: <files>` reasoning.

3. **Worker is held for the whole attempt** (fixer → build → inspector → merge). Released back to the pool only after the attempt fully terminates. The pool's concurrency is naturally bounded by K.

4. **Inspector failure mode.** If `runAgent` for the inspector throws after its internal retry (timeout, malformed output), treat as `addresses: false` with `reasoning: "inspector unavailable"`. Same path as a real rejection — consume retry budget, retry fixer with that reasoning. If budget exhausted → `needs_human`. Never merge an uninspected fix; safer to waste one fix than ship an unchecked one.

5. **Fixer verdict on retry is fully respected.** If retry-prompt-2 returns `verdict: 'invalid' | 'already_fixed' | 'needs_human' | 'plan_drift'` (fixer agrees with the inspector that the issue isn't real or isn't auto-fixable), that's terminal — recorded as the fixer's verdict, no third attempt.

6. **Inspector runs on the worker's branch as-is, NOT on a rebased version.** The diff is `git diff <baseline>..HEAD` on the worker branch. Rebase happens only after the inspector approves, as part of `mergeWorkerIntoPrimary`.

7. **Starvation escape.** If `pool.acquire(file)` would block AND there's at least one free worker AND all pending issues conflict with busy workers, dispatch to a free worker anyway. Worst case: a rebase conflict at merge time, handled by rule 2.

## Worker Pool

### Data model

```typescript
// worker-pool.ts

export interface Worker {
  readonly id: number // 1..K
  readonly worktreePath: string // <workDir>/worktrees/<runId>-worker-<id>
  readonly branch: string // review-loop/<runId>-worker-<id>
  busy: boolean
  lockedFiles: ReadonlySet<string>
  headSha(): Promise<string>
  resetToBaseline(primarySha: string): Promise<void>
}

export interface WorkerPool {
  acquire(primaryFile: string): Promise<Worker>
  release(worker: Worker): void
  mergeWorkerIntoPrimary(worker: Worker): Promise<{ ok: true } | { ok: false; conflictFiles: string[] }>
  primaryHead(): Promise<string>
  close(): Promise<void>
}
```

### File layout

```
<workDir>/worktrees/
  <runId>/                  ← primary (existing; on branch review-loop/<runId>)
  <runId>-worker-1/         ← pool worker 1 (on branch review-loop/<runId>-worker-1)
  <runId>-worker-2/
  <runId>-worker-3/
```

### Creation (`createWorkerPool(config, runState)`)

1. Read `config.poolSize` (default 3).
2. Read primary HEAD SHA — every worker's initial baseline.
3. For `i in 1..K`: `git worktree add <worktreePath> -b <branch>`. Each worker branches from primary HEAD. Cheap (~200 ms per worktree on a warm disk).
4. Each worker's `busy=false`, `lockedFiles={}`.

### Dispatch — file-set aware acquire

```typescript
async acquire(primaryFile: string): Promise<Worker> {
  while (true) {
    const free = workers.filter(w => !w.busy)
    if (free.length > 0) {
      const safe = free.find(w => !peersTouchFile(w, primaryFile)) ?? free[0]!
      safe.busy = true
      safe.lockedFiles = new Set([primaryFile])
      return safe
    }
    await waitForRelease()
  }
}
```

- `peersTouchFile(worker, file)`: true if any OTHER busy worker has `file` in its `lockedFiles`.
- `waitForRelease()`: a promise that resolves on the next `release()` call (promise queue).

**Only the primary file is locked.** The reviewer's `file` field is the most reliable signal. Guessing related files (helpers, tests) would cause false blocking. Better to dispatch optimistically and handle conflicts at merge (rule 2).

### Merge-back — rebase + ff-only

```typescript
async mergeWorkerIntoPrimary(worker: Worker): Promise<MergeResult> {
  await withPrimaryLock(async () => {
    const primarySha = await primaryHead()
    const r = await execGit(primaryWorktreePath, ['rebase', primaryBranch, worker.branch])
    if (r.exitCode !== 0) {
      const conflictFiles = parseConflictFiles(r.stdout)
      await execGit(worker.worktreePath, ['rebase', '--abort'])
      return { ok: false, conflictFiles }
    }
    const newSha = await execGit(primaryWorktreePath, ['merge', '--ff-only', worker.branch])
    return { ok: true, primarySha: newSha.stdout.trim() }
  })
}
```

Workers do not pull from each other during work. They see only primary-at-dispatch-time + their own commits. Rebase happens at merge time.

### Reset between attempts

`worker.resetToBaseline(primarySha)`:

- `git -C <worker.worktreePath> reset --hard <primarySha>`
- `git -C <worker.worktreePath> clean -fdx` (preserves `.review-loop/` subdir — the agent writes its `result.json` / `inspect.json` there)
- Update worker's branch ref to `primarySha`

Called between every attempt and before `release()` for any non-merge terminal path.

### Pool-internal serialization

All primary-affecting operations go through a single-entry mutex:

```typescript
class PoolInternals {
  private primaryMutex: Promise<void> = Promise.resolve()

  async withPrimaryLock<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void
    const next = new Promise<void>((r) => {
      release = r
    })
    const prev = this.primaryMutex
    this.primaryMutex = next
    await prev
    try {
      return await fn()
    } finally {
      release!()
    }
  }
}
```

`mergeWorkerIntoPrimary` and `primaryHead` (when read for dispatch decisions) go through `withPrimaryLock`. Per-worker fixer/build/inspector runs unlocked.

### Concurrency guarantees

- At most K issues are being actively fixed at any time.
- At most one fixer agent run per worker at a time.
- Primary branch updates are serial.
- Build checks run on worker worktrees in parallel — the main throughput win.

### Cleanup safety

`cli.ts` cleanup that calls `removeWorktree(primary)` gets extended to also iterate `worker-1..K` paths and remove them best-effort via `pool.close()`. If `cli.ts` is interrupted (Ctrl-C, kill, crash), stale worker worktrees accumulate; at next pool construction, scan `<workDir>/worktrees/` for entries matching `<runId>-worker-*` from prior crashed runs and remove them.

## Inspector Integration

### Schema (`issue-schema.ts`)

```typescript
export const InspectorResultSchema = z.object({
  addresses: z.boolean(),
  reasoning: z.string().min(1),
  confidence: z.number().min(0).max(1),
})

export type InspectorResult = z.infer<typeof InspectorResultSchema>
```

Three fields only. `confidence` is logged for observability; not used to gate the verdict.

### Prompt (`prompt-templates.ts`)

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

Key prompt choices:

- **Explicit anti-scope-creep language.** Two negative instructions ("do not flag unrelated problems", "do not assess code quality"). Without these, LLM inspectors drift into general code review.
- **Actionable reasoning on reject.** Vague "the fix is inadequate" doesn't help the retry fixer. The prompt requires specifics ("what the fixer should have done differently").
- **No `severity` field.** Reviewer and fixer already assess severity; the inspector doesn't need to weigh in.
- **Diff passed inline in the prompt.** Small (one fix); keeps the prompt self-contained for replay/debugging.

### Retry prompt — fixer with inspector feedback

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

The existing `buildRetryFixPrompt` (build-failure path) is unchanged. Both retry variants share the fixer schema.

### Inspector invocation in `processIssue`

```typescript
const diff = (await execGit(worker.worktreePath, ['diff', baselineSha, 'HEAD'])).stdout
const inspectorConfig = deps.config.inspector ?? {
  model: deps.config.fixer.model,
  extraArgs: deps.config.fixer.extraArgs,
  timeoutMs: deps.config.fixer.timeoutMs,
}
const result = await runInspector({
  spawn: deps.spawn,
  model: inspectorConfig.model,
  cwd: worker.worktreePath,
  prompt: buildInspectPrompt(record.issue, diff, fixerResult.reasoning, agentWritePath(deps.runState.inspectPath)),
  outputPath: deps.runState.inspectPath,
  outputSchema: InspectorResultSchema,
  label: `inspector-w${worker.id}`,
  reporter: deps.log,
  logPath: deps.runState.logPath,
  extraArgs: inspectorConfig.extraArgs,
  timeoutMs: inspectorConfig.timeoutMs ?? deps.config.agentTimeoutMs,
})
```

### Run-state path

`run-state.ts` gains one new derived field:

```typescript
inspectPath: path.join(runDir, 'inspect.json'),
```

Same overwrite pattern as `resultPath` / `matchesPath` — one file per issue, overwritten per attempt. The agent-output.log already captures the full agent interaction for replay.

## Observability

### `runAgent` return type change

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

export async function runAgent<T>(options: RunAgentOptions<T>): Promise<AgentRunResult<T>>
```

The existing `LiveCtx` in `agent-runner.ts` receives `step_finish` events (currently passed straight to the renderer, never accumulated). The change adds an accumulator to `LiveCtx` and exposes it on the run result. `wallMs` comes from `ctx.startedAt`.

All four call sites extract `.value` and thread `.usage` into the round collector:

- `loop-controller.ts` (reviewer)
- `issue-processor.ts` (fixer, fixer-retry, inspector)
- `issue-matcher.ts` (matcher)

### New `RoundMetric` fields

```typescript
const PhaseMsSchema = z.object({
  review: z.number().int().nonnegative(),
  match: z.number().int().nonnegative(),
  verify: z.number().int().nonnegative(),
  build: z.number().int().nonnegative(),
  inspect: z.number().int().nonnegative(),
  fix: z.number().int().nonnegative(),
})

const UsageTotalsSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
})

export const RoundMetricSchema = z.object({
  round: z.number().int().positive(),
  newIssues: z.number().int().nonnegative(),
  cumulativeOpen: z.number().int().nonnegative(),
  noProgressRounds: z.number().int().nonnegative(),
  decisions: DecisionsSchema,
  reviewerSeverity: SeverityCountsSchema,
  fixerSeverity: SeverityCountsSchema,
  inspector: z.object({
    runs: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
  }),
  phaseMs: PhaseMsSchema,
  usage: UsageTotalsSchema,
})
```

Wall-clock is captured per phase by the existing `withLivePhase` wrapper, extended to feed the collector. For parallel phases (fixer/build/inspect across K workers), the metric is **sum-of-per-issue** (not max wall). Sum reflects true resource cost; max wall is reported separately in the summary.

### New decision bucket

`DecisionsSchema` gains `inspector_rejected: z.number().int().nonnegative()`. Counted when an inspector says `addresses: false`. Terminal post-inspector `needs_human` (retry exhausted) still bumps `needs_human` as today.

### New trace event

```typescript
emitInspectComplete(
  trace: TraceLogger,
  round: number,
  issueId: string,
  addresses: boolean,
  confidence: number,
  reasoning: string,    // truncated to 200 chars
): void
```

Emitted after every inspector call. Sits between `build_complete` and `fix_complete` in the timeline.

### Summary report

```
Done reason: clean
Rounds executed: 2
Pool size: 3
Open issues: 0
Closed issues: 3
Rejected issues: 0
Already fixed: 0
Needs human: 0
Reopened issues: 0
Inspector: 3 runs, 0 rejected (0.0% reject rate)

Total cost: $0.042 (in 184k / out 12k / reasoning 4k tokens)
Wall clock: 2153s total
  review:    1487s (sum across rounds)
  match:      12s
  fix:       412s (sum, max single-issue 134s)
  build:     195s (sum, max single-issue 69s)
  inspect:    44s (sum, max single-issue 16s)

Burndown:
round  new  open  fixed  rejected  needs_human  plan_drift  insp_rej  avgRev  avgFix
1     3   3    3     0        0           0          0        1.0    1.0
2     0   3    0     0        0           0          0        -      -
```

### metrics.json shape

```json
{
  "doneReason": "clean",
  "rounds": 2,
  "poolSize": 3,
  "totals": { "...existing...": "...", "inspectorRejected": 0 },
  "usage": { "inputTokens": 184321, "outputTokens": 12044, "reasoningTokens": 4012, "costUsd": 0.042 },
  "phaseMs": { "review": 1487341, "match": 12453, "verify": 412444, "build": 195332, "inspect": 44123, "fix": 1233 },
  "burndown": [
    {
      "...existing fields...": "...",
      "inspector": { "runs": 3, "rejected": 0 },
      "phaseMs": { "...": "..." },
      "usage": { "...": "..." }
    }
  ]
}
```

### Live renderer — parallel worker lines

`ProgressReporter.live(line: string)` becomes `ProgressReporter.live(lines: readonly string[])`:

- **TTY renderer:** joins with `\n`, uses ANSI to repaint the right number of lines.
- **Non-TTY renderer:** prints one line per worker, prefixed with `[worker-N]`, on substantive change (e.g. new tool started).

`agent-runner.ts` gets a worker id from `LiveCtx` and writes to that slot. The pool passes `worker.id` as a label suffix (`fixer-w1`, `fixer-w2`, …).

When no pool is in play (reviewer/matcher single-call paths), the array has one element and behaves exactly as today.

## Config & CLI

### Config schema additions

```typescript
export const ReviewLoopConfigSchema = z.object({
  // ...existing fields unchanged...
  poolSize: z.number().int().positive().default(3),
  inspector: AgentConfigSchema.optional(),
})
```

The fallback for `inspector` is implemented at the call site, not the schema:

```typescript
const inspectorConfig = deps.config.inspector ?? {
  model: deps.config.fixer.model,
  extraArgs: deps.config.fixer.extraArgs,
  timeoutMs: deps.config.fixer.timeoutMs,
}
```

### `config.example.json` update

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

### CLI flags

Two new optional flags in `cli.ts`:

| Flag              | Effect                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--pool-size <N>` | Overrides `config.poolSize` at runtime. Useful for `--pool-size 1` to force serial behavior (debugging) or `--pool-size 5` for one-off beefy runs.      |
| `--no-inspect`    | Skips the inspector step entirely. Falls back to today's behavior (build passes → merge → done). Escape hatch for trustworthy fixers or A/B comparison. |

Both are pure runtime overrides — they don't get persisted to `state.json`. Resuming a run uses the config file's values.

`--no-inspect` keeps the pool but skips the inspector gate. Parallel fixes still happen; they trust the fixer's `fixed: true` claim and merge on build-pass. Useful for proving the inspector is actually catching things (run twice, once with `--no-inspect`, compare outcomes).

### State.json compatibility

`PersistedRunStateSchema` is unchanged. The pool is reconstructed on resume from `runId` + `poolSize` (derived paths). If `poolSize` changes between original run and resume, the new value takes effect — stale worker worktrees from a different K get cleaned up by `close()`.

Resume semantics:

- `currentRound` and `noProgressRounds` carry over (unchanged).
- The ledger carries over (unchanged) — pending issues get redispatched.
- In-flight issue state is not persisted. A crashed run loses the in-flight attempt; on resume, the issue is re-dispatched from scratch.

### Compatibility matrix

| Config shape                                           | Behavior                                                                      |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Existing `config.json` (no `poolSize`, no `inspector`) | `poolSize=3` default; inspector uses fixer config — fully functional          |
| New `config.json` with `poolSize: 1`                   | Serial execution; equivalent to today's behavior plus optional inspector      |
| New `config.json` with `poolSize: 3, inspector: {...}` | Full new behavior                                                             |
| `--pool-size 1 --no-inspect` flags                     | Exact reproduction of today's behavior — useful as a regression-baseline flag |

## Testing Strategy

### Test file layout

| File                                         | Scope                                                            | New/extended |
| -------------------------------------------- | ---------------------------------------------------------------- | ------------ |
| `tests/review-loop/worker-pool.test.ts`      | Pool lifecycle, dispatch, merge-back, concurrency                | **new**      |
| `tests/review-loop/issue-inspector.test.ts`  | Inspector prompt + schema + integration into `processIssue`      | **new**      |
| `tests/review-loop/issue-processor.test.ts`  | Unified retry budget, all state-graph branches                   | **extended** |
| `tests/review-loop/loop-trace.test.ts`       | New tally helpers, new metric fields                             | **extended** |
| `tests/review-loop/trace-log.test.ts`        | `inspect_complete` event, extended `RoundMetricSchema`           | **extended** |
| `tests/review-loop/summary.test.ts`          | New summary fields, cost/phase breakdown                         | **extended** |
| `tests/review-loop/prompt-templates.test.ts` | `buildInspectPrompt`, `buildRetryFixWithInspectorFeedbackPrompt` | **extended** |
| `tests/review-loop/config.test.ts`           | `poolSize` default, `inspector` fallback                         | **extended** |
| `tests/review-loop/agent-runner.test.ts`     | `AgentRunResult<T>` return type, usage aggregation               | **extended** |
| `tests/review-loop/live-renderer.test.ts`    | Array-shaped `live()` calls, per-worker lines                    | **extended** |
| `tests/review-loop/loop-controller.test.ts`  | Pool construction in run setup, inspector fallback wiring        | **extended** |
| `tests/review-loop/test-helpers.ts`          | `mockSpawnForFixerAndInspector` shared helper                    | **extended** |

### Coverage checklist

**`worker-pool.test.ts` — new file, real git in temp dirs:**

- K worker worktrees + branches created at construction.
- `close()` removes all worker worktrees and branches.
- `acquire` returns a free worker; marks it busy.
- `acquire` blocks when all busy; resolves on `release`.
- `acquire` prefers workers whose peers aren't touching the requested file.
- `acquire` falls back to first free worker on starvation.
- `release` returns worker to pool; resets busy + lockedFiles.
- `mergeWorkerIntoPrimary` fast-forwards when primary hasn't moved.
- `mergeWorkerIntoPrimary` rebases worker onto moved primary, then ff-merges.
- `mergeWorkerIntoPrimary` returns `conflictFiles` on rebase conflict; worker branch left clean.
- `resetToBaseline` produces clean working tree (preserves `.review-loop/`).
- `primaryHead` reflects merged commits after a successful merge.
- K concurrent acquires all succeed without blocking.
- K+1 concurrent acquires: K succeed immediately, 1 blocks then succeeds on release.

**`issue-inspector.test.ts` — new file:**

- `runInspector` returns `InspectorResult` with `addresses=true` when agent accepts.
- `runInspector` returns `InspectorResult` with `addresses=false` when agent rejects.
- Uses fixer config fallback when `config.inspector` is absent.
- Uses inspector config when present (different model).
- Passes issue + diff + fixer reasoning in prompt (snapshot prompt structure).
- Emits `inspect_complete` trace event.
- `buildInspectPrompt` includes issue JSON, diff verbatim, fixer reasoning, output schema, anti-scope-creep language.
- `buildRetryFixWithInspectorFeedbackPrompt` shows inspector reasoning, offers agree-with-inspector branch, includes output schema.

**`issue-processor.test.ts` — every state-graph branch:**

- Fixer verdict invalid → terminal rejected, no inspector call.
- Fixer verdict already_fixed → terminal already_fixed, no inspector call.
- Fixer verdict needs_human → terminal needs_human, no inspector call.
- Fixer verdict plan_drift → terminal needs_human, no inspector call.
- Fixer valid + build pass + inspector accepts → merge, fixed.
- Fixer valid + build pass + inspector rejects (attempt 1) → retry with inspector feedback.
- Fixer retry (attempt 2) succeeds + inspector accepts → merge, fixed (after retry).
- Fixer retry (attempt 2) + inspector rejects again → terminal needs_human.
- Fixer retry (attempt 2) + inspector times out twice → treated as rejection, terminal needs_human if budget exhausted.
- Fixer retry (attempt 2) returns verdict invalid (agrees with inspector) → terminal rejected, no further attempt.
- Fixer valid + build fails (attempt 1) → retry with build error.
- Fixer retry (attempt 2) + build fails → terminal needs_human (no inspector called).
- Fixer valid + build pass + inspector accepts + merge conflict → terminal needs_human, does not consume retry budget.
- Rebase conflict does not increment fixAttempts in ledger.
- K=1 pool behaves identically to current serial behavior.
- K=3 pool processes 3 independent-file issues in parallel (assert via mock wall-clock ordering).

**`agent-runner.test.ts` — return type change:**

- Returns `{ value, usage }` shape.
- `usage.inputTokens` accumulates across step_finish events.
- `usage.costUsd` accumulates across step_finish events.
- `usage.wallMs` measured from first step_start to final step_finish.
- Zero step_finish events → usage is zeros (not undefined).

**`loop-trace.test.ts` — new tally helpers:**

- `tallyInspector` increments runs on every call; rejected when `addresses=false`.
- `tallyPhaseMs` adds ms to the named phase bucket; multiple calls accumulate.
- `tallyUsage` adds tokens + cost into totals.

**`summary.test.ts` — extended report:**

- Includes poolSize line when poolSize > 1.
- Includes inspector stats line.
- Includes total cost line with token breakdown.
- Includes wall-clock per-phase breakdown.
- Burndown table includes `insp_rej` column.
- `metrics.json` mirrors `summary.txt` fields.
- Zero inspector runs → inspector line shows `"0 runs, 0 rejected (n/a reject rate)"`.

**`loop-controller.test.ts` — pool wiring:**

- Pool constructed at run setup.
- Pool torn down at run end (success and failure paths).
- Inspector fallback to fixer config when `config.inspector` is undefined.

### Integration test — `fake-agent-integration.test.ts` extension

3-4 slow end-to-end tests with real opencode subprocess (fake scripted agent):

- 3 issues, 3 workers, all inspectors accept, all merged, run completes clean.
- 1 issue, inspector rejects, fixer retries successfully, completes fixed (after retry).
- `--no-inspect` flag skips inspector; fixer valid + build pass → merge.
- `--pool-size 1` forces serial execution.

### Test-time spawn mock extension (`test-helpers.ts`)

Shared `mockSpawnForFixerAndInspector({ fixerVerdict?, fixerFixed?, inspectorAddresses? })` helper that writes the right JSON based on prompt substring matching. Reused across `issue-processor.test.ts`, `issue-inspector.test.ts`, and `fake-agent-integration.test.ts`.

### Mutation testing

Run `bun test:mutate:file <path>` on:

- `review-loop/src/worker-pool.ts` — concurrency logic, file-set dispatch.
- `review-loop/src/issue-processor.ts` — retry budget unification, inspector gate.
- `review-loop/src/loop-trace.ts` — new tally helpers.

No mutation on prompt strings — low signal.

### Accepted v1 limitations

- **Real LLM behavior** — the inspector actually catching wrong fixes is verified only by humans running it on real plans. Tests prove the wiring; they don't prove the LLM is a good inspector.
- **Real opencode subprocess concurrency** — pool git operations tested with real git; agent subprocess interactions mocked. `fake-agent-integration.test.ts` covers a few end-to-end cases but doesn't stress K-way parallelism under real CPU load.
- **Rebase conflict real-world frequency** — file-set dispatch heuristic is validated mechanically, not with real overlapping-fix scenarios.

These get validated by running review-loop on real plans as the post-implementation sanity check.

## Risks & Mitigations

| Risk                                                                                                                   | Mitigation                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inspector rejects too aggressively — false negatives waste fixer budget                                                | The retry prompt explicitly offers the "agree with inspector" branch so the fixer can confirm a real issue and return `invalid` without burning the retry. The `--no-inspect` flag provides an A/B comparison escape hatch. |
| Pool file-set dispatch is too coarse (reviewer's `file` doesn't capture all touched files) → frequent rebase conflicts | Conflicts don't consume the retry budget (rule 2). The issue goes to `needs_human` cleanly; the operator can re-run after resolving.                                                                                        |
| Concurrent agent subprocesses saturate CPU/memory                                                                      | Default K=3 is conservative; `--pool-size` lets operators tune down. Build phase is the heaviest; the existing `bun check:full` already parallelizes internally.                                                            |
| Inspector unavailable (both internal retries fail)                                                                     | Treat as `addresses: false` with `reasoning: "inspector unavailable"`. Same path as a real rejection — never merge an uninspected fix.                                                                                      |
| Stale worker worktrees accumulate after crashes                                                                        | Pool construction scans for `<runId>-worker-*` and removes them.                                                                                                                                                            |
| `runAgent` return-type change breaks downstream callers                                                                | All four callsites updated in the same change. No external consumers of `runAgent`.                                                                                                                                         |

## Out of Scope (tracked for follow-up cluster)

- Incremental reviewer (changed-files-only after round 1).
- Plan-task-aware issue mapping (issue tagged with `planTaskId`).
- Cost budget guard (abort when total cost exceeds threshold).
- Configurable retry count (`MAX_ATTEMPTS` stays a hard-coded constant at 2 in this cluster).
- Markdown/HTML run report.
- Mid-issue resume (persisting in-flight attempt state).
- Run-comparison tool.

These are tracked in the original review-loop improvements analysis. Each gets its own design pass before implementation.

## Self-Review Checklist

- [x] Every code change in the architecture section has a corresponding file path.
- [x] Every state in the per-issue lifecycle has at least one test in the coverage checklist.
- [x] Backward compatibility is preserved (existing `config.json` files work unchanged).
- [x] No "TBD" / "TODO" / unresolved placeholders.
- [x] No internal contradictions (unified retry budget is consistent across sections; inspector schema is stable across prompt/trace/ledger discussions).
- [x] Scope is bounded to two coupled improvements (parallel fixes + inspector) — follow-up cluster is explicitly listed as out of scope.
