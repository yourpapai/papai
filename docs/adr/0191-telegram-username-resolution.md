<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0191: Telegram Username Resolution

## Status

Implemented

## Date

2026-06-10

## Context

The settings UI lets operators and group admins authorize users by adding them
to the `users` table (admin Users section) or to `group_members` (group Members
section). Until this change, Telegram add forms accepted only the numeric
`platform_user_id` that the Telegram Bot API surfaces — a value operators have
no in-band way to discover and routinely must look up out-of-band (e.g. via a
third-party "user info" bot). The other providers are easier: Discord
`resolveSettingsUserId` resolves a `@username` live, Mattermost exposes the
username inline, and Kontur Talk carries an opaque ID. Telegram was the
outlier, forcing a strictly-numeric flow that was a recurring friction point.

This change teaches the Telegram adapter's `ChatProvider.resolveUserId` to
accept `@username` (or bare `username`) by calling the Bot API `getChat` method,
and updates both add forms to advertise the affordance through their `Field`
label, hint, and `Input` placeholder. It is the live-resolution half of a pair
with ADR-0190: when `resolveUserId` returns `null` — which for a Bot API token
is the outcome for any **user** account — ADR-0190's pending-entry flow stores a
`placeholder-<uuid>` row that rebinds to the real numeric ID on the user's first
DM. The two ADRs share the same date and the same UI surfaces; this one owns the
adapter call, that one owns the persistence fallback.

## Decision Drivers

- **Operator ergonomics.** `@username` is what operators know; numeric IDs are
  not discoverable from the chat itself.
- **Bot API limitation.** A Bot API token can resolve channels and bots by
  username but **cannot resolve user accounts** — so `resolveUserId` must fail
  gracefully and hand off to the pending-entry path, never throw.
- **Decoupled seam.** Live resolution and the pending-entry fallback must stay
  behind a single `string | null` contract so the two features evolve
  independently.
- **Backward compatibility.** Existing numeric-ID input must keep working
  unchanged with no extra round-trip.
- **Cross-section consistency.** The same `@username` affordance should surface
  in both the group Members section and the admin Users section.

## Considered Options

### Option A: `getChat`-based resolution in `resolveUserId` (chosen)

- **Pros:** reuses the existing Grammy `bot.api` handle, no new dependency, no
  extra credential; returns `null` on any rejection so the pending-entry fallback
  composes cleanly; short-circuits numeric input with zero API cost.
- **Cons:** resolves only channels/bots, not user accounts — for the common
  case (adding a person) the call always rejects and falls through; each
  unresolvable attempt costs one Bot API round-trip.

### Option B: Numeric ID only (status quo)

- **Pros:** deterministic, no network call, no failure mode.
- **Cons:** poor operator UX; the friction that motivated this change remains;
  diverges from Discord which already resolves `@username` live.

### Option C: Resolve user accounts via a side-channel (MTProto / a separate

user-bot)

- **Pros:** could resolve the human-user case the Bot API cannot.
- **Cons:** out of scope; introduces new infra, credentials, and a security
  surface (long-lived user session); the pending-entry path already covers the
  human-user case with no such cost.

## Decision

`TelegramChatProvider.resolveUserId` (`src/chat/telegram/index.ts:163-172`)
strips a leading `@`, short-circircuits all-digit input by returning it
unchanged, otherwise calls `this.bot.api.getChat(\`@${clean}\`)`and returns`String(chat.id)`on success. Any rejection — including the always-failing
user-account case — is caught and returns`null`. That `null`is the single
contract ADR-0190 keys on: the settings admin route stores a`placeholder-<uuid>`row, and`resolveUserByUsername`in`src/auth.ts` rebinds
it on the user's first DM.

Both add forms surface the affordance through the shared `Field`/`Input`
components: a `User ID or @username` label, a `For Telegram, you can use
@username instead of numeric ID` hint, and a `123456789 or @username`
placeholder. The group Members section
(`client/settings/sections/MembersSection.svelte:94-98`) and the admin Users
section (`client/settings/sections/admin/AdminUsersSection.svelte:175-178`)
carry identical copy so the experience is uniform; the admin section additionally
notes the pending-entry behavior in its hint (ADR-0190 territory).

Four Bun tests in `tests/chat/telegram/username-resolution.test.ts` pin the
contract: numeric pass-through, `@username` resolution, bare `username`
resolution (asserting `getChat` is called with the `@`-prefixed form), and
`null` on an unresolvable name.

## Consequences

### Positive

- Operators can paste a Telegram `@username` into either add form; resolvable
  targets (channels, bots) bind immediately, and the common human-user case
  degrades cleanly into the pending-entry path rather than 422-ing.
- Numeric IDs keep working with no API call and no behavior change.
- The `null` seam keeps this ADR and ADR-0190 independent: the adapter owns
  "try the Bot API", the persistence layer owns "remember it for later", and
  neither needs to know the other's internals.

### Negative

- For user accounts — the most common add target — `getChat` always rejects, so
  live resolution is effectively a no-op that always falls through. Its value is
  the unified affordance plus the channel/bot edge case; operators may expect
  `@user` to resolve immediately and be surprised by the pending path.
- Each unresolvable attempt costs one Bot API round-trip before the fallback
  fires; bulk-adding many unknown usernames amplifies this.
- Only Telegram gains this path. Mattermost and Kontur Talk admin/user adds
  remain numeric, and group-member adds on platforms that cannot resolve a
  username still 422 rather than pending.

### Risks

- Telegram `getChat` rate limits could bite if an operator adds many
  unresolvable usernames in a tight loop; there is no per-form throttle.
- The `@`-prefix normalization in `resolveUserId` must stay in lockstep with the
  case-insensitive comparison in `resolveUserByUsername` (ADR-0190). A future
  change to one without the other could orphan pending entries or double-bind.

## Related Decisions

- ADR-0190: Pending Username Entries — the fallback path this ADR's `null`
  return triggers; same date, same UI surfaces.
- ADR-0148: Multi-Provider Stabilization — the platform-scoped `users` model and
  `resolveUserByUsername` this composes with.
- ADR-0127: Multi-Provider Phase 4 (Admin and Dashboard) — the admin Users
  section the `@username` affordance surfaces in.
- ADR-0187: Settings Page Redesign — the `Field`/`Input` component contract the
  label, hint, and placeholder ride on.

## Implementation Notes

- `src/chat/telegram/index.ts:163-172` — `resolveUserId` body: `@` strip, digit
  short-circuit, `getChat` call, `String(chat.id)` / `null`.
- `tests/chat/telegram/username-resolution.test.ts` — four tests; uses a static
  import (`import { TelegramChatProvider } from '../../../src/chat/telegram/index.js'`)
  rather than the delayed `await import()` sketched in the plan, following the
  repo's DI-first test convention.
- `client/settings/sections/MembersSection.svelte:94-98` — label/hint/placeholder
  via the `Field` component's built-in `hint` prop (the plan's sketch used a
  separate `<p class="field-hint">`; the shipped form uses the component prop).
- `client/settings/sections/admin/AdminUsersSection.svelte:175-178` — matching
  label/hint/placeholder added in tandem (ADR-0190 territory), so the two add
  forms present identically.
