<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0182: Mattermost Buttons And Always-On Web Server

## Status

Implemented

## Date

2026-06-05

## Context

The shared HTTP server in `src/debug/server.ts` was only started when `DEBUG_SERVER === 'true'`, yet it also hosted `/settings`, `/settings/api/*`, `/admin`, `/auth/*`, `/api/notify`, and `/dashboard`. Deployments with `DEBUG_SERVER=false` therefore could not serve the operator settings/admin surfaces or the proactive-notify endpoint at all — a production-blocking gap, since LLM credentials and instances are managed there.

Mattermost's `reply.buttons()` rejected with "This platform does not support interactive buttons." while Telegram and Discord already rendered `ask`-gated tool-permission prompts. The permission prompt emits `perm:a:<id>` / `perm:d:<id>` buttons and exposes `resolvePermissionRequest()`, but `src/chat/interaction-router.ts` matched no callback prefixes, so even Telegram/Discord button clicks had no central handler — the router was a near-empty safe sink after the settings-UI callback retirement.

The 2026-06-05 design (`docs/superpowers/specs/2026-06-05-mattermost-buttons-web-server-design.md`) is the source of truth: start the web server unconditionally with `DEBUG_SERVER` demoted to a route-capability flag; render Mattermost buttons as native post attachment actions whose signed context is verified by a public callback route and then dispatched back into the adapter through a small registry; route `perm:` callbacks centrally in `routeInteraction()`.

## Decision Drivers

- **Operational availability**: settings/admin/auth/notify must be reachable in production without exposing the engineer debug surface.
- **Stateless callback security**: button context travels client-side through Mattermost, so it must be HMAC-signed, expiry-bound, and channel-bound; the verifier must fail closed on any anomaly and never trust the route caller.
- **Reuse of the interaction abstraction**: Mattermost callbacks should flow through the existing `IncomingInteraction` + `routeInteraction()` rather than a parallel permission path.
- **Restart-stable secret**: callback verification must survive restarts, so the signing key is DB-persisted — not env-only — and must not reuse the instance-config encryption key (different rotation and blast-radius concerns).
- **Minimal surface**: no Mattermost menus, dialogs, or a general plugin interaction API — only existing `reply.buttons` prompts.

## Considered Options

### Web server startup model

- **Always-on server + `debugEnabled` route flag** (chosen) — Pros: settings/admin/auth always available; debug surface gated independently by an enumerated path predicate; single server module. Cons: route ordering must place the public callback before session auth; the debug-only path set must be maintained by hand.
- **Conditional start (status quo)** — Pros: no routing change. Cons: production without `DEBUG_SERVER` loses settings/admin/auth/notify. Unacceptable.
- **Separate callback server process** — Pros: isolation. Cons: second port/TLS/health surface, signing secret shared across processes, more operational complexity for a narrow feature.

### Callback context binding

- **Stateless HMAC-signed context** (chosen) — Pros: no per-prompt DB row; survives restarts; expiry + nonce + signature; channel-bound. Cons: a signed context is valid until expiry (5 min TTL); cannot revoke an in-flight prompt server-side before then.
- **Per-prompt DB row with opaque token** — Pros: revocable. Cons: write path on every prompt, GC of expired rows, more DB traffic for a transient UX.

## Decision

Seven coordinated changes implement the architecture:

### 1. Always-on web server + `debugEnabled` route gating

`src/index.ts` starts `startDebugServer(adminUserId, { debugEnabled: process.env['DEBUG_SERVER'] === 'true' })` unconditionally. `src/debug/server.ts` adds `WebServerRouteOptions` (`debugEnabled`, plus `mattermostActionSecretForTest` for tests) and `isDebugOnlyPath()`; debug-only paths (`/debug`, `/debug.js`, `/debug.css`, `/events`, `/logs`, `/logs/stats`, `/turns/*`, `/dashboard`) return 404 when `debugEnabled=false`, while settings/admin/auth/notify/stats remain session-cookie gated. `routeRequestForTest()` exposes routing for tests; `stopDebugServer()` resets route options.

### 2. Mattermost action signing secret

`src/chat/mattermost/action-secret.ts` lazily seeds `mattermost_action_signing_secret` into `system_config` (deliberately NOT added to the LLM-facing `SystemConfigKey` union) and reads it on demand via `getMattermostActionSigningSecret()`. Stable across restarts; generated as 32 random bytes base64url-encoded.

