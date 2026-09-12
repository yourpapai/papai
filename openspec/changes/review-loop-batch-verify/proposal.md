# Proposal: review-loop-batch-verify

## Why

review-loop spends a full `fixer (8–59 min) → build (2–3 min) → inspector (1 min) → rebase/FF` cycle per issue, sequentially (`poolSize=1` on CI). Two recent runs fixed 11 `low` i18n leftovers (63% of findings, 0% `high`/`critical`) in ~128 min of fix-phase wall-clock; one `low` alone took `59m10s · 118 tools`. The bottleneck is per-issue verification, not parallelism — increasing `poolSize` is not viable on CI runners.

## What Changes

- **Reviewer coalescence**: reviewer prompt emits theme issues with `fileSpans: {file, lineStart, lineEnd}[]` + `evidence[]` per span, instead of N flat issues for the same class (e.g. “un-migrated English literals”). One theme replaces 4–5 single-file findings. Schema change is additive.
- **Batched fix + deferred verification**: pending issues are clustered (by file/theme) into batches; each batch is fixed by one `opencode run` fixer (still `poolSize=1` sequential). No per-issue `build` or `inspect`. At the end of the round all batch diffs are verified together: **one `build` (`bun check:full`) over the aggregated worktree diff, one `inspector` run over the aggregated diff with per-issue `addresses[]`**. Failures attribute back to the originating issue(s) and split for retry/next round.
- **Budget-aware deferral**: when `runTimeoutMs`/remaining wall-clock is insufficient for the estimated batch, remaining `low`/`cleanup` batches are marked `deferred` (stay `discovered` in ledger, `latestSeenRound` bumped) and never started; `defect`/`medium+` still start. `stopped` tail becomes cleanups, not defects.

## Capabilities

### New Capabilities
- `review-loop-batch-verify`: reviewer theme grouping + batch fixer dispatch + single build/inspect per round with attribution + deferral on budget. Without it every `low` still pays a full build+inspect and sequential fixers repeat the same file-context reads N times; the 5-issue “English literal” round stays at ~128 min instead of ~30 min.

### Modified Capabilities
- None — `openspec/specs/` is empty; sdd-runner/review-loop behavior is documented in `review-loop/CLAUDE.md` and `docs/adr/0303-*`, `0425`.

## Non-goals

- **Per-severity fixer budgets/timeouts** — declined; the 59m tail is solved by batching and coalescence, not by capping `low` in place (would hide under-reported fixes as `needs_human`).
- **Per-issue subset builds** (`tsc --noEmit` per file) — redundant once verification is deferred to one aggregated `check:full`; whole-repo gate still runs at `finalizeRun`.
- **Increasing `poolSize`** — declined; CI runners are 2–4 vCPU / 7–8 GB, three concurrent `opencode` streams + three `check:full` contends and OOMs; the win here is less work, not more workers.
- **Review-loop CLI/config breaking changes** beyond additive `batching` flag.
- **Inspector per-issue call** — replaced by one round-level inspector; per-issue inspector is the cost being removed.
- **Prose doc generation** — stays prohibited (`NO_PROSE_RULE`).

## Impact

- `review-loop/src/`: `prompt-templates.ts` (review prompt + schema), `issue-schema.ts` (`fileSpans`/`evidence` array), `review-round.ts` (reviewer parse + matcher input), `loop-controller.ts` (round orchestration, deferral), `issue-processor.ts` / `issue-processor-attempts.ts` (batch dispatch, deferred build/inspect), `issue-inspector.ts` (aggregated diff + per-issue `addresses`), `build-checker.ts` (aggregated build), `config.ts` (batch flag/budget), `summary.ts`/`trace-log.ts`/`metrics` (batched counts, single build/inspect timing). `docs/architecture` + `review-loop/CLAUDE.md` updated.
- No papai runtime impact (local dev tooling); no DB/platform-instance scope changes.
