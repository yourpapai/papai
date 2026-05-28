<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Settings Web UI — Auth & Session Spec

**Date:** 2026-05-28
**Status:** Draft spec
**Parent:** [`2026-05-28-settings-web-ui-overview-design.md`](./2026-05-28-settings-web-ui-overview-design.md)

## Scope

How a chat user obtains a settings session: one-time code issuance from
the `/config` command, the exchange endpoint, session lifetime and
cookies, CSRF, rate limiting, and the strict separation between the
per-user settings auth domain and the operator `DEBUG_TOKEN` domain —
all on the **same** `Bun.serve()` listener (`src/debug/server.ts`).

This spec deliberately stops at "an authenticated principal exists with
a resolved scope". What that principal may *do* is sub-spec 3.

## Threat model

The settings URL is sent over a chat channel and opened in a browser on
an untrusted network. Therefore:

- A code is a **bearer secret in transit**. It must be high-entropy,
  single-use, short-lived, and bound so a leak is low-impact.
- The listener also serves `/debug` and `/admin`, which are
  operator-only. A settings code or session must **never** satisfy the
  `DEBUG_TOKEN` checks, and vice versa.
- Codes are issued per `(platformInstanceId, platformUserId)`. A code
  must not be replayable against a different instance or user.

## Concept: code vs session

Two distinct artifacts:

1. **One-time code (`code`)** — issued by the chat command, embedded in
   the URL query string, valid once, short TTL (proposed **10 minutes**).
   Its only power is to be exchanged for a session. It carries no
   long-lived authority and is never accepted on API routes.
2. **Session** — created at exchange time, delivered as an **httpOnly,
   Secure, SameSite=Lax** cookie scoped to the `/settings` path. Carries
   the resolved principal and a longer TTL (proposed **30–60 minutes**,
   sliding). All `/settings/api/*` calls authenticate via this cookie.

Separating the two means the secret that travels through chat is
useless after first use, and the browsing credential never appears in a
URL, history, or referrer.

## Code issuance (from chat)

Triggered by the surviving `/config` launcher (sub-spec 6). At issuance:

- Generate ≥ 256 bits of entropy (`crypto.getRandomValues`), encode
  URL-safe (base64url). Store only a **hash** of the code (e.g. SHA-256),
  never the plaintext, mirroring how secrets are handled elsewhere.
- Bind the row to: `platformInstanceId`, `platformUserId`, the resolved
  scope snapshot at issuance time (or enough to re-resolve at exchange —
  see §"When is scope resolved"), `createdAt`, `expiresAt`, `usedAt`
  (null until consumed).
- Reply with the URL. The reply should warn it is single-use and
  short-lived. On platforms that support message deletion, consider
  redacting the message after exchange (reuse `redactMessage` capability
  detection already in `src/chat/`).
- Re-issuing supersedes/expires the user's prior unused codes (avoid a
  pile of live codes).

### Proposed storage table

```sql
CREATE TABLE settings_auth_codes (
  code_hash             TEXT PRIMARY KEY,   -- SHA-256 of the URL-safe code
  platform_instance_id  TEXT NOT NULL,
  platform_user_id      TEXT NOT NULL,
  created_at            INTEGER NOT NULL,
  expires_at            INTEGER NOT NULL,
  used_at               INTEGER             -- NULL until exchanged
);
```

New Drizzle migration (next number in `src/db/migrations/`). Keep it in
its own schema file (e.g. `src/db/settings-auth-schema.ts`) following the
`instance-schema.ts` / `plugin-schema.ts` pattern.

## Exchange endpoint

