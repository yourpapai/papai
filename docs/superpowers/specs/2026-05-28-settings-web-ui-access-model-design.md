<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Settings Web UI — Access Model Spec (Auth, Session & Permissions)

**Date:** 2026-05-28
**Status:** Draft spec
**Parent:** [`2026-05-28-settings-web-ui-design.md`](./2026-05-28-settings-web-ui-design.md)

## Scope

The complete access model for the settings UI, in two parts:

- **Part A — Auth & Session:** how a chat user obtains a settings
  session — one-time code issuance from the `/config` command, the
  exchange endpoint, session lifetime and cookies, CSRF, rate limiting,
  and the strict separation between the per-user settings auth domain and
  the operator `DEBUG_TOKEN` domain — all on the **same** `Bun.serve()`
  listener (`src/debug/server.ts`).
- **Part B — Permission & Scope Model:** given an authenticated
  principal, how the server resolves live capabilities, how the UI
  switches between editable **contexts** (personal vs each managed
  group), and the exact capability matrix per tier. This is the authority
  for the server-side scope guard that every write route in the Surface
  spec must call.

Part A deliberately stops at "an authenticated principal exists with a
resolved scope"; Part B defines what that principal may _do_.

## Resolved decisions (2026-05-28)

The blocking open questions from the first research pass are now settled;
the bodies below reflect these, and the Open Questions section records the
rationale and the rejected alternatives:

- **Session store (OQ-A1 / overview OQ2):** SQLite-backed, via a new
  Drizzle migration (next number: `047_`). Consistent with the rest of
  the repo (rate-limit, instances, plugins are all SQLite) and survives
  restarts.
- **CSRF (OQ-A2):** synchronizer token — stored hashed on the
  `settings_sessions` row, returned once in the bootstrap response, and
  required in the `X-Settings-CSRF` header on writes. Double-submit is
  unnecessary once sessions are server-side.
- **TTLs (OQ-A4):** one-time code = **10 minutes**, single use; session =
  **60 minutes sliding** (bumped on activity).
- **Exposure / TLS (OQ-A3 / overview OQ1):** reverse-proxy model. The bot
  keeps binding `127.0.0.1`; a TLS-terminating reverse proxy exposes
  `/settings/*` publicly and keeps `/debug` + `/admin` private (proxy
  rule or network ACL). A new `SETTINGS_PUBLIC_BASE_URL` config builds
  the link and scopes the `Secure` cookie. No bind/TLS code lands in the
  first slice — only the base-URL config.

---

# Part A — Auth & Session

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
   the URL query string, valid once, short TTL (**10 minutes**, resolved).
   Its only power is to be exchanged for a session. It carries no
   long-lived authority and is never accepted on API routes.
2. **Session** — created at exchange time, delivered as an **httpOnly,
   Secure, SameSite=Lax** cookie scoped to the `/settings` path. Carries
   the resolved principal and a longer TTL (**60 minutes** sliding,
   resolved). All `/settings/api/*` calls authenticate via this cookie.

Separating the two means the secret that travels through chat is
useless after first use, and the browsing credential never appears in a
URL, history, or referrer.

## Code issuance (from chat)

Triggered by the surviving `/config` launcher (Command Retirement spec).
At issuance:

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
3. Resolve the principal & scope (see §"When is scope resolved", and
   Part B for the resolution rules).
4. Create a session, set the cookie, return minimal bootstrap JSON
   (principal display, available context list, role) — never secrets.

The code is accepted **only** here. No other route reads `code`.

## When is scope resolved (and re-resolved)

Authorization is dynamic (admins added/removed, groups authorized,
membership changes). Decision for this spec:

- **Resolve at exchange and on each request.** Store enough on the
  session to identify the principal (`platformInstanceId`,
  `platformUserId`), and recompute the live scope per request using the
  existing authorization stores (Part B), so revocations take effect
  without waiting for session expiry. The code row stores identity, not a
  frozen capability grant.

## Sessions

### Storage (resolved: SQLite — OQ-A1)

**Resolved: SQLite-backed sessions**, for durability across bot restarts
(the bot is long-lived but restarts on deploy, and an in-flight settings
session surviving a restart is good UX). In-memory was the rejected
alternative — simpler, but loses sessions on restart and complicates
multi-process futures. The session table lands in the same `047_`
migration as `settings_auth_codes`.

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
(e.g. `X-Settings-CSRF`) on writes. **Resolved (OQ-A2): synchronizer
token** — stored hashed on the session row (`csrf_token_hash` above),
returned once in bootstrap, and verified per write. Double-submit was the
rejected alternative (unnecessary once sessions are server-side).

### Logout / revocation

