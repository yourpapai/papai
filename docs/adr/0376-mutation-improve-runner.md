<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0376: Mutation-Improve Runner — Autonomous Single-Agent Mutation-Score Pipeline with Runner-Owned Measurement

## Status

Accepted

## Date

2026-08-05

## Context

By mid-2026 the repo's mutation coverage was lifted through a proven manual 7-branch procedure: pick one low-score file, spec it, plan it, write killing tests, verify with Stryker, ratchet `scripts/mutation/baseline.json`, merge. The per-file mutation PR gate (ADR-0342) enforced recorded baselines, but raising them still required a human to drive each branch end-to-end. Each iteration is mechanical except for two judgment calls — which file to improve next, and which tests kill the surviving mutants — while every other step (score measurement, baseline ratchet, merge, PR) is deterministic and integrity-sensitive.

`review-loop/` already supplied proven harness primitives (`agent-runner`, `spawn`, `build-checker`, `worktree`, `live-renderer`, `trace-log`), and `scripts/mutation/` already owned the score math (`score-merger.ts`, `json-readers.ts`) and the per-file paired runner (`bun test:mutate:file`). The design spec (`docs/superpowers/specs/2026-08-05-mutation-improve-runner-design.md`) and implementation plan (`docs/superpowers/plans/2026-08-05-mutation-improve-runner.md`) describe building a new autonomous runner on top of exactly those primitives, with no new mutation infrastructure.

## Decision Drivers

- **Fully autonomous operation.** An operator kicks off `bun run mutation-improve:start -- --count 3` and gets one summary PR; no per-iteration supervision.
- **Runner measures, agent creates.** The runner never trusts an agent-reported score: it runs `bun test:mutate:file` itself, reads the Stryker report, and owns the `baseline.json` ratchet. The agent owns only judgment (file selection) and creation (specs, plans, tests).
- **Reuse, don't duplicate.** Harness primitives come from `../review-loop/src/*.js`; score math from `../../scripts/mutation/*.js`. The only shared-file change is parametrizing review-loop's worktree branch prefix (backward-compatible, default keeps `'review-loop'`).
- **Agent containment by construction.** A diff-scope guard rejects any iteration where the worktree diff touches anything outside `tests/**` and `docs/superpowers/**` — `src/`, `client/`, `plugins/`, `scripts/`, and `baseline.json` are violations, so the agent can never self-ratchet its own floor or modify production code.
- **Selection is judgment, not heuristics.** Encoding ROI file-selection rules (reject declarative tables, `Math.random` jitter, passthrough wrappers, schemas already at ~1.0) in TypeScript is fragile; the select-phase agent applies the same judgment the human branches did, grounded in `baseline.json`.
- **Sequential merge, one PR.** Each iteration merges into `base` in sequence so iteration `i+1` sees iteration `i`'s baseline bump; a single summary PR avoids per-iteration PR conflicts.

## Considered Options

### Option 1 — New `mutation-improve/` sibling workspace, two phased agent invocations per file (chosen)

Approach A from the design spec: one agent/model per file, invoked twice — a select phase that picks the file and an improve phase that runs the spec → plan → tests procedure. The runner owns the state machine (select → measure-before → improve → diff-guard → build → measure-after → ratchet → merge → PR) and all gates; a merge conflict aborts the run with a resumable state file. Delivered as a new Bun workspace mirroring `review-loop/`'s layout with its own TDD gate mapped to `tests/mutation-improve/`.

- **Pros:** clean separation from both papai runtime code and review-loop; reuses battle-tested harness and score code instead of reimplementing them; judgment is delegated, measurement is not; test-only containment is enforced mechanically (diff guard), not by prompt discipline alone; runs unattended and resumable.
- **Cons:** a whole new workspace and test suite to maintain; two LLM invocations per file add cost/latency vs. one; sequential (no worker pool) — wall-clock grows linearly with `--count`.

### Option 2 — Extend `review-loop/` in place (rejected)

Add a mutation-improvement mode to the existing review-loop pipeline.

