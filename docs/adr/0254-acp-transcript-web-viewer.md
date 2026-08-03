<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0254: ACP Transcript Web Viewer

## Status

Implemented (with divergence)

## Date

2026-07-05

## Context

A coding session driven by the acp plugin against magi was a black box in chat: the user saw a spinner and, eventually, a milestone notification. magi had meanwhile grown per-session transcript endpoints — a live SSE tail and a paginated historical read, both bearer-authed, both emitting raw ACP events keyed by a monotonic `seq`. papai had no way to surface any of it.

The design (`docs/superpowers/specs/2026-07-05-acp-transcript-web-viewer-design.md`) and plan (`docs/superpowers/plans/2026-07-05-acp-transcript-web-viewer.md`) resolved this with three isolated concerns: (1) the acp plugin reads `shareToken`/`transcriptUrl` from magi's session-creation responses, stores them on the `SessionRecord`, and surfaces `transcriptUrl` through `list_sessions`; since magi's raw response already flows to the model, the live link reaches chat for free; (2) a public `src/debug/transcript-viewer.ts` dispatcher, mounted before the dashboard-auth gate (like `/api/notify`), serves the viewer assets and blind-proxies `/t/:token/stream` (long-lived SSE) and `/t/:token/transcript` (JSON) to magi using the acp plugin's admin `magi_base_url`/`magi_token` — papai stores no token→session mapping; (3) a `client/transcript/` Svelte 5 SPA stitches history + live by `seq` and renders a read-only timeline. No new papai env var; the proxy reuses the existing plugin admin config.

## Decision Drivers

- **Stable, no-login shareable link.** A capability URL (`/t/<token>`, magi-minted, unguessable) that can be pasted into chat and embedded in the PR, openable by teammates/reviewers with no papai account — possession of the token is the authorization.
- **magi stays private.** Browsers never touch magi directly; papai proxies with its own `magi_token`, attached server-side only and never in any response to the browser.
- **One viewer, live + historical.** The same URL streams live while the session runs and becomes a historical replay once it finishes.
- **Read-only.** The viewer never takes an action; permission approvals stay in chat where identity and `whoMayUse` apply.
- **Thin papai surface.** Reuse magi's token-scoped endpoints so papai blind-proxies the opaque token and stores no mapping — the rejected alternative was papai owning a `token → sessionId` store and proxying id-keyed endpoints.
- **Long-lived SSE must not hit the 30s `httpFetch` cap.** The stream route deliberately bypasses `providerRuntime.httpFetch` (hard `AbortSignal.timeout(30_000)`); a regression here silently truncates every session at 30s.
- **Back-compat with older magi.** When magi omits the share fields, the tool result and prompt degrade gracefully (no link, no error).
- **No new papai config.** The proxy reads the acp plugin's existing admin config via the plugin-agnostic `getPluginAdminConfig('acp', …)` accessor.

## Considered Options

### Option 1 — magi-minted capability token; papai blind-proxy; dedicated read-only SPA (chosen)

magi returns `shareToken` + `transcriptUrl` at session creation; papai stores both on the `SessionRecord` and relays the URL to the model. Core serves `/t/<token>` (SPA shell), `/t.js`/`/t.css`, and proxies `/t/<token>/{stream,transcript}` to magi's token-scoped endpoints, attaching the bearer server-side. A `client/transcript/` Svelte SPA stitches history + live by `seq`.

- **Pros:** papai stores no token→session mapping and exposes no raw session id in the path; the token is the only user-controlled segment (no path traversal into other magi endpoints); the proxy is a single module; revocation/expiry can be added magi-side later with zero papai change (magi owns the token); reuses the existing plugin admin config and `client/shared/` tokens.
- **Cons:** the raw, unredacted transcript is reachable by anyone with the link; the long-lived SSE proxy needs its own fetch path outside the shared runtime; a new SPA bundle and its build wiring.

### Option 2 — papai-owned `token → sessionId` store; proxy magi's id-keyed endpoints

