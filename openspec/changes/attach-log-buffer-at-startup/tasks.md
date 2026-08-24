## 1. Red test — no-server buffering proof

- [x] 1.1 Add a test to `tests/debug/log-buffer.test.ts` that imports the real `logger` from `../../src/logger.js`, emits one log with a unique message without ever calling `startDebugServer`, polls `logBuffer.entries()` (waitFor-style, no sleep) until the message appears, and clears the buffer in cleanup. Do not call `mockLogger()` in this file. Verify it fails on current code: `bun test tests/debug/log-buffer.test.ts`

## 2. Attach the buffer at logger creation

- [x] 2.1 In `src/logger.ts`, add `{ level: logLevel, stream: logBufferStream }` (imported from `./debug/log-buffer.js`) to the initial `pino.multistream([...])` array alongside `process.stdout`; update the stale `@public -- debug server calls .add()...` doc comment on `logMultistream`. Verify green: `bun test tests/debug/log-buffer.test.ts tests/logger.test.ts`

## 3. Remove server-side stream wiring

- [x] 3.1 In `src/debug/server.ts`, delete `logMultistream.add({ stream: logBufferStream, level: resolved.logLevel })` from `startDebugServer()` and the Reflect-based `streams` splice block from `stopDebugServer()`; remove the now-unused `logMultistream` and `logBufferStream` imports (keep `getLogLevel`, `logger`, `logBuffer`). Add a one-line note on the now-inert `logLevel` option that it no longer affects the buffer. Verify: `bun test tests/debug/server.test.ts && bun run typecheck`

## 4. Comment and doc touch-ups

- [x] 4.1 Update the stale `@public -- ... attached via logMultistream.add()` comment on `logBufferStream` in `src/debug/log-buffer.ts` and the "captured from when the server started" comment at `tests/debug/server.test.ts:325` to reflect module-load attachment. Verify the level test still passes: `bun test tests/debug/server.test.ts`

## 5. Targeted regression suites

- [x] 5.1 Run every existing suite that exercises start/stop and the /logs routes: `bun test tests/debug/log-buffer.test.ts tests/debug/server.test.ts tests/debug/billing-route.test.ts tests/debug/server-stats.test.ts tests/debug/logs-route-content.test.ts tests/debug/debug-smoke.test.ts`

## 6. Full verification and docs

- [x] 6.1 Run one full suite plus the complete check pipeline: `bun run test && bun check:full`. Review `docs/architecture/behaviors.md` and `docs/architecture/overview.md` for any statement tying the log buffer's population to debug-server startup, and update if stale. CI's `test:mutate:changed` ratchet covers `src/logger.ts` and `src/debug/server.ts` — confirm it passes on the branch.
