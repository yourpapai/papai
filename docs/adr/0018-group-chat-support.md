<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0018: Group Chat Support

## Status

Implemented

## Date

2026-03-20

## Context

papai was originally designed exclusively for direct-message (DM) interactions. Every storage lookup, authorization check, and configuration key used `userId` as the primary identifier, meaning all history, facts, and LLM config were strictly per-user and isolated. There was no concept of a shared conversation context, and the bot silently ignored all messages in group chats or channels on both Telegram and Mattermost.

Teams using papai for task management needed the bot to work inside Telegram groups and Mattermost channels so that multiple team members could collaborate on the same task tracker through a shared conversation context. Key requirements that DM-only mode could not satisfy:

- Multiple team members sharing the same project context and conversation history within a channel
- Group-scoped LLM configuration (API keys, model selection) set once for the whole team
- Controlled membership: only explicitly authorized users should be able to invoke the bot in a group, not every member of the chat
- Natural language requests in groups should require an explicit `@mention` to prevent the bot from reacting to every message in busy channels

The multi-chat provider abstraction introduced in ADR-0014 had already made the `ChatProvider` interface platform-agnostic, giving a clean insertion point for group context detection without touching `bot.ts` command handlers.

## Decision Drivers

- Teams need shared, group-scoped conversation history and configuration, separate from individual DM sessions
- Group membership must be managed independently from bot-level user authorization (`/user add`); a user authorized for DM may not be a member of a specific group, and vice versa
- Natural language queries in groups must require an `@mention` to avoid noise in active channels; slash commands must work without a mention
- Platform admins (Telegram group admins, Mattermost channel admins) must be able to manage group membership without additional bot-level admin privileges
- The `contextId` abstraction must be transparent to all storage layers (history, memory, config, cache) so no storage module needs group-specific branching
- Admin status detection must be re-evaluated per message (admins can be added or removed at any time)
- Failure to detect admin status (e.g., network error, bot not a group member) must default to non-admin rather than throwing

## Considered Options

### Option 1: No group support — DM only

- **Pros**: No added complexity; existing authorization model unchanged
- **Cons**: Teams cannot collaborate through a shared bot session; bot silently ignores group messages, which is confusing for users

### Option 2: Simple group access without member management

Allow any Telegram group member or Mattermost channel member to invoke the bot. No separate membership table; the group chat itself defines access.

- **Pros**: Simpler; no `/group adduser` ceremony required
- **Cons**: Bot operators lose control over who can consume LLM API quota in their account; any user added to the Telegram group automatically gains access; no way to grant fine-grained per-group authorization
- **Cons**: Group config (API key, model) would be accessible to anyone in the group

### Option 3: Full group member management with a separate authorization layer (chosen)

Introduce a `group_members` SQLite table keyed on `(group_id, user_id)`. Extend `IncomingMessage` with `contextId`, `contextType`, and `isMentioned`. Add a two-tier authorization engine that checks bot-level user auth first, then group membership. Detect platform admin status per message to gate `/group` management commands.

- **Pros**: Fine-grained access control; group membership is independent of bot-level authorization; natural mention-gating prevents noise; shared `contextId` storage is transparent to all storage modules
- **Cons**: Added complexity: a new DB table, a new module, a new command, and per-message async admin status checks on both platforms; platform admin detection logic differs between Telegram and Mattermost

## Decision

Extend the `ChatProvider` contract and `IncomingMessage` type with three new fields: `contextId` (the storage key, equal to `userId` in DMs and `groupId` in groups), `contextType` (`'dm' | 'group'`), and `isMentioned` (whether the bot was `@mentioned`). Add `isAdmin` to `ChatUser` to carry the result of per-message platform admin detection.

Introduce a `group_members` SQLite table with `(group_id, user_id)` as the composite primary key. Add `src/groups.ts` with four synchronous CRUD operations (`addGroupMember`, `removeGroupMember`, `isGroupMember`, `listGroupMembers`) backed by Drizzle ORM.

Replace the simple `checkAuthorization` boolean in `bot.ts` with `checkAuthorizationExtended`, which returns an `AuthorizationResult` object containing `allowed`, `isBotAdmin`, `isGroupAdmin`, and `storageContextId`. The engine evaluates six branches in priority order: bot admin in DM, bot admin in group, group member in group, non-member in group (unauthorized), DM user via username resolution, unauthorized DM.

Add `src/commands/group.ts` with three subcommands (`adduser`, `deluser`, `users`) gated by `msg.user.isAdmin` for add/remove and open to any group member for listing.

In the `onMessage` handler in `bot.ts`, apply two guards after authorization: silently ignore unauthorized messages unless `isMentioned` (in which case reply with an auth error), and silently ignore natural language from authorized users in groups when `!isMentioned`.

Both `TelegramChatProvider` and `MattermostChatProvider` detect group context, fetch admin status asynchronously per message (with `try/catch` defaulting to `false`), and detect bot mentions via string matching and, for Telegram, the `entities` array.

