<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0220: Config Unset — Registry-Gated Clear

## Status

Implemented

## Date

2026-06-25

## Context

Before this work, a configured value could be set or changed but never cleared back to its default/baseline. The gap was first observed for **global (admin) plugin config**: the route `PATCH /settings/api/admin/plugin-config` accepted only non-empty values (`applyAdminPluginConfigUpdate` throws `bad-value` on an empty string), the store (`setPluginAdminConfig`) was upsert-only, and no delete primitive existed. The same gap propagated to **every context-scoped reserved key** in `user_config` — `timezone`, `mcp_endpoints`, the `ai_*` output settings, plugin-context config, provider credentials, `tool_prefs`, `tool_context_flags`, and admin tool defaults — each settable but never clearable. The only workaround was overwriting the value, which left a stale row and never restored the "never configured" baseline.

The 2026-06-25 spec (`docs/superpowers/specs/2026-06-25-config-unset-design.md`, now archived) defined a single reusable **unset** capability that works wherever unsetting is meaningful, gated by the config-key registry so it can never touch keys that would break the bot (operational secrets such as central LLM creds, `notify_token`, `stats_anonymity_salt`; separate credential stores such as BYOK and the coding-credentials vault, which already have their own enable/disable lifecycle). The plan (`docs/superpowers/plans/2026-06-25-config-unset.md`, now archived) decomposed the work into 16 tasks across five phases.

A key insight bounds the implementation: every context-side reserved key is a row in **`user_config`**, so they all reduce to **one** store primitive. Admin plugin config (`plg:<id>:<key>`) is the only **`system_config`** case — two primitives total.

## Decision Drivers

- **Reversibility**: a configured value must be clearable to its default/baseline, not just overwritable; "never configured" must be a reachable state (e.g. so a required plugin key flips eligibility back to `config_missing`).
- **Safety by construction**: unsetting a bot-breaking key (operational secret, BYOK vault) must be impossible through these routes, not merely discouraged — the registry is the explicit enforcement point.
- **Backward compatibility**: existing PATCH clients that omit the new `action` field must keep behaving as `set`; no client breakage on deploy.
- **Consistency**: the same unset primitive and the same route discriminated-action shape should cover all six affected routes, rather than six bespoke endpoints.
- **Tool-cache correctness**: unsetting a tool-assembly key (`tool_prefs`, `tool_context_flags`, plugin-context config) must invalidate the descriptor cache exactly as the set path does, so the next turn rebuilds the toolset against the baseline.

## Considered Options

### Option A: Discriminated `{ action: 'set' | 'unset' }` on existing routes (chosen)

Add an optional `action` discriminator to each existing PATCH/POST route; default `'set'` for back-compat; `unset` drops the `value` requirement and delegates to a shared store primitive.

- **Pros:** single route per surface; existing clients unchanged; one Zod union per route; idempotent `200` on an absent value; registry gate reused as the enforcement point.
- **Cons:** each route handler gains an early-return unset branch; the discriminated union must be ordered so the optional-`action` set branch still parses a body with no `action` field.

### Option B: Dedicated `DELETE`-verb endpoints

Add `DELETE /settings/api/config`, `DELETE /settings/api/plugins/config`, etc., each clearing one key.

- **Pros:** clean REST semantics; no overload on PATCH.
- **Cons:** doubles the route surface (six new handlers + CSRF + scope plumbing each); breaks the Svelte SPA's `writeJson` helper, which is PATCH/POST-centric; forces a new fetcher per surface rather than an `action` param. Rejected as higher cost for no safety gain.

### Option C: Empty-string sentinel on the existing set body

Treat `value: ''` as "clear" in the set handler.

- **Pros:** no schema change.
- **Cons:** ambiguous for fields whose valid value is an empty string (none today, but a future `ConfigField` cannot opt in); collides with the admin plugin config `bad-value` empty-string rejection; silently loses the explicit "I want the default" intent. Rejected as fragile and intent-erasing.

## Decision

### 1. Two store primitives (the bound on the work)

**Context (`user_config`):**