magi returns only `sessionId`; papai mints and stores the token, proxying magi's `GET /sessions/:id/{transcript,stream}`.

- **Pros:** papai controls token lifetime/revocation directly.
- **Cons:** forces papai to own a token store and GC; exposes the raw session id in the proxy path; duplicates magi's own token-minting; more papai state for no gain in v1.

### Option 3 — Index/aggregate page instead of per-session direct links

A no-login page listing a chat's sessions.

- **Pros:** one bookmark per chat.
- **Cons:** rejected as YAGNI — aggregating every session behind one no-login link is a much larger leak blast radius; the chat thread (and the existing `list_sessions` tool) is already the index.

## Decision

The chosen Option 1 shipped in full across the plugin, the core proxy, the viewer SPA, the build wiring, tests, stories, and docs. What shipped:

1. **`SessionRecord` share fields (`plugins/acp/history.ts`).** `shareToken?: string` and `transcriptUrl?: string` added to the type and parsed in `toSessionRecord` with the same optional-string guard the other fields use.
2. **`shareFieldsOf` helper (`plugins/acp/tools.ts`).** Lifts both fields off an unknown magi result via the shared `optionalString`, returning `{}` when absent (the back-compat path).
3. **Storing share fields on session records.** `recordStartedSession` (in `plugins/acp/session-records.ts`) merges `...shareFieldsOf(result)` into the written record; the follow-up child record (`plugins/acp/continue-tool.ts`) merges it the same way; `enrichSession` surfaces `transcriptUrl` back into the `list_sessions` row when the local record carries one.
4. **Prompt nudge (`plugins/acp/index.ts`).** The `/acp` prompt fragment appends a sentence instructing the model to include the `transcriptUrl` in its reply whenever one comes back.
5. **Core proxy module (`src/debug/transcript-viewer.ts`).** `getViewerMagiConfig()` reads + normalizes the acp admin config; `proxyTranscriptHistory` forwards token + allowlisted query (`after`/`limit`) to magi's `/t/:token/transcript` with a server-side bearer; `proxyTranscriptStream` proxies `/t/:token/stream`, binding the upstream fetch to the client's own `req.signal` (no 30s cap); `routeTranscriptPaths` dispatches `/t.js`, `/t.css`, `/t/<token>` (shell), and the two proxy subpaths, returning `null` for non-`/t` paths and `404`/`503` appropriately.
6. **Public mount before the auth gate (`src/debug/server.ts`).** `routeTranscriptPaths` is invoked (via the shared `routePublicCapabilityPaths` wrapper) immediately after `/api/notify` and before `isAuthorizedRequest`.
7. **Viewer SPA bundle (`client/transcript/`).** `index.ts` (Svelte 5 `mount` + `tokenFromPath`), `transcript.html` shell (CSP `default-src 'self'`, loads `/t.css` + `/t.js`), `transcript.css`, `fetcher-schemas.ts` (Zod event + history schemas), `stitch.ts` (pure `mergeBySeq`), `fetchers.ts` (paged history), `sse.ts` (EventSource wrapper for the five event types + terminal `end`), `transcript.svelte.ts` (runes state + stitch orchestration + reconnect self-heal), `TranscriptApp.svelte`, and `components/TimelineEvent.svelte` + `components/StatusBanner.svelte`.
8. **Build wiring.** A `transcript` entry in `scripts/build-client.ts` `BUNDLES` and `public/transcript.js` in `scripts/check-bundle-isolation.ts`.
9. **Tests.** Plugin (`history.test.ts`, `start-session.test.ts`, `list-status.test.ts`), core proxy (`tests/debug/transcript-viewer.test.ts` plus an end-to-end `transcript-viewer-e2e.test.ts`), and client logic (`tests/client/transcript/{stitch,fetcher-schemas,fetchers,sse,index,transcript.svelte}.test.ts`).
10. **Stories + docs.** `TimelineEvent.stories.svelte` and `TranscriptApp.stories.svelte`; a "Transcript viewer" section in `docs/architecture/coding-sessions.md` and a `MAGI_TRANSCRIPT_BASE_URL` note (magi-side, papai adds none) in `docs/architecture/environment.md`.

