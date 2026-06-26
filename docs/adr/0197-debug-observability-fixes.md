<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0197: Debug Observability Fixes

## Status

Implemented

## Date

2026-06-15

## Context

A review of the `/debug` engineer observability surface (`src/debug/` server + `client/debug/` UI) surfaced eleven defects across three classes: privacy violations of the governing contract, correctness bugs in the event pipeline, and UX defects in the SSE stream and client. The governing privacy contract for this surface is: **the super admin sees only events for his own context plus genuinely context-free system events.** Findings A (`llm:tool_result` emitted `emitGlobal` → cross-context tool I/O leaked), B (`totalToolCalls` counted all contexts), and C (`/debug` + `/logs` exposed the unredacted global log buffer) were direct violations.

The spine of the change is one privacy invariant: every event reaching `onEvent` (`state-collector.ts`) must carry an honest `scope` that `isVisibleToAdmin` can correctly evaluate. An event tied to a user context is emitted `emitUser(contextId)`; only genuinely context-free system events use `emitGlobal`. **The consumer filters; the source is honest about scope.** The change re-scopes the one leaking event, unifies the trace key on `scope.userId`, redacts the global log buffer at egress, and fixes the SSE lifecycle + client display defects.

Group-context visibility is intentionally disabled under the privacy contract and is **not** changed here. The 2026-06-15 design spec (`docs/superpowers/specs/2026-06-15-debug-observability-fixes-design.md`) is the source of truth for the architecture.

## Decision Drivers

- **Privacy invariant at the source**: scope must be carried on every event so the existing `isVisibleToAdmin` consumer can filter; no source may emit user-context data globally.
- **Egress redaction as default-deny**: the in-memory log buffer stays truthful for diagnostics but serves only allowlisted, de-identified fields at both egress points.
- **Stream robustness**: SSE must survive idle proxies without dropping the connection or leaking the `onEvent` subscription.
- **Server-authoritative timestamps**: live turn `startedAt` must not jump when the browser clock disagrees with the server.
- **Surgical scope**: fix the eleven findings without touching the intended privacy model (group-context visibility stays disabled) or the redundant `turn:end`/`turn:summary` double-broadcast.

## Considered Options

### Option 1 — Scope-first: re-scope the leaking emit, unify the trace key on `scope.userId`, centralize egress redaction (chosen)

- **Pros**: enforces the invariant at the source so the consumer's existing `isVisibleToAdmin` does the filtering; the log buffer stays truthful in memory; one pure redactor module is the single source of truth for the policy.
- **Cons**: redaction is a second line of defense, not a replacement for source scoping; the allowlist is conservative and may redact useful-but-safe fields until extended.

### Option 2 — Per-event field redaction at each emit site

- **Pros**: no central policy module; each emit site controls its own surface.
- **Cons**: scattered and easy to miss a new emit site; no single source of truth; the global log buffer would still serve raw entries to `/logs`.

### Option 3 — Disable `/logs` and `log:entry` entirely

- **Pros**: eliminates the leak surface by removing it.
- **Cons**: loses the operational log panel the admin relies on; defeats the purpose of the observability surface.

## Decision

Six coordinated changes implement the architecture.

### 1. Re-scope `llm:tool_result` to the context (Finding A)

`src/llm-orchestrator-support.ts` changes the support deps emitter from `emitGlobal` to a user-scoped shape `emit(type, userId, payload)` with `defaultDeps.emit = emitUser`. Both `emitToolFailure` and `emitToolSuccess` call sites already hold `contextId`. The `userId` field is dropped from the payload (it now lives on `scope`). A tool result from another user's context now fails `isVisibleToAdmin` and never crosses the admin's wire. The DI seam used by tests is preserved.

### 2. Unify the trace key on `scope.userId` (Finding #2, with B falling out)

