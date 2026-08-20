# Tasks: review-loop-batch-verify

## 1. Reviewer schema — theme issues with spans

- [x] 1.1 Add failing tests in `tests/review-loop/issue-schema.test.ts` and `tests/review-loop/prompt-templates.test.ts` asserting `ReviewerIssueSchema` accepts optional `spans: {file,lineStart,lineEnd,evidence}[]` (≥1), validates each span, and that legacy `{file,lineStart,lineEnd,evidence}` without `spans` still parses as single-span. Verify: `bun test tests/review-loop/issue-schema.test.ts tests/review-loop/prompt-templates.test.ts`
- [x] 1.2 Implement additive `spans` field in `review-loop/src/issue-schema.ts` (Zod) and carry it through ledger/serialization with backward-compat normalization (no `spans` → `[ {file,lineStart,lineEnd,evidence} ]`). Verify: `bun test tests/review-loop/issue-schema.test.ts tests/review-loop/prompt-templates.test.ts; bun run typecheck`
- [x] 1.3 Add failing test for `buildReviewPrompt` in `tests/review-loop/prompt-templates.test.ts` that the prompt contains a coalescence rule: “if same class repeats across files (e.g. un-migrated English literals) emit ONE theme issue with `spans`, not N”. Then implement it in `review-loop/src/prompt-templates.ts`. Verify: `bun test tests/review-loop/prompt-templates.test.ts`
- [x] 1.4 Update `review-loop/src/review-round.ts` reviewer-parse/matcher wiring so a theme issue with `spans` creates/reopens exactly one `LedgerIssueRecord` and predicate tests assert `spans` round-trips through `ledger.json`. Verify: `bun test tests/review-loop/review-round.test.ts tests/review-loop/issue-ledger.test.ts`

## 2. Batch clustering (no extra workers)

- [x] 2.1 Write failing tests in `tests/review-loop/issue-clustering.test.ts` for new `review-loop/src/issue-clustering.ts`: theme issues stay as one batch; flat pending with shared n-gram (“English”+“localized”) in same `kind` cluster together; `defect` vs `cleanup` never co-cluster; kind-first ordering preserved. Verify: `bun test tests/review-loop/issue-clustering.test.ts` (fails)
- [x] 2.2 Implement `clusterRecords` in `review-loop/src/issue-clustering.ts` (rule-based: theme→single; then by `kind` + dir + title/evidence n-gram; bounded theme size, covered in design D2). Verify: `bun test tests/review-loop/issue-clustering.test.ts; bun run typecheck`

## 3. Batched fixer dispatch (deferred build/inspect)

- [x] 3.1 Add failing tests in `tests/review-loop/issue-processor.test.ts` for batched dispatch: `batchVerify:true` clusters pending and calls fixer once per batch (not per issue), with no `build`/`inspect` during batch iteration; `batchVerify:false` preserves today’s per-issue `fixer→build→inspect` path. Verify: `bun test tests/review-loop/issue-processor.test.ts` (fails)
- [x] 3.2 Implement batch dispatch in `review-loop/src/issue-processor.ts` behind `config.batchVerify` flag, threading `IssueProcessorDeps` through `issue-clustering.ts`; introduce `ClusterFixerResult` superset schema in `review-loop/src/issue-schema.ts` and per-issue `recordVerification`/`tally*` split. Verify: `bun test tests/review-loop/issue-processor.test.ts tests/review-loop/issue-processor-attempts.test.ts; bun run typecheck`
- [x] 3.3 Add failing tests in `tests/review-loop/issue-processor-attempts.test.ts` for cluster fixer prompts: `buildAttemptPrompt` equivalent lists all member issues/spans in one prompt; verify per-member `fixed`/`verdict` parsing and `targetFiles` attribution. Then implement in `review-loop/src/issue-processor-attempts.ts`. Verify: `bun test tests/review-loop/issue-processor-attempts.test.ts`

## 4. Single aggregated build per round

- [x] 4.1 Add failing tests in `tests/review-loop/build-checker.test.ts` and `tests/review-loop/loop-controller.test.ts` for `runAggregatedBuild`: after all batches, one `check:full` over `git add -N .; git diff baselineSha`; file→batch attribution via `git diff --name-only` + `spans`; passing batches proceed, failing batch members go `needs_human` with stderr and are not merged. Verify: `bun test tests/review-loop/build-checker.test.ts tests/review-loop/loop-controller.test.ts` (fails)
- [x] 4.2 Implement `runAggregatedBuild` in `review-loop/src/build-checker.ts` and wire it in `review-loop/src/loop-controller.ts` (between batch loop and inspector). Update `RoundCollector`/`metrics` to count one `build` per round, with `phaseMs.build` as the single aggregated duration. Verify: `bun test tests/review-loop/build-checker.test.ts tests/review-loop/loop-controller.test.ts`

## 5. Single aggregated inspector per round

- [x] 5.1 Add failing tests in `tests/review-loop/issue-inspector.test.ts` for aggregated inspector: one `runAgent` over full diff + member list, returns per-id `{id, addresses, reasoning}`; `addresses:false` members go `needs_human` and are not merged; `unavailable` treats all `fixed:true` members as `needs_human`. Verify: `bun test tests/review-loop/issue-inspector.test.ts` (fails)
- [x] 5.2 Implement aggregated `runAggregatedInspector` in `review-loop/src/issue-inspector.ts` (new `AggregatedInspectorResultSchema`) and prompt `buildAggregatedInspectPrompt`; wire it in `loop-controller.ts` after aggregated build; merge only approved batches via `pool.mergeWorkerIntoPrimary` per batch under primary lock, respecting `mergeEachFix`. Verify: `bun test tests/review-loop/issue-inspector.test.ts tests/review-loop/loop-controller.test.ts`

## 6. Budget-aware deferral

- [x] 6.1 Add failing tests in `tests/review-loop/loop-controller.test.ts` and `tests/review-loop/stop-controller.test.ts` for deferral: with `runTimeoutMs` set, remaining time gates `low`/`cleanup` batches first; `critical`/`high` defects are never deferred; deferred entries stay `discovered` with `latestSeenRound` bumped and appear as `deferred` in summary/metrics, re-considered next round. Verify: `bun test tests/review-loop/loop-controller.test.ts tests/review-loop/stop-controller.test.ts` (fails)
- [x] 6.2 Implement `shouldDefer` in `review-loop/src/loop-controller.ts` using remainingMs vs `phaseMs` medians per severity/kind; no new config; surface `deferred` count in `summary.ts` and `metrics.json`. Verify: `bun test tests/review-loop/loop-controller.test.ts tests/review-loop/summary.test.ts`

## 7. Config, docs, and final verification

- [x] 7.1 Add failing tests in `tests/review-loop/config.test.ts` for additive `batchVerify?: boolean` (default `false`) in `ReviewLoopConfigSchema`; legacy configs without the flag parse and default to the old per-issue path. Then implement in `review-loop/src/config.ts` and `config.example.json`. Verify: `bun test tests/review-loop/config.test.ts; bun run typecheck`
- [x] 7.2 Update `review-loop/CLAUDE.md` pipeline diagram and “one build/one inspect per round” contract, and add note to `docs/adr` (follow-up to 0303/0425) describing why verification was deferred to round-level. Verify: `bun run typecheck`
- [x] 7.3 Run full verification: `bun test`, `bun run typecheck`, `bun run lint`, and `bun run review-loop:test` (all green); `openspec validate --strict` passes. Verify: `bun test; bun run typecheck; bun run lint; bun run review-loop:test`
