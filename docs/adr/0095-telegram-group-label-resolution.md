# ADR-0095: Telegram-Specific Group and User Label Resolution for `/groups` and `/group users`

## Status

Accepted

## Date

2026-05-17

## Context

The `/groups` and `/group users` commands resolve group IDs and user IDs to readable display labels before formatting reply text. The existing generic resolution path delegates to the chat provider's `resolveGroupLabel` / `resolveUserLabel` hooks and falls back to raw IDs when these return `null`.

For Telegram, this generic fallback produces a poor user experience because the Telegram Bot API has intentional limitations:

- `getChat(group_id)` works reliably for groups the bot can reach.
- `getChatMember(group_id, user_id)` is **only guaranteed to work when the bot is an administrator** in the group.
- When the bot is not an admin, or when the target user is no longer a member, live resolution returns `null` and the command falls back to raw numeric IDs even though the bot may have already observed human-readable names from earlier message traffic.

The codebase already captured some group context observation data (`knownGroupContexts`) and admin observations (`groupAdminObservations`), but non-admin user observations were not tracked. This meant `/group users` could not show readable labels for regular members whose names were known from earlier messages.

Prior art: `ADR-0018` (Group Chat Support) introduced group context observations. `ADR-0014` (Multi-Chat Provider Abstraction) established the generic `resolveGroupLabel` / `resolveUserLabel` provider hooks. This decision sits at the intersection — a provider-specific display resolution enhancement on top of the generic abstraction.

## Decision Drivers

1. **Bot API limitations**: Telegram's `getChatMember` is unreliable for non-admin bots; raw-ID fallback is confusing.
2. **Already-captured data**: Incoming Telegram group messages contain `first_name`, `last_name`, and `username` that were going unused after the initial message reply.
3. **No MTProto migration**: The project uses the Telegram Bot API (Grammy) throughout; switching to MTProto or TDLib for identity lookup is out of scope.
4. **Provider-scope isolation**: A cache for Telegram user labels is not automatically valid for Mattermost or Discord users.

## Considered Options

### Option 1: Generic provider hook enhancement (rejected)

Add fallback logic directly into the generic `resolveGroupLabel` / `resolveUserLabel` provider hooks so every provider benefits.

- **Pros**: Single path, no provider-specific modules.
- **Cons**: The fallback policy is **inherently provider-specific** — Telegram's `getChatMember` limitation does not apply to Mattermost/Discord. Pushing Telegram-specific cache tables into generic code would leak provider concerns upward. Error logging would be either too generic or per-provider conditionals would fragment the unified abstraction.
- **Verdict**: Rejected — violates `ADR-0014`'s clean provider boundary.

### Option 2: Provider-scoped cached observations with Telegram-specific resolver (accepted)

Add a new provider-scoped observation table for group user display labels, capture display labels during incoming Telegram message processing, and introduce a dedicated Telegram resolver that applies the provider-specific fallback ordering:

> live Bot API lookup → cached observation → raw ID

- **Pros**: Clean boundary; provider concerns isolated; reuses existing generic command formatting; improves UX immediately from already-observed data.
- **Cons**: Slightly more file surface than Option 1; table is provider-agnostic but rows are scoped by provider.
- **Verdict**: Accepted.

### Option 3: Add MTProto/TDLib client for reliable user lookup (rejected)

Use the full Telegram API (`contacts.resolveUsername`) for more powerful identity resolution.

- **Pros**: Could resolve arbitrary users reliably.
- **Cons**: Requires separate MTProto client, `access_hash` management, and significantly increases operational and security surface. Not consistent with existing Grammy-only architecture.
- **Verdict**: Rejected — out of scope and disproportionate.

## Decision

Introduce a **provider-scoped cached user observation table** (`group_user_observations`) with a composite primary key of `(provider, context_id, user_id)`, populate it from incoming Telegram group messages via `msg.user.displayLabel`, and wire a dedicated **Telegram display resolution layer** into the generic command path via a generic intermediary (`src/chat/group-display-resolution.ts`).

The resolution ordering for Telegram is explicit:

- **Group labels**: `resolveGroupLabel(groupId)` → `findKnownGroupContext(provider, groupId).displayName` → `groupId`
- **User labels**: `resolveUserLabel(userId, {contextId, contextType: 'group'})` → `findGroupUserObservation(provider, contextId, userId).displayLabel` → `userId`

