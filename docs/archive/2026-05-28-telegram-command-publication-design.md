<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Telegram Command Publication Alignment — Design

**Date:** 2026-05-28
**Status:** Approved design, pending implementation plan
**Author:** brainstorming session

## Problem

Telegram is the only provider in papai that publishes a native command menu through
`setMyCommands()`, but the published lists in `src/chat/telegram/commands.ts` have drifted
from the actual command surface registered in `src/bot.ts`.

Today this creates three concrete problems:

- some working commands do not appear in Telegram autocomplete or the bot menu
- group menus are not explicitly modeled, so group command discoverability is inconsistent
- command metadata now lives in more than one place, so future command additions can drift
  again unless someone remembers to update the Telegram-specific arrays manually

There is a second Telegram-specific UX gap around group configuration. The DM `/config`
and `/setup` selector currently depends on observed group context data. A newly authorized
group may not be immediately available in the DM selector until the bot first sees traffic
from that group. That forces an unnecessary round-trip into the group before the admin can
finish configuration.

## Goals

- Make Telegram command publication a derived view of a canonical papai command manifest.
- Add tests that fail when the registered command surface and Telegram publication metadata
  drift apart.
- Publish Telegram commands in both DMs and groups using explicit Telegram command scopes.
- Publish only group-safe commands in Telegram group menus.
- Preserve existing handler-level auth and DM-only behavior; this design changes publication
  and group-target discovery, not command semantics.
- Make a newly authorized group configurable from DM immediately after `/group add`, without
  requiring a prior in-group message.

## Non-Goals

- No redesign of command handler authorization rules.
- No change to Discord command behavior.
- No provider-wide abstraction that forces Mattermost or Discord to consume Telegram-specific
  publication rules.
- No attempt to make Telegram publish per-user custom menus beyond the existing admin-vs-user
  split and explicit group-safe filtering.

## Existing Architecture

- `src/bot.ts` registers the command handlers through `registerHelpCommand`,
  `registerStartCommand`, `registerSetupCommand`, `registerConfigCommand`,
  `registerContextCommand`, `registerClearCommand`, `registerAdminCommands`,
  `registerGroupCommand`, and `registerPluginCommand`.
- `src/chat/telegram/commands.ts` currently hand-maintains `userCommands` and
  `adminCommands`, then publishes them with Telegram Bot API scopes.
- `src/chat/startup.ts` calls `chat.setCommands()` only for providers with the
  `commands.menu` capability.
- DM group targeting for `/config` and `/setup` is backed by `group-settings/*` and today is
  effectively limited by `known_group_contexts` plus observed admin state.
- Authorized groups are stored separately in `authorized_groups` through
  `src/authorized-groups.ts` and are added in `src/commands/group.ts`.

## Design

### 1. Canonical command manifest

Introduce a small command manifest module near the provider-agnostic command layer. The
manifest is the single source of truth for user-visible command metadata, while the existing
command handlers remain the source of runtime behavior.

Each manifest entry must define:

- command name
- human description
- registration source marker or assertion target for tests
- Telegram publication flags for:
  - DM user visibility
  - DM admin visibility
  - group user visibility
  - group admin visibility

The intent is not to move handler logic into metadata. The intent is to eliminate the
current duplicated hand-maintained Telegram arrays and replace them with a single command
catalog that Telegram publication can render from and tests can validate against.

### 2. Telegram scope generation from the manifest

`src/chat/telegram/commands.ts` should stop declaring static arrays and instead build the
Telegram Bot API payloads from the canonical manifest.

The generated publication model is:

- all private chats: commands visible to every regular DM user
- admin DM chat: additional admin-only DM commands for the admin chat ID
- all group chats: only group-safe commands
- all chat administrators: additional group-admin-safe commands, if any are distinct from
  general group-safe commands

This design explicitly chooses group-safe publication only. Commands that are logically
DM-driven, such as settings flows, are not published in group menus even if their handlers
have some group-side behavior today.

If Telegram scope publication fails for any scope, the registration call should fail loudly
with scope-specific logging. Silent partial publication is not acceptable because it creates
hard-to-diagnose UX drift.

### 3. Group-safe publication rules