## Consequences

### Positive

- A coding session is now a glass box: the chat reply carries a live link, and the same URL becomes a historical replay after the session ends.
- magi's base URL and bearer token never reach the browser; the browser only ever talks same-origin `/t/*` proxies, and the only user-controlled path segment is the opaque token.
- The SSE proxy lives exactly as long as the browser tab (bound to `req.signal`); a client disconnect cancels the upstream, so no magi connection leaks, and there is no 30s truncation.
- Older magi deployments keep working: missing share fields yield no link and no error.
- No new papai config surface — the proxy reuses the acp plugin's existing admin config, so the proxy and the plugin runtime cannot drift.
- Revocation/expiry can be added magi-side later with zero papai change, since magi owns the token.

### Negative

- The transcript is the raw, unredacted session log; under a no-login capability link, anyone who obtains the URL sees everything the agent saw and did, including any secret that surfaced in tool output.
- A new SPA bundle and its build/isolation wiring must be maintained alongside the existing debug/admin/settings bundles.
- The state store carries real reconnect/backfill complexity (buffer-until-history, gap re-fetch) beyond a naive EventSource consumer.

### Risks

- **Capability-token leakage.** A `transcriptUrl` is a bearer secret; there is no per-event redaction and no revocation/expiry on the papai side today. Both are deferred to magi (which mints and owns the token). v1 relies on the token being high-entropy and treated as sensitive.
- **30s-timeout regression trap.** The stream route must never be routed through `providerRuntime.httpFetch`; a future refactor that "simplifies" the proxy onto the shared runtime would silently truncate every session at 30s. Called out in the spec and covered by a test asserting the stream binds to the client signal.
- **Raw error surfaces.** A `502`/`503` from the proxy surfaces a terse string to the viewer; the state store retries, but a persistently unreachable magi shows "temporarily unavailable" rather than a diagnostic.

## Related Decisions

