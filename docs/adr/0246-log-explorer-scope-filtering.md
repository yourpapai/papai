<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0246: Log Explorer Scope Filtering

## Status

Implemented (with divergence)

## Date

2026-07-02

## Context

The `/debug` Log Explorer — an operator's primary investigation surface over the in-memory log ring buffer (capacity 65,535) — had filtering too weak for comfortable use:

- The scope filter was a **single exact-match `<select>`**, whose option list was built only from scopes present in the currently-loaded browser window (`collectScopes` over `dashboard.logs`), so it was incomplete until you manually paged back.
- With ~398 distinct hierarchical scopes (`chat:telegram:files`, `tool:*`, `acp`, …) you could not select several at once, **exclude** a noisy scope while seeing everything else, or target a **namespace prefix** (`chat:telegram:*`).
- Filtering happened **client-side over only the loaded window** (newest ~500 plus manually-paged-older entries), so isolating a rare scope or muting noise silently missed older matches still sitting in the server-side buffer.
- The server's `GET /logs?q=` searched substring on `msg` only, while the browser ran a separate **fuzzy** (Fuse.js) search over the loaded window — two different behaviors, neither spanning the whole buffer.

The design (`docs/superpowers/specs/2026-07-02-log-explorer-scope-filtering-design.md`) and plan (`docs/superpowers/plans/2026-07-02-log-explorer-scope-filtering.md`) replaced this with a **server-side, whole-buffer filter** driven by a single shared `LogFilter` model, supporting include/exclude allowlists with prefix matching, all-fields substring search, live-tail filtering via SSE query params, and URL-encoded filter state shared identically between the historical query and the live tail.

## Decision Drivers

- **One shared filter model, three consumers.** A single `LogFilter` + `applyFilter` in `src/debug/log-filter-model.ts` is used by `GET /logs`, `GET /logs/stats`, and the per-connection SSE `log:entry` predicate, so the historical view and the live tail cannot diverge.
- **Whole-buffer, server-authoritative filtering.** Include/exclude + prefix matching run over the full in-memory buffer (up to 65,535 entries), not just the loaded browser window.
- **Stateless SSE via the connection URL.** Live-tail filtering reuses the SSE URL query string (`/events?<filter>`); there is no mutable control channel, and `EventSource` cannot change its URL — changing a filter closes and reopens the connection (and refetches `/logs`), giving a fully consistent view by construction.
- **URL-encoded filter state.** The filter seeds from the page URL on load and updates the URL on change, so it is shareable as a link and survives reload/back-forward.
- **Lenient, never-500 parsing.** Per-field lenient query parsing (consistent with the existing `parseIntParam`/`searchParam` helpers); a malformed filter degrades to defaults rather than erroring.
- **Drop client-side Fuse in favor of predictable server substring.** Fuzzy/typo-tolerant matching is intentionally removed; the new all-fields `flattenLogEntry` substring search replaces both the msg-only server search and the client Fuse path.

## Considered Options

### Option 1 — Shared server-side `LogFilter` model; whole-buffer filtering; SSE filter via connection URL; URL-encoded state (chosen)

A new `src/debug/log-filter-model.ts` defines `LogFilter` and `applyFilter`/`entryMatchesFilter`/`matchesScope`/`flattenLogEntry`/`parseLogFilter`. `GET /logs`, `GET /logs/stats` (new `matchingCount`), a new `GET /logs/scopes`, and the per-connection SSE predicate all consume it. The client encodes the filter into the query string of both `/logs` and `/events`; the registry becomes `Map<controller, LogFilter>`.

- **Pros:** history and live tail are consistent by construction (one predicate); spans the whole buffer; prefix matching tames ~398 hierarchical scopes; URL state is shareable; no new control protocol; `(none)` token handles scope-less entries.
- **Cons:** changing a filter costs one `/logs` refetch + one SSE reconnect; filtering/flattening scans up to 65,535 entries per query; drops fuzzy/typo tolerance; the level dropdown's `debug`/`trace` options stay empty in production unless `LOG_LEVEL=debug` (a pre-existing, out-of-scope boundary).

### Option 2 — Expand the client-side single-select to a multi-select (keep status quo transport)

Keep filtering client-side over the loaded window; only widen the dropdown to allow multiple scope selections and exclusions.

