<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0038: Debug Tracing Tool — Session 2: Pino Log Pipeline

## Status

Accepted

## Context

Session 1 (ADR-0037) established the debug infrastructure with an event bus, state collector, and HTTP server skeleton using Bun.serve(). The original design planned to use pinorama-server (Fastify-based) for log aggregation and search, but this approach had critical incompatibilities:

1. **pinorama-server requires Fastify** — adding Fastify as a dependency for debug-only functionality contradicts the "zero new dependencies" principle
2. **pinorama-transport uses thread-stream** — incompatible with Bun runtime (Worker Threads via thread-stream are broken on Bun)
3. **Overkill for debug volumes** — full-text search indexing is unnecessary for debug tool log volumes (hundreds to thousands of entries)

We needed an alternative that:

- Uses only built-in pino capabilities (multistream)
- Works synchronously on the main thread (Bun-compatible)
- Provides sufficient search/filter capabilities for debugging
- Maintains zero overhead when debug server is disabled

## Decision Drivers

- **Zero new dependencies**: Use only pino's built-in multistream
- **Bun compatibility**: Must work on Bun runtime without Worker Threads
- **Dynamic attachment**: Log buffering only when debug server is running
- **REST API**: Replace pinorama-client with simple HTTP endpoints
- **Live tailing**: SSE integration for real-time log streaming

## Considered Options

### Option 1: pinorama-server with Fastify

Use pinorama-server (Fastify plugin with Orama full-text search) as originally designed.

- **Pros**: Built-in full-text search, mature indexing, Orama performance
- **Cons**: Requires Fastify dependency, thread-stream broken on Bun, adds 3+ dependencies
- **Verdict**: Rejected — incompatible with Bun, violates zero-dependency constraint

### Option 2: In-memory ring buffer with pino multistream (Accepted)

Implement a custom `LogRingBuffer` class that attaches to pino via `pino.multistream()`.

- **Pros**: Zero new dependencies, Bun-native, synchronous, sufficient for debug volumes
- **Cons**: No full-text indexing (Array.filter only), memory-bound storage
- **Verdict**: Accepted — best balance of simplicity and capability

### Option 3: File-based log storage

Write logs to rotating files and serve via HTTP with on-demand parsing.

- **Pros**: Persistent across restarts, no memory limit
- **Cons**: I/O overhead, file management complexity, slower search
- **Verdict**: Rejected — unnecessary complexity for debug tool

## Decision

Implement a **Pino Log Pipeline** using pino multistream with an in-memory ring buffer:

### 1. Logger Multistream (`src/logger.ts`)

Always initialize pino with multistream (stdout only by default):

```typescript
export const logMultistream = pino.multistream([{ stream: process.stdout }])

export const logger = pino(
  {
    level: getLogLevel(),
    timestamp: pino.stdTimeFunctions.isoTime,
    base: undefined,
  },
  logMultistream,
)
```

Key properties:

- **Always multistream**: Single code path, no conditional initialization
- **Exportable reference**: `logMultistream` exported for dynamic stream attachment
- **Minimal overhead**: Nanoseconds per log call (measured, acceptable)

### 2. Log Ring Buffer (`src/debug/log-buffer.ts`)

Circular buffer with configurable capacity:

```typescript
export class LogRingBuffer {
  private buffer: LogEntry[] = []
  private head = 0
  readonly capacity: number

  push(entry: LogEntry): void {
    if (this.buffer.length < this.capacity) {
      this.buffer.push(entry)
    } else {
      this.buffer[this.head] = entry
      this.head = (this.head + 1) % this.capacity
    }
    emit('log:entry', entry as Record<string, unknown>)
  }
}
```

Key properties:

- **Circular overwrite**: Fixed memory bound (default 65,535 entries)
- **Search/filter**: Level (minimum), scope (exact), text (substring), limit
- **SSE emission**: Every push emits `log:entry` event on event bus
- **Type guard validation**: `isLogEntry()` validates parsed JSON before buffering

### 3. Stream Adapter (`src/debug/log-buffer.ts`)

Pino destination stream implementation:

```typescript
export const logBufferStream = {
  write(chunk: string): void {
    try {
      const parsed: unknown = JSON.parse(chunk)
      if (isLogEntry(parsed)) {
        logBuffer.push(parsed)
      }
    } catch {
      // Skip malformed lines
    }
  },
}
```

Key properties:

- **Implements pino DestinationStream**: `.write(chunk: string)` interface
- **Defensive parsing**: Silently skips malformed JSON
- **Attached dynamically**: `logMultistream.add({ stream: logBufferStream })` on server start

