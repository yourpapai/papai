## 1. Kernel face (D4)

- [x] 1.1 Add the `s-final-tail-synthetic` fixture (16 events, S depth, no atomicity bracket, decompose→gate entry) + scenarios README row + inventory entry — red seed: parity diverges at the `stage_enter(gate)`. Verify: `bun test tests/afk-runner/fixtures/scenarios/inventory.test.ts tests/afk-runner/parity/golden-replay.test.ts` (S fixture fails at the enter)
- [x] 1.2 Failing graph tests first: `stage_enter(gate)` from decompose is legal; decompose/atomicity/intake re-entry self-edges are legal (probe-reproduced refusal for intake). Verify: `bun test tests/afk-runner/graph/pipeline.test.ts` (fails)
- [x] 1.3 Add the `decompose → gate` edge and self-loops on decompose/atomicity/intake in `pipeline-states.ts`; graph tests green, full parity unchanged (historical logs never re-enter these states). Verify: `bun test tests/afk-runner/graph/pipeline.test.ts tests/afk-runner/parity/`
- [x] 1.4 Reshape `allStagesDone` to `gate done && no active stages`; guard tests (S completes, early-approve blocked, extend answered-first blocked) + full parity (guard-equivalence proven: zero disagreements on historical answereds). Verify: `bun test tests/afk-runner/kernel/ tests/afk-runner/parity/`
- [x] 1.5 Crash-resume drills at mid-intake and mid-decompose on the real graph (resume re-enters through the self-loop; no append refusal). Verify: `bun test tests/afk-runner/drive/resume.test.ts`

## 2. Fixtures face (D9)

- [x] 2.1 Add `extend-at-final-cycle-synthetic` (29 events) and `abort-at-final-synthetic` (17) + README/inventory rows; both fold identical under legacy and kernel. Verify: `bun test tests/afk-runner/fixtures/scenarios/ tests/afk-runner/parity/`
- [x] 2.2 Add `veto-at-final-cycle-synthetic` (33) and `tail-crash-resume-synthetic` (13-event crash form + 18-event healed form); parity identical including at every event (per-event divergence check). Verify: `bun test tests/afk-runner/parity/golden-replay.test.ts`

## 3. Work face (D1/D2)

- [x] 3.1 Failing tests: decompose work module (decomposer agent writes tasks.md, 2-attempt `validateStrict` retry, halt after two) — copy from `sdd-runner/src/decompose.ts`. Verify: `bun test tests/afk-runner/work/decompose.test.ts` (fails)
- [x] 3.2 Implement the decompose module + registry entry; depth-aware outcome (S presents, M/L enters atomicity). Verify: `bun test tests/afk-runner/work/decompose.test.ts`
- [x] 3.3 Atomicity work module (split/merge report, S never declares it) + registry entry. Verify: `bun test tests/afk-runner/work/atomicity.test.ts`
- [x] 3.4 Presenter helper (file+hashes sidecar first → `stage_enter(gate)` → `presented` at max-version+1 → ladder prelude) shared by atomicity and S-decompose. Verify: `bun test tests/afk-runner/work/present-final.test.ts`
- [x] 3.5 Integration: fake-agent M run drives intake→…→final gate park, and S run skips atomicity and parks at its final gate; exit brackets land from `gate.awaiting`. Verify: `bun test tests/afk-runner/integration/live-run.test.ts`

## 4. Seam face (D3)

- [x] 4.1 Failing settle tests per outcome at final mode (approve: exit→answered→completed; extend: answered→exit→round_open, no completion; veto: answered→exit→enter(draft); abort: answered→aborted; early mode: no exit). Verify: `bun test tests/afk-runner/work/gate-settle-final.test.ts` (fails)
- [x] 4.2 Implement the outcome-ordered branch in the settle seam; extend/veto-at-final full-cycle goldens (tail re-runs, v+1 re-presentation, completed). Verify: `bun test tests/afk-runner/work/gate-settle-final.test.ts`

## 5. Recovery face (D5)

- [x] 5.1 Failing resume tests: W3a (record-less awaiting → owed presentation at the file-scan version + ladder re-run, then parks gate-pending — no waiter loop) and W3b (stale answered early record → owed final presentation, no phantom `round_open`). Verify: `bun test tests/afk-runner/drive/resume-tail.test.ts` (fails)
- [x] 5.2 Implement owed-presentation recovery and map-signal gating on owed movers in `resume.ts`. Verify: `bun test tests/afk-runner/drive/resume-tail.test.ts tests/afk-runner/drive/resume-gate.test.ts`
- [x] 5.3 Presented-without-ladder window: document the accepted risk in `resume.ts` doc comment (no behavior). Verify: `bun run typecheck`

## 6. Finals face (D6)

- [x] 6.1 Failing loop/run tests: final snapshots park `'final'` (not awaiting-tail); memo writes completed/aborted; session id released; resume-of-terminal prints the report pointer and appends nothing; `awaiting-tail` retired from the union and `parkLine`. Verify: `bun test tests/afk-runner/drive/loop.test.ts tests/afk-runner/run-final.test.ts` (fails)
- [x] 6.2 Implement the terminal park reason + memo status mapping + resume early-exit; waiter re-drive exits on final park. Verify: `bun test tests/afk-runner/drive/ tests/afk-runner/run-final.test.ts`

## 7. Memo face (D7)

- [x] 7.1 Copy surviving originals' `state.json` into their fixture dirs (sweep the hoard; at least `2f6e644a`, `tests-consolidation`, `opencode-agent-fix-command`). Verify: `ls tests/afk-runner/fixtures/real/*/state.json`
- [x] 7.2 Failing memo-parity test: derive the memo purely from each fixture's events and match fold-derivable fields (gate-null at terminal, last-entered stage, autoExtendsUsed, deadline residues, plan/children projection, updatedAt tolerance). Verify: `bun test tests/afk-runner/memo-parity.test.ts` (fails)
- [x] 7.3 Extend the memo schema + projection in `run-state.ts`/`run.ts`. Verify: `bun test tests/afk-runner/memo-parity.test.ts tests/afk-runner/run-state.test.ts`

## 8. Report face (D8)

- [x] 8.1 Failing report tests (facts, gains/median-dwell math, commits line, PR-body variant) — port `report.ts` as a work copy. Verify: `bun test tests/afk-runner/work/report.test.ts` (fails)
- [x] 8.2 Implement the port + `report <runId> [--pr]` CLI command; status-of-terminal run prints the pointer. Verify: `bun test tests/afk-runner/work/report.test.ts tests/afk-runner/cli.test.ts`

## 9. Full verification

- [x] 9.1 Run full `bun test`, `bun run typecheck`, `bun run lint`, `bun run knip`; update `docs/architecture/afk-runner.md` (C5 delivered row, layout additions, park vocabulary, C6 pointer) and `docs/architecture/sdd-pipeline.md` cross-reference if stale. Verify: `bun check:full`
