## 1. Capture/lifecycle tests (red first)

- [x] 1.1 Rewrite `tests/debug/state-collector-lifecycle.test.ts` for the new semantics: `addClient`/`removeClient` leave `subscribeCountForTest()` unchanged, heartbeat still starts on first client and stops on last, dead-client ping/broadcast removal still drops clients. Verify: `bun test tests/debug/state-collector-lifecycle.test.ts` (expected red until 2.2)
- [x] 1.2 Extend `tests/debug/state-collector.test.ts` with persistent-capture coverage: admin + non-admin + global events emitted with zero clients are captured (assert via `state:init` after `addClient`, exported buffers, `findTurnById`), stats increment with no client connected, non-admin events are never broadcast (no frames while a client is connected), `startEventCollector()` is idempotent (exactly one subscription via `subscribeCountForTest`). Verify: `bun test tests/debug/state-collector.test.ts` (expected red until 2.2)

## 2. State-collector split (capture vs fan-out)

- [x] 2.1 Add `resetLlmBuffers()` export to `src/debug/llm-trace-collector.ts` (clear `recentLlm` and `pendingTraces`) with a case in `tests/debug/llm-trace-collector.test.ts` asserting both are empty after capture. Verify: `bun test tests/debug/llm-trace-collector.test.ts`
- [x] 2.2 Rework `src/debug/state-collector.ts`: unfiltered `onEvent` capture (trace assembly, `message:received` counting, turn assembly), idempotent `startEventCollector()` + `stopEventCollectorForTest()` + `resetCollectorForTest()` seams, visibility moved to broadcast path (scope gate + empty-client no-op + `broadcastTrace` `userId === adminUserId` gate + `turn:summary` via gated callback), `scheduleStatsBroadcast` early-return with no clients, `addClient`/`removeClient` managing only client set + heartbeat, `state:init` filtering `recentTurns`/`recentNotifications`/`recentToolFailures` by stored scope and `recentLlm` by trace `userId`. Verify: `bun test tests/debug/state-collector.test.ts tests/debug/state-collector-lifecycle.test.ts tests/debug/scope-visibility.test.ts tests/debug/admin-visibility.test.ts`

## 3. Production wiring (red first)

- [x] 3.1 Update `tests/runtime/production-deps.test.ts`: capture the subscriber baseline after `createProductionRuntimeDeps()` and assert creation subscribes the collector exactly once, independent of runtime start/stop. Verify: `bun test tests/runtime/production-deps.test.ts` (expected red until 3.2)
- [x] 3.2 Call `startEventCollector()` once inside `createProductionRuntimeDeps` in `src/runtime/production-deps.ts` (no `PapaiRuntimeDeps` shape change; do not unsubscribe on stop). Verify: `bun test tests/runtime/production-deps.test.ts`

## 4. Regression sweep, mutation gate, docs

- [ ] 4.1 Run the affected suite around the debug/runtime surfaces to catch flipped visibility expectations (e.g. `bun run test:affected --base=HEAD~1`, then targeted `bun test tests/debug/ tests/runtime/`); fix any suite still asserting drop-at-capture. Verify: `bun run test:affected --base=HEAD~1`
- [ ] 4.2 Mutation ratchet on touched files (`src/debug/state-collector.ts`, `src/debug/llm-trace-collector.ts`, `src/runtime/production-deps.ts`); strengthen tests where survivors survive. Verify: `bun run test:mutate:changed`
- [ ] 4.3 Update affected `docs/architecture/` pages (the debug/settings server surfaces in `overview.md`; any dashboard-buffer lifecycle wording in `behaviors.md`) to describe persistent capture with broadcast/read-time visibility. Verify: `bun run knip`
- [ ] 4.4 Full gate: complete `bun run test`, `bun run typecheck`, `bun run lint`. Verify: `bun check:full && bun run test`
