<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# DM-Only Group Settings Design

**Date:** 2026-04-10  
**Status:** Approved  
**Scope:** Group-scoped `/config` and `/setup` must be managed only through DM

## Problem Statement

Group-scoped configuration currently hangs off the active command context:

- `/config` reads from `auth.storageContextId`
- `/setup` creates a wizard for `auth.storageContextId`

That works for personal DMs, but in groups it means settings are configured directly in-chat. In threaded contexts it is worse: `auth.storageContextId` becomes `groupId:threadId`, so `/config` and `/setup` can drift into thread-scoped settings behavior even though config should be shared by the whole group.

We want group chat settings to be configurable **only through DM with the bot**, while preserving:

1. personal user config in DM
2. shared group config
3. thread-scoped conversation history

## Goals

1. Make group `/config` and `/setup` redirect to DM instead of editing in-chat
2. Let a DM user choose a target group explicitly before editing group settings
3. Allow only **group admins** to manage group settings
4. Reuse the existing config editor and setup wizard instead of building new editors
5. Keep threads/topics sharing the parent group's config

## Non-Goals

- Changing `/group adduser`, `/group deluser`, or `/group users`
- Changing `/clear` or custom instructions
- Changing history scoping or thread memory behavior
- Auto-DMing the user from a group command
- Enumerating all possible groups from provider APIs in v1

## Design

### 1. Separate conversation scope from settings scope

The current implementation conflates "where this conversation lives" with "where settings should be stored." This feature requires those concepts to diverge.

| Location           | Conversation storage key | Settings target key |
| ------------------ | ------------------------ | ------------------- |
| DM personal        | `userId`                 | `userId`            |
| Group main chat    | `groupId`                | `groupId`           |
| Group thread/topic | `groupId:threadId`       | `groupId`           |

**Decision:** thread/topic contexts keep their own conversation history, but they always share the parent group's config.

Implementation-wise, `/config` and `/setup` should stop assuming `auth.storageContextId` is the write target. They should instead operate on an explicit **settings target context ID**.

### 2. Add a persistent known-group registry

The bot needs a DM-time way to offer selectable group targets. For the approved approach, that target list comes from a registry the bot builds as it observes real group traffic.

Add persistent storage for:

#### `known_group_contexts`

Tracks root group/channel contexts that the bot has seen.

Suggested fields:

- `context_id` — root group/channel ID (primary key)
- `provider` — chat provider name
- `display_name` — human-readable group/channel name
- `parent_name` — optional team/guild/workspace label
- `first_seen_at`
- `last_seen_at`

#### `group_admin_observations`

Tracks whether a user was observed as an admin in a specific group.

Suggested fields:

- `context_id`
- `user_id`
- `username` — optional snapshot for debugging/display
- `is_admin`
- `last_seen_at`

Primary key: `(context_id, user_id)`

### 3. Capture group metadata from adapters

To support DM selection by group name, adapters must expose human-friendly group labels when building incoming messages.

Add optional fields to chat message metadata:

```typescript
type IncomingMessage = {
  // ...existing fields...
  contextName?: string
  contextParentName?: string
}
```

Provider expectations:

- **Telegram**: `contextName = chat.title`
- **Mattermost**: `contextName = channel display name`, `contextParentName = team name` when available
- **Discord**: `contextName = channel name`, `contextParentName = guild name` when available

The same metadata can optionally be added to `IncomingInteraction`, but message traffic is sufficient for v1 registry updates.

### 4. Record registry data during normal group traffic

Whenever the bot receives a group message:

1. Upsert `known_group_contexts` using `msg.contextId`
2. Upsert `group_admin_observations` using:
   - `msg.contextId`
   - `msg.user.id`
   - `msg.user.username`
   - `msg.user.isAdmin`

This happens at the **root group scope** automatically because `msg.contextId` is already the group/channel ID even when `auth.storageContextId` is thread-scoped.

Result:

- thread messages update the parent group's registry entry
- threads/topics never become separate selectable config targets

### 5. Introduce DM group-target selection flow

Add a small stateful selector in front of `/config` and `/setup` when they run in DMs.

Suggested new module:

```text
src/group-settings/
├── access.ts        # canManageGroupSettings(), listManageableGroups()
├── registry.ts      # known group + admin observation persistence
├── selector.ts      # selector flow orchestration
├── state.ts         # active DM selection sessions
└── types.ts
```

#### DM `/config`

1. User sends `/config` in DM
2. Bot shows:
   - **Personal settings**
   - **Group settings**
3. If user picks personal settings:
   - existing behavior using `userId`
4. If user picks group settings:
   - list known groups where the user is a known admin
   - allow freeform ID/name matching against that same known-group registry
5. After target selection:
   - render the existing config view/editor against the selected `groupId`

#### DM `/setup`

Same target-selection step, then launch the existing wizard against the selected `groupId`.

#### Interaction and text fallback

- If the provider supports buttons/callbacks, the selector uses buttons
- Otherwise it falls back to text prompts and freeform matching

