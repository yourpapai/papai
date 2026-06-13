<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0134: Dashboard Session Authentication

## Status

Implemented

## Date

2026-05-28 – 2026-06-02

## Context

The debug/admin dashboard (`DEBUG_SERVER=true`) was protected by a single static
bearer token (`DEBUG_TOKEN`) shared across all admin users. This approach had
several shortcomings:

- **No per-user identity**: All admins shared one token; the server could not
  distinguish who was logged in or audit per-admin actions.
- **Token leakage risk**: The token lived in environment variables, shell
  history, process listings, and deployment configs — any leak granted
  permanent access until manual rotation.
- **No session lifecycle**: There was no way to revoke a single admin's access
  without rotating the token for everyone, and no session expiry existed.
- **No chat integration**: Admins had to copy a token from the deployment
  environment into browser headers, which was error-prone and hostile to
  non-technical operators.

The dashboard is an operator-facing surface behind a private network boundary
(SSH forward, Tailscale, or reverse proxy). The new auth mechanism needed to
improve security posture without assuming public-internet threat models.

## Decision Drivers

- **Per-admin identity**: The server must know which admin is authenticated,
  for audit logging and future per-admin feature gating.
- **Single-use issuance**: Login credentials must be one-time — replaying a
  claim URL must fail.
- **No persistent shared secrets**: Eliminate the static `DEBUG_TOKEN` from
  the environment and process space.
- **Chat-native flow**: Admins should initiate sign-in from the chat platform
  they already use, not from deployment tooling.
- **Defense in depth**: Session cookies complement, not replace, the network
  perimeter (SSH/Tailscale/reverse proxy).
- **Bounded sessions**: Sessions must expire; admins must be able to revoke
  their own sessions.
- **No sliding refresh in v1**: Keep the initial implementation simple; revisit
  if operational experience demands it.

## Considered Options

### Option A: Keep `DEBUG_TOKEN` with per-user headers

Add an `X-Admin-User-Id` header alongside the bearer token; keep the shared
token but add identity.

- **Pros**: Minimal change; preserves existing curl/automation workflows.
- **Cons**: Shared token remains a single point of failure; no per-user
  revocation; token still leaks through env/process space.

### Option B: Chat-issued session cookies (chosen)

Admins DM `/dashboard` to the bot, receive a single-use magic link, and
exchange it for an `HttpOnly; Secure; SameSite=Strict` session cookie backed
by a SQLite `dashboard_sessions` table. `DEBUG_TOKEN` is removed entirely.

- **Pros**: Per-admin identity; single-use claim prevents replay; session
  expiry and revocation; no shared secret in the environment; chat-native UX.
- **Cons**: Requires the chat platform to be reachable for sign-in; two new
  DB tables; slightly more complex server-side auth gate.

### Option C: OAuth2/OIDC via external provider

Delegate auth to an external identity provider (e.g. Authelia, Authentik).

- **Pros**: Industry-standard SSO; rich identity metadata.
- **Cons**: Adds a hard external dependency; overkill for a single-admin or
  small-team operator dashboard; breaks the self-contained deployment model.

### Option D: Tailscale-only auth

Restrict dashboard access to the Tailscale tailnet and use Tailscale identity.

- **Pros**: Zero-code auth if the operator already uses Tailscale.
- **Cons**: Locks deployment to one network provider; excludes SSH-forward and
  reverse-proxy deployments; no per-admin identity inside the app.

## Decision

**Option B** for the auth mechanism, with the following subsidiary decisions:

| Topic                | Decision                                                                                                                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claim issuance       | DM `/dashboard` returns a URL with a 128-bit hex nonce embedded as a query param. The nonce hash is stored; the raw nonce is never persisted.                                                                                                                                   |
| Claim consumption    | Two-step to survive link-preview crawlers: `GET /auth/claim?n=<nonce>` renders a confirmation page only (no consumption); `POST /auth/claim` (form submit) validates the nonce, marks it consumed (single-use), mints a session, and redirects to `/admin` with a `Set-Cookie`. |
| Session cookie       | `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=<ttl>`. The `Secure` attribute is omitted when `X-Forwarded-Proto` is not `https` (localhost dev).                                                                                                                          |
| Session storage      | `dashboard_sessions` table: id (SHA-256 of cookie value), admin_user_id, issued_at, expires_at, revoked_at, last_seen_at, last_seen_ip, user_agent.                                                                                                                             |
| Claim storage        | `dashboard_claims` table: nonce_hash (PK), admin_user_id, platform_instance_id, created_at, expires_at, consumed_at.                                                                                                                                                            |
| Hashing at rest      | Both nonce and session cookie values are stored as SHA-256 hashes. Raw values are never persisted.                                                                                                                                                                              |
| Session TTL          | 8 hours (28,800 s), configurable via `DASHBOARD_SESSION_TTL_SECONDS`. No sliding refresh.                                                                                                                                                                                       |
| Claim TTL            | 5 minutes (300 s), configurable via `DASHBOARD_CLAIM_TTL_SECONDS`.                                                                                                                                                                                                              |
| `DEBUG_TOKEN`        | Removed entirely. A startup WARN is emitted if the env var is still set, pointing the operator to `/dashboard`.                                                                                                                                                                 |
| Sweeper              | Periodic cleanup (hourly by default) deletes expired claims and sessions. Timer handle is `unref()`-ed to avoid blocking process exit.                                                                                                                                          |
| Admin definition     | Any user for whom `isAdmin(userId, platformInstanceId)` returns true.                                                                                                                                                                                                           |
| DM-only              | `/dashboard` is rejected in group contexts.                                                                                                                                                                                                                                     |
| `Referrer-Policy`    | The claim redirect response includes `Referrer-Policy: no-referrer` to avoid leaking the nonce in Referer headers.                                                                                                                                                              |
| Route surface        | `GET /auth/claim` (confirmation page), `POST /auth/claim` (consume + mint), `POST /auth/logout`, `GET /auth/whoami` — all mounted before the session cookie gate in the debug server.                                                                                           |
| Client bootstrapping | Admin and debug client entrypoints call `/auth/whoami`; 401 shows a sign-in screen directing the user to DM `/dashboard`.                                                                                                                                                       |
| DB migration         | `046_dashboard_sessions` creates `dashboard_claims` and `dashboard_sessions` tables.                                                                                                                                                                                            |

## Consequences

### Positive

- Per-admin session identity enables audit logging and future per-admin
  feature gating.
- Single-use claim links eliminate replay attacks; the nonce is consumed
  atomically via a conditional `UPDATE … WHERE consumed_at IS NULL`.
- No shared secret in the environment removes `DEBUG_TOKEN` from process
  listings, shell history, and deployment configs.
- `HttpOnly; Secure; SameSite=Strict` cookies resist XSS, CSRF, and
  cross-origin leakage.
- Session expiry and explicit logout give operators control over session
  lifetime.
- Hashing at rest means a DB leak reveals no usable session or claim tokens.

### Negative

- Sign-in requires the chat platform to be reachable; operators cannot
  authenticate if the chat provider is down.
- Two additional DB tables and a sweeper increase the maintenance surface.
- No sliding session refresh in v1; admins must re-authenticate after 8 hours
  regardless of activity.
- Non-browser clients (curl, automation) can no longer use a static token;
  they must obtain a session cookie via the claim flow.

### Risks

- If `SETTINGS_PUBLIC_BASE_URL` is misconfigured, the magic link URL will be
  unreachable. Mitigation: `DASHBOARD_BASE_URL` env var with a fallback to
  `SETTINGS_PUBLIC_BASE_URL`, then `http://{DEBUG_HOSTNAME}:{DEBUG_PORT}`.
- The claim link is sent over the chat platform; a compromised chat account
  could intercept it within the 5-minute TTL window. Mitigation: short TTL,
  single-use consumption, and the chat platform itself is already the trust
  boundary for admin identification.

## Implementation Notes

Key module (`src/dashboard-auth/`):

| File         | Role                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`   | Public API: `issueClaim`, `consumeClaim`, `mintSession`, `authenticate`, `revokeSession`, `sweepExpired`, `recordActivity` |
| `store.ts`   | Raw SQL CRUD over `dashboard_claims` and `dashboard_sessions` (DI-injected DB)                                             |
| `cookie.ts`  | `readSessionCookie`, `buildSetCookie`, `buildClearCookie`, `SESSION_COOKIE_NAME`                                           |
| `sweeper.ts` | `setInterval`-based expired-row cleanup with configurable interval                                                         |

Other files:

- `src/db/migrations/046_dashboard_sessions.ts` — schema migration
- `src/commands/dashboard.ts` — `/dashboard` DM command
- `src/debug/server.ts` — replaced `DEBUG_TOKEN` gate with `authenticate()`, added `/auth/*` routes
- `src/debug/instance-routes.ts`, `billing-routes.ts`, `plugin-config-routes.ts` — dropped inline `DEBUG_TOKEN` checks
- `client/admin/auth.ts`, `client/debug/auth.ts` — `ensureAuthenticated()` + `logout()` bootstrap
- `docs/deployment/dashboard-access.md` — deployment guidance

## Related Decisions

- ADR-0123: Trusted-Local Plugin System — the plugin admin UI also lives behind
  the debug server's session auth gate.
- ADR-0050 (settings auth): The settings UI uses a separate one-time auth-code
  - CSRF cookie flow; dashboard session cookies are a distinct trust domain.
