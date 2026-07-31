<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0291: Review-Loop Prompt, Correctness, Trace, and Metrics Improvements

## Status

Implemented (with divergence)

## Date

2026-07-16

## Context

The shell-invoked review loop shipped by ADR-0290 had run once against its own repo (Run 1), and a prompt-and-flow analysis against `prompt-templates.ts`, `issue-schema.ts`, `loop-controller.ts`, `issue-ledger.ts`, and `issue-matcher.ts` surfaced three categories of weakness (confirmed against deep research into LLM code-review best practices):

1. **Correctness bugs** — four remaining issues that are wrong regardless of any tuning data: (a) the retry prompt referenced "the same schema as before" but every `opencode run` is a fresh stateless subprocess with no prior schema in context; (b) `fixed: true` was trusted without proof — a fixer that reported `fixed:true` but changed nothing was still marked fixed (`HEAD === baselineSha`); (c) the three revert sites ran `reset --hard <sha>` without `git clean -fd`, so untracked scratch files survived the reset and leaked into the next issue's `git add -A` (validated in Run 1 `fa778fcef`); (d) `valid + manual` verdicts mapped to the non-terminal `verified` status and were re-run by the fixer every round until `max_rounds` (validated in Run 1 ledger — a direct cause of weak convergence).
2. **Prompt-quality gaps** — the reviewer/fixer/retry/matcher builders lacked evidence-gating, severity calibration, explicit scope/exclusions, and minimal-change discipline, and the fixer was instructed to commit (a dual-committer reliance with raw-title messages).
3. **No observability** — there was no structured record of loop behavior, so the team could not empirically decide which of the heavier, data-dependent improvements (false-positive early-exit, cross-model consensus, behavioral ratchet) were worth building.

The deliberate framing was "fix obvious bugs + apply conservative, research-validated prompt gains + instrument," **not** a full overhaul: it was too early to tune behavior on vibes, so the validated path was to fix what is plainly broken, apply near-universal best practices whose risk of making things worse is low, and instrument the loop so a few real runs produce the data needed to prioritize the rest. The design (`docs/superpowers/specs/2026-07-16-review-loop-prompt-and-trace-improvements-design.md`) and plan (`docs/superpowers/plans/2026-07-16-review-loop-prompt-and-trace-improvements.md`) chose Approach B and explicitly deferred the speculative behavioral knobs (confidence thresholding, FP early-exit, cross-model consensus, full behavioral ratchet) to follow-up specs once `trace.jsonl` justified them.

## Decision Drivers

- **Fix the correctness bugs first.** The retry prompt must inline its schema (stateless subprocesses); the loop must trust git, not the agent, for fix outcomes (`HEAD` must advance past `baselineSha` before believing `fixed:true`); reverts must run `git clean -fd` (no scratch-file leakage); `valid + manual` and `plan_drift` verdicts must map to terminal `needs_human` so manual issues stop consuming rounds.
- **Conservative, research-validated prompt gains; preserve the output contract.** Rewrite the _instructions_ around each builder (evidence-gating, scope/exclusions, severity calibration, minimal-change discipline, agent-composed commit messages) but keep the exact output JSON schema, with two additive exceptions: `FixerResultSchema` gains optional `commitMessage`/`severity`, and `VerifierDecisionSchema`'s verdict enum gains `plan_drift`. All additive, so old result/ledger/state files still validate (no migration).
- **Agent composes the commit message; the loop commits.** The fixer is the only actor that knows what it actually changed, so it returns a `commitMessage`; the loop is the single committer (`ensureFixerChangesCommitted`), sanitizes the message to one line, and falls back to the issue title only if absent. Removes the dual-committer reliance and fixes raw-title commit messages.
- **Instrument everything; trace never breaks a run.** A structured `trace.jsonl` (discriminated-union `TraceEvent`s, per-round `RoundMetric` accumulator with decision + dual-severity distributions) is injected via DI alongside the existing `spawn`/`exec`/`log`; all `append` calls are fire-and-forget and the file logger swallows fs errors. The per-round data also feeds a `metrics.json` and an ASCII burndown block so a few real runs produce the data the deferred knobs need.
- **Capture confidence, defer thresholding.** The reviewer is asked for honest confidence; the loop does not filter on it yet. The trace records the full distribution so a defensible cutoff can be chosen later.
- **Preserve prompt sentinel phrases.** Fake-agent routing in tests keys off substring sentinels (`"Review the current implementation"`, `"Verify and fix"`, `"build error"`, `"Match newly found"`); the rewritten prompts keep them verbatim.