## Rationale

Using `contextId` as a transparent pass-through to all storage modules (history, memory, config, cache) means no storage-layer changes are required. A group's shared history lives under `groupId`, and an individual's DM history lives under `userId`, with no special-casing inside the storage modules themselves.

The two-tier authorization (bot user check first, then group membership) ensures that bot admins always retain access regardless of group membership, while regular users are subject to per-group access control. This mirrors the principle of least privilege: access granted is the minimum required, group membership grants access only to that specific group's context.

Platform admin detection per message (rather than caching) is intentional: group admin status can change between messages, and a stale cache could allow or deny actions incorrectly. The cost is one async API call per message in group contexts; this is acceptable given typical group message rates.

The `extractUserId` function in `src/commands/group.ts` accepts both `@username` and raw IDs, giving flexibility across Telegram (numeric) and Mattermost (alphanumeric) user identifiers.

## Consequences

### Positive

- Teams can share a conversation context in Telegram groups and Mattermost channels, with history and config scoped to the group
- Group membership is independently manageable per group, giving operators fine-grained access control
- Bot admins bypass group membership checks, preserving administrative access
- The mention-guard eliminates noise from natural language messages in busy channels
- Unauthorized `@mention` receives a clear, actionable error message rather than silence
- All storage modules (history, memory, config) work unchanged, using `contextId` as the key

### Negative

- Each message in a group context requires an asynchronous admin status check (one additional API call to Telegram or Mattermost per message)
- Platform admin detection logic differs between providers: Telegram uses `getChatAdministrators`, Mattermost uses `/api/v4/channels/{channel_id}/members/{user_id}` and the `roles` field
- The `/group adduser` command uses usernames or IDs rather than platform-native mentions, which may be unfamiliar to users; the Mattermost username is taken from `user_name` in the WebSocket post event (optional field)
- Group membership stored as plain user IDs provides no display name; `/group users` lists IDs and adder IDs only, not human-readable names
- The command authorization model inside `registerCommand` in `TelegramChatProvider` grants every command caller `allowed: true` with no pre-check, deferring authorization to the handler; this means unauthorized users who type a slash command in a group will have the handler invoked (though the handler itself will enforce access)

## Implementation Status

**Status**: Implemented

Evidence and comparison against planned design:

### group_members table

**Planned** (`2026-03-20-group-chat-support.md`):

```sql
CREATE TABLE group_members (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  added_by TEXT NOT NULL,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, user_id)
);
```

**Actual** (`src/db/migrations/008_group_members.ts`, `src/db/schema.ts`):

```sql
CREATE TABLE group_members (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  added_by TEXT NOT NULL,
  added_at TEXT DEFAULT (datetime('now')) NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX idx_group_members_group ON group_members(group_id);
CREATE INDEX idx_group_members_user ON group_members(user_id);
```

**Divergence**: `added_at` changed from `DATETIME DEFAULT CURRENT_TIMESTAMP` (SQLite affinity-based) to `TEXT DEFAULT (datetime('now')) NOT NULL` to match the project's existing Drizzle ORM convention of storing timestamps as TEXT. Both indexes are present as planned.

**Migration naming**: The design plan (`2026-03-20-group-chat-implementation.md`) proposed a file named `2026_03_20_add_group_members.ts` with `up()`/`down()` functions. The actual file is `src/db/migrations/008_group_members.ts` using the project's standard `Migration` interface pattern with a sequential numeric prefix, which is consistent with migrations 001–007.

### IncomingMessage and related types (`src/chat/types.ts`)

**Planned**:

- `ContextType = 'dm' | 'group'`
- `ChatUser` gains `isAdmin: boolean`
- `IncomingMessage` gains `contextId`, `contextType`, `isMentioned`
- `AuthorizationResult` type with `allowed`, `isBotAdmin`, `isGroupAdmin`, `storageContextId`
- `CommandHandler` updated to `(msg, reply, auth) => Promise<void>`

**Actual**: All planned types are present exactly as specified. `CommandHandler` signature is `(msg: IncomingMessage, reply: ReplyFn, auth: AuthorizationResult) => Promise<void>`. No divergence.

### src/groups.ts

**Planned**:

```typescript
export function addGroupMember(groupId: string, userId: string, addedBy: string): void
export function removeGroupMember(groupId: string, userId: string): void
export function isGroupMember(groupId: string, userId: string): boolean
export function listGroupMembers(groupId: string): Array<{ user_id: string; added_at: string; added_by: string }>
export function isGroupAdmin(groupId: string, userId: string): Promise<boolean>
```

**Actual**: `addGroupMember`, `removeGroupMember`, `isGroupMember`, and `listGroupMembers` are all implemented. `listGroupMembers` returns `Array<{ user_id: string; added_by: string; added_at: string }>` ordered newest-first via `ORDER BY added_at DESC`.

