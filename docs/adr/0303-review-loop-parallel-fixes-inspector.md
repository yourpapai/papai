<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0303: Review-Loop Parallel Fixes and Post-Fix Diff Inspection — Worker Pool and Inspector Gate

## Status

Implemented (with divergence)

## Date

2026-07-19

## Context

After ADR-0290 simplified the loop onto shell-invoked `opencode run` agents with a single per-round verify+fix flow, two limitations of that serial, trust-the-fixer model dominated run wall-clock and correctness on real plans:

1. **Serial fixing.** `loop-controller.ts` walked pending issues one at a time over the single primary worktree. N independent-file issues that touched unrelated code paid full fixer+build wall-clock sequentially — 3 issues that could complete in ~2 minutes took ~6. The fixer/build phase was the throughput bottleneck, and the build check (`bun check:full`) already parallelizes internally, so the serialization was pure orchestration overhead.
2. **No merge gate.** The fixer's `fixed: true` claim was trusted: a fix that compiled but did not actually address the reviewer's complaint was merged into the integration branch and only caught (maybe) by the next round's reviewer. "Builds" is not "addresses the issue."

The design (`docs/superpowers/specs/2026-07-19-review-loop-parallel-fixes-inspector-design.md`) and plan (`docs/superpowers/plans/2026-07-19-review-loop-parallel-fixes-inspector.md`) added two coupled mechanisms: a pool of K git worktrees with file-set-aware dispatch (bounded parallelism for the fixer/build/inspect phases; serial primary integration via a pool-internal mutex), and an inspector agent that runs after a build passes and before a merge, returning `{ addresses, reasoning, confidence }`. Inspector rejection consumes the same retry budget as build failure (one unified `MAX_ATTEMPTS = 2` per issue). Bad fixes are discarded before they reach the integration branch.

## Decision Drivers

