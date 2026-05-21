<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0014: Multi-Chat Provider Abstraction

## Status

Accepted

## Date

2026-03-19

## Context

papai was originally built exclusively on Grammy (Telegram's TypeScript framework), with Telegram-specific types (`Bot`, `Context`, `ctx.from`, `ctx.reply`) pervasive throughout `bot.ts`, all command handlers, `llm-orchestrator.ts`, and `announcements.ts`. Users on Mattermost had no way to interact with the bot.

Adding Mattermost support by branching on a runtime flag inside the existing code would have created a deeply coupled tangle. The `TaskProvider` abstraction already in `src/providers/` provided a proven pattern for platform-agnostic interfaces, suggesting the same approach for chat platforms.

Additionally, the user identity model used `telegram_id INTEGER PRIMARY KEY` in the SQLite schema, making it structurally impossible to store Mattermost user IDs (which are strings like `abc123def456`) in the same table.

## Decision Drivers

- Single deployment runs against exactly one chat platform (configured via `CHAT_PROVIDER` env var); no multi-platform fan-out required
- Command handlers, LLM orchestration, and announcement logic must be testable without any Grammy or Mattermost dependency
- The existing `TaskProvider` pattern (interface + registry + per-provider adapter) is well-understood by the team and should be mirrored
- Telegram user IDs (numeric) and Mattermost user IDs (alphanumeric strings) must be stored in the same table without casting hacks
- `ADMIN_USER_ID` must be a single env var that works for both platforms

## Considered Options

### Option 1: ChatProvider interface + per-platform adapter + registry (chosen)

- **Pros**: Mirrors the established `TaskProvider` pattern; command handlers become fully platform-agnostic; easy to add future platforms (Discord, Slack) by implementing one interface; `userId` is always `string` so schema works for both platforms
- **Cons**: Requires a coordinated refactor across `bot.ts`, all command handlers, `llm-orchestrator.ts`, `users.ts`, `announcements.ts`, and a DB migration; non-trivial up-front cost

### Option 2: Grammy multi-protocol plugins (e.g. `grammy-runner` + a Mattermost shim)

- **Pros**: Less code change if a compatible shim existed
- **Cons**: No credible Grammy-compatible Mattermost shim exists; would still require adapting Grammy's `Context` type for non-Telegram use; does not solve the schema issue

### Option 3: Runtime branching with `if (provider === 'telegram')` guards

- **Pros**: Minimal upfront structural change
- **Cons**: Every callsite in `bot.ts`, command handlers, and `llm-orchestrator.ts` would need a branch; impossible to test platform-agnostically; grows linearly with each new platform

## Decision

Introduce a `ChatProvider` interface in `src/chat/types.ts` with `registerCommand`, `onMessage`, `sendMessage`, `start`, and `stop`. Define a `ReplyFn` type (`text`, `formatted`, `file`, `typing`) so handlers never receive a platform context object. Implement `TelegramChatProvider` (Grammy-based) in `src/chat/telegram/index.ts` and `MattermostChatProvider` (REST + WebSocket) in `src/chat/mattermost/index.ts`. Register both in `src/chat/registry.ts` and instantiate via `createChatProvider(process.env['CHAT_PROVIDER'])` in `src/index.ts`.

Migrate the `users` table from `telegram_id INTEGER` to `platform_user_id TEXT` via a SQLite migration (`migrations/007_platform_user_id.ts`). Update all modules that accepted `userId: number` to use `userId: string`.

## Rationale

The `ChatProvider` interface with `ReplyFn` injection ensures that no command handler or orchestration module imports Grammy or Mattermost client code, making them independently testable and platform-neutral. The registry pattern keeps `src/index.ts` clean (one line to instantiate the provider) and makes adding future platforms a self-contained change.

Migrating user IDs to `TEXT` is a prerequisite for correctness rather than an optimisation: Mattermost IDs are 26-character alphanumeric strings that cannot round-trip through `INTEGER`.

The actual `ChatUser` type gained additional fields (`isAdmin`, `contextId`, `contextType`, `isMentioned`) beyond the original design to support group chat contexts, reflecting requirements that emerged during implementation.

## Consequences

### Positive

- `bot.ts` and all command handlers import zero Grammy or Mattermost types
- `llm-orchestrator.ts` takes `ReplyFn` + `userId: string` with no platform dependency
- Adding a third platform requires only a new adapter implementing `ChatProvider` and one line in `registry.ts`
- `ADMIN_USER_ID` works for both Telegram (numeric string) and Mattermost (alphanumeric string)
- User identity is platform-agnostic across the entire persistence layer

### Negative

- The DB migration from `INTEGER` to `TEXT` is irreversible without a counter-migration; existing deployments must run the migration on upgrade
- Grammy remains a production dependency (used only inside `TelegramChatProvider`); it cannot be removed from `package.json`
- The `ChatUser` type is richer than the minimal design (four extra fields for group support), increasing the implementation surface for future adapters

## Implementation Status

**Status**: Implemented

Evidence:

- `src/chat/types.ts` — `ChatProvider` interface, `ReplyFn`, `IncomingMessage`, `ChatUser`, `CommandHandler`, `AuthorizationResult`, `ContextType` types all present; `ChatUser` has additional `isAdmin` field and `IncomingMessage` has `contextId`/`contextType`/`isMentioned` vs. the original design (group support added during implementation)
- `src/chat/registry.ts` — `createChatProvider(name)` factory; both `telegram` and `mattermost` registered at module load
- `src/chat/telegram/index.ts` — `TelegramChatProvider` implementing `ChatProvider`
- `src/chat/telegram/format.ts` — markdown-to-Telegram-entity formatter (moved from `src/utils/format.ts`)
- `src/chat/mattermost/index.ts` — `MattermostChatProvider` using REST API + WebSocket
- `src/bot.ts` — imports only `ChatProvider`/`ChatUser` types from `src/chat/types.ts`; no Grammy imports
- `src/users.ts` — all functions accept `userId: string`; DB record uses `platform_user_id`
- `src/db/migrations/007_platform_user_id.ts` — migration renaming `telegram_id INTEGER` → `platform_user_id TEXT`
- `src/index.ts` — reads `CHAT_PROVIDER` env var, calls `createChatProvider()`

## Related Plans

- `/Users/ki/Projects/experiments/papai/docs/plans/done/2026-03-19-multi-chat-provider-design.md`
- `/Users/ki/Projects/experiments/papai/docs/plans/done/2026-03-19-multi-chat-provider-implementation.md`
