<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0162: Telegram Command Publication Alignment

## Status

Implemented

## Date

2026-05-28 – 2026-06-02

## Context

Telegram is the only papai chat provider that publishes a native command menu
through the Bot API `setMyCommands()`. The published command lists in
`src/chat/telegram/commands.ts` were hand-maintained arrays that had drifted
from the actual command surface registered in `src/bot.ts`. This caused three
problems:

- some working commands did not appear in Telegram autocomplete or the bot menu
- group menus were not explicitly modeled, so group command discoverability was
  inconsistent
- command metadata lived in more than one place, so future additions could
  drift again unless someone remembered to update the Telegram-specific arrays

A second Telegram-specific UX gap existed around group configuration: the DM
`/config` and `/setup` selector depended on observed group context data, so a
newly authorized group was not available in the DM selector until the bot first
saw traffic from that group, forcing an unnecessary round-trip into the group
before the admin could finish configuration.

The design spec
(`docs/archive/2026-05-28-telegram-command-publication-design.md`) and
implementation plan
(`docs/archive/2026-05-28-telegram-command-publication-alignment.md`)
established the approach before coding began.

## Decision Drivers

- **Single source of truth**: Telegram publication must derive from one
  canonical command manifest, not duplicated hand-maintained arrays.
- **Drift prevention**: Adding or removing a command must update one place;
  tests must fail if the manifest and registered handlers diverge.
- **Group menu honesty**: Group menus should advertise only commands genuinely
  meaningful in a group context, not DM-driven settings flows.
- **Immediate configurability**: After `/group add`, the authorized group must
  be configurable from DM without waiting for in-group observation.
- **No handler semantics change**: Publication and group-target discovery
  changes; command auth and DM-only behavior remain unchanged.

## Considered Options

### Option A: Keep hand-maintained Telegram arrays, add sync tests

Keep the existing `userCommands` / `adminCommands` arrays in
`src/chat/telegram/commands.ts` and add tests that compare them against
registered handlers.

- **Pros**: Minimal code change.
- **Cons**: Duplicated metadata persists; tests verify consistency but do not
  eliminate the duplication root cause.

### Option B: Canonical command catalog with provider-specific visibility flags (chosen)

Introduce a provider-agnostic command catalog in `src/commands/catalog.ts`
where each entry declares Telegram publication flags
(`publishInDmUser`, `publishInDmAdmin`, `publishInGroupUser`,
`publishInGroupAdmin`). Telegram scope generation renders from the catalog.

- **Pros**: Single source of truth; drift tests compare catalog against
  handler registration; group-safe publication rules are explicit per-command;
  extensible to other providers if needed.
- **Cons**: Slightly more structured metadata to maintain; Telegram-specific
  flags live in a provider-agnostic module.

### Option C: Provider-local catalog in `src/chat/telegram/`

Put the command catalog inside the Telegram provider directory rather than the
shared command layer.

- **Pros**: Clean provider isolation; no Telegram-specific data in shared code.
- **Cons**: Catalog is disconnected from the command registration site in
  `src/bot.ts`; drift tests must cross module boundaries; defeats the single-
  source-of-truth goal.

## Decision

**Option B** with the following subsidiary decisions:

| Topic               | Decision                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Catalog location    | `src/commands/catalog.ts` — provider-agnostic, colocated with command registration                                |
| Catalog shape       | `CommandCatalogEntry` with `name`, `description`, and `telegram: TelegramCommandVisibility` per entry             |
| Scope generation    | `commandsForScope()` filters the catalog by visibility flags, renders Bot API payloads                            |
| Group-safe commands | Published in group menus: `/help`, `/context`, `/clear`, `/group`                                                 |
| DM-driven commands  | Not published in group menus: `/start`, `/setup`, `/config`, `/plugin`, `/user`, `/users`, `/announce`, `/groups` |
| Admin chat scope    | Admin-only DM commands published to `chat` scope keyed by numeric `ADMIN_USER_ID`; non-numeric fails loudly       |
| Drift test          | Bot-level test compares registered handler names against `listCommandCatalogEntries()`                            |
| Unobserved groups   | `listManageableGroups()` merges observed contexts with authorization-backed fallback entries                      |
| Fallback display    | Unobserved authorized groups show native group ID as `displayName`; source marked `authorized-fallback`           |

## Consequences

### Positive

- Telegram autocomplete becomes an accurate view of the actual papai command
  surface.
- Future command additions require updating one catalog entry instead of
  multiple disconnected lists.
- Group menus are deliberate and no longer advertise DM-driven settings flows.
- Bot admins can configure a newly authorized group from DM immediately after
  `/group add`.
- Drift test makes it hard to add a command without updating the catalog.

### Negative

- Telegram publication flags in a provider-agnostic module introduce a small
  provider coupling surface.
- Some commands that technically do something when run from a group are no
  longer published there (classified as DM-driven).
- Selector logic is slightly more complex due to merging observed and
  authorization-backed group sources.

### Risks

- If a future provider needs different publication rules, the catalog's
  provider-specific `telegram` key pattern may need generalization rather than
  proliferation of per-provider blocks.
- Mitigation: the catalog shape is a plain typed object; adding a new
  provider-specific visibility block is a non-breaking extension.

## Implementation Notes

Key module: `src/commands/catalog.ts` — defines `CommandCatalogEntry`,
`TelegramCommandVisibility`, `COMMAND_CATALOG`, `listCommandCatalogEntries()`,
`getCommandCatalogEntry()`.

Telegram rendering: `src/chat/telegram/commands.ts` — `commandsForScope()`
filters the catalog; `registerTelegramCommands()` publishes four Bot API scopes
(`all_private_chats`, admin `chat`, `all_group_chats`,
`all_chat_administrators`).

Group targeting: `src/group-settings/access.ts` —
`appendAuthorizedFallbackGroups()` merges observed contexts with entries from
`authorized_groups` for the admin's platform instance; unobserved groups get
`authorized-fallback` source marker and native-ID display name.

Drift test: `tests/bot.test.ts` — compares registered command handler names
against `listCommandCatalogEntries().map(e => e.name)`.

## Related Decisions

- ADR-0014: Multi-Chat Provider Abstraction — chat provider model; Telegram is
  the only provider with `commands.menu` capability today.
- ADR-0123: Trusted-Local Plugin System — plugin commands are namespaced
  separately and not included in the core command catalog.