`src/debug/llm-trace-collector.ts` widens `TraceEvent` to include `scope` (already present on the `DebugEvent` that `onEvent` passes through) and keys `pendingTraces` on a new `traceKey(event)` reading `event.scope.kind === 'user' ? event.scope.userId : str(event.data['userId'])` for all four event types (`llm:start`/`llm:tool_result`/`llm:end`/`llm:error`). Because A makes `llm:tool_result`'s `scope.userId === contextId` match start/end, `pending.toolCalls` accumulate, `LlmTrace.userId` is populated, and concurrent contexts no longer collide on the empty-string key. Finding B (`totalToolCalls` counting all contexts) falls out for free: once `llm:tool_result` is `emitUser`, `totalToolCalls++` only runs for admin-visible results, consistent with `totalLlmCalls`/`totalMessages`. No separate code change; covered by a regression test.

### 3. Centralized egress redactor (Finding C)

New module `src/debug/log-redaction.ts` exports a single pure function `redactLogEntry(entry: LogEntry): LogEntry` — the source of truth for the policy. **Default-deny on structured fields**: an `ALLOWED_FIELDS` set (`level`, `time`, `scope`, `turnId`, `durationMs`, `messageLength`, `stepCount`, `toolCount`, `messageCount`, `count`, `size`, `capacity`, `tickCount`, `statusCode`, `ok`, `success`, `finishReason`, `errorType`, `errorCode`, `toolName`); everything else (`userText`, `content`, `chatUserId`, `contextId`, `userId`, `summary`, `facts`, `args`, `result`, `url`, free-text `error`) is dropped. **`msg` is template-gated** by `SAFE_MSG_TEMPLATES` (known content-free static strings like `"Message received from user"`, `"Tool execution failed"`); every other `msg` becomes `'[redacted]'`. Applied at both egress points: `/logs` REST (`src/debug/server.ts` maps `results.map(redactLogEntry)`) and `log:entry` SSE (`src/debug/log-buffer.ts` emits `redactLogEntry(entry)` while the ring buffer keeps the full entry in memory). `toolName`/`errorType`/`errorCode` are kept as de-identified signal; free-text `error` is dropped (it can embed user/content data).

### 4. SSE lifecycle fixes (Findings #3, #6)

`src/debug/state-collector.ts` routes both `broadcast()` and `sendTo()` enqueue-failure catch paths through `removeClient(client)`, so a dying client tears down the `onEvent` subscription when it is the last one (the bare `clients.delete` had bypassed the `clients.size === 0 → unsubscribe(onEvent)` check, leaving a dangling listener). A module-level heartbeat interval (`HEARTBEAT_MS = 15000`) starts when `clients` goes 0→1 (alongside `subscribe(onEvent)`) and clears when it returns to 0 (alongside `unsubscribe`); it enqueues an SSE comment line (`': ping\n\n'`) through the same guarded broadcast, so a dead client during ping also routes through `removeClient`. `src/debug/server.ts` `handleEvents` emits a `retry: 3000` hint on stream start so reconnects are paced. Comments are ignored by `EventSource`; no client handler changes.

### 5. Turn lookup and timestamps (Findings #5, #11)

`src/debug/turn-assembly.ts` `findTurnById` now checks `inFlightTurns.get(turnId) ?? recentTurns.find(...)` so `/turns/:id` resolves a running turn instead of 404ing. `src/message-queue/queue.ts` stamps `startedAt: Date.now()` on the `turn:start` event data; `client/debug/handlers.ts` `handleTurnStart` prefers the server value (`typeof d['startedAt'] === 'number' ? d['startedAt'] : Date.now()`) so the live turn `startedAt` no longer jumps when `turn:summary` replaces the browser-stamped value.

### 6. Client init ordering, sign-in redirect, and docs (Findings #4, #9, #10)

`client/debug/handlers.ts` `handleStateInit` `.reverse()`s the turns/notifications/toolFailures buffers on init (mirroring the existing `llmTraces` reversal) so the historical block matches the newest-first live convention. `src/debug/auth-routes.ts` `handleAuthClaimConfirm` 302s to `/debug` (not `/admin`) so dashboard sign-in lands on the requested surface. `CLAUDE.md` and `docs/deployment/dashboard-access.md` document that `DEBUG_SERVER=false` only 404s the engineer live-observability subset (`DEBUG_ONLY_PATHS`); operator surfaces (`/admin`, `/billing`, `/stats`, instance routes) remain session-gated.

## Consequences

### Positive

