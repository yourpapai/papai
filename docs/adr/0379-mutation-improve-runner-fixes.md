<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0379: Mutation-Improve Runner Gate & Finalize Fixes — Trust-Boundary Hardening of the Autonomous Pipeline

## Status

Accepted

## Date

2026-08-06

## Context

ADR-0376 delivered the autonomous `mutation-improve/` runner: a pipeline where the runner owns all integrity-sensitive measurement (score, baseline ratchet, diff scope, merge) and the agent owns only judgment and creation. A post-implementation audit (design spec `docs/superpowers/specs/2026-08-06-mutation-improve-runner-fixes-design.md`, plan `docs/superpowers/plans/2026-08-06-mutation-improve-runner-fixes.md`) found eight verified defects that undermined exactly the trust boundary that ADR was built on:

1. **Build gate ran in the wrong directory.** `runBuildCheck` executed `checkCommand` with cwd = `runDir`, so `bun check:full` never saw the agent's worktree diff — the gate certified the pristine repo, not the agent's work.
2. **Finalize pushed the wrong branch and opened a headless PR.** `runFinalize` pushed `base` (while merges actually landed on the checked-out branch) and ran `gh pr create` with no `--head`.
3. **Per-iteration artifacts were dead.** The runner copied agent output to `iter/selection.json` / `iter/result.json`, so `iter/<N>/` dirs stayed empty and artifacts overwrote each other across iterations.
4. **Run state was saved only once.** `state.json` persisted in the CLI finally-block; a crash mid-run lost all progress despite the resume design.
5. **Skips never ratcheted the floor.** A skip means the measured score already clears the threshold while `baseline.json` lags — leaving the floor stale guaranteed future runs re-select the same file and burn a full mutation run rediscovering it.
6. **Failures lacked context.** Failed run-state entries dropped the picked file and never wrote the spec'd `iter/<N>/failure.json`, so the summary PR could not name what was attempted.
7. **Diff-guard rename bypass.** `git status --porcelain` rename lines (`R  orig -> new`) were sliced as one string, so `R  tests/a.ts -> src/b.ts` passed the guard — the core containment mechanism had a hole.
8. **Misleading config key.** Top-level `agentTimeoutMs` actually gates the mutation-run exec, not agent subprocesses (agents use `agent.timeoutMs`) — an operator-facing lie that invites misconfiguration.

## Decision Drivers

- **Gates must certify the agent's work, not the environment.** Any gate that measures anything other than the iteration worktree diff is a false credential and silently breaks the "runner measures, agent creates" contract.
- **Containment must be parse-correct.** The diff guard is the mechanism that makes the agent expendable; a rename bypass lets the agent smuggle changes into `src/` while appearing to touch only `tests/`.
- **Durability per iteration, not per run.** Long autonomous runs are crash-prone by definition; progress and failure context must be durable after every iteration, not in a finally-block.
- **A skip is evidence, not a no-op.** A threshold-verified skip proves the floor is stale; ratcheting it immediately (on the guarded integration branch, baseline-only commit) prevents repeated wasted mutation runs.
- **Finalize must name its branch explicitly.** Pushing and PR-ing the resolved integration branch (and refusing to start on `base`/detached HEAD) removes the contradictory merge-vs-push topology.
- **Honest configuration.** A timeout key must name what it actually times out.

## Considered Options

### Option 1 — Fix all eight issues in place, structured as four commit units (chosen)

Per the approved spec: A) gate integrity (rename parsing, build-gate cwd), B) artifacts + state (per-iter output paths, failure.json + file threading, per-iteration state save), C) finalize flow (integration-branch startup guard, push/PR with explicit `--head`), D) skip-ratchet + config rename. All changes stay inside `mutation-improve/src` + `tests/mutation-improve` + workspace config/docs; review-loop is consumed but never modified. Where the inline implementation would have pushed `pipeline.ts` over the repo's 300-line `max-lines` gate, helpers were extracted into new single-purpose modules (`failure-recorder.ts`, `skip-ratchet.ts`) with direct unit tests — the line limit was treated as a design signal, not gamed.

