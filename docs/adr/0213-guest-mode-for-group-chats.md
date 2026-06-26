<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0213: Guest Mode for Group Chats

## Status

Implemented

## Date

2026-06-19

## Context

In an authorized group, papai's auth gate (`checkAuthorizationExtended`, `src/auth.ts`) terminates any user who is not a bot admin, a platform/group admin, a row in `users`, or a row in `group_members` with `group_member_not_allowed`. There was no way to let arbitrary, otherwise-unrecognized chat participants use the bot in a safe, restricted fashion — the only levers were full denial, auto-provisioning via `open_dm_access` (a per-DM path that creates a `users` row), or manually adding the user as a member.

The 2026-06-19 design (`docs/superpowers/specs/2026-06-19-guest-mode-group-chats-design.md`) introduced a per-group "guest mode" toggle. When enabled on an authorized group, an unrecognized user present in that chat is admitted as a **guest**: they share the live thread conversation (so the bot keeps context) but receive a hardcoded **read-only** toolset and are excluded from long-term memory capture and promotion. Bot admins, group admins, and members are unaffected. Guest mode is off by default, so with it off behavior is identical to today.

The design's core correctness invariant is that guests are **never provisioned** — no `users` or `group_members` rows. A provisioned guest would match the member branch on their next message and silently gain full member tools. Guests are identified only by a runtime role flag.

## Decision Drivers

- **Least privilege without an escalation path.** A guest must never reach a write/destructive/open-world tool, and must never be able to self-approve an escalation — `read`-only is hard deny, not `ask`.
- **No silent promotion.** Provisioning a guest into `users`/`group_members` would let them match the member branch next turn; the data model must keep guests ephemeral.
- **Zero impact on existing members/admins.** The feature must be a pure addition to the unrecognized-user branch; the member/admin/auth paths and their shared per-context `tool_prefs` must be byte-for-byte unchanged.
- **Untrusted input never enters durable group memory.** Guest turns participate in the live thread but must not flow into the long-term capture/promotion pipeline that writes group-shared `memory_records`.
- **Per-group, operator-controlled.** Enabling is a group-admin/bot-admin action in the settings UI, gated by the existing `requireScope` + CSRF trust plane; no per-user config surface.

## Considered Options

### Option A — Role-flag threading + fixed guest filter (chosen)

Add `isGuest` to `AuthorizationResult` and an `actorRole` ('guest' | 'member') option threaded through the queue → orchestrator → `makeTools`; apply a hardcoded `applyGuestReadOnlyFilter` that keeps only `risk: 'read'` tools and bypasses per-context `tool_prefs` entirely.

- **Pros**: guests reuse the shared descriptor cache and history; enforcement is a single read-only filter with no per-user storage; members are untouched; the invariant "guests are never provisioned" is structural, not policy.
- **Cons**: a new `actorRole` field threads through several modules; the filter must be fail-closed (unknown metadata → dropped) and is not configurable per context.

### Option B — Synthetic per-guest `tool_prefs`

Give each guest a per-user `tool_prefs` row setting every non-`read` tool to `deny`, resolved through `applyToolPreferences`.

- **Pros**: reuses the existing permission machinery; nominally configurable.
- **Cons**: wrong semantics — `tool_prefs` uses the three-state `allow`/`ask`/`deny` model, and an untrusted actor should not even have an `ask` path; introduces a per-user permission row (the model is per-context today); invites drift if a new tool is added without a `deny` override. Rejected.

### Option C — Bake guest gating into `buildToolDescriptors`

Filter at descriptor-build time keyed on `actorRole`.

- **Pros**: one place to reason about the toolset.
- **Cons**: overloads capability gating with actor identity; pollutes the per-context descriptor cache key (the cache is keyed by `chatUserId`/`provider`/`contextType`, not role); forces a cache invalidation on every guest turn and re-runs descriptor assembly. Rejected.

## Decision

Six coordinated changes implement the feature:

### 1. Data model — `guest_mode` column (migration 059)

A new boolean column `guest_mode` (default `false`) on `authorized_groups`, added by `src/db/migrations/059_guest_mode.ts` (idempotent `ALTER TABLE ... ADD COLUMN`, mirroring `058_open_dm_access.ts`). The Drizzle column `guestMode` is declared on `authorizedGroups` in `src/db/schema.ts`, and the migration is registered in `src/db/index.ts`. Store helpers `isGuestModeEnabled` / `setGuestMode` live in `src/authorized-groups.ts`, mirroring the `open_dm_access` store pattern in `src/instances/platform-store.ts`. No `users`/`group_members` rows are created for guests.

