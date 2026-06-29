<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0224: Remove Debug Log Redaction

## Status

Implemented

## Date

2026-06-29

## Context

The debug dashboard's Log Explorer was effectively unreadable: `redactLogEntry`
(`src/debug/log-redaction.ts`) applied a default-deny allowlist of ~20 structured fields
plus a 2-entry `SAFE_MSG_TEMPLATES` set, so almost every log line rendered as `[redacted]`.
The allowlist was hardcoded, not runtime-configurable, and drifted.

Redaction was also the only privacy control that worked by hiding _content_. Every other
dashboard panel (Turns, Sessions, LLM Trace, Notifications, Tool Failures, Live Context) is
fed by SSE events gated on _scope visibility_ (`isVisibleToAdmin`, `state-collector.ts:155`),
showing full content for scopes the admin may see. Redaction was a lone, inconsistent gate
on one panel while the rest of the same dashboard streamed full content.

## Decision

Remove log redaction entirely (supersedes ADR-0197 Decision 3, the centralized egress
redactor). Both log egress points — `log:entry` SSE emission (`log-buffer.ts`) and the
`/logs` REST route (`server.ts`) — now return raw entries. `src/debug/log-redaction.ts` is
deleted.

The privacy model for logs becomes _access control + network boundary_:

1. Dashboard session cookie (minted only via the `/dashboard` bot-DM single-use nonce).
2. `DEBUG_HOSTNAME` defaults to `127.0.0.1` (localhost-only).
3. `DEBUG_SERVER` flag (off -> `/logs`, `/events`, `/turns/*`, `/debug` return 404).

Turns and all other SSE panels are unchanged: the `isVisibleToAdmin` gate at
`state-collector.ts:155` already covers both the live SSE stream and the buffers. ADR-0223
(`/turns/:id` scope enforcement) stands on its own and is retained.

## Consequences

### Positive

- The Log Explorer shows real content; search/filter become useful.
- One coherent privacy model: scope-visibility for SSE panels, auth + binding for logs.
- Less code; no hardcoded allowlist to drift.

### Negative / Risks

- **Admin sees all users' content.** Anyone holding the admin session reads every user's
  raw messages, tool args, and errors in the log stream. This knowingly reverses the
  multi-tenant-strict posture: suitable for single-tenant / fully-trusted-operator
  deployments, **not** for shared instances whose end-users expect privacy from the operator.
- **No safety net for accidentally-logged secrets.** The `CLAUDE.md` "never log tokens, API
  keys, session cookies, or other sensitive data" rule is now a load-bearing control, not a
  convention with a backstop. A secret-key ingest serializer is recommended future work.

### Unchanged

The in-memory ring buffer already held unredacted entries, so at-rest exposure is identical;
this only aligns egress with what was already in memory. Still in-memory-only, no external
sink, lost on restart.

## Related Decisions

- ADR-0197: Debug Observability Fixes (introduced the redactor; Decision 3 superseded here).
- ADR-0223: `/turns/:id` Scope Enforcement (turn scope-visibility, retained).
