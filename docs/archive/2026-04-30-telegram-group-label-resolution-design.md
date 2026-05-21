<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Telegram Group Label Resolution For `/groups` And `/group users`

**Date:** 2026-04-30  
**Scope:** Improve Telegram-specific display resolution for group IDs and user IDs in `/groups` and `/group users`  
**Primary Goal:** Show human-readable Telegram group and user labels more often, while degrading safely to cached labels and then raw IDs  
**Non-Goal:** Add general Telegram `@username -> user ID` resolution or introduce MTProto / full Telegram API clients

---

## Context

The current `/groups` and `/group users` flows try to resolve readable labels through the chat provider and then fall back to raw IDs when lookup fails.

For Telegram, this creates a poor experience because Telegram Bot API label lookup is intentionally limited:

- Group titles can be fetched with `getChat(chat_id)`.
- User display data can be fetched with `getChatMember(chat_id, user_id)`.
- `getChatMember` is only guaranteed to work for other users if the bot is an administrator in the chat.
- Bot API does not provide a general public `@username -> user ID` resolver for arbitrary users.
- Plain `@username` mentions are text entities, not authoritative peer lookups.
- `text_mention` entities include a user object, but that only helps when such an entity is already present in an incoming update.

This means Telegram display resolution should be treated as a provider-specific problem, not as a generic “look up any user by ID or username” capability.

The repo already stores some useful locally observed context:

- known group display names via group context observation
- observed user/admin metadata tied to groups

However, `/groups` does not currently reuse that stored context as a display fallback, and the Telegram label path does not explicitly document or model Bot API limitations.

---

## Research Summary

### Official Telegram Bot API

Relevant official Bot API surfaces:

- `getChat(chat_id)` returns chat metadata and can provide:
  - `title` for groups, supergroups, and channels
  - `username` for private chats, supergroups, and channels if available
  - `first_name` / `last_name` for private chats
- `getChatMember(chat_id, user_id)` returns member information for a specific chat member
- `getChatAdministrators(chat_id)` returns administrator membership data
- `MessageEntity` distinguishes:
  - `mention` for plain `@username`
  - `text_mention` for an embedded user object

Important Telegram constraint from the official docs:

> `getChatMember` is only guaranteed to work for other users if the bot is an administrator in the chat.

### Official full Telegram API / MTProto

The full Telegram API supports more powerful operations such as `contacts.resolveUsername`, but these are outside the Bot API and often depend on previously cached peer information and `access_hash` values. This design does not adopt MTProto.

### Practical implication

For this project, the safe Telegram display-resolution strategy is:

1. use Bot API live lookups where officially supported
2. reuse locally observed labels when live lookup is unavailable
3. degrade to raw IDs only when neither source can help

---

## Decision

Add a **Telegram-specific display resolution layer** used by `/groups` and `/group users`.

This layer will centralize Telegram rules for:

- group ID -> readable group label
- user ID -> readable user label
- fallback ordering
- logging of Telegram-specific failure causes

It will not attempt to resolve arbitrary `@username -> user ID` mappings. That direction is explicitly out of scope for this work.

---

## Architecture

### Boundary

**Commands remain responsible for:**

- parsing command input
- authorization checks
- formatting final reply text

**Telegram resolution layer becomes responsible for:**

- resolving group labels for Telegram groups
- resolving user labels for Telegram users
- applying fallback order
- shielding command code from Telegram-specific API quirks

### Components

Likely affected or added components:

- `src/commands/group.ts`
  - continue to own `/groups` and `/group users` formatting
  - delegate Telegram display resolution instead of handling fallback implicitly
- `src/chat/telegram/label-helpers.ts`
  - remain the home for direct Bot API live lookup helpers
- new Telegram display-resolution helper/service
  - encapsulate Telegram-specific fallback ordering
  - mediate between live lookup and cached local observations
- `src/group-settings/registry.ts`
  - reuse existing observed group/admin metadata where possible
- optionally, small new Telegram-oriented observation helpers or storage additions
  - only if existing persistence is insufficient for reliable cached display labels

### Why this boundary

This keeps command logic focused and makes Telegram rules explicit in one place. It also creates a clean pattern for future provider-specific work if equivalent research is later done for Mattermost and Discord.

---

## Resolution Behavior

### `/groups`

For each authorized Telegram group, resolve the display line in this order:

1. **Live group lookup**
   - call `getChat(group_id)`
   - if Telegram returns a non-empty `title`, use it
2. **Cached local observation**
   - use the most recent locally observed group display name if available
3. **Fallback**
   - show the raw group ID

For the `added by` portion of each `/groups` line, resolve the user label in this order:

1. **Live member lookup**
   - call `getChatMember(group_id, user_id)`
   - if Telegram returns member user data, format a readable label from first name, last name, and username
2. **Cached local observation**
   - use the most recent locally observed user label for that Telegram user ID in relevant context
3. **Fallback**
   - show the raw user ID

### `/group users`

For each stored group member and `added_by` user, resolve labels in the same order:

1. live Telegram lookup via `getChatMember(group_id, user_id)`
2. cached local observation
3. raw user ID