- **Pros:** restores the trust boundary the runner's value proposition depends on; each fix is independently testable via DI-faked `PipelineDeps`/`FinalizeDeps`; module extraction keeps `pipeline.ts` under the line gate without deleting blank lines or compressing formatting; no review-loop churn.
- **Cons:** nine commits of churn on a young workspace; two new modules to maintain; the config rename is breaking for any operator config still carrying `agentTimeoutMs` (accepted — Zod strips the unknown key, no alias kept).

### Option 2 — Alias `agentTimeoutMs` alongside `mutateTimeoutMs` (rejected)

Keep the old key accepted as a deprecated alias.

- **Pros:** zero operator breakage.
- **Cons:** two keys gating the same exec invites drift and contradicts the "honest configuration" driver; the workspace is pre-adoption, so a hard rename is cheap.

### Option 3 — Batch fixes into one large commit (rejected)

Land all eight fixes as a single commit.

- **Pros:** less ceremony.
- **Cons:** mixes four separable concerns (gate integrity, artifacts/state, finalize, config); a bisect or revert of one fix would drag the others along; violates the repo's per-concern commit discipline.

### Option 4 — Keep `pipeline.ts` inline implementations and raise/disable the line gate (rejected)

Relax `max-lines` for `pipeline.ts` instead of extracting `failure-recorder.ts`/`skip-ratchet.ts`.

- **Pros:** fewer files.
- **Cons:** the repo treats a line-gate failure as a design signal; special-casing one file erodes the gate for everything else, and the extracted modules are independently unit-testable.

## Decision

Adopt Option 1. The eight fixes landed as nine TDD commits (Tasks 1–9 of the plan):

1. **Rename-aware diff guard.** `parsePorcelainPaths` splits R/C porcelain entries into both endpoints (status check prevents mis-splitting quoted paths containing ` -> `); both endpoints are classified, so renames from allowed→forbidden and forbidden→allowed are violations.
2. **Build gate in the worktree.** `PipelineDeps.runBuildCheck` takes `worktreePath`; `gatePhase` passes the iteration worktree so `checkCommand` runs against the agent's diff.
3. **Per-iteration output paths.** `runSelectAgent`/`runImproveAgent` take a third `outputPath` argument; the runner threads `iter/<N>/selection.json` and `iter/<N>/result.json`, so per-iter dirs are real and artifacts no longer overwrite each other.
4. **Single failure sink.** `mutation-improve/src/failure-recorder.ts` exports `recordFailure` — every failed iteration writes `iter/<N>/failure.json` (`{iter, gate, reason, file?}`) and pushes a matching run-state entry; `PhaseFail`/`failIter` carry `file` when known (including the select-gate rejection case).
5. **Crash-safe state.** `PipelineDeps.saveRunState` is called after every iteration (after the abort-status mutation, so an aborted run resumes correctly); the CLI finally-block remains the final flush.
6. **Startup guard.** `assertIntegrationBranch` (in `finalize.ts`) throws when `repoRoot` is checked out on `base` or a detached HEAD, before any run state is created.
7. **Honest finalize.** `runFinalize` resolves the current branch itself, pushes `<upstream> <branch>`, and opens the PR with `--base <base> --head <branch>`; gh failures log a re-runnable command with the explicit `--head`.
8. **Skip ratchet.** `mutation-improve/src/skip-ratchet.ts` exports `ratchetVerifiedSkip`: on a threshold-verified skip it bumps the floor with `bumpScore`, writes `baseline.json` in `repoRoot`, and commits baseline-only (`add scripts/mutation/baseline.json` + `chore(mutation): ratchet …`), so a dirty repoRoot working tree is safe and future runs don't re-select the file.
9. **Config rename.** `agentTimeoutMs` → `mutateTimeoutMs` everywhere (schema, CLI, `config.json`/`config.example.json`, test factories, `CLAUDE.md` doc sync); no alias — Zod strips the unknown old key.

## Rationale

Each fix closes a specific hole in the runner-over-agent trust model established by ADR-0376: gates that certify the wrong thing (1, 2, 6, 7), containment that can be bypassed (1), durability that a crash defeats (4, 5), and silent waste of autonomous-run budget (8). The common shape of the fixes is the same as the original design's: move integrity-sensitive behavior into deterministic, DI-tested runner code and give the agent no path around it. Extracting `failure-recorder.ts`/`skip-ratchet.ts` when the line gate fired keeps that discipline without weakening the repo-wide gate.

