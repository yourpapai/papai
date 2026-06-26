<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0204: Admin Default Tool Permissions

## Status

Implemented

## Date

2026-06-18

## Context

`tool_prefs` (`{ riskDefaults, domainDefaults, toolOverrides }` with three-state
`allow | ask | deny`, resolved most-specific-wins in `resolveToolPermission`) is the
per-context knob that governs which tools an LLM turn sees — `deny` is dropped, `ask` is
wrapped behind a per-call permission gate, `allow` passes through. A platform instance,
once deployed, can serve arbitrarily many DM and group contexts, each of which starts with
no `tool_prefs` row and therefore the implicit `allow-all` baseline. An operator who wants a
saner starting posture (e.g. a `read-only` preset, or denying the `web` domain) had no lever
short of editing every context's Tools section individually — and Telegram/Mattermost DM
context ids are not even knowable until the user's first message, so pre-seeding was
impractical.

The 2026-06-18 design (`docs/superpowers/specs/2026-06-18-admin-default-tool-permissions-design.md`,
now archived) specified a **per-platform-instance default** `tool_prefs` that is **seeded
once** into a context's own prefs the first time that context's toolset is built with no
stored prefs, and never overrides a context that already exists or that the user has since
customized. This sets the starting posture for new users and groups without locking them in,
and preserves today's `allow-all` baseline byte-for-byte wherever no admin default is set.
Open-DM-access auto-provisioned users inherit the default on their first turn with no extra
coupling, because the seed lives in the toolset-build path every authorized context hits.

## Decision Drivers

- **Operator default at scale**: a new platform instance's contexts should start from a sane
  baseline without per-context admin work.
- **User sovereignty**: once seeded, the context owns its prefs; a later admin edit must never
  retroactively override an already-seeded or user-customized context.
- **No regression when unset**: with no admin default, behavior must be byte-identical to the
  existing `allow-all` baseline (no new resolution tier, no surprise).
- **Reuse**: the admin default must reuse the existing `tool_prefs` storage, serialization,
  cache, and the per-context Tools UI affordances (presets + per-domain/per-tool), not fork a
  parallel config surface.
- **Provider independence**: the default applies across all providers of an instance, so the
  editable name list is the **static** `TOOL_METADATA` catalog; dynamic MCP/plugin tools are
  covered by the `open-world` risk tier via presets, not per-row.
- **Cross-platform safety**: seeding must not depend on knowing a DM channel id ahead of time
  (Telegram/Mattermost DM ids are unknown until first message).

## Considered Options

### Option 1: Reserved per-instance context id + seed-on-first-build (chosen)

Store the admin default as a normal `tool_prefs` row under
`__admin_tool_defaults__:<platformInstanceId>`; seed it into a real context's own prefs the
first time `applyToolPreferences` runs with no stored row.

- **Pros:** reuses all existing storage/cache/serialization/UI helpers; idempotent and
  concurrency-safe (row-presence guard + upsert of the same value); seed is a one-time copy,
  so `resolveToolPermission` is unchanged; the `__…__:` sentinel cannot collide with scoped ids.
- **Cons:** introduces a reserved namespace convention; existing pre-default contexts never
  receive the default (non-goal, but an operator-visible gap).

### Option 2: Live fallback tier in `resolveToolPermission`

Make resolution consult the admin default when a context has no own prefs, every turn.

- **Pros:** retroactive — every context reflects the current admin default immediately.
- **Cons:** breaks user sovereignty (an "empty/allow-all" context silently follows admin
  changes forever); adds a resolution tier and a cross-instance lookup on every toolset
  build; hard to distinguish "user wants allow-all" from "user hasn't configured".

### Option 3: A `system_config` key / separate table

Store the default outside `tool_prefs` (e.g. a `system_config` JSON blob or a dedicated
table).

- **Pros:** keeps `user_config` purely per-context.
- **Cons:** forks serialization/pruning/cache and the UI helpers; the static catalog view
  builder would need a parallel path; loses the parent-shared inheritance and write-through
  cache for free.

## Decision

Six coordinated changes implement the architecture (Option 1):

### 1. Reserved sentinel context id

