# think-half-on-graph — tasks (C3)

## 1. Face 1: full derived-state parity (fold-side, corpus-proven)

- [x] 1.1 Failing parity tests first: extend the golden-replay harness to compare the full `ReplayState` (depth, round, perRound, lastVerdict, gate, autoDecisions, children) against machine context for every fixture in `tests/afk-runner/fixtures/{real,scenarios}/`, with bisect-to-first-divergent-event on mismatch — `bun test tests/afk-runner/parity`
- [x] 1.2 Grow `KernelEvent` and `toKernelEvent` (`kernel/machine.ts`, `kernel/fold.ts`): map `depth`, `round_open/close`, `finding`, `convergence`, `gate.presented/answered`, `auto_decision`, `plan`, `child_spawned/child_done` to dot-notation kernel events — `bun test tests/afk-runner/kernel/fold.test.ts`
- [x] 1.3 Implement root-level target-less assigns in `graph/pipeline.ts` for every mapped event, including the scratch tally accumulator (`finding` increments, `convergence` flushes to `perRound` and clears the round); parity tests from 1.1 go green; extend the graph-shape tests to pin the root-handler inventory — `bun test tests/afk-runner/parity tests/afk-runner/graph`
- [x] 1.4 Context-vs-oracle drift guard: fold determinism test extended to full context (same log folded twice → deep-equal context including scratch residue semantics identical to legacy's Map) — `bun test tests/afk-runner/kernel/fold.test.ts`

## 2. Drive loop + append boundary

- [x] 2.1 Failing loop tests first with a stub graph and fake work modules: enter/exit bracket around work, successor-or-park rule (enter successor iff it declares work), park reporting values (`awaiting-tail`, `gate-pending`, `stopped`), no stage names in the loop — `bun test tests/afk-runner/drive/loop.test.ts`
- [x] 2.2 Implement `workFor(state)` data accessors (work kind + outcome→successor map) co-located in per-state modules and the generic drive loop (`drive/`) to pass — `bun test tests/afk-runner/drive`
- [x] 2.3 Failing boundary tests first: an illegal `stage.enter` (no edge from current position) appends nothing and throws naming the refused event; legal self-loop re-entry passes (snapshot-reference probe per design D5) — then implement the append boundary (pure `transition()` probe: identical snapshot reference + zero actions ⇒ refused) — `bun test tests/afk-runner/drive/boundary.test.ts`
- [x] 2.4 Crash-resume drill at loop level: log truncated mid-work re-folds to the interrupted state and the loop re-enters via `workFor` without persisted pointers — `bun test tests/afk-runner/drive/resume.test.ts`

## 3. Think-half work re-host (copies, expectations unchanged)

- [x] 3.1 Copy slimmed Tier 2 substrate: session-id allocation, session ledger, run-dir conventions, stop-controller/holder machinery; port their tests with expectations unchanged; extend the jscpd prototype ignore to the copied src modules (re-tighten at C7, recorded in the afk-runner change's task 1.6 lineage) — `bun test tests/afk-runner/run-state tests/afk-runner/session`
- [ ] 3.2 Copy agent-layer (spawn seam, sidecars, usage events) + intake/draft work modules; port tests with fake agents per the `tests/sdd-runner/` pattern; bracket moves to loop mechanics (no `machine.runStage` callers) — `bun test tests/afk-runner/work`
- [ ] 3.3 Copy review-loop + review-model + steer + materialize as the review work module (recursion stays inside; rounds emit domain events; calm-stop and steer seams preserved); port tests unchanged in expectations — `bun test tests/afk-runner/work/review-loop.test.ts`
- [ ] 3.4 `state.json` demoted: write as derived memo after appends; delete-and-behave-identically test (start/status/resume) proving memo-is-not-truth — `bun test tests/afk-runner/drive/memo.test.ts`
- [ ] 3.5 Resume decision re-host: pure function of folded context + session ledger (stage from position, round from context, continuation from ledger); park reporting for converged (`awaiting-tail`) and cap-hit (`gate-pending`) runs as data, not errors — `bun test tests/afk-runner/drive/resume.test.ts`

## 4. Integration surface and verification

- [ ] 4.1 CLI wiring: `afk-runner:start -- <task>` drives a fresh think-half run to park with stubbed agents (integration test); status prints the folded full-state summary; resume re-enters an interrupted think-half run — `bun test tests/afk-runner/cli.test.ts`
- [ ] 4.2 Live-shaped integration: start → intake → draft → review (stubbed agents) → park both flavors (converged, cap-hit with `gate` presented appended); kill-and-resume drill between rounds asserting the corpus-real review self-loop in the log — `bun test tests/afk-runner/integration`
- [ ] 4.3 Full gates: `bun test`, `bun run typecheck`, `bun run lint`, `bun run knip`, `bun run duplicates`; fix findings in `afk-runner/`-scoped code only
- [ ] 4.4 Update `docs/architecture/afk-runner.md`: engine loop live, C3 delivery-plan row checked, D1–D7 decision pointers for C4–C7 inheritance
