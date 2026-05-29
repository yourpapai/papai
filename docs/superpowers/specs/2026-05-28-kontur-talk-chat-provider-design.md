<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Kontur Talk Chat Provider Design

## Summary

Add Kontur Talk (Толк.Чаты) as a fourth chat provider in papai. The bot communicates via the Kontur Talk Chat Bot API using long polling for receiving messages and REST for sending. MVP scope: text messages and threads only; media support deferred to Phase 2.

## Context

Kontur Talk is a corporate messenger by SKB Kontur. Its Chat Bot API is Matrix-compatible (room IDs like `!room:host`, user IDs like `@user:host`). Bots are created in the Talk.Chats space settings UI, which generates a JWT token used for all API calls.

API documentation: https://kontur.renote.team/doc/NNyX6DGvQ

## Capabilities & Traits

| Property                              | Value                    |
| ------------------------------------- | ------------------------ |
| `name`                                | `'kontur-talk'`          |
| `capabilities`                        | `messages.reply-context` |
| `traits.observedGroupMessages`        | `'all'`                  |
| `traits.maxMessageLength`             | `4096`                   |
| `threadCapabilities.supportsThreads`  | `true`                   |
| `threadCapabilities.canCreateThreads` | `true`                   |
| `threadCapabilities.threadScope`      | `'message'`              |
| `configRequirements`                  | `KONTUR_TALK_JWT_TOKEN`  |

Absent capabilities (no API support): `commands.menu`, `interactions.callbacks`, `messages.buttons`, `messages.delete`, `messages.redact`, `files.receive`, `users.resolve`.

## File Structure

All platform-specific code in `src/chat/kontur-talk/`:

| File                  | Purpose                                                                      |
| --------------------- | ---------------------------------------------------------------------------- |
| `index.ts`            | `KonturTalkChatProvider` class implementing `ChatProvider`                   |
| `config.ts`           | Config resolution (`KonturTalkConstructorConfig` -> resolved config)         |
| `schema.ts`           | Zod schemas for API responses (updates, send_message, errors)                |
| `metadata.ts`         | `konturTalkCapabilities`, `konturTalkTraits`, `konturTalkConfigRequirements` |
| `context-renderer.ts` | Renders `ContextSnapshot` as formatted markdown table                        |
| `reply-helpers.ts`    | Constructs `ReplyFn` (text, formatted, typing)                               |
| `label-helpers.ts`    | `resolveKonturTalkUserLabel()`, `resolveKonturTalkGroupLabel()`              |

## Authentication & API Layer

**Base URL** (hardcoded): `https://chat.ktalk.ru/_matrix/client/strangler/api/v1`

**Auth**: JWT token passed as URL path segment. All requests go through:

```
{base_url}/bot/{jwt_token}/{endpoint}
```

**API layer**: Private `apiFetch(method, path, body?)` method on the provider class. Constructs the full URL, uses `fetch()` with JSON content type. All REST calls go through this.

**Constructor config**:

```typescript
type KonturTalkConstructorConfig = {
  jwtToken?: string // optional, falls back to KONTUR_TALK_JWT_TOKEN env
  platformInstanceId?: string
}
```

**Bot identity**: No `/users/me` endpoint. Extract `sub` from JWT payload via `JSON.parse(atob(token.split('.')[1]))`. Store as `botUserId` for self-message filtering.

**Env validation**: Add `KONTUR_TALK_JWT_TOKEN` to the validation map in `env-validation.ts`.

## Message Loop

Long polling via `GET /get_updates?timeout=30`.

1. `start()`: Extract `botUserId` from JWT. Start polling loop.
2. Polling loop: `while (this.running)` — call `get_updates`, process each update, poll again immediately on success. On error, wait 5s before retry.
3. `stop()`: Set `this.running = false`. The in-flight request resolves naturally (30s timeout).

**Self-message filtering**: Skip updates where `user_id` matches `botUserId`.

No WebSocket support in the API — long polling only.

## Message Mapping

### IncomingMessage

| Field                | Source                                                   |
| -------------------- | -------------------------------------------------------- |
| `user.id`            | `user_id` (e.g. `@alice:host`)                           |
| `user.name`          | `user_id` (no display name API)                          |
| `contextId`          | `room_id`                                                |
| `contextType`        | `room_is_direct ? 'dm' : 'group'`                        |
| `isMentioned`        | `botUserId` in `mentions` array, or `mentions === 'all'` |
| `text`               | `body`                                                   |
| `messageId`          | `event_id`                                               |
| `threadId`           | `thread_id` if present                                   |
| `replyToMessageId`   | `reply_id` if present                                    |
| `platformInstanceId` | Injected by router                                       |

### Command matching

Simple `/command args` pattern on `body`, same as Mattermost.

### ReplyFn

| Method          | Implementation                           |
| --------------- | ---------------------------------------- |
| `text()`        | `send_message` with `format: 'plain'`    |
| `formatted()`   | `send_message` with `format: 'markdown'` |
| `typing()`      | No-op (no typing indicator API)          |
| `buttons()`     | Throws (no interactive buttons)          |
| `replaceText`   | Not available                            |
| `file`          | Not available (Phase 2)                  |
| `redactMessage` | Not available                            |
| `deleteMessage` | Not available                            |

All `send_message` calls pass `thread_id` from the incoming message's `threadId`.

## Thread Handling

- Incoming messages with `thread_id` set are inside a thread. Passed through to `IncomingMessage.threadId`.
- When the bot replies with `thread_id: null` in a group, the API implicitly creates a thread. No explicit thread-creation endpoint needed.
- `thread_id` flows into `storageContextId` via `getThreadScopedStorageContextId()`, giving each thread isolated conversation history, memory, memos, etc.
- Thread scope label: `'message'` — thread IDs are opaque strings from the API.

## sendMessage (Deferred Delivery)

`sendMessage()` on the provider handles deferred delivery (proactive sends, recurring tasks):

- For groups: Send directly to `room_id` from `DeferredDeliveryTarget.contextId`.
- For DMs: The API has no create-DM endpoint. Proactive DM delivery is not supported in the MVP. `sendMessage()` returns `false` for DM targets. This matches the provider's capability profile (no `users.resolve`).
- `thread_id` from `DeferredDeliveryTarget.threadId` if present.

## Registration & Bootstrap

1. **Registry** (`src/chat/registry.ts`): Add `'kontur-talk'` entry mapping to `new KonturTalkChatProvider(deps)`.
2. **Env validation** (`src/env-validation.ts`): Add `'kontur-talk'` to the provider allowlist with `KONTUR_TALK_JWT_TOKEN` requirement.
3. **Bootstrap** (`src/instances/bootstrap.ts`): Add `'kontur-talk'` to `CHAT_PROVIDER` enum and its env mapping.
4. **Platform descriptors**: Add Kontur Talk descriptor to `listPlatformProviderTypes()` for the admin UI.

## Limitations (MVP)

- No media upload/download (Phase 2)
- No interactive buttons or callbacks
- No message delete/edit
- No typing indicators
- No user display name resolution (user_id shown as-is)
- No bot command menu (commands registered at app level only)
- Long polling only (no WebSocket)
- Max 10 bots per space (API limit)
- Max 4096 characters per message

## Future: Phase 2 — Media Support

- `upload_image`: Multipart form upload, returns MXC URL. Add `file` to ReplyFn.
- `download_media`: POST with MXC URL, returns binary data. Add `files.receive` capability.
- Support `m.image`, `m.video`, `m.file`, `m.audio` message types in incoming message parsing.