- **Pros:** no new workspace; direct access to all harness internals.
- **Cons:** review-loop's loop is issue-driven (`loop-controller`, `issue-ledger`, `issue-matcher`, `issue-processor*`, `issue-inspector`, `commit-attempt`, `summary-burndown`) — a different domain the spec explicitly excludes from reuse; bolting a file-score pipeline onto it couples two unrelated lifecycles and risks regression in the proven review path.

### Option 3 — Encode selection heuristics in TypeScript (rejected)

Skip the select-phase agent and rank candidate files with static rules (lowest baseline score, AST-based purity checks, companion-test detection).

- **Pros:** one LLM call saved per iteration; fully deterministic selection.
- **Cons:** the human branches' selection judgment (reject declarative tables where >80% of lines are data, non-deterministic jitter caps, passthrough wrappers, tests that need a full chat/LLM runtime) is contextual and drifts as the codebase changes; static heuristics rot and produce low-ROI picks that burn improve-phase budget.

### Option 4 — Parallel iterations with a worker pool (rejected)

Reuse review-loop's `worker-pool.ts` to improve several files concurrently.

- **Pros:** higher throughput per run.
- **Cons:** parallel iterations merge into the same `base` and ratchet the same `baseline.json`, reintroducing exactly the conflicts the sequential design avoids; the spec lists a worker pool as an explicit non-goal because mutation-improve has no concurrent issue-fixing workload.

## Decision

Adopt Option 1. `mutation-improve/` is a fully-autonomous single-agent runner that lifts one file's mutation score per iteration via the 7-branch procedure, chaining N iterations into one summary PR:

1. **Sibling workspace.** `mutation-improve/` mirrors `review-loop/`'s layout and imports harness primitives (`runAgent`, `spawn`, `build-checker`, `worktree`, `live-renderer`) plus `scripts/mutation/` score logic (`score-merger.ts`, `json-readers.ts`) via path imports. One shared-file change: `review-loop/src/worktree.ts` is parametrized for the branch prefix (default `'review-loop'`, backward-compatible).
2. **Runner owns measurement and integrity.** The runner runs `bun test:mutate:file` and reads `reports/paired/<safeFileStem>.stryker-report.json` (score formula `score = (killed + timeout) / (killed + survived + noCoverage + timeout)`, reused verbatim); it writes `scripts/mutation/baseline.json` itself (`bumpScore` takes the per-key max so a measured dip never lowers the floor).
3. **Agent owns judgment.** Two JSON contracts (`selection.json`, `result.json`, Zod-validated) carry agent output; prompt templates encode the selection rejection rules and the improve-phase hard constraints (test-only edits, exact-equality assertions, SPDX headers).
4. **Gates.** Each iteration must pass: diff-scope guard (only `tests/**` and `docs/superpowers/**` changed), build green (`bun check:full`), and runner-measured score ≥ threshold (default 0.95, or within epsilon 0.02 with justified residuals). Failures reset and remove the worktree; a merge conflict aborts the run.
5. **Resume + one summary PR.** Run state persists under `<workDir>/runs/<runId>/state.json` (`--resume-run`); after all iterations the runner pushes `base` and opens one `gh pr create` with a per-file before/after table.

## Rationale

The split of concerns is the core of the decision: anything integrity-sensitive (score, baseline, diff scope, merge) is deterministic code owned by the runner, while anything requiring judgment (which file, which tests) is delegated to the agent and then verified by the runner. This makes the runner auditable and the agent expendable — a bad improve phase fails a gate and costs one iteration, not a corrupted baseline. Sibling-workspace separation keeps the new pipeline's TDD gate and lint/format wiring isolated from both papai runtime and review-loop, and reusing `scripts/mutation/` math guarantees the runner measures exactly what the CI gate (ADR-0342) enforces.

## Consequences

### Positive

- Mutation-score improvement runs unattended: one command, N files, one PR with a before/after summary table.
- The agent cannot self-serve: `baseline.json`, production code, and scripts are unreachable to it by construction (diff-scope guard), eliminating the self-seeding trust problem raised in ADR-0342's rejected PR-side seeding option.
- Baselines ratchet monotonically per iteration (`bumpScore` per-key max), and later iterations see earlier bumps — compounding progress within one run.
- review-loop gains a backward-compatible generalization (branch-prefix parametrization) without behavioral change to its callers.
- Resume support (`--resume-run`) makes multi-hour runs crash-tolerant.