- A tool result from another user's context can no longer reach the admin's wire; `isVisibleToAdmin` filters it at the consumer.
- LLM-trace tool calls populate and `userId` is set; concurrent contexts keep separate pending traces; `totalToolCalls` is consistent with the other stats.
- `/logs` and `log:entry` serve only allowlisted, de-identified fields; the buffer stays truthful in memory for diagnostics.
- SSE survives idle proxies (heartbeat) and does not leak the `onEvent` subscription when a client dies on enqueue.
- `/turns/:id` resolves in-flight turns; live `startedAt` is server-authoritative.
- Init ordering matches the live newest-first convention across all four buffers.

### Negative

- The redaction allowlist is intentionally conservative; a missed safe field is a usability cost, not a leak (default-deny). Extending `ALLOWED_FIELDS` or `SAFE_MSG_TEMPLATES` is a low-risk follow-up.
- Free-text `error` is dropped from logs; the admin loses raw error strings in the global log panel but still sees full errors for their own context via the scope-filtered trace and tool-failure surfaces, and retains `errorType`/`errorCode` in logs.

### Risks

- **Allowlist drift**: a new safe field added to logs without updating `ALLOWED_FIELDS` will be silently redacted until added. Mitigated by default-deny being the safe direction and by a guard test asserting both egress points emit no key outside the allowlist.
- **Re-scoping changes wire contents**: the client has no `llm:tool_result` handler today, so there is no UI regression — only the intended reduction in cross-context data on the wire.
- **Heartbeat has no `AbortSignal`**: the enqueue-catch resolves the race, but a stuck controller may throw after `removeClient` has cleared timers; the catch swallows it. No regression; tracked as a follow-up.

## Related Decisions

- ADR-0037: Debug Tracing Tool — Session 1: Event Bus + Server Skeleton (the `emitUser`/`emitGlobal`/`Scope` primitives this change leans on).
- ADR-0038: Debug Tracing Tool — Session 2: Pino Log Pipeline (the `LogRingBuffer` whose egress is now redacted).
- ADR-0040: Debug Dashboard HTML — Session 4: Live Debug Dashboard UI (the `/debug` surface whose lifecycle is hardened).
- ADR-0121: Dashboard/Admin Split and Redesign (the `DEBUG_ONLY_PATHS` gate boundary this change documents).

## Implementation Notes

Key files, confirming presence in the tree:

- `src/llm-orchestrator-support.ts` — `emitUser` imported; `defaultDeps.emit = emitUser`; `deps.emit('llm:tool_result', contextId, {...})` (A).
- `src/debug/llm-trace-collector.ts` — `traceKey` reads `event.scope.kind === 'user' ? event.scope.userId : str(event.data['userId'])`; `TraceEvent` includes `scope` (#2, B).
- `src/debug/log-redaction.ts` — `redactLogEntry`, `ALLOWED_FIELDS`, `SAFE_MSG_TEMPLATES` (C).
- `src/debug/log-buffer.ts` — emits `redactLogEntry(entry)` at the `log:entry` boundary (C).
- `src/debug/server.ts` — `/logs` maps through `redactLogEntry`; `retry: 3000` hint on stream start (C, #6).
- `src/debug/state-collector.ts` — `removeClient` in both catch paths; `pingClients`/`startHeartbeat`/`stopHeartbeat`/`pingClientsForTest` (#3, #6).
- `src/debug/event-bus.ts` — `subscribeCountForTest` test seam (#3).
- `src/debug/turn-assembly.ts` — `findTurnById` checks `inFlightTurns.get(turnId) ?? recentTurns.find(...)` (#5).
- `src/message-queue/queue.ts` — `turn:start` emits `startedAt: Date.now()` (#11 server).
- `client/debug/handlers.ts` — `.reverse()` on four init buffers; `handleTurnStart` prefers server `startedAt` (#4, #11 client).
- `src/debug/auth-routes.ts` — `Location: '/debug'` (#9).
- `CLAUDE.md`, `docs/deployment/dashboard-access.md` — `DEBUG_SERVER` gate boundary docs (#10).

The repo TDD hook enforced Red→Green→Refactor per task; each task is a self-contained cycle ending in a commit on branch `fix/debug-observability-privacy`. Verification against the spec confirmed all symbols present with no divergence.
