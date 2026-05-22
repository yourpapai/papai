<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0039: Debug Tracing Tool — Session 3: Instrument Source Modules

## Status

Accepted

## Context

Following Sessions 1 and 2 of the debug tracing tool implementation (event bus + server skeleton, and pino log pipeline), we needed to instrument the actual source modules with debug event emission. The debug dashboard requires visibility into:

- Real-time message processing lifecycle (received → auth → replied)
- LLM invocation with tool call tracing
- Cache operations (loads, syncs, expirations)
- Background task execution (scheduler ticks, recurring task creation)
- Wizard session lifecycle
- Conversation memory trimming operations

The challenge was to add comprehensive instrumentation without:

1. Exposing sensitive data (API keys, tokens, user content)
2. Impacting performance when debug mode is disabled
3. Creating tight coupling between source modules and debug infrastructure

## Decision Drivers

- **Must observe without exposing secrets** — Config values, API keys, and user content must never appear in debug events
- **Must be zero-overhead when disabled** — No performance impact when `DEBUG_SERVER` is not set
- **Must support admin-only filtering** — Only the admin user's events should be visible in the debug stream
- **Must enable cold-start bootstrap** — New SSE connections need full current state, not just future events
- **Must integrate cleanly with Vercel AI SDK** — Use official SDK callbacks for tool call instrumentation

## Considered Options

### Option 1: Pure Event Stream (No Snapshots)

Emit events only, no state queries. Dashboard would start empty and populate over time.

- **Pros**: Simplest implementation, no snapshot functions needed
- **Cons**: Dashboard shows incomplete state on connect; misses events that happened before connection

### Option 2: Polling-Based State Queries

Dashboard periodically queries REST endpoints for current state.

- **Pros**: Always up-to-date state
- **Cons**: Additional polling overhead, more endpoints to maintain, timing mismatch between events and state

### Option 3: Hybrid Pattern (Events + Snapshot Facades) — Selected

Source modules emit real-time events via `emit()`. Each module exports a snapshot function returning sanitized current state. On SSE connect, `state-collector.ts` calls all snapshot functions once to populate `state:init`, then maintains state via events.

- **Pros**:
  - Cold-start bootstrap with full state
  - Real-time updates via events
  - No polling overhead
  - Clean separation: modules don't know about SSE or filtering
- **Cons**: Slightly more code (snapshot functions)

## Decision

We will use the **Hybrid Pattern** — `emit()` calls in source modules for real-time events, snapshot facade functions for cold-start bootstrap on SSE connect.

### Architecture

```
bot.ts ──────────────┐
llm-orchestrator.ts ─┤── import { emit } from ──> event-bus.ts <── subscribe ── state-collector.ts
cache.ts ────────────┤                                                              │
conversation.ts ─────┤                                                              │
wizard/state.ts ─────┤                                                              │
scheduler.ts ────────┤                                                              │
poller.ts ───────────┤                                                              │
message-cache/ ──────┘                                                              │
                                                                                    │
cache-snapshots.ts ─── export getSessionSnapshots() <── import ─────────────────────┘
wizard/state.ts ───── export getWizardSnapshots()  <── import ──────────────────────┘
scheduler.ts ──────── export getSchedulerSnapshot() <── import ─────────────────────┘
poller.ts ─────────── export getPollerSnapshot()   <── import ──────────────────────┘
message-cache/ ────── export getMessageCacheSnapshot() <── import ──────────────────┘
```

### Security Boundary

All `emit()` calls fire unconditionally. **`state-collector.ts` is the single security gate:**

1. **Init-time**: receives `adminUserId` from `startDebugServer(adminUserId)`
2. **Lifecycle events**: `onEvent()` checks `event.data.userId` — drops non-admin events before broadcasting
3. **Snapshot queries**: passes `adminUserId` as filter — e.g., `getSessionSnapshots(adminUserId)` returns only the admin's session
4. **Global state** (scheduler, pollers, message-cache, stats): no user data, broadcast unfiltered
5. **Tool call results**: `experimental_onToolCallFinish` payload excludes `output` (may contain task content). Only `success`, `durationMs`, and `error` are emitted.

## Implementation

### Snapshot Functions Added

