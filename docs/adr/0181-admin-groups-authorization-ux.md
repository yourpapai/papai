<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0181: Admin Groups Authorization UX

## Status

Implemented

## Date

2026-06-04

## Context

A bot admin authorizes a group chat exclusively through the settings web UI **Admin → Groups** section (`AdminGroupsSection.svelte` → `POST /settings/api/admin/groups`). The field was a bare free-text **"Group ID"** input whose value was stored verbatim by `handleGroups` in `src/debug/settings/admin/system-access-routes.ts`. Every downstream consumer, however, expects the **scoped** context ID `pi:<b64url(platformInstanceId)>:ctx:<b64url(nativeGroupId)>`: the auth gate compares `isAuthorizedGroup(getGroupConfigContextId(contextId, platformInstanceId))` in `src/auth.ts`, and the bot-admin context-switcher fallback (`src/group-settings/access.ts` → `appendAuthorizedFallbackGroups`) only accepts rows where `isScopedContextId(groupId)` is true and the embedded platform instance matches.

So an admin who typed a raw chat/channel ID had it silently stored in a form that never matched — the group was never authorized and never appeared in the list. There was also no discovery surface: the bot already records every group it sees into `known_group_contexts` (via `recordGroupObservation`), but the settings UI offered no way to pick one of those observed groups.

The 2026-06-04 spec (`docs/superpowers/specs/2026-06-04-admin-groups-authorization-ux-design.md`) is the source of truth for the design: auto-scope raw IDs on POST and surface an observed-but-unauthorized pick-list on GET.

## Decision Drivers

- **Correctness of authorization**: an admin-supplied raw ID must reach the exact form every consumer compares against, or authorization silently fails.
- **Discovery from existing data**: the bot already tracks observed groups in `known_group_contexts`; admins should authorize one with a click instead of copy-pasting an ID from another surface.
- **Platform-instance scoping**: the observed pick-list must never leak groups from other platform instances; raw-ID auto-scoping must bind to the admin's own session instance.
- **Minimal blast radius**: reuse the existing reader/scope/observation infrastructure (`matchesAdminPlatformInstance`, `known_group_contexts`, `addAuthorizedGroup`); no schema migration, no change to the auth gate, observation recording, or the manageable-groups rule.
- **Manual-field parity**: keep the free-text field as an escape hatch for IDs the bot has not observed, and document the auto-scope behavior in place.

## Considered Options

### Option A: Auto-scope raw IDs + observed pick-list

- **Pros:** fixes both failure modes (silent un-scoped storage and no discovery); one-click authorize for observed groups; reuses `known_group_contexts` and the existing scope helpers; no DB migration.
- **Cons:** the observed list only reflects groups the bot has already seen; admins must still type for never-observed groups; a small client schema extension is required.

### Option B: Auto-scope raw IDs only (no pick-list)

- **Pros:** smallest possible change surface — just normalizes POST storage.
- **Cons:** admins still copy-paste from chat to discover IDs; leaves the `known_group_contexts` observation table unused from the admin surface; does not address the discovery goal.

### Option C: Validate-and-reject un-scoped IDs

- **Pros:** forces admins to paste the canonical scoped ID; trivial server-side check.
- **Cons:** hostile UX — the scoped ID is not surfaced anywhere for the admin to copy, so this is strictly worse than today; still no discovery.

## Decision

Implement Option A as five coordinated changes:

### 1. Platform-scoped reader — `listKnownGroupContextsForPlatform`

New function in `src/group-settings/admin-group-list.ts` selects all `known_group_contexts`, maps each row to `KnownGroupContext`, filters via the existing `matchesAdminPlatformInstance(group.contextId, platformInstanceId)` helper, and sorts by `displayName`. It deliberately omits the `group_admin_observations` inner-join that the sibling per-user reader `listAdminGroupContextsForUser` performs — every observed group on the admin's platform instance qualifies, regardless of who observed it.

### 2. POST auto-scopes raw IDs

In `handleGroups` (POST branch), `const raw = body.data.groupId.trim()`; empty → `422 { error: 'invalid request' }`. If `isScopedContextId(raw)` is true, `groupId = getConfigContextIdFromStorageContextId(raw)` (normalizes a thread-scoped storage id down to the bare group-level config-context id); otherwise `groupId = toScopedContextId({ platformInstanceId: authed.principal.platformInstanceId, nativeContextId: raw })`. Then `addAuthorizedGroup(groupId, authed.principal.platformUserId)`. DELETE is unchanged — it operates on the stored scoped ID the table already holds.

### 3. GET returns observed-but-unauthorized groups

`GET /settings/api/admin/groups` now returns `{ groups, observed }`. `groups` is the existing `listAuthorizedGroups()` output unchanged. `observed` is `listKnownGroupContextsForPlatform(authed.principal.platformInstanceId)` filtered to drop entries whose `contextId` is already authorized, each shaped `{ contextId, displayName, parentName }`. The implementation precomputes an `authorizedIds` Set from the authorized rows rather than calling `isAuthorizedGroup` per observed row — functionally equivalent and avoids N membership queries.

### 4. Client schema extension

`client/settings/fetcher-schemas.ts` exports `ObservedGroupSchema = z.object({ contextId: z.string(), displayName: z.string(), parentName: z.string().nullable().default(null) })` and extends `AdminGroupsResponseSchema` to `{ groups: z.array(AdminGroupRowSchema), observed: z.array(ObservedGroupSchema).default([]) }`. The `.default([])` keeps the existing `{ groups: [...] }`-only mock responses in older client tests valid.