### Formatting

The resolution layer should return either:

- a resolved label string, or
- `null` when no readable label is available

Commands should continue to own final reply formatting and use raw IDs only when the resolution layer returns `null`.

---

## Telegram-Specific Live Lookup Rules

### Group labels

Use `getChat(group_id)` as the official live Telegram path.

### User labels

Use `getChatMember(group_id, user_id)` as the official live Telegram path.

This path is intentionally group-scoped. It is acceptable for lookups to fail when:

- the bot is not an admin in the group
- the user is no longer a member of the group
- the bot no longer has access to the group
- the group ID is stale or invalid
- Telegram returns incomplete or unavailable data

### Explicitly rejected direction for this design

This design does **not** rely on arbitrary user lookup such as:

- public `@username -> user ID`
- general global user search
- MTProto-only peer resolution features

Those capabilities are outside the Telegram Bot API model used by this project.

---

## Data Model And Persistence Strategy

### Preferred strategy

Reuse existing observation data first, then add Telegram-specific persistence only if current tables cannot support the desired fallback behavior.

### Existing useful data

The repo already stores:

- known group contexts with display names
- group admin observations with usernames and admin state

These existing observations should be evaluated as the first fallback source for Telegram label reuse.

### Likely gap

Current observed data may not be sufficient for all `/group users` display fallback cases because the target user whose label needs to be shown is not always an admin and may not be represented in admin-only observation tables.

### Recommended persistence shape

If storage expansion is needed, keep it additive and focused on **observed display facts**, not on broad Telegram identity modeling.

#### Group observations

For Telegram groups, the system should be able to persist:

- `group_id`
- most recently observed display title
- provider / platform scope
- last observed timestamp

This may already be covered by known-group-context storage.

#### User observations

If existing data is insufficient, add storage for Telegram user display observations containing:

- `user_id`
- latest observed `username` (nullable)
- latest observed `first_name`
- latest observed `last_name`
- optionally a preformatted display label cache
- source group/context where observed
- last observed timestamp

### Design principle

Observed Telegram labels are:

- best-effort
- mutable
- non-authoritative
- good enough for display fallback

The persistence layer is therefore meant to improve UX in listing commands, not to guarantee canonical identity resolution.

---

## Data Flow

### `/groups`

1. load authorized groups from storage
2. for each Telegram group:
   - resolve group label through the Telegram display-resolution layer
   - resolve `added_by` user label through the Telegram display-resolution layer
3. format final reply text in the command handler
4. degrade to cached label or raw ID when live Telegram lookup fails

### `/group users`

1. load stored group members from storage
2. for each member:
   - resolve member label through the Telegram display-resolution layer
   - resolve `added_by` label through the Telegram display-resolution layer
3. format final reply text in the command handler
4. degrade to cached label or raw ID when live Telegram lookup fails

### Observation updates

Whenever Telegram messages are already being processed and contain user/group metadata, the existing observation path should continue to update stored display facts. If needed, it should be extended so that non-admin user observations can also support later display fallback.

---

## Error Handling

The design separates **internal cause tracking** from **user-facing behavior**.

### Internal failure categories

The resolution layer should log enough context to distinguish:

- Telegram Bot API limitation
- bot lacks required group access or admin visibility
- target group is stale or inaccessible
- target user is absent from the group
- cached observation missing
- transport/API error
- malformed or incomplete Telegram payload

### User-facing behavior

For `/groups` and `/group users`, lookup failures should not produce noisy error messages. The command should simply degrade to:

1. cached observed label, if available
2. otherwise raw ID

This preserves current command semantics while improving readability whenever possible.

---

## Testing

### Command behavior tests

Add or expand tests that verify:

- `/groups` prefers live Telegram labels when available
- `/groups` falls back to cached observed group and user labels when live lookup fails
- `/groups` falls back to raw IDs when neither live nor cached labels exist
- `/group users` follows the same fallback ordering

### Resolution-layer tests

Add focused tests for:

- group title resolution through `getChat`
- user label resolution through `getChatMember`
- formatting of Telegram user labels from returned member data
- proper `null` return when Telegram cannot resolve a label
- cached fallback selection behavior

### Persistence tests

If storage changes are added, test:

- upsert behavior for observed Telegram labels
- latest observation wins
- provider-scoped storage isolation
- use of stored labels in fallback paths

### Regression test goal

The key regression to prevent is:

> a readable Telegram label was already known locally, but `/groups` or `/group users` still displayed only the raw ID because live lookup failed

---

## Non-Goals

This design does **not** attempt to:

- add MTProto / TDLib / full Telegram API clients
- implement arbitrary `@username -> user ID` resolution
- redesign `/group adduser @username` or `/group deluser @username`
- guarantee readable labels for users or groups the bot has never observed and cannot currently inspect
- perform equivalent redesigns for Mattermost or Discord in the same change

---

## Follow-Up Work

Equivalent provider-specific research should be done later for:

- Mattermost
- Discord

Those follow-ups should not assume Telegram-like semantics. Each provider should get its own documented resolution rules before similar changes are implemented.