`POST /settings/auth/exchange` with `{ code }` (body, not query, so it
isn't logged):

1. Hash the code, look up the row. Reject if missing, expired, or
   `used_at` is set. Always constant-time/uniform error to avoid
   oracles; rate-limit (see below).
2. Atomically mark `used_at` (single-use; race-safe via conditional
   UPDATE).
3. Resolve the principal & scope (see next section).
4. Create a session, set the cookie, return minimal bootstrap JSON
   (principal display, available context list, role) — never secrets.

The code is accepted **only** here. No other route reads `code`.

## When is scope resolved (and re-resolved)

Authorization is dynamic (admins added/removed, groups authorized,
membership changes). Decision for this spec:

- **Resolve at exchange and on each request.** Store enough on the
  session to identify the principal (`platformInstanceId`,
  `platformUserId`), and recompute the live scope per request using the
  existing authorization stores (sub-spec 3), so revocations take effect
  without waiting for session expiry. The code row stores identity, not a
  frozen capability grant.

## Sessions

### Storage (OQ2)

Two viable options; this spec recommends **SQLite-backed sessions** for
durability across bot restarts (the bot is long-lived but restarts on
deploy, and an in-flight settings session surviving a restart is good
UX). In-memory is simpler but loses sessions on restart and complicates
multi-process futures.

Proposed table:

```sql
CREATE TABLE settings_sessions (
  session_id_hash       TEXT PRIMARY KEY,   -- hash of the cookie value
  platform_instance_id  TEXT NOT NULL,
  platform_user_id      TEXT NOT NULL,
  created_at            INTEGER NOT NULL,
  expires_at            INTEGER NOT NULL,    -- sliding; bumped on activity
  csrf_token_hash       TEXT NOT NULL
);
```

Store only a hash of the session id (the cookie holds the plaintext).

### Cookie attributes

`httpOnly; Secure; SameSite=Lax; Path=/settings; Max-Age=<ttl>`.
`Secure` requires HTTPS — consistent with the exposure requirement
below. `SameSite=Lax` plus an explicit CSRF token covers cross-site
write protection.

### CSRF

State-changing routes (`POST`/`PATCH`/`DELETE` under `/settings/api/*`)
require a CSRF token. Pattern: issue a CSRF token at exchange (stored
hashed on the session), expose it to the SPA in the bootstrap response
(readable by JS, not in an httpOnly cookie), and require it in a header
(e.g. `X-Settings-CSRF`) on writes. Double-submit or
synchronizer-token — either is acceptable; document the chosen one in
the implementation plan.

### Logout / revocation

`POST /settings/auth/logout` deletes the session row and clears the
cookie. Bot admins may need a "revoke all settings sessions" action
(sub-spec 4) — e.g. when de-authorizing a user.

## Trust isolation from `DEBUG_TOKEN` (critical)

On the shared listener:

- `/settings/*` routes are gated **exclusively** by the settings session
  cookie. They must **not** consult `DEBUG_TOKEN` and must **not** be
  reachable with only a `DEBUG_TOKEN` bearer (operator credential ≠ a
  user's personal context).
- `/debug`, `/admin`, `/api/*`, `/admin/llm`, `/stats/*` keep their
  current `DEBUG_TOKEN` gating (`isAuthorizedRequest` in
  `src/debug/server.ts`). A settings session cookie must **not** satisfy
  those checks.
- Bot-admin actions exposed through the settings UI (sub-spec 3/4) are
  authorized by the *principal's bot-admin status*, not by `DEBUG_TOKEN`.
  This is the one place the two surfaces overlap in capability; they
  remain separate in mechanism.

Concretely: the request router must branch on path prefix first
(`/settings/*` → session auth; everything else → existing token auth),
with no shared "is authorized" fallthrough between the two.

## Rate limiting & abuse

- Throttle `POST /settings/auth/exchange` per source IP and per
  `code_hash` lookup miss to blunt brute force (codes are high-entropy,
  so this is defense-in-depth). The repo already has a rate-limit
  pattern in `src/web/` to model the shape after.
- Throttle code issuance per user to prevent reply spam.
- Uniform error responses on exchange failure (no distinction between
  "unknown", "expired", "used").

## Exposure / TLS (OQ1)

The link is only useful if the listener is reachable by the user's
browser over HTTPS. Today `src/debug/server.ts` defaults to bind
`127.0.0.1` and has no TLS. Open items for the deployment plan (not code
in the first slice):

- A way to make the settings surface reachable: bind a public interface
  and/or document a reverse proxy (TLS-terminating) in front of the
  existing port. Because `/debug` + `/admin` are operator-only, the
  proxy config must expose `/settings/*` publicly while keeping the
  operator paths restricted (network ACL or separate proxy route).
- `Secure` cookies + the absolute URL in the chat reply both require a
  known external base URL — introduce a config value (e.g.
  `SETTINGS_PUBLIC_BASE_URL`) used to build the link and to set cookie
  scope/`Secure`.

## Open questions

- OQ-A1 — Should sessions be SQLite-backed (recommended) or in-memory?
  Confirm at implementation.
- OQ-A2 — CSRF strategy: synchronizer token vs double-submit cookie.
- OQ-A3 — Reverse-proxy vs direct public bind for the shared listener;
  how operator paths stay private once the listener is publicly routed.
- OQ-A4 — Code/session TTLs (proposed 10 min / 30–60 min sliding).
- OQ-A5 — Whether to auto-redact the chat message containing the URL
  after successful exchange, where the platform supports deletion.
