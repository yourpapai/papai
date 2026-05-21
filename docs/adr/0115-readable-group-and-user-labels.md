<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0115: Readable Group And User Labels in `/groups` and `/group users`

## Status

Implemented (with architectural extensions beyond the plan)

## Date

2026-04-19

## Context

The `/groups` and `/group users` commands rendered raw storage IDs:

```text
Authorized groups:
-1003768634358 (added by 164696606)
```

The `ChatProvider` contract already supported username-to-ID resolution for command inputs (`resolveUserId`), but had no reverse-resolution interface for turning stored IDs into human-readable labels. This was an architectural gap: the command layer was structurally incapable of producing readable output even when the underlying chat platform had all the identity metadata.

## Decision Drivers

- **User-facing readability**: Bot admins should see `Engineering Chat (added by John Johnson (@itsmike))`, not numeric IDs.
- **Best-effort resilience**: Resolution must never fail the command; raw IDs remain a valid fallback.
- **Provider isolation**: Platform-specific identity lookup logic belongs inside chat adapters, not in command code.
- **No persistence or migration changes**: The already-stored raw IDs remain canonical.

## Considered Options

### Option 1: Store display names at write-time

- **Pros**: Output is always readable; no runtime lookups needed.
- **Cons**: Stale data problems; requires migration/backfill decisions; still does not solve readability for existing rows.
- **Verdict**: Rejected. See spec "Alternatives considered #2".

### Option 2: Separate shared resolver service

- **Pros**: Centralized lookup logic.
- **Cons**: Duplicates provider wiring outside the chat layer; creates a second abstraction for platform identity.
- **Verdict**: Rejected. See spec "Alternatives considered #1".

### Option 3: Extend `ChatProvider` with reverse-resolution methods (chosen)

- **Pros**: Provider-specific knowledge stays inside adapters; command layer stays platform-agnostic; zero persistence changes.
- **Cons**: Requires each provider adapter to implement its own best-effort lookup; output quality varies by platform.
- **Verdict**: Accepted.

## Decision

Extend `ChatProvider` with two optional reverse-resolution methods:

```ts
resolveUserLabel: (userId: string, context: ResolveUserContext | undefined) => Promise<string | null>
resolveGroupLabel: (groupId: string) => Promise<string | null>
```

Each method returns a fully formatted user-facing label string or `null`. The command layer in `src/commands/group.ts` becomes responsible only for presentation and fallback: calling the provider, caching results per-request, and rendering resolved labels with raw-ID fallback when resolution returns `null`.

## Architecture

### Provider contract

Added to `src/chat/types.ts`:

- `resolveUserLabel`: async reverse user ID → `Display Name (@username)` or partial variants or `null`.
- `resolveGroupLabel`: async reverse group ID → `Title/Name` or `null`.

Both are optional so existing providers (if any) are not broken.

### Provider implementations

All three existing providers implement both methods via extracted `label-helpers.ts` files:

| Provider       | Group lookup                                           | User lookup                                                                         | Notes                                                                                            |
| -------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Telegram**   | `bot.api.getChat(chatId).title`                        | `bot.api.getChatMember(chatId, userId)`                                             | Best-effort; numeric IDs only; falls back to cached observations from `group-settings/` registry |
| **Mattermost** | `fetchMattermostChannelInfo(groupId)` → `display_name` | `GET /api/v4/users/{id}` → first/last + username                                    | Full-featured; new `MattermostUserSchema` added                                                  |
| **Discord**    | `client.channels.cache.get/fetch(groupId).name`        | `guild.members.fetch(userId)` (preferred) → `client.users.fetch(userId)` (fallback) | Guild context required for member display name; widened `GuildLike` structural types             |

### Command layer

`src/commands/group.ts`:

- `resolveUserLabelCached` / `resolveGroupLabelCached`: `Map`-based memoization with `pLimit(MAX_CONCURRENT_LABEL_LOOKUPS)` (default 5).
- `makeDisplayLabel`: `label ?? fallback` — the only presentation logic.
- `/groups`: async map over authorized groups, parallel-resolve group label + adder label per row.
- `/group users`: async map over members, parallel-resolve member label + adder label per row.

All lookups are try/catch guarded: failures log at `warn` and produce `null`, so the command never fails.

### Telegram cache fallback (architecture extension)