### 3. Stateless signed action context

`src/chat/mattermost/action-signing.ts` `createMattermostActionContext` / `verifyMattermostActionContext` produce and verify a versioned HMAC-SHA256 envelope: `{ version, platformInstanceId, channelId, callbackData, sourceMessageText, threadId?, expiresAt, nonce, signature }`. `verifyMattermostActionContext` returns `{ ok: false, reason: 'invalid_shape' | 'expired' | 'bad_signature' }` and uses `timingSafeEqual`. `channelId` is bound into the signature so a signed context cannot be replayed in a different channel.

### 4. Mattermost `reply.buttons()` rendering

`src/chat/mattermost/reply-helpers.ts` maps `ChatButton[]` to Mattermost attachment `actions` (max 5), each with `integration.url = {SETTINGS_PUBLIC_BASE_URL}/mattermost/actions` and `integration.context` = the signed context; it rejects when `callbackBaseUrl` is null. `src/chat/mattermost/index.ts` wires `callbackBaseUrl: getSettingsPublicBaseUrl()` and `createActionContext` bound to the signing secret.

### 5. Public action callback route

`src/chat/mattermost/action-callbacks.ts` `handleMattermostActionRequest` validates method/content-type/JSON/payload shape, verifies the signed context, asserts `channel_id === verification.value.channelId`, and dispatches to the per-instance `MattermostActionDispatcher` registered via `registerMattermostActionDispatcher` / `unregisterMattermostActionDispatcher`. `src/debug/server.ts` routes `POST /mattermost/actions` (gated by `isMattermostActionPath`) BEFORE the `isDebugOnlyPath` gating and before `isAuthorizedRequest` session auth, so the public callback never needs a dashboard cookie. Responses are Mattermost-shaped `update` / `ephemeral_text` / `error`.

### 6. Provider dispatch + thread-aware context

`dispatchMattermostProviderAction(payload, deps)` resolves channel type and admin status, builds a thread-aware `storageContextId` via `getThreadScopedStorageContextId(...)`, constructs an `IncomingInteraction` (`kind: 'button'`) carrying `sourceMessageText`, and delegates to the provider's `interactionHandler`. `buildActionReply()` maps `replaceText`/`replaceButtons` → `update`, `ephemeralConfirm`/`text` → `ephemeral_text`.

### 7. Central `perm:` routing

`src/chat/interaction-router.ts` matches `/^perm:(a|d):([A-Za-z0-9_-]+)$/`, peeks the pending request (`peekPermissionRequest`), enforces `pending.contextId === auth.storageContextId` (cross-context rejection), resolves it, and finalizes the decision. `src/chat/types.ts` adds `sourceMessageText` to `IncomingInteraction`; `src/chat/mattermost/metadata.ts` advertises `messages.buttons` + `interactions.callbacks`.

## Consequences

### Positive

- Settings/admin/auth/notify/stats are available regardless of `DEBUG_SERVER`; the engineer debug surface is gated independently.
- Mattermost now renders native `ask`-gated permission buttons, reaching parity with Telegram and Discord.
- Callbacks are statelessly signed (no per-prompt DB write), expiry-bound (5 min), channel-bound, and timing-safe verified.
- `perm:` handling is centralized in `routeInteraction()`; the interaction router now handles exactly one live prefix, with all other callbacks remaining safe-sink no-ops.
- Thread-aware `storageContextId` preserves group-thread isolation for callbacks.

### Negative

- `SETTINGS_PUBLIC_BASE_URL` is now required for Mattermost buttons; without it `reply.buttons()` rejects, so Mattermost contexts get no buttons and prompts fall back to timeout-deny.
- A new DB-persisted secret (`mattermost_action_signing_secret`) must be protected like other `system_config` secrets; rotation invalidates all in-flight signed contexts (acceptable given the 5-min TTL).
- The public `/mattermost/actions` route is reachable without a session cookie by design; security rests entirely on HMAC verification plus normal authorization, so any signature-validation regression is high-impact.
- The debug-only route set is hard-coded in `isDebugOnlyPath()`; a new debug route added without updating the predicate would be exposed when `debugEnabled=false`.

### Risks

