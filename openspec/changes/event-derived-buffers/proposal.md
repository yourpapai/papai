# event-derived-buffers

## Goal

Make the debug dashboard's event-derived buffers durable across dashboard connections. Today `recentLlm`, `pendingTraces`, `recentTurns`, `recentNotifications`, `recentToolFailures` and the `stats` counters are only populated while ≥1 SSE client is connected: `addClient` subscribes `onEvent` on the first client (`src/debug/state-collector.ts:121-124`) and `removeClient` unsubscribes on the last (`src/debug/state-collector.ts:130-133`), while the event bus drops events at emit time when no listener is registered (`src/debug/event-bus.ts:34,43,51`). History before/between dashboard connections is unrecoverable.

Redesign: a **persistent collector**, subscribed at process startup, owns buffer assembly and stats counting; SSE fan-out (and its heartbeat) becomes the ephemeral part. Because the collector is always on, it must capture **unfiltered** events — the current capture-time admin-visibility filter (`src/debug/state-collector.ts:156`, applied before `handleLlmTraceEvent`/`handleTurnAssembly`) moves to **broadcast time and read time**.

## Files to touch

- `src/debug/state-collector.ts` — split capture from broadcast (the core redesign).
- `src/debug/llm-trace-collector.ts`, `src/debug/turn-assembly.ts` — only if callback signatures need adjusting; their assembly logic stays as-is.
- `src/debug/event-bus.ts` — no behavioral change expected; the emit-time `listeners.size === 0` guard stays (the persistent collector guarantees a listener exists in production).
- `src/runtime/production-deps.ts` (and, only if needed, `src/runtime/create-runtime.ts`) — start the collector during production startup **before chat platforms can emit** (`router.start()` at `src/runtime/create-runtime.ts:71`). Do NOT hang it off `startDebugServer`/`init()`: `web.start` is conditional on `config.startNetworkServer` (`src/runtime/create-runtime.ts:86-87`) and runs after platforms start. Prefer wiring that does not change frozen story seam shapes (`PapaiRuntimeDeps`, `createProductionRuntimeDeps`, `web.route`, `application.setupBot`); e.g. an idempotent `startEventCollector()` exported from state-collector and invoked from production deps creation/startup.
- Tests: `tests/debug/state-collector.test.ts`, `tests/debug/state-collector-lifecycle.test.ts` — update lifecycle/visibility expectations; add coverage for the new behavior (see Verification).

## Intended behavior change

1. **Persistent capture.** An idempotent collector listener subscribes once at startup and, for every `DebugEvent` regardless of scope visibility: runs `handleLlmTraceEvent` (pendingTraces/recentLlm), increments `stats.totalMessages/totalLlmCalls/totalToolCalls`, and runs `handleTurnAssembly` (recentTurns/inFlightTurns/recentNotifications/recentToolFailures). Buffers and stats thus accumulate from process start and survive dashboard disconnects, even if no client ever connects. Buffer capacities stay as-is (65535 traces / 512 turns / 2048 notifications / 1024 tool failures) — bounded memory, accepted.
2. **Ephemeral fan-out.** `addClient`/`removeClient` no longer (un)subscribe the collector; they only manage the client set and heartbeat start/stop. Broadcasting events (`broadcast`), synthetic `turn:summary` frames, and `llm:full` trace frames happens only when clients exist and only for events admin-visible per `isVisibleToAdmin(event.scope, adminVisibility)` — the visibility check moves from the top of `onEvent` to the broadcast path.
3. **Read-time visibility.** The `state:init` payload filters buffered data through the same predicate: `recentTurns`/`recentNotifications`/`recentToolFailures` by their stored `scope`; `recentLlm` by `trace.userId === adminUserId` (traces carry no scope; llm events are user-scoped). Non-admin events are captured but never broadcast or included in `state:init`. The REST `/turns/:id` contract (`isScopeVisibleToCurrentAdmin`, 404 for foreign turns) is unchanged — foreign turns now simply exist in the buffer and stay unreadable.
4. **Test seams.** Provide a reset/stop seam for the collector (mirroring `resetClientsForTest`) so suites can restore a clean baseline per the mock-reset model; lifecycle tests assert heartbeat tying to clients, subscription no longer tying to clients.

### Assumptions (stated, not asked)
- Stats counters moving to always-on capture is in scope (they share the same handler and today undercount identically).
- The emit-time no-listener guard in `event-bus.ts` stays: with the collector subscribed at startup it is unreachable in production, and removing it would change construction cost for no benefit.
- Lowering `LLM_TRACE_CAPACITY` (traces embed `generatedText`) is out of scope; capacities are bounded and unchanged.

## Verification

- New unit tests (DI-first, `tests/debug/`): (a) emit admin + non-admin + global events with **zero** SSE clients, then `addClient` → `state:init` contains exactly the admin-visible subset and correct stats; (b) non-admin events reach buffers (assert via exported buffers/`findTurnById` + 404-style invisibility) but are never broadcast; (c) stats increment with no client connected; (d) collector start is idempotent (single subscription via `subscribeCountForTest`).
- Update `state-collector-lifecycle.test.ts`: subscription count no longer tracks client count; heartbeat still starts/stops with first/last client; dead-client removal still works.
- Existing visibility tests in `state-collector.test.ts` flip from "dropped before assembly" to "captured, filtered at broadcast/read".
- Full `bun run test` before finishing (use `bun run test:affected` in the loop), plus `bun check:full` (lint, typecheck, knip, format). Watch the mutation ratchet for touched files (`test:mutate:changed`).