### Negative

- New workspace to maintain (`mutation-improve/` + `tests/mutation-improve/`), wired into root `package.json` scripts and the `check:verbose` gate.
- Sequential only — `--count N` costs N × (select + measure + improve + verify) wall-clock; no parallelism.
- Two LLM invocations per file; a wasted improve phase on a bad selection is sunk cost (mitigated by the select-phase rejection rules and runner-up logging, not eliminated).
- The runner is tied to review-loop internals via path imports; breaking changes in `review-loop/src/` will surface as typecheck failures here.

### Risks

- A silent score-measurement bug (wrong report path, stale report) could ratchet an unearned baseline. Mitigation: `measureMutationScore` retries `exec()` once on missing/malformed reports and throws otherwise; the score formula is imported verbatim from the paired runner.
- An agent that edits `src/` or `baseline.json` violates the iteration silently if the diff guard is bypassed. Mitigation: the guard runs on `git diff --name-only HEAD` in the worktree before any ratchet or merge, and violations reset the worktree.
- Merge conflicts on shared docs paths (`docs/superpowers/**`) abort the run. Mitigation: abort records the failure in run state; the operator resumes with `--resume-run`.

## Implementation Notes

- `mutation-improve/src/` modules: `config.ts` (Zod schema + loader), `selection-schema.ts` / `result-schema.ts` (agent contracts), `score-reader.ts` (`safeFileStem`, `measureMutationScore`), `baseline.ts` (`parseBaseline`/`serializeBaseline`/`bumpScore` + IO), `diff-guard.ts` (`ALLOWED_PREFIXES = ['tests/', 'docs/superpowers/']`), `run-state.ts` (persisted run state + `iterDir`), `prompt-templates.ts` (`buildSelectPrompt`/`buildImprovePrompt`), `pipeline.ts` (`runIteration`/`runPipeline` state machine with all gates), `finalize.ts` (`buildSummaryBody`, push + `gh pr create`), `cli.ts` (arg parsing + orchestration, `--count`/`--threshold`/`--base`/`--resume-run`/`--no-pr`).
- `review-loop/src/worktree.ts` — `createWorktree`/`removeWorktree` take `branchPrefix = 'review-loop'`; no other review-loop file changed.
- Root `package.json` — `mutation-improve` workspace + five `mutation-improve:*` scripts; `check:verbose` extended with its lint/typecheck/format/test gates.
- Every module was built TDD-first with all externals injected (no real `opencode`/`git`/Stryker in the suite), mirroring `tests/review-loop/`; `tests/mutation-improve/integration.test.ts` proves the modules compose end-to-end with fakes.

## Implementation Status

Implemented. Verified in codebase on 2026-08-08:

- All planned source modules and tests exist under `mutation-improve/src/` and `tests/mutation-improve/` (plus later additions: `index.ts`, `failure-recorder.ts`, `skip-ratchet.ts` with their tests — see ADR-0375).
- Root `package.json` wires the workspace, the five `mutation-improve:*` scripts, and the `check:verbose` extension.
- `review-loop/src/worktree.ts` is parametrized for `branchPrefix` (default `'review-loop'`) in both `createWorktree` and `removeWorktree`.
- The plan's task checkboxes were never ticked (0/78), but all 13 tasks are present in the code.

## Related Decisions

- ADR-0342: Mutation gate pure regression ratchet — the baseline/`baseline.json` semantics this runner ratchets.
- ADR-0328: Drop the TS7-incompatible typescript-checker — the Stryker infrastructure the runner invokes.
- ADR-0375: Mutation-improve hardening — follow-up hardening of this runner (typed errors, NaN-threshold guard, cross-workspace contract guard).
- ADR-0351: review-loop verdict-first report — the sibling harness this workspace reuses.

## References

- Design spec: `docs/superpowers/specs/2026-08-05-mutation-improve-runner-design.md`
- Implementation plan: `docs/superpowers/plans/2026-08-05-mutation-improve-runner.md`
- Score math: `scripts/mutation/score-merger.ts`, `scripts/mutation/json-readers.ts`
- Harness: `review-loop/src/agent-runner.ts`, `review-loop/src/worktree.ts`