## Considered Options

### Option 1 — Bugs + conservative prompt gains + trace (Approach B, chosen)

Fix the four correctness bugs, apply the near-universal best practices (evidence-gating, scope/exclusions, severity calibration, minimal-change discipline, agent-composed commit messages, `plan_drift`), and add a structured `trace.jsonl` + per-round metrics + burndown. First post-change runs double as calibration runs — exactly what the trace is for.

- **Pros:** fixes what is plainly broken; applies prompt wins whose risk of making things worse is low; instruments everything so the deferred behavioral knobs can be prioritized on data, not vibes; every schema/path change is additive (no migration, old runs load).
- **Cons:** the behavioral effect of prompts cannot be unit-tested (only measured via the trace on real runs); the trace is an extra artifact to maintain; conservative gains may under-deliver if the dominant pain turns out to need a heavier knob.

### Option 2 — Instrument + correctness bugs only (Approach A, rejected)

Lowest risk, but traces a known-weak baseline: the reviewer/fixer prompts keep their quality gaps, so early trace data partly measures a flawed prompt rather than real loop behavior.

- **Pros:** smallest change surface; pure instrumentation + bug fixes.
- **Cons:** ships a known-weak prompt and then instruments it; wastes the calibration runs that the trace exists to capture.

### Option 3 — Comprehensive (Approach C, rejected as premature)

Option B plus schema `.refine`, FP early-exit, full matcher ratchet rewrite, cross-model consensus. Builds behavioral machinery whose thresholds are currently guesses.

- **Pros:** addresses every candidate pain at once.
- **Cons:** over-engineering when "too early to say"; threshold values are guesses without trace data; high risk of building machinery that the data later shows is not the bottleneck.

## Decision

The chosen Option 1 shipped across a new trace module, additive schema fields, a worktree helper, the verdict→status mapping, the rewritten prompts, the metrics/summary artifacts, and the CLI wiring. What shipped:

1. **`trace-log.ts` created.** A `TraceEvent` discriminated union (Zod-schema'd) over `round_start`/`review_complete`/`match_complete`/`verify_complete`/`build_complete`/`fix_complete`/`round_summary`/`loop_end`; a `RoundMetric` accumulator (per-round `newIssues`/`cumulativeOpen`/`noProgressRounds` + `decisions` + dual `reviewerSeverity`/`fixerSeverity`); a `TraceLogger` interface with `createFileTraceLogger` (append-only JSONL that swallows fs errors) and `createCapturingTraceLogger` (in-memory, for DI in tests).
2. **`tracePath` synthesized on `RunState`.** Added to the `RunState extends PersistedRunState` interface and set to `<runDir>/trace.jsonl` in both `createRunState` and `loadRunState`, mirroring the existing `logPath`. Not added to `PersistedRunStateSchema` (synthesized from `runDir`, so old `state.json` loads without migration).
3. **Additive schema fields.** `VerifierDecisionSchema.verdict` gained `plan_drift`; `FixerResultSchema` gained optional `commitMessage` and `severity`. Old results still validate.
4. **`resetWorktreeTo` helper.** `worktree.ts` gained `resetWorktreeTo(worktreePath, sha)` = `reset --hard <sha>` + `clean -fd`, so reverts to `baselineSha` also sweep untracked scratch files.
5. **Verdict→status mapping fixed.** `mapVerifierDecisionToLedgerStatus` now reads `fixability`: `valid + manual → needs_human` (terminal), `valid + auto → verified`, and `plan_drift → needs_human` (terminal). Manual/plan-drift issues stop consuming rounds.
6. **Four prompts rewritten (sentinels preserved).** `buildReviewPrompt` gains plan-anchoring, the evidence-gating rule, explicit scope/exclusions, severity calibration, and AGENTS.md convention-awareness; `buildFixPrompt` keeps verify-before-fix ordering, adds minimal-change discipline, drops the commit instruction (the loop commits), and asks for `commitMessage`/`severity`/`plan_drift`; `buildRetryFixPrompt` inlines the exact JSON schema (no "same schema as before") and adds the "final attempt" clause; `buildMatcherPrompt` is strengthened to match on the underlying problem (keep `"Match newly found"` sentinel).
7. **Loop injects trace + accumulates metrics + emits events.** `ReviewLoopDeps` carries `trace: TraceLogger`; `ReviewLoopResult` carries `metrics?: RoundMetric[]`. Each round emits `round_start`/`review_complete`/`match_complete`/`verify_complete`/`build_complete`/`fix_complete`/`round_summary`, and each terminal return emits `loop_end` with the burndown series.
8. **Loop correctness: no-commit guard, matcher bounding, agent commit messages.** After the build passes and the orchestrator commits, `postSha === baselineSha` overrides the outcome to **not fixed** (no `recordFixAttempt`) and tallies a `no_commit` decision — a fixer that claims `fixed:true` but changes nothing is no longer believed. The matcher's existing-set is bounded to non-terminal records + records seen in the last 2 rounds (`MATCHER_RECENT_ROUNDS`). `ensureFixerChangesCommitted` uses the agent's sanitized `commitMessage` (one line, stripped of backticks/quotes), falling back to the issue title.
9. **`metrics.json` + ASCII burndown in `summary.ts`.** `buildSummary` appends a `Burndown:` block (one row per round: `new | open | fixed | rejected | needs_human | plan_drift | avgRev | avgFix`) when metrics are present; `buildMetricsJson` emits `{ doneReason, rounds, totals, burndown }`. Both are best-effort (generation failures swallowed).
10. **CLI wires the trace logger + metrics + SIGKILL escalation.** `cli.ts` constructs `createFileTraceLogger(runState.tracePath)`, passes `trace` into `runReviewLoop`, and writes `metrics.json` after the run (before `finalizeRun`, so artifacts always exist for post-mortem). The spawn timeout handler now escalates: after `SIGTERM` it starts a grace timer (default 5s, configurable via `killGraceMs`) and sends `SIGKILL` if the child has not exited.

## Consequences

### Positive

- The loop is now observable: a structured, greppable `trace.jsonl` ties the raw agent log, the durable ledger, and the loop's per-round decisions/severity distribution together, so a few real runs produce the data the deferred knobs (FP early-exit, consensus, ratchet) need to be prioritized on evidence rather than vibes. The `metrics.json` + ASCII burndown give an at-a-glance convergence signature (`new` trending down, `rejected` trending up, averages declining).
- The four correctness bugs are closed: stateless retry prompts carry their schema; `fixed:true` is verified against git (`HEAD` must advance); reverts sweep untracked files; manual/plan-drift issues go terminal instead of spinning every round.
- Prompts now carry the research-validated guards (evidence-gating, scope/exclusions, severity calibration, minimal-change discipline, all-call-sites enumeration) directly attacking the Run-1 failure modes (false-premise fixes that asserted impact without verifying). The agent composes the commit message and the loop is the single committer, removing the dual-committer reliance.
- Every schema/path change is additive: old `ledger.json`/`state.json`/`result.json` files still load; `tracePath` is synthesized, not persisted.

### Negative

- **The trace/metrics layer is real surface area to maintain.** A new DI seam (`TraceLogger`), a new persisted artifact (`trace.jsonl`), and two derived outputs (`metrics.json`, burndown block) — all best-effort, but they must stay correct as the loop evolves.
- **The behavioral effect of the prompt rewrites is not unit-testable** (cannot be) — it is exactly what the trace measures on real runs. Conservative gains may under-deliver if the dominant pain turns out to need a heavier knob that this plan deliberately deferred.
- **The matcher bounding uses a fixed `MATCHER_RECENT_ROUNDS = 2`.** A defensible but a-priori constant; the exact window is traceable via `match_complete` and may need tuning from trace data.

### Risks

- **Trace correctness depends on fire-and-forget discipline.** If a future change awaits a trace `append` or lets it throw, it can break a run; the contract ("trace never breaks a run") is enforced by the file logger swallowing fs errors and call sites `void`-discarding.
- **The no-commit guard trusts `HEAD` advancement as proof of a fix.** A fixer that rewrites a file to an identical tree (commit lands but is a no-op semantically) would still be marked fixed; the guard catches the "claimed fixed, changed nothing" case, not the "changed something irrelevant" case (the concurrent inspector agent, outside this plan, addresses the latter).
- **Prompt improvements are instructions; worst case the model partially ignores them.** They cannot break the output contract; the effect (severity/verdict/matched-new distributions, build-pass rate) is fully visible in the trace.

## Related Decisions

- [ADR-0290](0290-review-loop-simplification.md) — Review-Loop Simplification: the shell-invoked review loop this plan builds on. ADR-0290's divergences already noted that the trace/metrics system (`trace-log.ts`/`loop-trace.ts`/`summary.ts` burndown), the `plan_drift` verdict, and the agent-composed `commitMessage` were concurrent hardening layered on its simplified core; this ADR documents those layers as the plan that introduced them. ADR-0290's worker-pool/inspector divergences are the substrate the trace events and per-issue processing here plug into.
- [ADR-0289](0289-review-loop-live-progress.md) — Review-Loop Live Progress Reporting: the companion plan that made these shell-invoked agent turns (and the build phase) live-observable. The `phaseMs`/`usage` tallies and the `withLivePhase` build/verify flow that feed this ADR's per-round metrics were wired by ADR-0289; the trace `RoundMetric` carries those accumulators alongside the decision/severity distributions this plan added.
- [ADR-0112](0112-review-loop-enhancements.md) — Review Loop Enhancements: severity expansion, plan-then-fix, commit discipline, open permission policy. This ADR refines 0112's commit discipline (the loop, not the agent, now commits, using the agent-composed message) and its severity expansion (the trace now captures reviewer↔fixer severity drift), while preserving 0112's open-permission posture and verify-before-fix ordering.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `review-loop/src/trace-log.ts:78-148` | `TraceEventSchema` discriminated union — `round_start`/`review_complete`/`match_complete`/`verify_complete`/`build_complete`/`fix_complete`/`round_summary`/`loop_end` (plus `inspect_complete`, see divergence). | `read` confirms. |
| `review-loop/src/trace-log.ts:155-165` | `createFileTraceLogger` — append-only JSONL; fs errors caught (logs `console.warn`, see divergence) rather than thrown. | `read` confirms. |
| `review-loop/src/trace-log.ts:167-178` | `createCapturingTraceLogger` — in-memory logger for DI in tests. | `read` confirms. |
| `review-loop/src/trace-log.ts:58-69` | `RoundMetricSchema` — `round`/`newIssues`/`cumulativeOpen`/`noProgressRounds`/`decisions`/`reviewerSeverity`/`fixerSeverity` (plus `inspector`/`phaseMs`/`usage`, see divergence). | `read` confirms. |
| `review-loop/src/run-state.ts:32,55,81` | `tracePath: string` on `RunState`, set in `createRunState` and `loadRunState`; absent from `PersistedRunStateSchema` (synthesized from `runDir`, no migration). | `read` confirms. |
| `review-loop/src/issue-schema.ts:26` | `VerifierDecisionSchema.verdict` enum includes `plan_drift` (additive). | `read` confirms. |
| `review-loop/src/issue-schema.ts:35-36` | `FixerResultSchema` — optional `commitMessage`/`severity` (additive). | `read` confirms. |
| `review-loop/src/worktree.ts:60-63` | `resetWorktreeTo(worktreePath, sha)` — `reset --hard <sha>` + `clean -fd`. | `read` confirms. |
| `review-loop/src/issue-ledger.ts:215-229` | `mapVerifierDecisionToLedgerStatus` — `valid+manual→needs_human`, `valid+auto→verified`, `plan_drift→needs_human`. | `read` confirms. |
| `review-loop/src/prompt-templates.ts:8-28` | `buildReviewPrompt` — sentinel `"Review the current implementation"` + plan-anchoring + evidence rule + scope/exclusions + severity calibration + AGENTS.md. | `read` confirms. |
| `review-loop/src/prompt-templates.ts:30-48` | `buildFixPrompt` — sentinel `"Verify and fix"` + minimal-change + `"Do NOT commit"` + `commitMessage`/`severity`/`plan_drift` schema. | `read` confirms. |
| `review-loop/src/prompt-templates.ts:50-70` | `buildRetryFixPrompt` — sentinel `"build error"` + inlined schema (no "same schema as before") + "final attempt". | `read` confirms. |
| `review-loop/src/issue-matcher.ts:38-52` | `buildMatcherPrompt` — sentinel `"Match newly found"` + "underlying problem" matching instruction. | `read` confirms. |
| `review-loop/src/loop-controller.ts:42-52` | `ReviewLoopDeps` carries `trace: TraceLogger` (plus `pool`/`inspect`, see divergence). | `read` confirms. |
| `review-loop/src/loop-controller.ts:40,146-149` | `MATCHER_RECENT_ROUNDS = 2` bounding — existing-set filtered to non-terminal + last-2-rounds records. | `read` confirms. |
| `review-loop/src/loop-controller.ts:74-108,204-251` | `pushRoundMetric`/`finishRound`/`runRound` — accumulate metrics, emit `round_start`/`review_complete`/`match_complete`/`round_summary`/`loop_end`; `ReviewLoopResult.metrics`. | `read` confirms. |
| `review-loop/src/loop-trace.ts:28-37,99-237` | `RoundCollector` + `emit*`/`tally*` helpers (trace emission extracted here, see divergence). | `read` confirms. |
| `review-loop/src/commit-attempt.ts:47-49` | No-commit guard — `postSha === baselineSha` → `collector.decisions.no_commit += 1`, no `recordFixAttempt`. | `read` confirms. |
| `review-loop/src/commit-attempt.ts:18,25-28` + `review-loop/src/issue-processor.ts:33` | `ensureFixerChangesCommitted` takes `commitMessage`; `sanitizeSubject` strips backticks/quotes/newlines, one line, fallback to issue title. | `read` confirms. |
| `review-loop/src/issue-processor-attempts.ts:109,234,238,254,258` | Revert sites call `worker.resetToBaseline(baselineSha)` (the worker abstraction). | `read` confirms. |
| `review-loop/src/worker-pool.ts:120-123` | `resetToBaseline` = `reset --hard <sha>` + `clean -fdx -e .review-loop` (see divergence — not `resetWorktreeTo`). | `read` confirms. |
| `review-loop/src/spawn.ts:37-47` | SIGKILL escalation — `setupKillTimers` sends `SIGTERM` then `SIGKILL` after `killGraceMs` grace (default 5000); process-group kill. | `read` confirms. |
| `review-loop/src/agent-runner.ts:28` | `SpawnFn` options carry `killGraceMs?: number` (additive). | `read` confirms. |
| `review-loop/src/cli.ts:227,200` | `createFileTraceLogger(runState.tracePath)` constructed and passed as `trace` to `runReviewLoop`. | `read` confirms. |
| `review-loop/src/cli.ts:164-181` | `writeRunArtifacts` writes `summary.txt` + `metrics.json` (try/catch around `metrics.json`); before `finalizeRun`. | `read` confirms. |
| `review-loop/src/summary.ts:51-76` | `burndownBlock` — ASCII table appended under `Burndown:`. | `read` confirms. |
| `review-loop/src/summary.ts:166-191` | `buildMetricsJson` — `{ doneReason, rounds, totals, burndown }`. | `read` confirms. |
| `tests/review-loop/trace-log.test.ts:24-56` | `createFileTraceLogger appends JSONL and swallows fs errors`; `TraceEventSchema`/`RoundMetricSchema` validation. | `read` confirms. |
| `tests/review-loop/summary.test.ts:47,117,152` | Burndown-block + `buildMetricsJson` series/totals assertions. | `read` confirms. |
| `tests/review-loop/prompt-templates.test.ts:55-88` | Sentinel + evidence/`commitMessage`/`plan_drift` content-contract locks. | `read` confirms. |
| `tests/review-loop/loop-controller.test.ts:857-894,934` | Trace-event sequence + per-round `metrics`; sanitized `commitMessage` commit subject. | `read` confirms. |
| `tests/review-loop/issue-ledger.test.ts:149` | `plan_drift → needs_human (terminal)`. | `read` confirms. |

Plan-vs-implementation notes:

- **Trace emission was extracted into `loop-trace.ts`; `verify_complete` pushed further into `issue-ledger.ts`.** The plan's Tasks 7/8 placed the `RoundCollector`, `nowIso`, and the `emit*` helpers inline in `loop-controller.ts`, with `verify_complete`/`build_complete`/`fix_complete` emitted at the matching `processIssue` sites. Shipped, the collectors and emit/tally helpers live in a dedicated `loop-trace.ts`, and the `verify_complete` emission was pushed down into `issue-ledger.ts` (`recordVerify`/`recordNeedsHuman` call `emitVerifyComplete`). Intent (per-round metrics + per-event trace) is preserved; the decomposition is structural.
- **Per-issue processing was extracted into `issue-processor.ts`/`issue-processor-attempts.ts` over a `WorkerPool`.** The plan's `processIssue`/`processNextIssue` lived in `loop-controller.ts`; shipped, `loop-controller.ts:180-202` delegates to `processPendingIssues`, which dispatches across a `WorkerPool` of per-worker worktrees, and the verify→build→(inspect)→commit retry flow lives in `issue-processor-attempts.ts`. The no-commit guard, `commitMessage` handling, and the revert sites therefore live in `commit-attempt.ts`/`issue-processor-attempts.ts`, not `loop-controller.ts`. This is concurrent hardening (the worker-pool/inspector work ADR-0290 and ADR-0289 also reference); the correctness intents (no-commit guard, agent commit message, `clean` on revert) all shipped.
- **An inspector agent was added (concurrent hardening, outside this plan).** The plan has reviewer + fixer + matcher. Shipped adds a fourth — an `inspector` (`issue-inspector.ts`, `InspectorResultSchema` at `issue-schema.ts:39-43`, `buildInspectPrompt`/`buildRetryFixWithInspectorFeedbackPrompt` at `prompt-templates.ts:72-126`, an `inspect: boolean` toggle on `ReviewLoopDeps`/CLI `--no-inspect`). It surfaces in the trace as an `inspector_rejected` decision bucket (`trace-log.ts:28,33`), an `inspect_complete` event (`trace-log.ts:124-131`), an `inspector` counter on `RoundMetric` (`trace-log.ts:66`), and inspector columns in the burndown/`metrics.json`. Additive; the two-roles-plus-matcher core this plan specified is preserved.
- **Usage/timing metrics were added to `RoundMetric`.** The plan's `RoundMetric` carried decisions + dual severity. Shipped adds `phaseMs` (per-phase wall clock) and `usage` (input/output/reasoning tokens + cost), aggregated from each `runAgent` result, plus inspector counters. These feed extra `summary.txt`/`metrics.json` columns (total cost, wall-clock-per-phase, inspector reject rate). Additive concurrent hardening; the decision/severity metrics the plan specified are preserved.
- **`realSpawn` lives in `spawn.ts`, not `cli.ts`; SIGKILL escalation does process-group kill.** The plan's Task 10 placed `realSpawn` in `cli.ts` and escalated with plain `child.kill('SIGKILL')`. Shipped, `realSpawn` is in `spawn.ts` and the timeout handler (`spawn.ts:37-47`) kills the process **group** (`detached: true` + `killGroup`) — more robust than a single-process kill. `cli.ts` imports it. Intent (SIGKILL after a grace period on timeout, configurable via `killGraceMs`) preserved.
- **The live revert sites do not call `resetWorktreeTo` directly.** The plan's Task 4 added `resetWorktreeTo` to `worktree.ts` and Task 8a routed the three `loop-controller` revert sites through it. Shipped, `resetWorktreeTo` exists as specified (`worktree.ts:60-63`, `reset --hard <sha>` + `clean -fd`), but the live revert sites instead call `worker.resetToBaseline` (`worker-pool.ts:120-123`), which inlines its own `clean -fdx -e .review-loop` (more aggressive — `-x` removes ignored files too, with an exception for `.review-loop`). The leak fix intent (`clean` on revert, spec §2 #3) is satisfied — more strictly than planned — but via the worker abstraction rather than the shared helper.
- **`summary.ts` signatures are positional, not a `result` object; the burndown/`metrics.json` gained extra columns.** The plan's `formatSummary(result)` took a `ReviewLoopResult`-shaped object with optional `metrics`; `buildMetricsJson(result: ReviewLoopResult)`. Shipped, both are positional (`buildSummary(doneReason, rounds, closed, metrics, options)` / `buildMetricsJson(doneReason, rounds, closed, metrics, options)`, with an `options: { poolSize, inspect }`) and the burndown header / `metrics.json` carry extra columns (`insp_rej`, `poolSize`, `usage`, `phaseMs`, `inspectorRejected`). Intent (ASCII burndown + `metrics.json` burndown series) preserved.
- **`createFileTraceLogger` logs a `console.warn` on fs error.** The plan/spec invariant was "trace failures must never break a run" with the file logger swallowing fs errors silently. Shipped (`trace-log.ts:160-162`) it catches the error but emits a `console.warn`; the run is still never broken. Minor deviation from "silently."
- **The reviewer prompt gained two additive clauses beyond the plan.** Alongside the plan's evidence-gating/scope/severity/AGENTS.md clauses, `buildReviewPrompt` adds a "Verification budget" clause (reviewer must NOT run test suites/builds/typechecks/linters — the fixer and final build check own build/test verification) and a "`confidence` is a probability between 0 and 1, NOT a 1-5 rating" clarification. Additive content-contract hardening; the sentinels and plan clauses are preserved.

The source plan `docs/superpowers/plans/2026-07-16-review-loop-prompt-and-trace-improvements.md` and design `docs/superpowers/specs/2026-07-16-review-loop-prompt-and-trace-improvements-design.md` are archived alongside this ADR to `docs/archive/`.
