# Design — Attach the log ring buffer at logger startup

## Context

`src/logger.ts` builds `logMultistream = pino.multistream([{ level: logLevel, stream: process.stdout }])` and hands it to `pino(...)`. The buffer adapter `logBufferStream` (`src/debug/log-buffer.ts:117`) is only wired in by `startDebugServer()` (`src/debug/server.ts:271`) via `logMultistream.add(...)`, and un-wired by `stopDebugServer()` through a `Reflect`-based splice into pino's internal `streams` array (`src/debug/server.ts:285-292`). Production never passes a `logLevel` override: `src/runtime/production-deps.ts:250` calls `startDebugServer(adminUserId, { debugEnabled, pluginProviderRuntimeDeps })`, so `resolveWebServerStartOptions` falls back to `getLogLevel()` (`src/debug/server-route-options.ts:49`) — the same value `logger.ts` captured at module evaluation. See proposal.md for why retention must not depend on the web server.

The buffer is pure in-process memory (a `LogRingBuffer`, capacity 65535 via `DEBUG_LOG_BUFFER_SIZE`); the `/logs`, `/logs/stats`, `/logs/scopes` routes and SSE `/events` read it. Import-graph fact needed by the approach: `src/debug/log-buffer.ts` imports only `./event-bus.js` (a leaf module) and `./log-filter-model.js`, whose import of `log-buffer.js` is `import type` and erased at runtime — so the new edge `logger.ts → debug/log-buffer.ts` introduces no runtime cycle.

## Goals / Non-Goals

**Goals:**

