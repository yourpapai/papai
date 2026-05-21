<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0060: User Identity Mapping for Group Chats

## Status

Implemented

## Date

2026-04-10

## Context

In group chats, multiple users interact with the bot through a shared API token. When a user says "assign to me" or "show my tasks", the bot has no way to resolve "me" to the correct task tracker user because all group members share the same token. This caused:

1. "Show my tasks" resolved to the token owner instead of the requesting user
2. "Assign me" assigned tasks to the wrong person
3. No way to distinguish between users in group contexts

This applied across all provider combinations (Telegram/Mattermost/Discord + Kaneo/YouTrack). The problem was independent of chat platform or task tracker.

## Decision Drivers

- Users must be able to resolve "me" and "my" references to their own task tracker identity
- Identity must be provider-specific (a user may have different logins in Kaneo vs YouTrack)
- The system should auto-link when possible (exact username match) and fall back to natural language prompting
- DMs must skip identity resolution (single user context is implicit)
- Identity mappings must persist across sessions to avoid repeated prompting
- Implementation must not require chat-platform-specific code in the identity layer

## Considered Options

### Option 1: No identity resolution — always use token owner

- **Pros**: No implementation effort; works for single-user deployments
- **Cons**: Completely broken for group chats with multiple users; incorrect task assignments

### Option 2: Admin-configured static mappings via /config

- **Pros**: Simple; no NL parsing needed; admin controls all mappings
- **Cons**: Does not scale; requires admin intervention for every new user; poor UX

### Option 3: SQLite-backed identity mappings with NL claiming and auto-link (chosen)

Map `chat_user_id` to `task_tracker_user_id` with provider-specific resolution. Users establish identity via natural language ("I'm jsmith"). Auto-link attempts exact username match on first group interaction. Provider-specific identity resolvers handle user search.

- **Pros**: Provider-agnostic; automatic when possible; natural language UX; per-provider mappings; no chat-platform coupling
- **Cons**: NL pattern matching may miss edge cases; auto-link can produce false positives for common names; requires provider API support for user search

## Decision

Add a `userIdentityMappings` SQLite table mapping `(contextId, providerName)` to `(providerUserId, providerUserLogin, displayName)` with composite primary key.

Add a `UserIdentityResolver` interface to the provider type system with `searchUsers(query, limit)` and optional `getUserByLogin(login)`. Each provider (Kaneo, YouTrack) implements this using their existing user API endpoints.

Implement an `src/identity/` module with three components:

1. **mapping.ts** — CRUD operations for the identity table (get, set, clear)
2. **resolver.ts** — `resolveMeReference()` for cached lookup and `attemptAutoLink()` for first-interaction resolution
3. **nl-detection.ts** — pattern matching for identity claims like "I'm jsmith"

Expose `set_my_identity` and `clear_my_identity` tools in group contexts when the provider supports `identityResolver`. Update task tools (`create_task`, `update_task`, `search_tasks`, `list_tasks`, `add_watcher`, `remove_watcher`) to resolve "me" references through `resolveMeReference()`.

## Rationale

The composite key `(contextId, providerName)` allows different mappings per provider without a shared identity assumption. Nullable `providerUserId` supports the `unmatched` state, which prevents repeated failed lookups — a user who cannot be auto-linked is stored with null credentials and prompted once for manual input rather than being searched again on every interaction.

Auto-link uses exact login/username matching with an email-prefix fallback (e.g., chat username "jsmith" matches provider login "jsmith@example.com"). This is conservative enough to avoid most false positives while still covering the common case.

The NL detection module uses a set of regex patterns rather than delegating to the LLM, because identity claims are structurally simple ("I'm X", "My login is X") and the LLM already has the `set_my_identity` tool available for the semantic interpretation layer. The regex layer extracts the claimed login; the tool validates it against the provider.

## Consequences

### Positive

- Users in group chats can say "show my tasks" and see their own tasks
- "Assign to me" assigns to the correct user
- Auto-link works for exact username matches without user intervention
- Identity is provider-specific (same user can be different in Kaneo vs YouTrack)
- DMs skip identity resolution entirely
- Natural language correction ("I'm not Alice, I'm jsmith") is intuitive
- No chat-platform-specific code in the identity layer

### Negative