## Consequences

### Positive

- The build gate now certifies the agent's actual diff; a green gate means the worktree passes `check:full`, not that the pristine repo does.
- The diff guard is parse-correct for renames/copies; the agent can no longer smuggle changes via `R  tests/… -> src/…`.
- Every iteration leaves durable evidence: `iter/<N>/selection.json`, `result.json`, and on failure `failure.json` with the attempted file — the summary PR can name what failed and why.
- A crashed run resumes from the last completed iteration instead of from scratch.
- Skips self-heal the baseline floor; a stale floor costs one skip, not a recurring stream of wasted mutation runs.
- Finalize is topologically consistent: merges, push, and PR head all name the same integration branch, and starting on `base`/detached HEAD fails fast before any state is created.
- The config surface tells the truth: three timeouts with three distinct names.

### Negative

- The hard rename breaks any operator config still carrying `agentTimeoutMs` (silently ignored via Zod stripping, defaulting to 1_800_000) — acceptable pre-adoption, but it is a silent behavioral change.
- Two new single-purpose modules (`failure-recorder.ts`, `skip-ratchet.ts`) add import indirection in `pipeline.ts` (type-only circularity from `skip-ratchet.ts` → `pipeline.ts`, accepted as harmless).
- The skip ratchet commits directly on the integration branch in `repoRoot`; it is baseline-only and safe with a dirty tree, but operators now see `chore(mutation): ratchet …` commits interleaved with iteration merges.

### Risks

- A future porcelain format change (e.g., `-z` mode) could invalidate `parsePorcelainPaths` assumptions. Mitigation: the status check limits splitting to R/C entries; unit tests pin both quoted and unquoted forms.
- The startup guard compares against `rev-parse --abbrev-ref HEAD`; exotic branch names colliding with `base` values are inherently refused — intended fail-closed behavior.

## Implementation Notes

- New modules: `mutation-improve/src/failure-recorder.ts` (`FailureEntry`, `recordFailure`), `mutation-improve/src/skip-ratchet.ts` (`ratchetVerifiedSkip`); new tests: `tests/mutation-improve/failure-recorder.test.ts`, `tests/mutation-improve/skip-ratchet.test.ts`.
- Signature changes: `PipelineDeps.runBuildCheck(worktreePath)`, `runSelectAgent`/`runImproveAgent(worktreePath, prompt, outputPath)`, new `PipelineDeps.saveRunState`; `failIter`/`PhaseFail` gain optional `file`.
- The integration-test dep factories (`integration.test.ts`, `integration-git.test.ts`) gained `saveRunState: () => Promise.resolve()` stubs; zero-arg fakes remain assignable to the new one-arg `runBuildCheck`.
- All nine commits followed TDD (failing test → implementation → green) and the unit-green bar `bun run mutation-improve:test && :typecheck && :lint && :format:check`; `rg agentTimeoutMs mutation-improve tests/mutation-improve` returns no matches.

## Implementation Status

Implemented. Verified in codebase on 2026-08-08: all nine planned commits are in git history (`d1d460053` … `a9794e468`) with the plan's exact commit messages; all new modules, signature changes, and tests exist as specified. The plan's markdown checkboxes were never ticked (0/45), but two in-body controller-authorized execution amendments and the commit history confirm execution. A later commit (`ec6204b23`) retargeted the diff guard and prompt templates to `openspec/changes` — follow-up work, not a supersession.

## Related Decisions

- ADR-0376: Mutation-improve runner — the pipeline whose trust boundary these fixes harden.
- ADR-0375: Mutation-improve hardening — earlier typed-error/threshold-guard hardening of the same workspace.
- ADR-0342: Mutation gate pure regression ratchet — the `baseline.json` floor semantics the skip-ratchet now maintains during autonomous runs.

## References

- Design spec: `docs/superpowers/specs/2026-08-06-mutation-improve-runner-fixes-design.md`
- Implementation plan: `docs/superpowers/plans/2026-08-06-mutation-improve-runner-fixes.md`
- Fixed code: `mutation-improve/src/diff-guard.ts`, `pipeline.ts`, `cli.ts`, `failure-recorder.ts`, `skip-ratchet.ts`, `finalize.ts`, `config.ts`
