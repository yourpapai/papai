<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Config Unset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a registry-gated "unset" path that clears a configured value back to its default/baseline, across plugin admin/global config (`system_config`) and every context-scoped reserved key (`user_config`).

**Architecture:** Two store primitives — one for `user_config` rows (covers all context-scoped keys: timezone, mcp*endpoints, ai*\*, plugin-context, provider creds, tool_prefs, tool_context_flags, admin tool defaults), one for `system_config` admin plugin config. Existing PATCH routes gain a discriminated `{ action: 'set' | 'unset' }` body (action optional, defaults to `'set'` for back-compat). A `unsettable` flag on `ConfigField` is the enforcement gate. Client gains a Clear affordance per configured field.

**Tech Stack:** Bun, TypeScript (strict, `.js` import paths), Zod v4, Drizzle (SQLite), Svelte SPA. Tests via `bun:test` with `setupTestDb()`.

**Spec:** `docs/superpowers/specs/2026-06-25-config-unset-design.md`

**Conventions:**

- Run a single test file: `bun test tests/<path>.test.ts`
- After any `src/` edit the TDD write-hook runs the paired test + coverage automatically; still run the named test yourself per the steps.
- Error extraction idiom: `error instanceof Error ? error.message : String(error)`.
- Never add lint-disable/ts-ignore. A `max-lines` failure means split, not compress.

---

## File Structure

**Store layer (backend foundation):**

- `src/cache-db.ts` — add `deleteConfigFromDb(userId, key)` (DB row delete, mirrors `deleteInstructionFromDb`).
- `src/cache.ts` — add `clearCachedConfig(userId, key)` (cache→null + delete row + emit).
- `src/config.ts` — add `unsetConfigValue(contextId, key)` and `unsetPluginConfig(contextId, pluginId, key)`.
- `src/plugins/store.ts` — add `deletePluginAdminConfig(pluginId, key)`.
- `src/tools/tool-preferences.ts` — add `clearToolPrefs(contextId)`.

**Registry gate:**

- `src/types/config.ts` — add `unsettable?: boolean` to `ConfigField` + `isFieldUnsettable(field)` helper.

**Routes (discriminated action):**

- `src/debug/settings/config-routes.ts` — generic context ConfigFields.
- `src/debug/settings/plugins-routes.ts` — plugin-context config.
- `src/debug/admin-plugin-config.ts` + `src/debug/settings/admin/plugin-config-routes.ts` — admin plugin config.
- `src/debug/settings/tools-routes.ts` — `tool_prefs` (per-context).
- `src/debug/settings/admin/tool-defaults-routes.ts` — admin tool defaults.
- `src/debug/settings/admin/feature-flags-routes.ts` — `tool_context_flags`.

**Client:**

- `client/settings/fetchers.ts`, `client/settings/admin-fetchers.ts` — action param / unset wrappers.
- Settings SPA config + plugin sections, admin UI plugin-config + tool-defaults sections — Clear button.

---

## Phase 1 — Store Primitives

### Task 1: `deleteConfigFromDb` (DB row delete)

**Files:**

- Modify: `src/cache-db.ts` (after `deleteInstructionFromDb`)
- Test: `tests/cache-db.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the top-level `describe('cache-db', ...)` in `tests/cache-db.test.ts`:

```ts
describe('deleteConfigFromDb', () => {
  test('removes the config row for the user+key', async () => {
    const userId = 'user-del-cfg-1'
    const db = getDrizzleDb()
    db.insert(userConfig).values({ userId, key: 'timezone', value: 'UTC' }).run()

    deleteConfigFromDb(userId, 'timezone')

    await waitFor(() => {
      const row = db
        .select()
        .from(userConfig)
        .where(and(eq(userConfig.userId, userId), eq(userConfig.key, 'timezone')))
        .get()
      return row === undefined
    })
  })

  test('is a no-op when the row does not exist', async () => {
    deleteConfigFromDb('user-del-cfg-missing', 'timezone')
    await waitFor(() => true)
  })
})
```

Add `deleteConfigFromDb` to the import from `../src/cache-db.js` at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cache-db.test.ts`
Expected: FAIL — `deleteConfigFromDb` is not exported / not a function.

- [ ] **Step 3: Implement**

