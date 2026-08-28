## 1. Verdict computation and sidecar recording

- [x] 1.1 Red-first `tests/sdd-runner/intake.test.ts` with corpus-shaped sidecars: `new-subsystem` + cross-module + ≥30 files → `oversize: true` (kb-shaped fixture routes); 19-file claude-cli-shaped fixture stays false; any missing signal stays false — `bun test tests/sdd-runner/intake.test.ts`
- [x] 1.2 Red-first schema: `DepthClassificationSchema` gains optional `oversize_signals` (`{ novelty, cross_module, implicatedFiles }`); old sidecars parse unchanged — `bun test tests/sdd-runner/agent-layer.test.ts`
- [x] 1.3 Implement `OVERSIZE_MIN_IMPLICATED_FILES = 30` in `config.ts` and deterministic verdict computation in `intake.ts` (runner computes; agent-emitted `oversize` is overridden by the computed verdict); write `oversize_signals` into the depth sidecar — `bun test tests/sdd-runner/intake.test.ts tests/sdd-runner/agent-layer.test.ts`

## 2. Prompt re-grounding

- [x] 2.1 Red-first prompt pin: `buildEstimatorPrompt` no longer instructs self-declaration; it asks for the raw signals and stays read-only — `bun test tests/sdd-runner/intake.test.ts`
- [x] 2.2 Rewrite the prompt's oversize lines in `intake.ts`; estimator reports observations only — `bun test tests/sdd-runner/intake.test.ts`

## 3. Evented routing

- [x] 3.1 Red-first `tests/sdd-runner/events.test.ts`: `depth` event gains optional `oversize`, `oversizeSignals`, `routeForced` fields; pre-change depth events parse unchanged; replay reconstructs routing decisions from the log alone — `bun test tests/sdd-runner/events.test.ts tests/sdd-runner/replay.test.ts`
- [x] 3.2 Implement the additive event fields and their replay fold — `bun test tests/sdd-runner/events.test.ts tests/sdd-runner/replay.test.ts`

## 4. Operator override

- [x] 4.1 Red-first `tests/sdd-runner/cli-routing.test.ts`: `--plan` forces the plan branch (`routeForced: 'plan'`), `--depth` keeps skip-planning, `--plan` + `--depth` together fails loudly naming the conflict — `bun test tests/sdd-runner/cli-routing.test.ts`
- [x] 4.2 Implement the flag in `cli-routing.ts`/`index.ts` argument handling and thread it to `runIntake`'s route union (no scaffold on forced plan, exactly as estimator-decided oversize does today) — `bun test tests/sdd-runner/cli-routing.test.ts tests/sdd-runner/intake.test.ts`

## 5. Verification and docs

- [x] 5.1 One full `bun run test`, `bun run typecheck`, `bun run lint` — all green
- [x] 5.2 Update `docs/architecture/sdd-pipeline.md` (Intake stage, Depth profiles, Composite runs opening) in the same commit as the final code; cross-reference the unarchived `sdd-runner-decomposition` trilogy as owner of plan-branch semantics
