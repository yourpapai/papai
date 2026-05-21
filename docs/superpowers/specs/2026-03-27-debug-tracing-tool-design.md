<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Debug Tracing Tool Design

**Date:** 2026-03-27
**Status:** Approved
**Scope:** Development + staging debug tooling with web UI

## Overview

A debug tracing tool embedded in papai that provides real-time visibility into application state, LLM interactions, and logs via a web dashboard. Activated by environment variable (`DEBUG_SERVER=true`), zero overhead when disabled.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  papai process                                              │
│                                                             │
│  ┌──────────┐    pino.multistream()    ┌────────────────┐   │
│  │  pino     │───── stdout (normal) ──>│ terminal        │   │
│  │  logger   │───── stream #2 ────────>│ log-buffer.ts   │   │
│  └──────────┘                          │ (ring buffer,   │   │
│                                        │  65535 entries)  │   │
│  ┌──────────────────────┐              └────────────────┘   │
│  │  server.ts            │  Bun.serve(), port 9100          │
│  │  ┌─ SSE /events       │  streams state changes           │
│  │  ┌─ GET /logs          │  search/filter ring buffer       │
│  │  ┌─ GET /logs/stats    │  buffer metadata                 │
│  │  ┌─ GET /dashboard ──> static HTML (fetch + EventSource) │
│  └───────────────────────────────────────────────────────   │
│                                                             │
│  ┌──────────┐  ┌───────────┐  ┌────────┐                   │
│  │  bot.ts   │  │ llm-orch. │  │ cache  │ ── emits events  │
│  └──────────┘  └───────────┘  └────────┘    to SSE bus     │
└─────────────────────────────────────────────────────────────┘
```

**Key decisions:**

- **Single port (9100)** -- `Bun.serve()` hosts log search API, SSE stream, and dashboard HTML
- **In-memory ring buffer** -- replaces pinorama-server; zero new dependencies, `GET /logs` for search
- **pino.multistream()** (synchronous, main-thread) -- always wraps stdout; debug stream added dynamically via `.add()`
- **SSE for state + log tailing** -- dashboard uses SSE for real-time events and `GET /logs` for historical search
- **Single static HTML dashboard** -- served from `GET /dashboard`, no build step
- **Environment variable toggle** -- `DEBUG_SERVER=true` enables, absent = zero overhead
- **Fixed default port** -- `localhost:9100`, overridable via `DEBUG_PORT`

## SSE Event System

Lightweight event bus (`src/debug/event-bus.ts`) with zero-overhead guard:

```typescript
const listeners = new Set<(event: DebugEvent) => void>()

