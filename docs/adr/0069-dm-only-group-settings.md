<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0069: DM-Only Group Settings

## Status

Accepted

## Date

2026-04-11

## Context

Group-scoped `/config` and `/setup` currently operate directly on `auth.storageContextId`, which works for personal DMs but creates problems in groups:

1. **Thread-scoped config drift**: Thread-aware group chat (ADR-0059) uses `groupId:threadId` as the storage context ID for conversation history. Since `/config` and `/setup` write to `auth.storageContextId`, running them inside a thread writes config to a thread-scoped key instead of the shared group key. Configuration intended for the whole group silently ends up scoped to one thread.

2. **Security surface**: Any group member can currently open `/config` or `/setup` in-group and change group-scoped settings (LLM model, API key, timezone). There is no admin-only gate for group configuration changes.

3. **UX noise**: Running an interactive config editor or setup wizard inside a busy group channel clutters the conversation and exposes configuration details (API keys, model choices) to all members.

## Decision Drivers

- Group config must always write to the root `groupId`, never to `groupId:threadId`
- Only group admins should be able to manage group settings
- `/config` and `/setup` in groups should redirect to DM rather than opening UI in-chat
- DM users must explicitly choose between personal settings and a target group before editing
- Existing config editor and setup wizard must be reused without duplication
- Threads must share the parent group's config (no thread-scoped settings)

## Considered Options

### Option 1: In-group admin-only config with thread fix

- **Pros**: Minimal UX change, no new DM flow
- **Cons**: Still exposes config in group chat, does not solve UX noise problem, admin check requires live provider API call every time

### Option 2: Separate group config commands (`/groupconfig`, `/groupsetup`)

- **Pros**: Clear command separation
- **Cons**: Command proliferation, users must learn new commands, does not solve in-group exposure

### Option 3: DM-only group settings with explicit target selection (chosen)

- **Pros**: Config never exposed in groups, reuses existing editor/wizard, explicit target selection prevents wrong-context writes, admin gating via observed registry
- **Cons**: Extra step in DM (scope picker), requires persistent group registry, admin observations may be stale

### Option 4: Auto-DM from group command with deep link

- **Pros**: Seamless redirect
- **Cons**: Proactive DM requires provider-specific API calls, deep links not universally supported, v1 scope too large

## Decision

Group-scoped `/config` and `/setup` are now configurable only through DM. In groups, both commands reply with a DM-only redirect message (different copy for admins vs non-admins).

### Group registry

Persist a known-group and admin-observation registry in SQLite:

- `known_group_contexts` — root group/channel ID, provider, display name, parent workspace name, timestamps
- `group_admin_observations` — composite key `(contextId, userId)`, admin status, last observation timestamp

Both tables are populated opportunistically during normal group message traffic, before any command or interception logic runs.

### DM target selection flow

When `/config` or `/setup` runs in DM:

1. Show a scope picker (personal / group / cancel)
2. If group is selected, list known groups where the user is an observed admin
3. User selects a group via button or freeform name/ID matching
4. Existing config editor or setup wizard opens against the selected `groupId`

The selector uses an in-memory session store keyed by DM user ID with a 30-minute TTL, matching existing editor/wizard session behavior.

### Adapter metadata enrichment

Add `contextName` and `contextParentName` optional fields to `IncomingMessage` so adapters can pass human-readable group labels through:

- **Telegram**: `contextName = chat.title`
- **Mattermost**: `contextName = channel display_name`, `contextParentName = team display_name`
- **Discord**: `contextName = channel.name`, `contextParentName = guild.name`

### Bot interception order

The selector introduces a new interception layer:

1. Group-settings selector (new — consumes non-command DM text during active selection)
2. Config editor interception
3. Wizard interception
4. Normal message handling

### Access control

Do not reuse `auth.isBotAdmin` (which means "globally authorized bot user"). Add a dedicated `canManageGroupSettings(userId, groupId)` check based on observed admin status in the registry.

## Rationale

The DM-only approach solves three problems at once: thread-scoped config drift, missing admin gating, and in-group config exposure. The observed registry trades exactness (admin observations may be stale) for simplicity (no live provider API calls required), which is acceptable for v1.

Reusing the existing config editor and setup wizard by passing an explicit target context ID avoids duplicating UI code. The scope picker adds one extra step in DM but makes the personal-vs-group distinction clear.

The `gsel:` callback prefix separates selector routing from existing `cfg:` and `wizard_` prefixes, keeping the interaction router clean.

## Consequences

### Positive

- Group config always writes to root `groupId`, never to thread-scoped keys
- Only observed group admins can manage group settings
- Configuration details (API keys, model choices) are never exposed in group chats
- Existing editor and wizard are fully reused
- Thread conversations keep isolated history but share parent group config
- Group display names update opportunistically from traffic

### Negative

- Extra DM step (scope picker) before editing config or running setup
- Admin observations may be stale if a user loses admin rights after the bot last saw them
- New DM user with no group history cannot configure groups until the bot observes them as admin in the target group
- Two new SQLite tables and a migration
- In-memory selector sessions lost on crash (acceptable — user restarts the command)

### Risks

- **Stale admin observations**: A user demoted from admin after the bot last saw them retains config access until the bot next observes them. Mitigation: observations update on every group message.
- **No manageable groups edge case**: New DM users see guidance to use the bot in the target group first. This is an intentional v1 limitation.
- **Freeform matching ambiguity**: Group names like "Operations" and "Operations Europe" produce ambiguous matches. Mitigation: disambiguation prompt lists exact candidates with context IDs.

## Implementation Notes

New module: `src/group-settings/` with `types.ts`, `registry.ts`, `access.ts`, `state.ts`, `selector.ts`.

Modified modules: `src/bot.ts` (observation recording + selector interception), `src/commands/config.ts` (DM selector + group redirect), `src/commands/setup.ts` (DM selector + group redirect), `src/chat/types.ts` (metadata fields), adapter files (metadata population), `src/chat/interaction-router.ts` (`gsel:` routing), `src/chat/discord/index.ts` (Discord callback handling), `src/commands/help.ts` (DM and group help copy).

## Related Decisions

- **ADR-0059** (Thread-Aware Group Chat) — defined `groupId:threadId` storage keys that this decision protects config from drifting into
- **ADR-0018** (Group Chat Support) — established group-scoped `contextId` and settings
- **ADR-0014** (Multi-Chat Provider Abstraction) — `ChatProvider` and `ReplyFn` patterns used by the selector
- **ADR-0058** (Provider Capability Architecture) — capability-driven model that `interactiveButtons` support follows

## References

- Design: `docs/superpowers/specs/2026-04-10-group-dm-settings-design.md`
- Plan: `docs/superpowers/plans/2026-04-11-dm-only-group-settings.md`
