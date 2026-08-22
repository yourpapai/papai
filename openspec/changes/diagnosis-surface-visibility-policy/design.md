<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Diagnosis surface visibility policy

## Context

See `proposal.md` for the defect list and motivation. Current mechanics that shape the fix:

- `authenticate(req)` (`src/dashboard-auth/index.ts:85`) already returns the session's `adminUserId`; `isAuthorizedRequest` in `src/debug/server.ts` discards it. Sessions are minted per bot admin, so the session principal is the correct per-request visibility principal.
- `state-collector.ts` keeps a module-global `adminVisibility` seeded once by `startDebugServer(adminUserId)`; `onEvent` drops events invisible to that one admin **before** turn/trace assembly, and `broadcast` ships everything that passed to every client. `llm:*` events are emitted with the **contextId** as scope userId (`emitLlmStart`/`emitLlmEnd`, `src/llm-orchestrator-events.ts`), so they never matched admin visibility anyway; the real platform user id rides in `data.chatUserId`. Turn events, by contrast, are correctly scoped (`emitScoped`, `src/message-queue/queue.ts:264`: `emitUser(type, userId, …)` / `emitGroup(...)`).
- Content-bearing log lines already carry attribution metadata: `logProcessMessage` (`src/llm-orchestrator-logging.ts:64-68`) logs `chatUserId` + `turnId` alongside `userText`. Most system lines carry only structural fields, so stripping unattributable entries is a no-op for them in practice.
- `LlmTrace` has no platform-user field (`userId` holds the contextId); `stepsDetail` carries step `text` and tool `args`/`result` (`state-collector-utils.ts:71`).
- ADR-0224 deliberately removed field redaction in favor of "access control + network boundary"; this change supersedes that posture, not that mechanism — no redactor returns.

## Goals / Non-Goals

**Goals:**

- One visibility rule, applied identically at every diagnosis-surface egress point, evaluated against the requesting session's admin.
- Fail-safe direction: when attribution is unknown, strip content, never widen.
- Keep aggregate/structural diagnostics (counts, timings, scopes, models) visible so the dashboard stays useful for cross-user health checks.

**Non-Goals:**