`POST /settings/auth/logout` deletes the session row and clears the
cookie. Bot admins may need a "revoke all settings sessions" action
(Surface spec, admin tier) — e.g. when de-authorizing a user.

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
- Bot-admin actions exposed through the settings UI (Part B / the Surface
  spec) are authorized by the _principal's bot-admin status_, not by
  `DEBUG_TOKEN`. This is the one place the two surfaces overlap in
  capability; they remain separate in mechanism.

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

## Exposure / TLS (resolved: reverse proxy — OQ-A3)

The link is only useful if the listener is reachable by the user's
browser over HTTPS. Today `src/debug/server.ts` defaults to bind
`127.0.0.1` and has no TLS. **Resolved (OQ-A3 / overview OQ1):
reverse-proxy model.**

- The bot **keeps binding `127.0.0.1`** — no in-process TLS, no public
  bind. A TLS-terminating reverse proxy (nginx/Caddy/Traefik) sits in
  front of the existing port and forwards `/settings/*` publicly while
  keeping `/debug` + `/admin` restricted (a proxy location rule and/or a
  network ACL). The operator surface's localhost-only posture is
  unchanged. Rejected alternative: direct public bind + in-process Bun
  TLS (more in-process code, weaker default isolation of operator paths).
- `Secure` cookies + the absolute URL in the chat reply both require a
  known external base URL — introduce a config value
  `SETTINGS_PUBLIC_BASE_URL` (e.g. `https://bot.example.com`) used to
  build the link and to scope the `Secure` cookie. This is the **only**
  exposure-related change in the first slice; bind/TLS handling stays at
  the proxy and is out of scope for the code.

---

# Part B — Permission & Scope Model

## Principal

A settings principal is `(platformInstanceId, platformUserId)`, resolved
from the session (Part A). From it we derive, **per request** (not cached
on the session — see Part A §"When is scope resolved"):

| Property          | Source                                                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `isBotAdmin`      | `isAdmin(userId, platformInstanceId)` — `src/instances/admin-store.ts` (super or platform admin)                                        |
| `isSuperAdmin`    | `isSuperAdmin(userId)`                                                                                                                  |
| authorized?       | `isAuthorized(userId, platformInstanceId)` — `src/users.ts`                                                                             |
| manageable groups | groups where the principal is group admin / member-with-rights (`src/group-settings/access.ts` `listManageableGroups`, `src/groups.ts`) |

This mirrors `checkAuthorizationExtended` in `src/auth.ts`. The settings
layer should reuse that function (or a thin variant of it) rather than
re-implement the decision tree, so chat and web stay consistent.

## Context model

papai config is keyed by `storageContextId`, but **config** edits target
the _config context_ (thread suffix stripped). The mapping helpers
already exist in `src/chat/scoped-context.ts`:

- Personal context: `toScopedContextId({ platformInstanceId, nativeContextId: userId })`
- Group config context: `getConfigContextIdFromStorageContextId(groupStorageContextId)`

The settings UI presents a **context switcher** whose options are:

1. **Personal** — always available to an authorized principal.
2. **Each managed group** — from `listManageableGroups(principal)`.

Every config/tool/MCP/plugin read & write carries the selected
`contextId`. The server validates that the principal is allowed to act on
that context (reuse `src/group-settings/target-validation.ts`
`getValidatedDmTargetContextId` semantics) before touching any store.

## The scope guard

A single server-side guard, called by every `/settings/api/*` handler
before it reads/writes. Conceptually:

```
requireScope(principal, {
  action: 'read' | 'write',
  target: { kind: 'personal' } | { kind: 'group', contextId } | { kind: 'admin' },
}) -> resolved contextId | 403
```

Rules:

- `kind: 'personal'` → allowed for any authorized principal; resolves to
  the principal's personal config context. A principal may only edit
  **their own** personal context — never another user's, even a
  bot admin (admins manage _system/instance_ config, not other users'
  personal preference contexts, through the user-tier routes; cross-user
  changes go through admin-tier routes explicitly).
- `kind: 'group'` → allowed only if `contextId` ∈
  `listManageableGroups(principal)` **or** principal is bot admin.
- `kind: 'admin'` → allowed only if `principal.isBotAdmin` (some
  sub-actions require `isSuperAdmin`, e.g. plugin approve/reject and
  admin-roster changes — match current `/plugin` and `/user` gating).

The guard returns the concrete, validated `contextId` the handler must
use, so handlers never trust a client-supplied context blindly.

## Capability matrix

Legend: ✓ allowed, ✗ denied, (own) = only the principal's own context,
(mg) = only managed groups, (SA) = super-admin only.