### 4. HTTP Routes (`src/debug/server.ts`)

REST endpoints for log access:

```typescript
if (url.pathname === '/logs') {
  const results = logBuffer.search({
    level: parseIntParam(url.searchParams.get('level')),
    scope: url.searchParams.get('scope') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    limit: parseIntParam(url.searchParams.get('limit')),
  })
  return new Response(JSON.stringify(results), {
    headers: { 'Content-Type': 'application/json' },
  })
}

if (url.pathname === '/logs/stats') {
  return new Response(JSON.stringify(logBuffer.stats()), {
    headers: { 'Content-Type': 'application/json' },
  })
}
```

Key properties:

- **GET /logs**: Returns filtered log entries as JSON array
- **GET /logs/stats**: Returns buffer metadata (count, capacity, oldest, newest)
- **Query parameters**: level, scope, q (search), limit
- **Chronological order**: Results sorted by time

## Testing

| Component       | Tests | Coverage                                                                                      |
| --------------- | ----- | --------------------------------------------------------------------------------------------- |
| Log Ring Buffer | 5     | Push, entries, wrap-around, multiple wraps, clear                                             |
| Search          | 7     | Level filter, scope filter, text search, combined filters, limit, default limit, empty buffer |
| Stats           | 3     | Empty buffer, normal operation, wrap-around                                                   |
| Stream Adapter  | 2     | JSON parsing, malformed handling                                                              |
| SSE Emission    | 1     | Event bus integration                                                                         |
| Server Routes   | 6     | /logs, filters, /logs/stats integration                                                       |

Total: **24 tests** added for Session 2.

## Consequences

### Positive

- **Zero new dependencies**: Uses only pino built-ins
- **Bun compatible**: Synchronous, main-thread execution
- **Dynamic attachment**: No overhead when debug server disabled
- **REST API**: Simple HTTP endpoints replace complex pinorama-client
- **Live tailing**: SSE via existing event bus infrastructure
- **Bounded memory**: Fixed capacity prevents unbounded growth
- **Type safety**: `isLogEntry()` type guard validates all entries

### Negative

- **No full-text indexing**: O(n) search via Array.filter
- **No persistence**: Logs lost on server restart
- **No advanced queries**: No regex, no range queries beyond level
- **Memory usage**: 65K entries × ~500 bytes ≈ 32MB max

### Mitigations

- Search performance acceptable for debug volumes (<1000 entries typical)
- Buffer capacity configurable via `DEBUG_LOG_BUFFER_SIZE`
- Session 4 dashboard will implement client-side filtering for complex queries

## Environment Variables

| Variable                | Purpose              | Default |
| ----------------------- | -------------------- | ------- |
| `DEBUG_LOG_BUFFER_SIZE` | Ring buffer capacity | `65535` |

## Related Decisions

- **ADR-0037: Debug Tracing Tool — Session 1** — Foundation event bus and server
- **ADR-0014: Multi-Chat Provider Abstraction** — Debug server is provider-agnostic
- **ADR-0016: Conversation Persistence** — Log buffer complements persistence layer

## API Examples

```bash
# Get last 100 logs
curl http://localhost:9100/logs

# Filter by minimum level (warn and above)
curl 'http://localhost:9100/logs?level=40'

# Filter by scope
curl 'http://localhost:9100/logs?scope=llm-orch'

# Text search (case-insensitive)
curl 'http://localhost:9100/logs?q=generateText'

# Combined filters
curl 'http://localhost:9100/logs?level=30&scope=main&q=start&limit=50'

# Buffer statistics
curl http://localhost:9100/logs/stats
# → { "count": 847, "capacity": 65535, "oldest": "2026-03-28T...", "newest": "2026-03-28T..." }
```

## Migration Notes

Non-destructive addition. No breaking changes:

- `logger.ts` now uses multistream (transparent to all callers)
- Debug server routes added to existing `Bun.serve()`
- Opt-in via `DEBUG_SERVER=true` environment variable

## References

- Design document: `docs/plans/done/2026-03-28-session2-pino-log-pipeline-design.md`
- Implementation plan: `docs/plans/done/2026-03-28-session2-pino-log-pipeline-implementation.md`
- Parent design: `docs/plans/done/2026-03-27-debug-tracing-tool-design.md`
- Session 1 ADR: `docs/adr/0037-debug-server-session1.md`
- pino multistream documentation: https://github.com/pinojs/pino/blob/main/docs/api.md#pino-multistream
