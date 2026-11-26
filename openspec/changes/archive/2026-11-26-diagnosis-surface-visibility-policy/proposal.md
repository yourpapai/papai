# Diagnosis surface visibility policy (issue #308)

## Goal

Close the cross-user content leak on the diagnosis surface (the debug dashboard's logs and LLM traces, served by `src/debug/server.ts` + SSE `state-collector`). Today raw logs/traces expose other users' message content to any dashboard session. The surface must reuse the existing admin-visibility scope model, honor the `/stats/*` anonymity rules for anything aggregate/cross-scope, and remain strictly read-only. This supersedes ADR-0224's deliberate "admin sees all users' content" posture.

## Defects found (current state)

1. **`GET /logs`** (`src/debug/server.ts:103` `handleLogs`) returns the raw in-memory ring buffer (`logBuffer.search`) with **no visibility filtering** — buffered pino lines can carry other users' content (`userText`, message/debug payloads).
2. **`log:entry` SSE** — `LogRingBuffer.push` (`src/debug/log-buffer.ts:59`) emits with `emitGlobal`, so the `isVisibleToAdmin` gate (`src/debug/state-collector.ts:156`) passes **every** log entry to **every** connected client.
3. **Visibility binds to the wrong principal** — `adminVisibility` is module state initialized once from `startDebugServer(adminUserId)` (the single primary admin), but dashboard sessions are minted per bot admin via `/dashboard` (`src/commands/dashboard.ts`, DM-only + bot-admin-only; `mintSession(adminUserId)`). A second bot admin's session is filtered against the first admin's identity. `state:init` (`state-collector.ts:102-119`) ships `recentLlm` (traces contain `generatedText` + full tool `args`/`result`), `recentTurns`, `recentNotifications`, `recentToolFailures` under that same wrong-principal gate.
4. `/turns/:id` already enforces the correct model (`isScopeVisibleToCurrentAdmin`, 404 for foreign turns — `src/debug/server.ts:142-154`); `/logs/stats` + `/logs/scopes` are already aggregate-only shapes.

## Chosen approach (assumption stated)

Implement the **admin-visibility scope model** option (the issue's primary choice). The "bot-admin-DM-only" alternative is already true at the auth layer — every session is bot-admin-minted — so it cannot by itself stop one bot admin from reading another admin's users' content; the visibility model is the substantive fix. Per the `/stats/*` anonymity contract (`docs/architecture/overview.md` § Anonymity contract), log entries that are **not attributable to the requesting admin's own/global scope** may only egress in an anonymous, aggregate-safe shape: structural fields (`level`, `time`, `msg`, `scope`, `turnId`) and numeric/enum fields; free-form content fields are stripped at egress. Full raw content is returned only for entries attributable to the session admin's own scopes.

## Behaviour change

- Visibility is evaluated **per authenticated session**: thread `authenticate(req).adminUserId` (already returned by `src/dashboard-auth/index.ts:85`) into the SSE client registry (`addClient`) and the REST handlers, replacing reliance on the process-global single-admin `adminVisibility` for egress decisions (keep `groupIds`-empty semantics unchanged).
- `GET /logs`: filter results through the per-session visibility model — entries attributable (via an explicit `userId`/`groupId` field when present, or via `turnId` join against visibility-checked turns) to the session admin's scopes pass in full; unattributable/foreign entries egress in the anonymity-safe shape (content fields stripped); counts remain aggregate.
- `log:entry` SSE: apply the identical per-client filter at egress (per-client check inside `broadcast`, like the existing log-filter check at `state-collector.ts:173`).
- `state:init`: filter `recentLlm` by `trace.userId` against the session admin's visibility (foreign traces' `generatedText`/tool args/results never sent); apply the same to `recentTurns`/`recentNotifications`/`recentToolFailures` for the session admin.
- `/logs/stats` and `/logs/scopes` stay aggregate-only; verify no free-form content can appear.
- **Strictly read-only:** every diagnosis-surface route (`/logs*`, `/events`, `/turns/*`, `/stats/*`, `/admin/*` read panels) accepts GET only — non-GET returns 405. No mutating handler may be introduced by this change.

## Files to touch

- `src/debug/server.ts` — thread session admin into `handleEvents`/`handleLogs`; 405 guards.
- `src/debug/state-collector.ts` — per-client admin binding; visibility-filtered `state:init` buffers.
- `src/debug/log-buffer.ts` — anonymity-safe egress shaping for unattributable/foreign entries (shared helper, used by both egress points).
- `src/debug/llm-trace-collector.ts` — only if `recentLlm` filtering needs a seam here.
- `tests/debug/` — extend `logs-route-content.test.ts`, `log-buffer.test.ts`, `server.test.ts`; new per-session visibility + 405 tests.
- `docs/adr/` — new ADR superseding ADR-0224's posture; update `docs/architecture/overview.md` (anonymity contract extends to the diagnosis surface).

## Verification

TDD, failing-first:
1. A buffered entry carrying a foreign user's `userText` does **not** appear (content-stripped) in `GET /logs` nor on the `log:entry` SSE stream for a different admin's session; the session admin's own entries pass verbatim.
2. `state:init.recentLlm` excludes foreign traces' `generatedText`/tool args for a non-matching admin session.
3. `/logs/stats`, `/logs/scopes` responses contain no free-form content fields.
4. Every diagnosis-surface route returns 405 for POST/PUT/DELETE.
5. Existing guards keep passing: `tests/debug/admin-visibility.test.ts`, `tests/debug/scope-visibility.test.ts`, `/turns/:id` 404-on-foreign-turn tests.
6. Full gates: `bun run test`, then `bun run check:full`.
