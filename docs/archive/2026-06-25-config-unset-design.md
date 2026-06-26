<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Config Unset — Registry-Gated Generic Unset Path

**Date:** 2026-06-25
**Status:** Approved design, pending implementation plan

## Problem

There is no way to **unset** a configured value once it has been set. The gap was first
observed for **global (admin) plugin config**: the route
`PATCH /settings/api/admin/plugin-config` accepts only non-empty values
(`applyAdminPluginConfigUpdate` throws `bad-value` on an empty string), the store
(`setPluginAdminConfig`) is upsert-only, and no `deletePluginAdminConfig` primitive
exists. The same gap applies to **every context-scoped reserved key** (`timezone`,
`mcp_endpoints`, the `ai_*` settings, plugin-context config, provider credentials,
`tool_prefs`, `tool_context_flags`, admin tool defaults): each can be set or changed but
never cleared back to its default/baseline.

## Goal

A single reusable **unset** capability that works wherever unsetting is meaningful, gated
by the config-key registry so it can never touch keys that would break the bot.

## Boundary (what is and isn't unsettable)

Decided: **registry-gated safe set.**

| Tier                                      | Keys                                                                                                                                                                                            | Substrate         | Unsettable?                                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| A — declared `ConfigField`s (context)     | `timezone`, `mcp_endpoints`, `ai_tool_visibility`, `ai_reasoning_visibility`, `ai_output_detail_level`, `ai_live_status`, plugin-context (`plugin:<id>:<key>`), provider creds (Kaneo/YouTrack) | `user_config`     | ✅                                                                                                                       |
| B — system-reserved (context)             | `tool_prefs`, `tool_context_flags`, admin tool defaults (`__admin_tool_defaults__:<platformInstanceId>` → `tool_prefs`)                                                                         | `user_config`     | ✅                                                                                                                       |
| Admin plugin config                       | `plg:<id>:<key>`                                                                                                                                                                                | `system_config`   | ✅                                                                                                                       |
| **Excluded — operational secrets**        | central LLM creds (`llm_apikey`/`llm_baseurl`/`main_model`/…), `notify_token`, `stats_anonymity_salt`                                                                                           | `system_config`   | ❌ — not `ConfigField`s and have no config route; unset would leave the bot unconfigured / re-key stats / disable notify |
| **Excluded — separate credential stores** | BYOK (`byok_llm_credentials`), coding-credentials vault (`coding_session_credentials`)                                                                                                          | own tables/routes | ❌ — already have their own `enable`/`disable`/remove lifecycle; a second path would be redundant and could desync       |

The exclusion of operational secrets is mostly **automatic**: they are not `ConfigField`s
and are not served by any of the config routes touched here. The registry gate is the
explicit enforcement point for the context surface.

### Required-key behavior

Unsetting a **required** key is **allowed**. The eligibility system already reports
`config_missing` and hides the plugin's tools/prompt fragments for that context — i.e. the
post-unset state is identical to "never configured". The UI warns before unsetting a
required key.

## Architecture

### Insight that bounds the work

Every context-side reserved key (tiers A and B) is a row in **`user_config`**. They all
reduce to **one** store primitive. Admin plugin config (`plg:<id>:<key>`) is the only
**`system_config`** case. **Two primitives total.**

### 1. Store layer (2 primitives)

**Context (`user_config`):**

- `deleteConfigFromDb(userId, key)` in `src/cache-db.ts` — mirrors the existing
  `deleteInstructionFromDb` (delete row, log, swallow/log errors).
- `clearCachedConfig(userId, key)` in `src/cache.ts` — calls `deleteConfigFromDb`, sets the
  in-memory cache entry to `null` (so the next read returns `null` without a DB round-trip,
  and the absent-row reload path stays correct), emits `cache:sync` `{ field: 'config',
operation: 'unset' }`.
- `unsetConfigValue(contextId, key)` in `src/config.ts` — validates
  `isAllowedDynamicConfigKey(key)` (throws on invalid, mirroring `setConfigValue`), calls
  `clearCachedConfig`, then mirrors `setConfigValue`'s invalidation exactly via
  `clearToolCacheIfToolAssemblyConfig(contextId, key)`.

```ts
export function unsetConfigValue(contextId: string, key: string): void {
  if (!isAllowedDynamicConfigKey(key)) throw new Error(`Invalid config key: ${key}`)
  clearCachedConfig(contextId, key)
  clearToolCacheIfToolAssemblyConfig(contextId, key)
}
```

Plugin-context unset additionally goes through a thin `unsetPluginConfig(contextId,
pluginId, key)` in `config.ts` (mirrors `setPluginConfig`: `clearCachedConfig` of the
storage key + `clearCachedToolsByPrefix(contextId)`).

**Admin (`system_config`):**

- `deletePluginAdminConfig(pluginId, key)` in `src/plugins/store.ts` — `db.delete(systemConfig)`
  where `key = plg:<pluginId>:<key>`.

### 2. Registry gate (the boundary)

- Add `unsettable?: boolean` to the `ConfigField` type (`src/types/config.ts`). Declared
  fields are treated as **unsettable by default** (none of them are bot-breaking); the flag
  exists so a future non-unsettable `ConfigField` can opt out explicitly.
- Plugin-context and provider `ConfigField`s are generated in `config-keys.ts` — they inherit
  the unsettable default.
