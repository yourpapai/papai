## 1. Event vocabulary and kernel fold

- [x] 1.1 Red: `tests/afk-runner/event-schemas.test.ts` asserts the `execution` (`action: 'armed'`) and `task` (`action: 'started' | 'done' | 'failed'`, `id`, optional `detail`) L2 variants parse, old logs without them parse unchanged, and `StageId` accepts `implement`/`verify`/`release`. Then widen `event-schemas.ts`, `STAGE_ORDER`, the gate-mode enums with `release`, and stamp the new variants into the unions. Verify: `bun test tests/afk-runner/event-schemas.test.ts`
- [x] 1.2 Red: `tests/afk-runner/kernel/fold.test.ts` folds `execution armed` into an `executionArmed` residue, `task` events into a `tasks` record (last state wins, `failed` terminal per id), and tolerates the new events as no-ops when unarmed machinery reads them. Implement in `kernel/machine.ts` root handlers. Verify: `bun test tests/afk-runner/kernel/fold.test.ts`
- [x] 1.3 Red: `tests/afk-runner/legacy-fold.test.ts` pins a synthetic armed log replaying through `legacy-fold.ts` with the new event types as strict no-ops and the widened stage ids parse-tolerated. Implement the parse-level tolerance. Verify: `bun test tests/afk-runner/legacy-fold.test.ts`

## 2. Graph states and parity normalization

- [x] 2.1 Red: `tests/afk-runner/graph/pipeline.test.ts` transition-probes the new edges: `implement`/`verify`/`release` self-loops, `implement → verify → release`, `verify → implement`, `release` presenting via `stage_enter(gate)`, `gate.awaiting` mover edges to the three states, `run_abort` mixin coverage, and `allStagesDone` blocked while any execution stage is active. Add the states to `graph/states/pipeline-states.ts` + `graph/pipeline.ts`. Verify: `bun test tests/afk-runner/graph/pipeline.test.ts`
- [x] 2.2 Red: `tests/afk-runner/parity/golden-replay.test.ts` asserts every historical fixture still folds kernel≡legacy with the stage-map comparison normalized to the legacy stage vocabulary (execution entries pending residue). Implement the normalization. Verify: `bun test tests/afk-runner/parity/golden-replay.test.ts`
- [x] 2.3 Red: `tests/afk-runner/kernel/machine.test.ts` asserts unarmed final-gate approval still reaches `completed` with the execution stages forever pending. Verify: `bun test tests/afk-runner/kernel/machine.test.ts`

## 3. Arming, settle ordering, and recovery

- [x] 3.1 Red: `tests/afk-runner/cli.test.ts` asserts `parseStartArgs` accepts `--execute` and rejects unknown near-misses; the `sdd-auto.md` doc pin test names the flag. Implement the flag + doc. Verify: `bun test tests/afk-runner/cli.test.ts`
- [x] 3.2 Red: `tests/afk-runner/run-final.test.ts` asserts an armed start appends exactly one `execution armed` event before intake and an unarmed start appends none. Wire in `run.ts` start. Verify: `bun test tests/afk-runner/run-final.test.ts`
- [x] 3.3 Red: `tests/afk-runner/work/gate-settle-final.test.ts` (extend the suite) asserts armed final approve orders `stage_exit(gate)` → `stage_enter(implement)` → `gate.answered{approve}` and parks nothing (implement active), while unarmed ordering is byte-unchanged. Implement in `work/gate-settle.ts`. Verify: `bun test tests/afk-runner/work/gate-settle-final.test.ts`
- [x] 3.4 Red: `tests/afk-runner/run-recovery.test.ts` heals the reversed window — mover landed, answer missing → resume appends the owed `gate.answered{approve}` — and re-derives armedness from the fold. Implement the recovery row in `run-recovery.ts`/`drive/resume.ts`. Verify: `bun test tests/afk-runner/run-recovery.test.ts`

## 4. Implement work module

- [x] 4.1 Red: `tests/afk-runner/work/implement.test.ts` over a fake-agent fixture: the walk picks the first unchecked item, emits `task started`/`task done`, spawns one implementer per item sequentially, and self-succeeds until all items record done, then successor `verify`. Implement the module + registry entry in `graph/pipeline-work.ts` (tasks.md parsing extracted beside the `gate-digest-extract.ts` counts). Verify: `bun test tests/afk-runner/work/implement.test.ts`
- [x] 4.2 Red: the same suite asserts per-item attempt bounding — a third `started` for one id throws `StageHaltError('exhausted')` — resume skip-forward (two items done → only remaining spawn), and fix-mode re-target (fix context present, all items done → culprit-mapped id re-started; no-path fallback = last-walked id). Verify: `bun test tests/afk-runner/work/implement.test.ts`
- [x] 4.3 Red: `tests/afk-runner/work/slice-commit.test.ts` asserts the runner (not the agent) commits after each verified item with the checked box and the work in one commit (`git-identity.ts` seam reused). Implement the commit seam. Verify: `bun test tests/afk-runner/work/slice-commit.test.ts`

## 5. Write-guard widening for the implementer seam

