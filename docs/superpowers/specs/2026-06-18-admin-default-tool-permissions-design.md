<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Admin Default Tool Permissions — Design

**Date:** 2026-06-18
**Status:** Approved (pending implementation plan)

## Summary

Let a bot admin define a **default tool-permission configuration** (the same
`tool_prefs` shape used per-context: presets + per-domain + per-tool `allow/ask/deny`)
that is **seeded into a context's own `tool_prefs` the first time that context's toolset
is built** with no prefs of its own. This sets the starting posture for new users and
new groups without locking them in: once seeded, the context owns its prefs, and a later
admin change does **not** override a context that already exists or that the user has
since customized.

The default is **global across both DM and group contexts** of a platform instance.
Where no admin default is configured, today's implicit `allow-all` baseline is preserved
exactly.

## Background — current system

- **Model** (`src/tools/tool-preferences.ts`): `tool_prefs` is JSON
  `{ riskDefaults?, domainDefaults, toolOverrides }` with three-state `allow | ask | deny`.
  Resolution (`resolveToolPermission`): `toolOverrides[name]` → `domainDefaults[domain]`
  → `riskDefaults[risk]` → implicit `allow`. Presets (`applyPreset`,
  `PRESET_RISK_DEFAULTS`, `detectActivePreset`) write only `riskDefaults` and clear the
  other layers.
- **Storage**: per-context JSON in `user_config (user_id, key, value)` under key
  `tool_prefs`, where `user_id` is the **scoped context id** (`pi:<b64url-instanceId>:ctx:<…>`,
  parsed/built in `src/chat/scoped-context.ts`). Accessed via `getToolPrefs(contextId)` /
  `setToolPrefs(contextId, prefs)` (write-through cache in `src/cache.ts`). For groups,
  `tool_prefs` is a **parent-shared** key (migration `046`, `PARENT_SHARED_USER_CONFIG_KEYS`),
  i.e. stored at the non-thread parent context and inherited by threads.
- **Application** (`src/tools/index.ts`): `applyToolPreferences` is the final step of
  `makeTools()` — reads the context's prefs, drops `deny`, wraps `ask`. A context with no
  row gets `emptyPrefs()` → everything `allow`.
- **No global default exists today**: resolution reads exactly one `user_config` row;
  `system_config` holds only LLM creds; `ADMIN_SYSTEM_CONTEXT_ID = '__system__'` is a
  scope-guard sentinel never fed into tool-pref resolution.
- **Admin UI**: the per-context Tools section (`ToolsSection.svelte`) is backed by
  `GET /settings/api/tools` + `POST /settings/api/tools/toggle`
  (`src/debug/settings/tools-routes.ts`), which build a domain-grouped view via the
  shared response builder and persist via `setToolPrefs`.

## Goals

- A bot admin configures one default `tool_prefs` per platform instance, using the same
  UI affordances as the per-context Tools section (presets + per-domain/per-tool).
- The default is **seeded once** into a context (DM or group) the first time its toolset
  is built with no stored `tool_prefs` — making it that context's own prefs.
- A user who later customizes is never overridden; a later admin edit never retroactively
  changes already-seeded contexts. (Seed-on-first-access, **not** a live fallback layer.)
- No admin default configured ⇒ behavior is byte-for-byte today's `allow-all` baseline.

## Non-goals

- **No live/retroactive cascade.** The admin default is a seed, not a resolution tier;
  `resolveToolPermission` is unchanged.
- No per-user or per-group admin overrides beyond the single instance default.
- No reconciliation/migration of existing contexts — only contexts whose first toolset
  build happens after a default is set get seeded. (Existing contexts keep their current
  prefs, including the implicit empty/allow-all.)

## Design

### Where the admin default is stored

Reuse the existing `tool_prefs` machinery against a **reserved per-instance context id**:

```
__admin_tool_defaults__:<platformInstanceId>
```

The `__…__:` form cannot collide with real scoped ids (`pi:…:ctx:…`) and mirrors the
existing `__system__` sentinel convention. Reads/writes go through the normal
`getToolPrefs` / `setToolPrefs`, so serialization, pruning, and caching are unchanged.
An **empty** result (no row) means "no admin default" → no seeding.

A small helper centralizes the key and parsing:

```ts
// src/tools/admin-tool-defaults.ts
export function adminToolDefaultsContextId(platformInstanceId: string): string
export function getAdminToolDefaults(platformInstanceId: string): Promise<ToolPrefs | null>
//   → null when the stored prefs are empty (emptyPrefs)
```

### Seeding hook (`makeTools` / `applyToolPreferences`)

`makeTools()` already receives `storageContextId`, `contextType` (`dm`/`group`), and
`mode`, and can derive `platformInstanceId` by parsing the scoped context id
(`src/chat/scoped-context.ts`). The seed runs as a **pre-step to `applyToolPreferences`**:

1. Resolve the context's stored `tool_prefs` (the read it already does).
2. If **and only if** the stored prefs are absent/empty **and** the context is a real
   user/group context (not the `__admin_tool_defaults__` sentinel, not a synthetic/proactive
   context without a storage id) **and** `getAdminToolDefaults(platformInstanceId)` returns
   non-null → `setToolPrefs(contextId, adminDefault)` once, then continue with that value.