- **Pros:** smallest change; no server work; no SSE reconnect churn.
- **Cons:** rejects the headline driver — it still only filters the loaded window, silently missing older matches in the buffer, and keeps the divergent Fuse-vs-server search behaviors.

### Option 3 — SSE control-channel protocol (mutable filter message)

Keep SSE stateful: emit a `filter:update` message over the existing connection to mutate the per-connection predicate instead of reconnecting.

- **Pros:** no reconnect on filter change; lower latency.
- **Cons:** adds a mutable bidirectional control protocol on top of a one-way `EventSource` (which cannot send messages); complicates the registry and the URL-as-state contract; loses the "URL fully describes the view" shareability property. Rejected in the design.

## Decision

The chosen Option 1 shipped in full across the shared model, buffer, server routes, SSE registry, client helpers, and UI. What shipped:

1. **Shared filter model (`src/debug/log-filter-model.ts`).** `LogFilter` (include/exclude arrays, minimum `level`, optional `turnId`, all-fields `q`), `NONE_TOKEN` for scope-less entries, `matchesScope` (exact / bare-namespace-prefix / `:*` wildcard / lone `*`), `flattenLogEntry` (msg + scope + every metadata key/value), `entryMatchesFilter`/`applyFilter`, and `parseLogFilter` from URL params.
2. **Buffer search + discovery (`src/debug/log-buffer.ts`).** `search` now takes a `LogFilter & {limit?, before?}` (paging runs over the filtered set); new `countMatching` and `distinctScopes` (sorted `{scope, count}`, skipping scope-less entries).
3. **Routes (`src/debug/server.ts` + `server-route-options.ts`).** `handleLogs` parses the filter; new `handleLogScopes` → `GET /logs/scopes`; `handleLogStats` adds `matchingCount`; `/logs/scopes` registered in `DEBUG_ONLY_PATHS`; `handleEvents` parses the filter and binds it to the connection.
4. **Per-connection SSE filtering (`src/debug/state-collector.ts`).** The client registry is `Map<controller, LogFilter>`; `addClient(controller, filter?)`; `broadcast` applies `entryMatchesFilter` to `log:entry` events only (all other event types pass through with their existing scope-visibility behavior).
5. **Stats schema (`src/debug/log-stats-schema.ts`).** Optional `matchingCount` added to `LogBufferStatsSchema`.
6. **Client URL helpers (`client/debug/log-filter-url.ts`).** `emptyFilter`, `filterToParams` (repeated include/exclude, skips defaults), `filterToQuery`, `filterFromParams` (delegates to the server parser for identical semantics).
7. **Filter-aware bootstrap (`client/debug/log-bootstrap.ts`).** `buildLogsUrl({limit?, before?, filter?})`; `fetchInitialLogs`/`fetchOlderLogs`/`fetchLogStats` thread the filter; new `fetchScopes` + `ScopeCount` type.
8. **Dashboard state (`client/debug/dashboard-types.ts` + `debug.svelte.ts`).** `activeLogFilter` is a full `LogFilter`; new `logScopeCounts: ScopeCount[]`.
9. **ScopeFilter picker (`client/debug/components/ScopeFilter.svelte`).** A three-state chip picker (neutral → include → exclude → neutral) over `{scope, count}` rows, driving `onChange(include, exclude)`.
10. **LogExplorer rewired (`client/debug/components/LogExplorer.svelte`).** Renders server-filtered `dashboard.logs` directly; level/search/scope drive `dashboard.activeLogFilter`; the buffer-stat line surfaces `matchingCount`; the "show logs for turn" action is just the `turnId` field of the same filter.
11. **SSE + URL lifecycle (`client/debug/sse.ts` + `DebugApp.svelte`).** `eventsUrl(query)` + `setupEventSource(..., query)`; `DebugApp` seeds the filter from the page URL on mount and, on every filter change, refetches `/logs`, refreshes scopes, updates the page URL, and reconnects SSE with the new query.
12. **Client Fuse path removed.** `client/debug/log-filter.ts` and its test were deleted; filtering is server-authoritative.

## Consequences

### Positive

- An operator can include/exclude multiple scopes and target namespace prefixes (`chat:telegram:*`) over the **whole** buffer, not just the loaded window — isolating a rare scope or muting noise no longer silently misses older matches.
- History and live tail use the identical predicate, so the filtered view cannot drift between the two.
- Filter state lives in the URL: shareable as a link, survives reload and back/forward.
- A single server-side all-fields substring search replaces two divergent behaviors (msg-only server search + client Fuse fuzzy), and `matchingCount` lets the UI show "N match filter of Z buffered".
- The `(none)` token and `turnId` field fold scope-less entries and the per-turn log view into the same uniform filter/URL model.

