<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Remove debug log redaction — design

**Date:** 2026-06-29
**Status:** Approved (pending implementation plan)
**Supersedes:** ADR-0197 Decision 3 (centralized egress redactor). Proposed new ADR: **0224**.
**Related:** ADR-0223 (turns lookup scope enforcement) — retained, independent of this change.

## Problem

The debug dashboard's Log Explorer panel is effectively unreadable. Every log line renders as
`[redacted]` because `redactLogEntry` (`src/debug/log-redaction.ts`) applies a default-deny
allowlist: only ~20 structured fields pass, and any `msg` not in a 2-entry `SAFE_MSG_TEMPLATES`
set becomes `[redacted]`. The allowlist is hardcoded, not runtime-configurable, and drifts —
every new safe field is invisible until someone edits source and redeploys.

This redaction is also the **only** privacy gate that works by hiding _content_. Every other
dashboard panel (Turns, Sessions, LLM Trace, Notifications, Tool Failures, Live Context) is fed by
SSE events that are filtered by **scope visibility** (`isVisibleToAdmin`), not redacted — they show
full content for scopes the admin may see. So redaction is a lone, inconsistent control that
cripples one panel while the rest of the same dashboard streams full content.

## Decision

Remove log redaction entirely. Shift the privacy model for logs from _content redaction_ to
_access control + network boundary_:

- **Logs** (`/logs` REST + `log:entry` SSE): fully unredacted to the authenticated admin.
- **Turns and all other SSE panels**: unchanged. They remain gated by `isVisibleToAdmin`
  (`src/debug/state-collector.ts:155`), which already covers both the live SSE stream and the
  in-memory buffers. No change required.

`log:entry` is emitted via `emitGlobal` with `scope: { kind: 'global' }`, which `isVisibleToAdmin`
always passes — so logs already bypass scope filtering. This change makes them bypass content
redaction too, which is the intended "logs fully unfiltered to admin" behavior.

### Approach chosen: hard delete (not flag-gated)

Considered keeping the module behind a default-off `DEBUG_REDACT_LOGS` flag for reversibility.
Rejected: a dormant, untested redaction path rots and gives false confidence. If per-tenant privacy
is needed later, the correct fix is **scope-aware redaction** (resolve each log line to a user/group
scope and gate content on `isVisibleToAdmin`), not resurrecting this allowlist. Keep the tree
honest — delete now, rebuild properly if/when a shared deployment requires it.

## Changes

### Code (2 edits + 1 deletion)

1. **`src/debug/log-buffer.ts`** — remove the `redactLogEntry` import (line 7); change the egress at
   line 63 to emit the raw entry:

   ```ts
   emitGlobal('log:entry', entry as Record<string, unknown>)
   ```

   The ring buffer already stores the raw entry; this stops transforming the emitted copy.

2. **`src/debug/server.ts`** — remove the import (line 16); change the `/logs` handler (line 102):

   ```ts
   return jsonResponse(results)
   ```

3. **Delete `src/debug/log-redaction.ts`** entirely (`redactLogEntry`, `ALLOWED_FIELDS`,
   `SAFE_MSG_TEMPLATES`).

Egress points are exhaustively these two. `/logs/stats` returns only aggregate counters (no
content). The `state:init` SSE backfill contains no log entries; a reconnecting client repolls
`/logs`, and `/logs?before=` pagination runs through the same line-102 handler. No other log egress
exists.

### Turns

No change. Verified: the `isVisibleToAdmin` check at `state-collector.ts:155` returns early for
non-visible scopes, so `turn:start`/`turn:end`/`turn:summary` events are neither buffered nor
broadcast for foreign scopes. The same gate covers `cache:*`, `llm:full`, `reply:sent`, `notify:*`,
and `tool:failure_classified`.

## Security & privacy posture

After this change, the **entire** privacy boundary for log content is:

1. **Dashboard auth** — `HttpOnly; Secure; SameSite=Strict` session cookie, minted only via a
   `/dashboard` bot-DM single-use nonce → `POST /auth/claim`. No session → no `/logs`, no `/events`.
