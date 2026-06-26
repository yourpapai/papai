<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0217: papai Core Notify Endpoint

## Status

Implemented

## Date

2026-06-21

## Context

The ACP agent-sessions design (`docs/superpowers/specs/2026-06-16-acp-plugin-design.md`) splits work across three tiers: a thin papai `acp` plugin, a new TypeScript control service, and ACP support in the Rust `acp-agent` sandbox. The control service runs coding sessions in the background and pushes milestones (plan ready, waiting on permission/input, done with a PR URL, review posted) back into the originating chat. The spec (§2, §6.2) verified that **no plugin runtime context exposes any send/notify surface** and that **plugins cannot register HTTP routes**; the only existing inbound send route, `POST /settings/api/admin/announce`, broadcasts to all users and is gated by the dashboard session cookie. Neither fits a control service posting targeted milestones per session.

The spec therefore calls for exactly one papai-core addition: a token-authenticated `POST /api/notify { contextId, contextType?, threadId?, markdown }` that resolves the platform instance from `context_settings` and delivers via `ChatRouter.sendMessage`, reusing the same delivery seam the deferred-prompt and recurring-task paths use. The receiver must be reachable in production where the engineer dashboard (`DEBUG_SERVER`) may be off, so it cannot share the `DEBUG_TOKEN` or dashboard-session trust plane.

The plan (`docs/superpowers/plans/2026-06-21-papai-notify-endpoint.md`) implements this as two new modules plus one mount point, all under TDD write-hooks.

## Decision Drivers

- **Independent trust plane.** The route must authorize on its own notify token, not the dashboard session cookie or `DEBUG_TOKEN`, and remain reachable regardless of `DEBUG_SERVER`.
- **Minimal core surface.** Reuse the existing deferred-prompt delivery plumbing (`resolveDeliveryPlatformInstanceId` + `ChatRouter.sendMessage`); add no new proactive-send path.
- **Secret in the DB, not env-only.** The token lives in `system_config` so it survives restarts without an env var, yet is still seedable from `NOTIFY_TOKEN` on first run for zero-touch bootstrap.
- **Constant-time auth.** Bearer comparison must not leak token length or early-exit on prefix mismatch.
- **Delivery robustness for new users.** Contexts that only ever chatted may have no `context_settings` row; delivery must still resolve the platform instance encoded in the scoped storage context id.
- **Operator-postable.** An external control service (magi) posts milestones here with a single bearer token; no browser session or CSRF flow is appropriate.

## Considered Options

### Option A — Dedicated `/api/notify` route on its own notify-token trust plane (chosen)

- **Pros:** Independent of `DEBUG_SERVER`/session; minimal and self-contained; matches the deferred-prompt delivery seam already used by recurring/deferred sends; service-to-service bearer auth fits a control service.
- **Cons:** Introduces a new inbound auth surface and a long-lived shared secret; token rotation requires a restart (process-lifetime cache).

### Option B — Extend `/settings/api/admin/announce` with a targeted mode

- **Pros:** Reuses an existing admin route and session/CSRF auth model.
- **Cons:** The announce route is broadcast-by-design; targeting needs a session cookie (not a service token); couples the operator-session trust domain to a control-service caller that has no browser session; does not satisfy "reachable regardless of `DEBUG_SERVER`" cleanly. Rejected.

### Option C — Add a proactive-send primitive to the plugin runtime

- **Pros:** No new HTTP route; the plugin could notify directly.
- **Cons:** Spec §2 verified plugins have no send/notify surface and cannot register routes; exposing one would widen the plugin sandbox trust boundary and contradict the deliberate isolation. Rejected.

## Decision

Implement Option A with three coordinated changes.

### 1. `notify-token` module (`src/notify-token.ts`)

`getNotifyToken()` returns the `notify_token` row from `system_config`, lazily seeding it from `process.env['NOTIFY_TOKEN']` on first read (so no `index.ts` startup change is needed), mirroring the `stats_anonymity_salt` lazy-seed pattern. The value is cached for the process lifetime; rotating the token in the DB therefore requires a bot restart. `resetNotifyTokenCacheForTesting()` drops the cache for tests. Seeding uses `onConflictDoNothing()` — correct because seeding only runs when the DB read returned null, so a stored token is never clobbered by a stale env value.

### 2. `notify-route` handler (`src/debug/notify-route.ts`)

`handleNotifyRoute(req)` is POST-only and authorizes via a `checkAuth` helper: missing/invalid bearer → `401`; no `notify_token` configured → `503`; otherwise a **SHA-256-hashed timing-safe compare** (`createHash('sha256').update(...)` on both sides, then `timingSafeEqual`) → `401`. Hashing both sides before `timingSafeEqual` removes the length-leak and prefix-early-exit of a raw buffer compare.

The body is validated with Zod v4 `NotifyBodySchema` (`contextId` min 1, optional `contextType: 'dm'|'group'`, optional `threadId`, `markdown` min 1) via `safeParse` → `400` on failure. `buildNotifyTarget(body)` constructs the `DeferredDeliveryTarget`: when not a group, a DM target via `dmTarget(storageContextId)`; for groups, `getConfigContextIdFromStorageContextId` with `contextType:'group'`, `audience:'shared'`, `threadId ?? null`, and `storageContextId` always set so the platform instance resolves regardless of the addressing fields.

