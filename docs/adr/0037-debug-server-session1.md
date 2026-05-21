<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0037: Debug Tracing Tool — Session 1: Event Bus + Server Skeleton

## Status

Accepted

## Context

As papai grows in complexity with multiple subsystems (LLM orchestration, task providers, chat providers, wizards, schedulers), debugging production issues has become increasingly difficult. The existing logging via pino provides raw text output, but lacks:

1. **Real-time visibility** into LLM call traces, tool executions, and state changes
2. **Structured access** to aggregated logs with search/filter capabilities
3. **Live dashboard** for monitoring bot health and active sessions
4. **Privacy controls** to ensure debug data doesn't leak across users

We need a debug infrastructure that:

- Provides zero overhead when disabled (production safety)
- Supports real-time Server-Sent Events (SSE) for live dashboards
- Captures structured events from multiple source modules
- Maintains admin-only access to sensitive debug data

## Decision Drivers

- **Zero overhead when disabled**: Must not impact production performance
- **Zero new dependencies**: Use only Bun built-ins and existing pino logger
- **Real-time streaming**: SSE for live dashboard updates
- **Privacy**: Admin-only access to debug events
- **Extensibility**: Foundation for Session 2+ features (log pipeline, instrumentation, dashboard UI)

## Considered Options

### Option 1: Fastify + pinorama-server

Use Fastify HTTP server with pinorama-server (Orama-based full-text log search) for log aggregation.

- **Pros**: Mature ecosystem, built-in log search, fast full-text queries
- **Cons**: Adds Fastify dependency, pinorama-server integration complexity, Bun+Fastify friction (timeout warnings, incomplete ServerResponse API)
- **Verdict**: Rejected — adds dependencies and complexity; overkill for debug volumes

### Option 2: Bun.serve() with custom ring buffer (Accepted)

Use Bun's built-in `Bun.serve()` with web `ReadableStream` API for SSE, and implement a custom ring buffer for log aggregation.

- **Pros**: Zero new dependencies, native Bun APIs, no Bun+Fastify friction, sufficient for debug volumes (hundreds to thousands of logs per session)
- **Cons**: Custom search implementation (Array.filter), no full-text search indexing
- **Verdict**: Accepted — best balance of simplicity and capability

### Option 3: External observability (Datadog, etc.)

Integrate with external observability platform.

- **Pros**: Professional tooling, no maintenance burden
- **Cons**: External dependency, cost, privacy concerns with chat data, network latency
- **Verdict**: Rejected — violates self-hosted requirement and privacy constraints

## Decision

Implement a **Debug Tracing Tool** using Bun.serve() with three core components:

### 1. Event Bus (`src/debug/event-bus.ts`)

Minimal synchronous event bus using `Set<Listener>`:

```typescript
type DebugEvent = {
  type: string
  timestamp: number
  data: Record<string, unknown>
}

const listeners = new Set<Listener>()

function emit(type: string, data: Record<string, unknown>): void {
  if (listeners.size === 0) return // Zero overhead when no debug server
  const event: DebugEvent = { type, timestamp: Date.now(), data }
  for (const fn of listeners) fn(event)
}
```

Key properties:

- **Zero overhead**: Returns immediately when `listeners.size === 0`
- **Synchronous**: Emitters not slowed by async work
- **String-based types**: Extensible without changing core module

### 2. State Collector (`src/debug/state-collector.ts`)

Manages SSE client connections with lazy subscription:

```typescript
function addClient(controller: ReadableStreamDefaultController): void {
  clients.add(controller)
  sendTo(controller, { type: 'state:init', timestamp: Date.now(), data: {} })

  if (clients.size === 1) {
    subscribe(onEvent) // Lazy subscribe on first client
  }
}
```

Key properties:

- **Lazy subscribe/unsubscribe**: Only subscribes when clients connected
- **Error-tolerant broadcast**: Silently removes dead clients
- **Admin filtering**: Events filtered by `userId` for privacy

### 3. Debug Server (`src/debug/server.ts`)

HTTP server using `Bun.serve()`:

```typescript
server = Bun.serve({
  port,
  idleTimeout: 0, // Prevent Bun from dropping SSE connections
  fetch(req) {
    if (url.pathname === '/events') {
      // SSE stream with ReadableStream
    }
    if (url.pathname === '/dashboard') {
      // HTML dashboard placeholder
    }
  },
})
```

Key properties:

- **`idleTimeout: 0`**: Prevents Bun's default 10s idle timeout on SSE
- **Web `ReadableStream`**: Bun-native API, no Node.js compat layer
- **Dual disconnect detection**: `req.signal` abort + stream `cancel()`

