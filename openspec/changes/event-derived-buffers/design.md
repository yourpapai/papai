## Context

Today `state-collector.ts` couples capture and fan-out in one `onEvent` handler whose subscription is tied to SSE client presence: `addClient` subscribes on the first client, `removeClient` unsubscribes on the last, and the event bus drops events at emit time when no listener is registered. A capture-time visibility check (`isVisibleToAdmin` at the top of `onEvent`) means buffers only ever hold admin-visible data, and the stats counters undercount identically. See `proposal.md` for motivation.

Constraints that shape the wiring:

- The Tier-0 story-lane refactor proof freezes the TypeScript shapes of `PapaiRuntimeDeps`, `createProductionRuntimeDeps`, `web.route`, and `application.setupBot`; changing them would require landing the seam change on master before a baseline re-record. The design must not change those shapes.
- `deps.web.start` (which calls `init(adminUserId)` via `startDebugServer`) is conditional on `config.startNetworkServer` and runs after `router.start()` — anything hung off it misses early events and is skipped entirely when the network server is off.
- `startRequiredServices` awaits `deps.database.start()` before creating and starting the chat router, so any point inside production deps creation or `database.start` precedes all platform emissions.
- `adminVisibility.groupIds` is always an empty set today: group-scope events are invisible. This change preserves that; extending group visibility is out of scope.
- Buffer/stats module state (`llm-trace-collector.ts`, `turn-assembly.ts`) is process-local singleton state reset by test seams (`resetTurnBuffers`, `resetClientsForTest`); `tests/mock-reset.ts` and the story harness files are frozen during refactor qualification and must not be edited.

## Goals / Non-Goals

**Goals:**

- Durable, unfiltered capture from process start, independent of dashboard connections and admin identity.
- Visibility enforced exactly at the two exposure points: broadcast (SSE frames) and read (`state:init`; the REST turn lookup stays as-is).
- Test seams that let debug suites restore a clean collector baseline in one call, following the existing direct-export seam style (`resetClientsForTest`).
- No frozen-seam shape changes; no new modules beyond what exists; no new dependencies.

**Non-Goals:**

- Persisting buffers to disk/DB or surviving restarts (spec: process-local and volatile).
- Lowering buffer capacities or evicting `generatedText` from traces.
- Removing the event-bus emit-time no-listener guard.
- Extending group-scope admin visibility; changing the client SPA or SSE protocol.
- Shipping pre-connect history for the log buffer (`log-buffer.ts` has its own lifecycle) — only the event-derived buffers and stats counters change.

## Decisions

### 1. Split capture from fan-out inside `state-collector.ts`; no new modules

`onEvent` becomes the persistent **capture** handler and runs unfiltered: `handleLlmTraceEvent`, `message:received` counting, `handleTurnAssembly`, then a gated broadcast. The assembly modules (`llm-trace-collector.ts`, `turn-assembly.ts`) keep their logic and signatures; only the callbacks passed in change meaning (see Decision 3). `state-collector.ts` already owns orchestration, the client set, heartbeat, and visibility — no existing module covers persistent capture otherwise, and none is needed.

*Alternative:* a new `persistent-collector.ts` module. Rejected: it would re-export or duplicate the buffer orchestration `state-collector` already performs, adding a module boundary with no behavioral payoff.

### 2. Start wiring: idempotent `startEventCollector()` called at `createProductionRuntimeDeps` creation time

Export an idempotent `startEventCollector()` from `state-collector.ts` (module flag guards double-subscription) and invoke it once inside the `createProductionRuntimeDeps` body. This is unconditional: it cannot be bypassed by overriding any dep slot (`database`, `application.setupBot`, `web`), and it precedes every runtime start, so it precedes `router.start()` and any platform emission by construction rather than by startup ordering.

The runtime stop path deliberately does **not** unsubscribe — capture is process-lifetime semantics; a stop/start cycle keeps capturing between runs.

*Alternatives considered:*

- `database.start` (`startDatabase`): keeps the factory pure, but bypassable by `database` overrides and semantically misfiled (a debug collector inside DB bootstrap).
- `setupProductionBot`: semantically apt (the bot emits the events) and receives `adminUserId`, but `application.setupBot` is the DI point the frozen story harness overrides — capture would be silently lost in the lane that most needs durable buffers.
- A new `PapaiRuntimeDeps` slot: changes a frozen seam shape; rejected.

`init(adminUserId)` stays where it is (`startDebugServer`). Capture does not need the admin identity; exposure-time filtering uses whatever visibility was last initialized (uninitialized = global-only visibility, same as today).

### 3. Visibility gates live in the broadcast/read path

- `broadcast(event)`: no-op when the client set is empty; drop events failing `isVisibleToAdmin(event.scope, adminVisibility)`; existing per-client log filtering and dead-client removal unchanged.
- `broadcastTrace(trace, ts)`: emit `llm:full` only when `trace.userId === adminUserId` (llm events are user-scoped; traces carry no scope). Uninitialized admin emits nothing — matches today.
- Synthetic `turn:summary` frames flow through the gated broadcast callback passed to `handleTurnAssembly`, and carry the turn's scope, so the gate covers them with no special case.
- `state:init` filters at read time: `recentTurns` / `recentNotifications` / `recentToolFailures` by stored `scope`; `recentLlm` by `trace.userId === adminUserId`. `stats` counters ship unfiltered (they are global totals by intent) alongside the already admin-keyed `sessions` snapshot.