- One attach point: the buffer stream sits in the initial `pino.multistream([...])` array, populated for the whole process lifetime, with no mutation of the multistream afterwards.
- Delete the `Reflect`-based internal-state surgery in `stopDebugServer` (it reaches into pino's private `streams` array).
- Keep the HTTP surface byte-identical: same routes, same auth, same entry shapes; only completeness of buffered data changes.

**Non-Goals:**

- Removing `WebServerStartOptions.logLevel` / `resolved.logLevel` — they become inert for buffering; deleting them would churn `src/runtime/production-deps.ts`, `server-route-options.ts`, and test callers for no behavior gain (deliberately left alone, per proposal).
- Any change to capacity, env handling (`DEBUG_LOG_BUFFER_SIZE`), filtering, redaction, or SSE behavior.
- Dynamic attach/detach or a toggle for buffering.

## Decisions

### D1 — Attach via the initial multistream array, not a moved `.add()` call

Add `{ level: logLevel, stream: logBufferStream }` to the array literal in `src/logger.ts` alongside `process.stdout`.

- Alternative considered: keep `.add()` but call it immediately after `pino.multistream(...)` at module scope. Rejected — it preserves the mutation-based API that made the attach/detach lifecycle bug possible, for zero benefit. The declarative array states the stream set once; nothing can drift from it.
- Alternative considered: lazily attach on first logger call. Rejected — it reintroduces lifecycle state and misses the earliest logs, the exact class of gap this change fixes.
- Level is the module-load `logLevel` already computed in `logger.ts` — identical to what production resolved inside `startDebugServer` (see Context), so the buffered set is exactly what stdout sees.

No new dependency and no new module: `log-buffer.ts` already exists and is the established adapter; pino's multistream already supports initial arrays — that is how stdout is registered today.

### D2 — `stopDebugServer` loses stream responsibility entirely

`stopDebugServer()` only stops the HTTP server. Removing the splice block also removes the only code that depended on pino's internal `streams` representation. Restarting the server within a process (stop → start) previously re-added the stream via `.add()`; with permanent attachment that path is gone, which also eliminates the double-attach hazard if `startDebugServer` were called twice without a stop.

### D3 — Doc comments updated where they lie

Three comments describe the old lifecycle and must change with the code: the `@public` note on `logMultistream` (`src/logger.ts:19`), the `@public` note on `logBufferStream` (`src/debug/log-buffer.ts:116`, "attached via logMultistream.add()"), and the stale "captured from when the server started" comment in `tests/debug/server.test.ts:325`. The now-inert `logLevel` option gets a one-line note that it no longer affects the buffer, so future readers don't hunt for wiring that isn't there.

### D4 — Proof test: no-server buffering, in `tests/debug/log-buffer.test.ts`

Import the real `logger` from `../../src/logger.js`, emit one log with a unique message, never call `startDebugServer`, and poll `logBuffer.entries()` until the message appears; clear the buffer in cleanup. Rationale for the shape:

- Match by unique message, not entry count — post-change the real logger can buffer entries from module evaluation of anything the file imported, so count-based assertions would be order-sensitive.
- Poll (waitFor-style) instead of sleeping, per the tests/AGENTS.md no-timing-assertions rule. Pino's multistream dispatch to a plain-object stream is synchronous, so the poll succeeds on its first check and cannot flake — the loop is conformance with house style, not a timing crutch.
- Robust against the mock-reset preload: `tests/mock-reset.ts` captures the real `src/logger.js` exports at startup and `restoreOriginalModules()` re-installs those same object references each `beforeEach`, so the file's import binding always lands on the real logger/multistream pair that carries the buffer stream. The file itself must not call `mockLogger()`.

### D5 — Existing level test keeps passing unchanged

`tests/debug/server.test.ts:322` finds `logBufferStream` inside `logMultistream` and compares against `capturedLogLevel` (captured in `beforeAll`, passed to `startDebugServer`). Post-change the found level is the module-load value; the file never mutates `LOG_LEVEL` before `beforeAll`, so the two values coincide. Only the comment changes (D3).

### Cross-cutting impact (per repo rules)

- Capability / tool-prefs gating: none — no new tool, command, or LLM-visible surface; internal logging plumbing behind existing authenticated debug routes.
- Scope model: none — the ring buffer is process-global in-memory state, not keyed by storage context, config context, platform instance, or user; nothing is persisted.
- DB / migrations: none.
- Dependencies / modules: none added (D1); the only new import edge is `src/logger.ts → src/debug/log-buffer.ts`, acyclic at runtime (Context).

### Hook / TDD interactions

Edits to `src/logger.ts` and `src/debug/server.ts` pass through the Write/Edit hook pipeline; both have parallel covering suites (`tests/logger.test.ts`, `tests/debug/server.test.ts`), so only the advisory test-first nudge could ever fire. Test-first order of work:

1. Add the no-server test to `tests/debug/log-buffer.test.ts` — red on current code (stream attached only by `startDebugServer`). The tests/ import gate is satisfied: the file imports both `src/debug/log-buffer.js` and `src/logger.js`.
2. Edit `src/logger.ts` (initial-array attach + doc comment) — green.
3. Strip the `.add()` line, the splice block, and the now-unused `logMultistream`/`logBufferStream` imports from `src/debug/server.ts` (keep `getLogLevel`, `logger`, `logBuffer`).
4. Update the stale comments (D3) and run the targeted suites from the proposal's verification list; `bun check:full` (knip/lint/typecheck) catches any leftover unused import.

## Risks / Trade-offs

- [Always-on buffering raises baseline memory in every process that imports the logger] → bounded by the existing ring capacity (65535 entries, `DEBUG_LOG_BUFFER_SIZE` overridable); same trust domain as stdout — in-process only, never persisted.
- [Tests asserting exact buffer contents could see extra retained entries] → per-file worker isolation (`--isolate`); route suites seed entries with known values and filter on them (`seedLogBuffer`, `tests/debug/server.test.ts:96-114`); the new proof matches by unique message (D4). The one emptiness assertion (`log-buffer.test.ts:240-243`) is synchronous with no interleaving log call, so it stays exact.
- [Inert `logLevel` option misleads future readers] → one-line doc note (D3); removal explicitly a Non-Goal.
- [Mutation ratchet (`test:mutate:changed`) covers both touched src files; deleting the splice/`.add()` lines shifts the measured line set] → run it before merge; if the floor fails, inspect surviving mutants first — floors are monotonic and a genuine coverage hole needs a test, not a reseed.
- [Buffer level frozen at module load while `LOG_LEVEL` is env-only] → no change from today: the logger's own level is equally frozen at module evaluation; there is no runtime level mutation to desync from.

## Migration Plan

Code-only change; no DB, env, or config migration. Deploy with a normal release — from the first post-deploy start, `/logs` serves everything since process start even when the debug server never started. Rollback is reverting the commit, which restores the old attach-on-server-start behavior with no residual state to clean (the buffer is memory-only and dies with the process).
