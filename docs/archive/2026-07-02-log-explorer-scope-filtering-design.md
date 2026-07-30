<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Server-side scope filtering for the Debug Log Explorer

Status: approved (design phase) — ready for implementation planning.

## Problem

The `/debug` Log Explorer is the primary surface an operator uses to investigate
issues, but its filtering is too weak for comfortable investigation:

- **Scope filter is a single-select, exact-match dropdown**, and its option list is
  built only from scopes seen in the log pages currently loaded in the browser
  (`collectScopes` over `dashboard.logs`), so it is incomplete until you page back.
- There are **~398 distinct hierarchical scopes** (`chat:telegram:files`, `tool:*`,
  `acp`, …). You cannot select several at once, cannot **exclude** a noisy scope
  while seeing everything else, and cannot target a **namespace prefix**
  (`chat:telegram:*`).
- **Filtering happens client-side over only the loaded window** (newest ~500 plus any
  manually-paged-older entries). Isolating a rare scope or muting noise can silently
  miss older matches still sitting in the server-side ring buffer (capacity 65,535).
- The server's `GET /logs?q=` searches **substring on `msg` only**, while the browser
  runs a separate **fuzzy** search (Fuse.js) over the loaded window — two different
  behaviors, neither spanning the whole buffer.

## Goal & scope

Make the Log Explorer comfortable for issue investigation by replacing the single
exact-match scope dropdown with a **server-side, whole-buffer filter** supporting
**include/exclude allowlists with prefix matching**, driven entirely by URL/query-string
state and shared consistently between the historical query and the live SSE tail.

**In scope**

- Scope **include/exclude** allowlists/denylists with **prefix** (namespace) matching.
- **Server-side filtering over the whole in-memory buffer** (up to 65,535 entries).
- **Live-tail filtering** via SSE query params (no mutable control channel).
- A **scope-discovery endpoint** feeding the picker.
- **All-fields substring search** (server-side).
- **URL-encoded** filter state (shareable, survives reload).

**Out of scope (flagged dependencies, not addressed here)**

- The `debug`/`trace` level options being empty in production because the buffer
  attaches at `LOG_LEVEL` (default `info`). See §8.
- The group-scoped-event visibility bug in the live SSE stream (`adminVisibility.groupIds`
  always empty). Unrelated to log filtering; tracked separately.

## Canonical filter model (shared client + server)

New module `src/debug/log-filter-model.ts`, imported by both the server routes and the
client (the client already imports from `src/debug/`, e.g. `schemas.js`,
`log-stats-schema.js`).

```ts
type LogFilter = {
  include: string[] // scope patterns; empty => all scopes
  exclude: string[] // scope patterns; exclude wins over include
  level: number // minimum pino numeric level (>=), default 0
  turnId?: string
  q?: string // case-insensitive substring across all fields
}
```

**Pattern semantics** — one shared `matchesScope(pattern, scope)`:

- A bare namespace (`chat`) or an explicit wildcard (`chat:*`) matches on `:` **segment
  boundaries**: `chat` matches `chat`, `chat:telegram`, and `chat:telegram:files`, but
  **not** `chatbot`.
- Any other pattern is an **exact** match.

**Precedence** — an entry passes when:

```
(include.length === 0 || include.some(p => matchesScope(p, scope))) &&
(!exclude.some(p => matchesScope(p, scope)))
```

i.e. an empty `include` means "all scopes", and **exclude always wins**.

**Scope-less entries** (`scope === undefined`): shown when `include` is empty; when an
allowlist is active they are hidden unless a special selectable **`(none)`** token is
included.

**`q` (text search):** reuses a server-side `flattenLogEntry` (message + scope + every
metadata key and value), lowercased, matched with `String.includes`. This replaces both
the msg-only server substring and the client-side Fuse fuzzy search. Fuzzy/typo-tolerant
matching is intentionally dropped in favor of predictable, whole-buffer substring.

A single `applyFilter(entries, filter)` is used by `GET /logs`, `GET /logs/stats`, and
the SSE per-connection predicate — the **single source of truth**, so the historical
view and the live tail cannot diverge.

## Server changes

- **`LogRingBuffer.search`** (`src/debug/log-buffer.ts`) is extended to accept the
  `LogFilter` (include/exclude arrays + all-fields `q`) instead of today's single
  `scope` + msg-only `q`. `before`/`limit` paging continues to operate over the
  **filtered** result set (unchanged cursor semantics).