- `deleteConfigFromDb(userId, key)` in `src/cache-db.ts` — mirrors `deleteInstructionFromDb`: `db.delete(userConfig).where(...)` inside a `queueMicrotask`, swallows and logs errors.
- `clearCachedConfig(userId, key)` in `src/cache.ts` — calls `deleteConfigFromDb`, sets the in-memory cache entry to `null` (so the next read returns `null` without a DB round-trip, keeping the absent-row reload path correct), emits `cache:sync` `{ field: 'config', operation: 'unset' }`.
- `unsetConfigValue(contextId, key)` in `src/config.ts` — validates `isAllowedDynamicConfigKey(key)` (throws on invalid, mirroring `setConfigValue`), calls `clearCachedConfig`, then mirrors `setConfigValue`'s invalidation via `clearToolCacheIfToolAssemblyConfig(contextId, key)`.
- `unsetPluginConfig(contextId, pluginId, key)` in `src/config.ts` — thin wrapper over `clearCachedConfig` of the plugin storage key + `clearCachedToolsByPrefix(contextId)`.
- `clearToolPrefs(contextId)` in `src/tools/tool-preferences.ts` — `clearCachedConfig` of `TOOL_PREFS_CONFIG_KEY` + `clearCachedToolsByPrefix(contextId)`.

**Admin (`system_config`):**

- `deletePluginAdminConfig(pluginId, key)` in `src/plugins/store.ts` — `db.delete(systemConfig).where(eq(systemConfig.key, pluginAdminConfigKey(pluginId, key)))`.

### 2. Registry gate (the boundary)

`src/types/config.ts` gains an optional `unsettable?: boolean` on `ConfigField` and an `isFieldUnsettable(field)` helper that returns `field.unsettable !== false` — declared fields are **unsettable by default** (none are bot-breaking); the flag exists so a future non-unsettable `ConfigField` opts out explicitly. The context config route checks `isFieldUnsettable(field)` and returns `422 { error: 'field cannot be unset' }` on a non-unsettable field. Plugin-context and provider `ConfigField`s are generated in `config-keys.ts` and inherit the default. Admin plugin config reuses its existing "declared admin requirement" check (unknown/non-admin key → `bad-key`) as the gate. Operational secrets and separate credential stores are excluded automatically — they are not `ConfigField`s and have no config route here.

### 3. Routes — discriminated `{ action: 'set' | 'unset' }` (and `{ kind: 'unset' }`)

`action` is **optional and defaults to `'set'`** so existing clients keep working; on `unset`, `value` is not required. Six routes gain the discriminator:

| Route                                     | File                                                                                    | Body shape                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `PATCH /settings/api/config`              | `src/debug/settings/config-routes.ts`                                                   | `z.union([UnsetBodySchema, SetBodySchema])` on `action`             |
| `PATCH /settings/api/plugins/config`      | `src/debug/settings/plugins-routes.ts`                                                  | `z.union([UnsetBodySchema, SetBodySchema])` on `action`             |
| `PATCH /settings/api/admin/plugin-config` | `src/debug/admin-plugin-config.ts` + `src/debug/settings/admin/plugin-config-routes.ts` | `applyAdminPluginConfigUnset` dispatched on `action === 'unset'`    |
| `POST /settings/api/tools/toggle`         | `src/debug/settings/tools-routes.ts`                                                    | `z.literal('unset')` added to `z.discriminatedUnion('kind', [...])` |
| admin tool-defaults route                 | `src/debug/settings/admin/tool-defaults-routes.ts`                                      | `z.literal('unset')` added to `ToggleBodySchema`                    |
| admin feature-flags route                 | `src/debug/settings/admin/feature-flags-routes.ts` + `src/debug/admin-feature-flags.ts` | `z.union([{contextId, flags}, {contextId, action:'unset'}])`        |

Every route follows the same flow: (1) authenticate + CSRF, (2) resolve write scope (`resolveContextScope` / `requireAdmin`), (3) validate the key is known **and unsettable** (registry gate; admin uses the declared-admin check), (4) delegate to the shared store primitive, (5) return `200 { ok: true }`. Unsetting an already-absent key is an **idempotent** `200`. The B-tier routes are thin: `tool_prefs` and admin tool defaults call `clearToolPrefs`; `tool_context_flags` calls `unsetConfigValue(contextId, REDUCTION_FLAGS_CONFIG_KEY)`.

### 4. Client (full stack)

- **Fetchers** (`client/settings/fetchers.ts`, `client/settings/admin-fetchers.ts`): `unsetConfigField`, `unsetPluginConfig`, `unsetAdminPluginConfig`, `unsetToolDefaults` — each POSTs/PATCHes the discriminated body.
- **UI Clear affordance**: a Clear control next to any field where `hasValue === true`, in `ConfigFieldRow.svelte` (config), `PluginsSection.svelte` (plugin context), `AdminPluginsConfigSection.svelte` (admin plugin config), and `AdminToolDefaultsSection.svelte` (admin tool defaults). A confirm dialog precedes unset; for a **required** key the dialog warns that clearing it makes the plugin ineligible for the context.

## Consequences

### Positive

