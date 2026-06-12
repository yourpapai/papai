<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0140: Kontur Talk Chat Provider

## Status

Implemented

## Date

2026-05-28 – 2026-06-02

## Context

papai supported three chat platforms (Telegram, Mattermost, Discord) and needed
a fourth: Kontur Talk (Толк.Чаты), a corporate messenger by SKB Kontur used
internally. The Kontur Talk Chat Bot API is Matrix-compatible (room IDs like
`!room:host`, user IDs like `@user:host`) and uses JWT-based authentication
with long polling for message receipt.

The existing provider pattern (class implementing `ChatProvider`, REST API
calls, Zod-validated responses, long polling loop) established by the
Mattermost adapter was a proven fit. The Kontur Talk API is simpler than
Mattermost — no WebSocket, no interactive callbacks, no file upload/download
in the MVP — but shares enough structure (rooms, threads, long polling) to
follow the same architectural pattern with minimal deviation.

Design spec: `docs/archive/2026-05-28-kontur-talk-chat-provider-design.md`.
Implementation plan: `docs/archive/2026-05-28-kontur-talk-chat-provider.md`.

## Decision Drivers

- **Pattern consistency**: The Mattermost adapter proved the long-polling
  `ChatProvider` pattern; Kontur Talk should follow it, not invent a new one.
- **MVP scope**: Text messages and threads first. Media, interactive buttons,
  and typing indicators are not in the initial API surface.
- **Authentication simplicity**: The API uses a JWT token as a URL path
  segment rather than headers. Bot identity is extracted from the JWT `sub`
  claim, avoiding an extra `/users/me` call.
- **Thread isolation**: Kontur Talk threads must map to thread-scoped
  `storageContextId`, preserving the same conversation/memory isolation as
  Telegram and Mattermost.
- **No proactive DMs**: The API lacks a create-DM endpoint; deferred delivery
  to DM contexts must degrade gracefully rather than fail silently.

## Considered Options

### Option A: WebSocket-based adapter

Kontur Talk's underlying Matrix protocol supports WebSocket sync, though the
Chat Bot API does not expose it.

- **Pros**: Lower latency; event-driven architecture.
- **Cons**: No WebSocket endpoint in the Chat Bot API; would require a
  different authentication flow; significantly more complex state management.

### Option B: Long polling adapter (chosen)

Use `GET /get_updates?timeout=30` in a `while (running)` loop, exactly as
the Mattermost adapter does.

- **Pros**: Matches existing pattern; simple retry logic; natural shutdown
  via `running` flag; 30s timeout means `stop()` resolves within one cycle.
- **Cons**: Up to 30s latency on first message after idle; no push events.

### Option C: Shared Matrix adapter for Kontur Talk and future Matrix servers

Build a generic Matrix protocol adapter that Kontur Talk inherits.

- **Pros**: Reusable if other Matrix-based platforms are added.
- **Cons**: Kontur Talk's API is a strict subset with proprietary endpoints
  (`/send_message`, `/get_updates`); a generic Matrix adapter would abstract
  over differences that don't yet exist; YAGNI.

### Option D: Header-based auth instead of URL path

Pass the JWT in an `Authorization: Bearer` header instead of the URL path.

- **Pros**: Standard auth pattern; token not in server logs or URL.
- **Cons**: The Kontur Talk API requires the token as a path segment
  (`/bot/{jwt_token}/{endpoint}`); headers are not accepted.

## Decision

**Option B** for the transport, with the following subsidiary decisions:

| Topic              | Decision                                                                                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transport          | Long polling via `GET /get_updates?timeout=30`. Retry after 5s on error. Loop exits when `running` is false.                                                               |
| Authentication     | JWT token as URL path segment (`/bot/{jwt_token}/{endpoint}`). No header auth.                                                                                             |
| Bot identity       | Extract `sub` claim from JWT payload via `JSON.parse(atob(token.split('.')[1]))`. No `/users/me` call.                                                                     |
| Capabilities (MVP) | `messages.reply-context` only. No buttons, files, delete, redact, typing, user resolution, or command menus.                                                               |
| Traits             | `observedGroupMessages: 'all'`, `maxMessageLength: 4096`.                                                                                                                  |
| Thread model       | `supportsThreads: true`, `canCreateThreads: true`, `threadScope: 'message'`. Thread ID from API `thread_id` field; null `thread_id` in groups implicitly creates a thread. |
| ReplyFn            | `text()` sends `format: 'plain'`; `formatted()` sends `format: 'markdown'`; `typing()` is no-op; `buttons()` throws.                                                       |
| Deferred delivery  | Groups: send to `room_id`. DMs: not supported (no create-DM API); `sendMessage()` logs warning and returns.                                                                |
| Label resolution   | User labels return `user_id` as-is (no display name API). Group labels return `null`.                                                                                      |
| File structure     | All code in `src/chat/kontur-talk/` following the per-provider directory convention.                                                                                       |
| Config             | Single required credential: `KONTUR_TALK_JWT_TOKEN`. Constructor config takes precedence over env.                                                                         |
| Registration       | Added to `src/chat/registry.ts`, `src/instances/types.ts` (union), `src/instances/bootstrap.ts`, and `src/env-validation.ts`.                                              |

## Consequences

### Positive

- Fourth platform available with minimal architectural deviation from the
  Mattermost pattern.
- Thread-scoped conversation isolation works identically to Telegram and
  Mattermost, preserving consistent memory/memo semantics.
- JWT-based identity extraction avoids an extra network call on startup.
- Capability-driven gating means the bot's tool assembly and system prompt
  automatically exclude unsupported features (buttons, files) without
  hard-coding provider names.
- Simple long polling loop is easy to debug and has predictable shutdown
  behavior.

### Negative

- No proactive DM delivery limits the bot's ability to send deferred prompts
  or recurring task reminders in private contexts.
- Long polling introduces up to 30s latency on first inbound after an idle
  period (the in-flight request must complete before the next poll starts).
- No display name resolution means user IDs appear as raw Matrix-style IDs
  (`@alice:host`) in bot replies and logs.
- No media support in MVP limits file attachment workflows for Kontur Talk
  users.

### Risks

- The hardcoded base URL (`https://chat.ktalk.ru/...`) means self-hosted or
  staging Kontur Talk instances are not supported without a code change.
- JWT token in the URL path may appear in server access logs or proxy logs;
  mitigate by ensuring log redaction and `Secure` cookie policy.
- API rate limits or the 10-bot-per-space constraint could become bottlenecks
  for large deployments; no mitigation in MVP beyond monitoring.

## Implementation Notes

Key modules (`src/chat/kontur-talk/`):

| File                  | Role                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `index.ts`            | `KonturTalkChatProvider` class — long polling loop, message dispatch, `sendMessage`       |
| `metadata.ts`         | `konturTalkCapabilities`, `konturTalkTraits`, `konturTalkConfigRequirements`              |
| `config.ts`           | `KonturTalkConstructorConfig` type, `resolveKonturTalkConfig` with env fallback           |
| `schema.ts`           | Zod schemas for `get_updates`, `send_message`, and error responses                        |
| `reply-helpers.ts`    | `createKonturTalkReplyFn` factory — text, formatted, typing, buttons                      |
| `context-renderer.ts` | `renderKonturTalkContext` — formatted markdown table with token grid                      |
| `label-helpers.ts`    | `resolveKonturTalkUserLabel`, `resolveKonturTalkGroupLabel` (identity passthrough / null) |

Integration points: `src/chat/registry.ts` (descriptor + factory),
`src/instances/types.ts` (`PlatformInstanceType` union), `src/instances/bootstrap.ts`
(env requirements + config builder), `src/env-validation.ts` (provider allowlist).

## Related Decisions

- ADR-0014: Multi-Chat Provider Abstraction — the `ChatProvider` interface
  this adapter implements.
- ADR-0009: Multi-Provider Task Tracker Support — capability model shared
  across chat and task providers.
- ADR-0123: Trusted-Local Plugin System — plugin eligibility evaluation
  uses the same capability-driven gating pattern.
