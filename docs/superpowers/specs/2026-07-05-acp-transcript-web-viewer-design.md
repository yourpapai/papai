<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ACP Transcript Web Viewer + Shareable Links — Design

**Date:** 2026-07-05
**Status:** Approved (pending spec review)

## Problem

magi now exposes a per-session transcript over HTTP in two modes — a live SSE
tail (`GET /sessions/:id/stream`) and a paginated historical read
(`GET /sessions/:id/transcript`), both bearer-authed, both emitting raw ACP
events (`prompt | update | permission_request | permission_decision | result`)
keyed by a monotonic `seq` (magi spec `2026-07-05-transcript-streaming-api`).
papai has no way to surface any of this. A coding session is a black box in
chat: the user sees a spinner and, eventually, a milestone notification.

We want a papai web UI that renders a coding session **live** as it unfolds and
lets anyone **revisit** it afterward, reachable through a **stable, shareable
URL** that can be posted into the originating chat and embedded in the pull /
merge request the session opens.

## Goals

- **One viewer, live + historical.** The same URL streams live while the session
  runs and becomes a historical replay once it finishes.
- **Stable shareable link.** A capability URL (unguessable, no login) that can be
  pasted into chat and embedded in the PR, openable by teammates and reviewers
  who have no papai account.
- **magi stays private.** Browsers never touch magi directly; papai proxies with
  its own `magi_token`.
- **Read-only.** The viewer never takes an action; permission approvals remain in
  chat where identity and the `whoMayUse` guardrail apply.
- **Thin papai surface.** Reuse magi's token-scoped endpoints so papai blind-
  proxies and stores no token→session mapping.

## Non-goals (YAGNI)

- **No aggregated / public index** of a chat's sessions. Each session has its own
  direct link; the chat thread (and the existing `list_sessions` chat tool) is
  the index. Aggregating every session behind one no-login link is a much larger
  blast radius on leak.
- **No revocation / expiry in v1.** The plain capability URL was chosen over the
  revocable/expiring variant. Because the token is **magi-minted**, magi can add
  revocation later with zero papai change.
- **No per-event redaction.** magi ships raw ACP verbatim (its stated non-goal);
  papai does not add redaction. See Residual risk.
- **No write actions from the viewer** (approve/deny, follow-up, cancel). All stay
  in chat.
- **No authed settings-side session browser** in v1 (deferred; see Future work).

## Decisions (from brainstorming)

| Question            | Decision                                                                |
| ------------------- | ----------------------------------------------------------------------- |
| Link trust model    | Capability URL — unguessable token, no login; possession = read access  |
| Who mints the token | **magi**, at session creation, returned in the `start_session` response |
| MR attachment       | magi embeds `<papaiBase>/t/<token>` in the PR body when it opens the PR |
| Streaming path      | **papai proxies**; magi stays private behind papai's `magi_token`       |
| Viewer capability   | **Read-only**; approvals stay in chat                                   |
| Recall model        | Direct stable links only; no aggregated / public index                  |
| Viewer build        | Dedicated Svelte SPA bundle reusing `client/shared/`                    |

## Contract with magi (precondition — separate magi-side spec)

This papai spec depends on the following magi changes. They are **not** built
here; they are the interface papai codes against.

1. **`shareToken` + `transcriptUrl` in session-creation responses.**
   `POST /sessions` (and `POST /sessions/:id/follow-up`, `POST /reviews`) return a
   crypto-random, unguessable `shareToken: string` **and** the full
   `transcriptUrl: string` (`<papaiBase>/t/<token>`). magi is the single source of
   truth for the URL format — it already needs papai's public base to embed the
   link in the PR (item 2), so it returns the finished URL rather than making
   papai rebuild it. papai relays `transcriptUrl` verbatim and needs no base
   config of its own. Each session (including a follow-up child) has its own token
   → its own transcript → its own link.