3. Otherwise behave exactly as today (empty → allow-all, or the existing stored prefs).

Properties:

- **Once-only** is guaranteed by the row-existence guard — after the first build the
  context has its own row, so later builds (and later admin edits) never re-seed.
- **Global (DM + group)** — no `contextType` restriction on seeding; groups write through
  the parent-shared `tool_prefs` path automatically via `setToolPrefs`.
- **Cross-platform-safe** — seeding triggers when the real context first exists (first
  message → first toolset build), so it does not depend on knowing a DM channel id ahead
  of time (Telegram/Mattermost DM ids are unknown until first message).
- **Concurrency** — first-build seeding is idempotent: a redundant write of the same
  default is harmless; the write-through cache + `INSERT … ON CONFLICT`/upsert semantics
  of `setToolPrefs` make a race converge to the same value.

> Guard against self-seeding: the admin-default context id is itself read via
> `getToolPrefs`, but it is **never** a `makeTools` target, so no special-casing is needed
> beyond not treating it as a seedable context.

### Admin API

A new bot-admin-scoped route mirroring the per-context tools route but bound to the
instance's admin-default context (the client never supplies the context id):

- `GET /settings/api/admin/tool-defaults` → the same domain-grouped view the per-context
  Tools section uses, built via the shared response builder against
  `adminToolDefaultsContextId(principal.platformInstanceId)`, including `activePreset`.
- `POST /settings/api/admin/tool-defaults` — same discriminated-union body as
  `/settings/api/tools/toggle` (`kind: 'domain' | 'tool' | 'preset'`) **minus** any
  caller-supplied `contextId`; the server derives the admin-default context. Applies
  `setDomainPermission` / `setToolPermission` / `applyPreset`, persists via `setToolPrefs`,
  returns the recomputed view.

Both enforce bot-admin scope + `X-Settings-CSRF`. Implemented in
`src/debug/settings/admin/tool-defaults-routes.ts`, reusing the existing builder/toggle
helpers from `tools-routes.ts` (extract the shared builder if not already exported).

### Admin UI

New admin section **"Default tool permissions"**
(`client/settings/sections/admin/AdminToolDefaultsSection.svelte`), registered in the
Admin zone of `SettingsApp.svelte` under the bot-admin gate. It renders the **same**
presets + per-domain/per-tool controls as the per-context Tools section — ideally by
reusing `ToolsSection`'s inner presentation with a different fetcher target
(`admin-fetchers.ts`: `fetchToolDefaults()` / `setToolDefault()` against the admin route),
or a thin wrapper if `ToolsSection` is not cleanly parameterizable. A help line explains:
"Seeds the starting tool permissions for new users and groups. Existing users keep their
own settings."

### Interaction with open-access (Spec 1)

When open DM access auto-provisions a user, that user's first DM builds their toolset and
the seed fires — so open-access users start from the admin default automatically. No extra
coupling code: the seed is in the toolset-build path that every authorized context hits.

## Testing

- **`admin-tool-defaults.test.ts`**
  - `adminToolDefaultsContextId` shape; `getAdminToolDefaults` returns `null` for empty
    prefs and the parsed `ToolPrefs` otherwise.
- **Seeding (`tools` / `makeTools` suite)**
  - Context with no prefs + admin default set → after first build, the context's stored
    `tool_prefs` equals the admin default; resolved permissions match.
  - Second build after the user customizes one tool → user value preserved; default not
    re-applied.
  - Admin edits the default afterward → an already-seeded context is unchanged.
  - **No admin default** → context stays empty/allow-all (reference-identical to today).
  - Group context seeds through the parent-shared `tool_prefs` path; threads inherit.
  - The `__admin_tool_defaults__` context is never itself seeded/recursed.
- **Route tests (`tool-defaults-routes.test.ts`)**
  - GET/POST bot-admin scope + CSRF; `preset`/`domain`/`tool` kinds mutate the admin
    context; non-admin → 401/403.
- **Client (`tests/client/...AdminToolDefaultsSection`)**
  - Renders presets + controls; posts to the admin route; reflects `activePreset`.

## Files touched

- `src/tools/admin-tool-defaults.ts` — context-id helper + `getAdminToolDefaults`.
- `src/tools/index.ts` — seed pre-step in `makeTools`/`applyToolPreferences`.
- `src/debug/settings/admin/tool-defaults-routes.ts` — admin GET/POST.
- `src/debug/settings/tools-routes.ts` — export shared builder/toggle helpers if needed.
- `client/settings/sections/admin/AdminToolDefaultsSection.svelte` — admin section.
- `client/settings/SettingsApp.svelte` — register the section under the bot-admin gate.
- `client/settings/admin-fetchers.ts`, `client/settings/fetcher-schemas.ts` — fetchers/schemas.
- `CLAUDE.md` — document the admin default + seed-on-first-access semantics.
- Tests as above.