- **Replay within TTL**: a signed context is valid until expiry. The context-bound `channelId` check mitigates cross-channel replay, and `peekPermissionRequest` idempotency means only the first valid click resolves (later clicks report "Action is no longer available."), but a leaked signed context can still be replayed by any user in the same channel within 5 min.
- **Signature comparison shape**: the shipped verifier compares signatures as UTF-8 buffers after a regex shape check rather than base64url-decoding first (a minor deviation from the plan's base64url-decode-then-compare). Both approaches use `timingSafeEqual`; the regex pre-check prevents length-mismatch throws. This is a hardening nuance, not a vulnerability.

## Related Decisions

- ADR-0140: Kontur Talk Chat Provider — the other buttonless/callbackless platform; its lack of buttons informed the edit-in-place + timeout-deny fallback path.
- ADR-0142: Tool `ask` Permission Gate — defines `askPermissionViaChat` and the `perm:a:`/`perm:d:` callback contract this ADR makes Mattermost render and centrally route.
- ADR-0136 / ADR-0137: Settings Web UI Access Model / HTTP API — the trust domain that must remain reachable without `DEBUG_SERVER`.
- ADR-0134: Dashboard Session Authentication — the session-cookie model the public `/mattermost/actions` route deliberately bypasses (it is routed before `isAuthorizedRequest`).
- ADR-0163: Mattermost Mention-Prefixed Command Syntax — the Mattermost adapter boundary this work extends.

## Implementation Notes

Confirmed present in the tree:

- `src/chat/mattermost/action-secret.ts` — `getMattermostActionSigningSecret`, `MATTERMOST_ACTION_SIGNING_SECRET_KEY = 'mattermost_action_signing_secret'`.
- `src/chat/mattermost/action-signing.ts` — `createMattermostActionContext` / `verifyMattermostActionContext`; `MattermostSignedActionContextSchema` is a `z.strictObject` carrying `channelId` (required) and `threadId` (optional) beyond the plan's field set.
- `src/chat/mattermost/action-callbacks.ts` — `handleMattermostActionRequest`, `isMattermostActionPath`, `registerMattermostActionDispatcher` / `unregisterMattermostActionDispatcher`, `dispatchMattermostProviderAction`, `buildActionReply`.
- `src/debug/server.ts` — `routeRequest` routes `/mattermost/actions` before `isDebugOnlyPath` gating and before `isAuthorizedRequest`; `WebServerRouteOptions` carries `debugEnabled` + `mattermostActionSecretForTest`.
- `src/chat/interaction-router.ts` — `PERMISSION_CALLBACK_PATTERN`, `permissionDecisionFromCode`, `finalizePermissionDecision`, and the `peekPermissionRequest` context-scoping check.
- `src/chat/mattermost/metadata.ts` — `messages.buttons`, `interactions.callbacks` capabilities.
- `src/chat/types.ts` — `IncomingInteraction.sourceMessageText`.
- `src/index.ts` — unconditional `startDebugServer(adminUserId, { debugEnabled: process.env['DEBUG_SERVER'] === 'true' })`.

**Divergence from the plan/spec.** The shipped permission-decision UX is richer than the spec's "edit in place, append `Allowed.`/`Denied.`". Prompts are **self-removing**: `finalizePermissionDecision` prefers `reply.ephemeralConfirm` + `handle.remove()` (delete the prompt, confirm via a non-persistent toast) when available, falling back to in-place edit. The confirmation text comes from `formatDecisionConfirmation(toolName, decision)`, not the plan's `formatPermissionDecisionText(sourceMessageText, decision)`. This introduced the `ephemeralConfirm` `ReplyFn` surface and the `PromptHandle` (`redact`/`remove`) type across adapters; Mattermost maps `ephemeralConfirm` → `ephemeral_text`. Button labels ship as "✅ Allow" / "🚫 Deny" (emoji) and expired prompts redact to "⌛ Expired — denied.".

**Divergence.** The dispatcher is a module-level `dispatchMattermostProviderAction(payload, deps)` (not the plan's instance method `this.dispatchMattermostAction`), and `storageContextId` is resolved thread-aware via `getThreadScopedStorageContextId`, preserving group-thread isolation for callbacks. The signed context carries `channelId` (bound into the signature) and optional `threadId`, neither in the original plan's field set; the callback handler additionally asserts `channel_id === verification.value.channelId`.