**Divergence**: `isGroupAdmin` was not implemented in `src/groups.ts`. Platform admin detection was instead implemented inline in each `ChatProvider` adapter (`TelegramChatProvider.checkAdminStatus()`, `MattermostChatProvider.checkChannelAdmin()`), and the result is carried on `msg.user.isAdmin`. This is a deliberate architectural simplification: keeping platform-specific admin detection in the platform layer avoids passing platform clients into a shared module.

### Authorization engine (`src/bot.ts`)

**Planned**: A single `checkAuthorization` function returning `AuthorizationResult` with six branches.

**Actual**: `checkAuthorizationExtended` implements all six branches via decomposed helper functions (`getBotAdminAuth`, `getGroupMemberAuth`, `getUnauthorizedGroupAuth`, `getDmUserAuth`, `getUnauthorizedDmAuth`). The `onMessage` handler applies both the authorization gate and the mention-guard as planned. The original `checkAuthorization` (boolean return) is retained for command handlers registered via `registerSetCommand`, `registerConfigCommand`, and `registerClearCommand`, which predate the group support changes and still use the simpler check.

**Divergence**: The plan proposed a single unified authorization function. The actual implementation retains the old boolean `checkAuthorization` alongside the new `checkAuthorizationExtended`, meaning commands use a different auth path than message processing. Commands registered via `registerCommand` in `TelegramChatProvider` also build their own `AuthorizationResult` stub (`allowed: true, isBotAdmin: isAdmin, isGroupAdmin: isAdmin`) rather than calling `checkAuthorizationExtended`.

### Group command (`src/commands/group.ts`)

**Planned**: `registerGroupCommands(chat)` with subcommands `adduser`, `deluser`, `users`; gated by `auth.isGroupAdmin` parameter.

**Actual**: `registerGroupCommand(chat)` (singular, no `s`) with identical subcommands. Admin gating uses `msg.user.isAdmin` directly rather than `auth.isGroupAdmin`, which is equivalent since `isGroupAdmin` is derived from `msg.user.isAdmin` in `checkAuthorizationExtended`. The function name diverges slightly (`registerGroupCommand` vs `registerGroupCommands`).

### Telegram group detection (`src/chat/telegram/index.ts`)

**Planned**: Detect `chat.type` (`'group'`, `'supergroup'`, `'channel'`); store `botUsername` via `getMe()` on start; detect mentions via entities and text; check admin via `getChatAdministrators` with `try/catch`.

**Actual**: All planned behaviors are implemented. `extractMessage` sets `contextType` to `'group'` for `'group'`, `'supergroup'`, and `'channel'` chat types. `isBotMentioned` checks both `text.includes('@botUsername')` and iterates `entities` for `type === 'mention'`. `checkAdminStatus` calls `getChatAdministrators`, returns `false` on any exception. `botUsername` is populated in the `onStart` callback via `getMe()`.

**Additional behavior**: DM users (`'private'` chat type) are always treated as admin (`checkAdminStatus` returns `true` for private chats), which is correct since there is no admin/non-admin distinction in DMs. No divergence from the design intent.

### Mattermost channel detection (`src/chat/mattermost/index.ts`)

**Planned**: Fetch channel type via `/api/v4/channels/{channel_id}`; treat `'D'` as DM, everything else as group; detect admin via `/api/v4/channels/{channel_id}/members/{user_id}` checking `roles` for `'channel_admin'`; detect mentions via `@botUsername` in message text.

**Actual**: Implemented exactly as planned. `fetchChannelInfo` calls the channel API and checks `type !== 'D'` for group detection. `checkChannelAdmin` calls the member API with `try/catch` returning `false` on failure and checks `roles.includes('channel_admin')`. `isBotMentioned` does a simple `message.includes('@botUsername')` string check.

**Divergence**: The plan mentioned `'G'` (group DM), `'O'` (public), `'P'` (private) as group types. The actual implementation treats any non-`'D'` channel as a group, which covers all intended types and is simpler. System-level Mattermost admin status is not checked (only channel-level `channel_admin` role); this was noted in the plan as a secondary path but not implemented.

### Storage layer (`contextId` propagation)

**Planned**: All storage functions accept `contextId` instead of `userId`.

**Actual**: `processMessage` in `llm-orchestrator.ts` is called with `auth.storageContextId`, which equals `userId` in DMs and `groupId` in groups. All downstream storage operations (history, memory, config, cache) use this value as the key. No storage-layer code was changed; the abstraction is transparent.

### Testing

**Planned**: Unit tests for authorization logic, group membership CRUD, mention detection; E2E tests for cross-member continuity.

**Actual**: Unit tests exist for `src/groups.ts` (`tests/groups.test.ts`) and authorization branches (`tests/bot-auth.test.ts`) as planned. No new E2E tests specifically for group chat were added in this implementation.

## Related Decisions

- **ADR-0014** (Multi-Chat Provider Abstraction) — The `ChatProvider` interface introduced in ADR-0014 is the foundation on which group context detection is built. The `IncomingMessage` type, `CommandHandler` signature, and `ReplyFn` types extended here were all originally defined there.
