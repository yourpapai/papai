<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0290: Review-Loop Simplification — Replace ACP Orchestration With Shell-Invoked opencode Agents

## Status

Implemented (with divergence)

## Date

2026-07-15

## Context

The `review-loop/` workspace orchestrated an autonomous code-review → verify → fix → re-review loop over **ACP (Agent Client Protocol) subprocess management**: ~600 lines of JSON-RPC-over-stdio plumbing (`acp-process-client.ts`, `acp-connection-methods.ts`, `process-lifecycle.ts`, `agent-session.ts`, `permission-policy.ts`, `available-commands.ts`) existed to spawn and drive a long-lived agent session, plus `issue-fingerprint.ts` for SHA-256-based cross-round dedup. A pre-plan audit surfaced eight issues, of which the root-cause cluster was architectural:

1. **Never used** — `.review-loop/runs/` was empty; ~1,700 lines of code (source + tests) for a tool that had never been run against this repo.
2. **Command-name mismatch** — config referenced `/review-code` but the command file registered `/code-review`; with `requireInvocationPrefix: false` the reviewer never got the specialized persona.
3. **No build validation** — the loop never checked that `bun check:full` passed after a fix; broken fixes piled on top of each other.
4. **No git isolation** — runs happened in the current working directory with no worktree or branch management.
5. **Fragile fingerprinting** — SHA-256 over 5 text fields broke dedup across rounds on any rephrasing.
6. **No planning/build guardrails** — broken fixes accumulated; a hung agent was invisible.

The root cause was that ACP session management was the wrong abstraction: `opencode run` can achieve the same one-shot agent invocation in a single shell call, with file-based data exchange and the orchestrator (not the agent) owning build validation and git isolation. The design (`docs/superpowers/specs/2026-07-15-review-loop-simplification-design.md`) and plan (`docs/superpowers/plans/2026-07-15-review-loop-simplification.md`) chose to delete all ACP plumbing and rebuild the loop around shell-invoked agents, a UUID-keyed durable ledger with LLM-based semantic matching, orchestrator-run build checks, and a `git worktree` per run.

## Decision Drivers

