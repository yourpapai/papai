<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0059: Thread-Aware Group Chat

## Status

Implemented

## Date

2026-04-10

## Context

Group chat support (ADR-0018) introduced shared conversation history scoped to a `groupId`. All group members share a single flat history regardless of the thread or topic they are writing in. This causes several problems:

1. **Telegram forum groups**: When the bot is @mentioned in the main chat of a forum-enabled supergroup, it replies in the main chat rather than creating a dedicated forum topic. The conversation then pollutes the main feed and is hard to follow.
2. **Mattermost channels**: Bot replies are posted as top-level messages rather than threaded replies to the originating message, scattering context across the channel.
3. **History isolation**: All threads share the same conversation history under `groupId`, so a question about Project A in one thread contaminates the context for a question about Project B in another.
4. **No cross-thread visibility**: When operating inside a thread, the bot has no way to look up information from the main group chat.

The ChatProvider interface (ADR-0014, ADR-0018) already carried `IncomingMessage.contextId` and `contextType` but had no thread-level differentiation. Platform thread mechanics (Telegram `message_thread_id`, Mattermost `root_id`) were not surfaced to the bot layer.

## Decision Drivers

- Thread/topic conversations must have isolated history so unrelated topics do not interfere
- Memory facts, user configuration, and instructions must remain group-scoped (shared across threads)
- Authorization checks must continue using the group ID (not thread ID) for membership validation
- The bot must be able to query main-group context when working inside a thread
- Platform-specific thread mechanics must stay inside each adapter, surfaced through a uniform `threadId` field
- No data migration: existing group histories under `groupId` remain the main-chat history

## Considered Options

### Option 1: No thread awareness — flat group history only

- **Pros**: No implementation effort; existing group history model unchanged
- **Cons**: Forum topic and thread conversations are impossible to follow; single shared context degrades with group activity; bot cannot create forum topics on Telegram

### Option 2: Thread-scoped history with separate storage keys (chosen)

Generate a composite storage key `groupId:threadId` for conversation history when inside a thread, while keeping memory, config, and instructions under `groupId`. Add a `lookup_group_history` tool that uses `small_model` to search main-chat history from within a thread.

- **Pros**: Thread conversations are isolated; main-chat context is accessible; no storage-layer changes required (composite key is transparent); no data migration
- **Cons**: Composite key format (`groupId:threadId`) is an implicit convention that all consumers must respect; `lookup_group_history` tool requires LLM call per invocation

### Option 3: Per-thread storage with explicit thread table

Add a `threads` table mapping thread IDs to group IDs, with separate history records per thread.

- **Pros**: Explicit foreign-key relationship; queryable metadata about threads
- **Cons**: Schema migration required; storage layer needs thread-aware queries; over-engineering for current needs

## Decision

Add a `ThreadCapabilities` type to the `ChatProvider` interface so each adapter declares its thread support level. Add `threadId?: string` to `IncomingMessage` so adapters can communicate the current thread.

Implement thread-scoped storage context IDs via a pure function `getThreadScopedStorageContextId(contextId, contextType, threadId)` that returns `groupId:threadId` when in a group thread, `groupId` in main chat, and `userId` in DMs. Place this function in `src/auth.ts` alongside the authorization helpers that consume it.

Telegram adapter: declare `canCreateThreads: true`, create forum topics when @mentioned in the main chat of a forum supergroup, and pass `message_thread_id` through to the bot layer.

Mattermost adapter: declare `canCreateThreads: true`, use `root_id` for threaded replies, and pass the root post ID through as `threadId`.

Discord adapter: declare `supportsThreads: false` (not yet thread-scoped).

Add a `lookup_group_history` tool that loads main-chat history under the bare `groupId` key and uses the configured `small_model` to extract information relevant to the caller's queries.

## Rationale

The composite storage key approach (`groupId:threadId`) keeps the storage layer unchanged — history, memory, and config modules already accept an arbitrary string key. The same `storageContextId` mechanism that ADR-0018 introduced for DM/group separation now also handles thread isolation without any storage module needing to know about threads.

Keeping `getThreadScopedStorageContextId` in `src/auth.ts` (rather than the originally planned `src/bot.ts`) collocates it with the authorization functions that produce `AuthorizationResult.storageContextId`, making the key-generation logic discoverable where it is consumed.

The `ThreadCapabilities` metadata on each provider lets the tool layer and bot logic make feature-driven decisions (e.g., whether to offer thread-creation behavior) without hard-coding provider name checks.

The `lookup_group_history` tool uses `small_model` rather than a full embedding/vector search because the main-chat history cache is already in memory and the query volume is low. A full search infrastructure would be premature.

## Consequences

### Positive