The implementation added `src/chat/group-display-resolution.ts` and `src/chat/telegram/group-display-resolution.ts` — a provider-dispatching layer that routes Telegram through a specialized path:

1. **Live API lookup** first (via `resolveGroupLabel`/`resolveUserLabel` on the Telegram provider).
2. **Cached fallback** via `findKnownGroupContext` and `findGroupUserObservation` (from the `group-settings/` registry) when the live lookup returns `null`.

This extends the spec's scope but preserves its spirit: best-effort readability using whatever identity metadata the system already has.

### Label formatting contract

All providers return preformatted strings following a common convention:

- `Display Name (@username)` — both available
- `Display Name` — only display name
- `@username` — only username
- `null` — neither available or lookup failed; caller falls back to raw ID

## Testing

### Command tests (`tests/commands/group.test.ts`)

12 new tests under `describe('readable label resolution', () => { ... })`:

- `/groups` uses resolved group and user labels
- Added-by labels resolve separately per group context
- `/group users` uses resolved member and adder labels
- Concurrent lookup bounding at 5 in-flight (via blocking mock)
- Null fallback when resolution returns `null`
- Rejection fallback when resolution throws
- Telegram cache fallback when live lookup returns `null`

### Provider tests

- `tests/chat/mattermost/index.test.ts`: 3 new tests (group label, user label, null fallback)
- `tests/chat/discord/index.test.ts`: 3 new tests (channel name, guild member, global user fallback)
- `tests/chat/telegram/index.test.ts`: 3 new tests (group title, chat member, non-numeric rejection)

## Consequences

### Positive

- `/groups` and `/group users` now produce readable output on Mattermost and Discord in most cases.
- Telegram group titles resolve reliably; user labels fall back to cached observations from the group-settings registry.
- Zero persistence changes — raw IDs remain canonical.
- Architecture stays layered: provider logic inside adapters, presentation inside command layer.
- In-request memoization prevents duplicate lookups and `pLimit` prevents unbounded concurrency.

### Negative

- Telegram user labels still fall back to raw IDs frequently because the Bot API does not support arbitrary reverse user lookup by ID.
- Per-provider display-name fields differ, so exact output varies across platforms even though the contract is consistent.
- An extra hop (live API → cache fallback) for Telegram adds slight complexity beyond the original plan.

## Implementation Divergences from Plan

The implementation goes beyond the spec/plan in the following ways:

| Divergence                    | Plan                          | Actual                                                                                                    |
| ----------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| Extracted helper modules      | Inline in provider `index.ts` | Separate `label-helpers.ts` per provider for cleaner separation of concerns                               |
| Telegram cache fallback       | Not specified                 | Added `group-display-resolution.ts` and `telegram/group-display-resolution.ts` for live → cached fallback |
| Context-aware user cache keys | `${userId}`                   | `${contextType}:${contextId}:${userId}` to prevent cross-context collision                                |

These are additive improvements; all spec requirements are met.

## Related Decisions

- **ADR-0014**: Multi-Chat Provider Abstraction — the `ChatProvider` contract that was extended here.
- **ADR-0018**: Group Chat Support — the original group-management command layer.
- **ADR-0060**: User Identity Mapping — the cached user/group observations reused as Telegram fallback.

## References

- `src/chat/types.ts` (extended `ChatProvider` contract)
- `src/commands/group.ts` (label resolution and display formatting)
- `src/chat/group-display-resolution.ts` (provider dispatch for Telegram cache fallback)
- `src/chat/telegram/label-helpers.ts` / `group-display-resolution.ts` (Telegram)
- `src/chat/mattermost/label-helpers.ts` (Mattermost)
- `src/chat/discord/label-helpers.ts` (Discord)
- `src/chat/mattermost/schema.ts` (`MattermostUserSchema`)
- `src/chat/discord/client-factory.ts` (widened structural types, `GuildLike`)
- `tests/utils/test-helpers.ts` (`resolveUserLabel` / `resolveGroupLabel` mock injection)
- `tests/commands/group.test.ts` (command-level coverage)
- `tests/chat/mattermost/index.test.ts` (provider tests)
- `tests/chat/discord/index.test.ts` (provider tests)
- `tests/chat/telegram/index.test.ts` (provider tests)
- `docs/superpowers/specs/2026-04-19-readable-group-and-user-labels-design.md`
- `docs/superpowers/plans/2026-04-19-readable-group-and-user-labels-implementation.md`
