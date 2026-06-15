<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Debug Observability Fixes — Design

**Date:** 2026-06-15
**Status:** Approved (pending written-spec review)
**Scope:** Engineer observability surface — `/debug` server (`src/debug/`) and client (`client/debug/`)

## Background

A review of the `/debug` server and UI surfaced eleven findings. The governing
privacy contract for this surface is: **the super admin sees only events for his
own context plus genuinely context-free system events.** Several findings are
violations of that contract; the rest are correctness/UX defects in the same
surface. This spec covers all eleven in one cohesive change.

Group-context visibility is intentionally disabled under the privacy contract and
is **not** changed here (see Out of Scope).

## Findings Covered

| ID  | Title                                                                   | Class       |
| --- | ----------------------------------------------------------------------- | ----------- |
| A   | `llm:tool_result` emitted `emitGlobal` → leaks foreign-context tool I/O | Privacy     |
| B   | `totalToolCalls` counts all contexts (inconsistent with other stats)    | Privacy     |
| #2  | LLM-trace `toolCalls` always empty; `userId` always blank               | Correctness |
| C   | `/debug` + `/logs` expose unredacted global log buffer                  | Privacy     |
| #3  | SSE `onEvent` subscription leak on enqueue-failure path                 | Correctness |
| #6  | No SSE heartbeat → proxies idle the stream out                          | Robustness  |
| #4  | Init vs live ordering mismatch (turns/notifications/toolFailures)       | UX          |
| #5  | `/turns/:id` 404s for in-flight turns                                   | UX          |
| #11 | Live turn `startedAt` uses browser clock → skew jump                    | UX          |
| #9  | Sign-in lands on `/admin` instead of the requested dashboard            | UX          |
| #10 | `/admin` surface reachable when `DEBUG_SERVER=false` is undocumented    | Docs        |

## Privacy Invariant (the spine of this change)

Every event reaching `onEvent` (`state-collector.ts`) must carry a `scope` that
`isVisibleToAdmin` can correctly evaluate. An event tied to a user context is
emitted `emitUser(contextId)`; only genuinely context-free system events use
`emitGlobal`. **The consumer filters; the source is honest about scope.**

## Section 1 — Event scoping (A, B, #2)

### A — `llm:tool_result` becomes user-scoped

`handleToolCallFinish` emits via `defaultDeps.emit = emitGlobal`
(`src/llm-orchestrator-support.ts:37,64,89`). Re-scope it to the context.

- Change the support deps emitter to a user-scoped shape `emit(type, userId, payload)`,
  with `defaultDeps.emit = emitUser`. Call sites already hold `contextId`.
- Effect: a tool result from another user's context now fails `isVisibleToAdmin`
  and never crosses the admin's wire.
- The DI seam used by tests is preserved (deps are still injectable).

### #2 — Unify the trace key on `scope.userId`

`handleLlmTraceEvent` (`src/debug/llm-trace-collector.ts:146`) reads
`event.data['userId']`, which is `''` for `llm:start`/`llm:end` (those set only
`scope.userId`) and the real id for `llm:tool_result` — so they never join.

- Widen the collector's `TraceEvent` type to include `scope` (already present on
  the `DebugEvent` that `onEvent` passes through).
- Key `pendingTraces` on `scope.userId` for all four event types
  (`llm:start`/`llm:tool_result`/`llm:end`/`llm:error`).
- Source `LlmTrace.userId` from `scope.userId`.

Because A makes `llm:tool_result` `emitUser(contextId)`, its `scope.userId ===
contextId` matches start/end. Results: `pending.toolCalls` accumulate (TraceDetail
"Tool Calls" renders), `LlmTrace.userId` is populated, and concurrent contexts no
longer collide on the `''` key. The now-unused `userId` field may be dropped from
the `llm:tool_result` payload.

### B — Falls out of A

Once `llm:tool_result` is `emitUser`, `totalToolCalls++`
(`llm-trace-collector.ts:158-159`) only runs for admin-visible (own-context)
results, consistent with `totalLlmCalls`/`totalMessages`. No separate code change;
covered by a regression test.

