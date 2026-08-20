# Design: review-loop-batch-verify

## Context

See `proposal.md — Why`. Current loop (`review-loop/src/loop-controller.ts:129`, `issue-processor.ts:206`, `issue-processor-attempts.ts:47`, `build-checker.ts:70`, `issue-inspector.ts:37`) runs `reviewer → matcher → per-issue (fixer → build → inspector → commit→merge) → recordProgress`. Two sampled CI runs show 63% `low` (0% `high`/`critical`), fixer `8–59 min` per `low`, `build 2–3 min` and `inspect ~1 min` paid N times, `poolSize=1` serial. `ReviewerIssueSchema` (`issue-schema.ts:39`) is flat single-file. `TERMINAL_STATUSES`/`filterActionable` govern admission. `stop-controller.ts` is honored between issues/rounds only. Existing batch-like work is `matchIssues` (dedup) and `orderByExposure` (kind-first `defect→cleanup`).

## Goals / Non-Goals

**Goals:** (1) fewer reviewer findings via theme grouping; (2) fewer `build`/`inspect` invocations — one per round over the aggregated diff; (3) defer `low`/`cleanup` when wall-clock insufficient so a `stopped` run keeps defects. All with `poolSize=1`.

**Non-Goals:** per-severity timeout caps, per-file subset builds, pool size increase, new DB tables, new external deps. Single aggregated build replaces the per-tier build matrix.

## Decisions

### D1 — Superset additive Reviewer schema, prompt coalescence

`ReviewerIssue` gains optional `spans: {file, lineStart, lineEnd, evidence}[]` (at least one) while keeping `file/lineStart/lineEnd/evidence` as the primary span for backward-compat parsers. Prompt adds: “if same class repeats across files (e.g. un-migrated i18n literals), emit ONE theme issue with `spans`, not N”. `capCleanupSeverity` still applies per issue; matcher treats a theme issue as one ledger entry (N spans → one `LedgerIssueRecord`).

*Alternative: new `ReviewerTheme` type* — rejected; breaks `matcher` and ledger shape, requires migration key.

### D2 — Batch dispatch: cluster → sequential fixer runs, no per-batch build/inspect

New `src/issue-clustering.ts`: `clusterRecords(pending: LedgerIssueRecord[]) → Cluster[]`. Rule-based: group by `(kind, severityBucket, primary file dir)` then by title n-gram overlap (“English”+“localized”); theme issues (`spans.length>1`) are already a cluster of one. `processPendingIssues` iterates clusters sequentially (still `poolSize=1`; pool is retained for worktree isolation if configured >1 but not required). Each cluster gets one `runAgent` fixer prompt listing all its member issues/spans.

Per-issue `runBuildAttempt`/`runInspectorAttempt` are removed from the per-cluster path. Fixer is instructed to leave changes uncommitted (as today) but not gated. Failures map to `verdict` per member (fixer returns per-issue `fixed`/`verdict` — see D3).

*Alternative: keep per-batch build/inspect* — rejected per user direction; single round-level verification is strictly cheaper and the fallback (split on failure) is the same.

### D3 — One FixerResult per cluster, split by member