## Rationale

- The policy is **provider-specific** (Telegram Bot API limitations) so the code that encapsulates it should be too.
- The data source is **already present** — observers only needed persistence wiring.
- The change is **additive** — non-Telegram providers continue to use their existing hooks without alteration.
- The architecture follows the existing pattern of provider-specific impls under `src/chat/<provider>/` and generic dispatch in `src/chat/`.

## Consequences

### Positive

- `/groups` and `/group users` now show readable Telegram labels even when the bot cannot reach a user via `getChatMember`.
- Labelling improves over time as the bot observes more group messages.
- Group label and admin label support from prior work is preserved and extended to regular members.
- Clean architectural separation: `src/commands/group.ts` never imports Telegram-specific code.

### Negative

- A net-new SQLite table and Drizzle schema increase schema surface.
- The generic intermediary (`src/chat/group-display-resolution.ts`) adds one more file to the dispatch chain.
- Cached labels can become stale if a user changes their Telegram display name.
- Label cache is scoped to `(provider, group, user)`; the same user in a different group requires separate observation.

### Risks

- Stale cached labels may show outdated names. **Mitigation**: Throttled upsert (5-minute window) keeps writes bounded; last-seen is updated on every observation; label changes propagate on next message.
- The table will grow with every observed user/group pair. **Mitigation**: Observations only happen for **commands** (`commandMatch` defined) or **mentions** (`isMentioned === true`) in groups — they do not fire on every natural-language group message, so growth is gated by meaningful interaction volume.

## Implementation Notes

### Files added

- `src/db/migrations/028_group_user_observations.ts` — creates the table with index on `(provider, user_id)`.
- `src/chat/telegram/group-display-resolution.ts` — Telegram-specific resolver with live → cached → null fallback.
- `src/chat/group-display-resolution.ts` — generic intermediary that routes Telegram to the provider-specific resolver and non-Telegram to existing hooks.
- `src/group-settings/registry-types.ts` — type interfaces `UpsertGroupUserObservationInput` and `GroupUserObservation`.

### Files modified

- `src/db/schema.ts` — adds `groupUserObservations` table definition.
- `src/db/index.ts` — registers migration 028.
- `src/group-settings/registry.ts` — adds `findKnownGroupContext`, `upsertGroupUserObservation`, and `findGroupUserObservation`.
- `src/chat/types.ts` — adds optional `displayLabel?: string` to `ChatUser`.
- `src/chat/telegram/index.ts` — populates `displayLabel` from `getTelegramDisplayLabel` in `extractMessage`.
- `src/bot-group-observation.ts` — persists user display label observations alongside existing group and admin observations.
- `src/commands/group.ts` — replaces direct `resolveGroupLabel` / `resolveUserLabel` calls with `resolveChatGroupDisplayLabel` / `resolveChatUserDisplayLabel`.

### Files tested

- `tests/group-settings/registry.test.ts` — regression tests for observation table and lookup helpers.
- `tests/chat/telegram/group-display-resolution.test.ts` — five focused unit tests for live/cached/fallback ordering.
- `tests/bot.test.ts` — regression test verifying group-message observation writes cached user display labels.
- `tests/commands/group.test.ts` — two regression tests proving cached labels are used when live lookups return `null`.

### Key design choice

The command code (`src/commands/group.ts`) delegates through `resolveChatGroupDisplayLabel` / `resolveChatUserDisplayLabel` rather than importing the Telegram resolver directly. This preserves the abstraction boundary from `ADR-0014`: the command layer is provider-agnostic and the routing happens at the chat resolution layer.

## Related Decisions

- **ADR-0014**: Multi-Chat Provider Abstraction — established `ChatProvider` hooks and the generic provider boundary.
- **ADR-0018**: Group Chat Support — introduced group context and admin observations.

## References

- Telegram Bot API docs: `getChat` and `getChatMember` limitations documented at https://core.telegram.org/bots/api#getchatmember
- Implementation plan: `docs/superpowers/plans/2026-04-30-telegram-group-label-resolution.md` (archived)
- Design spec: `docs/superpowers/specs/2026-04-30-telegram-group-label-resolution-design.md` (archived)
