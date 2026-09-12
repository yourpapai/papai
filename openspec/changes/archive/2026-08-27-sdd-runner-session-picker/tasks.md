## 1. Session identity (D1)

- [x] 1.1 Failing test: slugification — title → lowercase `[a-z0-9-]` id, separator collapsing, 64-char clamp, unicode stripped (`tests/sdd-runner/session-id.test.ts`). Verify: `bun run test tests/sdd-runner/session-id.test.ts`
- [x] 1.2 Implement `slugifySessionId` in a new `sdd-runner/src/session-id.ts`. Verify: `bun run test tests/sdd-runner/session-id.test.ts`
- [x] 1.3 Failing test: collision policy — creation refuses while a non-terminal run holds the name (error names the holder, no side effects); takes next free `<slug>-2` when only terminal runs hold it. Verify: `bun run test tests/sdd-runner/run-state.test.ts`
- [x] 1.4 Wire slug ids into `createRunState`/`makeRunId` path in `sdd-runner/src/run-state.ts`; legacy datetime dirs untouched. Verify: `bun run test tests/sdd-runner/run-state.test.ts`

## 2. Inline start (D3)

- [x] 2.1 Failing test: `runStart` accepts `{ taskText, changeName }` text source — pipeline consumes identical text; `task.md` persisted into the new run dir before intake; explicit task-file starts unchanged (`tests/sdd-runner/orchestrator-start.test.ts`). Verify: `bun run test tests/sdd-runner/orchestrator-start.test.ts`
- [x] 2.2 Extend `StartOptions`/`runStart` in `sdd-runner/src/orchestrator.ts` with the text-source branch and run-dir persistence. Verify: `bun run test tests/sdd-runner/orchestrator-start.test.ts`
- [x] 2.3 Failing test: no-runs bare invocation routes to the creation entry on a terminal (`tests/sdd-runner/cli-routing.test.ts`). Verify: `bun run test tests/sdd-runner/cli-routing.test.ts`
- [x] 2.4 Interactive title/body prompt front-end for creation (reusing gate-session input patterns); wire into `sdd-runner/src/index.ts`. Verify: `bun run test tests/sdd-runner/tui-session-screen.test.ts && bun run typecheck`

## 3. Session listing projection (D4)

- [x] 3.1 Failing test: `listSessions(workDir)` returns one row per run — change name, status, stage/round vs cap, token/cost totals, last activity, pending decision (`tests/sdd-runner/session-list.test.ts`). Verify: `bun run test tests/sdd-runner/session-list.test.ts`
- [x] 3.2 Implement `sdd-runner/src/session-list.ts`: `readAllRunStates` + tail-only event read + usage aggregates + `PersistedLite` reuse. Verify: `bun run test tests/sdd-runner/session-list.test.ts`

## 4. Session screen front-end (D2)

- [x] 4.1 Failing test: screen renders rows with cursor pointer and progress columns; selection returns the chosen run id (`tests/sdd-runner/tui-session-screen.test.ts`, ink-testing-library pattern from tui-gate tests). Verify: `bun run test tests/sdd-runner/tui-session-screen.test.ts`
- [x] 4.2 Implement Ink screen in `sdd-runner/src/tui-session-screen.ts`; state machine pure like `gate-session-state.ts`. Verify: `bun run test tests/sdd-runner/tui-session-screen.test.ts`
- [x] 4.3 Failing test: row actions — reopen action on abort-settled gate calls `runGateReopen` then opens gate session; stop action calls `requestCalmStop`; completed row routes to report. Verify: `bun run test tests/sdd-runner/tui-session-screen.test.ts`
- [x] 4.4 Wire actions to existing harness seams; no new orchestrator verbs. Verify: `bun run test tests/sdd-runner/tui-session-screen.test.ts`

## 5. Routing integration

- [x] 5.1 Failing test: no-target + several routable runs + TTY → session screen opens; same invocation non-TTY → unchanged candidate list exit without side effects (`tests/sdd-runner/cli-routing.test.ts`). Verify: `bun run test tests/sdd-runner/cli-routing.test.ts`
- [x] 5.2 Update `cli.ts`/`index.ts` no-target flow to pick screen vs list by render mode; scripted paths byte-identical. Verify: `bun run test tests/sdd-runner/cli-routing.test.ts && bun run typecheck`
- [x] 5.3 Failing test: aborted-run reopen via screen equals `sdd <runId> --reopen` outcome (fresh pending version, gate session). Verify: `bun run test tests/sdd-runner/gate-reopen-flow.test.ts`

## 6. Full verification

- [x] 6.1 Run full `bun test`, `bun run typecheck`, `bun run lint`; fix or split any `max-lines` signals per repo policy. Verify: `bun test && bun run typecheck && bun run lint`
- [x] 6.2 Update `docs/architecture/sdd-pipeline.md` routing/commands sections for the session screen, inline start, and task-name ids; confirm `openspec validate --strict` passes. Verify: `openspec validate sdd-runner-session-picker --strict`
