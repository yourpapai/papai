# Readable Group And User Labels Design

- Date: 2026-04-19
- Status: Draft - pending review
- Scope: improve `/groups` and `/group users` output by resolving stored group and user IDs into readable platform labels with safe fallback to raw IDs

## Background

Today the group-management command layer renders IDs directly from storage.

- `src/commands/group.ts` formats `/groups` output as `${group.group_id} (added by ${group.added_by})`
- `src/commands/group.ts` formats `/group users` output as `- ${m.user_id} (added by ${m.added_by})`

This is readable to the database, but not to bot admins. The underlying root cause is architectural, not formatting-only: the command layer has no reverse-resolution interface for turning a stored chat ID or user ID back into a human-readable label. The current `ChatProvider` contract supports username-to-ID lookup for command inputs, but not ID-to-label lookup for command output.

## Goals

- `/groups` shows each authorized group using a readable group name when the provider can resolve it.
- `/groups` shows the `added by` actor using a readable user label when the provider can resolve it.
- `/group users` shows both member identities and `added by` values using readable user labels when possible.
- User labels render as `Display Name (@username)` when both pieces are available.
- Commands remain reliable when names cannot be resolved by falling back to raw IDs.

## Non-goals

- Persisting display names or usernames in the database.
- Backfilling existing rows with resolved names.
- Changing authorization or membership storage schemas.
- Replacing every raw ID rendering site in the application.

## User-facing behavior

### `/groups`

Current output:

```text
Authorized groups:
-1003768634358 (added by 164696606)
```

Target output when both lookups succeed:

```text
Authorized groups:
Engineering Chat (added by John Johnson (@itsmike))
```

Fallback output when lookups fail remains valid:

```text
Authorized groups:
-1003768634358 (added by 164696606)
```

### `/group users`

Current output:

```text
Group members:
- 164696606 (added by 123456789)
```

Target output when lookups succeed:

```text
Group members:
- John Johnson (@itsmike) (added by Jane Admin (@janeadmin))
```

Fallback output when lookups fail remains valid.

## Recommended approach

Extend the `ChatProvider` abstraction with reverse-resolution methods and keep all provider-specific lookup logic inside chat adapters.

This is the smallest change that respects the current architecture:

- command handlers stay platform-agnostic
- provider API knowledge stays inside adapters
- no new persistence or cross-layer resolver service is introduced

## Alternatives considered

### 1. Separate shared resolver service

Rejected.

This would duplicate provider wiring outside the chat layer and create a second abstraction for platform identity lookup next to `ChatProvider`.

### 2. Store display names when entries are created

Rejected.

This would make output faster to render but would introduce stale data problems, require migration/backfill decisions, and still would not solve readability for existing rows without additional work.

## Target architecture

### Chat provider contract

Add two optional methods to `src/chat/types.ts`:

```ts
resolveUserLabel?: (userId: string, context?: ResolveUserContext) => Promise<string | null>
resolveGroupLabel?: (groupId: string) => Promise<string | null>
```

The methods return preformatted user-facing labels rather than raw profile objects. This keeps command code simple and lets each provider decide how much identity detail it can reliably expose.

### Formatting rules

User label formatting target:

- display name and username both available: `John Johnson (@itsmike)`
- only display name available: `John Johnson`
- only username available: `@itsmike`
- neither available or lookup fails: `null` and the caller falls back to the raw ID

Group label formatting target:

- resolved group title/name: `Engineering Chat`
- lookup fails: `null` and the caller falls back to the raw group ID

### Command layer changes

`src/commands/group.ts` becomes responsible for presentation only:

- `/groups`
  - load authorized groups from storage as it does today
  - for each row, ask the active chat provider for a group label and adder label
  - render resolved labels when present
  - fall back to the stored ID for either field independently when resolution fails
- `/group users`
  - load group members from storage as it does today
  - resolve member label and adder label through the active provider
  - apply the same independent fallback behavior

No storage or auth behavior changes.

## Provider-specific design

### Telegram

Group resolution:

- use `getChat(chatId)` and read the group title when available

User resolution:

- Telegram is the weakest provider for arbitrary reverse user lookup by ID
- the bot can only resolve a label when it has enough chat/member context to fetch a known member or otherwise already has that information
- if a lookup cannot be performed safely, return `null`

Expected result:

- group names should often resolve successfully
- user labels may fall back to IDs more often than on Mattermost or Discord

### Mattermost

Group resolution:

- use the existing channel metadata path to fetch channel info by ID

User resolution:

- use the Mattermost user-by-ID API
- build labels from available display-name fields and username

Expected result:

- both `/groups` and `/group users` should generally produce fully readable output

### Discord

Group resolution:

- fetch the channel by ID and use its name

User resolution:

- when guild context is available, prefer guild member lookup so the label can use the member display name
- otherwise fall back to user fetch and use the global username/display name available there

Expected result:

- group labels should resolve reliably for stored channel IDs
- user labels should usually resolve in guild-backed flows, with fallback to raw IDs when not enough context is available

## Error handling

- Resolution failure must not fail the command.
- Each lookup is best-effort.
- The command output remains complete even if every lookup returns `null`.
- Provider lookup failures should be logged at `warn` with enough metadata to diagnose the failing ID and provider path.
- No new user-facing error messages are introduced for lookup failure.

## Performance and concurrency

- Resolution work should be asynchronous.
- Independent label lookups for a given command response can be executed in parallel, but should avoid duplicate lookups for repeated IDs in the same response.
- An in-request memoization map is sufficient for this scope.
- Persistent caching is not required for the first implementation.

## Testing strategy

### Command tests

Update `tests/commands/group.test.ts` to cover:

- `/groups` uses resolved group and user labels when the provider returns them
- `/groups` falls back to raw IDs when group resolution, user resolution, or both fail
- `/group users` uses resolved member and adder labels when the provider returns them
- `/group users` falls back to raw IDs when user resolution fails

### Provider tests

Add focused tests only where the adapter already has local test coverage patterns for external lookups.

The goal is not to exhaustively test remote APIs, but to verify:

- the adapter returns the expected label shape
- missing data becomes `null` instead of throwing
- formatting rules are applied consistently

## Affected files

- `src/chat/types.ts` - extend `ChatProvider` with reverse-resolution methods
- `src/commands/group.ts` - use provider label resolution in `/groups` and `/group users`
- `src/chat/telegram/index.ts` - implement Telegram label resolution best-effort paths
- `src/chat/mattermost/index.ts` - implement Mattermost group and user label resolution
- `src/chat/discord/index.ts` - implement Discord group and user label resolution
- `tests/commands/group.test.ts` - add command-level coverage for resolved labels and fallbacks

## Risks

- Telegram capability gap: user labels may still fall back to raw IDs frequently because Telegram does not offer the same reverse-lookup ergonomics as the other providers.
- Provider inconsistency: display-name fields differ across platforms, so exact output content may vary by provider even though the formatting contract is consistent.
- N+1 lookups: naive implementation could perform repeated calls for the same ID in one response. This is mitigated by in-request memoization.

## Decision summary

Implement readable output for `/groups` and `/group users` by extending `ChatProvider` with best-effort reverse label resolution methods. Keep provider-specific logic in adapters, keep presentation in the command layer, and preserve raw-ID fallback so command reliability does not regress.
