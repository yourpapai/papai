# mutation-improve Workspace

## Purpose

`mutation-improve/` is a standalone Bun workspace for the autonomous mutation-coverage improvement runner. Each iteration spawns two `opencode run` agent subprocesses (a SELECT agent that picks the highest-ROI file from `scripts/mutation/baseline.json`, then an IMPROVE agent that writes spec/plan/tests for it), gates the result, ratchets the baseline, and merges per-iteration worktree branches into the checked-out integration branch (the CLI refuses to start on `base` or a detached HEAD); a final step pushes that branch and opens a PR to `base` via `gh`. It is local developer tooling, not a papai runtime dependency.

## Pipeline

`src/pipeline.ts` runs iterations strictly sequentially (each observes the prior iteration's baseline bump and `doneSet`):

1. SELECT — runner reads the baseline; the agent only suggests. Picks outside the baseline, already in `doneSet`, already failed this run, or present in the cross-run capped registry (`<workDir>/capped.json`) are rejected as agent mistakes.
2. CAPTURE BEFORE — runner-measured score; already ≥ `threshold` → iteration is `skipped` and the file joins `doneSet`.
3. IMPROVE — agent writes spec/plan/tests; its declared score is never trusted. Residual declarations must name the Stryker mutant ids they cover (`mutantIds`).
4. GATES, in order: diff-guard (`src/diff-guard.ts`: agent may only touch `tests/` and `openspec/changes/`) → build check (`checkCommand`) → runner-measured after-score via `mutateFileCommand <file>`, read from `reports/paired/<stem>.stryker-report.json` (`src/score-reader.ts`, one retry on missing/corrupt report). Below `threshold` there are three outcomes: the residual escape hatch passes as `improved` when residuals are declared AND the score lands within `epsilon` of the threshold; otherwise the iteration merges as `capped` when the score improved AND the declared residual `mutantIds` exactly equal the runner-measured surviving ids (the file is at its tests-only ceiling — baseline ratchets to the measured score and the file enters the capped registry); otherwise it fails. A failed build check does NOT fail the iteration outright: the failed check output is fed back to the agent (`buildFixAttempts` times, default 2; diff-guard re-runs after each fix) before the iteration is failed at the build gate.
5. RATCHET + MERGE — the baseline bump is committed on the iteration branch inside the worktree, then merged into the integration branch. A merge conflict aborts the whole run (`gate: 'merge'`) so no later iteration chains off a stale base.

Outcomes per iteration: `improved` | `skipped` | `capped` | `failed`. The CLI exits 1 if any iteration failed or the run aborted (`capped` is a merge, not a failure). `runIteration` routes every throw through the same cleanup path so worktrees/branches are not leaked; `--reset-worktree` sweeps stale `<runId>-iterN` worktrees left by a killed process.

## Config & repoRoot

`config.json` (shape in `config.example.json`) loads via `--config` (default: `config.json` next to this package). `repoRoot` is resolved then **snapped to the git toplevel** (`detectGitRoot` in `src/config.ts`), so `"repoRoot": "."` works even though `bun run --filter` sets the cwd to this package dir; non-git roots pass through unchanged. `workDir` resolves against the snapped root. Note `readBaseline` (`src/baseline.ts`) returns `{}` on ENOENT rather than erroring — a wrong root therefore surfaces as select-gate rejections, not a load error. Four timeouts exist: `agent.timeoutMs` (wall clock) and `agent.inactivityTimeoutMs` (no-stdout watchdog; a stall-killed agent is retried once by `runAgent`, unlike a wall-clock timeout) for agent subprocesses, top-level `mutateTimeoutMs` for the mutation-run exec, `buildTimeoutMs` for the build check. The default `checkCommand` is `CI=true bun check:full` — the serial path, because `bun test --parallel` flakes with 15s timeouts under worker contention and would randomly discard completed agent work.

## Storage / Artifacts

- `<workDir>/runs/<runId>/state.json` — persisted run state (Zod-validated on `--resume-run <runId>`); its optional `stats` block carries the run's aggregate usage/diff totals, rehydrated into the live footer on resume.
- `<workDir>/capped.json` — cross-run registry of files merged at their tests-only ceiling; select-gate rejects them. Delete an entry to make a file eligible again (e.g. after a src refactor raised its ceiling).
- `<workDir>/runs/<runId>/agent-output.log` + `iter/<N>/{selection,result}.json` — agent transcripts and structured outputs.
- `iter/<N>/build-output.log` — full combined stdout+stderr of a failed build gate (the recorded reason is tail-bounded).
- `<workDir>/worktrees/<runId>-iter<N>` on branches `mutation-improve/<runId>-iter<N>` (kept on merge conflict, removed otherwise).
- `finalize.log` in the run dir if `gh pr create` fails (includes a re-run command).

## Scripts

Run workspace commands from the repo root:

- `bun run mutation-improve:test`
- `bun run mutation-improve:typecheck`
- `bun run mutation-improve:lint`
- `bun run mutation-improve:format:check`
- `bun run mutation-improve:start -- [--count N] [--threshold 0..1] [--base branch] [--resume-run <runId>] [--reset-worktree] [--no-pr]`

## TDD Hooks

The repo TDD resolver treats `mutation-improve/src/**` as gateable implementation code and maps it to `tests/mutation-improve/**`. New work must follow the same test-first flow used under `src/`.

## Dependencies

- `zod` — config/run-state/agent-output validation (shared with root).
- `review-loop/src/*` — imported by relative path (not a package dependency): agent runner, build checker, live renderer, run-stats/cost/diff-stats, spawn, worktree/git helpers. The optional top-level `pricing` map (same shape as review-loop's) enables estimated-cost display; each iteration's merge numstat diff is recorded via `src/merge-stats.ts`, and `src/summary.ts` prints the end-of-run terminal summary (per-file scores/outcomes/±lines + totals).
- `scripts/mutation/*` — Stryker report reading/merging for runner-side score measurement.