Delivery resolves `resolveDeliveryPlatformInstanceId(target)` (→ `404` if null), then a `sendNotify` helper calls `chat.sendMessage`. `sendNotify` wraps the call in try/catch so a thrown send error returns `502` rather than a 500, and a `false` return also maps to `502`. The chat router not running → `422`. Final status set: `200 sent` · `400` bad body · `401` bad/no token · `404` not deliverable · `405` non-POST · `422` router not running · `502` send failed · `503` token not configured.

### 3. Mount on its own trust plane (`src/debug/server.ts`)

`routeRequest` handles `/api/notify` immediately **after** the `debugEnabled`/`isDebugOnlyPath` gate and **before** `isAuthorizedRequest` — its own token trust plane, not in `DEBUG_ONLY_PATHS`, reachable regardless of `DEBUG_SERVER`. No dashboard session cookie or `DEBUG_TOKEN` is consulted for this path.

## Consequences

### Positive

- One route plus one token module deliver the entire core-side ACP milestone path; no new proactive-send primitive was added to the plugin runtime or core scheduler.
- Reuses the proven deferred-prompt delivery seam, including the `parseScopedContextId` fallback so contexts without a `context_settings` row (users who only ever chatted) still resolve their platform instance and receive notifications.
- Authorization is independent of `DEBUG_SERVER` and the dashboard session, so magi can post milestones in production where the engineer dashboard is off.
- SHA-256-hashed `timingSafeEqual` removes length/timing leakage from the bearer compare.

### Negative

- **Token rotation requires a restart.** `getNotifyToken` caches for the process lifetime; changing `notify_token` in `system_config` (or the env) only takes effect after a bot restart.
- **Auth-ordering choice:** a request with no bearer header against an endpoint with no configured token returns `401` (bearer-present is checked before token-configured), not `503`. Callers cannot distinguish "unconfigured" from "wrong token" without sending a bearer.
- **Group delivery requires disambiguation.** Without `contextType`, a group is inferred via `isScopedThreadContextId`; non-thread group contexts (notably Discord) must pass `contextType:'group'` (+ `threadId`) explicitly. magi's Notifier currently sends only `{ contextId, markdown }`; carrying the type/thread is a small magi follow-up, not required for DM-context sessions.

### Risks

- `notify_token` is a long-lived shared secret in `system_config` (it must equal magi's `MAGI_NOTIFY_TOKEN`). If leaked, a holder can post arbitrary markdown into any deliverable context. Mitigated by constant-time compare, admin-only `system_config` access, and the control service posting only milestone markdown.
- `502` on a `sendMessage` throw is best-effort: the bot does not retry. The spec (§8) places retry-with-backoff on the control-service Notifier, which owns session liveness.

## Related Decisions

- **ADR-0218: papai ACP plugin** — the sibling thin plugin (`plugins/acp/`) whose tools call the control service; its plan remains in `docs/superpowers/plans/`. This endpoint is the control service's only inbound delivery target.
- **ADR-0134: Dashboard session authentication** — the session-cookie trust domain this route deliberately bypasses by mounting before `isAuthorizedRequest`.
- **ADR-0116: Deferred-prompt delivery redesign** — the delivery plumbing (`resolveDeliveryPlatformInstanceId` + `ChatRouter.sendMessage`) this endpoint reuses.

## Implementation Notes

All key files are present and confirmed:

- `src/notify-token.ts` — `getNotifyToken()` / `resetNotifyTokenCacheForTesting()`, `eq()`-based `system_config` read, `onConflictDoNothing()` seed, process-lifetime cache (53 lines).
- `src/debug/notify-route.ts` — `handleNotifyRoute` / `buildNotifyTarget` / `NotifyBody`, Zod v4 `safeParse`, `createHash('sha256')` + `timingSafeEqual` compare, `checkAuth` / `sendNotify` helpers with try/catch→502 (136 lines).
- `src/debug/server.ts:237` — `if (url.pathname === '/api/notify') return handleNotifyRoute(req)`, mounted after the `isDebugOnlyPath` gate (line 235) and before `isAuthorizedRequest` (line 239).
- `src/chat/delivery-routing.ts:23` — `resolveDeliveryPlatformInstanceId` with the `parseScopedContextId` storage-context-id fallback (lines 31–32), so `context_settings`-less contexts still resolve.

Divergences from the plan's pseudocode (all functionally equivalent or improvements):

- Token compare: plan sketched a raw `Buffer.from` length-guarded `timingSafeEqual`; shipped hashes both sides with SHA-256 first (length-leak-safe; matches `AGENTS.md`'s "timing-safe SHA-256 compare").
- `notify-token.ts` seeding: plan used a `sql` template + `onConflictDoUpdate`; shipped uses `eq()` + `onConflictDoNothing()` + a single `.get()`.
- `notify-route.ts` structure: shipped refactored the inline handler into `checkAuth` and `sendNotify` helpers, and `sendNotify` wraps `chat.sendMessage` in try/catch (the plan only handled the `false` return, which would have surfaced a thrown send as a 500).
- Auth ordering: shipped checks bearer-present (`401`) before token-configured (`503`); the plan checked token-configured first.