In `src/cache-db.ts`, after `syncConfigToDb` (it already imports `and`, `eq`, `userConfig`, `getDrizzleDb`, `log` — confirm `and`/`eq` are imported; `deleteInstructionFromDb` uses them):

```ts
export function deleteConfigFromDb(userId: string, key: string): void {
  const db = getDrizzleDb()
  queueMicrotask(() => {
    try {
      db.delete(userConfig)
        .where(and(eq(userConfig.userId, userId), eq(userConfig.key, key)))
        .run()
      log.debug({ userId, key }, 'Config deleted from DB')
    } catch (error) {
      log.error(
        { userId, key, error: error instanceof Error ? error.message : String(error) },
        'Failed to delete config from DB',
      )
    }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/cache-db.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cache-db.ts tests/cache-db.test.ts
git commit -m "feat(config): deleteConfigFromDb primitive for config-row removal"
```

---

### Task 2: `clearCachedConfig` (cache + DB clear)

**Files:**

- Modify: `src/cache.ts`
- Test: `tests/cache.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/cache.test.ts` (it uses `setupTestDb()`/`mockLogger()` in `beforeEach`; follow the local pattern). Import `clearCachedConfig`, `getCachedConfig`, `setCachedConfig` from `../src/cache.js`:

```ts
describe('clearCachedConfig', () => {
  test('a read after clear returns null', async () => {
    const userId = 'user-clear-1'
    setCachedConfig(userId, 'timezone', 'UTC')
    expect(getCachedConfig(userId, 'timezone')).toBe('UTC')

    clearCachedConfig(userId, 'timezone')

    expect(getCachedConfig(userId, 'timezone')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cache.test.ts`
Expected: FAIL — `clearCachedConfig` not exported.

- [ ] **Step 3: Implement**

In `src/cache.ts`, after `setCachedConfig` (imports already present: `getOrCreateCache`, `emitUser`; add `deleteConfigFromDb` to the existing `./cache-db.js` import line):

```ts
export function clearCachedConfig(userId: string, key: string): void {
  const cache = getOrCreateCache(userId)
  cache.config.set(key, null)
  deleteConfigFromDb(userId, key)
  emitUser('cache:sync', userId, { field: 'config', operation: 'unset' })
}
```

Update the import at line 9:

```ts
import { deleteConfigFromDb, syncConfigToDb, syncFactToDb, syncHistoryToDb, syncSummaryToDb } from './cache-db.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cache.ts tests/cache.test.ts
git commit -m "feat(config): clearCachedConfig clears cache entry and DB row"
```

---

### Task 3: `unsetConfigValue` + `unsetPluginConfig`

**Files:**

- Modify: `src/config.ts`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/config.test.ts` (follow its existing setup — `setupTestDb`/`mockLogger`). Import `unsetConfigValue`, `unsetPluginConfig`, `getConfigValue`, `setConfigValue`, `getPluginConfig`, `setPluginConfig` from `../src/config.js`:

```ts
describe('unsetConfigValue', () => {
  test('clears a stored dynamic config value', () => {
    const ctx = 'ctx-unset-1'
    setConfigValue(ctx, 'timezone', 'UTC')
    expect(getConfigValue(ctx, 'timezone')).toBe('UTC')

    unsetConfigValue(ctx, 'timezone')

    expect(getConfigValue(ctx, 'timezone')).toBeNull()
  })

  test('throws for a disallowed key', () => {
    expect(() => unsetConfigValue('ctx-unset-2', 'not_a_real_key')).toThrow('Invalid config key')
  })
})