- **Parallelize the per-issue fixer/build phase, not the reviewer or matcher.** A pool of K worktrees dispatches up to K issues concurrently; the reviewer and matcher stay single-call per round. Primary-branch updates stay serial through a pool mutex.
- **File-set-aware dispatch with starvation escape.** `acquire(primaryFile)` prefers workers whose busy peers are not touching the requested file, but falls back to any free worker when all free workers conflict — worst case a rebase conflict at merge time, handled cleanly.
- **Inspector gates the merge.** After a build passes, an inspector independently judges whether the diff addresses the issue; `addresses: false` retries the fixer with the inspector's reasoning, and a second rejection terminates at `needs_human`. Bad fixes never reach the integration branch.
- **One unified retry budget.** `MAX_ATTEMPTS = 2`: build failure and inspector rejection share the budget. A rebase conflict at merge does NOT consume it (not the fixer's fault).
- **Observability for the new phases.** `runAgent` returns per-run token/cost/wall (`AgentRunResult<T>`); `RoundMetric` gains `inspector`, per-phase `phaseMs`, and `usage` totals; a new `inspector_rejected` decision bucket and `inspect_complete` trace event feed the summary and `metrics.json`.
- **Backward compatible.** Existing `config.json` works unchanged: `poolSize` defaults to 3, `inspector` config falls back to `fixer`; `--pool-size 1 --no-inspect` reproduces pre-plan behavior.

## Considered Options

### Option 1 — K-worker git-worktree pool + inspector gate + unified retry budget (chosen)

A `WorkerPool` module owns K worktrees branched from primary HEAD. `processPendingIssues` dispatches issues with `pool.acquire(file)`; each issue's fixer→build→inspect→commit/merge runs on its own worker. An inspector agent (`issue-inspector.ts`) runs after build-pass and before merge; rejection retries the fixer with feedback. Build-failure and inspector-rejection share `MAX_ATTEMPTS = 2`; rebase conflicts at merge go to `needs_human` without consuming the budget. Per-phase wall-clock, token/cost, and inspector tallies feed the summary and `metrics.json`.

- **Pros:** cuts per-round wall-clock in proportion to issue independence; stops fixes that build but do not address the issue from reaching the integration branch; preserves the safety model (bad fixes never integrate; merge conflicts surface file names; stale worker worktrees swept on resume); fully backward compatible; deterministic per-issue lifecycle is testable with real git and a fake pool.
- **Cons:** K concurrent agent subprocesses contend for CPU/memory; parallel workers see only primary-at-dispatch-time + their own commits, so overlapping edits land in a rebase conflict (degraded to `needs_human`); the inspector is one extra LLM call per merged fix; primary-branch operations serialize behind the pool mutex.

### Option 2 — Per-issue worktrees (unbounded), rejected

One worktree per pending issue instead of a bounded pool.

- **Pros:** simplest dispatch (no acquire/release).
- **Cons:** unbounded concurrency — a 50-issue round spawns 50 simultaneous agent subprocesses and build checks, saturating the host. Explicitly listed as a non-goal in the spec; the bounded pool is the design choice.

### Option 3 — Separate retry budgets for build-failure and inspector-rejection, rejected

Distinct caps (e.g. 2 build-retries + 2 inspector-retries) instead of one shared `MAX_ATTEMPTS`.

- **Pros:** more granular per-failure-type control.
- **Cons:** explicitly a non-goal. The unified budget is the design choice: it caps total fixer attempts per issue regardless of why they failed, bounding cost and preventing a fixer/inspector disagreement loop from running indefinitely.

## Decision

The chosen Option 1 shipped across two new modules, the rewritten per-issue processor (decomposed across three files), the worker-pool worktree helpers, the schema/trace/observability foundation, and the CLI/config wiring. What shipped:

1. **`InspectorResultSchema` added.** `issue-schema.ts` gains `{ addresses: boolean, reasoning: string, confidence: number }`; `confidence` is logged for observability, not used to gate the verdict.
2. **Inspector prompts added.** `prompt-templates.ts` gains `buildInspectPrompt` (issue + diff + fixer reasoning; explicit anti-scope-creep language; actionable reasoning on reject) and `buildRetryFixWithInspectorFeedbackPrompt` (offers the "agree with inspector" branch so the fixer can return a terminal verdict without burning the retry).
3. **Trace/metric foundation extended.** `DecisionsSchema` gains `inspector_rejected`; `RoundMetricSchema` gains `inspector {runs, rejected}`, `phaseMs` (review/match/verify/build/inspect/fix), and `usage` totals; `TraceEventSchema` gains `inspect_complete`. `loop-trace.ts` adds `tallyInspector`, `tallyPhaseMs`, `tallyUsage`, and `emitInspectComplete`.
4. **`runAgent` returns `AgentRunResult<T> = { value, usage }`.** `LiveCtx` accumulates `step_finish` tokens/cost and measures wall-clock from `firstStepAt`; the four callsites (reviewer, matcher, fixer, inspector) extract `.value` and thread `.usage` into the collector.
5. **`issue-inspector.ts` created.** `runInspector` builds the diff input, invokes the agent, emits `inspect_complete`, and tallies the inspector. A `runInspectorOrTreatAsRejection` wrapper catches agent failure and treats it as `addresses: false` with reasoning "inspector unavailable" (spec rule 4 — never merge an uninspected fix).
6. **`worker-pool.ts` created.** `createWorkerPool` builds K worktrees from primary HEAD; `acquire(file)` does file-set-aware selection with a starvation-escape fallback; `release` drains the waiter queue; `mergeWorkerIntoPrimary` rebases the worker branch and fast-forwards under a primary mutex; `close` removes workers sequentially.
7. **Worktree helpers added.** `worktree.ts` gains `rebaseOnto` (conflict → `{ok:false, conflictFiles}` + abort), `mergeFastForward`, and `cleanWorkerWorktrees` (stale-worker sweep).
8. **Per-issue processor rewritten and decomposed.** `processPendingIssues` dispatches over the pool; the per-issue attempt loop is split into `issue-processor-attempts.ts` (`runFixerAttempt` → `runBuildAttempt` → `runInspectorAttempt` → `runCommitAttempt`, recursive on retry) and `commit-attempt.ts` (commit + merge; merge-conflict → `needs_human` without consuming the budget). `MAX_ATTEMPTS = 2` governs build-failure and inspector-rejection alike; the fixer agreeing with the inspector (verdict ≠ valid on retry) is terminal.
9. **Config + CLI wiring.** `config.ts` gains `poolSize` (default 3) and optional `inspector`; `cli.ts` parses `--pool-size` and `--no-inspect`, constructs the pool after the primary worktree, sweeps stale workers, and tears the pool down in `try/finally`.
10. **Observability rollup.** `summary.ts` reports inspector stats, total cost, and per-phase wall-clock; `metrics.json` gains `poolSize`, `usage`, `phaseMs`, and `inspectorRejected` totals. `ProgressReporter.live` takes `readonly string[]` and the renderer repaints per line.

## Consequences

### Positive

- The fixer/build/inspect phase now runs up to K issues concurrently, cutting per-round wall-clock in proportion to issue-count independence; the reviewer and matcher stay single-call, and primary integration stays serial behind the pool mutex.
- Fixes that build but do not address the issue are rejected before merge: the inspector's second rejection terminates at `needs_human`, and the retry prompt lets the fixer concede (return a terminal verdict) when the inspector is right.
- The unified `MAX_ATTEMPTS = 2` bounds total fixer attempts per issue regardless of failure type, and merge-conflict `needs_human` surfaces the conflicting file names without consuming that budget.
- Bad fixes never reach the integration branch; stale worker worktrees from crashed runs are swept at pool construction; per-phase token/cost/wall accounting makes the new phases measurable.

### Negative

- **K concurrent agent subprocesses contend for CPU/memory.** Default K=3 is conservative; `--pool-size` lets operators tune down. Parallel workers see only primary-at-dispatch-time plus their own commits, so overlapping edits land in a rebase conflict degraded to `needs_human`.
- **The inspector is one extra LLM call per merged fix** — real cost/latency, accepted as the price of the merge gate. `--no-inspect` is the A/B escape hatch.
- **Per-worker output paths and a serialized save chain were added beyond the plan** to make parallel writes race-free (see divergences); this is additive complexity the plan's serial `processIssue` did not need.

### Risks

- **The inspector is a correctness dependency.** A too-aggressive inspector wastes fixer budget (mitigated by the agree-with-inspector branch and `--no-inspect`); a too-lenient one ships fixes that do not address the issue (mitigated by the next round's reviewer). Tests prove the wiring; whether the LLM is a good inspector is validated only by running it on real plans.
- **File-set dispatch is coarse.** Only the reviewer's `file` is locked. The dispatcher guesses optimistically and handles conflicts at merge; frequent overlaps degrade throughput to `needs_human` but never corrupt state.
- **The pool-internal mutex serializes primary updates.** Under heavy primary churn, merges queue; per-worker fixer/build/inspect runs stay unlocked, so the throughput win is preserved, but merge-back is the serialization point.
- **In-flight attempt state is not persisted.** A crashed run loses the in-flight attempt; on resume the issue is redispatched from scratch (accepted; matches the pre-plan resume model).

## Related Decisions

- [ADR-0290](0290-review-loop-simplification.md) — Review-Loop Simplification: established the shell-invoked `opencode run` agent model, the single primary worktree, the UUID ledger, and the serial `processNextIssue` flow this ADR parallelizes and gates. ADR-0290's divergences already noted `poolSize`/`inspector` in config, `processIssue` extracted into `issue-processor.ts`/`issue-processor-attempts.ts`, and the worker pool/inspector as concurrent hardening — this ADR is the plan that introduced them.
- [ADR-0289](0289-review-loop-live-progress.md) — Review-Loop Live Progress Reporting: shipped the `withLivePhase` build phase, `runAgent` live rendering, and the trace/metrics foundation this ADR extends (`AgentRunResult<T>.usage`, `phaseMs`, the array-shaped `live()`).
- [ADR-0291](0291-review-loop-prompt-and-trace-improvements.md) — Review-Loop Prompt and Trace Improvements: the `plan_drift` verdict and `fixability`-aware verdict→status mapping this ADR's retry prompt and decision tallies build on.
- [ADR-0112](0112-review-loop-enhancements.md) — Review Loop Enhancements: severity expansion, plan-then-fix, commit discipline. The inspector and worker pool layer on top of the open-permission (`--auto`) posture and severity model 0112 established.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `review-loop/src/issue-schema.ts:39-43` | `InspectorResultSchema` — `{ addresses, reasoning, confidence }`; `confidence` logged, not gating. | `read` confirms. |
| `review-loop/src/config.ts:27,30` | `poolSize` (`.default(3)`) + `inspector: AgentConfigSchema.optional()`. | `read` confirms. |
| `review-loop/src/prompt-templates.ts:72-101` | `buildInspectPrompt` — anti-scope-creep language, diff inline, actionable reasoning on reject. | `read` confirms. |
| `review-loop/src/prompt-templates.ts:103-126` | `buildRetryFixWithInspectorFeedbackPrompt` — agree-with-inspector branch + final-attempt warning. | `read` confirms. |
| `review-loop/src/trace-log.ts:21-34` | `DecisionsSchema` + `emptyDecisions` carry `inspector_rejected`. | `read` confirms. |
| `review-loop/src/trace-log.ts:40-69` | `PhaseMsSchema`, `UsageTotalsSchema`, extended `RoundMetricSchema` (`inspector`/`phaseMs`/`usage`). | `read` confirms. |
| `review-loop/src/trace-log.ts:124-131` | `inspect_complete` trace event. | `read` confirms. |
| `review-loop/src/loop-trace.ts:19-37` | `RoundCollector` (`inspector`/`phaseMs`/`usage`) + `newCollector`. | `read` confirms. |
| `review-loop/src/loop-trace.ts:80-117` | `tallyInspector`, `tallyPhaseMs`, `tallyUsage`, `emitInspectComplete`. | `read` confirms. |
| `review-loop/src/agent-runner.ts:32-52` | `AgentUsage`, `AgentRunResult<T>`, `AgentRunError` (carries `usage`). | `read` confirms. |
| `review-loop/src/agent-runner.ts:277-295` | `runAgent` returns `AgentRunResult`; accumulates usage; throws `AgentRunError` on failure. | `read` confirms. |
| `review-loop/src/issue-inspector.ts:37-73` | `runInspector` returns `InspectorResult & { kind: 'inspected'; usage }`; diffs working-tree via `git add -N .` + `git diff baselineSha`. | `read` confirms. |
| `review-loop/src/issue-inspector.ts:75-123` | `runInspectorOrTreatAsRejection` catches failure → `{ kind: 'unavailable' }` (spec rule 4). | `read` confirms. |
| `review-loop/src/worktree.ts:112-140` | `rebaseOnto` — conflict → `{ok:false, conflictFiles}` + abort; non-conflict errors abort too. | `read` confirms. |
| `review-loop/src/worktree.ts:150-155` | `mergeFastForward`. | `read` confirms. |
| `review-loop/src/worktree.ts:157-182` | `cleanWorkerWorktrees` — runId-optional, basename check, sequential removal. | `read` confirms. |
| `review-loop/src/worker-pool.ts:12-31` | `Worker` / `WorkerPool` interfaces (+ `workerPaths()` diagnostic). | `read` confirms. |
| `review-loop/src/worker-pool.ts:39-84` | `peersTouchFile`/`selectWorker`/`waitForRelease`/`tryAcquire`/`releaseWorker`/`withPrimaryLock` — file-set dispatch, starvation escape (`?? free[0]!`), mutex. | `read` confirms. |
| `review-loop/src/worker-pool.ts:86-98` | `mergeWorkerIntoPrimary` — rebase (in worker worktree) + ff-only under mutex. | `read` confirms. |
| `review-loop/src/worker-pool.ts:147-176` | `createWorkerPool` — K workers from `config.poolSize`; sequential build/close chains. | `read` confirms. |
| `review-loop/src/issue-processor-attempts.ts:41-45` | `RetryReason` discriminated union + `MAX_ATTEMPTS = 2`. | `read` confirms. |
| `review-loop/src/issue-processor-attempts.ts:90-117` | `runFixerAttempt` — Branch A: verdict ≠ valid (or not fixed) → terminal. | `read` confirms. |
| `review-loop/src/issue-processor-attempts.ts:124-157` | `runBuildAttempt` — Branch B: build-failure retry budget exhausted → `needs_human`. | `read` confirms. |
| `review-loop/src/issue-processor-attempts.ts:164-211` | `runInspectorAttempt` — Branch C: inspector gate guarded by `deps.inspect !== false`; retry vs `needs_human`/`inspector_rejected`. | `read` confirms. |
| `review-loop/src/issue-processor-attempts.ts:217-264` | `processIssueAttempt` — recursive attempt loop wiring the four steps. | `read` confirms. |
| `review-loop/src/commit-attempt.ts:35-79` | `runCommitAttempt` — Branch D: commit + merge; merge-conflict → `needs_human` without consuming budget. | `read` confirms. |
| `review-loop/src/issue-processor.ts:77-102` | `makeSerializedSave` — coroutine-local save serialization for parallel ledger writes. | `read` confirms. |
| `review-loop/src/issue-processor.ts:104-181` | `makeDispatcher` + `processPendingIssues` — pool dispatch; per-issue failure → `needs_human` (does not abort the round). | `read` confirms. |
| `review-loop/src/loop-controller.ts:42-52` | `ReviewLoopDeps` carries `pool` + `inspect`. | `read` confirms. |
| `review-loop/src/loop-controller.ts:180-202` | `runProcessPendingIssues` threads `pool` + `inspect` into the processor deps. | `read` confirms. |
| `review-loop/src/summary.ts:117-142` | `computeObservabilityLines` — inspector stats, total cost, per-phase wall-clock. | `read` confirms. |
| `review-loop/src/summary.ts:144-191` | `buildSummary` / `buildMetricsJson` with `SummaryOptions { poolSize, inspect }`. | `read` confirms. |
| `review-loop/src/progress-log.ts:6-12` | `ProgressReporter.live(lines: readonly string[])`. | `read` confirms. |
| `review-loop/src/live-renderer.ts:103-125,146-156` | `withLivePhase` calls `reporter.live([...])`; `LiveRenderer.live` array repaint. | `read` confirms. |
| `review-loop/src/cli.ts:81-91` | `--pool-size` / `--no-inspect` parsing. | `read` confirms. |
| `review-loop/src/cli.ts:228-235` | `cleanWorkerWorktrees` + `createWorkerPool` + `try/finally` `pool.close()`. | `read` confirms. |
| `review-loop/src/run-state.ts:91-105` | `workerOutputPath(runDir, workerId, file)` — per-worker `<runDir>/workers/w<id>/<file>` destinations. | `read` confirms. |
| `review-loop/config.example.json:8,24-28` | `poolSize: 3` + dedicated `inspector` agent config. | `read` confirms. |
| `tests/review-loop/worker-pool.test.ts:33-182` | Pool lifecycle, acquire/release, file-set preference, blocking-on-busy, ff-merge, rebase-merge, conflict-files. | `read` confirms. |
| `tests/review-loop/issue-inspector.test.ts:75-243` | `runInspector` invocation + diff regression tests (empty-diff, untracked-file, absolute-path, fixer-reasoning). | `read` confirms. |
| `tests/review-loop/issue-processor-attempts.test.ts:12-50` | `buildAttemptPrompt` inspector-rejection retry branch. | `read` confirms. |
| `tests/review-loop/issue-processor-save-serialization.test.ts` | Parallel ledger-save serialization coverage (file added beyond plan). | `glob` confirms. |
| `tests/review-loop/loop-controller.test.ts:261-262` | `ReviewLoopDeps` built with `fakePool({ size: 1 })` + `inspect: true`. | `read` confirms. |
| `tests/review-loop/fake-agent-integration.test.ts:342-431` | "fake agent with pool + inspector" suite: 3 workers clean; reject→retry→fixed; `--no-inspect`. | `read` confirms. |
| `tests/review-loop/test-helpers.ts:79,161` | `fakePool` and `mockSpawnForFixerAndInspector` shared helpers. | `read` confirms. |

Plan-vs-implementation notes:

- **The per-issue processor was decomposed across three files, not one.** The plan placed the whole unified `processIssue` in `issue-processor.ts`. Shipped splits it: `issue-processor.ts` owns pool dispatch + parallel-save serialization; `issue-processor-attempts.ts` owns the attempt loop as discrete step functions (`runFixerAttempt`/`runBuildAttempt`/`runInspectorAttempt`/`processIssueAttempt`, recursive on retry); `commit-attempt.ts` owns the commit+merge step. The control flow (fixer → build → inspect → commit/merge), the `MAX_ATTEMPTS = 2` budget, and the `RetryReason` discriminator match the plan; the file shape does not. This is the decomposition ADR-0290/0289 already reference.
- **The inspector diffs the working tree, not `baselineSha..HEAD`.** The plan/spec's `runInspector` computed `git diff baselineSha..HEAD` (spec rule 6). Shipped (`issue-inspector.ts:53-54`) runs `git add -N .` then `git diff baselineSha` against the working tree. The reason: the fixer is instructed **not** to commit (ADR-0290's "orchestrator commits" rule), so at inspector time HEAD still equals `baselineSha` and a commit-to-commit diff would be empty. Working-tree diffing also surfaces newly created (untracked) fixer files; `tests/review-loop/issue-inspector.test.ts:171-243` are explicit regression tests for both the empty-diff and untracked-file bugs. Intent (diff the fixer's actual change) preserved; the mechanism changed to match the no-commit-by-fixer invariant.
- **`runInspector` gained an "unavailable" outcome (spec rule 4) via a wrapper.** The plan's `runInspector` returned `InspectorResult & { usage }`. Shipped (`issue-inspector.ts:33-43,75-123`) returns an `InspectorOutcome` discriminated union: `runInspector` returns `{ kind: 'inspected' }`, and `runInspectorOrTreatAsRejection` catches agent failure (timeout/malformed) and returns `{ kind: 'unavailable', reasoning: 'inspector unavailable: …' }` — consuming the retry budget like a real rejection, never merging an uninspected fix. `AgentRunError` carries `usage` so the unavailable path still accounts cost.
- **Per-worker output destinations replaced the plan's shared run-level files.** The plan had `processIssue` write `result.json`/`inspect.json` to shared `deps.runState.resultPath`/`inspectPath` and (Task 4 Step 1) add an `inspectPath` field to `RunState`. Shipped does neither: `run-state.ts` has no `inspectPath` field; instead `workerOutputPath(runDir, worker.id, file)` routes each worker's outputs to `<runDir>/workers/w<id>/<file>` (`run-state.ts:91-105`, used at `issue-processor-attempts.ts:58` and `issue-inspector.ts:94`). This eliminates the shared-destination read/write race when K workers run concurrently — a race the plan's serial `processIssue` never encountered.
- **A serialized save chain and resilient dispatcher were added beyond the plan.** `makeSerializedSave` (`issue-processor.ts:77-102`) chains per-issue `saveIssueLedger` calls so parallel workers' non-atomic `writeFile`s cannot race; the dispatcher (`issue-processor.ts:104-151`) catches a `processIssue` throw, records `needs_human` with the failure message, and lets the round continue instead of aborting every in-flight coroutine via `Promise.all`. `tests/review-loop/issue-processor-save-serialization.test.ts` covers the serialization. Neither is in the plan; both are concurrency-resilience hardening the worker pool necessitated.
- **`rebaseOnto` runs in the worker worktree, not the primary.** The plan/spec ran `rebase` in `primaryWorktreePath`; shipped (`worker-pool.ts:93`, `worktree.ts:112-140`) rebases the worker branch from the worker's own worktree, then fast-forwards primary. `rebaseOnto` also derives conflict files from `git diff --name-only --diff-filter=U` (`listUnmergedPaths`) rather than the plan's stdout-regex `parseConflictFiles`, and defensively aborts on non-conflict errors too.
- **`Worker.id` is optional and the pool gained a diagnostic method.** The plan's `Worker.id` was a required `number`. Shipped `IssueWorker.id` is `id?: number` (`issue-processor-attempts.ts:34-39`) so the type also admits the pre-pool serial shape, and the label suffix guards `worker.id === undefined` (`issue-inspector.ts:85`, `issue-processor-attempts.ts:101`). `WorkerPool.workerPaths()` (`worker-pool.ts:29,172`) is an added diagnostic for cleanup-on-error, not in the plan.
- **Worktree/worktree-pool operations serialize via promise chains.** `buildWorkers` and `closePool` (`worker-pool.ts:100-145`) and `cleanWorkerWorktrees` (`worktree.ts:175-181`) remove/add sequentially because `git worktree remove` and `git branch -D` take repo-wide locks and race under load. The plan created worktrees with a plain sequential `await` loop; shipped makes the chaining explicit and applies it to teardown and the stale sweep too.
- **`config.example.json` uses concrete models and the simpler check command.** The plan's example used `zai-coding-plan/glm-5.2` for every agent and `checkCommand: "export CI=true; bun build:client && bun check:full"`. Shipped (`config.example.json`) uses `ollama-cloud/kimi-k2.6:cloud` (reviewer/matcher/inspector) and `opencode/claude-sonnet-4-6` (fixer), plus `repoRoot: "."` and `checkCommand: "bun check:full"`. The `poolSize`/`inspector` shape matches the plan; the model strings and check command are operator-tuned defaults.
- **`--pool-size` applies via config mutation; `--no-inspect` via a deps flag.** As planned, but the wiring is `config.poolSize = args.poolSize` in `cli.ts:213` and `inspect: !args.noInspect` threaded `cli.ts` → `ReviewLoopDeps` → `IssueProcessorDeps` (`loop-controller.ts:51,196`). Both are runtime overrides, never persisted to `state.json` — matching the spec's resume semantics.

The source plan `docs/superpowers/plans/2026-07-19-review-loop-parallel-fixes-inspector.md` and design `docs/superpowers/specs/2026-07-19-review-loop-parallel-fixes-inspector-design.md` are archived alongside this ADR to `docs/archive/`.
