## 1. Taxonomy face (D1)

- [x] 1.1 Failing tests: `SpawnError` typed at the spawn seam wrapper (transport failures classify as infra); untyped non-spawn errors stay plain. Verify: `bun test tests/afk-runner/agent-seam.test.ts` (fails)
- [x] 1.2 Failing tests: `AgentValidationError extends Error` retype at agent-layer's schema-validation exhaustion (message byte-identical; ported suite stays green); `StageHaltError` carries kind `exhausted | precondition` with existing messages unchanged. Verify: `bun test tests/afk-runner/agent-layer.test.ts tests/afk-runner/work/stage-halt.test.ts` (new tests fail)
- [x] 1.3 Implement the three typed seams. Verify: `bun test tests/afk-runner/agent-seam.test.ts tests/afk-runner/agent-layer.test.ts tests/afk-runner/work/`

## 2. Kernel face (D2)

- [x] 2.1 Failing schema/fold tests: `stage_failed {stage, kind, reason, resumeHint?}` parses; maps to `stage.failed`; root handler increments a per-stage `failures` ledger (non-projected residue); the stage map is untouched; a stage's successful exit clears its ledger entry; legacy-fold tolerates the type. Verify: `bun test tests/afk-runner/kernel/failures.test.ts` (fails)
- [x] 2.2 Implement schema + `toKernelEvent` + `recordFailure`/clear assigns in `machine.ts`. Verify: `bun test tests/afk-runner/kernel/failures.test.ts tests/afk-runner/parity/`

## 3. Edges face (D4/D7)

- [x] 3.1 Add the `escalation-approve-cycle-synthetic` fixture + README/inventory rows — red seed: the mover `stage_enter(<stage>)` from `gate.awaiting` refuses at the boundary. Verify: `bun test tests/afk-runner/fixtures/scenarios/inventory.test.ts tests/afk-runner/parity/golden-replay.test.ts` (fails at the mover)
- [x] 3.2 Failing graph tests: `gate.presented → gate` edges from intake/draft/decompose/atomicity; awaiting `stage.enter` edges to review/atomicity/intake; `run_abort → aborted` from every non-final state (mixin). Verify: `bun test tests/afk-runner/graph/pipeline.test.ts` (fails)
- [x] 3.3 Implement the edges + mixin in `pipeline-states.ts`; graph tests green; full parity unchanged (no historical log contains these events). Verify: `bun test tests/afk-runner/graph/pipeline.test.ts tests/afk-runner/parity/`

## 4. Loop face (D2/D3)

- [ ] 4.1 Failing tests: `runWorkBracket` catches classified failures (StageHaltError/AgentValidationError/SpawnError), appends `stage_failed`, skips the exit append (stage stays active); untyped errors rethrow unchanged. Verify: `bun test tests/afk-runner/drive/loop-failure.test.ts` (fails)
- [ ] 4.2 Failing tests: `escalationOwed(context)` — `failures[stage] ≥ STAGE_FAILURE_BUDGET ∧ no unanswered gate`; `precondition` escalates immediately; consulted by loop and by `parkedReasonOf` symmetrically. Verify: `bun test tests/afk-runner/drive/escalation-owed.test.ts` (fails)
- [ ] 4.3 Implement the catch + budget check; under-budget integration drill (fake agents fail once then succeed — the run completes in one process). Verify: `bun test tests/afk-runner/drive/loop-failure.test.ts tests/afk-runner/integration/live-run.test.ts`

## 5. Escalation face (D4/D5/D6)

- [ ] 5.1 Failing tests: escalation presentation — file-first `gate-<v>.md` (failure ledger + resume hint + budget math + spend), `gate presented {mode:'escalation'}` from the failed stage's position, ladder always-logs (R5 over-ceiling/unknown-cost with extend suppressed; else none), parks gate-pending with the failed stage active. Verify: `bun test tests/afk-runner/work/present-escalation.test.ts` (fails)
- [ ] 5.2 Failing settle tests: approve → mover `stage_enter(failedStage)`, no gate exit owed; extend → ledger cleared + same mover; abort → answered alone → aborted final; veto not offered (parse rejects); steer rows (extend/abort valid, veto invalid); expiry inherits the standard path (no conservative branch, re-arm once, pending). Verify: `bun test tests/afk-runner/work/gate-settle-escalation.test.ts` (fails)
- [ ] 5.3 Implement mode `'escalation'` across the eight fork points (schema/kernel unions, narrowGateMode/SettleInput, owesExit, appendMover, evaluateLadder arm, translateSteer, content assembler, memo unions) — approve/extend/abort golden logs. Verify: `bun test tests/afk-runner/work/present-escalation.test.ts tests/afk-runner/work/gate-settle-escalation.test.ts`

## 6. Operator face (D7)

- [ ] 6.1 Failing tests: `stop` — live owner → calm-stop marker written, parks stopped at next boundary; dead/parked → `run_abort` appended, folds to aborted, memo terminal, session slug releasable; gate-pending points at steer abort. Verify: `bun test tests/afk-runner/cli-stop.test.ts` (fails)
- [ ] 6.2 Implement the CLI verb + marker/event paths. Verify: `bun test tests/afk-runner/cli-stop.test.ts tests/afk-runner/cli.test.ts`

## 7. Memo face (D8)

- [ ] 7.1 Failing tests: escalation park → `running` + `gate {mode:'escalation'}`; abort-at-escalation → status `failed`; every drive exit path writes the memo (no stale `running` after a failure park); memo-parity suite over the originals stays green. Verify: `bun test tests/afk-runner/memo-failed.test.ts` (fails)
- [ ] 7.2 Widen the memo unions and extend `memoFieldsOf` (failure-caused terminal derived from events). Verify: `bun test tests/afk-runner/memo-failed.test.ts tests/afk-runner/memo-parity.test.ts`

## 8. Validation face (D10)

- [ ] 8.1 Failing torn-tail tests (the latent bug): malformed final line tolerated-as-absent with a warn; malformed interior line throws naming the line. Verify: `bun test tests/afk-runner/events-torn-tail.test.ts` (fails)
- [ ] 8.2 Implement the read policy in `events.ts`. Verify: `bun test tests/afk-runner/events-torn-tail.test.ts`
- [ ] 8.3 Prefix property: every event-prefix of every fixture/scenario folds without throwing to a legal state with a parked/drivable verdict. Verify: `bun test tests/afk-runner/prefix-property.test.ts`
- [ ] 8.4 Resume-equivalence drill: deterministic fake-agent run completed, then resumed from every prefix reaches the same terminal state + memo. Verify: `bun test tests/afk-runner/resume-equivalence.test.ts`
- [ ] 8.5 W5–W7 recovery drills: owed escalation presentation (files-present at file-scan version; files-absent fresh render); owed escalation mover targets the still-active stage. Verify: `bun test tests/afk-runner/drive/resume-escalation.test.ts`

## 9. Corpus face (D11)

- [ ] 9.1 Add `escalation-extend-cycle-synthetic`, `escalation-abort-synthetic`, `precondition-escalation-synthetic`, `under-budget-retry-synthetic` + README/inventory rows; parity identical per event incl. the historical fixtures. Verify: `bun test tests/afk-runner/fixtures/scenarios/ tests/afk-runner/parity/`

## 10. Full verification

- [ ] 10.1 Run full `bun test`, `bun run typecheck`, `bun run lint`, `bun run knip`; update `docs/architecture/afk-runner.md` (C6 delivered row, layout additions, taxonomy vocabulary) and `docs/architecture/sdd-pipeline.md` cross-reference if stale. Verify: `bun check:full`