- [x] 5.1 Red: the guard suite (`tests/afk-runner/work/agent-layer.test.ts`, the guard tests' home, plus the mirrored `tests/afk-runner/write-guard.test.ts` unit rows) asserts the widened guard passes source-tree dirt, fails `openspec/changes/<sibling>/` dirt naming paths and the protection, and every think-half seam keeps the narrow change-folder guard byte-identical; `tests/afk-runner/work/implement.test.ts` pins the seam declaration. The explicit guard mode lives in `write-guard.ts` (extracted from `agent-layer.ts` at the max-lines seam). Verify: `bun test tests/afk-runner/write-guard.test.ts tests/afk-runner/work/agent-layer.test.ts tests/afk-runner/work/implement.test.ts`

## 6. Verify and release work modules

- [x] 6.1 Red: `tests/afk-runner/work/verify.test.ts` with an injected command seam: green → successor `release`; red → successor `implement` with the output log path as fix context; no `stage_failed` for a red suite. Implement `work/verify.ts` (`VERIFY_CHECKS` compiled). The red truth rides the run dir's `verify-<n>.log` (last-line verdict; a completed fix answers by appending past the verdict — the self-answering artifact), and `workForOf`/`createPipelineWorkFor` gained the run dir so the outcome reader finds it. Verify: `bun test tests/afk-runner/work/verify.test.ts`
- [x] 6.2 Red: `tests/afk-runner/work/present-release.test.ts` asserts release presents gate mode `release` at max-version+1 with the execution digest (tasks done/total, verify outcomes, commits, spend), a `### Decisions` block naming approve/veto/abort consequences, extend rejected in the grammar, and the ladder logging `rule none` with no rung settling. Implement `work/present-release.ts` + the ladder arm (`evaluateReleaseGate`); the front-matter copy split to `gate-decisions.ts` at the max-lines seam, mirrored in `gate-decisions.test.ts`. Verify: `bun test tests/afk-runner/work/present-release.test.ts`
- [x] 6.3 Red: `tests/afk-runner/work/gate-settle-release.test.ts` asserts approve → exit-then-answer → `completed` (no armed implement mover); veto → answer, exit, mover `stage_enter(implement)` with the redirect written as the `release-veto.md` fix-context sidecar; abort → `aborted`; extend rejected through the seam. Fix targeting (verify-log culprit mapping + veto fallback + the answer ledger) split to `work/fix-target.ts`; the execution-half modules split to `graph/pipeline-execution.ts` (+ `graph/pipeline-agent.ts` seams). Verify: `bun test tests/afk-runner/work/gate-settle-release.test.ts`

## 7. Operator surface

- [x] 7.1 Red: `tests/afk-runner/memo-parity.test.ts` + `tests/afk-runner/drive/memo.test.ts` assert the optional `tasks` memo projection matches the fold and old memos parse unchanged; `memoStatusOf` unchanged. Implement in `run-state.ts`/`memo-project.ts`. Verify: `bun test tests/afk-runner/memo-parity.test.ts tests/afk-runner/drive/memo.test.ts`
- [x] 7.2 Red: `tests/afk-runner/accounting.test.ts` asserts `runs` rows render `exec:implement 3/7` from the fold; `tests/afk-runner/work/report.test.ts` asserts the report's execution facts block and byte-determinism. Implement both surfaces. Verify: `bun test tests/afk-runner/accounting.test.ts tests/afk-runner/work/report.test.ts`
- [x] 7.3 Red: `tests/afk-runner/resume-event.test.ts` asserts execution stages classify `stage-rebuild, <stage>` and mid-implement resume continues the killed implementer session (ledger `(label, round)` keyed per task). Verify: `bun test tests/afk-runner/resume-event.test.ts`

## 8. Fixtures and conformance drills

- [x] 8.1 Add synthetic-marked execution fixtures (armed-approval, task-walk, red-verify-fix-loop, attempt-bound-exhaustion, release-approval, release-veto, execution-crash-windows) to `tests/afk-runner/fixtures/scenarios/`; extend the golden-replay, memo-parity, `prefix-property.test.ts`, and `resume-equivalence.test.ts` drills over them. Verify: `bun test tests/afk-runner/prefix-property.test.ts tests/afk-runner/resume-equivalence.test.ts`
- [x] 8.2 Red: `tests/afk-runner/analyze.test.ts` folds an execution-run fixture degraded-gracefully (no errors, reduced coverage where metrics lack data). Verify: `bun test tests/afk-runner/analyze.test.ts`
- [x] 8.3 Full gate: `bun run test -- --serial`, `bun run typecheck`, `bun run lint`, `bun run check:full -- --staged` hygiene; update `docs/architecture/afk-runner.md` (mechanism section + ledger row) and `docs/architecture/sdd-pipeline.md`. Verify: `bun run test:status`

## 9. Live drill (de-facto C9) and harvest

- [x] 9.1 Pre-register the drill list in `openspec/changes/execution-half-on-graph/notes.md`: induced — holder kill mid-implement (assert one classified `resume`, no double-open), implementer-child kill driving escalation-approve (assert killed-session continuation live); pre-registered/priced — numeric-ceiling refusal on a priced metered armed run; opportunistic — third-strike concern thrash, `C<n>` cross-artifact finding (task selection aims, not-arisen degrades honestly).
- [x] 9.2 Run the drill: ≥2 armed productive runs through the new states (one priced-metered, one unmetered), settle gates through operator verbs only, harvest logs into the live lane under the per-lane oracle. Verify: `bun test tests/afk-runner/fixtures/live/`
- [x] 9.3 Reflection artifact (`reflection.md`) per the live-proof spec: n-count preamble, evidence per verdict, induced vs opportunistic classification, both-regime coverage note, frictions; re-score the ledger in `docs/architecture/afk-runner.md` with exactly one `next` (or a tie note). Verify: `openspec validate --specs --strict`
