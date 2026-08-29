## 1. Read-only IO seam and run loading

- [x] 1.1 Red-first `tests/sdd-runner/analyze.test.ts`: the injected fs seam type exposes only `readFile`/`readdir`/`stat` (type-level pin: write members absent); the git wrapper rejects non-`log`/`ls-tree` subcommands — `bun test tests/sdd-runner/analyze.test.ts`
- [x] 1.2 Implement `sdd-runner/src/analyze-io.ts` (seam types, run discovery over one or more workdirs, change-folder resolution); old/missing-artifact runs load with explicit `unknown` coverage instead of failing — `bun test tests/sdd-runner/analyze.test.ts`

## 2. Per-run metrics (pure functions over replay + sidecars)

- [x] 2.1 Red-first trajectory + gate forensics metrics: per-round class counts/verdicts, `gateLatency` (presented→answered, never-answered with age), `extendOrigin`, `retryTaxonomy` — fixtures shaped from `opencode-agent-fix-command` and the trilogy's waiter-settled final gate — `bun test tests/sdd-runner/analyze.test.ts`
- [x] 2.2 Red-first finding-lifecycle metrics: `duplicateIdRate`, `lensOverlapRate`, `classChurn`, `resolverActionMix` over findings/resolutions sidecar joins (fix-command r3 dup fixture) — `bun test tests/sdd-runner/analyze.test.ts`
- [x] 2.3 Red-first `concernPersistence` (imports `fingerprintOf` from the review-model once `sdd-review-loop-memory` lands; reports `unknown` until then) and `r2EligibilityRate` over convergence event pairs — `bun test tests/sdd-runner/analyze.test.ts`
- [x] 2.4 Red-first `decisionConsistency` + `eraContamination`: answered-without-presented flagging, completion-after-unsuperseded-abort flagging, `.bak` residue, gate files without answered events — fixtures shaped from the trilogy run's `gate-1..6.md` × events × `state.json.bak` — `bun test tests/sdd-runner/analyze.test.ts`
- [x] 2.5 Implement the metric functions in `sdd-runner/src/analyze.ts` consuming `replay.ts` folds + sidecar joins (no second fold engine; `usage-aggregate.ts` reprice seam for per-role usage) — `bun test tests/sdd-runner/analyze.test.ts`

## 3. Ground-truth join

- [x] 3.1 Red-first: per change folder — tasks done/total, folder existence, commit count, main-branch presence; corpus report sections `stranded-complete` and `merged-unimplemented` (fancy-ui-shaped and kb-shaped fixtures) — `bun test tests/sdd-runner/analyze.test.ts`
- [x] 3.2 Implement the git/openspec join with the read-only git wrapper — `bun test tests/sdd-runner/analyze.test.ts`

## 4. Corpus report and CLI route

- [x] 4.1 Red-first aggregate: multi-workdir corpus report renders per-run sections + corpus aggregates in plain text; `--json` emits the same structure machine-readably; no ANSI escapes — `bun test tests/sdd-runner/analyze.test.ts`
- [x] 4.2 Red-first `tests/sdd-runner/cli-routing.test.ts`: first argument `analyze` routes to the analysis surface (default workdir from config; extra args are workdir paths); existing run-id/task-file routing unchanged; gate-pending runs untouched — `bun test tests/sdd-runner/cli-routing.test.ts`
- [x] 4.3 Implement the route in `cli-routing.ts`/`index.ts` and the report renderer — `bun test tests/sdd-runner/cli-routing.test.ts tests/sdd-runner/analyze.test.ts`

## 5. Verification, acceptance, docs

- [ ] 5.1 One full `bun run test`, `bun run typecheck`, `bun run lint` — all green
- [ ] 5.2 Acceptance run: `bun run sdd-runner:start -- analyze` plus the sibling workdirs' corpora; compare against the exploration's hand-measured numbers (31 R4 gates, 78 dup entries, 11/26 R2-eligible, 5 stranded, 1 merged-unimplemented, 1 era-contaminated run) — record deltas in the run report
- [ ] 5.3 Update `docs/architecture/sdd-pipeline.md` with the Analysis section (read-only contract, metric inventory) in the same commit as the final code