- Thread conversations have isolated history, preventing context pollution between unrelated topics
- Bot creates Telegram forum topics automatically on @mention, improving UX in forum groups
- Bot replies in Mattermost threads rather than as top-level posts
- Main-group context remains accessible from within threads via `lookup_group_history`
- Memory, config, and instructions are shared across threads within a group (no duplication)
- No data migration: existing histories under `groupId` become main-chat history automatically
- Discord adapter has the interface stub (`supportsThreads: false`) ready for future thread support

### Negative

- Composite key format `groupId:threadId` is a convention rather than an enforced type; any code that splits on `:` to recover the group ID must handle the format explicitly
- `lookup_group_history` requires an LLM call per invocation, adding latency and token cost
- The `getThreadScopedStorageContextId` function lives in `src/auth.ts` rather than a more intuitive location; this was a refactoring artifact from extracting auth logic from `src/bot.ts`
- No explicit thread metadata (creation time, title, status) is stored; threads exist only as storage key suffixes

### Risks

- Very long thread IDs could create storage key collisions in pathological cases; mitigated by using platform-native IDs which are bounded-length
- `lookup_group_history` could expose sensitive main-chat content to a thread participant who is also a group member; this is acceptable since group membership is already the authorization boundary

## Implementation Status

**Status**: Implemented

### ThreadCapabilities type (`src/chat/types.ts`)

**Planned**: `ThreadCapabilities` type with `supportsThreads`, `canCreateThreads`, `threadScope` fields. Added to `ChatProvider` interface as `readonly threadCapabilities: ThreadCapabilities`.

**Actual**: Implemented exactly as designed in `src/chat/types.ts:21-28`. The `ChatProvider` interface exposes `readonly threadCapabilities: ThreadCapabilities` at `src/chat/types.ts:235`. Tests in `tests/chat/types.test.ts`.

### threadId on IncomingMessage (`src/chat/types.ts`)

**Planned**: `threadId?: string` on `IncomingMessage`.

**Actual**: `threadId?: string` present at `src/chat/types.ts:91`. Also propagated to `AuthorizationRequest` (line 121), `AuthorizationResult` (line 139), and `ContextSnapshot` (line 159).

### Telegram adapter (`src/chat/telegram/index.ts`)

**Planned**: `canCreateThreads: true`, `threadScope: 'message'`, forum topic creation on @mention.

**Actual**: `threadCapabilities` declared at `src/chat/telegram/index.ts:47-51` with `supportsThreads: true`, `canCreateThreads: true`, `threadScope: 'message'`. Forum topic creation implemented. Tests verify capabilities at `tests/chat/telegram/index.test.ts:64-66`.

### Mattermost adapter (`src/chat/mattermost/index.ts`)

**Planned**: `canCreateThreads: false` (users create threads, bot replies).

**Actual**: `canCreateThreads: true` at `src/chat/mattermost/index.ts:36-40`. **Divergence**: the design specified `canCreateThreads: false` because Mattermost users initiate threads by replying and the bot only sets `root_id`. The implementation marks it `true` because the bot does create threaded replies by setting `root_id` on its first response, which effectively creates the thread from the bot's perspective.

### Discord adapter (`src/chat/discord/index.ts`)

**Planned**: Not part of original design (Discord was added later in ADR-0051).

**Actual**: `src/chat/discord/index.ts:43-47` declares `supportsThreads: false`, `canCreateThreads: false`, `threadScope: 'message'`. No thread handling.

### Thread-scoped storage context ID (`src/auth.ts`)

**Planned**: `getThreadScopedStorageContextId` in `src/bot.ts`.

**Actual**: Function lives in `src/auth.ts:14-24` after auth logic was extracted from `src/bot.ts`. Logic matches the design: returns `contextId` for DMs, `contextId` for main chat (no thread), `groupId:threadId` for threads. Tests in `tests/auth.test.ts:14-27` and `tests/bot.test.ts:669-683`.

### lookup_group_history tool (`src/tools/lookup-group-history.ts`)

**Planned**: Tool using `small_model` to search main-chat history.

**Actual**: Implemented in `src/tools/lookup-group-history.ts` with DI-based `executeLookupGroupHistory` function. Registered in `src/tools/tools-builder.ts:252`. Uses `small_model` via `getSmallModelForUser` helper. Extracts `groupId` from `contextId` by splitting on `:` to get the bare group key.

## Related Decisions

- **ADR-0014** (Multi-Chat Provider Abstraction) — `ChatProvider` interface foundation
- **ADR-0018** (Group Chat Support) — Group-scoped `contextId` and `storageContextId` that thread-awareness builds on
- **ADR-0051** (Discord Chat Provider) — Discord adapter with `supportsThreads: false` stub
- **ADR-0058** (Provider Capability Architecture) — Capability-driven behavior model that `ThreadCapabilities` follows