- **Delete the wrong abstraction.** ~600 lines of ACP JSON-RPC session plumbing must be replaced by a single `opencode run` shell call per agent turn; the abstraction must match the actual usage (one-shot agent invocations, not long-lived sessions).
- **File-based data exchange, validated by the orchestrator.** Agents write structured JSON to gitignored scratch files; the orchestrator reads + Zod-validates each one and retries once on missing/invalid JSON. No in-process RPC result channel.
- **Stable identity, semantic dedup.** Cross-round issue matching must be by underlying problem (semantic), not string hashing; each discovered issue gets a stable UUID assigned once.
- **The orchestrator owns build status and git isolation.** After each fix the orchestrator runs `checkCommand` itself and reverts on failure; all work happens in an auto-created `git worktree` that is merged back at the end. The agent never commits.
- **Keep the 8-state issue lifecycle; converge by omission.** The `fixed_pending_review → closed` transition is driven by "not re-reported next round" (the next full review *is* the re-review), replacing an explicit re-review step.
- **Per-issue verify+fix (Approach C).** One reviewer `opencode run` per round, then N fixer calls (verify + fix in one session), with build validation after each. N+1 spawns per round — fewer than the 2N+1 the old ACP flow implied.
- **Full auto-approve, made explicit.** Agents get `--auto` (the shipped spelling of the design's `--dangerously-skip-permissions`); same risk profile as the prior open permission policy, no longer hidden in policy code.

## Considered Options

### Option 1 — Replace ACP with shell-invoked `opencode run` + file exchange + UUID ledger + worktree + orchestrator build validation (chosen)

Delete all ACP plumbing. Two agent roles (reviewer + fixer) plus a matcher, each invoked via `opencode run` with a model from config. Agents write JSON to scratch files; the orchestrator reads/validates with Zod and retries once on invalid output. UUID-keyed ledger with an LLM matcher for semantic cross-round dedup. Orchestrator creates a `git worktree`, runs the check command itself after each fix (revert on failure), and merges the worktree branch back at the end.

- **Pros:** deletes ~600 lines of session plumbing and the fragile fingerprinter; the orchestrator becomes the single source of truth for build status and git state; dedup survives rephrasing; the agent contract is a one-shot shell call + a file, trivially fakeable in tests; resume is ledger-only.
- **Cons:** N+1 process spawns per round (each `opencode run` has ~2-5s startup); breaking change to the review-loop config shape and every internal module; the matcher is an extra LLM call per round.

### Option 2 — Per-issue verify + per-issue fix (Approach A, rejected)

Mirror the existing ACP flow with `opencode run`: 2N+1 spawns per round (separate verify and fix calls per issue).

- **Pros:** most granular per-issue control.
- **Cons:** most process spawns; the verify and fix steps share context the agent must rebuild each spawn; strictly dominated by Approach C (which folds verify+fix into one session).

### Option 3 — Batch fixer per round (Approach B, rejected)

One reviewer + one fixer `opencode run` per round; the fixer handles all issues in one session.

- **Pros:** simplest orchestrator; fewest spawns.
- **Cons:** if the fixer chokes on one issue the whole batch suffers; no per-issue build validation (one broken fix contaminates the rest); loses the broad→narrow verify funnel.

## Decision

The chosen Option 1 shipped across the schema, config, ledger, four new modules, the rewritten loop controller/CLI, and the deletion of all ACP code. What shipped:

1. **ACP plumbing deleted.** `acp-process-client.ts`, `acp-connection-methods.ts`, `process-lifecycle.ts`, `agent-session.ts`, `permission-policy.ts`, `available-commands.ts`, and `issue-fingerprint.ts` (plus their tests and `fake-agent.ts`) are gone; `@agentclientprotocol/sdk` was removed from `review-loop/package.json` (only `zod` remains).
2. **`issue-schema.ts` simplified.** `VerifierDecisionSchema` dropped `needsPlanning`; `ReviewerIssuesSchema` dropped `round`; `FixerResultSchema` and `IssueMatchSchema`/`IssueMatchesSchema` were added for file-based exchange.
3. **`config.ts` simplified.** ACP `command`/`args`/`env`/`sessionConfig`/`invocationPrefix` fields replaced by a model-based `AgentConfigSchema` (`model`/`extraArgs`); top-level `checkCommand` and a `matcher` agent added.
4. **`run-state.ts` simplified.** Session IDs/session-pointer files dropped; worktree path + artifact file paths (`issues`/`result`/`matches`/`log`) added.
5. **`issue-ledger.ts` rewritten.** SHA-256 fingerprint keys replaced by UUID `id`; `applyReviewRound` (which computed fingerprints) replaced by `applyMatchedIssues` (which consumes LLM-provided matches); `closeUnreportedFixed` added for the convergence transition; the 8-state lifecycle preserved.
6. **`agent-runner.ts` created.** Wraps `opencode run` shell calls with file-based exchange + Zod validation + retry-once-on-invalid.
7. **`issue-matcher.ts` created.** Builds the LLM matching prompt, invokes the agent-runner, parses `matches.json`, returns matches for the ledger (short-circuits to all-null when the ledger is empty).
8. **`worktree.ts` created.** `git worktree` lifecycle: create, merge-back, cleanup, resume detection.
9. **`build-checker.ts` created.** Runs `checkCommand` in the worktree, captures exit code/stderr for retry escalation.
10. **`loop-controller.ts` rewritten.** New per-round flow: review → match → per-issue verify+fix → build-validate → converge.
11. **`prompt-templates.ts` rewritten** for file-based exchange (instruct agents to write JSON to a path; dropped the planning prompt and invocation-prefix support). `summary.ts` and `cli.ts` updated to the new ledger/run-state shape.

## Consequences

### Positive

- ~600 lines of ACP JSON-RPC session plumbing and the fragile SHA-256 fingerprinter are gone; the agent contract is now a one-shot `opencode run` shell call plus a scratch file, which is trivially fakeable in tests (a shell script instead of a JSON-RPC-speaking fake agent).
- The orchestrator is the single source of truth for build status and git state: it runs `checkCommand` itself after each fix, reverts broken fixes, and isolates every run in a `git worktree` that is merged back on success and preserved on failure.
- Cross-round dedup survives rephrasing: a UUID is assigned once on discovery, and the LLM matcher links re-reports to existing records by underlying problem rather than by a hash of the wording.
- Resume is ledger-only: reload the ledger, reuse or recreate the worktree, resume from the next round.
- The config shape is drastically simpler (model + extraArgs per agent, a `checkCommand`, no RPC/session/prefix fields).

### Negative

- **Breaking change to the review-loop config shape** and every internal module: `command`/`args`/`env`/`sessionConfig`/`invocationPrefix` are gone; any dev-only config must be re-saved through `config.example.json`'s shape. Pre-real-use, so no migration burden.
- **N+1 process spawns per round.** Each `opencode run` pays ~2-5s startup; this is the explicit cost of the simpler abstraction (accepted over the 2N+1 ACP flow).
- **An extra LLM call per round** (the matcher) that did not exist under fingerprinting — necessary for semantic dedup, but it is real cost/latency.

### Risks

- **The matcher is a dedup correctness dependency.** If the LLM matcher mis-links or fails to link, issues are either double-counted (false new) or silently dropped (false reopen-as-existing). The matcher short-circuits to all-null when the ledger is empty (round 1) and is only invoked when there are existing non-terminal records, limiting blast radius; a bad match affects one round's ledger transitions, not the git state.
- **`--auto` is full auto-approve.** Agents run with no permission gating, same risk profile as the deleted open permission policy — now explicit in the spawn args rather than hidden in policy code. The worktree isolation contains the blast radius to the run branch.
- **Orchestrator-run build checks assume `checkCommand` is meaningful.** A `checkCommand` that passes on broken code (or times out) degrades the revert-on-failure guarantee. The build check has a configurable timeout and reverts on timeout, but cannot detect a check that lies.

## Related Decisions

- [ADR-0289](0289-review-loop-live-progress.md) — Review-Loop Live Progress Reporting: the companion plan that made the shell-invoked agent turns (added here) live-observable. ADR-0289's divergences (`withLivePhase`, the build phase living in `build-checker.ts`, the worker pool, `processIssue` extracted into `issue-processor.ts`/`issue-processor-attempts.ts`) reflect the simplified structure this ADR established; the reviewer/matcher/fixer/inspector call sites that now carry `reporter` are the ones this ADR created.
- [ADR-0112](0112-review-loop-enhancements.md) — Review Loop Enhancements: severity expansion, plan-then-fix, commit discipline, open permission policy. This ADR supersedes 0112's ACP-based agent invocation and `needsPlanning` planning step (the fixer now plans internally within its `opencode run` session), while preserving 0112's severity expansion, commit discipline intent, and open-permission posture.
- [ADR-0064](README.md) — ACP Review Automation: the original review-loop architecture whose ACP subprocess plumbing this ADR deletes. (ADR-0064's source file was pruned with the 0001-0100 batch; referenced via the index.)

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`. The no-residue verification (`rg "acp|fingerprint|needsPlanning|@agentclientprotocol|invocationPrefix" review-loop/ tests/review-loop/`) returns only the plan's own negative test asserting `needsPlanning` is absent from `VerifierDecisionSchema` (`tests/review-loop/issue-schema.test.ts:41,49`); no ACP/fingerprint code remains.

| File | Role | Evidence |
| --- | --- | --- |
| `review-loop/src/issue-schema.ts:25-30` | `VerifierDecisionSchema` — no `needsPlanning`; verdicts `valid`/`invalid`/`already_fixed`/`needs_human` (+`plan_drift`, see divergence). | `read` confirms. |
| `review-loop/src/issue-schema.ts:21-23` | `ReviewerIssuesSchema` — `{ issues }` only, no `round`. | `read` confirms. |
| `review-loop/src/issue-schema.ts:32-37` | `FixerResultSchema` extends `VerifierDecisionSchema` with `fixed`/`commitSha` (added for file-based fixer exchange). | `read` confirms. |
| `review-loop/src/issue-schema.ts:45-52` | `IssueMatchSchema`/`IssueMatchesSchema` — `{ newIssueIndex, existingId: string \| null }` for the matcher output. | `read` confirms. |
| `review-loop/src/config.ts:13-17` | `AgentConfigSchema` — `{ model, extraArgs, timeoutMs? }`; ACP `command`/`args`/`env`/`sessionConfig`/`invocationPrefix` gone. | `read` confirms. |
| `review-loop/src/config.ts:19-32` | `ReviewLoopConfigSchema` — `checkCommand` + `reviewer`/`fixer`/`matcher` (+`poolSize`/`inspector`/`agentTimeoutMs`/`buildTimeoutMs`, see divergence). | `read` confirms. |
| `review-loop/src/run-state.ts:14-20` | `PersistedRunStateSchema` — `runId`/`repoRoot`/`planPath`/`currentRound`/`noProgressRounds`; no session IDs. | `read` confirms. |
| `review-loop/src/run-state.ts:24-34` | `RunState` carries `worktreePath` + artifact paths (`ledger`/`issues`/`result`/`matches`/`log`). | `read` confirms. |
| `review-loop/src/issue-ledger.ts:27-44` | `LedgerIssueRecordSchema` — `id: string` (UUID); no `fingerprint`. 8-state `status` enum preserved. | `read` confirms. |
| `review-loop/src/issue-ledger.ts:108-129` | `applyMatchedIssues` — consumes LLM `IssueMatch[]`, reopens matched / creates new (UUID) records; replaces fingerprint-computing `applyReviewRound`. | `read` confirms. |
| `review-loop/src/issue-ledger.ts:131-138` | `closeUnreportedFixed` — marks `fixed_pending_review` issues not re-reported this round as `closed` (convergence transition). | `read` confirms. |
| `review-loop/src/agent-runner.ts:218-236` | `attemptRun` invokes `opencode run --auto --format json --model … --dir … <prompt>` — single shell call per turn. | `read` confirms. |
| `review-loop/src/agent-runner.ts:277-295` | `runAgent` retries once on missing/invalid output, then throws `AgentRunError`. | `read` confirms. |
| `review-loop/src/issue-matcher.ts:54-83` | `matchIssues` — short-circuits to all-null when ledger empty; otherwise builds prompt, calls agent-runner, returns matches. | `read` confirms. |
| `review-loop/src/worktree.ts:38-44` | `createWorktree` — `git worktree add <path> -b review-loop/<runId>`. | `read` confirms. |
| `review-loop/src/worktree.ts:76-99` | `mergeWorktree` — `git merge --no-edit`; aborts on conflict and returns conflict files (see divergence). | `read` confirms. |
| `review-loop/src/build-checker.ts:55-62` | `runBuildCheck` — runs `exec`, returns `{ passed: exitCode === 0, stdout, stderr }`. | `read` confirms. |
| `review-loop/src/loop-controller.ts:114-138` | `runReviewStep` — reviewer `runAgent` → `ReviewerIssuesSchema`. | `read` confirms. |
| `review-loop/src/loop-controller.ts:140-178` | `runMatchAndRecord` — `matchIssues` → `applyMatchedIssues` → `closeUnreportedFixed` → save ledger. | `read` confirms. |
| `review-loop/src/loop-controller.ts:204-251` | `runRound` — review → match → process pending → converge (`no_progress`/`max_rounds`/recurse). | `read` confirms. |
| `review-loop/src/prompt-templates.ts:8-28` | `buildReviewPrompt(planPath, outputPath)` — file-based exchange; instructs write to `outputPath`. | `read` confirms. |
| `review-loop/src/prompt-templates.ts:30-48` | `buildFixPrompt(issue, outputPath, checkCommand)` — verify+fix in one session; agent does **not** commit (orchestrator does). | `read` confirms. |
| `review-loop/config.example.json:1-29` | New config shape: `checkCommand`, `reviewer`/`fixer`/`matcher`/`inspector` model configs, `poolSize`. | `read` confirms. |
| `review-loop/package.json:13-15` | `dependencies` is `zod` only; `@agentclientprotocol/sdk` removed. | `read` confirms. |
| `glob review-loop/src/{acp-*,process-lifecycle,agent-session,permission-policy,available-commands,issue-fingerprint}.ts` | ACP source files deleted — **no files found**. | `glob` confirms. |
| `glob tests/review-loop/{acp-*,available-commands,permission-policy,issue-fingerprint,fake-agent}.test.ts` | ACP test files + `fake-agent.ts` deleted — **no files found**. | `glob` confirms. |
| `tests/review-loop/{agent-runner,worktree,build-checker,issue-matcher,fake-agent-integration}.test.ts` | New-module tests + rewritten fake-integration test present. | `glob` confirms. |

Plan-vs-implementation notes:

- **The simple sequential `loop-controller` was replaced by a worker-pool concurrent processor.** The plan's `loop-controller.ts` processed issues with a `for` loop and an inline `processIssue`. Shipped, `loop-controller.ts:180-202` delegates to `processPendingIssues` (`issue-processor.ts`), which dispatches across a `WorkerPool` (`worker-pool.ts`, config `poolSize`, default 3) of per-worker worktrees; the per-issue verify/build/retry flow lives in `issue-processor.ts` / `issue-processor-attempts.ts`. The per-round control flow (review → match → process → converge) and the `doneReason` taxonomy are preserved verbatim; the concurrency model and file decomposition are the concurrent hardening ADR-0289 also references.
- **An inspector agent was added.** The plan has two agent roles (reviewer + fixer) plus a matcher. Shipped adds a fourth — an `inspector` (`issue-inspector.ts`, `InspectorResultSchema` at `issue-schema.ts:39-43`, `buildInspectPrompt`/`buildRetryFixWithInspectorFeedbackPrompt` at `prompt-templates.ts:72-126`, config `inspector` agent) that independently judges whether a diff actually addresses the issue before the fix is accepted. `loop-controller.ts:51` carries an `inspect: boolean` toggle. This is concurrent review-loop hardening outside this plan's scope; the two-roles-plus-matcher core is preserved.
- **A trace/metrics system was added.** The plan's `summary.ts` change was "minor: read `id` instead of `fingerprint`." Shipped, `summary.ts` is a full metrics module (`buildSummary`/`buildMetricsJson` with burndown, per-phase wall clock, token/cost totals, severity averaging) backed by `trace-log.ts` (`TraceLogger`, `RoundMetric`) and `loop-trace.ts` (event emitters / `RoundCollector`). `run-state.ts:32` carries a `tracePath`. This observability layer is concurrent hardening; the ledger identity change (`id` not `fingerprint`) the plan specified is subsumed.
- **`plan_drift` verdict added.** `VerifierDecisionSchema.verdict` (`issue-schema.ts:26`) and `FixerResult` carry a fifth verdict `plan_drift` not in the plan, for "code diverged from plan but is not a defect." `mapVerifierDecisionToLedgerStatus` (`issue-ledger.ts:223-224`) maps it to `needs_human`, and `buildFixPrompt` instructs the agent to return it. Additive; the four plan verdicts are preserved.
- **`mergeWorktree` gained conflict handling.** The plan's `mergeWorktree` was a bare `git merge --no-edit`. Shipped (`worktree.ts:76-99`) returns a `MergeResult` discriminated union, aborts on conflict, and surfaces conflict file names via `listUnmergedPaths`; `cli.ts:10` carries a `MergeConflictError`. `worktree.ts` also grew `rebaseOnto`, `mergeFastForward`, `resetWorktree`/`resetWorktreeTo`, `worktreeIsDirty`, `detectGitRoot`, and `cleanWorkerWorktrees` (stale-worker sweep) — all concurrency/resilience hardening for the worker pool.
- **`agent-runner.ts` grew well beyond the plan.** Alongside the shell-call/file-exchange/retry core, it carries per-agent usage accounting (`AgentUsage`/`AgentRunResult`/`AgentRunError` at `agent-runner.ts:32-52`, accumulated from `step_finish` tokens+cost), wall-time measurement, misplaced-scratch-file detection (`agentWritePath`/`findMisplacedScratches` at `196-216` that relocates output written to `<cwd>/.review-loop/<basename>`), and the `--format json` streaming/live-progress wiring (ADR-0289). The spawn also uses `--auto` rather than the design's `--dangerously-skip-permissions` (same effect). The retry-once-on-invalid core is preserved.
- **The fixer does not commit; the orchestrator does.** The plan/spec's `buildFixPrompt` instructed the fixer to commit with `fix(review-loop): …`. Shipped, `buildFixPrompt` (`prompt-templates.ts:36`) explicitly tells the agent *not* to commit ("Do NOT commit … the orchestrator commits"); `FixerResultSchema` carries a `commitMessage` the agent proposes and the orchestrator applies. `commit-attempt.ts` implements the orchestrator-side commit. Intent (clean, attributable commits) preserved; the actor changed.
- **`config.repoRoot` is optional and auto-detected.** The plan made `repoRoot` required. Shipped (`config.ts:20,49-50`) it is optional and falls back to `detectGitRoot(process.cwd())`, so a config can omit it.
- **`build-checker` live phase + timeout.** `build-checker.ts:69-77` adds `runBuildWithLogging` (a `withLivePhase` build phase from ADR-0289) and `createShellExec` takes a `timeoutMs`; the plan's `BuildCheckDeps` had `cwd`/`command` inline, shipped collapses to `{ exec }` (the `ShellExecFn` closes over cwd/command). Intent (orchestrator runs check, captures exit/stderr) preserved.

The source plan `docs/superpowers/plans/2026-07-15-review-loop-simplification.md` and design `docs/superpowers/specs/2026-07-15-review-loop-simplification-design.md` are archived alongside this ADR to `docs/archive/`.
