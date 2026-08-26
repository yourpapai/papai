# afk-runner — tasks (C1–C2)

## 1. C1: workspace + substrate copy (read-path foundation)

- [x] 1.1 Scaffold `afk-runner/` workspace mirroring `sdd-runner/` conventions: own `package.json`/`tsconfig.json` (extends root), entry in root `workspaces`, `afk-runner:*` scripts (test/typecheck/lint/format/start); tests live in `tests/afk-runner/` (this repo's convention, not colocated); smoke test importing the workspace barrel green via `bun test tests/afk-runner`
- [x] 1.2 Copy substrate Tier 0 (`event-schemas.ts`, `events.ts` — leaf modules: node stdlib + zod only) into `afk-runner/src/`, porting their tests to `tests/afk-runner/` with expectations unchanged; verify with `bun test tests/afk-runner/events.test.ts tests/afk-runner/event-schemas.test.ts`
- [x] 1.3 Copy substrate Tier 1 (`replay.ts` → `afk-runner/src/legacy-fold.ts`, the parity oracle; its only dep is `events.ts`) with tests ported unchanged in expectations; verify with `bun test tests/afk-runner/legacy-fold.test.ts`
- [x] 1.4 Land the real-run corpus: copy the 10 unique historical runs from worktree `.sdd-runner/runs/` hoards into `tests/afk-runner/fixtures/real/<run-id>/` (dedupe `.stryker-tmp` byte-identical copies) — 4 completed (M×3, L×1), 2 gate-pending live (M final-v1, L final-v8), 1 aborted mid-review, 3 early-abort/pre-intake stubs; add an inventory test asserting every fixture parses and folds under `legacy-fold`; verify with `bun test tests/afk-runner/fixtures/real`
- [x] 1.5 Extract scenario fixtures from the inline event sequences in the 27 crafting `tests/sdd-runner/` test files into `tests/afk-runner/fixtures/scenarios/<name>.ndjson`, only where they cover shapes the real hoard lacks (S-depth path, steer directives, calm-stop/resume, `plan`/`child_spawned`/`child_done` marked synthetic); verify with `bun test tests/afk-runner/fixtures`
- [x] 1.6 Prototype relaxation wiring: jscpd `--ignore` for `tests/afk-runner/fixtures/**` and ported test files (recorded as prototype-scoped, re-tightened at C7 reflection — not U9); verify the Write/Edit TDD hook gates `afk-runner/src/**` (wire the workspace into the hook's path coverage if it does not pick it up automatically); verify with `bun run duplicates` and a deliberate red-green TDD probe

## 2. C2: graph kernel

(unchanged — kernel, interpreter, fold, graph v0, golden-replay harness, minimal CLI; harness fixtures now read from `tests/afk-runner/fixtures/{real,scenarios}/`)

- [ ] 2.1 Write failing kernel tests first: given a fixture graph (states + dot-notation transition events + sync guards) and an event list, `initialTransition` + pure `transition` folds to the expected state values; guards reject invalid transitions deterministically; then add `xstate` and implement `afk-runner/src/kernel/machine.ts` (machine-as-data builder) to pass — `bun test afk-runner/src/kernel/machine.test.ts`
- [ ] 2.2 Failing tests for the closed action vocabulary: transitions may return only `emit`/`schedule` actions; the interpreter executes them against injected (fake) sinks; re-fold of the same events executes zero actions — then implement `kernel/interpreter.ts` — `bun test afk-runner/src/kernel/interpreter.test.ts`
- [ ] 2.3 Failing fold-determinism and tolerance tests (same log folded twice → deep-equal state; unknown event types skipped without error; failed-edge-validation appends nothing) — then implement `kernel/fold.ts` — `bun test afk-runner/src/kernel/fold.test.ts`
- [ ] 2.4 Define the pipeline graph v0 (stage states matching the legacy stage map: intake/draft/review/decompose/atomicity/gate finals; review self-loop placeholder) as per-state data modules with a colocated graph-shape test; guards are sync-only by construction — `bun test afk-runner/src/graph/pipeline.test.ts`
- [ ] 2.5 Golden-replay parity harness: fold every fixture in `tests/afk-runner/fixtures/{real,scenarios}/` through graph v0 and assert the derived stage map equals `legacy-fold` output per fixture; unknown-to-graph events tolerated; parameterize over fixtures — `bun test tests/afk-runner/parity/golden-replay.test.ts`
- [ ] 2.6 Wire a minimal CLI entry (`bun run afk-runner:start -- <runDir>` prints folded state summary) as the manual seam, covered by one integration test using a fixture run dir — `bun test tests/afk-runner/cli.test.ts`

## 3. Verification and docs

- [ ] 3.1 Run full `bun test`, `bun run typecheck`, `bun run lint`, `bun run knip`; fix findings in `afk-runner/` only
- [ ] 3.2 Add `docs/architecture/afk-runner.md` (engine decision A→D, engine loop, grow-not-restore porting strategy, C3–C7 plan pointer, U-ledger pointer) and index it in AGENTS.md docs table; leave `docs/architecture/sdd-pipeline.md` untouched