- **`GET /logs`** (`handleLogs`, `src/debug/server.ts:91`) parses **repeated**
  `include=` / `exclude=` params plus `level`, `turnId`, `q`, `before`, `limit` into a
  `LogFilter`. Malformed params fall back to defaults per-field (consistent with the
  existing lenient `parseIntParam` / `searchParam` helpers); a bad filter never 500s.
- **`GET /logs/stats`** gains a `matchingCount` field (entries matching the active
  filter) alongside the existing total `count`, so the UI can show
  "N match filter of Z buffered".
- **New `GET /logs/scopes`** → `[{ scope, count }]`: the distinct scope values currently
  present in the buffer with per-entry counts, for the picker. Added to
  `DEBUG_ONLY_PATHS`.

## Live SSE filtering

The Log Explorer is live: new entries stream in as `log:entry` SSE events and append in
real time. Filtering the live tail uses the **query string of the SSE URL** so SSE stays
effectively stateless (no "update my filter" control protocol).

- The client opens `new EventSource('/events?<same filter params as /logs>')`.
- `handleEvents` parses the filter from `req.url` **once at connection time** and binds a
  filter predicate to that connection.
- The connected-client registry becomes `Map<controller, predicate>` (currently a
  `Set<controller>`). In `broadcast`, the predicate is applied **only to `log:entry`
  events**; all other event types (turns, traces, notifications, tool failures, …) pass
  through unchanged and keep their existing scope-visibility behavior.
- **Changing a filter** = the client closes and reopens the SSE connection with new
  params **and** refetches `GET /logs?<filter>` to reset the window. `EventSource` cannot
  mutate its URL, so this reconnect is the mechanism; it happens only on an actual filter
  edit, not per entry. Net cost per filter change: one refetch + one reconnect, with a
  fully consistent view by construction.

## Client UI changes

Files: `client/debug/components/LogExplorer.svelte` (+ a new scope-filter picker
component), `client/debug/log-filter.ts`, `client/debug/log-bootstrap.ts`,
`client/debug/sse.ts`.

- Replace the single scope `Select` with a **scope filter control**: a namespace-grouped
  list sourced from `/logs/scopes` (with counts), where each scope can be toggled to
  **include** or **exclude**, and selecting a namespace node compiles to a **prefix**
  pattern. The level dropdown and the search box remain.
- Remove the client-side `filterLogsWithIndex` / `updateFuseIndex` (Fuse) path —
  filtering is now server-authoritative. The client renders exactly what `GET /logs` and
  the filtered SSE tail deliver. `flattenLogEntry` moves server-side into the shared
  filter module.
- **URL-encoded filter state** on the dashboard page query string: seeds the filter on
  load; on change it updates the URL, refetches `/logs`, and reconnects SSE. Shareable as
  a link; survives reload and back/forward.
- Buffer stat line becomes `showing X · N match filter of Z buffered`.
- The existing "show logs for turn" action becomes just the `turnId` field of the same
  `LogFilter` / URL state (no separate code path).

## Error handling, performance, testing

- **Performance:** filtering + flattening over up to 65,535 entries per query/refetch.
  Acceptable for a debug tool. If profiling warrants, the design permits caching each
  entry's flattened search text at `push` time — noted, not built.
- **Error handling:** per-field lenient parsing; unknown/garbage filter params degrade to
  defaults rather than erroring. The SSE predicate defaults to "pass all `log:entry`" when
  no/invalid filter params are present, preserving today's behavior.
- **Testing** (follow the repo's DI-first pattern where the module supports it):
  - Unit: `matchesScope` (exact, namespace prefix, wildcard, non-boundary non-match),
    `applyFilter` (empty-include = all, exclude-wins, `(none)` handling, level `>=`,
    all-fields `q`).
  - Route: `GET /logs` with repeated include/exclude; `GET /logs/scopes` distinct+counts;
    `GET /logs/stats` `matchingCount`.
  - SSE: the per-connection predicate filters `log:entry` events but passes turns/traces.
  - Client: a filter change reflects into the URL and triggers refetch + SSE reconnect.

## Known limitation to call out

Even with excellent filtering, the level dropdown's **`debug` / `trace` options stay
empty in production** because the ring-buffer stream attaches at `LOG_LEVEL` (default
`info`, `src/logger.ts` + `src/debug/server.ts` `logMultistream.add`). This feature makes
filtering strong but will not surface `debug`-level logs unless that default is addressed
separately. This is a conscious boundary of this work.