| Module                         | Function                                           | Returns                               |
| ------------------------------ | -------------------------------------------------- | ------------------------------------- |
| `cache-snapshots.ts`           | `getSessionSnapshots(userId)`                      | Session metadata (no config values)   |
| `wizard/state.ts`              | `getWizardSnapshots(userId)`                       | Wizard session state (no data values) |
| `scheduler.ts`                 | `getSchedulerSnapshot()`                           | Scheduler running state, tick count   |
| `deferred-prompts/poller.ts`   | `getPollerSnapshot()`                              | Poller running state, intervals       |
| `message-cache/cache.ts`       | `getMessageCacheSnapshot()`                        | Cache size, pending writes            |
| `message-cache/persistence.ts` | `getPendingWritesCount()`, `getIsFlushScheduled()` | Internal queue state                  |

### Event Types Instrumented

| Category          | Events                                                                  | Emit Points                                  |
| ----------------- | ----------------------------------------------------------------------- | -------------------------------------------- |
| Message Lifecycle | `message:received`, `auth:check`, `message:replied`                     | 3 in `bot.ts`                                |
| LLM Operations    | `llm:start`, `llm:tool_call`, `llm:tool_result`, `llm:end`, `llm:error` | 5 in `llm-orchestrator.ts` via SDK callbacks |
| Cache Operations  | `cache:load`, `cache:sync`, `cache:expire`                              | 15 in `cache.ts`                             |
| Conversation      | `trim:start`, `trim:end`                                                | 2 in `conversation.ts`                       |
| Wizard            | `wizard:created`, `wizard:updated`, `wizard:deleted`                    | 3 in `wizard/state.ts`                       |
| Scheduler         | `scheduler:tick`, `scheduler:task_executed`                             | 2 in `scheduler.ts`                          |
| Deferred Prompts  | `poller:scheduled`, `poller:alerts`                                     | 2 in `deferred-prompts/poller.ts`            |
| Message Cache     | `msgcache:sweep`                                                        | 1 in `message-cache/cache.ts`                |

### State-Collector Expansion

Rewritten from ~47 lines to ~230 lines with:

1. **Admin filtering**: `isAdminEvent()` checks `event.data.userId` against `adminUserId`
2. **Global stats counters**: `totalMessages`, `totalLlmCalls`, `totalToolCalls` (debounced broadcast)
3. **LLM trace ring buffer**: 65,535 capacity, accumulates traces from `llm:start` → tool results → `llm:end`
4. **State snapshot assembly**: `state:init` with sessions, wizards, scheduler, pollers, message cache, stats, recent LLM

## Consequences

### Positive

- Dashboard receives full state on connect via `state:init`
- Real-time visibility into all message processing, LLM calls, and background tasks
- Zero overhead when debug disabled (event bus guards check `listeners.size`)
- Clean security boundary — all filtering in one place (`state-collector.ts`)
- No sensitive data exposure (config keys only, no values; tool outputs excluded)
- Leverages official Vercel AI SDK callbacks for clean integration

### Negative

- ~250 lines of new/changed code across 8 modules
- Snapshot functions add minor maintenance overhead
- LLM trace accumulation adds small memory footprint (bounded by 65,535 capacity)

### Risks

- **SDK callback stability**: Using `experimental_onToolCallStart`/`Finish` — may change in future SDK versions
  - Mitigation: Callbacks are optional; if removed, events simply won't fire
- **Performance with many debug clients**: Each event broadcast to all connected clients
  - Mitigation: Expected 1-2 debug clients max; broadcasts are simple SSE enqueues

## Verification

All acceptance criteria verified:

- ✅ SSE stream shows real-time events when sending messages as admin
- ✅ Non-admin user events filtered out (never appear in stream)
- ✅ `state:init` fires on SSE connect with full current state
- ✅ State snapshots reflect actual in-memory state
- ✅ Tool call outputs never exposed in debug events
- ✅ Config values (API keys, tokens) never exposed — only key names
- ✅ Zero overhead when `DEBUG_SERVER` not set
- ✅ All existing tests pass (`bun test`: 1,867 passing)

## Related Decisions

- [ADR-0037](0037-debug-server-session1.md) — Session 1: Event bus and server skeleton
- [ADR-0038](0038-pino-log-pipeline-session2.md) — Session 2: Pino log pipeline

## References

- Implementation plan: `docs/plans/done/2026-03-28-session3-instrument-source-modules-implementation.md`
- Design document: `docs/plans/done/2026-03-28-session3-instrument-source-modules-design.md`
- Vercel AI SDK documentation: `experimental_onToolCallStart`/`experimental_onToolCallFinish` callbacks