The admin default is a normal `ToolPrefs` blob stored under
`__admin_tool_defaults__:<platformInstanceId>` (mirrors the existing `__system__` sentinel
convention; the `__…__:` form cannot collide with real scoped ids `pi:…:ctx:…`). Reads and
writes go through the ordinary `getToolPrefs`/`setToolPrefs` (`src/tools/tool-preferences.ts`),
so serialization, pruning, and the write-through cache are unchanged. An **empty** stored
prefs is treated as "no admin default" (no seeding).

### 2. `src/tools/admin-tool-defaults.ts` (helpers)

- `adminToolDefaultsContextId(platformInstanceId)` → the sentinel.
- `getAdminToolDefaults(platformInstanceId)` → `ToolPrefs | null` (`null` when stored prefs
  are empty / allow-all).
- `maybeSeedAdminToolDefaults(prefsContextId)` — no-op for (a) the sentinel context itself
  (no self-seeding), (b) a non-scoped context id (`parseScopedContextId` returns null), (c)
  a context that already has a stored row, or (d) an instance with no admin default;
  otherwise `setToolPrefs(prefsContextId, adminDefault)` once.

### 3. Seed hook in `applyToolPreferences` (`src/tools/index.ts`)

`maybeSeedAdminToolDefaults(prefsContextId)` is called **before** `getToolPrefs(prefsContextId)`
in `applyToolPreferences` — the single chokepoint every toolset build passes through. This is
a **seed**, not a resolution tier: `resolveToolPermission` is unchanged. Once-only is
guaranteed by the row-existence guard; global DM+group (no `contextType` restriction; groups
write through the parent-shared `tool_prefs` path automatically); cross-platform-safe (fires
at first toolset build, not ahead of DM id discovery); race-safe (idempotent upsert of the
same default).

### 4. `hasStoredToolPrefs` presence check (`src/tools/tool-preferences.ts`)

`getToolPrefs` returns `emptyPrefs()` for both an absent row and an empty/allow-all row, so a
`getCachedConfig(contextId, key) !== null` presence check distinguishes "no row" from "empty
prefs" — the gate that keeps seeding from re-firing on allow-all contexts.

### 5. Admin GET/POST route (`src/debug/settings/admin/tool-defaults-routes.ts`)

`GET/POST /settings/api/admin/tool-defaults`, bot-admin scope + `X-Settings-CSRF`, registered
in `src/debug/settings-api-router.ts`. The editable name list is the static
`Object.keys(TOOL_METADATA)` catalog (provider-independent). It reuses the now-exported
`buildDomainView`/`setDomainPermission`/`setToolPermission` from `src/debug/settings/tools-routes.ts`
and `applyPreset`/`detectActivePreset`/`getToolPrefs`/`setToolPrefs` from `tool-preferences.ts`,
so the admin UI is byte-identical to the per-context Tools UI. The server derives the
sentinel from `principal.platformInstanceId`; the client never supplies a context id. The
response (`{ contextId, domains, activePreset }`) parses against the existing
`ToolsResponseSchema` unchanged.

### 6. Admin UI reuse (`client/settings/`)

`ToolsSection.svelte` is parameterized with optional `sectionId`/`eyebrow`/`title` and
`fetchToolsFn`/`setToolPermissionFn`/`applyToolPresetFn` props (defaults preserve current
behavior, so the existing ToolsSection test stays green). `AdminToolDefaultsSection.svelte`
is a thin wrapper passing admin fetchers (`fetchToolDefaults`/`setToolDefault`/
`applyToolDefaultPreset` in `admin-fetchers.ts`) and is mounted under the bot-admin gate in
`SettingsApp.svelte`.

## Consequences

### Positive

- New DM and group contexts of an instance start from the admin's chosen posture
  automatically, with no per-context seeding work and no coupling to DM-channel-id discovery.
- User customization is sovereign: a later admin edit never overrides an already-seeded or
  user-customized context.
- No admin default (or an allow-all default) preserves the implicit `allow-all` baseline
  byte-for-byte — no regression, no new resolution tier.
- Reuses `tool_prefs` storage, serialization, cache, and the Tools UI affordances; one
  settings UI section; the static catalog keeps the route provider-independent.