### 4. Integration (`src/index.ts`)

Dynamic import gated by `DEBUG_SERVER=true`:

```typescript
let stopDebugServerFn: (() => void) | null = null

if (process.env['DEBUG_SERVER'] === 'true') {
  const { startDebugServer, stopDebugServer } = await import('./debug/server.js')
  await startDebugServer(adminUserId)
  stopDebugServerFn = stopDebugServer
}
```

Key properties:

- **Dynamic import**: Entire `src/debug/` tree never loaded unless enabled
- **Graceful shutdown**: `stopDebugServerFn` added to SIGINT/SIGTERM handlers

## Extended Features (Beyond Original Plan)

The implementation expanded beyond the original plan with production-ready features:

### Log Buffer (`src/debug/log-buffer.ts`)

- Ring buffer with configurable capacity (default 65,535 entries)
- Search with filters: level, scope, text query, limit
- SSE emission on every log entry via event bus
- Pino integration via `logBufferStream` destination

### Authentication

- Optional `DEBUG_TOKEN` environment variable
- Bearer token validation on all endpoints
- Returns 401 Unauthorized if token mismatch

### Dashboard Assets

- TypeScript-to-JavaScript transpilation via `Bun.build()`
- Dashboard HTML, CSS, and JS served from `src/debug/`
- File whitelist for security (only allowed CSS/JS files)

## Testing

| Component       | Tests | Coverage                                                             |
| --------------- | ----- | -------------------------------------------------------------------- |
| Event Bus       | 5     | Zero overhead, pub/sub, timestamps, broadcast, unsubscribe           |
| State Collector | 8     | Init event, admin filtering, client management, dead client handling |
| Server          | 16    | SSE headers, dashboard serving, logs API, auth, graceful shutdown    |
| Log Buffer      | 12    | Ring buffer, search filters, stats, SSE emission                     |
| Snapshots       | 10    | Session, wizard, scheduler, poller snapshot accessors                |

Total: **51 tests** across 5 test files.

## Consequences

### Positive

- **Zero overhead when disabled**: Dynamic import ensures `src/debug/` never loads
- **Real-time visibility**: SSE streams provide live dashboard updates
- **Structured logging**: Ring buffer with search/filter capabilities
- **Privacy protection**: Admin-only event filtering
- **Zero dependencies**: Uses only Bun built-ins
- **Extensible foundation**: Session 2+ can build on event bus and state collector

### Negative

- **No full-text search**: Array.filter instead of indexed search (sufficient for debug volumes)
- **Memory usage**: Ring buffer holds 65K log entries in memory
- **No rate limiting**: SSE endpoint could be overwhelmed by many clients
- **Transpilation overhead**: Dashboard assets rebuilt on every server start

### Mitigations

- Configurable buffer size via `DEBUG_LOG_BUFFER_SIZE` env var
- Admin-only event filtering prevents data leakage
- Buffer capacity bounds memory usage
- Can add rate limiting in future if needed

## Environment Variables

| Variable                | Purpose               | Default     |
| ----------------------- | --------------------- | ----------- |
| `DEBUG_SERVER`          | Enable debug server   | `false`     |
| `DEBUG_PORT`            | Server port           | `9100`      |
| `DEBUG_HOSTNAME`        | Bind address          | `127.0.0.1` |
| `DEBUG_TOKEN`           | Auth token (optional) | `null`      |
| `DEBUG_LOG_BUFFER_SIZE` | Ring buffer capacity  | `65535`     |

## Related Decisions

- **ADR-0014: Multi-Chat Provider Abstraction** — Debug server is provider-agnostic
- **ADR-0016: Conversation Persistence** — Debug snapshots reuse persistence patterns

## Migration Notes

Non-destructive addition. No database migration needed. Debug server is opt-in via environment variable.

## References

- Design document: `docs/plans/2026-03-28-debug-session1-event-bus-server-skeleton.md`
- Implementation plan: `docs/plans/2026-03-28-debug-session1-implementation.md`
- Parent design: `docs/plans/2026-03-27-debug-tracing-tool-design.md`
- Session 2 (Log Pipeline): `docs/plans/2026-03-28-session2-pino-log-pipeline-design.md`
- Session 3 (Instrumentation): `docs/plans/2026-03-28-session3-instrument-source-modules-design.md`
- Session 4 (Dashboard): `docs/plans/2026-03-29-debug-session4-dashboard-html-design.md`