| Capability                                                           | Regular user | Group admin | Bot admin |
| -------------------------------------------------------------------- | :----------: | :---------: | :-------: |
| Edit personal `timezone`                                             |   ✓ (own)    |   ✓ (own)   |  ✓ (own)  |
| Edit personal task-provider creds (`kaneo_apikey`, `youtrack_token`) |   ✓ (own)    |   ✓ (own)   |  ✓ (own)  |
| Personal tool toggles (`tool_prefs`)                                 |   ✓ (own)    |   ✓ (own)   |  ✓ (own)  |
| Personal MCP endpoints                                               |   ✓ (own)    |   ✓ (own)   |  ✓ (own)  |
| Personal plugin enable/disable                                       |   ✓ (own)    |   ✓ (own)   |  ✓ (own)  |
| Identity mapping (own context)                                       |   ✓ (own)    |   ✓ (own)   |  ✓ (own)  |
| Group config (timezone/creds/tools/MCP)                              |      ✗       |   ✓ (mg)    |     ✓     |
| Group plugin enable/disable                                          |      ✗       |   ✓ (mg)    |     ✓     |
| Group task-instance selection                                        |      ✗       |   ✓ (mg)    |     ✓     |
| Group member add/remove (`group_members`)                            |      ✗       |   ✓ (mg)    |     ✓     |
| Authorize/de-authorize groups (`authorized_groups`)                  |      ✗       |      ✗      |     ✓     |
| Authorized users add/remove (`users`)                                |      ✗       |      ✗      |     ✓     |
| Admin roster (super/platform admins)                                 |      ✗       |      ✗      |  ✓ (SA)   |
| Platform/task instances CRUD                                         |      ✗       |      ✗      |     ✓     |
| System LLM config                                                    |      ✗       |      ✗      |     ✓     |
| Plugin approve/reject                                                |      ✗       |      ✗      |  ✓ (SA)   |
| Announce to all users                                                |      ✗       |      ✗      |     ✓     |

This matrix is the canonical reference for the route table and the
section gating in the Surface spec.

## Config-field visibility

Within an allowed context, the _set of editable config fields_ is still
computed by `getConfigFieldsForContext(contextId)` (`src/config-keys.ts`),
which already filters by the context's assigned task provider and hides
reserved keys (e.g. `kaneo_workspace_id`). The UI must render fields from
this function rather than a hardcoded list, so provider differences
(Kaneo vs YouTrack vs plugin providers) flow through unchanged.

Sensitive fields (`isSensitiveKey`) are masked on read (mirror
`maskSensitiveValue`) and write-only on update.

## Consistency requirement

Because chat-side authorization and web-side authorization must never
diverge, the implementation should:

- Reuse `checkAuthorizationExtended` / the `src/instances/admin-store.ts`,
  `src/users.ts`, `src/authorized-groups.ts`, `src/groups.ts` stores
  directly.
- Reuse `src/group-settings/access.ts` + `target-validation.ts` for the
  manageable-group set and target validation.
- Add no parallel permission tables. The web layer is a new _caller_ of
  existing authorization, not a new authority.

---

## Open questions

### Auth & session

- OQ-A1 — **[RESOLVED 2026-05-28]** Session store: **SQLite-backed**
  (rejected: in-memory). See §Resolved decisions and §Sessions.
- OQ-A2 — **[RESOLVED 2026-05-28]** CSRF: **synchronizer token** stored
  hashed on the session (rejected: double-submit cookie). See §CSRF.
- OQ-A3 — **[RESOLVED 2026-05-28]** Exposure: **reverse proxy**; the bot
  stays bound to `127.0.0.1` and `SETTINGS_PUBLIC_BASE_URL` configures the
  public link/cookie scope (rejected: direct public bind + Bun TLS). See
  §Exposure / TLS.
- OQ-A4 — **[RESOLVED 2026-05-28]** TTLs: **code 10 min** (single use),
  **session 60 min sliding** (bumped on activity).
- OQ-A5 — _(open)_ Whether to auto-redact the chat message containing the
  URL after successful exchange, where the platform supports deletion.

### Permission & scope

- OQ-P1 — Should a bot admin be able to edit _another user's_ personal
  context through the UI (impersonation-style support), or strictly only
  system/instance/authorization config? This spec assumes the latter;
  confirm.
- OQ-P2 — Group "admin" definition for the web context switcher: today it
  derives from `isPlatformAdmin`-in-context + `listManageableGroups`.
  Confirm whether web sessions (which lack live chat-platform admin
  signals) can determine group-admin status purely from stored state, or
  need a cached `isGroupAdmin` snapshot taken at code-issuance time in
  chat.