- For admin plugin config, the existing "declared admin requirement" check in
  `applyAdminPluginConfigUpdate` is the gate (unknown/non-admin key → `bad-key`); the unset
  branch reuses it.

### 3. Routes — discriminated `{ action: 'set' | 'unset' }`

`action` is **optional and defaults to `'set'`** so existing clients that omit it keep
working (back-compat). On `unset` the `value` field is not required.

| Route                                               | File                                                       | Covers                                                                                                        |
| --------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `PATCH /settings/api/config`                        | `config-routes.ts`                                         | **all** context `ConfigField`s in one change (timezone, mcp*endpoints, ai*\*, plugin-context, provider creds) |
| `PATCH /settings/api/admin/plugin-config`           | `admin-plugin-config.ts` + `admin/plugin-config-routes.ts` | admin plugin config (original ask)                                                                            |
| `PATCH /settings/api/plugins/config`                | `plugins-routes.ts`                                        | plugin-context unset (used by the plugin section UI)                                                          |
| `POST /settings/api/tools/toggle` (or unset branch) | `tools-routes.ts`                                          | `tool_prefs`                                                                                                  |
| admin feature-flags route                           | `admin/feature-flags-routes.ts`                            | `tool_context_flags`                                                                                          |
| admin tool-defaults route                           | `admin/tool-defaults-routes.ts`                            | admin tool defaults                                                                                           |

All routes:

1. authenticate + CSRF (writes) as today,
2. resolve write scope (`resolveContextScope` / `requireAdmin`),
3. validate the key is known **and unsettable** (registry gate; admin uses the declared-admin
   check),
4. delegate to the shared store primitive,
5. return `200 { ok: true }`. Unsetting an already-absent key is an **idempotent** `200`.

The B-tier routes are thin additions because they all delegate to `unsetConfigValue` /
`unsetPluginConfig`.

### 4. Client (full stack)

- **Fetchers** gain an `action` argument (or dedicated `unset*` wrappers) for: context config,
  plugin context config, admin plugin config, tool-defaults.
- **UI:** a **Clear** affordance next to any field where `hasValue === true`, in: the settings
  SPA config section, the settings SPA plugin section, and the admin UI plugin-config +
  tool-defaults sections. A confirm dialog precedes unset; for a **required** key the dialog
  warns that clearing it will make the plugin ineligible for the context.

## Data Flow (context unset)

```
UI Clear button (hasValue===true)
  -> confirm dialog (required-key warning if applicable)
  -> fetcher PATCH /settings/api/config { action:'unset', key, contextId? }
  -> route: auth + CSRF + resolveContextScope(write) + registry gate (field.unsettable)
  -> unsetConfigValue(contextId, storageKey)
       -> clearCachedConfig (delete user_config row, cache -> null, emit)
       -> clearToolCacheIfToolAssemblyConfig (rebuild tool descriptors if relevant)
  -> 200 { ok:true }
  -> next read returns null -> consumer applies its own default/baseline
```

Admin unset is the same shape against `system_config` via `deletePluginAdminConfig`, gated by
`requireAdmin('write')` + the declared-admin-key check.

## Error Handling

- Invalid/unknown key → `422` (`unknown config field` / `bad-key`).
- Non-unsettable key → `422` (registry gate). (No `ConfigField` is non-unsettable today, but
  the gate is enforced.)
- Missing scope / not authorized → existing `requireScope` / `requireAdmin` responses.
- Missing CSRF on write → existing `requireCsrf` response.
- Unset of an absent value → `200 { ok:true }` (idempotent; no error).
- Store-layer DB error → logged, surfaced as `500`.

## Testing

- **Store:** `clearCachedConfig` deletes the row and a subsequent `getCachedConfig` returns
  `null`; tool-assembly keys invalidate the descriptor cache; `unsetConfigValue` rejects an
  invalid key; `deletePluginAdminConfig` removes the `system_config` row.
- **Routes (each):** unset happy path; auth + CSRF + scope enforcement; registry gate rejects a
  non-unsettable key; **required-key unset succeeds and eligibility flips to `config_missing`**;
  idempotent no-op on an absent value; `action` omitted still behaves as `set`.
- **Client:** fetcher sends the discriminated body; the Clear button appears only when
  `hasValue`, fires the confirm dialog, and calls the fetcher (client suite,
  `tests/client/...`).

## Files Touched (anticipated)

- `src/cache-db.ts`, `src/cache.ts`, `src/config.ts` — store primitives.
- `src/plugins/store.ts` — `deletePluginAdminConfig`.
- `src/types/config.ts` — `unsettable` flag.
- `src/debug/admin-plugin-config.ts` — admin unset branch.
- `src/debug/settings/config-routes.ts`, `plugins-routes.ts`, `tools-routes.ts`,
  `admin/plugin-config-routes.ts`, `admin/feature-flags-routes.ts`,
  `admin/tool-defaults-routes.ts` — discriminated action.
- `client/settings/fetchers.ts`, `client/settings/admin-fetchers.ts` + corresponding Svelte
  sections, `client/admin/...` — fetchers + Clear UI.
- Tests alongside each.

## Out of Scope / Deferred

- Unsetting central LLM creds, `notify_token`, `stats_anonymity_salt` (operational secrets).
- BYOK and coding-credentials vault removal (own lifecycle).
- Bulk "reset all config for this context" (single-key unset only).

```

```