### 5. UI pick-list + relabeled manual field

`AdminGroupsSection.svelte` renders an "Observed groups" block above the manual form, gated on `observed.length > 0`. Each row shows `displayName` (with `parentName` appended when present) and an Authorize button that posts `{ groupId: row.contextId }` through the existing `addAdminGroup` fetcher. The manual field is relabeled `Group ID or chat ID` and a help line reads "Raw chat IDs are scoped to your platform instance automatically." Both lists refresh on a successful add via the existing `load()`.

## Consequences

### Positive

- Raw chat IDs an admin pastes are now stored in the form every consumer compares against; the silent never-authorized failure mode is gone.
- The observed pick-list turns a copy-paste-from-chat workflow into a one-click authorize.
- Cross-instance observed groups are filtered out by `matchesAdminPlatformInstance`; admins only see their own instance's groups.
- No schema migration; reuses `known_group_contexts`, `matchesAdminPlatformInstance`, `addAuthorizedGroup`, and the existing settings HTTP plumbing.
- Backward compatible for admins who already paste fully-scoped IDs (stored unchanged modulo `:thread:` suffix stripping, which is the desired group-level normalization).

### Negative

- The observed list reflects bot presence only; a group the bot has never seen must still be typed into the manual field.
- An already-scoped ID pasted with a `:thread:` suffix is silently normalized to the group-level config id — the thread component is dropped. This is the desired behavior (authorization is group-level, not thread-level) but it is a silent normalization an admin could be surprised by.
- The pick-list row's `parentName` is always present in the API response (possibly `null`) rather than omitted when null as the design spec stated — a deliberate simplification for a stable shape, called out in the plan's Self-Review Notes.
- No removal or editing of `known_group_contexts` rows from the UI (YAGNI per spec); a stale observed row lingers until it ages out of the table by other means.

### Risks

- A scoped ID for **another** platform instance pasted manually is accepted as-is (stored verbatim), matching prior behavior. This could authorize a group the admin's instance can never see; out of scope and documented, not mitigated.
- Auto-scoping changes how previously-raw inputs are stored, so two pre-existing route tests were updated to expect the scoped value (the plan's Task 2 Step 5). No production caller other than this route writes `authorized_groups`.
- The observed pick-list's membership check relies on `known_group_contexts.contextId` and `authorized_groups.group_id` sharing the group-level config-context id format. If either ever drifts to carrying a thread suffix, a group could appear in both lists. Both columns are the group-level config-context id today, so this is consistent.

## Related Decisions

- **ADR-0136: Settings Web UI — Access Model** — the `requireAdmin` guard and the session `principal` (`platformInstanceId`/`platformUserId`) this route relies on.
- **ADR-0137: Settings Web UI — HTTP API** — the `/settings/api/admin/groups` route and the CSRF/principal plumbing extended here.
- **ADR-0138: Settings Web UI — Client SPA** — the `AdminGroupsSection.svelte` component and fetcher-schema patterns extended here.
- **ADR-0115: Readable Group And User Labels** — the `known_group_contexts` observation table and `KnownGroupContext` shape the new reader consumes.

## Implementation Notes

Key files, confirming presence:

- `src/group-settings/admin-group-list.ts:63` — `listKnownGroupContextsForPlatform(platformInstanceId: string): KnownGroupContext[]` (new; mirrors `listAdminGroupContextsForUser` minus the `group_admin_observations` join).
- `src/debug/settings/admin/system-access-routes.ts:156` — `handleGroups`. GET (lines 157–165) returns `{ groups, observed }`, with `observed` computed at lines 162–164 against a precomputed `authorizedIds` Set. POST (lines 179–186) trims, 422s on empty, auto-scopes raw IDs and normalizes thread-scoped pasted IDs via `getConfigContextIdFromStorageContextId`.
- `client/settings/fetcher-schemas.ts:268` — `ObservedGroupSchema` and the extended `AdminGroupsResponseSchema` with `observed: z.array(ObservedGroupSchema).default([])`; `ObservedGroup` type exported at line 277.
- `client/settings/sections/admin/AdminGroupsSection.svelte:113` — observed pick-list block; line 130 relabels the field to `Group ID or chat ID`; line 139 adds the "Raw chat IDs are scoped…" help line.
- Tests: `tests/group-settings/admin-group-list.test.ts` (new), `tests/debug/settings/admin/system-access-routes.test.ts`, `tests/client/settings/fetcher-schemas.test.ts`, `tests/client/settings/sections/admin/AdminGroupsSection.test.ts`.

Divergence from the spec, all confirmed in the shipped code:

- (a) POST normalizes a pasted scoped ID through `getConfigContextIdFromStorageContextId` rather than storing it literally as the spec's design §2 wrote. This strips a `:thread:` suffix so a thread-scoped storage id authorizes at the group level — a refinement, not a regression.
- (b) GET computes `observed` with a precomputed `authorizedIds` Set instead of `isAuthorizedGroup` per row (spec §3). Functionally equivalent.
- (c) `parentName` is always present, possibly `null`, rather than omitted when null (spec §3). Deliberate shape simplification for a stable client schema, called out in the plan's Self-Review Notes.
