<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation-Improve Runner — Gate & Finalize Fixes

**Date:** 2026-08-06
**Status:** Design — approved (pending implementation plan)
**Type:** Tooling bugfix round; `mutation-improve/` workspace only; no papai runtime changes

## Summary

A code review of the landed runner (PR #222 lineage, see
`2026-08-05-mutation-improve-runner-design.md`) surfaced eight issues. All were
verified against the code and the original spec; three are outright deviations
from that spec, one is a design flaw the implementation inherited. All eight are
fixed here, bundled as one spec landing as four independent commit units.

| # | Issue | Verdict |
|---|-------|---------|
| 1 | Build gate runs `checkCommand` with cwd = `runDir`, not the iteration worktree (`cli.ts:154-157`); the gate never sees the agent's diff | Deviation — runner spec said "run `bun check:full` **in the worktree**" |
| 2 | Finalize pushes `config.base` then `gh pr create --base <base>` with no head (`finalize.ts:65-69`), but `mergeWorktree` merges into whatever branch `repoRoot` is checked out on | Design flaw inherited from the runner spec (push base + PR against base is contradictory) |
| 3 | Per-iter artifact paths computed in `pipeline.ts:74,100` are dead: `cli.ts:109,130` hardcodes run-level `iter/selection.json` / `iter/result.json`, and `agentWritePath` uses only the basename — `iter/<N>/` dirs stay empty, artifacts are overwritten every iteration | Deviation — runner spec said agent writes `<runDir>/iter/i/…`; spec'd `iter/i/failure.json` was never implemented |
| 4 | `state.json` saved only once in the `cli.ts` finally-block; a crash loses `doneSet`/`merged`/`failed`/`currentIteration`, and `--resume-run` restarts from a stale iteration | Confirmed robustness gap |
| 5 | Skip path (`beforeScore ≥ threshold`) never ratchets the baseline floor; `doneSet` is per-run, so every future run re-selects the file and burns a full Stryker run just to skip it again | Confirmed efficiency gap |
| 6 | `FailedEntrySchema.file` exists but `failIter` never passes it; the PR failure table can't say what was attempted | Confirmed observability gap |
| 7 | Diff-guard parses porcelain lines by fixed slice; rename entries (`R  orig -> new`) are unparsed — `tests/a.ts -> src/b.ts` passes the guard because the line starts with an allowed prefix | Confirmed guard bypass |
| 8 | Two timeout keys: top-level `agentTimeoutMs` actually gates the *mutation-run* exec (`cli.ts:159`), `agent.timeoutMs` gates agents — easy to tune the wrong one | Confirmed config smell |

## Decisions (from brainstorm)

- **Scope: all eight issues** in one spec, landing as four commit units
  (A: gates, B: artifacts+state, C: finalize, D: skip-ratchet+config). Each unit
  is independently testable and reviewable; a problem in one does not block the
  others.
- **Finalize flow: current-branch + PR, guarded.** The runner merges iterations
  into the branch `repoRoot` is checked out on; that is now an explicit,
  enforced contract. Finalize pushes *that* branch and opens the PR against
  `base` with an explicit `--head`. Pushing `base` itself is removed.
- **Ratchet + commit on skip.** A skip means the floor was stale; the runner
  bumps `baseline.json` directly in `repoRoot` and commits just that file on the
  integration branch. The commit rides into the summary PR.
- **`agentTimeoutMs` → `mutateTimeoutMs` hard rename**, no alias. The config is
  checked-in dev tooling with a single consumer.

## Non-goals

- No change to review-loop's `agentWritePath` basename contract or any
  review-loop consumer. The artifact fix aligns the copy destination with the
  prompt path inside `mutation-improve` only.
- No change to gate order, threshold/epsilon semantics, prompt contents, or the
  sequential-iteration model.
- No `build-check.log` artifact: build stdout/stderr already lands in the
  failure reason and now in `failure.json`; a separate log duplicates it.
- No changes under `src/`, `client/`, or `plugins/`.

## Unit A — Gate integrity (issues 1, 7)

**Build-gate cwd.** `PipelineDeps.runBuildCheck` becomes
`(worktreePath: string) => Promise<BuildCheckResult>`. `gatePhase` passes the
iteration worktree path (already in scope). `cli.ts` constructs
`createShellExec(worktreePath, config.checkCommand, config.buildTimeoutMs)` per
invocation instead of once against `runState.runDir`. This mirrors the cwd
pattern `measureScore` already uses (`cli.ts:158-161`), so bun's behavior in a
fresh worktree is the same as the working mutation-run path.

**Diff-guard renames.** New `parsePorcelainPaths(line: string): string[]` in
`src/diff-guard.ts`: parses `XY path` and `XY orig -> new` (R/C statuses),
stripping surrounding quotes per segment. `runDiffGuard` flattens all endpoints
before `classifyDiff`; a rename is a violation if **either** endpoint escapes
`ALLOWED_PREFIXES`. This flags `tests/… -> src/…` (smuggle) and `src/… -> tests/…`
(source removal) while allowing `tests/… -> tests/…`.

**Tests:** `pipeline.test.ts` asserts `runBuildCheck` is called with the
worktree path; `diff-guard.test.ts` gains rename cases (both directions,
quoted segments, plain paths unchanged).

## Unit B — Artifacts & state (issues 3, 4, 6)