2. **Network binding** — `DEBUG_HOSTNAME` defaults to `127.0.0.1` (localhost-only). Public exposure
   requires deliberately binding a network interface; guidance remains SSH tunnel / Tailscale /
   authenticated reverse proxy.
3. **`DEBUG_SERVER` flag** — when off, `/logs`, `/events`, `/turns/*`, `/debug` return 404.

### Accepted residual risks (documented, not mitigated)

- **Admin sees all users' content.** Anyone holding the admin session reads every user's raw
  messages, tool args, and errors in the log stream. This **knowingly reverses the
  "multi-tenant-strict" posture.** Suitable for single-tenant / fully-trusted-operator deployments;
  **not** suitable for shared instances whose end-users expect privacy from the operator. This is
  the explicit deployment constraint of this design.
- **No safety net for accidentally-logged secrets.** Redaction incidentally dropped non-allowlisted
  fields. With it gone, a token/key mistakenly logged anywhere is visible verbatim in the dashboard.
  The `CLAUDE.md` "never log tokens, API keys, session cookies, or other sensitive data" rule
  becomes a **load-bearing** control, not a convention with a backstop.

### Unchanged

The in-memory ring buffer already held unredacted entries, so at-rest exposure is identical to
today — this only aligns egress with what is already in memory. Still in-memory-only, no external
sink, lost on restart.

### Future work (recommended, NOT in scope here)

A `pino` serializer or Semgrep rule that drops known-secret key patterns (`token`, `apiKey`,
`authorization`, `cookie`, …) at log **ingest**. Protects secrets without reintroducing content
redaction or scope coupling. Left out of this change deliberately; track separately.

## Testing

- **Delete** `tests/debug/log-redaction.test.ts` (function removed).
- **Invert** `tests/debug/logs-route-redaction.test.ts` → `logs-route-content.test.ts`: push an
  entry with `userText` / `contextId` / a free-text `msg`, GET `/logs`, assert all fields are
  present verbatim and no `[redacted]` appears. This becomes the regression guard that redaction
  stays gone.
- **`tests/debug/log-buffer.test.ts:267–294`** — delete the `'log:entry emit redaction'` describe
  block; replace with a test asserting the emitted `log:entry` payload deep-equals the pushed entry.
- **Retain** the turns / `isVisibleToAdmin` scope tests unchanged — they prove dropping log
  redaction did not loosen the turn/SSE scope filter. If no test currently asserts that a
  foreign-scope `turn:*` event is neither buffered nor broadcast, add one as the guard for the
  surviving privacy layer.
- **Manual smoke:** load `/debug`, confirm Log Explorer shows real content instead of `[redacted]`.

## Docs & ADRs

- **New ADR 0224** — "Remove debug log redaction; auth + scope as the privacy boundary." Supersedes
  ADR-0197 Decision 3; states the new boundary and the accepted multi-tenant-reversal constraint;
  references ADR-0223 as still valid.
- **Amend ADR-0223** — update its `redactLogEntry` references (≈ lines 20, 29, 68) to note redaction
  was removed while turn scope-enforcement stands independently.
- **Update `docs/design/admin-debug-dashboard-fixes-spec.md`** — the redaction references
  (≈ lines 216–292) are stale; mark that section superseded by ADR-0224.
- **Update `docs/adr/README.md:202`** — adjust the ADR-0197 line; add the ADR-0224 entry.
- **Leave archives as-is** (`docs/archive/*`, `docs/superpowers/plans/*`) — historical record.
- **No changes** to `dashboard-access.md`, `overview.md`, `environment.md`, `CLAUDE.md` — confirmed
  clean of redaction references.

## Out of scope

- Scope-aware log redaction (resolve log → user scope, gate content). The correct future path for
  shared deployments; not built here.
- Identifier pseudonymization for logs.
- Scope-filtering or auditing of the other SSE panels beyond what already exists.
- The secret-key ingest guard (listed as recommended future work above).