### Negative

- Each filter edit costs one `/logs` refetch plus one SSE reconnect (the chosen price of URL-as-state and a stateless SSE).
- Filtering/flattening scans up to 65,535 entries per query/refetch (acceptable for a debug tool; the design permits caching flattened text at `push` time but did not build it).
- Fuzzy/typo-tolerant matching was dropped in favor of predictable substring search.
- The level dropdown's `debug`/`trace` options remain empty in production unless `LOG_LEVEL=debug` — a pre-existing boundary consciously carried from the design, not addressed here.

### Risks

- **Filter-edit reconnect churn under rapid edits.** Each keystroke in the search box mutates `activeLogFilter` and re-runs the refetch+reconnect effect; under a very large buffer or a slow connection this could thrash. The buffer-stat fetch is the main per-edit cost.
- **Per-connection filter memory.** Storing a `LogFilter` per connected controller increases per-connection memory slightly; bounded by the operator-only (single-admin) audience of the debug server.
- **`(none)` not surfaced as a chip.** As the plan's self-review noted, the picker renders only real buffer scopes; selecting scope-less entries requires typing `include=(none)` in the URL. Filtering still works; it is a UI-completeness gap, not a correctness one.

## Related Decisions

- **ADR-0224: Remove Debug Log Redaction** — the sibling debug-observability change that made full (unredacted) log bodies available in the buffer, a prerequisite for meaningful whole-buffer substring search.
- **ADR-0197: Debug Observability Fixes** — the earlier debug-observability hardening pass (its Decision 3, log redaction, was superseded by ADR-0224).
- The debug-dashboard lineage (ADR-0037 event bus/server, ADR-0038 pino log pipeline, ADR-0040 dashboard UI, ADR-0087 dashboard expansion, ADR-0121 dashboard/admin split) that established the `LogRingBuffer`, SSE `state-collector`, and `LogExplorer` surface this feature extends.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`; the core commit messages match the plan verbatim.

| File | Role | Evidence |
| --- | --- | --- |
| `src/debug/log-filter-model.ts:8-122` | `NONE_TOKEN`, `LogFilter`, `matchesScope`, `flattenLogEntry`, `scopePasses`, `entryMatchesFilter`, `applyFilter`, `parseLogFilter` — the shared model. | `read` confirms. |
| `src/debug/log-buffer.ts:7,18-22,67-88` | Imports `applyFilter`/`LogFilter`; `SearchParams = LogFilter & {limit?,before?}`; `search` filters before paging; `countMatching`; `distinctScopes`. | `read` confirms. |
| `src/debug/server.ts:17,67,102-119,173-176` | `parseLogFilter` import; `handleEvents` parses filter → `addClient(controller, filter)`; `handleLogs`/`handleLogScopes`/`handleLogStats` (with `matchingCount`); routes registered. | `read` confirms. |
| `src/debug/state-collector.ts:13,25-26,101-102,172-182` | `entryMatchesFilter`/`LogFilter` import; `clients = Map<controller, LogFilter>` + `PASS_ALL`; `addClient(controller, filter?)`; `broadcast` applies predicate to `log:entry` only. | `read` confirms. |
| `src/debug/log-stats-schema.ts:14` | Optional `matchingCount` on `LogBufferStatsSchema`. | `read` confirms. |
| `src/debug/server-route-options.ts:8-17` | `DEBUG_ONLY_PATHS` includes `/logs/scopes`. | `read` confirms. |
| `client/debug/log-filter-url.ts:10-31` | `emptyFilter`, `filterToParams`, `filterToQuery`, `filterFromParams` (re-exports server `LogFilter`). | `read` confirms. |
| `client/debug/log-bootstrap.ts:10,38-43,53-64,66-75,77-98` | `filterToParams` import; filter-aware `buildLogsUrl`; `fetchInitialLogs`/`fetchOlderLogs`/`fetchLogStats` thread filter; `fetchScopes` + `ScopeCount`. | `read` confirms. |
| `client/debug/dashboard-types.ts:43-44,128-129` | `ScopeCount`/`LogFilter` imports; `activeLogFilter: LogFilter`; `logScopeCounts: ScopeCount[]`. | `read` confirms. |
| `client/debug/debug.svelte.ts:25-26` | State initializer: `activeLogFilter: { include: [], exclude: [], level: 0 }`, `logScopeCounts: []`. | `read` confirms. |
| `client/debug/components/ScopeFilter.svelte:1-78` | Three-state chip picker (neutral/include/exclude) over `{scope, count}`; `onChange(include, exclude)`. | `read` confirms. |
| `client/debug/components/LogExplorer.svelte:12,21-24,81-95,150-154,182-186` | `ScopeFilter` import; derived `levelFilter`/`searchQuery`/`filtered` off `dashboard.activeLogFilter`; `setLevel`/`setQuery`/`setScopes`/`clearTurnFilter`; picker wired; `matchingCount` stat line. | `read` confirms. |
| `client/debug/sse.ts:143-153` | `eventsUrl(query)`; `setupEventSource(state, onConnectionChange, query, handlers)` opens `EventSource(eventsUrl(query))`. | `read` confirms. |
| `client/debug/DebugApp.svelte:22-23,33-62` | Imports `filterFromParams`/`filterToQuery`/`fetchScopes`; seed-from-URL effect + refetch/reconnect-on-filter-change effect (closes old SSE via cleanup). | `read` confirms. |
| `client/debug/log-filter.ts` | Deleted (Fuse path removed). | `glob` confirms — no such file. |
| `tests/debug/log-filter-model.test.ts`, `tests/debug/sse-log-filter.test.ts` | Model + per-connection SSE predicate tests present. | `glob` confirms. |
| `tests/client/debug/log-filter-url.test.ts`, `tests/client/debug/components/ScopeFilter.test.ts` | URL-helper + picker tests present. | `glob` confirms. |
| commits `bbeb45a42`, `a0fa14aa5`, `cdd360273`, `b53e39943` | `feat(debug): shared LogFilter model…`, `…server-side /logs filtering, /logs/scopes, stats matchingCount`, `…filter live log:entry SSE events per-connection`, `…client filter URL helpers + filter-aware log bootstrap` — match the plan's commit messages verbatim. | `git log -S` confirms. |

Plan-vs-implementation notes:

- **A lone-`*` wildcard was added after the plan.** The plan/spec defined only exact, bare-namespace, and `:*` forms. Shipped `matchesScope` also returns `true` for `pattern === '*'` (`log-filter-model.ts:33`), added by commit `02a8125ec` ("treat lone * as match-all and drop empty scope patterns"). An extension; the picker emits concrete scopes so it does not change the default UX.
- **`parseLogFilter` drops empty-string tokens.** Shipped filters blanks from `include`/`exclude` (`.filter((s) => s !== '')`, `log-filter-model.ts:108-109`); the plan's version kept them. Same commit `02a8125ec`; prevents a malformed `include=` (no value) from creating an empty-string scope token.
- **`broadcast` narrows with an `isLogEntry` guard.** Shipped `state-collector.ts:168-175` type-guards `event.data` before calling `entryMatchesFilter`; the plan's snippet cast `event.data as LogEntry` directly. A safety addition, not a behavior change.
- **The picker is a flat chip list, not "namespace-grouped".** The spec described a "namespace-grouped list" for the picker; shipped `ScopeFilter.svelte` renders a flat sorted list of `{scope, count}` chips (prefix matching still gives namespace power via the `matchesScope` semantics). A UI simplification — functionally equivalent for filtering.
- **`(none)` is not surfaced as a chip.** As the plan's self-review explicitly flagged as optional, the picker renders only real buffer scopes; `NONE_TOKEN` filtering still works via the URL. Matches plan intent, noted as a UI-completeness gap.
- **`matchesScope` jsdoc documents trailing-colon behavior.** A trailing colon (`chat:`) is treated as an exact-match pattern, not a prefix; use `chat` or `chat:*` for namespace matching (`log-filter-model.ts:28-31`). Cosmetic doc clarification, no logic divergence.
- **Known limitation carried from the design.** `debug`/`trace` level options stay empty in production because the buffer stream attaches at `LOG_LEVEL` (default `info`); documented as an out-of-scope boundary, no task.

The source plan `docs/superpowers/plans/2026-07-02-log-explorer-scope-filtering.md` and design `docs/superpowers/specs/2026-07-02-log-explorer-scope-filtering-design.md` are archived alongside this ADR to `docs/archive/`.
