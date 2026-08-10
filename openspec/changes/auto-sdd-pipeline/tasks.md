## 1. Workspace scaffold and harness registration

- [ ] 1.1 Create `sdd-runner/` Bun workspace (package.json, tsconfig mirroring `mutation-improve/`), register in root `package.json` workspaces + `sdd-runner:test/typecheck/lint/format:check/start` scripts. Verification: `bun run sdd-runner:typecheck` passes on the empty scaffold
- [ ] 1.2 Extend TDD mapping for the new workspace: `.hooks/tdd/test-resolver.mjs` and `scripts/mutation/coverage-map.ts` (`sdd-runner/src/**` → `tests/sdd-runner/**`), test-first: failing resolver tests in `tests/sdd-runner/` and `tests/mutation-improve/` (coverage-map cases) before the mapping edits. Verification: `bun test tests/sdd-runner tests/mutation-improve` and `bun run typecheck`

## 2. Schema fork and CLI-tolerance probes (design D1)

- [ ] 2.1 Run `openspec schema fork spec-driven auto-sdd`; add `assumptions` (requires `[proposal]`) and `review` (requires `[specs, design]`) with templates; scaffold a throwaway probe change and confirm all six artifacts in `openspec status --json`; delete the probe. Verification: `openspec schema validate auto-sdd`
- [ ] 2.2 Probe `rules.assumptions`/`rules.review` support in `openspec/config.yaml` for custom artifact ids; probe custom `depth:` key tolerance in change `.openspec.yaml`. Record outcomes + fallback choice (schema instructions / run-state header) in tasks.md. Verification: `openspec validate <probe> --strict` result recorded

## 3. Event model and run state (test-first throughout)

- [ ] 3.1 Failing tests for the three-altitude event schemas (L0/L1/L2 per design D10) in `tests/sdd-runner/events.test.ts`; implement zod schemas + append/replay for `events.ndjson` in `sdd-runner/src/events.ts`. Verification: `bun test tests/sdd-runner/events.test.ts`
- [ ] 3.2 Failing tests for `state.json` (stage machine position, depth, round, gate-pending) + resume reconstruction (openspec status + state + event replay) in `tests/sdd-runner/run-state.test.ts`; implement `sdd-runner/src/run-state.ts`. Verification: `bun test tests/sdd-runner/run-state.test.ts`

## 4. OpenSpec driver and agent layer

- [ ] 4.1 Failing tests then implement `sdd-runner/src/openspec-driver.ts`: shell wrappers for `new change`, `status --json`, `instructions --json`, `validate --strict` with typed outputs. Verification: `bun test tests/sdd-runner/openspec-driver.test.ts`
- [ ] 4.2 Failing tests then implement `sdd-runner/src/agent-layer.ts`: adapter over `review-loop/src/agent-runner.ts`/`spawn.ts` (per design D14) adding per-stage retry (≤2, validator error appended), timeout kill, and sidecar output schemas (`findings`, `resolutions`, assumptions, depth classification). Verification: `bun test tests/sdd-runner/agent-layer.test.ts`

## 5. Stage machine and stages

- [ ] 5.1 Failing tests then implement `sdd-runner/src/stage-machine.ts`: ordered stages, transitions, halt/resume, event emission per transition. Verification: `bun test tests/sdd-runner/stage-machine.test.ts`
- [ ] 5.2 Intake stage (design D16): deterministic signal→profile mapping function (pure code, unit-tested), read-only scope-estimator agent invoked only when `--depth` is absent, naive keyword pre-screen with two-level disagreement surfacing, `depth classified` event with rationale, change scaffolding via the driver. Failing tests first. Verification: `bun test tests/sdd-runner/intake.test.ts`
- [ ] 5.3 Draft stage: drive `openspec instructions` per artifact (D9), spawn drafter agents, validate output artifacts. Failing tests first. Verification: `bun test tests/sdd-runner/draft.test.ts`
- [ ] 5.4 Review loop: reviewer spawn with D4-isolated prompt construction (allow/deny content lists), resolver pass, dismissal ledger, D2 convergence predicate over findings JSON, round caps, cap-hit halt, L-profile concurrent lenses. Failing tests first. Verification: `bun test tests/sdd-runner/review-loop.test.ts`
- [ ] 5.5 Decompose + atomicity stages: tasks.md generation via instructions, atomicity checker (split/merge), skipped in S. Failing tests first. Verification: `bun test tests/sdd-runner/decompose.test.ts`
- [ ] 5.6 Gate stage (design D12): versioned `gate-<n>.md` digest writer with checkbox protocol (unchecked = veto, `→` line = redirect/answer), schema-validated `gate-response.json` parsing with line-naming ambiguity errors, content-hash recording at gate entry, hand-edit detection on resume (re-validate + `human_edits` events), drift-check resolver pass when specs/design changed, veto → one resolver pass → re-gate once, exit-with-resume-command and `--wait` modes. Failing tests first. Verification: `bun test tests/sdd-runner/gate.test.ts`

## 6. Materializers (design D13)

- [ ] 6.1 Failing tests then implement `sdd-runner/src/materialize.ts`: render `review.md` and `assumptions.md` from JSON sidecars in the forked schema's template format, wholesale regenerate-per-round semantics, GENERATED header on every materialized file (design D13). Verification: `bun test tests/sdd-runner/materialize.test.ts` plus `openspec validate <fixture-change> --strict` on a materialized fixture

## 7. Semantic renderer (design D11)

- [ ] 7.1 Failing tests then implement `sdd-runner/src/renderer.ts`: pipeline map block, role+round agent slots (reuse `line-handler`/`live-format`), semantic one-liners, round-close burndown, verbosity profiles, non-TTY line mode, gate screen. Verification: `bun test tests/sdd-runner/renderer.test.ts`

## 8. CLI, wrapper, docs, dogfood

- [ ] 8.1 CLI entry `sdd-runner/src/cli.ts`: `start <task-file> [--depth S|M|L] [--wait] [--verbosity brief|normal|debug]`, `resume <runId>`, `gate resume <runId> [--confirm-all] [--abort]`, `report <runId> [--pr]` (three-source synthesis: events.ndjson + change folder + branch git log, per design D17). Failing tests first. Verification: `bun test tests/sdd-runner/cli.test.ts` and `bun run sdd-runner:start -- --help`
- [ ] 8.2 Thin wrapper commands `.claude/commands/sdd-auto.md` + `.opencode/commands/sdd-auto.md` invoking the runner. Verification: both files exist and reference only `bun run sdd-runner:start`
- [ ] 8.3 Write `docs/architecture/sdd-pipeline.md` (stages, event model, renderer, gate, depth) + index row in `CLAUDE.md`/`AGENTS.md` + Pi Workflow routing row. Verification: `bun run lint`
- [ ] 8.4 Dogfood: run the pipeline end-to-end on one real S-profile change (via `--depth S`, exercising estimator skip); verify convergence fires, reviewer prompts contain no denied content (inspect `events.ndjson` + transcripts), digest fits one screen; exercise the gate protocol (one checkbox veto with `→` redirect, one hand edit to a spec with drift-check pass), then `report --pr`. Record fixes. Verification: dogfood run's `review.md` shows a converged round, `gate-2.md` reflects the veto pass, and `events.ndjson` replays cleanly via `report`
- [ ] 8.5 Final gate: run full `bun test`, `bun run typecheck`, `bun run lint`; confirm `openspec validate auto-sdd-pipeline --strict`; update affected `docs/architecture/` pages. Verification: all three commands green + validate clean