### 2. Auth — `isGuest` flag + guest branch (`src/auth.ts`, `src/chat/authorization-types.ts`)

`AuthorizationResult` gains an optional `isGuest: boolean` flag and a new `ActorRole = 'guest' | 'member'` type. In `getUnauthenticatedGroupAuth`, a guest branch is inserted immediately before the terminal `group_member_not_allowed` deny: when `isGuestModeEnabled(groupConfigContextId)` and no prior branch matched, it returns `getGuestGroupAuth(...)` with `isGuest: true`. Ordering is preserved — `authorized_groups` → bot admin → **blocked** → `users` → platform admin → `group_members` → **guest (new)** → deny — so a blocked `users`-table member cannot re-enter as a guest.

### 3. `actorRole` threading (queue → bot → orchestrator → history)

`auth.isGuest` is mapped to `actorRole` in `src/bot.ts` (`handleMessage`) and carried on `QueueItem`/`CoalescedItem` (`src/message-queue/types.ts`), copied through `flush()` (`src/message-queue/queue.ts`), passed from `processCoalescedMessage` into `processMessage` as a trailing `ProcessMessageRest` element (`src/llm-orchestrator-process-args.ts`), and read in `src/llm-orchestrator.ts` (defaulting to `'member'`). It flows into `InvocationSource`/`LlmInvocationOptions` (`src/llm-orchestrator-tools.ts`) and is forwarded into `appendAssistantTurnHistory` (`src/llm-history.ts`). Role is single-valued per coalesced turn (the queue force-flushes on user change), and is never re-derived downstream — the platform/group-admin signal (`msg.user.isAdmin`) is not persisted past auth, so re-deriving would misclassify admins as guests.

### 4. Read-only tool enforcement (`src/tools/index.ts`, `src/llm-orchestrator-tools.ts`)

`applyGuestReadOnlyFilter(tools)` keeps a tool iff `getToolMetadata(name)?.risk === 'read'`; write, destructive, open-world (`web_fetch`, all `mcp_*`/`plugin_*`), and unknown-metadata tools are dropped (fail-closed). In `buildFullToolSet`, the `prefTools` assignment branches on `actorRole === 'guest'` to call the filter instead of `applyToolPreferences`, so guests bypass per-context `tool_prefs` entirely — they never read or write the `tool_prefs` config key. The system prompt is already permission-aware and emits its "Unavailable tools" line for the dropped set, so no new prompt work was needed.

### 5. Memory exclusion (`src/long-term-memory/`, `src/llm-history.ts`)

`RunMemoryCaptureInput` gains an optional `actorRole`; `armMemoryCapture` (`src/long-term-memory/capture-debounce.ts`) early-returns when `actorRole === 'guest'`, so guest turns never schedule capture. The trim-triggered extraction path in `appendAssistantHistory` is skipped for guests. History read/write is untouched — guests still participate in the live thread. The promotion backstop only ever sees member-authored provisional records.

### 6. Membership-backstop + context-seeding guards

`shouldBackstopGroupMembership` (`src/llm-orchestrator-membership.ts`) returns `false` for guests, excluding them from any group-membership provisioning path. `src/chat/seed-context-assignment.ts` skips `ensureContextPlatformInstance` when `auth.isGuest === true`, so a guest's first message does not seed a platform-only `context_settings` row for the group.

### Settings UI / enabling

A group-section toggle drives the column. `GET`/`PATCH /settings/api/group/guest-mode` are handled in `src/debug/settings/group-routes.ts` (`handleGuestModeGet`/`handleGuestModePatch`), CSRF-verified (`X-Settings-CSRF`) and `requireScope`-validated (read for GET, write for PATCH), writing `setGuestMode`. The Svelte section `client/settings/sections/GuestModeSection.svelte` loads via `fetchGroupGuestMode` and toggles via `patchGroupGuestMode` (schemas in `client/settings/fetcher-schemas.ts`), rendered in the group block of `SettingsApp.svelte`.

## Consequences

### Positive

- Unrecognized users in an authorized group can use the bot read-only without any operator action beyond flipping the toggle; no per-user onboarding.
- Members and admins are byte-for-byte unchanged — the guest branch is pure addition, and the shared `tool_prefs`/descriptor cache is untouched by guest turns.
- Untrusted input never enters durable group memory; the capture/promotion pipeline only sees member-authored records.
- No `open-world` surface for guests means no per-user `web_fetch` quota abuse vector and no MCP/plugin exfiltration path.
- The membership backstop and context-seeding guards reinforce the "never provisioned" invariant at the provisioning layer, not just at auth.

