<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0136: Settings Web UI — Access Model

## Status

Implemented

## Date

2026-05-28 – 2026-06-02

## Context

papai had no web-based settings interface. All configuration happened
through chat commands (`/config`, `/set`, `/plugin`) with inline
callback flows. This was fragile — chat platforms limit interactive
elements, callback flows are hard to extend, and sensitive credential
entry in chat is a poor UX.

The bot already runs a `Bun.serve()` debug/admin server
(`src/debug/server.ts`) gated by `DEBUG_TOKEN`. A settings web UI must
serve non-technical users from the same listener, but its trust domain
must be strictly separate: a chat user's settings session must never
satisfy operator routes, and an operator `DEBUG_TOKEN` must never
satisfy settings routes.

The access model needed to solve two problems:

- **Auth & session** — how a chat user obtains a browser session
  (one-time code from `/config`, exchange, cookies, CSRF, rate
  limiting), and how that session stays isolated from the operator
  domain.
- **Permission & scope** — given an authenticated principal, how the
  server resolves live capabilities per context (personal, group,
  admin) and gates every write route through a single authority.

## Decision Drivers

- **Trust isolation**: Settings sessions and operator `DEBUG_TOKEN` must
  never cross-authenticate — they are separate trust domains on the same
  listener.
- **No parallel authority**: Web-side authorization must reuse the
  existing chat-side stores (`admin-store`, `users`, `authorized-groups`,
  `group-settings/access`), not duplicate them.
- **Revocation immediacy**: Admin removals and group de-authorizations
  must take effect without waiting for session expiry.
- **Bearer-secret safety**: The code travels through chat and must be
  high-entropy, single-use, short-lived, and useless after first
  exchange.
- **Durability**: Sessions must survive bot restarts (the bot is
  long-lived but restarts on deploy).

## Considered Options

### Option A: In-memory sessions

Store sessions in a process-local map. Simpler code, no migration.

- **Pros**: No SQLite schema; trivial implementation.
- **Cons**: Sessions lost on every deploy restart; multi-process
  futures require shared state.

### Option B: SQLite-backed sessions (chosen)

Persist sessions in SQLite alongside the rest of the bot's state.

- **Pros**: Durable across restarts; consistent with repo patterns
  (instances, plugins, rate-limit all use SQLite); no external
  dependency.
- **Cons**: Slightly more complex; one more migration.

### Option C: Double-submit cookie for CSRF

Use the double-submit pattern (cookie + header must match) instead of
a synchronizer token.

- **Pros**: No server-side token storage.
- **Cons**: Unnecessary once sessions are server-side; synchronizer
  token is stronger when server state exists.

### Option D: Direct public bind with in-process TLS

Bind the server to `0.0.0.0` and terminate TLS inside Bun.

- **Pros**: Single process, no reverse proxy.
- **Cons**: More in-process code; weaker default isolation of
  operator-only paths; operator posture changes from localhost-only to
  public.

### Option E: Frozen capability grant on the session row

Store the resolved scope at exchange time and trust it for the
session's lifetime.

- **Pros**: Fewer per-request DB queries.
- **Cons**: Revocations take up to 60 minutes to take effect
  (session TTL); violates the immediacy requirement.

## Decision

**Option B** for session storage, with the following subsidiary
decisions:

| Topic            | Decision                                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code lifecycle   | One-time, 10-minute TTL, SHA-256 hash persisted (never plaintext), single-use (conditional UPDATE), re-issuance supersedes prior unused codes               |
| Session store    | SQLite-backed via migration `048_settings_auth`; sliding 60-minute TTL bumped on activity                                                                   |
| Session cookie   | `httpOnly; Secure; SameSite=Lax; Path=/settings` — never appears in URLs, history, or referrers                                                             |
| CSRF             | Synchronizer token — stored hashed on the session row, returned once at exchange/bootstrap, required in `X-Settings-CSRF` header on writes                  |
| Trust isolation  | Request router branches on `/settings/*` path prefix **before** `DEBUG_TOKEN` check; no shared "is authorized" fallthrough between the two domains          |
| Scope resolution | Per-request recomputation from existing authorization stores; session holds identity only (`platformInstanceId`, `platformUserId`), not frozen capabilities |
| Scope guard      | Single `requireScope(principal, { action, target })` returns validated `contextId` or 403; handlers never trust client-supplied contextIds                  |
| Personal context | Authorized principal edits only their own — bot admins cannot edit another user's personal context through web                                              |
| Group context    | Allowed if `contextId` ∈ `listManageableGroups(principal)` or principal is bot admin                                                                        |
| Admin context    | Allowed only if `principal.isBotAdmin`; super-admin-only sub-actions (plugin approve/reject, admin roster) require `isSuperAdmin`                           |
| Rate limiting    | Parameterized `consumeSettingsQuota` — exchange per source IP, issuance per principal; uniform error on exchange failure (no oracle)                        |
| Exposure         | Reverse-proxy model — bot keeps binding `127.0.0.1`; `SETTINGS_PUBLIC_BASE_URL` builds the link and scopes the `Secure` cookie                              |