**Per-iter artifacts.** Dep signatures gain the output path:
`runSelectAgent(worktreePath, prompt, outputPath)` and
`runImproveAgent(worktreePath, prompt, outputPath)`. `pipeline.ts` passes its
existing per-iter `selectOut`/`improveOut`; the `cli.ts` closures forward that
path to `runAgent({ outputPath })` in place of the hardcoded run-level paths.
`runAttempt` already `mkdir`s the destination dirname, so `<runDir>/iter/<N>/`
is populated with no extra fs work. The prompt path and the copy destination are
the same string again (both derive from `iterDir(runDir, iter)`), so the
basename-only `agentWritePath` behavior stays correct.

**`failure.json`.** `failIter` writes `<runDir>/iter/<N>/failure.json`
(`{iter, gate, reason, file?}`) via `node:fs/promises` — the same direct-fs
pattern as the existing `mkdir(iterPath)` in `runIteration`. Restores the
runner-spec artifact.

**Save per iteration.** `PipelineDeps` gains
`saveRunState(state: MutationImproveRunState): Promise<void>`; `runFrom` calls
it after each `runIteration` completes (after `results.push`, before recursing).
`cli.ts` wires the real `saveRunState`; the finally-block save stays as a final
flush. Resume semantics: a crash mid-iteration loses only that iteration (its
worktree is swept by `--reset-worktree`); a crash after merge but before save
self-heals — resume re-selects the file, measures ≥ threshold, skips, and
Unit D's ratchet records the floor.

**File in failed entries.** `failIter` takes `file?: string`; `runIteration`
captures `selection.file` once the selection parses and threads it into both
the `state.json` failed entry and `failure.json`. Select-gate rejections carry
the (invalidly picked) file; pre-selection exceptions carry none.

**Tests:** integration/pipeline tests updated for the new dep signatures;
pipeline tests assert per-iter `outputPath` forwarding, `failure.json` content,
`saveRunState` called once per completed iteration with the latest state, and
`file` present in failed entries where a selection existed.

## Unit C — Finalize flow (issue 2)

**Startup guard.** New `assertIntegrationBranch(execGit, repoRoot, base)` in
`src/finalize.ts`, called from `runCli` immediately after config load — before
`createRunState` makes any run directories. Fails fast when
`git rev-parse --abbrev-ref HEAD` returns `config.base` (would merge+push
straight onto base) or `HEAD` (detached), with a message to check out an
integration branch first.

**Push/PR refs.** `runFinalize` resolves the current branch via `execGit`, then:
`git push <upstream> <branch>` (replacing `push <upstream> <base>`), and
`gh pr create --base <base> --head <branch> --title … --body <table>`.
Failure handling unchanged: write `finalize.log` with a ready-to-paste command,
return `{ pushed: true }`. `--no-pr` unchanged: merges stay local, no push.

**Tests:** `cli.test.ts` — guard aborts before run-state creation when on base
or detached; `finalize.test.ts` — push targets the resolved branch, PR carries
`--head`; existing `gh`-failure fallback tests keep passing.

## Unit D — Skip-ratchet & config (issues 5, 8)

**Skip-ratchet.** In `runIteration`'s skip path, after `beforeScore ≥ threshold`:
compute `bumped = bumpScore(baseline, file, beforeScore)`; if
`bumped[file] !== baseline[file]`, then in `repoRoot` (not the about-to-be-
removed worktree): `writeBaseline(repoRoot, bumped)`,
`git add scripts/mutation/baseline.json`,
`git commit -m "chore(mutation): ratchet <file> baseline to <score> (verified at threshold)"`.
Staging exactly one path keeps this safe against a dirty working tree. If the
floor doesn't move, no commit. The `doneSet.push` and worktree removal are
unchanged. Ordering: measure in the worktree first (correct tree), remove
worktree, then write+commit in `repoRoot`.

**Config rename.** `agentTimeoutMs` → `mutateTimeoutMs` in
`MutationImproveConfigSchema` (`src/config.ts`), `config.json`,
`config.example.json`, and the `measureScore` wiring in `cli.ts`. Final triple:
`mutateTimeoutMs` (Stryker runs), `buildTimeoutMs` (check command),
`agent.timeoutMs` (agent subprocesses).

**Tests:** pipeline test — skip with a stale floor writes+commits the bump in
`repoRoot` (assert `writeBaseline` target and the two `execGit` calls), skip
with an accurate floor commits nothing; `config.test.ts` — schema accepts
`mutateTimeoutMs`. The old key is not aliased: Zod's default unknown-key
stripping silently drops it, and both checked-in configs are updated in the
same commit, so the old key never survives in-repo.

## Docs to update (Unit D tail)

`mutation-improve/AGENTS.md` documents the old model and must be re-synced:
"merges … into `base`" → merges into the checked-out integration branch
(enforced at startup); the timeout sentence gains `mutateTimeoutMs`; the
artifacts list already matches the Unit-B reality once implemented.

## Testing & verification (all units)

TDD per repo hooks (`mutation-improve/src/**` ↔ `tests/mutation-improve/**`):
failing tests first per unit, then implementation. Each unit ends green on
`bun run mutation-improve:test`, `:typecheck`, `:lint`, `:format:check` (run
from the repo root). Units land as separate commits on the current branch.