2. **magi embeds the transcript URL in the PR.** When magi opens the PR it writes
   the same `transcriptUrl` into the PR body/footer (e.g. "Watch this session:
   …"). magi derives it from its own config, papai's public viewer base
   (`MAGI_TRANSCRIPT_BASE_URL`).

3. **Token-scoped read endpoints** mirroring the two session-id endpoints already
   built, bearer-authed:
   - `GET /t/:token/stream` (SSE live tail)
   - `GET /t/:token/transcript?after=<seq>&limit=<n>` (paginated history)

   magi resolves `token → session` internally and `404`s unknown tokens. This is
   the load-bearing simplification: **papai stores no mapping and blind-proxies
   the opaque token**.

   _Rejected alternative:_ magi returns only `sessionId` and papai stores a
   `token → sessionId` map, proxying the id-keyed endpoints. That forces papai to
   own a token store and exposes the raw session id in the proxy path. The
   token-keyed endpoints keep papai thin and the session id private.

## Architecture

```
  chat: "fix X"
      │  LLM tool call: start_session
      ▼
 ┌──────────────┐   POST /sessions          ┌───────────────────────────┐
 │  acp plugin  │ ────────────────────────▶ │           magi            │
 │ (plugins/acp)│ ◀──────────────────────── │  mints shareToken,        │
 └──────┬───────┘   { …, shareToken }        │  records transcript,      │
        │ store token on SessionRecord       │  embeds <base>/t/<token>  │
        │ return transcriptUrl in tool result│  in PR body               │
        ▼                                    └──────────┬────────────────┘
  model posts live link to chat                         │ bearer-authed, private
                                                        │  GET /t/:token/stream
  ── browser opens <papaiBase>/t/<token> ──             │  GET /t/:token/transcript
        │                                               │
        ▼                                               │
 ┌───────────────────────────────┐  proxy (magi_token) │
 │  papai core public routes      │ ────────────────────┘
 │  src/debug/transcript-viewer/  │
 │   GET /t/:token        (SPA)   │
 │   GET /t/:token/stream (SSE ↔) │ ◀── long-lived proxy, NOT httpFetch (30s cap)
 │   GET /t/:token/transcript(JSON)│
 └──────────────┬────────────────┘
                │ serves + streams
                ▼
 ┌───────────────────────────────┐
 │  viewer SPA (client/transcript)│  stitch(history, live) by seq; render timeline
 └───────────────────────────────┘
```

Three papai concerns, each independently understandable and testable: the
**plugin** learns the token and surfaces the link; the **core proxy routes**
bridge a public browser to private magi; the **viewer SPA** renders the event
stream. They communicate only through the token (plugin→magi→proxy) and the
raw event wire format (magi→proxy→SPA).

## Components

### 1. acp plugin (`plugins/acp/`)

- `start_session`, `continue_session`, and `review_pr` read `shareToken` and
  `transcriptUrl` from magi's response and store them on the `SessionRecord`
  (`plugins/acp/history.ts` gains `shareToken?: string` and `transcriptUrl?:
string`).
- The tools already return magi's raw response object to the model, so
  `transcriptUrl` reaches the model with no reshaping; the `/acp` prompt fragment
  (`plugins/acp/`) is updated to instruct the agent to share the live link when a
  session starts.
- **Back-compat:** an older magi that omits the fields yields no `transcriptUrl`;
  the tool result and prompt degrade gracefully (no link, no error). No static
  bare-module imports (discovery rejects them) — the fields are read with a manual
  guard, consistent with the plugin's existing JSON-Schema style.
- `list_sessions` includes `transcriptUrl` per row when the local record has a
  token (no extra magi call — reuses the record it already merges).

### 2. Public proxy routes (papai core — `src/debug/transcript-viewer/`)

New module mounted in `routeRequest` (`src/debug/server.ts`) **before** the
dashboard-auth gate — alongside `/settings` and `/api/notify`, which are already
public-first. All three routes are unauthenticated at the papai layer
(possession of the token is the authorization) and attach `magi_token`
**server-side only** (never sent to the browser):

- **`GET /t/:token`** → serves the viewer SPA static bundle (`handleClientFile`).
- **`GET /t/:token/stream`** → **long-lived SSE proxy** to
  `${magiBaseUrl}/t/${token}/stream`. This is the one genuinely new piece of
  infra. It **must not** use `providerRuntime.httpFetch` (hard `AbortSignal.
timeout(30_000)`, `src/plugins/provider-runtime.ts`). It uses a dedicated
  streaming fetch:
  - no short timeout (a session can run for many minutes);
  - pipes the upstream `Response.body` `ReadableStream` straight to the client
    response, forwarding magi's `: keepalive` comments and the terminal
    `event: end`;
  - on client disconnect (`ReadableStream.cancel()`), aborts the upstream fetch
    so no magi connection leaks;
  - a bounded max lifetime is acceptable — the viewer auto-reconnects and
    re-stitches (below).
- **`GET /t/:token/transcript?after&limit`** → short-lived JSON proxy to
  `${magiBaseUrl}/t/${token}/transcript`; an ordinary fetch is fine here.
- **404 passthrough:** magi's `404` for an unknown token is returned verbatim so
  the viewer can show "link expired or invalid."
- **SSRF / allowlist:** the magi host is the same admin-config-allowlisted host
  the plugin already uses; the proxy targets only the two fixed token-scoped
  paths — no user-controlled path segment beyond the opaque token, so no path
  traversal into other magi endpoints.

**Credential wiring (resolved).** The magi base URL + token live in **acp plugin
admin config** (`plugins/acp/plugin.json` `configRequirements`, keys
`magi_base_url` / `magi_token`, `scope: 'admin'`). The core proxy reads them
directly with the existing plugin-agnostic accessor
`getPluginAdminConfig('acp', key)` (`src/plugins/store.ts`) — the same store the
plugin runtime's `adminConfig` facade delegates to, so the two cannot drift. No
new config surface is added.

### 3. Viewer client (`client/transcript/`)

A new Svelte SPA bundle, reusing `client/shared/` (tokens, base CSS,
components), added to `BUNDLES` in `scripts/build-client.ts` with matching
`handleClientFile('transcript', …)` routing in `src/debug/server.ts`.

**Load / stitch (magi's documented order — race-free):**

1. Open `EventSource('/t/:token/stream')` first and buffer live events.
2. `GET /t/:token/transcript?after=-1`, paging until `nextCursor` is `null`.
3. Concatenate, dropping any live event whose `seq` ≤ the max `seq` from history;
   `seq` monotonicity makes this exact — no gap, no dupe. Then flush the buffer.

**Rendering** (raw ACP events → timeline):

- `update` discriminated by `payload.sessionUpdate`:
  - `agent_message_chunk` → markdown message text;
  - `agent_thought_chunk` → collapsible reasoning;
  - `tool_call` / `tool_call_update` → tool name, status, and diff/args;
  - `plan` → checklist.
- `permission_request` / `permission_decision` → **read-only** status chip
  ("asked to run X — approved in chat" / "denied in chat"). No buttons.
- `result` → final stop reason + token-usage summary.
- `end` → mark the session finished, stop reconnecting.

**States:** connecting · live (streaming) · finished (replay) · recording-
disabled (magi's `recording: "disabled"` marker → "transcript not retained,
live only") · invalid-token (`404` → "link expired or invalid").

**Reconnect:** on `EventSource` error while not finished, reconnect and re-stitch
from the last seen `seq` (re-fetch history with `after=<lastSeq>`), covering
laptop sleep / network blips and any proxy max-lifetime cap.

### 4. Configuration

- **papai** needs **no** new base-URL config. The proxy takes the token from the
  inbound request path and reads magi's base URL + bearer from the acp plugin's
  existing admin config (`magi_base_url` / `magi_token`, via
  `getPluginAdminConfig('acp', …)`).
- **`MAGI_TRANSCRIPT_BASE_URL`** (magi) — papai's public viewer origin, on magi's
  side, so magi builds the `transcriptUrl` it returns to papai and embeds in the
  PR. (magi-side; listed here for completeness.)

## Data flow (end to end)

1. User asks for a change → LLM calls `start_session`.
2. papai → magi `POST /sessions`. magi creates the session, mints `shareToken`,
   launches the run.
3. magi's response carries `shareToken` + `transcriptUrl`. papai stores both on
   the `SessionRecord`; the tool returns magi's raw response, so `transcriptUrl`
   reaches the model unmodified.
4. The model replies in chat including the live link (prompt fragment nudges it).
5. magi records transcript events (hub + file). When it opens the PR it embeds
   the same `transcriptUrl` in the PR body.
6. Someone opens `<papaiBase>/t/<token>`:
   - the browser loads the viewer SPA (papai static);
   - `EventSource → /t/:token/stream → papai proxy → magi` streams live;
   - the viewer also fetches `/t/:token/transcript` (proxied) and stitches;
   - on terminal `end` the viewer shows "finished"; reopening the same URL later
     gets an immediate `end` on the stream and renders purely from history.

## Error handling & edge cases

- **Unknown / invalid token** → magi `404` → proxy `404` → viewer "link expired
  or invalid."
- **Recording disabled** → history returns `recording: "disabled"`; live still
  works (magi's hub is independent). Viewer shows "transcript not retained, live
  only."
- **magi unreachable** → proxy `502` → viewer "temporarily unavailable, retrying."
- **Client disconnect** → proxy cancels the upstream fetch; no leaked magi
  connection (asserted in tests).
- **30s-timeout trap** → the stream route explicitly does not use the standard
  `httpFetch`; a regression here silently truncates every session at 30s, so it is
  called out in the plan and covered by a test.
- **Corrupt / partial JSONL** → magi's reader already skips unparseable lines and
  keeps `seq` gaps visible; the viewer tolerates `seq` gaps (they are expected by
  design).
- **Terminal session, late viewer** → immediate `end`, pure historical render.

## Security

- **Capability token** — high-entropy, magi-minted; the URL is a secret (like an
  unlisted Gist). papai treats it as opaque and never logs it.
- **Read-only** — no write/approval/cancel path exists in the viewer or its
  proxy; actions happen only in chat, where identity and `whoMayUse` are enforced.
- **`magi_token` never leaves the server** — attached in the proxy, never in any
  response to the browser.
- **Public-but-narrow** — `/t/*` is mounted before auth but proxies only the two
  fixed token-scoped magi paths; the token is the only user-controlled segment.

### Residual risk (call out in review, not solved here)

The transcript is **raw ACP with no per-event redaction** (magi's stated
non-goal). Under a no-login capability link, anyone who obtains the URL sees
everything the agent saw and did, including any secret that surfaced in tool
output. Mitigations deferred to Future work: per-event redaction, link
expiry/revocation (magi-side, since magi mints the token). v1 relies on the
token being unguessable and treated as sensitive.

## Testing

TDD-first, per repo hooks.

- **Proxy routes** (`src/debug/transcript-viewer/`): token forwarded verbatim to
  magi; `magi_token` attached server-side and never in the response; SSE bytes
  piped through including keepalive + `end`; client disconnect cancels the
  upstream (no leak); `404` passthrough; historical JSON passthrough; a guard
  test asserting the stream route does **not** use the 30s-cap fetch.
- **acp plugin**: `start_session` stores `shareToken` and returns
  `transcriptUrl`; `list_sessions` surfaces it; back-compat when magi omits the
  field (no URL, no throw).
- **Viewer client**: stitch dedupe by `seq` (history + live, no gap/dupe);
  per-type event rendering; `end` handling; each error state (invalid token,
  recording-disabled, unreachable); reconnect re-stitch. Storybook stories per
  the screenshot pipeline (`docs/architecture/storybook-screenshots.md`) for the
  timeline and each state.

## Files

- **New:**
  - `src/debug/transcript-viewer/` — proxy route handlers (SPA serve, SSE proxy,
    history proxy) + shared magi-config accessor.
  - `client/transcript/` — viewer SPA (`TranscriptApp.svelte`, event renderers,
    stitch logic, fetcher schemas).
  - `tests/debug/transcript-viewer/*`, `tests/…` for the client stitch/render.
- **Touched:**
  - `plugins/acp/history.ts` — `shareToken` / `transcriptUrl` on `SessionRecord`.
  - `plugins/acp/tools.ts`, `plugins/acp/continue-tool.ts`,
    `plugins/acp/session-tools.ts` — read token, return `transcriptUrl`.
  - `plugins/acp/` prompt fragment — nudge sharing the live link.
  - `src/debug/server.ts` — mount the `/t.*` + `/t/*` public dispatcher before the
    auth gate.
  - `scripts/build-client.ts` — `BUNDLES` entry for `transcript`;
    `scripts/check-bundle-isolation.ts` — add `public/transcript.js`.
- **Docs:** `docs/architecture/coding-sessions.md` — a "Transcript viewer"
  section; `docs/architecture/environment.md` — note `MAGI_TRANSCRIPT_BASE_URL`
  is a magi-side var (papai adds none).

## User stories

1. **Watch it think.** A user starts a session; the chat reply includes a live
   link. Opening it shows the agent's messages, thoughts, tool calls, and diffs
   streaming in — a glass box instead of a spinner.
2. **Share with a reviewer.** The PR magi opens carries the same link in its body;
   a teammate with no papai account clicks it and watches or replays the session.
3. **Revisit and audit.** Reopening the link after the session ends replays the
   full transcript through the identical renderer.
4. **Survive a blip.** A laptop sleep drops the stream; the viewer reconnects and
   re-stitches by `seq` with no gap or dupe.

## Future work

- Authed "Coding sessions" index section in the `/settings` SPA (browse a
  context's sessions + copy links behind login).
- Link expiry / revocation (magi-side; the token is already magi-owned).
- Per-event redaction of secrets in the transcript.
- Approve/deny from the viewer, gated behind real identity auth (would require
  abandoning the pure capability-URL model).
- Richer `tool_call` rendering (diff/args) and a real `plan` checklist are
  deferred — the v1 timeline shows tool name + status and renders plan/unknown
  payloads as raw JSON.