**Files:** `src/llm-orchestrator-support.ts`, `src/debug/llm-trace-collector.ts`,
`src/debug/state-collector.ts`.

## Section 2 — Log redaction (C)

Centralized read-time redactor at egress (the in-memory ring buffer stays
truthful; nothing is served raw).

### New module: `src/debug/log-redaction.ts`

A single pure function, the source of truth for the policy:

```
redactLogEntry(entry: LogEntry): LogEntry
```

**Default-deny on structured fields.** Allowlist (everything else dropped):
`level`, `time`, `scope`, `turnId`, plus non-identifying operational metadata:
`durationMs`, `messageLength`, `stepCount`, `toolCount`, `messageCount`, `count`,
`size`, `capacity`, `tickCount`, `statusCode`, `ok`, `success`, `finishReason`,
`errorType`, `errorCode`, `toolName`.

**`msg` is template-gated.** Shown verbatim only if it exactly matches a curated
`SAFE_MSG_TEMPLATES` set of known content-free static strings (e.g. `"Message
received from user"`, `"Tool execution failed"`); otherwise `'[redacted]'`.

**Dropped by virtue of not being allowlisted:** `userText`, `content`,
`chatUserId`, `contextId`, `userId`, `summary`, `facts`, `args`, `result`, `url`,
free-text `error`, and any field not explicitly listed.

#### Two judgment calls (review points)

1. **`toolName`, `errorType`, `errorCode` are kept as de-identified signal.** With
   identifying fields stripped, the admin sees _"some context ran delete_task / hit
   RATE_LIMIT"_ but never _whose_. Dropping these too is a one-line allowlist edit
   if preferred.
2. **Free-text `error` is dropped** (it can embed user/content data). The admin
   loses raw error strings in the global log panel but still sees full errors for
   **their own** context via the already-scope-filtered trace and tool-failure
   surfaces, and retains `errorType`/`errorCode` in logs.

### Application — egress only

- `/logs` REST: `handleLogs` maps `logBuffer.search(...)` through `redactLogEntry`
  before `jsonResponse` (`src/debug/server.ts:98`).
- `log:entry` SSE: the emit fires inside `LogRingBuffer.push` via `emitGlobal`
  (`src/debug/log-buffer.ts:60`); redact the payload at that emit boundary while
  the buffer keeps the full entry in memory.
- `/logs/stats` returns only counts/timestamps — no redaction needed.

**Files:** new `src/debug/log-redaction.ts`; `src/debug/log-buffer.ts`;
`src/debug/server.ts`.

## Section 3 — SSE lifecycle + client fixes (#3, #6, #4, #5, #11)

### #3 — Subscription leak

`broadcast()` and `sendTo()` do a bare `clients.delete(client)` in their catch
(`src/debug/state-collector.ts:120,131`), bypassing the `clients.size === 0 →
unsubscribe(onEvent)` check that only `removeClient` performs. Fix: both catch
paths call `removeClient(client)`. A client dying via enqueue-failure then
correctly tears down the `onEvent` subscription when it is the last one, returning
`emitUser`/`emitGlobal` to their no-op fast path.

### #6 — Heartbeat

A single module-level interval in `state-collector.ts`, tied to the existing
client lifecycle: started when `clients` goes 0→1 (alongside `subscribe(onEvent)`),
cleared when it returns to 0 (alongside `unsubscribe`). Every 15s it enqueues an
SSE comment line (`': ping\n\n'`) to all clients through the same guarded broadcast
(a dead client during ping also routes through `removeClient`). `handleEvents`
emits a `retry:` hint on connect. Comments are ignored by `EventSource`; no client
handler changes.

### #4 — Init vs live ordering

Live handlers prepend (`unshift`, newest-first); `state:init` maps server buffers
as-is (oldest-first) for turns/notifications/toolFailures, while only `llmTraces`
is `.reverse()`d (`client/debug/handlers.ts:57-71`). Fix: `.reverse()` the other
three on init so the historical block matches the newest-first live convention.

