<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mattermost Buttons And Always-On Web Server Design

## Summary

Implement Mattermost support for the existing `ReplyFn.buttons` contract and correct the web server startup model so settings, admin, auth, and Mattermost callback routes are available without `DEBUG_SERVER=true`.

This design is intentionally narrow. It supports existing papai button prompts, especially ask-gated tool permission prompts, and restores handling for existing `perm:` callbacks. It does not add Mattermost menus, dialogs, arbitrary custom action registries, plugin-level interaction APIs, or broader workflow buttons.

## Goals

- Start papai's HTTP web server unconditionally at runtime.
- Keep `/settings`, `/settings/api/*`, `/admin`, and `/auth/*` available regardless of `DEBUG_SERVER`.
- Disable debug-only routes when `DEBUG_SERVER=false`, including `/debug`, `/events`, `/logs`, and `/turns/*`.
- Implement Mattermost `reply.buttons()` using native Mattermost interactive message buttons.
- Route Mattermost button callbacks through the existing `IncomingInteraction` abstraction.
- Add central `perm:a:<id>` and `perm:d:<id>` handling in `routeInteraction()`.
- On permission decisions, update the original Mattermost post by keeping the original prompt and reason, appending `Allowed.` or `Denied.`, and removing buttons.

## Non-Goals

- Mattermost message menus or dialogs.
- A general-purpose interaction callback framework beyond existing `reply.buttons` callbacks.
- New task/tool behavior beyond resolving current ask-gated permission prompts.
- Making Kontur Talk support buttons.
- Replacing Telegram or Discord button rendering.

## Current State

`src/index.ts` only starts `src/debug/server.ts` when `DEBUG_SERVER=true`. Because settings, admin, auth, and dashboard routes currently live inside that server, deployments with `DEBUG_SERVER=false` do not serve those required web UI routes.

Mattermost currently implements normal text, formatted, file, typing, redact, and delete reply surfaces. Its `reply.buttons()` implementation rejects with `This platform does not support interactive buttons.` Mattermost itself supports interactive message buttons through post attachment actions. Button clicks call an HTTP integration URL and include `user_id`, `post_id`, `channel_id`, `team_id`, and the action `context`.

The existing permission prompt emits two buttons:

- `Allow`, with callback data `perm:a:<id>` and style `primary`.
- `Deny`, with callback data `perm:d:<id>` and style `secondary`.

The permission prompt state already exposes `resolvePermissionRequest()`, but `routeInteraction()` currently matches no callback routes.

## Architecture

The web server should always start. `DEBUG_SERVER` should become a route capability flag, not the switch that determines whether any HTTP server exists. The server can keep its current module location initially, but its runtime meaning should be renamed or clearly documented as the shared web server for settings, admin, auth, debug, and public callback surfaces.

Mattermost button support should remain inside the Mattermost chat adapter boundary. The adapter renders `ChatButton[]` into Mattermost attachment actions. Each action points to a public callback endpoint derived from `SETTINGS_PUBLIC_BASE_URL`, such as `/mattermost/actions`, and carries signed context. The public callback endpoint validates the Mattermost payload, verifies the signed context, builds an `IncomingInteraction`, performs normal authorization, and delegates callback semantics to `routeInteraction()`.

## Components

- `src/index.ts`: always starts the web server and passes a `debugEnabled` option based on `DEBUG_SERVER === 'true'`.
- `src/debug/server.ts`: serves shared settings/admin/auth routes unconditionally and gates debug-only routes with `debugEnabled`.
- Mattermost action route: accepts `POST /mattermost/actions`, validates Mattermost callback payloads, verifies signed action context, and routes valid callbacks.
- `src/chat/mattermost/reply-helpers.ts`: implements `reply.buttons()` by posting Mattermost attachment actions.
- Mattermost button/signing helper: maps papai button styles to Mattermost styles and signs/verifies stateless context.
- `src/chat/interaction-router.ts`: handles `perm:a:<id>` and `perm:d:<id>` callbacks.
- `src/chat/permission-prompt.ts`: retains enough prompt metadata for final decision messages where needed, without parsing free-form post text.

The callback route translates Mattermost HTTP callbacks into the chat interaction abstraction. It must not implement tool, task, or provider logic.

## Data Flow

### Sending A Permission Prompt

1. A tool execution asks for permission through `askPermissionViaChat()`.
2. Mattermost `reply.buttons()` posts the prompt as a normal Mattermost post with `props.attachments[0].actions`.
3. Each action includes the button label, style, `integration.url`, and signed `integration.context`.
4. Signed context includes `platformInstanceId`, `callbackData`, original prompt content, expiry timestamp, and nonce-like entropy.

### Clicking A Button

1. Mattermost sends `POST /mattermost/actions` with `user_id`, `post_id`, `channel_id`, `team_id`, and the action context.
2. The route validates method, content type, JSON payload shape, expiry, and signature.
3. The route builds an `IncomingInteraction` with `kind: 'button'`, `callbackData`, `contextId = channel_id`, `messageId = post_id`, `platformInstanceId`, and a resolved context type.
4. The normal authorization check runs for the Mattermost user and channel.
5. `routeInteraction()` handles `perm:a:<id>` or `perm:d:<id>` by resolving the pending permission request.
6. The HTTP response to Mattermost returns an `update` that keeps the original prompt and reason, appends `Allowed.` or `Denied.`, and removes button actions.

