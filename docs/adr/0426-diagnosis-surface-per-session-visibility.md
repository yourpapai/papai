<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0426: Diagnosis Surface Per-Session Visibility

## Status

Accepted

## Date

2026-08-20

## Context

ADR-0224 removed debug-log redaction and knowingly accepted that "admin sees all users'
content": anyone holding a dashboard session cookie read every user's raw messages, tool
args, and generated text across the whole diagnosis surface. That posture was documented as
suitable for a single fully-trusted operator, but the surface it governs has since grown to
serve several named admins (`/dashboard` mints per-user sessions), and the log buffer plus
LLM trace buffer aggregate content from **all** users of the process into a single
in-memory store. Two egress paths made that a cross-tenant read: `GET /logs`
(`logBuffer.search` with no visibility filtering) and the `state:init` SSE snapshot (which
sent the full `recentLlm` / `recentTurns` / `recentNotifications` / `recentToolFailures`
buffers to whichever session connected). ADR-0223's `/turns/:id` enforcement was likewise
bound to the *process's* admin, not the requesting session's.

## Decision

The diagnosis surface moves from "one trusted admin sees all" to **per-session
visibility**: every egress point answers to the admin identity of the requesting session,
not to a process-global one.

1. **Log entries.** Each entry is attributed via `chatUserId` (explicit) or `turnId`
   (resolved through `findTurnById` to a turn whose scope is visible to that admin). Own
   entries egress verbatim; every other entry — foreign or unattributable — is reduced to
   the anonymity-safe shape (`level`, `time`, `msg`, optional `scope`/`turnId`, plus
   additional keys whose values are numbers or booleans). Connection filters, including
   `q`, run **after** shaping, so search can only ever match post-shaping content;
   `/logs/stats` `matchingCount` is computed over post-shaping entries as well.
2. **LLM traces.** `llm:end`/`llm:error` carry `data.chatUserId` onto the trace. A trace
   attributed to the viewing session's admin passes verbatim (including `generatedText`,
   `stepsDetail`, and tool-call `args`/`result`); any other trace keeps only metadata
   (tool names, durations, success flags, model ids, token/step counters). This applies to
   live `llm:full` SSE frames and to `recentLlm` inside `state:init`.
3. **Per-session `state:init`.** The snapshot is built per connecting admin:
   `getSessionSnapshots(clientAdminId)`, foreign `recentTurns` / `recentNotifications` /
   `recentToolFailures` excluded, `recentLlm` included but shaped. Shared surfaces
   (scheduler, pollers, messageCache, stats) are unchanged.
4. **No process-global visibility state.** `state-collector.ts` loses `init()`,
   `adminUserId`/`adminVisibility` module state, and `isScopeVisibleToCurrentAdmin`;
   `addClient(controller, filter, adminUserId)` binds the session admin per connection,
   and `onEvent` always assembles (so buffers stay complete for whoever is later
   authorized) with per-client gating at broadcast time.
5. **`/turns/:id` becomes per-session.** `handleTurnLookup` checks
   `isVisibleToAdmin(turn.scope, sessionVisibility)` for the *requesting session's* admin;
   404 semantics (never 403) are unchanged from ADR-0223.
6. **Read-only routes.** `/events`, `/logs`, `/logs/stats`, `/logs/scopes`, `/turns/*`,
   `/stats/global`, `/stats/subject/*` answer GET only; other methods get 405.
7. **Fail-safe attribution.** Log sites that carry user-controlled content attach
   `chatUserId`/`turnId` when derivable; content that cannot be attributed strips for
   everyone — including its author.

This **supersedes ADR-0224's** "admin sees all users' content" posture. ADR-0224's
redaction *removal* is retained for entries a session is authorized to see: visible-scope
content still egresses unredacted, because visibility — not field filtering — is the gate.
ADR-0223's `/turns/:id` enforcement stands, now keyed to the requesting session rather than
the process.

## Consequences

### Positive

- A second admin can be granted a dashboard session without receiving every other user's
  messages, tool arguments, and model outputs.
- The same attribution rule governs REST and SSE egress, so the two cannot drift apart.
- Unattributable content fails closed (strips for everyone), so adding a new log site
  cannot silently widen exposure; the §3.3 sweep attaches attribution where derivable.
- Read-only enforcement removes any doubt about mutation surface on diagnosis routes.

### Negative / Risks

- Log entries lose rich string metadata (`userText`, previews, object payloads) for anyone
  but the attributed admin; diagnosing *another* user's issue via the dashboard now shows
  structure (levels, counts, flags) rather than content. This is the intended trade.
- `state-collector` buffers now hold foreign content in memory that most connected
  sessions cannot see; a future egress point must repeat the per-client gate, not assume
  the buffer is pre-filtered.
- Log sites that want their content visible to the owning admin must remember to attach
  `chatUserId`/`turnId`; the fail-safe direction hides it otherwise.