- **The acp plugin + magi coding-session model** (`docs/architecture/coding-sessions.md`) this layers onto — `start_session`/`continue_session`/`review_pr`, the `SessionRecord` store, and `enrichSession`/`list_sessions`.
- **The follow-up coding-session work (ADR-0242)** which, alongside this plan, consolidated the review-session record path onto `recordStartedSession` (with an optional `prNumber`) and merged `shareFieldsOf` into the child record, shaping the storage sites this ADR cites.
- **The plugin-as-MCP public-route precedent** — `routeTranscriptPaths` established the "public capability-token route mounted before the auth gate" pattern that the later `/mcp/plugin/<id>` route reuses through the shared `routePublicCapabilityPaths` wrapper.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `plugins/acp/history.ts:19-20` | `shareToken?: string` / `transcriptUrl?: string` on `SessionRecord`. | `read` confirms. |
| `plugins/acp/history.ts:53-54,62-63` | `toSessionRecord` reads both fields and assigns with the optional-string guard. | `read` confirms. |
| `plugins/acp/tools.ts:90-98` | `shareFieldsOf(result)` helper using shared `optionalString`; returns `{}` when absent. | `read` confirms. |
| `plugins/acp/session-records.ts:9,25` | `recordStartedSession` imports + merges `...shareFieldsOf(result)` into the written record. | `read` confirms. |
| `plugins/acp/session-records.ts:53` | `enrichSession` surfaces `transcriptUrl` back into the `list_sessions` row. | `read` confirms. |
| `plugins/acp/continue-tool.ts:20,135` | Follow-up child record merges `...shareFieldsOf(result)`. | `read` confirms. |
| `plugins/acp/index.ts:101-102` | Prompt fragment nudges sharing the `transcriptUrl` link. | `read` confirms. |
| `src/debug/transcript-viewer.ts:17-22` | `getViewerMagiConfig()` reads + trims acp admin config, strips trailing slashes; `null` when unset. | `read` confirms. |
| `src/debug/transcript-viewer.ts:28-56` | `proxyTranscriptHistory` — forwards token + `after`/`limit`, server-side bearer, `AbortSignal.any([clientSignal, timeout(15s)])`, try/catch `502`. | `read` confirms. |
| `src/debug/transcript-viewer.ts:58-85` | `proxyTranscriptStream` — binds upstream fetch to `clientSignal` only (no 30s cap), `event-stream` headers, `502` on reject. | `read` confirms. |
| `src/debug/transcript-viewer.ts:114-135` | `routeTranscriptPaths` — `/t.js`/`/t.css` assets, `/t/<token>` shell, stream/transcript proxy, `503` when unconfigured, `404` otherwise. | `read` confirms. |
| `src/debug/server.ts:31,202-208` | `routeTranscriptPaths` imported; invoked via the `routePublicCapabilityPaths` wrapper. | `read` confirms. |
| `src/debug/server.ts:244-249` | Wrapper mounted after `/api/notify`, **before** `isAuthorizedRequest` (the auth gate). | `read` confirms. |
| `scripts/build-client.ts:66-74` | `transcript` `BUNDLES` entry (`index.ts` → `transcript.js`/`.html`/`.css`). | `read` confirms. |
| `scripts/check-bundle-isolation.ts:21` | `public/transcript.js` in the isolation-check `BUNDLES`. | `read` confirms. |
| `client/transcript/index.ts:11-26` | `tokenFromPath` parse + Svelte 5 `mount(TranscriptApp)`. | `read` confirms. |
| `client/transcript/fetcher-schemas.ts:8-29` | `TRANSCRIPT_EVENT_TYPES`, `TranscriptEventSchema`, `HistoryResponseSchema` (incl. `recording: 'disabled'`). | `read` confirms. |
| `client/transcript/stitch.ts:9-14` | Pure `mergeBySeq` (history wins on `seq` collision, sorted, deduped). | `read` confirms. |
| `client/transcript/fetchers.ts` | `fetchHistoryPage` / `fetchAllHistory` paging until `nextCursor` null. | `grep` confirms; matches plan. |
| `client/transcript/sse.ts:14-42` | `openTranscriptStream` EventSource wrapper (five types + terminal `end`). | `read` confirms. |
| `client/transcript/transcript.svelte.ts:40-54,102-119` | Runes state with `resync()` gap backfill and reconnect self-heal; `createTranscriptState`. | `read` confirms. |
| `client/transcript/TranscriptApp.svelte:9-26` | Root wires `createTranscriptState`, renders `StatusBanner` + `TimelineEvent` timeline. | `read` confirms. |
| `client/transcript/components/StatusBanner.svelte:6-16` | Six-state status banner (`connecting`/`live`/`finished`/`recording-disabled`/`invalid-token`/`error`). | `read` confirms. |
| `client/transcript/components/TimelineEvent.svelte:15-39` | Per-event renderer; permission events read-only (status chip only, no buttons). | `read` confirms. |
| `client/transcript/transcript.html:6-12` | Shell with `default-src 'self'` CSP, `/t.css` + `/t.js`. | `read` confirms. |
| `client/transcript/components/TimelineEvent.stories.svelte:11-46` | Message / Tool call / Permission / Result stories. | `read` confirms. |
| `client/transcript/TranscriptApp.stories.svelte:14-22` | Five `StatusBanner` status stories. | `read` confirms. |
| `tests/plugins/acp/history.test.ts:65-88` | `SessionRecord` round-trips share fields; non-string `shareToken` reads back `undefined`. | `read` confirms. |
| `tests/plugins/acp/start-session.test.ts:70-81` | `start_session` stores `shareToken`/`transcriptUrl` from the magi response. | `read` confirms. |
| `tests/plugins/acp/list-status.test.ts:104-127` | `list_sessions` includes/omits `transcriptUrl` per the local record. | `read` confirms. |
| `tests/debug/transcript-viewer.test.ts:10-18,42-56` | Imports all four exports; `getViewerMagiConfig` trim/null cases. | `read` confirms. |
| `tests/debug/transcript-viewer-e2e.test.ts:9,78,94` | End-to-end dispatcher exercise (extra, beyond plan). | `grep` confirms. |
| `tests/client/transcript/{stitch,fetcher-schemas,fetchers,sse,index,transcript.svelte}.test.ts` | Client logic coverage (stitch/fetchers/sse/index beyond the plan's two). | `glob` confirms. |
| `docs/architecture/coding-sessions.md:106-116` | "Transcript viewer" section (share fields, public routes, proxy invariants, residual risk). | `read` confirms. |
| `docs/architecture/environment.md:42` | `MAGI_TRANSCRIPT_BASE_URL` is a magi-side var; papai adds none. | `grep` confirms. |

Plan-vs-implementation notes:

- **The proxy functions take a `fetchImpl` DI parameter and a `clientSignal`.** The plan's `proxyTranscriptHistory` used a bare `AbortSignal.timeout(15_000)` with no DI and no try/catch. Shipped accepts the request's `clientSignal` (so a browser disconnect also cancels history, not just the stream) and composes it via `AbortSignal.any([clientSignal, AbortSignal.timeout(15_000)])`, and wraps the fetch in try/catch returning `502` on throw. Both proxies accept an injectable `fetchImpl` (default `fetch`) for testing — `getViewerMagiConfig`/`routeTranscriptPaths` are the only entry points used in production.
- **The plan's `plugins/acp/session-tools.ts` storage sites moved to `plugins/acp/session-records.ts`.** The plan edited `recordStartedSession` and `recordReviewSession` in `session-tools.ts`; in the shipped tree those record functions live in `session-records.ts`, and there is **no separate `recordReviewSession`** — review sessions route through `recordStartedSession` (now taking an optional `prNumber`, deriving `PR #<n>: <title>`), called from `session-tools.ts:108`. The share-field storage intent is unchanged; the call site just consolidated (sibling to ADR-0242). `shareFieldsOf` itself is implemented with the shared `asObject`/`optionalString` client helpers rather than the plan's hand-rolled `Map`.
- **`routeTranscriptPaths` is mounted through a shared `routePublicCapabilityPaths` wrapper, not inline.** The plan mounted the dispatcher directly between `/api/notify` and the auth gate. Shipped wraps it (`src/debug/server.ts:202-208`) alongside the later plugin-as-MCP `routePluginMcpPaths`, so the "public capability route before auth" pattern has one owned mount point. Ordering invariant preserved: still after `/api/notify`, still before `isAuthorizedRequest`.
- **The state store is richer than the plan's sketch.** The plan's `createTranscriptState` was a flat closure; shipped extracts a `StreamCtx`, exposes a `TranscriptState` interface, and adds a `resync()` backfill that re-fetches history from `maxSeq` on stream error (because the live stream never replays missed events). This realizes the spec's "reconnect re-stitch" requirement, which the plan's sketch had deferred.
- **Tests exceed the plan.** The plan named three client tests (`stitch`, `fetcher-schemas`) and the core proxy file; shipped adds `fetchers`, `sse`, `index`, and `transcript.svelte` client tests, an end-to-end `transcript-viewer-e2e.test.ts`, a `list-status` `transcriptUrl` case, and an HTTP story test (`tests/stories/http/transcript-viewer.story.test.ts`). The `proxyTranscriptStream` "no-30s-cap" invariant is asserted by binding to the client signal rather than by a textual "does not import httpFetch" guard.

The source plan `docs/superpowers/plans/2026-07-05-acp-transcript-web-viewer.md` and design `docs/superpowers/specs/2026-07-05-acp-transcript-web-viewer-design.md` are archived alongside this ADR to `docs/archive/`.