## Consequences

### Positive

- Strict trust isolation: a settings session never satisfies operator
  routes, and an operator token never satisfies settings routes.
- Revocations take effect immediately (next request re-resolves
  scope), without waiting for session expiry.
- Single `requireScope` guard is the sole authority for every write
  route — no per-handler ad-hoc checks.
- Sessions survive bot restarts (SQLite-backed).
- Existing authorization stores are reused — no parallel permission
  tables that could drift from chat-side truth.

### Negative

- Per-request principal resolution queries the DB on every settings
  API call (mitigated: these are lightweight indexed lookups).
- Reverse-proxy deployment is now required for any public-facing
  settings UI — the bot does not bind publicly or terminate TLS.
- One more SQLite migration and three more tables.

### Risks

- The one-time code is a bearer secret in transit over chat. A
  compromised chat session could allow code theft before the victim
  uses it. Mitigation: 10-minute TTL, single-use, and the `/config`
  reply warns the link is single-use.
- The `/config` chat message containing the link is not auto-redacted
  after exchange (OQ-A5 deferred). A platform-side message history
  compromise exposes a used (and therefore inert) code, but the
  session cookie it produced remains valid until expiry or logout.

## Implementation Notes

Key modules:

| File                                     | Role                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| `src/settings/config.ts`                 | `SETTINGS_PUBLIC_BASE_URL` reader and link builder                        |
| `src/settings/crypto.ts`                 | `generateToken`, `hashToken`, `timingSafeEqualHex`                        |
| `src/settings/auth-code-store.ts`        | One-time code issuance and atomic consumption                             |
| `src/settings/session-store.ts`          | Session CRUD, sliding expiry, CSRF rotation                               |
| `src/settings/rate-limit.ts`             | Parameterized `consumeSettingsQuota`                                      |
| `src/settings/issue-link.ts`             | Chat-callable `/config` link issuer (rate-limited)                        |
| `src/settings/principal.ts`              | Per-request `resolveSettingsPrincipal`                                    |
| `src/settings/scope-guard.ts`            | `requireScope` — the single write-route authority                         |
| `src/settings/contexts.ts`               | `listAvailableContexts` for the context switcher                          |
| `src/settings/cookies.ts`                | `buildSessionCookie`, `clearSessionCookie`, `parseSessionCookie`          |
| `src/settings/request-auth.ts`           | `authenticateSettingsRequest`, `verifyCsrf`                               |
| `src/debug/settings-routes.ts`           | Exchange, logout, bootstrap HTTP handlers                                 |
| `src/debug/settings-router.ts`           | Path-prefix dispatch, never consults `DEBUG_TOKEN`                        |
| `src/db/settings-auth-schema.ts`         | Drizzle schema for the three auth tables                                  |
| `src/db/migrations/048_settings_auth.ts` | DDL for `settings_auth_codes`, `settings_sessions`, `settings_rate_limit` |

Integration: `src/debug/server.ts` branches on `/settings/*` before
`isAuthorizedRequest`; `src/commands/config.ts` calls
`issueSettingsLink` when `SETTINGS_PUBLIC_BASE_URL` is set, falling
back to the legacy in-chat flow otherwise.

## Related Decisions

- ADR-0123: Trusted-Local Plugin System — plugin approval/rejection in
  the settings UI admin tier reuses the scope guard's `requireSuperAdmin`
  sub-action.
- ADR-0014: Multi-Chat Provider Abstraction — platform instance identity
  (`platformInstanceId`) is the principal's anchor.
- ADR-0009: Multi-Provider Task Tracker Support — task-provider credential
  fields in personal/group contexts flow through the scope guard.