Session state should be keyed by DM user ID and expire automatically after 30 minutes to match wizard/editor behavior.

### 6. Redirect group `/config` and `/setup`

In group chats, `/config` and `/setup` no longer open any UI in place.

Expected behavior:

- If caller is a group admin:
  - reply with a short DM-only redirect message
- If caller is not a group admin:
  - reply that only group admins can configure group settings, and that configuration happens in DM

No attempt is made to proactively DM the user in v1.

### 7. Add a dedicated group-settings access check

Do **not** rely on `auth.isBotAdmin` for this feature.

Current naming is misleading:

- `auth.isBotAdmin` is effectively "globally authorized bot user" in several flows
- group settings need a stricter rule: **admin of this specific group**

Add a dedicated service:

```typescript
canManageGroupSettings(userId: string, groupId: string): boolean
```

Rules:

- true only when the latest stored observation for `(groupId, userId)` is admin=true
- false otherwise

Use this service for:

- filtering selectable groups in DM
- validating freeform group matches before opening config/setup

Use `auth.isGroupAdmin` only for the **current group command invocation** that emits the redirect message.

### 8. Reuse existing editor and wizard with target override

The existing editor/wizard logic is already keyed by a context ID. That can be reused directly if commands pass the correct target.

Refactor command-level entrypoints so they accept an explicit target context:

- `/config` -> render config for `settingsTargetContextId`
- `/setup` -> create wizard for `settingsTargetContextId`

This keeps existing storage and validation logic intact:

- `getAllConfig(targetContextId)`
- `setConfig(targetContextId, key, value)`
- `createWizard(userId, targetContextId, taskProvider)`

### 9. Bot interception order

The DM selector introduces a new temporary state that may consume non-command text replies.

`src/bot.ts` interception flow should become:

1. group-settings selector interception
2. config editor interception
3. wizard interception
4. normal message handling

Likewise, button routing should grow a dedicated callback prefix for group-target selection before handing off to the existing config-editor and wizard callbacks.

### 10. Help text changes

Update help copy so group chats no longer imply in-group config/setup.

#### DM help

- keep `/setup`
- keep `/config`
- document that both can be used for personal config, and group config is selected from DM

#### Group help

- remove `/setup` and `/config` from group admin "do it here" language for this feature
- replace with a note such as:
  - "Group settings are configured in DM with the bot"

## Files to Modify

| File                             | Changes                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| `src/chat/types.ts`              | Add optional group display metadata; optionally add selector callback typing if needed |
| `src/chat/telegram/index.ts`     | Populate group display metadata                                                        |
| `src/chat/mattermost/index.ts`   | Populate channel/team metadata                                                         |
| `src/chat/discord/*`             | Populate channel/guild metadata                                                        |
| `src/bot.ts`                     | Record group registry/admin observations; add selector interception                    |
| `src/commands/config.ts`         | Redirect in groups; support DM target selection; pass explicit settings target         |
| `src/commands/setup.ts`          | Redirect in groups; support DM target selection; pass explicit settings target         |
| `src/commands/help.ts`           | Update group help copy                                                                 |
| `src/chat/interaction-router.ts` | Route selector callbacks                                                               |
| `src/group-settings/*`           | New registry/access/selector/state modules                                             |
| `src/db/schema.ts`               | Add known-group/admin-observation tables                                               |
| `src/db/migrations/*`            | Add migrations for new tables                                                          |
| `tests/**`                       | Add command, bot, adapter, and selector coverage                                       |

## Edge Cases

### 1. No known manageable groups

If a user opens group settings in DM but the registry contains no groups where they are a known admin, reply with guidance:

- use the bot in the target group first
- then retry in DM

This is an intentional limitation of the local-registry approach.

### 2. Stale admin observations

If a user loses admin rights after the bot last saw them as admin, the registry may temporarily be stale.

Accepted v1 behavior:

- access is based on observed state, not live provider verification

Possible future hardening:

- add optional provider-specific live verification for known group IDs

### 3. Renamed groups

Group display labels update opportunistically whenever the bot sees new traffic in that group.

### 4. Threads/topics

Threads/topics never appear in the DM picker. They keep their own history only.

## Testing

Add coverage for:

1. group `/config` returns DM-only redirect
2. group `/setup` returns DM-only redirect
3. non-admin group users cannot initiate group settings
4. DM `/config` personal path remains unchanged
5. DM `/setup` personal path remains unchanged
6. DM group path lists only groups where the user is a known admin
7. freeform group name/ID matching resolves only against the known-group registry
8. selected group config writes to `groupId`, not `userId`
9. thread-originated messages update the parent group registry entry, not a thread target
10. help text no longer implies in-group configuration

## Follow-Up Work

Possible future improvements, explicitly out of scope for this design:

- provider-native live admin verification for known groups
- richer group picker search/ranking
- proactive "open DM" deep links on providers that support them
- extending the same DM-only targeting model to `/clear` or custom instructions