The Telegram spec distinguishes between three kinds of command behavior:

- commands safe and useful in groups
- commands safe only for group admins
- commands that are fundamentally DM-driven and should not be advertised in group menus

The key clarification from the brainstorming session is that `/config` and `/setup` should
remain DM-driven for settings targeting even though invoking them in groups currently helps
populate group discovery. Their current side-effect should not determine menu publication.

Instead, the group menu should advertise only commands that are genuinely meaningful in the
group itself. This keeps group menus honest and avoids teaching users to enter a settings
flow in the wrong place.

For the current command surface, the starting interpretation in the implementation plan
should be:

- publish in Telegram group menus: `/help`, `/context`, `/clear`, `/group`
- do not publish in Telegram group menus: `/start`, `/setup`, `/config`, `/plugin`, `/user`,
  `/users`, `/announce`, `/groups`

If implementation discovers that one of the included commands is not actually group-safe in
practice, the implementation plan should reduce the set rather than broaden it.

### 4. Immediate DM configurability for newly authorized groups

The current observation-based path is insufficient for the desired Telegram admin workflow.
After a bot admin authorizes a group in DM with `/group add`, that group should become
available in the DM `/config` and `/setup` selector immediately, without requiring the bot
to first observe the group.

This design therefore extends manageable-group discovery so it is not solely dependent on
`known_group_contexts` observations. The selector must be able to surface newly authorized
groups as soon as authorization exists.

The design direction is:

- preserve observed group metadata as the preferred rich source when available
- add an authorization-backed fallback path for newly authorized groups that have not yet
  been observed
- permit DM selection of those groups immediately after `/group add`

Because an unobserved group may not yet have a friendly display name, the selector may need
to temporarily fall back to the native/scoped group ID until richer metadata is learned.
That is acceptable. Immediate configurability is more important than waiting for a display
name.

### 5. Testing strategy

Add unit tests that make future command drift hard to introduce.

Required coverage:

- every command registered through the bot command setup path must be represented in the
  canonical manifest or explicitly marked as intentionally unpublished for Telegram
- Telegram-rendered DM/admin/group command lists must match the expected filtering rules
- group menus must not include DM-driven commands
- manifest descriptions and generated Telegram payloads should be asserted in a stable way so
  command additions require an intentional test update
- newly authorized groups must be eligible for DM selection immediately, even if they have no
  prior observation record

The tests are meant to defend the design contract, not snapshot every internal detail.

## Error Handling

- If `ADMIN_USER_ID` cannot be parsed into the Telegram scope shape required for the admin
  chat-specific command list, command publication should fail with a clear error message.
- If Telegram rejects a particular scope publication request, logs must identify the exact
  scope that failed.
- If a newly authorized but unobserved group appears in the DM selector without a known
  display name, the UI may show the raw group identifier rather than blocking configuration.

## Consequences

### Positive

- Telegram autocomplete becomes an accurate view of the actual papai command surface.
- Future command additions must update one manifest instead of multiple disconnected lists.
- Group menus become deliberate and less confusing.
- Bot admins can configure a newly authorized group from DM immediately after authorization.

### Negative

- Telegram command metadata becomes more structured, which adds a small maintenance surface.
- Some commands that technically do something when run from a group will stop being published
  there if they are classified as DM-driven.
- The selector logic becomes slightly more complex because it must merge observed and
  authorization-backed groups.

## Implementation Shape

Expected code touch points:

- new shared command manifest module near `src/commands/`
- `src/chat/telegram/commands.ts` for manifest-driven Telegram scope rendering
- Telegram-focused unit tests for command publication and manifest alignment
- group-target discovery modules under `src/group-settings/` so newly authorized groups can
  appear in DM selection immediately
- possibly `src/commands/group.ts` or adjacent helpers if authorization-time metadata needs
  to be recorded at the point of `/group add`

## Open Design Decision Resolved In This Spec

During brainstorming, the user confirmed:

- Telegram should publish commands in both DMs and groups.
- Group menus should publish only group-safe commands.
- `/config` and `/setup` remain DM-driven and should not rely on group-side invocation to
  make a newly authorized group configurable.

This document treats those decisions as fixed input for the implementation plan.