- No reintroduction of a field-redaction allowlist for own-scope content (ADR-0224's removal stands for visible scopes).
- No change to the auth layer, session minting, `DEBUG_SERVER` gating, or `/api/notify`.
- No persistence of visibility decisions; no audit log of dashboard reads.
- No populating `groupIds` — the empty-set semantics stay exactly as today.

## Decisions

### D1: Session principal threaded explicitly; module-global principal deleted

`routeRequest`'s auth step returns the `AuthenticatedRequest` instead of a boolean; `session.adminUserId` flows into `handleEvents` (as a new `addClient` argument), `handleLogs`, and `handleTurnLookup`. The SSE client registry value becomes `{ filter, adminUserId }`. `state-collector.ts` drops `adminUserId`/`adminVisibility` module state, `init()`, and the `isScopeVisibleToCurrentAdmin` closure; the pure `isVisibleToAdmin(scope, vis)` stays as the single check, always called with an explicit per-session `{ adminUserId: sessionAdmin, groupIds: EMPTY_SET }`. `startDebugServer` keeps its signature (the argument becomes unused for egress; remove the `init` call).

*Alternative:* re-initialize the module global per request — rejected: racy under concurrent sessions and wrong by construction for SSE streams held open across requests.

### D2: Assembly ungated, egress per-client

`onEvent` loses its visibility early-return: turn/trace assembly (and stats counting) always runs so buffers stay complete for every admin's `state:init`; the per-client check moves into `broadcast` (non-log events: `isVisibleToAdmin(event.scope, clientVis)` else skip — same rule the single gate applied, now per client). `state:stats` and scheduler/poller frames are global-scoped and pass everyone. Usage/analytics subscribers attach to the event bus directly and are unaffected either way.

### D3: Log attribution and the anonymity-safe shape

Attribution, in order: explicit `chatUserId` equal to the session admin → own; else `turnId` present and resolvable via `findTurnById` with the turn's scope visible to the session admin → own; else (foreign user, group-scoped, unattributable, or turn aged out of the buffers) → anonymity-safe shape. The shape is a pure helper in `src/debug/log-buffer.ts` (the existing module owning `LogEntry`; no new module): keep `level`, `time`, `msg`, `scope`, `turnId` plus any additional keys whose value is `number` or `boolean`; drop every other key (strings, objects, arrays). Used identically by `GET /logs` and the `log:entry` SSE path.

*Alternative:* drop invisible entries entirely — rejected: blinds structural/aggregate diagnostics and breaks paging counts; the anonymity contract exists precisely so cross-scope data can egress safely in aggregate shape.

**Filter ordering closes the `q` oracle:** `entryMatchesFilter` (including `q`, which flattens all fields) runs **after** shaping, on exactly what the session will receive — otherwise a text search over raw foreign entries would probe stripped content. `limit`/`before` apply last. `/logs/stats` `matchingCount` is computed over the same post-shaping corpus; the route stays counts/timestamps/scope-names only.

### D4: Trace visibility via a new `chatUserId` field

Emitting `llm:*` events with the real user as scope was considered and rejected: it changes event scopes consumed by the usage recorder and analytics subscriber and interacts with the gate being removed — a larger blast radius for zero spec benefit. Instead `buildEndTrace`/`buildErrorTrace` copy `str(event.data['chatUserId'])` into a new `LlmTrace.chatUserId` (`llm-trace-collector.ts` already owns trace construction — no new module). Attribution: `trace.chatUserId === sessionAdmin` → full; anything else (foreign, group sender, or missing — legacy shapes) → shaped. Shaping drops `generatedText`, `stepsDetail` (carries step `text` + tool `args`/`result`), and `toolCalls[].args`/`toolCalls[].result`, keeping toolName/timings/success/model/token counters. Applied at both egress points: the `llm:full` broadcast and the `state:init` `recentLlm` snapshot.

### D5: `state:init` built per connecting admin

`sessions`: `getSessionSnapshots(clientAdminId)`. `recentTurns`/`recentNotifications`/`recentToolFailures`: foreign entries **excluded** (consistent with the live per-client event gate; their payload is `event.data` verbatim, so shaping would be half-measure). `recentLlm`: included but content-shaped per D4 — the LLM panel's value is cross-user capacity/latency diagnosis. Scheduler/poller/message-cache/stats snapshots unchanged (global).

### D6: `/turns/:id` per session, 404 unchanged

Swap `isScopeVisibleToCurrentAdmin` for `isVisibleToAdmin(turn.scope, sessionVis)`; keep ADR-0223's 404-on-foreign (no existence oracle).

### D7: GET-only enforcement

Method guards in `routeProtectedPaths` for `/events`, `/logs`, `/logs/stats`, `/logs/scopes`, `/turns/*`, `/stats/global`, `/stats/subject/*` mirroring the existing `/mcp/status` pattern (`if (req.method === 'GET') … return 405`). The two `/admin/*` read routes already guard. Out of scope: `/recurring`, `/deferred`, `/memos`, `/identity`, `/billing/*` — not diagnosis-surface routes per the proposal.

### D8: No DB, no scope-model impact, no new dependencies, no new tool surface

Everything is in-memory egress filtering keyed by the per-session `adminUserId`; no migration, no persisted state (no storage-context/config-context/platform-instance keys introduced), no capability or `tool_prefs` surface changes (the diagnosis surface is HTTP, not an LLM tool). Stdlib-only shaping; no dependency justifications needed.

### D9: Docs

New ADR at the next free slot (0426+ at planning time): supersedes ADR-0224's "admin sees all users' content" consequence, retains its redaction-removal mechanics for visible scopes, notes ADR-0223 as extended to per-session. `docs/architecture/overview.md`'s anonymity-contract section gains the diagnosis-surface egress rule. Markdown only — not hook-gated.

### D10: TDD order and hook interactions

All edits are in `src/debug/**`, so every Write/Edit trips the TDD pipeline (test-first gate, then targeted companion run). Red→green order, one seam per cycle:

1. Shaping helper: extend `tests/debug/log-buffer.test.ts` (allowlist keeps structural + numeric/boolean, drops strings/objects; idempotent on already-safe entries) → implement in `log-buffer.ts`.
2. Per-session state: new per-session visibility tests + `tests/debug/state-collector.test.ts` / `sse-log-filter.test.ts` updates (admin-bound `addClient`; per-client `log:entry` shaping + filter-after-shape; `state:init` filtering; `llm:full` shaping via `chatUserId`) → edit `state-collector.ts` + `llm-trace-collector.ts`.
3. Routes: `tests/debug/logs-route-content.test.ts` gains the second-admin scenario (attributed own entries verbatim, foreign/unattributable stripped) — its current "unredacted" expectations must be re-attributed with `chatUserId` first; `tests/debug/server.test.ts` 405 matrix; `/turns/:id` per-session case → edit `server.ts`.
4. Guards stay green throughout: `admin-visibility.test.ts` (pure fn untouched), `scope-visibility.test.ts`, existing turns-404 tests.
5. `bun run test:affected` in the loop; full `bun run test` + `bun run check:full` (knip will catch the removed `isScopeVisibleToCurrentAdmin`/`init` exports' stale importers).

## Risks / Trade-offs

- [`msg` is treated as structural but is interpolable] → Residual risk accepted per the anonymity contract's field list; the logging mandate is metadata-first with static `msg`. Follow-up (out of scope): lint rule enforcing static `msg`.
- [Entries logged with user content but without `chatUserId`/`turnId` become anonymous for everyone, including the owner] → Fail-safe by design; observed content-bearing sites already attach both fields. Tasks include a sweep for content-bearing log sites missing attribution.
- [`q`/`turnId` filters no longer match stripped fields for foreign entries] → Intentional (oracle-closing); the admin's own entries are unaffected.
- [Per-client shaping cost on `/logs` (≤65535 entries) and per log broadcast] → Shallow copies of small objects, single-digit clients; ms-scale, negligible vs. current behavior.
- [Removing the `onEvent` gate makes buffers hold all users' content in memory] → Same sensitivity as the pre-gate ring buffer (already unredacted, in-memory, restart-wiped per ADR-0224); every reader of those buffers is now visibility-filtered.
- [`turnId` attribution fails when the turn rolled out of the 512-turn buffer] → Entry degrades to the anonymity-safe shape — fails toward less disclosure.

## Migration Plan

Pure code deploy with the ADR + overview doc update in the same commit; no migration, no config keys, no backfill. Single-admin deployments see no change for their own content (entries they could read remain readable once attributed; unattributable system entries are already content-free). Rollback: revert the commit; buffers are in-memory and no persistent state references the new behavior.

## Open Questions

- Whether `groupIds` should ever be populated for dashboard admins (making group content full-fidelity for member admins) — deferrable: the mechanism (`AdminVisibility.groupIds`) already supports it and the specs word visibility through that model, so populating it later changes no code shape decided here.
