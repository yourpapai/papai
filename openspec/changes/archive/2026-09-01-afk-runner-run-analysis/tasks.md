# Tasks — afk-runner-run-analysis

Every task is red-first: the failing test lands before the implementation,
green before moving on. Prerequisite: `afk-runner-open-vs-raised` fully landed —
the r2 predicate (§2.4) and trajectory metrics read its `open` count set and
`needs-review` verdict, and §2/§4 touch the same `event-schemas`/`gate-prelude`
test surface.

## 1. Read-only IO seam, run loading, metered memo field

- [x] 1.1 Red-first in `tests/afk-runner/analyze.test.ts`: the injected fs seam type exposes only `readFile`/`readdir`/`stat` (type-level pin — write members absent); the git wrapper rejects any non-`log`/`ls-tree` subcommand by name. Then implement `afk-runner/src/analyze-io.ts` (seam types, `readOnlyGit` over `ExecGitFn`). Verify: `bun test tests/afk-runner/analyze.test.ts`
- [x] 1.2 Red-first: run discovery over one or more workdirs (`<workDir>/runs/*`); tolerant loading — unparsable event lines dropped and counted, missing/corrupt sidecars/memo/gate files load as absent, pre-vocabulary runs load with explicit unknown coverage; change-folder resolution (`openspec/changes/<changeName>` tasks.md checkbox counts, missing folder reports exists:false). Implement in `analyze-io.ts`. Verify: `bun test tests/afk-runner/analyze.test.ts`
- [x] 1.3 Red-first in `tests/afk-runner/run.test.ts` (or the local run-state suite): a park-written memo carries `metered` threaded from the seed like `repoRoot`; a legacy memo without the field parses unchanged; the field-wise memo-parity oracle stays green. Implement `metered: z.boolean().optional()` in `run-state.ts` + `MemoSeed` threading in `memo-project.ts`/`run.ts`. Verify: `bun test tests/afk-runner/memo-parity.test.ts tests/afk-runner/run-state.test.ts`

## 2. Per-run metrics (pure functions over the fold + sidecars)

- [x] 2.1 Red-first: `Metric<T>` known/unknown-with-reason; trajectory reads folded `context.perRound` via `foldEvents(pipelineMachine, …)` (the kernel fold — never `legacy-fold`); retry taxonomy (stall vs validation per role via `spawned` join) plus stage-failure taxonomy (`stage_failed` by stage/kind). Fixtures shaped from `fixtures/scenarios` + `fixtures/live`. Implement in `afk-runner/src/analyze.ts`. Verify: `bun test tests/afk-runner/analyze.test.ts`
- [x] 2.2 Red-first: gate forensics — presented→answered latency, never-answered with age, `autoDecisionsByRule`; settle-origin attribution by emission order (settle-kind `auto_decision` before its `gate answered` → policy, after → waiter, answered with no settle record → human) plus the unconditional waiter fingerprints (`rule:'none' decision:'pending'`, `gate rearmed`). Pin the producers' emission order in the `gate-prelude` and `gate-expiry` suites so the join cannot silently rot. Implement in `afk-runner/src/analyze-gates.ts`. Verify: `bun test tests/afk-runner/analyze.test.ts tests/afk-runner/work/gate-prelude.test.ts tests/afk-runner/work/gate-expiry.test.ts`
- [x] 2.3 Red-first: finding lifecycle over sidecar joins — `duplicateIdRate` (within-round ledger dups), `lensOverlapRate`, `classChurn`, `resolverActionMix`; `concernPersistence` reports unknown with its reason (the `fingerprintOf` import arrives with `afk-runner-loop-memory`). Implement in `afk-runner/src/analyze-findings.ts`. Verify: `bun test tests/afk-runner/analyze.test.ts`
- [x] 2.4 Red-first: `r2Eligibility` + `byCause` over convergence pairs — eligibility reads the `open` count set (absent → raised fallback), trajectory strict-decrease reads raised, `needs-review` never enumerates a gate state; the D5 cause table (`r2-fired` / metered+cost-unknown → `cost-unknown` / else R4 → `over-ceiling` / legacy `preview` / `trajectory-blocked`), metered-ness from the memo, state→gate join by first early presentation after the convergence; memo-less and record-less runs keep the unknown verbatim. Implement in `analyze-findings.ts`. Verify: `bun test tests/afk-runner/analyze.test.ts`
- [x] 2.5 Red-first: consistency audit — fold-vs-memo freshness (recompute `memoFieldsOf`, flag and name diverging fields), answered-without-presented, completed-after-unsuperseded-abort, `.bak` residue, gate files recording a decision with no answered event; the era-contamination flag. Implement in `analyze-gates.ts`. Verify: `bun test tests/afk-runner/analyze.test.ts`

## 3. Ground-truth join

- [x] 3.1 Red-first: per change folder — tasks done/total, folder existence, commit count (`git log`), main-ref presence (`git ls-tree` against main/master candidates) through the read-only git seam; corpus sections `stranded-complete` and `merged-unimplemented` (fixtures shaped from this branch's own queue). Implement `afk-runner/src/analyze-truth.ts`. Verify: `bun test tests/afk-runner/analyze.test.ts`

## 4. Usage fold, corpus report, CLI route

- [x] 4.1 Red-first: `EMPTY_USAGE`/`plusUsage` shared helper homed beside `usageTotalsOf` in `work/gate-signals.ts` (`usageTotalsOf` refactors onto it); analyzer usage fold — per-role (spawned join) and per-round (round_open ts-window), `costKnown` per `usageTotalsOf` semantics, cost rendered as a lower bound with the unpriced count. Implement in `afk-runner/src/analyze-usage.ts`. Verify: `bun test tests/afk-runner/analyze.test.ts tests/afk-runner/accounting.test.ts`
- [x] 4.2 Red-first: corpus assembly — per-run analysis composed from the metrics, aggregates excluding era-contaminated runs, per-cause sums across known runs; plain-text renderer (fixed cause order, no ANSI) and `--json` emitting the same structure. Implement in `afk-runner/src/analyze-corpus.ts` + `analyze-report.ts`. Verify: `bun test tests/afk-runner/analyze.test.ts`
- [x] 4.3 Red-first in `tests/afk-runner/cli.test.ts`: `analyze` routes by workdir paths (default: the configured workdir), `--json` switches output, existing run-id/task-file routing unchanged, a gate-pending corpus run completes without presenting or settling anything, the usage line names the verb. Implement the route in `cli.ts`. Verify: `bun test tests/afk-runner/cli.test.ts`

## 5. Verification, acceptance, docs

- [x] 5.1 Full gates: `bun run test`, `bun run typecheck`, `bun run lint` — all green. Verify: `bun run test:status`
- [x] 5.2 Acceptance run: `bun run afk-runner:start -- analyze` over the committed fixture corpus plus the mirror wave's own runs; record deltas against the hand-measured expectations (cause mix, stranded/merged counts, era flags) in the run report. Verify: `bun run afk-runner:start -- analyze`
- [x] 5.3 Update `docs/architecture/afk-runner.md` with the Analysis section (read-only contract, metric inventory, the metered memo field) in the same commit as the final code. Verify: `bun run lint`
