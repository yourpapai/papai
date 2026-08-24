# Attach the log ring buffer at logger startup

## Goal

`logBuffer` must populate from process start regardless of whether the debug/settings web server ever starts. Today `logBufferStream` is only attached inside `startDebugServer()` (src/debug/server.ts:271) and detached by `stopDebugServer()` (src/debug/server.ts:285-292), so if the web server never starts the buffer stays empty forever. Attach the stream when the logger is created instead; `stopDebugServer` stops being responsible for it.

## Capabilities

None — skip_specs proposed because this is a fix restoring the intended behavior of the existing `/logs` debug surface: the HTTP contract is unchanged, only the completeness of the buffered data (logs emitted before server start, or with no server at all, are now retained).

## Files to touch

1. `src/logger.ts` — add `logBufferStream` (imported from `./debug/log-buffer.js`) to the initial `pino.multistream([...])` array with `level: logLevel`, alongside `process.stdout`. No circular import: `log-buffer.ts` only imports `event-bus.js` (imports nothing) and `log-filter-model.js` (type-only import from log-buffer). Update the stale `@public -- debug server calls .add()...` doc comment on `logMultistream`.
2. `src/debug/server.ts` — delete `logMultistream.add({ stream: logBufferStream, level: resolved.logLevel })` from `startDebugServer()` and the Reflect-based `streams` splice block from `stopDebugServer()`; remove the now-unused `logMultistream` and `logBufferStream` imports (keep `getLogLevel`, `logger`, `logBuffer`). Deliberately leave `WebServerStartOptions.logLevel` / `resolveWebServerStartOptions` untouched: the option becomes inert for the buffer, and removing it would churn `src/runtime/production-deps.ts` and several test callers for no behavior gain.
3. `tests/debug/server.test.ts` — the existing test at line 322 ('buffer stream is registered with level matching LOG_LEVEL') keeps passing (module-load attach uses the same `getLogLevel()` value); update its stale comment about 'when the server started' to reflect module-load attachment.
4. `tests/debug/log-buffer.test.ts` — add the no-server proof the issue asks for: import `logger` from `../../src/logger.js`, emit a log with a unique message without ever calling `startDebugServer`, and assert the entry appears in `logBuffer.entries()`. Poll (waitFor-style) rather than sleeping, per tests/AGENTS.md no-timing-assertions rule; clear the buffer in cleanup.

## Intended behavior change

- The ring buffer is attached for the process lifetime at logger module evaluation; every pino write flows into it even when no web server ever starts.
- Logs emitted before `startDebugServer()` are retained and served by `/logs`, `/logs/stats`, `/logs/scopes` once a server starts.
- `stopDebugServer()` only stops the HTTP server; it no longer detaches the buffer stream.
- Buffer stream level follows the logger's own `LOG_LEVEL` (same value production used: `startDebugServer` was called without a `logLevel` override in `src/runtime/production-deps.ts:250`).

## Verification

- Targeted: `bun test tests/debug/log-buffer.test.ts tests/debug/server.test.ts tests/debug/billing-route.test.ts tests/debug/server-stats.test.ts tests/debug/logs-route-content.test.ts tests/debug/debug-smoke.test.ts` (all existing suites that exercise start/stop and the /logs routes).
- New test proves the issue's acceptance criterion: buffer populates with no server running.
- In the edit loop use `bun run test:affected`; finish with one full `bun run test` plus `bun check:full` (knip/lint/typecheck will catch any leftover unused import in server.ts). CI's `test:mutate:changed` ratchet covers `src/logger.ts` and `src/debug/server.ts`.