export function emit(type: string, data: Record<string, unknown>) {
  if (listeners.size === 0) return // zero overhead when no debug server
  const event = { type, timestamp: Date.now(), data }
  for (const fn of listeners) fn(event)
}
```

### Event Types

#### Lifecycle events (granular, real-time)

| Event type         | Source              | Payload                                               |
| ------------------ | ------------------- | ----------------------------------------------------- |
| `message:received` | bot.ts              | `{ userId, contextId, textLength, isCommand }`        |
| `message:replied`  | bot.ts              | `{ userId, contextId, textLength, duration }`         |
| `llm:start`        | llm-orchestrator.ts | `{ userId, model, messageCount, toolCount }`          |
| `llm:tool_call`    | llm-orchestrator.ts | `{ userId, toolName, args, stepIndex }`               |
| `llm:tool_result`  | llm-orchestrator.ts | `{ userId, toolName, duration, resultPreview }`       |
| `llm:end`          | llm-orchestrator.ts | `{ userId, model, steps, totalDuration, tokenUsage }` |
| `llm:error`        | llm-orchestrator.ts | `{ userId, error, model }`                            |
| `cache:load`       | cache.ts            | `{ userId, field, source }`                           |
| `cache:sync`       | cache.ts            | `{ userId, field }`                                   |
| `cache:expire`     | cache.ts            | `{ userId }`                                          |
| `trim:start`       | conversation.ts     | `{ userId, historyLength }`                           |
| `trim:end`         | conversation.ts     | `{ userId, kept, dropped, newSummary }`               |
| `auth:check`       | bot.ts              | `{ userId, result }`                                  |

#### State snapshot events (full state embedded)

| Event type    | Payload                                                                                   | Trigger                                              |
| ------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `state:init`  | `{ sessions[], wizards[], scheduler{}, pollers{}, messageCache{}, stats{}, recentLlm[] }` | New SSE connection (bootstrap)                       |
| `state:stats` | `{ startedAt, totalMessages, totalLlmCalls, totalToolCalls }`                             | On `message:received` / `llm:end` (debounced ~500ms) |
| `llm:full`    | `{ userId, model, steps, totalTokens{}, duration, toolCalls[], error? }`                  | On `llm:end` -- dashboard accumulates client-side    |

**Note:** `state:sessions` and `state:cache` events were removed. The dashboard maintains client-side state from `state:init` bootstrap + raw lifecycle event deltas (`cache:load`, `cache:sync`, `cache:expire`, `wizard:created`, etc.). This keeps the server-side state-collector simple and avoids re-querying snapshot functions on every mutation.

## Dashboard UI

Single static HTML file (`src/debug/dashboard.html`), ~400-500 lines. Vanilla JS + EventSource + `fetch('/logs')` for log search. No external dependencies.

```
┌─────────────────────────────────────────────────────┐
│  papai debug · # connected · uptime 2h13m           │
│  sessions: 3 · messages: 147 · llm calls: 89       │
├────────────────────┬────────────────────────────────┤
│                    │                                │
│  SESSIONS          │  LOG EXPLORER                  │
│                    │                                │
│  > user:123  *     │  [scope v] [level v] [search]  │
│    history: 24     │                                │
│    facts: 5        │  12:03:01 info  llm-orch       │
│    summary: yes    │    Calling generateText        │
│                    │  12:03:02 debug llm-orch       │
│  > user:456        │    Tool call: search_tasks     │
│    history: 8      │  12:03:03 info  llm-orch       │
│    facts: 2        │    Response generated (1.2s)   │
│                    │                                │
├────────────────────┤                                │
│                    │                                │
│  LLM TRACE         │                                │
│                    │                                │
│  12:03:01 user:123 │                                │
│  model: gpt-4o     │                                │
│  steps: 3          │                                │
│  tools: search,    │                                │
│    get_task        │                                │
│  tokens: 1.2k/340  │                                │
│  duration: 1.2s    │                                │
│                    │                                │
└────────────────────┴────────────────────────────────┘
```

**4 panels:**

1. **Header** -- SSE connection status, global stats from `state:stats`
2. **Sessions (left top)** -- bootstrapped from `state:init.sessions`, updated client-side via `cache:load`/`cache:sync`/`cache:expire` deltas
3. **LLM Trace (left bottom)** -- chronological `llm:full` events, click for detail (tool calls, tokens, durations)
4. **Log Explorer (right)** -- `fetch('/logs?...')` queries against ring buffer REST API + SSE `log:entry` for live tailing. Filter by scope, level, text.

## HTTP Endpoints

| Endpoint          | Purpose                                                          |
| ----------------- | ---------------------------------------------------------------- |
| `GET /events`     | SSE stream -- single data channel for all state and events       |
| `GET /logs`       | Search/filter ring buffer (query params: level, scope, q, limit) |
| `GET /logs/stats` | Ring buffer metadata (count, capacity, oldest, newest)           |
| `GET /dashboard`  | Serves the static HTML dashboard                                 |

## New Files

| File                           | Purpose                                                                  | ~Lines |
| ------------------------------ | ------------------------------------------------------------------------ | ------ |
| `src/debug/event-bus.ts`       | Event emitter, subscribe/unsubscribe, zero-overhead guard                | ~30    |
| `src/debug/server.ts`          | `Bun.serve()` — SSE, log search, dashboard routes                        | ~100   |
| `src/debug/log-buffer.ts`      | Ring buffer (65535 entries), search, stream adapter for pino.multistream | ~80    |
| `src/debug/state-collector.ts` | SSE broadcast, stats counters, LLM trace ring buffer, state snapshots    | ~200   |
| `src/debug/dashboard.html`     | Static 4-panel dashboard (vanilla JS + EventSource + fetch)              | ~500   |

**Total new:** ~910 lines across 5 files.

## Changes to Existing Files

| File                      | Change                                                                   | ~Lines |
| ------------------------- | ------------------------------------------------------------------------ | ------ |
| `src/logger.ts`           | Always use `pino.multistream([stdout])`, export multistream for `.add()` | ~5     |
| `src/index.ts`            | Conditional debug server startup via dynamic import                      | ~5     |
| `src/bot.ts`              | Add `emit()` calls for message lifecycle + auth                          | ~8     |
| `src/llm-orchestrator.ts` | Add `emit()` calls for LLM tracing                                       | ~12    |
| `src/cache.ts`            | Add `emit()` calls for cache mutations + state snapshots                 | ~8     |
| `src/conversation.ts`     | Add `emit()` calls for trim events                                       | ~4     |
| `package.json`            | `start:debug` script (no new dependencies)                               | ~1     |

**Total changes:** ~43 lines of additions to existing files.

## Dev Session Decomposition

```
Session 1 (event bus + server) ──┬──> Session 3 (instrumentation) ──> Session 4 (dashboard)
Session 2 (pino log pipeline)  ──┘
```

### Session 1: Event Bus + Debug Server Skeleton ✅

> **Implemented.** See `docs/plans/2026-03-28-debug-session1-implementation.md`

**Scope:**

- `src/debug/event-bus.ts` — zero-overhead event bus (`Set<Listener>`)
- `src/debug/server.ts` — `Bun.serve()` with SSE `/events` + placeholder `/dashboard`
- `src/debug/state-collector.ts` — SSE client management + broadcast
- `src/index.ts` — conditional startup via dynamic `import('./debug/server.js')`
- `package.json` — `start:debug` script
- Unit tests for event bus, state collector, and server

**Acceptance criteria:**

- `DEBUG_SERVER=true bun start` opens port 9100
- `curl localhost:9100/events` receives SSE stream
- Bot runs normally without `DEBUG_SERVER` set
- Event bus emit() is a no-op with zero overhead when no listeners

### Session 2: Pino Log Pipeline (revised — ring buffer, no pinorama)

> **Revised:** pinorama-server requires Fastify (Session 1 used `Bun.serve()`), pinorama-transport uses Worker Threads (broken on Bun). Replaced with zero-dependency in-memory ring buffer. Full design: `docs/plans/2026-03-28-session2-pino-log-pipeline-design.md`

**Scope:**

- `src/debug/log-buffer.ts` — ring buffer (65535 entries) + writable stream adapter
- `src/logger.ts` — always-multistream (`pino.multistream([stdout])`) with dynamic `.add()`
- `src/debug/server.ts` — add `GET /logs` and `GET /logs/stats` routes, connect buffer on startup
- No new dependencies

**Acceptance criteria:**

- `curl localhost:9100/logs` returns JSON array of recent log entries
- `curl localhost:9100/logs?level=40&scope=main` returns filtered results
- `curl localhost:9100/logs/stats` returns buffer metadata
- Normal stdout logging unaffected
- No new dependencies added

### Session 3: Instrument Source Modules

**Scope:**

- Add `emit()` calls to `bot.ts`, `llm-orchestrator.ts`, `cache.ts`, `conversation.ts`
- Expand `state-collector.ts` to be the central state hub:
  - Global stats counters (uptime, totalMessages, totalLlmCalls, totalToolCalls)
  - LLM trace ring buffer (recent `llm:full` events for dashboard)
  - Populate `state:init` with real session/stats/llm data on SSE connect
- Emit state snapshots (`state:sessions`, `state:cache`, `state:stats`, `llm:full`)

**Acceptance criteria:**

- SSE stream shows real-time events when sending messages to the bot
- `state:init` fires on new SSE connection with full current state (sessions, stats, recent LLM calls)
- State snapshots reflect actual in-memory state accurately
- Zero overhead when `DEBUG_SERVER` not set (no listeners = no-op)

### Session 4: Dashboard HTML

**Scope:**

- `src/debug/dashboard.html` (4-panel layout)
- SSE consumer for header, sessions, LLM trace panels
- Log explorer panel via `GET /logs` REST API + SSE `log:entry` events for live tailing
- Serve at `GET /dashboard`

**Client-side state management (REQUIRED):**

The dashboard MUST maintain its own client-side state from `state:init` bootstrap + raw lifecycle event deltas. There are no server-side `state:sessions` or `state:cache` convenience events — the state-collector forwards raw events only.

- On SSE connect: receive `state:init` with full snapshot (`sessions[]`, `wizards[]`, `scheduler{}`, `pollers{}`, `messageCache{}`, `stats{}`, `recentLlm[]`). Store as client-side state.
- On `cache:load` / `cache:sync`: update the corresponding session's fields client-side (e.g., increment history count on `{ field: 'history', operation: 'append' }`)
- On `cache:expire`: remove the session from the client-side sessions list
- On `wizard:created` / `wizard:updated` / `wizard:deleted`: update client-side wizard state
- On `state:stats`: replace stats counters
- On `llm:full`: append to LLM trace list
- On `scheduler:tick`, `poller:scheduled`, `poller:alerts`, `msgcache:sweep`: update infrastructure status indicators

This approach keeps the server-side state-collector simple (no re-querying snapshot functions on every mutation) and moves rendering logic to the dashboard where it belongs.

**Acceptance criteria:**

- `localhost:9100/dashboard` opens in browser
- Header shows live connection status and stats
- Sessions panel bootstraps from `state:init` and updates in real-time via lifecycle event deltas
- LLM trace panel shows tool calls, tokens, durations
- Log explorer searches and filters logs via ring buffer REST API