### #5 — In-flight turn lookup

`findTurnById` searches only `recentTurns` (`src/debug/turn-assembly.ts:87`). Fix:
check `inFlightTurns` first, then `recentTurns`, so `/turns/:id` resolves a running
turn instead of 404ing.

### #11 — Client-clock turn start

Live `handleTurnStart` stamps `startedAt: Date.now()` (browser clock,
`client/debug/handlers.ts:153`), which jumps when the server-stamped `turn:summary`
replaces it. Fix: include a server `startedAt` in the `turn:start` event data
payload; the client uses it, falling back to `Date.now()` only if absent (since
`unwrapEnvelope` strips the envelope timestamp).

**Files:** `src/debug/state-collector.ts` (#3, #6), `src/debug/server.ts` (#6 retry
hint), `client/debug/handlers.ts` (#4, #5 consumer, #11), `src/debug/turn-assembly.ts`
(#5, `startedAt` in `turn:start` payload), and the `turn:start` emit site.

## Section 4 — Auth redirect + docs (#9, #10)

### #9 — Sign-in redirect

`handleAuthClaimConfirm` 302s to `/admin` (`src/debug/auth-routes.ts:103`); the
entry point is the `/dashboard` DM. Change the redirect target to `/debug` so
sign-in lands on the dashboard; `/admin` remains one nav click away.

### #10 — Documentation only (no behavior change)

The operator surfaces (`/admin`, `/billing`, `/stats`, instance routes) remain
session-gated but available when `DEBUG_SERVER=false` — correct, because operators
must manage LLM creds/instances in production where the live-observability firehose
is off. Document the boundary: `DEBUG_ONLY_PATHS` (the engineer live-observability
subset) is what `debugEnabled` gates; the operator/admin surface is gated by the
session cookie alone. Add to `CLAUDE.md` (Debug/settings server surfaces) and
`docs/deployment/dashboard-access.md`.

## Testing Strategy

Per the repo TDD hook (Red→Green→Refactor); server suites via `bun run test`,
client via `bun test:client`.

- **A/B/#2** — `handleLlmTraceEvent` unit tests: own-context start+tool_result+end
  accumulates `toolCalls` and sets `userId`; a foreign-context (different
  `scope.userId`) tool_result is filtered by `isVisibleToAdmin` and increments
  neither `totalToolCalls` nor the stream; concurrent two-context interleaving
  keeps traces separate.
- **C** — `redactLogEntry` table tests (each sensitive field dropped; allowlisted
  fields kept; `msg` in/out of `SAFE_MSG_TEMPLATES`); guard test asserting both
  egress points (`/logs` response, `log:entry` payload) emit no key outside the
  allowlist; buffer retains the full entry.
- **#3** — last client dying via enqueue-failure unsubscribes `onEvent`
  (assert `listeners.size === 0`).
- **#6** — heartbeat interval starts on first client / clears on last; ping routes
  dead clients through `removeClient`.
- **#4/#5/#11** — client tests (happy-dom): init ordering matches live;
  `findTurnById` resolves in-flight; live `startedAt` uses the server value.
- **#9** — route test: POST `/auth/claim` 302 → `/debug`.

## Out of Scope

- **Group-context visibility** stays disabled (intended privacy). The vestigial
  `groupIds` machinery in `state-collector.ts` is left in place as the documented
  future per-group opt-in hook, not removed here.
- **#7 redundant `turn:end` + `turn:summary` double-broadcast** — harmless,
  left as-is.

## Risk Notes

- The redaction allowlist is intentionally conservative; a missed safe field is a
  usability cost, not a leak (default-deny). Extending the allowlist or
  `SAFE_MSG_TEMPLATES` is a low-risk follow-up.
- Re-scoping `llm:tool_result` to `emitUser` changes which events reach the client;
  the client has no `llm:tool_result` handler today, so there is no UI regression,
  only the intended reduction in cross-context data on the wire.