If a valid callback has no matching route, return an ephemeral response such as `Action is no longer available.` rather than creating a normal bot message.

## Security And Configuration

`SETTINGS_PUBLIC_BASE_URL` is required for Mattermost buttons. If it is missing, `reply.buttons()` rejects with a clear configuration error and does not post unusable buttons.

Mattermost action context uses stateless HMAC signing. The signing key is a dedicated generated secret stored in `system_config`, for example `mattermost_action_signing_secret`, seeded lazily on first use. Do not use an env-only secret because callback verification must remain stable across restarts. Do not reuse the instance config encryption key because callback signing has different rotation and blast-radius concerns.

Signed context includes:

- `platformInstanceId`.
- `callbackData`.
- Original prompt content for final post update.
- Expiry timestamp.
- Nonce-like entropy.
- Signature.

Verification rejects missing fields, malformed payloads, expired actions, bad signatures, and unknown platform instances. The public callback route must not trust the route caller. It trusts only valid signed context plus normal papai authorization for the Mattermost user and channel.

Logs must not include signed context wholesale, callback context wholesale, or prompt/reason text. They may include non-sensitive metadata such as platform instance ID, channel ID, post ID, callback prefix, and failure type.

Debug route gating fails closed. With `DEBUG_SERVER=false`, logs, event streams, turn inspection, and debug static assets are unavailable.

## Error Handling

### Send-Time Failures

- Missing `SETTINGS_PUBLIC_BASE_URL`: reject with a clear Mattermost interactive-button configuration error.
- Too many buttons or invalid button labels/callback payloads: reject before posting.
- Mattermost API post failure: preserve existing API error behavior and log non-sensitive metadata.

### Callback-Time Failures

- Non-POST requests return 405.
- Invalid content type, invalid JSON, or invalid payload shape returns a Mattermost error response with a generic `Invalid action payload.` message.
- Expired or bad signatures return a Mattermost error response with `This action is no longer valid.`
- Unauthorized users or channels receive `ephemeral_text` explaining that they are not authorized; the original post is not updated.
- Already-resolved or missing permission requests return `Action is no longer available.` and do not rerun the decision.
- Unexpected handler exceptions are logged with non-sensitive metadata and return a Mattermost error response.

Successful permission clicks are idempotent from the user perspective. The first valid click resolves the pending request and updates the post. Later clicks do not rerun the decision and report that the action is no longer available.

## Permission Decision UX

The final Mattermost post keeps the original permission prompt and reason, then appends the decision.

Example before click:

```text
Run `delete_task`?

The model wants to delete task ABC-123.

[Allow] [Deny]
```

Example after allowing:

```text
Run `delete_task`?

The model wants to delete task ABC-123.

Allowed.
```

Example after denying:

```text
Run `delete_task`?

The model wants to delete task ABC-123.

Denied.
```

The buttons disappear after the decision.

## Testing

Use focused Bun tests rather than E2E.

Test coverage should include:

- Server startup/routing: settings/admin/auth routes remain mounted when debug is disabled; debug-only routes are disabled when `DEBUG_SERVER=false`.
- Mattermost reply helper: `reply.buttons()` posts correct Mattermost attachment actions, maps styles, includes signed context, uses `SETTINGS_PUBLIC_BASE_URL`, preserves thread root behavior, and rejects missing config.
- Mattermost callback route: accepts valid signed callbacks; rejects bad signatures, expired contexts, and malformed payloads; maps payloads into `IncomingInteraction`; and returns Mattermost-compatible `update`, `ephemeral_text`, or `error` responses.
- Interaction router: `perm:a:<id>` and `perm:d:<id>` resolve existing permission requests and return handled; unknown callbacks still return false.
- Permission prompt behavior: final Mattermost updates keep original prompt/reason and append `Allowed.` or `Denied.`.
- Capability metadata: Mattermost advertises `messages.buttons` and `interactions.callbacks` after implementation.

Verification after implementation should include touched server/chat tests, `bun run format:check`, and `bun check:full` because startup and routing behavior are affected.

## Acceptance Criteria

- `/settings`, `/settings/api/*`, `/admin`, and `/auth/*` are available when `DEBUG_SERVER=false`.
- `/debug`, `/events`, `/logs`, and `/turns/*` are unavailable when `DEBUG_SERVER=false`.
- Mattermost `reply.buttons()` posts native interactive buttons when `SETTINGS_PUBLIC_BASE_URL` is configured.
- Mattermost button callbacks are accepted only with valid signed context.
- Mattermost permission buttons resolve existing permission prompts through `routeInteraction()`.
- Successful Mattermost permission decisions update the original post, keep the original prompt/reason, append the decision, and remove buttons.
- Invalid, expired, unauthorized, or already-consumed callbacks produce safe user-visible Mattermost responses without rerunning decisions.