### Negative

- **v1 abuse control is toggle-off only.** There is no per-guest block list; an abusive guest can only be stopped by disabling guest mode for the group or platform-level kick/ban. A per-group `guest_blocks` table is explicitly deferred.
- **`actorRole` threads through several modules.** Every new turn-level option must now consider whether it should differ for guests; the threading is a small ongoing maintenance cost.
- **Guests share the live thread with members.** A guest's messages are visible to the model and to members; there is no per-actor isolation within a thread (by design, but worth noting).
- **Read-only is not configurable per group.** A group cannot grant a guest `web_fetch` or a specific write tool; the filter is hardcoded. Future relaxation would require a new mechanism distinct from `tool_prefs`.

### Risks

- **Invariant regression.** Any future change that provisions a guest into `users`/`group_members` would let them match the member branch on their next message and silently gain full tools. The invariant is asserted by tests but is structural, not enforced by the type system.
- **Re-deriving role downstream.** Reconstructing `actorRole` from `msg.user.isAdmin` past auth would misclassify admins as guests. The contract is "thread from auth, never re-derive"; it is documented in `CLAUDE.md` and the plan's invariants but not statically checked.
- **Filter drift on new tools.** A new tool whose `getToolMetadata` is missing or mislabeled will be dropped for guests (fail-closed) — safe, but could surprise an operator who expects a new read tool to be available to guests.

## Related Decisions

- ADR-0018: Group Chat Support — the group auth gate this feature extends.
- ADR-0141: User-Configurable Tool Access — the per-context `tool_prefs` model guests bypass.
- ADR-0205: Admin Open-DM-Access — the per-instance provisioning model guest mode deliberately does **not** mirror.
- ADR-0193: Long-Term Memory — the capture/promotion pipeline guests are excluded from.

## Implementation Notes

Key files (confirmed present):

- Migration + schema: `src/db/migrations/059_guest_mode.ts`, `src/db/schema.ts` (`authorizedGroups.guestMode`), `src/db/index.ts` (registration).
- Store: `src/authorized-groups.ts` (`isGuestModeEnabled`, `setGuestMode`).
- Auth types: `src/chat/authorization-types.ts` (`ActorRole`, `AuthorizationResult.isGuest`), re-exported from `src/chat/types.ts`.
- Auth branch: `src/auth.ts` (`getGuestGroupAuth`, `getUnauthenticatedGroupAuth` guest branch).
- Queue threading: `src/message-queue/types.ts`, `src/message-queue/queue.ts`, `src/bot.ts` (`handleMessage`, `processCoalescedMessage`).
- Orchestrator: `src/llm-orchestrator-process-args.ts`, `src/llm-orchestrator.ts`, `src/llm-orchestrator-tools.ts` (`buildFullToolSet` guest branch).
- Enforcement: `src/tools/index.ts` (`applyGuestReadOnlyFilter`).
- Memory: `src/long-term-memory/capture.ts`, `src/long-term-memory/capture-debounce.ts` (`armMemoryCapture` guard), `src/llm-history.ts`.
- Provisioning guards: `src/llm-orchestrator-membership.ts` (`shouldBackstopGroupMembership`), `src/chat/seed-context-assignment.ts` (guest skip).
- Settings API: `src/debug/settings/group-routes.ts` (`handleGuestModeGet`/`handleGuestModePatch`, dispatch at `/settings/api/group/guest-mode`).
- Settings client: `client/settings/sections/GuestModeSection.svelte`, `client/settings/fetcher-schemas.ts` (`GroupGuestModeResponseSchema`), `client/settings/fetchers.ts` (`fetchGroupGuestMode`/`patchGroupGuestMode`), `client/settings/SettingsApp.svelte`.

Divergences from the plan worth recording:

- **Auth types module.** The plan specified adding `ActorRole`/`isGuest` to `src/chat/types.ts`. The implementation extracted them (plus `AuthorizationDenyReason`) into a new `src/chat/authorization-types.ts`, with `types.ts` re-exporting. Behavior is identical; only the location differs.
- **Membership backstop.** `src/llm-orchestrator-membership.ts` (`shouldBackstopGroupMembership`) was added to exclude guests from group-membership provisioning. It is referenced from `src/llm-orchestrator.ts` but was not enumerated in the plan's file list.
- **Context-seeding guard.** `src/chat/seed-context-assignment.ts` skips `ensureContextPlatformInstance` for guests; also not enumerated in the plan.