Cluster fixer output becomes `ClusterFixerResult { issues: {id, verdict, fixed, severity, exposure, targetFiles, reasoning}[] }`. Implemented as `FixerResult` superset where `targetFiles` etc. are per member; Zod `ClusterFixerResultSchema = z.object({ results: z.array(FixerResultWithId) })`. If fixer claims mixed outcomes (2 fixed, 1 invalid), ledger records each with `recordVerification`/`tally*` individually. Commit is per-member fix (each member's diff slice) or one combined commit per cluster with subject `fix(review-loop): <theme> (+N)` — decision: one commit per cluster (one `ensureFixerChangesCommitted`).

### D4 — Single aggregated build + single aggregated inspector per round

After all clusters have run (still sequential), new `runAggregatedBuild(workerWorktreePath)` runs `check:full` once over the working tree (`git add -N .; git diff baselineSha` as `issue-inspector.ts:53` does). One `runAggregatedInspector` receives the full diff plus the list of member issues and returns `AggregatedInspectorResult { results: {id, addresses, reasoning}[] }`. Build failure attributes via `git diff --name-only` + changed files vs issue `spans`; inspector failure attributes via its per-id verdict.

On build fail: attribute failing files to owning clusters, mark those members `needs_human` (or `retry` as split singles next round), keep passing clusters' fixes. On inspect `addresses:false` per id: same — that member goes `needs_human` / split retry.

*Alternative: bisect on build fail* — deferred; simple file-attribution covers the i18n case (each low touches one file). Bisect is available as follow-up if cross-file failures appear.

Merges: one `mergeWorkerIntoPrimary` per successful cluster (still under `primaryMutex` `worker-pool.ts:95`), preserving the “never merge a failing fix” invariant. Deferred verification means a cluster that never reached the merge still has its diff discardable via `resetToBaseline` on next retry.

### D5 — Deferral on budget

`StopController.requested()` already gates between issues; new `shouldDefer(record, remainingMs, estimatedMsFor(record))` gates before `acquire`. `remainingMs = runTimeoutMs>0 ? runTimeoutMs - elapsed : Infinity`. `estimatedMsFor` is derived from prior `phaseMs` medians per severity/kind (no new config). `low`/`cleanup` deferred first; `medium` next; `critical`/`high`/`defect with caller exposure` never deferred (started even if tight). Deferred stays `discovered`, `latestSeenRound` bumped for next round visibility; `summary.ts` reports `deferred` count separately.

### D6 — No new pool/worktree, no DB migration

Scope model: no new persisted ids beyond existing `RunState.runId` / `Ledger` snapshot. Ledger JSON remains the durability contract (`saveIssueLedger` at round end). Worktrees unchanged; `poolSize=1` fast-fasts to the old path if config flag off (`batching: false` default until validated). No new dependency — `Zod` schemas + existing `runAgent`/`execGit` cover it.

## Risks / Trade-offs

- **Aggregated build obscures which issue broke the build** → Mitigation: file→issue attribution via `spans` + `git diff --name-only`; ambiguous build errors mark all batched members `needs_human` and split next round; conservative but safe.
- **Inspector over aggregated diff misses per-issue nuance** → Mitigation: prompt includes per-issue `title/summary/evidence` + diff slices; per-id `addresses` forces explicit reasoning; high/medium can still force split verification if `confidence` low (policy, not code).
- **One large batch commit is coarser to revert** → Mitigation: theme batches are small (2–5 files) by clustering; commit message cites all ids; `git log --grep` still bisectable; split retry produces finer commits on failure.
- **Prompt coalescence may under-report** → Mitigation: evidence-per-span required; matcher/ledger keeps theme as one entry so reopen logic still works; next round's reviewer re-emits missed spans as new findings if theme was too coarse.
- **Large single diff stresses inspector context** → Mitigation: theme batches are bounded; aggregated diff is at most N low files (reviewer already caps at ~5–6 per round in logs); cached tokens amortize.

## Migration Plan

1. Additive schema: `ReviewerIssue.spans` optional; old `issues.json` still parses.
2. Feature flag `config.batchVerify?: boolean` (default `false`); `loop-controller.ts` branches: flag off → old per-issue path; flag on → clustered + deferred verify. No config breakage (`ReviewLoopConfigSchema` `.default(false)`).
3. Rollout: enable only on a test branch, compare `newIssues` count and `build`/`inspect` wall-clock from `metrics.json`/`summary.txt`; fallback is `batchVerify:false`.
4. Docs: update `review-loop/CLAUDE.md` (pipeline diagram, inspector-is-once-per-round), `docs/adr` follow-up note.

## Open Questions

- None that block specs/tasks. Max batch size (hard cap 5 vs unbounded theme) can be tuned after first runs; the spec states “bounded theme” without fixing the constant.