*Alternative:* stamp a captured-visibility flag per entry. Rejected: admin identity is re-keyed per `init()` call; recomputing at exposure time stays correct across admin changes and needs no schema change on buffer entries.

### 4. Fan-out lifecycle and stats debounce

`addClient`/`removeClient` manage only the client set and heartbeat start/stop. `scheduleStatsBroadcast` early-returns when no clients are connected — with capture always on, every counted event would otherwise arm a 500 ms timer that broadcasts to nobody; connected clients still get debounced `state:stats` frames, and reconnecting clients get totals via `state:init`.

### 5. Event bus unchanged

The emit-time `listeners.size === 0` guard stays. In production it is unreachable (the collector subscribes before anything can emit). In unit tests that never start the collector, emits stay free no-ops — tests that assert capture must call `startEventCollector()` (or create production deps) explicitly.

### 6. Test seams: `startEventCollector()` / `stopEventCollectorForTest()` / `resetCollectorForTest()`

Mirroring `resetClientsForTest` (direct export, not a `.testing.ts` shim — those exist for the frozen story lane):

- `stopEventCollectorForTest()` — unsubscribe and clear the started flag.
- `resetCollectorForTest()` — one-call clean baseline: stop the collector, drain clients, `resetTurnBuffers()`, reset the LLM buffers (new `resetLlmBuffers()` export from `llm-trace-collector.ts`: `recentLlm.length = 0`, `pendingTraces.clear()`), and zero the stats counters.

Debug suites call these in `beforeEach`/`afterEach` locally; `tests/mock-reset.ts` is frozen during refactor qualification and is not touched (state-collector is not a mocked module, so the preload contract is unaffected).

### Scope model / data impact

No persisted state is introduced — buffers remain process-memory keyed by `turnId`/`userId` only; no drizzle migration, no backfill. No new tool surface, so capability gating and `tool_prefs` are unaffected. No new dependencies: the existing event bus, collectors, and runtime deps cover everything.

## Risks / Trade-offs

- [Always-on capture retains non-admin traces (`generatedText`) up to capacity in memory] → capacities stay bounded (65535/512/2048/1024) as accepted in the proposal; the data class is identical to what a connected session already retained; wiped on restart. Non-admin `pendingTraces` entries are bounded by distinct concurrent users and overwritten by the next `llm:start` for the same userId — same exposure as the admin path today.
- [`createProductionRuntimeDeps` becomes side-effectful; one existing test's subscriber arithmetic changes] → idempotent single subscription; `production-deps.test.ts` membership test captures its baseline after deps creation (the update itself documents the new invariant); per-worker test isolation contains module state; existing delta-based assertions elsewhere are unaffected.
- [`state:init` filtering scans full buffers on every connect] → linear over bounded arrays on a rare event (dashboard connect); pre-partitioned buffers rejected as complexity for no measurable gain.
- [Connected dashboards now show higher totals than before (counters no longer undercount non-admin activity)] → intended fix; dashboard protocol unchanged.
- [Mutation ratchet drop on `state-collector.ts` from new gating branches] → targeted tests per gate branch (zero clients, non-admin trace, non-admin scope, group scope); run `bun run test:mutate:changed` on touched files.
- [Frozen story lane asserting old drop-at-capture behavior] → non-admin data remains absent from every observable surface (`state:init`, frames, REST 404), so behavioral assertions hold; no frozen file is edited.

## Migration Plan

Single PR, deploy = restart. Buffers start empty per process as always; no persisted data, no compatibility surface (SSE event types and REST contracts unchanged). Rollback = revert + restart. No workflow or infra changes.

## Open Questions

- `state:init` payload size at buffer capacity: after long uptime with no dashboard connected, the filtered `recentLlm` could be near 65535 entries (with embedded text). Whether to ship a capped tail (e.g. most recent N traces/turns) or the full filtered buffers is a read-time policy choice that satisfies the spec either way; decide during implementation after measuring a realistic frame, and record the constant if capped.

## Hook / TDD interactions

The Write/Edit TDD hook pipeline gates every file below; work proceeds test-first:

1. Rewrite `tests/debug/state-collector-lifecycle.test.ts` to the new semantics (subscription independent of clients, heartbeat still client-tied, dead-client removal) — failing first.
2. Add capture/visibility tests to `tests/debug/state-collector.test.ts` (zero-client capture, broadcast gating, `state:init` filtering, idempotent start via `subscribeCountForTest`) — failing first.
3. Implement the `state-collector.ts` split + `resetLlmBuffers` seam.
4. Update `tests/runtime/production-deps.test.ts` baseline capture and assert creation-time subscription; wire `startEventCollector()` into `createProductionRuntimeDeps`.
5. Full `bun run test`, `bun check:full`, `bun run test:mutate:changed` on touched files.