- Any declared `ConfigField` and all system-reserved context keys can now be cleared to baseline in one consistent shape across six routes.
- Required-key unset is allowed and produces the same post-state as "never configured" — eligibility flips to `config_missing`, hiding the plugin's tools/prompt fragments for that context, with no special server logic beyond the existing eligibility check.
- The registry gate (`unsettable` flag + declared-admin-key check) makes it structurally impossible to unset operational secrets or separate credential stores through these routes.
- Existing PATCH clients that omit `action` are unchanged — the discriminator defaults to `'set'`, so the deploy is non-breaking.
- Tool-cache invalidation on unset mirrors the set path, so the next turn rebuilds tool descriptors against the baseline rather than a stale cached toolset.

### Negative

- Each of the six route handlers gains an early-return unset branch, slightly increasing per-handler complexity; the discriminated unions must be ordered so the optional-`action` set branch still parses a body with no `action` field.
- The Svelte Clear affordance is added per surface (four components), each with its own confirm dialog wiring; there is no shared "Clear button" component, so the confirm copy and required-key warning are duplicated.
- No `ConfigField` is non-unsettable today, so the `unsettable: false` opt-out path is exercised only by the unit test, not in production — the gate is defensive.

### Risks

- **Discriminator ordering.** If the `SetBodySchema` (with `action: z.literal('set').optional()`) were listed before `UnsetBodySchema` in the `z.union`, a body `{ action: 'unset', key }` could match the set branch (where `action` is optional) and then fail on the missing `value`. The implementations order unset first; a future edit that reorders the union could silently break the unset path. Mitigated by per-route tests asserting the unset body parses to the unset branch.
- **Idempotent `200` masking store errors.** A DB delete failure is logged inside `deleteConfigFromDb`'s `queueMicrotask` (swallowed) and surfaces only as a subsequent read still returning the value. The route always returns `200`; the client refreshes the section after unset, so a failed delete re-surfaces as the value persisting — but the user is not told the clear failed. This mirrors the existing `deleteInstructionFromDb` posture.
- **Required-key UX.** The UI warns before clearing a required key, but the warning copy is component-local; if a future required key should not be user-clearable, it must opt out via `unsettable: false` rather than relying on a UI gate.

## Related Decisions

- ADR-0136: Settings Web UI Access Model — the context-write scope (`resolveContextScope(...,'write',...)`) every unset route reuses.
- ADR-0137: Settings Web UI HTTP API — the `/settings/api/*` route + CSRF + session contract these routes extend.
- ADR-0203: Tool Permission Presets — `tool_prefs` and `applyPreset`/`detectActivePreset`, which the `tool_prefs` unset branch resets to baseline.
- ADR-0204: Admin Default Tool Permissions — the `__admin_tool_defaults__:<platformInstanceId>` synthetic context whose tool defaults the admin unset branch clears.
- ADR-0195: Admin Feature Flags Section — the `tool_context_flags` surface the feature-flags unset branch clears.
- ADR-0185: BYOK LLM Credentials — an excluded credential store with its own enable/disable lifecycle, deliberately not covered by this unset path.

## Implementation Notes

Key files, all confirmed present on the branch:

- Store primitives: `src/cache-db.ts` (`deleteConfigFromDb`), `src/cache.ts` (`clearCachedConfig`), `src/config.ts` (`unsetConfigValue`, `unsetPluginConfig`), `src/plugins/store.ts` (`deletePluginAdminConfig`), `src/tools/tool-preferences.ts` (`clearToolPrefs`).
- Registry gate: `src/types/config.ts` (`unsettable?: boolean` on `ConfigField`, `isFieldUnsettable` helper).
- Routes: `src/debug/settings/config-routes.ts`, `src/debug/settings/plugins-routes.ts`, `src/debug/admin-plugin-config.ts` (`applyAdminPluginConfigUnset`), `src/debug/settings/admin/plugin-config-routes.ts`, `src/debug/settings/tools-routes.ts`, `src/debug/settings/admin/tool-defaults-routes.ts`, `src/debug/settings/admin/feature-flags-routes.ts` + `src/debug/admin-feature-flags.ts`.
- Client fetchers: `client/settings/fetchers.ts` (`unsetConfigField`, `unsetPluginConfig`), `client/settings/admin-fetchers.ts` (`unsetAdminPluginConfig`, `unsetToolDefaults`).
- Client UI: `client/settings/components/ConfigFieldRow.svelte`, `client/settings/sections/PluginsSection.svelte`, `client/settings/sections/admin/AdminPluginsConfigSection.svelte`, `client/settings/sections/admin/AdminToolDefaultsSection.svelte`.

No divergence from the spec/plan was observed: every symbol and route named in the plan is present, the discriminated `action`/`kind` tokens are uniformly `'unset'`, and the store-primitive names are stable across the layers.