describe('unsetPluginConfig', () => {
  test('clears a stored plugin context config value', () => {
    const ctx = 'ctx-unset-plg-1'
    setPluginConfig(ctx, 'demo-plugin', 'api_key', 'secret')
    expect(getPluginConfig(ctx, 'demo-plugin', 'api_key')).toBe('secret')

    unsetPluginConfig(ctx, 'demo-plugin', 'api_key')

    expect(getPluginConfig(ctx, 'demo-plugin', 'api_key')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/config.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement**

In `src/config.ts`, add `clearCachedConfig` to the existing `./cache.js` import:

```ts
import { clearCachedConfig, clearCachedToolsByPrefix, getCachedConfig, setCachedConfig } from './cache.js'
```

After `setConfigValue`:

```ts
export function unsetConfigValue(contextId: string, key: string): void {
  if (!isAllowedDynamicConfigKey(key)) throw new Error(`Invalid config key: ${key}`)
  log.debug({ contextId, key }, 'unsetConfigValue called')
  clearCachedConfig(contextId, key)
  clearToolCacheIfToolAssemblyConfig(contextId, key)
  log.info({ contextId, key }, 'Config value unset')
}
```

After `setPluginConfig`:

```ts
export function unsetPluginConfig(contextId: string, pluginId: string, key: string): void {
  clearCachedConfig(contextId, getPluginConfigStorageKey(pluginId, key))
  clearCachedToolsByPrefix(contextId)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat(config): unsetConfigValue + unsetPluginConfig with tool-cache invalidation"
```

---

### Task 4: `deletePluginAdminConfig`

**Files:**

- Modify: `src/plugins/store.ts`
- Test: `tests/plugins/store.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/plugins/store.test.ts` (follow local setup). Import `deletePluginAdminConfig`, `getPluginAdminConfig`, `setPluginAdminConfig` from `../../src/plugins/store.js`:

```ts
describe('deletePluginAdminConfig', () => {
  test('removes a stored admin config value', () => {
    setPluginAdminConfig('demo-plugin', 'magi_token', 'tok-123', 'admin-1')
    expect(getPluginAdminConfig('demo-plugin', 'magi_token')).toBe('tok-123')

    deletePluginAdminConfig('demo-plugin', 'magi_token')

    expect(getPluginAdminConfig('demo-plugin', 'magi_token')).toBeUndefined()
  })

  test('is a no-op for an absent key', () => {
    deletePluginAdminConfig('demo-plugin', 'never_set')
    expect(getPluginAdminConfig('demo-plugin', 'never_set')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/store.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

In `src/plugins/store.ts`, after `setPluginAdminConfig` (file already imports `eq`, `systemConfig`, `getDrizzleDb`, `log`):

```ts
export function deletePluginAdminConfig(pluginId: string, key: string): void {
  getDrizzleDb()
    .delete(systemConfig)
    .where(eq(systemConfig.key, pluginAdminConfigKey(pluginId, key)))
    .run()
  log.debug({ pluginId, key }, 'Plugin admin config deleted')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/store.ts tests/plugins/store.test.ts
git commit -m "feat(plugins): deletePluginAdminConfig removes the system_config row"
```

---

### Task 5: `clearToolPrefs`

**Files:**

- Modify: `src/tools/tool-preferences.ts`
- Test: `tests/tools/tool-preferences.test.ts` (create test block if the file exists; otherwise add to the nearest existing tool-preferences test file — confirm path with `ls tests/tools | grep preference`)

- [ ] **Step 1: Write the failing test**

```ts
describe('clearToolPrefs', () => {
  test('after clear, hasStoredToolPrefs is false', () => {
    const ctx = 'ctx-clear-prefs-1'
    setToolPrefs(ctx, applyPreset('read-only'))
    expect(hasStoredToolPrefs(ctx)).toBe(true)

    clearToolPrefs(ctx)

    expect(hasStoredToolPrefs(ctx)).toBe(false)
  })
})
```

Import `clearToolPrefs`, `setToolPrefs`, `hasStoredToolPrefs`, `applyPreset` from `../../src/tools/tool-preferences.js`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/tool-preferences.test.ts`
Expected: FAIL — `clearToolPrefs` not exported.

- [ ] **Step 3: Implement**

In `src/tools/tool-preferences.ts`, add `clearCachedConfig` to the existing `../cache.js` import (line 6), then after `setToolPrefs`:

```ts
export function clearToolPrefs(contextId: string): void {
  clearCachedConfig(contextId, TOOL_PREFS_CONFIG_KEY)
  clearCachedToolsByPrefix(contextId)
}
```

Updated import:

```ts
import { clearCachedConfig, clearCachedToolsByPrefix, getCachedConfig, setCachedConfig } from '../cache.js'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools/tool-preferences.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/tool-preferences.ts tests/tools/tool-preferences.test.ts
git commit -m "feat(tools): clearToolPrefs removes the tool_prefs row + invalidates tool cache"
```

---

## Phase 2 — Registry Gate

### Task 6: `unsettable` flag on `ConfigField`

**Files:**

- Modify: `src/types/config.ts`
- Test: `tests/config-keys.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/config-keys.test.ts`, importing `isFieldUnsettable` and a `ConfigField` from `../src/types/config.js`:

```ts
describe('isFieldUnsettable', () => {
  const base = {
    key: 'timezone',
    storageKey: 'timezone',
    label: 'Timezone',
    required: false,
    sensitive: false,
    kind: 'preference' as const,
    control: 'text' as const,
  }

  test('declared fields are unsettable by default', () => {
    expect(isFieldUnsettable(base)).toBe(true)
  })

  test('an explicit unsettable:false opts out', () => {
    expect(isFieldUnsettable({ ...base, unsettable: false })).toBe(false)
  })
})
```

(If `ConfigField` requires more properties, copy them from an existing entry in `src/config-keys.ts` so `base` type-checks.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/config-keys.test.ts`
Expected: FAIL — `isFieldUnsettable` not exported.

- [ ] **Step 3: Implement**

In `src/types/config.ts`, add to the `ConfigField` type (after `options`):

```ts
  /** Whether this field can be cleared back to its default. Defaults to true. */
  readonly unsettable?: boolean
```

Add the helper (export):

```ts
export function isFieldUnsettable(field: ConfigField): boolean {
  return field.unsettable !== false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/config-keys.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types/config.ts tests/config-keys.test.ts
git commit -m "feat(config): unsettable flag + isFieldUnsettable gate on ConfigField"
```

---

## Phase 3 — Routes (discriminated `{ action }`)

### Task 7: Context config route unset (`/settings/api/config`)

**Files:**

- Modify: `src/debug/settings/config-routes.ts`
- Test: `tests/debug/settings/config-routes.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test that sets a value via PATCH `{key,value}` then clears it via PATCH `{action:'unset',key}`, asserting `getConfigValue` returns null afterward. Mirror the existing tests in this file for session/CSRF header setup (`establishSession`, `authHeaders`). Skeleton:

```ts
test('PATCH action:unset clears a configured field', async () => {
  // ... establish session for a DM-owner principal as the existing tests do ...
  setConfigValue(contextId, 'timezone', 'UTC')

  const res = await handleConfigRoutes(
    new Request('http://x/settings/api/config', {
      method: 'PATCH',
      headers: { ...authHeaders(session), 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'unset', key: 'timezone', contextId }),
    }),
    new URL('http://x/settings/api/config'),
  )

  expect(res.status).toBe(200)
  expect(getConfigValue(contextId, 'timezone')).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/settings/config-routes.test.ts`
Expected: FAIL — current schema rejects the body / no unset branch.

- [ ] **Step 3: Implement**

In `src/debug/settings/config-routes.ts`:

Replace `PatchBodySchema` with a discriminated body (action optional, defaults to set):

```ts
const SetBodySchema = z.object({
  action: z.literal('set').optional(),
  key: z.string().min(1),
  value: z.string(),
  contextId: z.string().optional(),
})
const UnsetBodySchema = z.object({
  action: z.literal('unset'),
  key: z.string().min(1),
  contextId: z.string().optional(),
})
const PatchBodySchema = z.union([UnsetBodySchema, SetBodySchema])
```

Import `unsetConfigValue` and `isFieldUnsettable`:

```ts
import { getConfigValue, maskSensitiveValue, setConfigValue, unsetConfigValue } from '../../config.js'
import { isFieldUnsettable } from '../../types/config.js'
```

In `handlePatch`, after resolving `scope` and finding `field` (keep the existing `field === undefined → 422` check), branch before the sensitive-mask block:

```ts
if (body.data.action === 'unset') {
  if (!isFieldUnsettable(field)) return settingsJson(422, { error: 'field cannot be unset' })
  unsetConfigValue(scope.scope.contextId, field.storageKey)
  log.info({ contextId: scope.scope.contextId, key: field.key }, 'Settings config field unset')
  return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
}
```

The remaining set-path code is unchanged but now `body.data.value` is only present on the set branch — TypeScript narrows it after the unset early-return, so the existing `body.data.value` references compile.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/debug/settings/config-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/debug/settings/config-routes.ts tests/debug/settings/config-routes.test.ts
git commit -m "feat(settings): unset action on /settings/api/config (all context ConfigFields)"
```

---

### Task 8: Plugin-context config route unset (`/settings/api/plugins/config`)

**Files:**

- Modify: `src/debug/settings/plugins-routes.ts`
- Test: `tests/debug/settings/plugins-routes.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test mirroring the existing config PATCH tests in this file: register a plugin with a context `configRequirement`, set a value via `setPluginConfig`, then PATCH `{action:'unset',pluginId,key,contextId}` and assert `getPluginConfig(...) === null` and status 200. Required-key variant: assert the unset still returns 200 (eligibility is checked elsewhere).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/settings/plugins-routes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/debug/settings/plugins-routes.ts`:

Locate `ConfigBodySchema` (used by `handleConfig`) and widen it to a union mirroring Task 7 (`{action:'unset',pluginId,key,contextId}` | `{action?:'set',pluginId,key,value,contextId}`). Import `unsetPluginConfig` from `../../config.js`.

In `handleConfig`, after the `requirement === undefined → 422` check, branch:

```ts
if (body.data.action === 'unset') {
  unsetPluginConfig(scope.scope.contextId, body.data.pluginId, body.data.key)
  log.info(
    { contextId: scope.scope.contextId, pluginId: body.data.pluginId, key: body.data.key },
    'Settings plugin config unset',
  )
  return settingsJson(200, { ok: true, contextId: scope.scope.contextId })
}
```

Leave the sensitive-mask "no change" block and `setPluginConfig` call for the set branch.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/debug/settings/plugins-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/debug/settings/plugins-routes.ts tests/debug/settings/plugins-routes.test.ts
git commit -m "feat(settings): unset action on /settings/api/plugins/config"
```

---

### Task 9: Admin plugin config route unset

**Files:**

- Modify: `src/debug/admin-plugin-config.ts`, `src/debug/settings/admin/plugin-config-routes.ts`
- Test: `tests/debug/settings/admin/plugin-config-routes.test.ts` (confirm path with `ls tests/debug/settings/admin | grep plugin`)

- [ ] **Step 1: Write the failing test**

Add a route test: seed an admin plugin config value (`setPluginAdminConfig`), PATCH `{action:'unset',pluginId,key}` with admin session + CSRF, assert 200 and `getPluginAdminConfig(...) === undefined`. Also assert PATCH `{action:'unset',pluginId,key:'not-declared'}` → 422 (`bad-key`).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/settings/admin/plugin-config-routes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/debug/admin-plugin-config.ts`:

Add a discriminated schema and an unset function alongside `applyAdminPluginConfigUpdate`:

```ts
const UnsetBodySchema = z.object({
  action: z.literal('unset'),
  pluginId: z.string(),
  key: z.string(),
})

export const applyAdminPluginConfigUnset = (
  body: unknown,
  updatedBy: string,
  descriptors: PluginConfigDescriptor[],
): { pluginId: string; key: string } => {
  const parsed = UnsetBodySchema.safeParse(body)
  if (!parsed.success) throw new AdminPluginConfigError('bad-value', 'invalid body shape')

  const descriptor = descriptors.find((d) => d.pluginId === parsed.data.pluginId)
  if (descriptor === undefined)
    throw new AdminPluginConfigError('bad-plugin', `unknown plugin: ${parsed.data.pluginId}`)

  const requirement = descriptor.configRequirements.find((req) => req.key === parsed.data.key && req.scope === 'admin')
  if (requirement === undefined) {
    throw new AdminPluginConfigError('bad-key', `undeclared or non-admin key: ${parsed.data.key}`)
  }

  deletePluginAdminConfig(parsed.data.pluginId, parsed.data.key)
  log.info({ pluginId: parsed.data.pluginId, key: parsed.data.key, updatedBy }, 'admin plugin config unset')
  return { pluginId: parsed.data.pluginId, key: parsed.data.key }
}
```

Add `deletePluginAdminConfig` to the import from `../plugins/store.js`.

In `src/debug/settings/admin/plugin-config-routes.ts`, in `handlePatch`, peek at the parsed body's `action` and dispatch. Replace the single `applyAdminPluginConfigUpdate` call with:

```ts
try {
  const isUnset =
    typeof parsed.value === 'object' &&
    parsed.value !== null &&
    (parsed.value as { action?: unknown }).action === 'unset'
  if (isUnset) {
    const result = applyAdminPluginConfigUnset(
      parsed.value,
      authed.principal.platformUserId,
      buildPluginConfigDescriptors(),
    )
    log.info({ pluginId: result.pluginId, key: result.key }, 'Settings admin unset plugin config')
    return settingsJson(200, { ok: true, pluginId: result.pluginId, key: result.key })
  }
  const result = applyAdminPluginConfigUpdate(
    parsed.value,
    authed.principal.platformUserId,
    buildPluginConfigDescriptors(),
  )
  log.info({ pluginId: result.pluginId, key: result.key }, 'Settings admin updated plugin config')
  return settingsJson(200, { ok: true, pluginId: result.pluginId, key: result.key, updatedAt: result.updatedAt })
} catch (err) {
  // ... unchanged AdminPluginConfigError / 500 handling ...
}
```

Add `applyAdminPluginConfigUnset` to the import from `../../admin-plugin-config.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/debug/settings/admin/plugin-config-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/debug/admin-plugin-config.ts src/debug/settings/admin/plugin-config-routes.ts tests/debug/settings/admin/plugin-config-routes.test.ts
git commit -m "feat(settings): unset action on /settings/api/admin/plugin-config"
```

---

### Task 10: `tool_prefs` unset (`/settings/api/tools/toggle`)

**Files:**

- Modify: `src/debug/settings/tools-routes.ts`
- Test: `tests/debug/settings/tools-routes.test.ts` (confirm path)

- [ ] **Step 1: Write the failing test**

Read the existing toggle body schema in `tools-routes.ts` (a discriminated union on `kind` with `preset`/`domain`/`tool`). Add a test that POSTs `{ kind: 'unset', contextId }` and asserts `hasStoredToolPrefs(contextId) === false` afterward and status 200.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/settings/tools-routes.test.ts`
Expected: FAIL — `unset` kind unrecognized.

- [ ] **Step 3: Implement**

In `src/debug/settings/tools-routes.ts`, add `z.object({ kind: z.literal('unset') })` (plus the shared `contextId` field as the other variants carry it) to the toggle `z.discriminatedUnion('kind', [...])`. Import `clearToolPrefs` from `../../tools/tool-preferences.js`. In the toggle handler, add:

```ts
if (body.data.kind === 'unset') {
  clearToolPrefs(scope.scope.contextId)
  log.info({ contextId: scope.scope.contextId }, 'Tool prefs unset')
  return /* same shape the other kinds return (re-read view + activePreset) */
}
```

Match the exact success response shape the existing kinds return in this handler (re-read the file; it returns a recomputed view incl. `activePreset`). After `clearToolPrefs`, `detectActivePreset` over the now-empty prefs yields the baseline — return that view.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/debug/settings/tools-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/debug/settings/tools-routes.ts tests/debug/settings/tools-routes.test.ts
git commit -m "feat(settings): unset kind clears per-context tool_prefs"
```

---

### Task 11: Admin tool-defaults unset

**Files:**

- Modify: `src/debug/settings/admin/tool-defaults-routes.ts`
- Test: `tests/debug/settings/admin/tool-defaults-routes.test.ts` (confirm path)

- [ ] **Step 1: Write the failing test**

POST `{ kind: 'unset' }` with an admin session + CSRF; assert 200 and that the synthetic admin-defaults context (`adminToolDefaultsContextId(platformInstanceId)`) has no stored prefs (`hasStoredToolPrefs === false`) and the response `activePreset` is `null`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/settings/admin/tool-defaults-routes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/debug/settings/admin/tool-defaults-routes.ts`, add `z.object({ kind: z.literal('unset') })` to `ToggleBodySchema`. Import `clearToolPrefs` from `../../../tools/tool-preferences.js`. In `handlePost`, add a branch before the `domain`/`tool`/`else` chain:

```ts
if (body.data.kind === 'unset') {
  clearToolPrefs(ctx)
  log.info({ platformInstanceId: authed.principal.platformInstanceId }, 'Admin tool defaults unset')
  return view(ctx)
}
```

`view(ctx)` already reports `activePreset: null` when `hasStoredToolPrefs(ctx)` is false — so the cleared state renders correctly.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/debug/settings/admin/tool-defaults-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/debug/settings/admin/tool-defaults-routes.ts tests/debug/settings/admin/tool-defaults-routes.test.ts
git commit -m "feat(settings): unset kind clears admin tool defaults"
```

---

### Task 12: `tool_context_flags` unset (`/settings/api/admin/feature-flags`)

**Files:**

- Modify: `src/debug/settings/admin/feature-flags-routes.ts`
- Test: `tests/debug/settings/admin/feature-flags-routes.test.ts` (confirm path)

- [ ] **Step 1: Write the failing test**

Read the route first. It currently PATCHes `{contextId, flags}` (all booleans). Add an unset variant: PATCH `{ contextId, action: 'unset' }`; assert 200 and that `getConfigValue(contextId, REDUCTION_FLAGS_CONFIG_KEY)` is null afterward.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/settings/admin/feature-flags-routes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Widen `PatchBodySchema` to a union: the existing `{contextId, flags}` set body OR `{contextId, action:'unset'}`. Import `unsetConfigValue` from `../../../config.js` and `REDUCTION_FLAGS_CONFIG_KEY` from `../../../tools/feature-flags.js`. In the PATCH handler, branch on `action === 'unset'` → `unsetConfigValue(contextId, REDUCTION_FLAGS_CONFIG_KEY)` → return the recomputed flags view (which will now show all defaults).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/debug/settings/admin/feature-flags-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/debug/settings/admin/feature-flags-routes.ts tests/debug/settings/admin/feature-flags-routes.test.ts
git commit -m "feat(settings): unset action clears tool_context_flags"
```

---

## Phase 4 — Client (fetchers + UI)

### Task 13: Settings fetchers gain unset

**Files:**

- Modify: `client/settings/fetchers.ts`, `client/settings/admin-fetchers.ts`
- Test: extend the relevant client fetcher test if present (`ls tests/client/settings`), else covered by the route tests above — add a thin unit asserting the fetcher posts the discriminated body.

- [ ] **Step 1: Write the failing test (if a fetcher test file exists)**

Assert `unsetConfigField({ contextId, key })` calls `writeJson('/settings/api/config', 'PATCH', { action: 'unset', key, contextId })`. Follow the existing fetcher-test mock pattern in `tests/client/settings/`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client` (client suite) — or the specific file.
Expected: FAIL — `unsetConfigField` not exported.

- [ ] **Step 3: Implement**

In `client/settings/fetchers.ts`:

```ts
export const unsetConfigField = (input: { contextId: string; key: string }): Promise<unknown> =>
  writeJson('/settings/api/config', 'PATCH', { action: 'unset', ...input }, (b) => b)

export const unsetPluginConfig = (input: { pluginId: string; key: string; contextId: string }): Promise<unknown> =>
  writeJson('/settings/api/plugins/config', 'PATCH', { action: 'unset', ...input }, (b) => b)
```

In `client/settings/admin-fetchers.ts`, mirror `patchAdminPluginConfig` for unset:

```ts
export const unsetAdminPluginConfig = (input: { pluginId: string; key: string }): Promise<unknown> =>
  writeJson('/settings/api/admin/plugin-config', 'PATCH', { action: 'unset', ...input }, (b) => b)
```

Add a `tools/toggle` `{kind:'unset'}` and tool-defaults `{kind:'unset'}` wrapper if those fetchers exist (re-read `admin-fetchers.ts` for the exact tool-defaults fetcher name).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test:client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/settings/fetchers.ts client/settings/admin-fetchers.ts tests/client/settings/
git commit -m "feat(settings-ui): unset fetchers for config, plugin, and admin config"
```

---

### Task 14: Clear button — settings SPA config + plugin sections

**Files:**

- Modify: the Svelte components rendering the config-field list and the plugin-config list (find with `ls client/settings/` and `grep -rl "patchPluginConfig\|hasValue" client/settings/`)
- Test: extend the matching `tests/client/settings/*.test.ts` (happy-dom)

- [ ] **Step 1: Read the target components**

Run: `grep -rln "hasValue\|patchConfigField\|patchPluginConfig" client/settings/`
Read each to learn the existing field-row markup and event wiring.

- [ ] **Step 2: Write the failing client test**

In the matching component test, render with a field where `hasValue === true`, assert a "Clear" control is present, click it, confirm the dialog, and assert the `unsetConfigField` / `unsetPluginConfig` fetcher was called with `{ contextId, key }`. Follow the local happy-dom + fetcher-mock pattern.

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test:client`
Expected: FAIL — no Clear control.

- [ ] **Step 4: Implement**

In each component, next to a field row where `hasValue` is true, add a Clear button that opens a confirm dialog (reuse the existing confirm pattern used elsewhere in the SPA — e.g. the preset-apply or memory-clear confirm) and on confirm calls the fetcher, then refreshes the section. For a **required** field, the confirm copy must warn that clearing it makes the plugin ineligible for the context. Match the component's existing styling/markup conventions.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test:client`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/settings/ tests/client/settings/
git commit -m "feat(settings-ui): Clear affordance for config + plugin fields"
```

---

### Task 15: Clear button — admin UI plugin-config + tool-defaults

**Files:**

- Modify: admin client components for plugin-config and tool-defaults (find with `grep -rln "patchAdminPluginConfig\|AdminPluginConfig" client/`)
- Test: matching `tests/client/...` admin component tests

- [ ] **Step 1: Read the target components**

Run: `grep -rln "patchAdminPluginConfig\|tool-defaults\|AdminPluginConfig" client/`
Read each.

- [ ] **Step 2: Write the failing client test**

Render the admin plugin-config section with a key whose `value !== null`; assert a Clear control exists, click + confirm, assert `unsetAdminPluginConfig({ pluginId, key })` was called. Repeat for tool-defaults `{kind:'unset'}`.

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test:client`
Expected: FAIL.

- [ ] **Step 4: Implement**

Add the Clear control + confirm + fetcher call, matching the admin component conventions. Refresh the section snapshot after success.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test:client`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/ tests/client/
git commit -m "feat(admin-ui): Clear affordance for admin plugin config + tool defaults"
```

---

## Phase 5 — Verification

### Task 16: Full check + docs

- [ ] **Step 1: Run the full suite**

Run: `bun run test`
Expected: all server suites green. Then `bun test:client`.

- [ ] **Step 2: Lint/format/typecheck**

Run: `bun check:full`
Expected: all checks pass (lint, typecheck, format:check, license-headers).

- [ ] **Step 3: Update docs**

If the plugin developer guide (`docs/plugins/developer-guide.md`) documents the admin/context config lifecycle, add a sentence that admin and context config values can now be unset (cleared to default) via the settings UI. Update `CLAUDE.md` only if a documented behavior changed materially (the unset path is additive; a one-line note in the settings-UI section is sufficient).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(config): note unset capability in settings UI"
```

---

## Self-Review Notes (author)

- **Spec coverage:** A-tier via Tasks 7 (config route) + 14 (UI); plugin-context via 8/14; B-tier `tool_prefs` (10), `tool_context_flags` (12), admin tool defaults (11/15); admin plugin config via 9/15. Store primitives 1–5; gate 6. All boundary rows in the spec map to a task. Excluded keys (operational secrets, BYOK/vault) are never given a route — enforced by the registry/declared-key gates, no task needed.
- **Required-key behavior:** Tasks 8/14 carry the "allowed, plugin becomes ineligible" decision (UI warning + 200 response); eligibility flip is asserted at the existing eligibility tests — no new server logic.
- **Type consistency:** primitive names are stable across tasks — `deleteConfigFromDb`, `clearCachedConfig`, `unsetConfigValue`, `unsetPluginConfig`, `deletePluginAdminConfig`, `clearToolPrefs`, `isFieldUnsettable`; route action token is `'unset'` everywhere; tool routes use `kind:'unset'`.
- **Paths to confirm at execution time** (test files whose exact path the executor should verify with `ls` first): `tests/tools/tool-preferences.test.ts`, `tests/debug/settings/admin/{plugin-config,tool-defaults,feature-flags}-routes.test.ts`, `tests/client/settings/*`. The plan flags each.