- Open-DM-access users inherit the default on their first turn with no extra code path.

### Negative

- Existing pre-default contexts never receive the default (non-goal, but an operator-visible
  gap if a default is set after deployment).
- A later admin default change does **not** propagate to already-seeded contexts; operators
  must communicate that the default is a seed, not a live policy.
- The admin default covers only the static catalog; dynamic MCP/plugin tools rely on the
  `open-world` risk tier via presets, not per-row overrides.

### Risks

- **Sentinel namespace collision** — mitigated by the `__…__:` form that cannot collide with
  scoped ids, `parseScopedContextId` returning null for it, and `maybeSeedAdminToolDefaults`
  short-circuiting on the prefix.
- **Race on first build** — two concurrent first builds could both call `setToolPrefs`; the
  upsert semantics of `setToolPrefs` converge to the same default value, so the race is
  harmless and idempotent.
- **"Seed vs live" operator confusion** — mitigated by the help line in the admin section,
  the `CLAUDE.md` note, and the route returning `hasStoredDefaults` with `activePreset: null`
  when unconfigured (vs. a real preset value when configured).

## Related Decisions

- ADR-0141: User-Configurable Tool Access — the per-context `tool_prefs` model (three-state
  permissions, most-specific-wins resolution, `tool_prefs` config key) this default builds on.
- ADR-0203: Tool Permission Presets — the risk-tier presets (`read-only`/`non-destructive`/
  `allow-all`) reused by the admin default route via `applyPreset`/`detectActivePreset`.
- Config-unset/Clear convention — the shipped route also accepts `{ kind: 'unset' }` via
  `clearToolPrefs` and the client surfaces `unsetToolDefaults`/`clearPresetFn`, matching the
  repo-wide `{action:'unset'}`/`{kind:'unset'}` pattern (no dedicated ADR yet).

## Implementation Notes

The implementation matches the plan/spec, with one post-plan extension. Confirming presence:

- `src/tools/admin-tool-defaults.ts` — `adminToolDefaultsContextId` (line 15),
  `getAdminToolDefaults` (line 32), `maybeSeedAdminToolDefaults` (line 42). ✓
- `src/tools/tool-preferences.ts` — `hasStoredToolPrefs` presence check; `getToolPrefs`/
  `setToolPrefs`/`clearToolPrefs`/`applyPreset`/`detectActivePreset` reused. ✓
- `src/tools/index.ts` — `import { maybeSeedAdminToolDefaults }` (line 16); seed call at
  line 33 inside `applyToolPreferences`, before `getToolPrefs(prefsContextId)`. ✓
- `src/debug/settings/admin/tool-defaults-routes.ts` — `handleAdminToolDefaultsRoutes`
  (line 85); GET/POST over `Object.keys(TOOL_METADATA)`; bot-admin scope (`requireAdmin`) +
  `requireCsrf`; reuses exported `buildDomainView`/`setDomainPermission`/`setToolPermission`
  from `src/debug/settings/tools-routes.ts`. ✓
- `client/settings/sections/admin/AdminToolDefaultsSection.svelte` — thin wrapper over the
  parameterized `ToolsSection.svelte`, passing `fetchToolDefaults`/`setToolDefault`/
  `applyToolDefaultPreset`. ✓
- `client/settings/admin-fetchers.ts` — `fetchToolDefaults` (line 186), `setToolDefault`
  (line 189), `applyToolDefaultPreset` (line 196). ✓
- `client/settings/SettingsApp.svelte` — import (line 41) and mount (line 232) under the
  bot-admin gate. ✓

**Divergence from plan/spec (extension):** the shipped route adds a `{ kind: 'unset' }`
schema branch (line 32) backed by `clearToolPrefs`, reports `hasStoredDefaults` and returns
`activePreset: null` when unconfigured (vs. `detectActivePreset` of `emptyPrefs`), and the
client adds `unsetToolDefaults` (line 201) wired through a `clearPresetFn` prop on
`AdminToolDefaultsSection`. These are beyond the original plan/spec and align with the
repo-wide config-unset convention; they do not change the seed-on-first-build semantics.
`CLAUDE.md` documents the feature under the Tools section.