- NL pattern matching may miss uncommon claim phrasings; the LLM's tool dispatch provides a fallback
- Auto-link can produce false positives for very common usernames; mitigated by requiring exact match
- Additional SQLite table and migration (019)
- Each provider must implement `identityResolver` with user search API support
- The `resolveMeReference()` function is async even though the cached path is synchronous, prepared for future auto-link wiring in the orchestrator

### Risks

- If a provider's user search API is slow, the auto-link on first group interaction adds latency to the user's first message
- Mitigation: auto-link is a background attempt; the `unmatched` state is stored immediately if no match, so subsequent interactions are fast

## Implementation Status

**Status**: Implemented

### Database schema (`src/db/schema.ts`)

`userIdentityMappings` table with composite PK `(contextId, providerName)`, nullable `providerUserId`, and `idx_identity_mappings_provider_user` index. Migration 019 in `src/db/migrations/019_user_identity_mappings.ts`.

### Identity types (`src/identity/types.ts`)

`MatchMethod` type (`'auto' | 'manual_nl' | 'unmatched'`), `IdentityMapping` interface, `UserIdentity` interface, `IdentityResolutionResult` discriminated union. Includes `isMatchMethod()` type guard not in the original design.

### Identity mapping CRUD (`src/identity/mapping.ts`)

`getIdentityMapping()`, `setIdentityMapping()`, `clearIdentityMapping()` with DI support (`IdentityMappingDeps`). `setIdentityMapping` uses `onConflictDoUpdate` for upsert. `clearIdentityMapping` sets `providerUserId` to null and `matchMethod` to `'unmatched'`.

**Divergence**: The plan had `SetIdentityMappingParams.providerUserId` as `string`; the implementation uses `string | null` to support the unmatched state directly.

### Identity resolver (`src/identity/resolver.ts`)

`resolveMeReference()` checks cached mapping, returns `not_found` / `unmatched` / `found`. `attemptAutoLink()` searches provider users, stores exact match or unmatched state. Both support DI via `ResolverDeps`.

**Divergence**: The plan had email-prefix matching in auto-link only; the implementation also added it to `set_my_identity`'s user search via the `findUser` helper.

### NL detection (`src/identity/nl-detection.ts`)

`extractIdentityClaim()` with five regex patterns. **Divergence**: The plan included `isIdentityClaim()`, `extractIdentityDenial()`, and `isIdentityDenial()` functions. The implementation only exports `extractIdentityClaim()` — the denial detection functions were removed because denial handling was simplified in `clear_my_identity` to not require NL parsing (it just clears unconditionally).

### Provider identity resolvers

- **Kaneo** (`src/providers/kaneo/identity-resolver.ts`): `createKaneoIdentityResolver(config, workspaceId)` — `searchUsers` via `kaneoListUsers`. **Divergence**: Added `workspaceId` parameter not in the plan.
- **YouTrack** (`src/providers/youtrack/identity-resolver.ts`): `createYouTrackIdentityResolver(config)` — `searchUsers` via `listYouTrackUsers`, `getUserByLogin` via `resolveYouTrackUserRingId`. Exports extended `YouTrackIdentityResolver` interface.

**Divergence**: Provider types use `IdentityUser` (from `src/providers/types.ts`) rather than the design's `UserRef`.

### Tools

- **`set_my_identity`** (`src/tools/set-my-identity.ts`): Extracts claim, searches provider, stores mapping. Supports DI via `SetMyIdentityDeps`.
- **`clear_my_identity`** (`src/tools/clear-my-identity.ts`): Clears mapping if one exists. Returns `info` if no mapping or already cleared. Supports DI via `ClearMyIdentityDeps`.

Both tools are registered in `src/tools/tools-builder.ts` for group contexts when `provider.identityResolver` is present.

### Task tool integration

Six tools updated to resolve "me" references via `resolveMeReference()`: `create_task`, `update_task`, `search_tasks`, `list_tasks`, `add_watcher`, `remove_watcher`. Returns `identity_required` status with prompting message when no identity is available.

## Related Decisions

- **ADR-0018** (Group Chat Support) — Group-scoped context that identity mapping builds on
- **ADR-0014** (Multi-Chat Provider Abstraction) — Provider interface foundation
- **ADR-0058** (Provider Capability Architecture) — Capability-driven model that `identityResolver` follows
- **ADR-0059** (Thread-Aware Group Chat) — Thread-scoped storage context IDs that identity mappings must respect
- **ADR-0055** (Fix Cross-User Impersonation) — Related security fix for group chat authorization
