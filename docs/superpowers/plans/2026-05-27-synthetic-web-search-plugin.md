<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Synthetic Web Search Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add web search capability to papai via a plugin that calls the Synthetic Search API, with three targeted core plugin system extensions (http permission, admin-scoped config, rate limiter exposure).

**Architecture:** The `synthetic-web-search` plugin registers a `search` tool and a prompt fragment. It uses a new `http` permission for outbound HTTP access, reads its API key from admin-scoped config stored in `system_config`, and rate-limits calls via the existing SQLite sliding-window limiter exposed on the plugin tool runtime context.

**Tech Stack:** TypeScript, Bun, Zod v4, Drizzle ORM, Svelte 5, Vercel AI SDK

**Spec:** `docs/superpowers/specs/2026-05-27-synthetic-web-search-plugin-design.md`

---

## File Structure

### Core plugin system extensions (modify)

| File                                          | Responsibility                                                                                           |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/plugins/types.ts`                        | Add `'http'` permission, `scope` on config requirement schema, `rateLimit` on `PluginToolRuntimeContext` |
| `src/plugins/context.ts`                      | Build `providerRuntime` for `http` permission, build `adminConfig` facade                                |
| `src/plugins/store.ts`                        | Add `getPluginAdminConfig()`, `setPluginAdminConfig()`                                                   |
| `src/plugins/tool-runtime.ts`                 | Build `rateLimit` helper on runtime context                                                              |
| `src/plugins/registry-context-eligibility.ts` | Check admin-scoped required keys globally                                                                |

### Admin UI (new + modify)

| File                                               | Responsibility                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| `src/debug/admin-plugin-config.ts`                 | **New.** Business logic: snapshot + apply update for plugin admin config |
| `src/debug/plugin-config-routes.ts`                | **New.** HTTP handlers: GET/POST `/admin/plugin-config`                  |
| `src/debug/server.ts`                              | Mount new admin routes in `routeAdminPaths`                              |
| `client/admin/sections/PluginConfigSection.svelte` | **New.** Svelte section component                                        |
| `client/admin/components/PluginConfigForm.svelte`  | **New.** Inline-edit form for plugin config keys                         |
| `client/admin/fetchers.ts`                         | Add `fetchAdminPluginConfig()`, `submitAdminPluginConfig()`              |
| `client/admin/fetcher-schemas.ts`                  | Add Zod schemas for plugin config API responses                          |
| `client/shared/api-types.ts`                       | Add shared types for plugin config                                       |
| `client/admin/AdminApp.svelte`                     | Register new section                                                     |
| `client/admin/admin.svelte.ts`                     | Add `'plugin-config'` to `adminSections`                                 |

### Plugin (new)

| File                                       | Responsibility                             |
| ------------------------------------------ | ------------------------------------------ |
| `plugins/synthetic-web-search/plugin.json` | Plugin manifest                            |
| `plugins/synthetic-web-search/index.ts`    | Plugin entry point: tool + prompt fragment |

### Tests (new + modify)

| File                                         | Responsibility                                                        |
| -------------------------------------------- | --------------------------------------------------------------------- |
| `tests/plugins/types.test.ts`                | Test `scope` field validation, `http` permission                      |
| `tests/plugins/context.test.ts`              | Test `http` permission grants `providerRuntime`, `adminConfig` facade |
| `tests/plugins/store.test.ts`                | Test `getPluginAdminConfig`, `setPluginAdminConfig`                   |
| `tests/plugins/tool-runtime.test.ts`         | **New.** Test `rateLimit` on runtime context                          |
| `tests/plugins/registry.test.ts`             | Test admin-scoped config eligibility                                  |
| `tests/debug/admin-plugin-config.test.ts`    | **New.** Test snapshot + apply update logic                           |
| `tests/plugins/synthetic-web-search.test.ts` | **New.** Test plugin tool execution, rate limiting, error paths       |

---

### Task 1: Add `http` permission to plugin system

**Files:**

- Modify: `src/plugins/types.ts:17-26`
- Modify: `src/plugins/context.ts:173-175`
- Modify: `tests/plugins/types.test.ts`
- Modify: `tests/plugins/context.test.ts`

- [ ] **Step 1: Write failing test for `http` permission in manifest validation**

Add to `tests/plugins/types.test.ts`:

```typescript
describe('http permission', () => {
  it('accepts http as a valid permission', () => {
    const manifest = makeValidManifest({ permissions: ['http'] })
    const result = pluginManifestSchema.safeParse(manifest)
    expect(result.success).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/types.test.ts`
Expected: FAIL — `'http'` is not in the `PLUGIN_PERMISSIONS` enum.

- [ ] **Step 3: Add `http` to `PLUGIN_PERMISSIONS`**

In `src/plugins/types.ts`, add `'http'` to the `PLUGIN_PERMISSIONS` tuple:

```typescript
export const PLUGIN_PERMISSIONS = [
  'storage',
  'scheduler',
  'commands',
  'chat.send',
  'tasks.read',
  'tasks.write',
  'provider.task',
  'identity',
  'http',
] as const
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/types.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing test for `http` permission granting `providerRuntime`**

Add to `tests/plugins/context.test.ts`:

```typescript
describe('http permission', () => {
  it('provides providerRuntime when http permission is declared', () => {
    const { ctx } = buildPluginContext(
      makeManifest({ permissions: ['http'], providerAllowedHosts: ['api.example.com'] }),
      'ctx-1',
    )
    expect(ctx.providerRuntime).toBeDefined()
    expect(ctx.providerRuntime!.allowedHosts.has('api.example.com')).toBe(true)
  })

  it('does not provide providerRuntime without http or provider.task permission', () => {
    const { ctx } = buildPluginContext(makeManifest({ permissions: [] }), 'ctx-1')
    expect(ctx.providerRuntime).toBeUndefined()
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `bun test tests/plugins/context.test.ts`
Expected: FAIL — `providerRuntime` is only built for `provider.task` permission.

- [ ] **Step 7: Update context builder to grant `providerRuntime` for `http` permission**

In `src/plugins/context.ts`, update the `providerRuntime` construction (around line 173):

```typescript
const providerRuntime =
  permissions.has('provider.task') || permissions.has('http')
    ? buildProviderRuntime(manifest.providerAllowedHosts, log)
    : undefined
```

- [ ] **Step 8: Run test to verify it passes**

Run: `bun test tests/plugins/context.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/plugins/types.ts src/plugins/context.ts tests/plugins/types.test.ts tests/plugins/context.test.ts
git commit -m "feat(plugins): add http permission for outbound HTTP access"
```

---

### Task 2: Add admin-scoped plugin config — schema and store

**Files:**

- Modify: `src/plugins/types.ts:147-152`
- Modify: `src/plugins/store.ts`
- Modify: `tests/plugins/types.test.ts`
- Modify: `tests/plugins/store.test.ts`

- [ ] **Step 1: Write failing test for `scope` field on config requirement schema**

Add to `tests/plugins/types.test.ts`:

```typescript
describe('configRequirements scope', () => {
  it('defaults scope to context when not specified', () => {
    const manifest = makeValidManifest({
      configRequirements: [{ key: 'api_key', label: 'API Key', required: true, sensitive: true }],
    })
    const result = pluginManifestSchema.safeParse(manifest)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.configRequirements[0].scope).toBe('context')
    }
  })

  it('accepts scope admin', () => {
    const manifest = makeValidManifest({
      configRequirements: [{ key: 'api_key', label: 'API Key', required: true, sensitive: true, scope: 'admin' }],
    })
    const result = pluginManifestSchema.safeParse(manifest)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.configRequirements[0].scope).toBe('admin')
    }
  })

  it('rejects invalid scope values', () => {
    const manifest = makeValidManifest({
      configRequirements: [{ key: 'api_key', label: 'API Key', required: true, sensitive: true, scope: 'invalid' }],
    })
    const result = pluginManifestSchema.safeParse(manifest)
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/types.test.ts`
Expected: FAIL — `scope` field does not exist on the schema.

- [ ] **Step 3: Add `scope` field to `pluginConfigRequirementSchema`**

In `src/plugins/types.ts`, update the config requirement schema:

```typescript
const pluginConfigRequirementSchema = z.object({
  key: configKeySchema,
  label: z.string().min(1),
  required: z.boolean(),
  sensitive: z.boolean().optional().default(false),
  scope: z.enum(['context', 'admin']).optional().default('context'),
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/types.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing tests for plugin admin config store functions**

Add to `tests/plugins/store.test.ts`:

```typescript
describe('plugin admin config', () => {
  it('returns undefined when key does not exist', () => {
    expect(getPluginAdminConfig('my-plugin', 'api_key')).toBeUndefined()
  })

  it('stores and retrieves a value', () => {
    setPluginAdminConfig('my-plugin', 'api_key', 'sk-test-123', 'admin-1')
    expect(getPluginAdminConfig('my-plugin', 'api_key')).toBe('sk-test-123')
  })

  it('overwrites an existing value', () => {
    setPluginAdminConfig('my-plugin', 'api_key', 'sk-old', 'admin-1')
    setPluginAdminConfig('my-plugin', 'api_key', 'sk-new', 'admin-1')
    expect(getPluginAdminConfig('my-plugin', 'api_key')).toBe('sk-new')
  })

  it('isolates keys by plugin id', () => {
    setPluginAdminConfig('plugin-a', 'api_key', 'key-a', 'admin-1')
    setPluginAdminConfig('plugin-b', 'api_key', 'key-b', 'admin-1')
    expect(getPluginAdminConfig('plugin-a', 'api_key')).toBe('key-a')
    expect(getPluginAdminConfig('plugin-b', 'api_key')).toBe('key-b')
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `bun test tests/plugins/store.test.ts`
Expected: FAIL — `getPluginAdminConfig` and `setPluginAdminConfig` are not defined.

- [ ] **Step 7: Implement `getPluginAdminConfig` and `setPluginAdminConfig`**

Add to `src/plugins/store.ts`:

```typescript
import { sql } from 'drizzle-orm'
import { systemConfig } from '../db/schema.js'

function pluginAdminConfigKey(pluginId: string, key: string): string {
  return `plg:${pluginId}:${key}`
}

export function getPluginAdminConfig(pluginId: string, key: string): string | undefined {
  const row = getDrizzleDb()
    .select({ value: systemConfig.value })
    .from(systemConfig)
    .where(eq(systemConfig.key, pluginAdminConfigKey(pluginId, key)))
    .get()
  return row?.value
}

export function setPluginAdminConfig(pluginId: string, key: string, value: string, updatedBy: string): void {
  const dbKey = pluginAdminConfigKey(pluginId, key)
  const updatedAt = Date.now()
  getDrizzleDb()
    .insert(systemConfig)
    .values({ key: dbKey, value, updatedAt, updatedBy })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: {
        value: sql`excluded.value`,
        updatedAt: sql`excluded.updated_at`,
        updatedBy: sql`excluded.updated_by`,
      },
    })
    .run()
}
```

Add the necessary imports at the top of `store.ts`:

```typescript
import { eq, sql } from 'drizzle-orm'
import { systemConfig } from '../db/schema.js'
```

(Check if `eq` is already imported from `drizzle-orm` — if so, just add `sql` and `systemConfig`.)

- [ ] **Step 8: Run test to verify it passes**

Run: `bun test tests/plugins/store.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/plugins/types.ts src/plugins/store.ts tests/plugins/types.test.ts tests/plugins/store.test.ts
git commit -m "feat(plugins): add admin-scoped config with scope field and store functions"
```

---

### Task 3: Add `adminConfig` facade to `PluginContext`

**Files:**

- Modify: `src/plugins/context.ts`
- Modify: `tests/plugins/context.test.ts`

- [ ] **Step 1: Write failing test for `adminConfig` on `PluginContext`**

Add to `tests/plugins/context.test.ts`:

```typescript
describe('adminConfig', () => {
  it('provides adminConfig when plugin declares admin-scoped config requirements', () => {
    setPluginAdminConfig('test-plugin', 'api_key', 'sk-test-123', 'admin')
    const { ctx } = buildPluginContext(
      makeManifest({
        configRequirements: [{ key: 'api_key', label: 'API Key', required: true, sensitive: true, scope: 'admin' }],
      }),
      'ctx-1',
    )
    expect(ctx.adminConfig).toBeDefined()
    expect(ctx.adminConfig.get('api_key')).toBe('sk-test-123')
  })

  it('returns undefined for undeclared admin config keys', () => {
    const { ctx } = buildPluginContext(
      makeManifest({
        configRequirements: [{ key: 'api_key', label: 'API Key', required: true, sensitive: true, scope: 'admin' }],
      }),
      'ctx-1',
    )
    expect(ctx.adminConfig.get('other_key')).toBeUndefined()
  })

  it('does not expose context-scoped keys via adminConfig', () => {
    const { ctx } = buildPluginContext(
      makeManifest({
        configRequirements: [
          { key: 'api_key', label: 'API Key', required: true, sensitive: true, scope: 'admin' },
          { key: 'timezone', label: 'Timezone', required: false, sensitive: false, scope: 'context' },
        ],
      }),
      'ctx-1',
    )
    expect(ctx.adminConfig.get('timezone')).toBeUndefined()
  })
})
```

Add the import at the top of the test file:

```typescript
import { setPluginAdminConfig } from '../../src/plugins/store.js'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/context.test.ts`
Expected: FAIL — `ctx.adminConfig` does not exist.

- [ ] **Step 3: Add `adminConfig` type to `PluginContext` and build it**

In `src/plugins/context.ts`, add the type:

```typescript
export type PluginAdminConfig = {
  get(key: string): string | undefined
}
```

Add to the `PluginContext` type:

```typescript
export type PluginContext = {
  readonly pluginId: string
  readonly contextId: string
  readonly permissions: ReadonlySet<PluginPermission>
  readonly kv: PluginKvStore
  readonly log: PluginLogger
  readonly registration: PluginRegistration
  readonly providerRuntime?: PluginProviderRuntime
  readonly identity?: PluginIdentityFacade
  readonly adminConfig: PluginAdminConfig
}
```

Add the builder function:

```typescript
import { getPluginAdminConfig } from './store.js'

function buildAdminConfig(manifest: PluginManifest): PluginAdminConfig {
  const adminKeys = new Set(manifest.configRequirements.filter((req) => req.scope === 'admin').map((req) => req.key))
  return Object.freeze({
    get(key: string): string | undefined {
      if (!adminKeys.has(key)) return undefined
      return getPluginAdminConfig(manifest.id, key)
    },
  })
}
```

In `buildPluginContext`, add `adminConfig` to the context object:

```typescript
const ctx: PluginContext = Object.freeze({
  pluginId: manifest.id,
  contextId,
  permissions,
  kv,
  log,
  registration: buildRegistration(manifest, collected),
  providerRuntime,
  identity,
  adminConfig: buildAdminConfig(manifest),
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/context.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugins/context.ts tests/plugins/context.test.ts
git commit -m "feat(plugins): add adminConfig facade to PluginContext"
```

---

### Task 4: Add admin-scoped config eligibility check

**Files:**

- Modify: `src/plugins/registry-context-eligibility.ts:23-32`
- Modify: `tests/plugins/registry.test.ts`

- [ ] **Step 1: Write failing test for admin-scoped config eligibility**

Add to `tests/plugins/registry.test.ts` in the eligibility section:

```typescript
describe('admin-scoped config eligibility', () => {
  it('returns config_missing when required admin config is not set', () => {
    // Plugin with required admin-scoped config, no value set in system_config
    const result = getPluginContextEligibilityForEntry(
      makeActiveEntry(
        makeDiscoveredPlugin({
          manifest: makeManifest({
            configRequirements: [{ key: 'api_key', label: 'API Key', required: true, sensitive: true, scope: 'admin' }],
          }),
        }),
      ),
      'test-plugin',
      'ctx-1',
    )
    expect(result).toEqual({ eligible: false, reason: 'config_missing', missingKeys: ['api_key'] })
  })

  it('returns eligible when required admin config is set', () => {
    setPluginAdminConfig('test-plugin', 'api_key', 'sk-test-123', 'admin')
    const result = getPluginContextEligibilityForEntry(
      makeActiveEntry(
        makeDiscoveredPlugin({
          manifest: makeManifest({
            configRequirements: [{ key: 'api_key', label: 'API Key', required: true, sensitive: true, scope: 'admin' }],
          }),
        }),
      ),
      'test-plugin',
      'ctx-1',
    )
    expect(result).toEqual({ eligible: true })
  })
})
```

Add the import:

```typescript
import { setPluginAdminConfig } from '../../src/plugins/store.js'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/registry.test.ts`
Expected: FAIL — the eligibility check uses `getPluginConfig` (per-context) which won't find admin-scoped values.

- [ ] **Step 3: Update eligibility to check admin-scoped keys from `system_config`**

In `src/plugins/registry-context-eligibility.ts`, update `getMissingRequiredConfigKeys`:

```typescript
import { getPluginAdminConfig } from './store.js'

function getMissingRequiredConfigKeys(plugin: DiscoveredPlugin, contextId: string): readonly string[] {
  return plugin.manifest.configRequirements
    .filter((requirement) => requirement.required)
    .filter((requirement) => {
      if (requirement.scope === 'admin') {
        const value = getPluginAdminConfig(plugin.manifest.id, requirement.key)
        if (value === undefined) return true
        return value.trim() === ''
      }
      const value = getPluginConfig(contextId, plugin.manifest.id, requirement.key)
      if (value === null) return true
      return value.trim() === ''
    })
    .map((requirement) => requirement.key)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/registry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugins/registry-context-eligibility.ts tests/plugins/registry.test.ts
git commit -m "feat(plugins): check admin-scoped config in eligibility using system_config"
```

---

### Task 5: Add rate limiter to plugin tool runtime context

**Files:**

- Modify: `src/plugins/types.ts:229-235`
- Modify: `src/plugins/tool-runtime.ts`
- Create: `tests/plugins/tool-runtime.test.ts`

- [ ] **Step 1: Write failing test for `rateLimit` on runtime context**

Create `tests/plugins/tool-runtime.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'

import { buildPluginToolRuntimeContext, type PluginToolSetRuntime } from '../../src/plugins/tool-runtime.js'
import type { PluginManifest } from '../../src/plugins/types.js'
import { setupTestDb } from '../utils/test-helpers.js'

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'Test',
    apiVersion: 1,
    main: 'index.ts',
    contributes: { tools: [], promptFragments: [], commands: [], jobs: [], configKeys: [], taskProviderTypes: [] },
    permissions: [],
    defaultEnabled: false,
    requiredTaskCapabilities: [],
    requiredChatCapabilities: [],
    configRequirements: [],
    providerCapabilities: [],
    providerConfigSchema: [],
    providerAllowedHosts: [],
    activationTimeoutMs: 5000,
    ...overrides,
  } as PluginManifest
}

function makeRuntime(overrides: Partial<PluginToolSetRuntime> = {}): PluginToolSetRuntime {
  return {
    provider: {} as PluginToolSetRuntime['provider'],
    storageContextId: 'ctx-1',
    chatUserId: 'user-1',
    ...overrides,
  }
}

describe('buildPluginToolRuntimeContext', () => {
  describe('rateLimit', () => {
    it('provides rateLimit on the runtime context', () => {
      setupTestDb()
      const ctx = buildPluginToolRuntimeContext('test-plugin', makeManifest(), makeRuntime())
      expect(ctx.rateLimit).toBeDefined()
      expect(typeof ctx.rateLimit.check).toBe('function')
    })

    it('allows requests within the rate limit', () => {
      setupTestDb()
      const ctx = buildPluginToolRuntimeContext('test-plugin', makeManifest(), makeRuntime())
      const result = ctx.rateLimit.check('actor-1')
      expect(result.allowed).toBe(true)
    })

    it('denies requests when rate limit is exceeded', () => {
      setupTestDb()
      const ctx = buildPluginToolRuntimeContext('test-plugin', makeManifest(), makeRuntime())
      let lastResult: { allowed: boolean; retryAfterSec?: number } = { allowed: true }
      for (let i = 0; i < 21; i++) {
        lastResult = ctx.rateLimit.check('actor-1')
      }
      expect(lastResult.allowed).toBe(false)
      expect(lastResult.retryAfterSec).toBeDefined()
      expect(lastResult.retryAfterSec!).toBeGreaterThan(0)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/tool-runtime.test.ts`
Expected: FAIL — `rateLimit` does not exist on `PluginToolRuntimeContext`.

- [ ] **Step 3: Add `rateLimit` to `PluginToolRuntimeContext` type and builder**

In `src/plugins/types.ts`, add to `PluginToolRuntimeContext`:

```typescript
export type PluginToolRuntimeContext = {
  pluginId: string
  storageContextId: string
  chatUserId: string
  taskProvider: PluginTaskProviderFacade
  kv: PluginContext['kv']
  rateLimit: {
    check(actorId: string): { allowed: boolean; retryAfterSec?: number }
  }
}
```

In `src/plugins/tool-runtime.ts`, add the import and builder:

```typescript
import { consumeWebFetchQuota } from '../web/rate-limit.js'
```

Add the `rateLimit` builder:

```typescript
function buildRateLimit(): PluginToolRuntimeContext['rateLimit'] {
  return Object.freeze({
    check(actorId: string): { allowed: boolean; retryAfterSec?: number } {
      const result = consumeWebFetchQuota(actorId)
      if (result.allowed) return { allowed: true }
      return { allowed: false, retryAfterSec: result.retryAfterSec }
    },
  })
}
```

Add `rateLimit` to the returned object in `buildPluginToolRuntimeContext`:

```typescript
return Object.freeze({
  pluginId,
  storageContextId: runtime.storageContextId,
  chatUserId: runtime.chatUserId,
  taskProvider: buildTaskProviderFacade(
    pluginId,
    runtime.provider,
    permissions.has('tasks.read'),
    permissions.has('tasks.write'),
  ),
  kv: buildRuntimeKv(pluginId, runtime.storageContextId, permissions.has('storage')),
  rateLimit: buildRateLimit(),
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/tool-runtime.test.ts`
Expected: PASS

- [ ] **Step 5: Run full plugin test suite to verify no regressions**

Run: `bun test tests/plugins/`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/plugins/types.ts src/plugins/tool-runtime.ts tests/plugins/tool-runtime.test.ts
git commit -m "feat(plugins): expose rate limiter on plugin tool runtime context"
```

---

### Task 6: Admin plugin config routes (server-side)

**Files:**

- Create: `src/debug/admin-plugin-config.ts`
- Create: `src/debug/plugin-config-routes.ts`
- Modify: `src/debug/server.ts:205-222`
- Create: `tests/debug/admin-plugin-config.test.ts`

- [ ] **Step 1: Write failing tests for admin plugin config business logic**

Create `tests/debug/admin-plugin-config.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'

import {
  AdminPluginConfigError,
  applyAdminPluginConfigUpdate,
  getAdminPluginConfigSnapshot,
} from '../../src/debug/admin-plugin-config.js'
import { setPluginAdminConfig } from '../../src/plugins/store.js'
import { setupTestDb } from '../utils/test-helpers.js'

describe('getAdminPluginConfigSnapshot', () => {
  it('returns empty plugins array when no plugins have admin config', () => {
    setupTestDb()
    const snapshot = getAdminPluginConfigSnapshot([])
    expect(snapshot.plugins).toEqual([])
  })

  it('returns plugin config entries with masked sensitive values', () => {
    setupTestDb()
    setPluginAdminConfig('my-plugin', 'api_key', 'sk-secret-1234', 'admin')
    const snapshot = getAdminPluginConfigSnapshot([
      {
        pluginId: 'my-plugin',
        configRequirements: [{ key: 'api_key', label: 'API Key', required: true, sensitive: true, scope: 'admin' }],
      },
    ])
    expect(snapshot.plugins).toHaveLength(1)
    expect(snapshot.plugins[0].pluginId).toBe('my-plugin')
    expect(snapshot.plugins[0].keys[0].key).toBe('api_key')
    expect(snapshot.plugins[0].keys[0].value).toBe('****1234')
    expect(snapshot.plugins[0].keys[0].sensitive).toBe(true)
  })

  it('skips context-scoped config requirements', () => {
    setupTestDb()
    const snapshot = getAdminPluginConfigSnapshot([
      {
        pluginId: 'my-plugin',
        configRequirements: [
          { key: 'timezone', label: 'Timezone', required: false, sensitive: false, scope: 'context' },
        ],
      },
    ])
    expect(snapshot.plugins[0].keys).toEqual([])
  })
})

describe('applyAdminPluginConfigUpdate', () => {
  it('rejects unknown plugin ids', () => {
    setupTestDb()
    expect(() =>
      applyAdminPluginConfigUpdate({ pluginId: 'unknown', key: 'api_key', value: 'test' }, 'admin-1', [
        { pluginId: 'my-plugin', configRequirements: [] },
      ]),
    ).toThrow(AdminPluginConfigError)
  })

  it('rejects undeclared config keys', () => {
    setupTestDb()
    expect(() =>
      applyAdminPluginConfigUpdate({ pluginId: 'my-plugin', key: 'undeclared', value: 'test' }, 'admin-1', [
        {
          pluginId: 'my-plugin',
          configRequirements: [{ key: 'api_key', label: 'API Key', required: true, sensitive: true, scope: 'admin' }],
        },
      ]),
    ).toThrow(AdminPluginConfigError)
  })

  it('stores a valid config update', () => {
    setupTestDb()
    const result = applyAdminPluginConfigUpdate(
      { pluginId: 'my-plugin', key: 'api_key', value: 'sk-new-key' },
      'admin-1',
      [
        {
          pluginId: 'my-plugin',
          configRequirements: [{ key: 'api_key', label: 'API Key', required: true, sensitive: true, scope: 'admin' }],
        },
      ],
    )
    expect(result.key).toBe('api_key')
    expect(result.updatedAt).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/admin-plugin-config.test.ts`
Expected: FAIL — module `admin-plugin-config.ts` does not exist.

- [ ] **Step 3: Implement `admin-plugin-config.ts` business logic**

Create `src/debug/admin-plugin-config.ts`:

```typescript
import { z } from 'zod'

import { logger } from '../logger.js'
import { getPluginAdminConfig, setPluginAdminConfig } from '../plugins/store.js'

const log = logger.child({ scope: 'debug:admin-plugin-config' })

export type AdminPluginConfigKeyState = {
  key: string
  label: string
  value: string | null
  sensitive: boolean
  required: boolean
}

export type AdminPluginConfigEntry = {
  pluginId: string
  keys: AdminPluginConfigKeyState[]
}

export type AdminPluginConfigSnapshot = {
  plugins: AdminPluginConfigEntry[]
}

export type AdminPluginConfigErrorKind = 'bad-plugin' | 'bad-key' | 'bad-value'

export class AdminPluginConfigError extends Error {
  readonly kind: AdminPluginConfigErrorKind
  constructor(kind: AdminPluginConfigErrorKind, message: string) {
    super(message)
    this.name = 'AdminPluginConfigError'
    this.kind = kind
  }
}

export type PluginConfigDescriptor = {
  pluginId: string
  configRequirements: Array<{
    key: string
    label: string
    required: boolean
    sensitive: boolean
    scope: string
  }>
}

function maskSensitive(value: string): string {
  return `****${value.slice(-4)}`
}

export const getAdminPluginConfigSnapshot = (descriptors: PluginConfigDescriptor[]): AdminPluginConfigSnapshot => {
  const plugins: AdminPluginConfigEntry[] = []
  for (const descriptor of descriptors) {
    const adminKeys = descriptor.configRequirements.filter((req) => req.scope === 'admin')
    if (adminKeys.length === 0) continue
    const keys: AdminPluginConfigKeyState[] = adminKeys.map((req) => {
      const raw = getPluginAdminConfig(descriptor.pluginId, req.key)
      return {
        key: req.key,
        label: req.label,
        value: raw === undefined ? null : req.sensitive ? maskSensitive(raw) : raw,
        sensitive: req.sensitive,
        required: req.required,
      }
    })
    plugins.push({ pluginId: descriptor.pluginId, keys })
  }
  return { plugins }
}

const UpdateBodySchema = z.object({
  pluginId: z.string(),
  key: z.string(),
  value: z.string(),
})

export const applyAdminPluginConfigUpdate = (
  body: unknown,
  updatedBy: string,
  descriptors: PluginConfigDescriptor[],
): { pluginId: string; key: string; updatedAt: number } => {
  const parsed = UpdateBodySchema.safeParse(body)
  if (!parsed.success) {
    throw new AdminPluginConfigError('bad-value', 'invalid body shape')
  }

  const descriptor = descriptors.find((d) => d.pluginId === parsed.data.pluginId)
  if (descriptor === undefined) {
    throw new AdminPluginConfigError('bad-plugin', `unknown plugin: ${parsed.data.pluginId}`)
  }

  const requirement = descriptor.configRequirements.find((req) => req.key === parsed.data.key && req.scope === 'admin')
  if (requirement === undefined) {
    throw new AdminPluginConfigError('bad-key', `undeclared or non-admin key: ${parsed.data.key}`)
  }

  const trimmed = parsed.data.value.trim()
  if (trimmed === '') {
    throw new AdminPluginConfigError('bad-value', 'value must be a non-empty string')
  }

  const updatedAt = Date.now()
  setPluginAdminConfig(parsed.data.pluginId, parsed.data.key, trimmed, updatedBy)
  log.info({ pluginId: parsed.data.pluginId, key: parsed.data.key, updatedBy }, 'admin plugin config updated')
  return { pluginId: parsed.data.pluginId, key: parsed.data.key, updatedAt }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/debug/admin-plugin-config.test.ts`
Expected: PASS

- [ ] **Step 5: Implement HTTP route handlers**

Create `src/debug/plugin-config-routes.ts`:

```typescript
import { logger } from '../logger.js'
import { getAllPluginAdminStates } from '../plugins/registry.js'
import {
  AdminPluginConfigError,
  applyAdminPluginConfigUpdate,
  getAdminPluginConfigSnapshot,
  type PluginConfigDescriptor,
} from './admin-plugin-config.js'

const log = logger.child({ scope: 'debug-server:plugin-config-routes' })

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

function buildDescriptors(): PluginConfigDescriptor[] {
  const states = getAllPluginAdminStates()
  return states.map((state) => ({
    pluginId: state.discoveredPlugin.manifest.id,
    configRequirements: state.discoveredPlugin.manifest.configRequirements.map((req) => ({
      key: req.key,
      label: req.label,
      required: req.required,
      sensitive: req.sensitive,
      scope: req.scope,
    })),
  }))
}

export const handleAdminPluginConfigGet = (): Response => {
  const snapshot = getAdminPluginConfigSnapshot(buildDescriptors())
  return jsonResponse(200, snapshot)
}

export const handleAdminPluginConfigPost = async (req: Request): Promise<Response> => {
  const debugToken = process.env['DEBUG_TOKEN']
  if (debugToken === undefined || debugToken === '') {
    log.warn('admin/plugin-config POST refused: DEBUG_TOKEN is not set in env')
    return jsonResponse(401, { error: 'credentials API requires DEBUG_TOKEN' })
  }
  const adminUserId = process.env['ADMIN_USER_ID']
  if (adminUserId === undefined || adminUserId === '') {
    log.error('admin/plugin-config POST refused: ADMIN_USER_ID is not set in env')
    return jsonResponse(503, { error: 'admin user id not configured' })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonResponse(400, { error: 'invalid JSON body' })
  }

  try {
    const result = applyAdminPluginConfigUpdate(body, adminUserId, buildDescriptors())
    return jsonResponse(200, { ok: true, pluginId: result.pluginId, key: result.key, updatedAt: result.updatedAt })
  } catch (err) {
    if (err instanceof AdminPluginConfigError) {
      return jsonResponse(400, { error: err.message })
    }
    log.error({ err: err instanceof Error ? err.message : String(err) }, 'admin/plugin-config POST failed')
    return jsonResponse(500, { error: 'internal server error' })
  }
}
```

- [ ] **Step 6: Mount routes in debug server**

In `src/debug/server.ts`, add imports at the top:

```typescript
import { handleAdminPluginConfigGet, handleAdminPluginConfigPost } from './plugin-config-routes.js'
```

In the `routeAdminPaths` function, add before the `/admin` static file catch-all:

```typescript
if (url.pathname === '/admin/plugin-config') {
  if (req.method === 'GET') return handleAdminPluginConfigGet()
  if (req.method === 'POST') return handleAdminPluginConfigPost(req)
  return new Response('Method not allowed', { status: 405 })
}
```

- [ ] **Step 7: Run all tests to verify no regressions**

Run: `bun test`
Expected: All PASS

- [ ] **Step 8: Commit**

```bash
git add src/debug/admin-plugin-config.ts src/debug/plugin-config-routes.ts src/debug/server.ts tests/debug/admin-plugin-config.test.ts
git commit -m "feat(debug): add admin plugin config GET/POST routes"
```

---

### Task 7: Admin plugin config UI (client-side)

**Files:**

- Modify: `client/shared/api-types.ts`
- Modify: `client/admin/fetcher-schemas.ts`
- Modify: `client/admin/fetchers.ts`
- Create: `client/admin/sections/PluginConfigSection.svelte`
- Create: `client/admin/components/PluginConfigForm.svelte`
- Modify: `client/admin/admin.svelte.ts`
- Modify: `client/admin/AdminApp.svelte`

- [ ] **Step 1: Add shared types**

Add to `client/shared/api-types.ts`:

```typescript
export type AdminPluginConfigKeyState = {
  key: string
  label: string
  value: string | null
  sensitive: boolean
  required: boolean
}

export type AdminPluginConfigEntry = {
  pluginId: string
  keys: AdminPluginConfigKeyState[]
}

export type AdminPluginConfigSnapshot = {
  plugins: AdminPluginConfigEntry[]
}

export type SubmitAdminPluginConfigResponse = {
  ok: true
  pluginId: string
  key: string
  updatedAt: number
}
```

- [ ] **Step 2: Add Zod schemas for fetcher validation**

Add to `client/admin/fetcher-schemas.ts`:

```typescript
const AdminPluginConfigKeyStateSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string().nullable(),
  sensitive: z.boolean(),
  required: z.boolean(),
})

const AdminPluginConfigEntrySchema = z.object({
  pluginId: z.string(),
  keys: z.array(AdminPluginConfigKeyStateSchema),
})

export const AdminPluginConfigSnapshotSchema = z.object({
  plugins: z.array(AdminPluginConfigEntrySchema),
})

export const SubmitAdminPluginConfigResponseSchema = z.object({
  ok: z.literal(true),
  pluginId: z.string(),
  key: z.string(),
  updatedAt: z.number(),
})
```

- [ ] **Step 3: Add fetcher functions**

Add to `client/admin/fetchers.ts`:

```typescript
import { AdminPluginConfigSnapshotSchema, SubmitAdminPluginConfigResponseSchema } from './fetcher-schemas.js'
import type { AdminPluginConfigSnapshot, SubmitAdminPluginConfigResponse } from '../shared/api-types.js'

export async function fetchAdminPluginConfig(): Promise<AdminPluginConfigSnapshot> {
  const response = await fetch('/admin/plugin-config')
  const body = await readBody(response)
  requireOk(response, body)
  return AdminPluginConfigSnapshotSchema.parse(body)
}

export async function submitAdminPluginConfig(input: {
  pluginId: string
  key: string
  value: string
}): Promise<SubmitAdminPluginConfigResponse> {
  const response = await fetch('/admin/plugin-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await readBody(response)
  requireOk(response, body)
  return SubmitAdminPluginConfigResponseSchema.parse(body)
}
```

- [ ] **Step 4: Create `PluginConfigForm.svelte`**

Create `client/admin/components/PluginConfigForm.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import type { AdminPluginConfigSnapshot } from '../../shared/api-types.js'
  import { submitAdminPluginConfig } from '../fetchers.js'

  let { snapshot, onRefresh }: { snapshot: AdminPluginConfigSnapshot | null; onRefresh: () => Promise<void> } = $props()

  let editingKey: { pluginId: string; key: string } | null = $state(null)
  let editValue = $state('')
  let status: { pluginId: string; key: string; message: string; isError: boolean } | null = $state(null)

  function startEdit(pluginId: string, key: string, currentValue: string | null): void {
    editingKey = { pluginId, key }
    editValue = currentValue ?? ''
    status = null
  }

  function cancelEdit(): void {
    editingKey = null
    editValue = ''
    status = null
  }

  async function saveEdit(): Promise<void> {
    if (editingKey === null) return
    try {
      await submitAdminPluginConfig({ pluginId: editingKey.pluginId, key: editingKey.key, value: editValue })
      status = { pluginId: editingKey.pluginId, key: editingKey.key, message: 'Saved', isError: false }
      editingKey = null
      editValue = ''
      await onRefresh()
    } catch (err) {
      status = {
        pluginId: editingKey.pluginId,
        key: editingKey.key,
        message: err instanceof Error ? err.message : String(err),
        isError: true,
      }
    }
  }

  function isEditing(pluginId: string, key: string): boolean {
    return editingKey?.pluginId === pluginId && editingKey?.key === key
  }
</script>

{#if snapshot === null}
  <span class="placeholder">Loading...</span>
{:else if snapshot.plugins.length === 0}
  <p class="empty-state">No plugins with admin-scoped configuration found.</p>
{:else}
  {#each snapshot.plugins as plugin}
    <div class="plugin-config-group">
      <h4>{plugin.pluginId}</h4>
      {#each plugin.keys as configKey}
        <div class="config-row" data-testid="plugin-config-row-{plugin.pluginId}-{configKey.key}">
          <span class="config-label">{configKey.label}</span>
          {#if isEditing(plugin.pluginId, configKey.key)}
            <div class="config-edit">
              <input
                type={configKey.sensitive ? 'password' : 'text'}
                bind:value={editValue}
                placeholder="Enter value"
              />
              <button type="button" onclick={() => { void saveEdit() }}>Save</button>
              <button type="button" onclick={cancelEdit}>Cancel</button>
            </div>
          {:else}
            <span class="config-value">{configKey.value ?? '(not set)'}</span>
            <button type="button" onclick={() => startEdit(plugin.pluginId, configKey.key, configKey.value)}>Edit</button>
          {/if}
          {#if status !== null && status.pluginId === plugin.pluginId && status.key === configKey.key}
            <span class={status.isError ? 'status-error' : 'status-ok'}>{status.message}</span>
          {/if}
        </div>
      {/each}
    </div>
  {/each}
{/if}
```

- [ ] **Step 5: Create `PluginConfigSection.svelte`**

Create `client/admin/sections/PluginConfigSection.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { untrack } from 'svelte'

  import type { AdminPluginConfigSnapshot } from '../../shared/api-types.js'
  import PluginConfigForm from '../components/PluginConfigForm.svelte'
  import { fetchAdminPluginConfig } from '../fetchers.js'

  let snapshot: AdminPluginConfigSnapshot | null = $state(null)
  let error: string | null = $state(null)
  let fetching = $state(false)

  async function load(): Promise<void> {
    snapshot = await fetchAdminPluginConfig()
  }

  async function refreshAll(): Promise<void> {
    error = null
    fetching = true
    try {
      await load()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      fetching = false
    }
  }

  $effect(() => {
    untrack(() => {
      void refreshAll()
    })
  })
</script>

<section id="plugin-config" class="plugin-config-section admin-section">
  <header class="section-header">
    <div>
      <p class="eyebrow">Plugins</p>
      <h2 data-testid="admin-section-title">Plugin Configuration</h2>
    </div>
    <button
      type="button"
      data-testid="plugin-config-refresh"
      onclick={() => { void refreshAll() }}>{fetching ? 'Refreshing...' : 'Refresh'}</button>
  </header>

  {#if error !== null}
    <p class="status-error">{error}</p>
  {/if}

  <p class="admin-plugin-config__note">POST /admin/plugin-config requires DEBUG_TOKEN</p>
  <PluginConfigForm {snapshot} onRefresh={load} />
</section>

<style>
  .admin-plugin-config__note {
    color: var(--fg3);
    font-family: var(--font-mono);
    font-size: 11px;
    margin: 8px 12px 0;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
</style>
```

- [ ] **Step 6: Register section in admin app**

In `client/admin/admin.svelte.ts`, add to `adminSections`:

```typescript
export const adminSections = [
  { id: 'overview', label: 'Overview' },
  { id: 'billing', label: 'Billing' },
  { id: 'stats', label: 'Stats' },
  { id: 'memos', label: 'Memos' },
  { id: 'reminders', label: 'Reminders' },
  { id: 'identities', label: 'Identities' },
  { id: 'groups', label: 'Groups' },
  { id: 'instances', label: 'Instances' },
  { id: 'plugin-config', label: 'Plugin Config' },
  { id: 'system', label: 'System' },
] as const
```

In `client/admin/AdminApp.svelte`, add the import:

```typescript
import PluginConfigSection from './sections/PluginConfigSection.svelte'
```

Add `'plugin-config'` to `sectionIds`:

```typescript
const sectionIds = [
  'overview',
  'billing',
  'stats',
  'memos',
  'reminders',
  'identities',
  'groups',
  'instances',
  'plugin-config',
  'system',
]
```

Add `<PluginConfigSection />` before `<SystemSection />` in the main content:

```svelte
<main class="admin-grid__main">
  <OverviewSection />
  <BillingSection />
  <StatsSection />
  <MemosSection />
  <RemindersSection />
  <IdentitiesSection />
  <GroupsSection />
  <InstancesSection />
  <PluginConfigSection />
  <SystemSection />
</main>
```

- [ ] **Step 7: Build client to verify no compilation errors**

Run: `bun build:client`
Expected: Build succeeds with no errors.

- [ ] **Step 8: Commit**

```bash
git add client/
git commit -m "feat(admin): add plugin config section to admin UI"
```

---

### Task 8: Create the `synthetic-web-search` plugin

**Files:**

- Create: `plugins/synthetic-web-search/plugin.json`
- Create: `plugins/synthetic-web-search/index.ts`
- Create: `tests/plugins/synthetic-web-search.test.ts`

- [ ] **Step 1: Write failing tests for the plugin tool**

Create `tests/plugins/synthetic-web-search.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from 'bun:test'
import { mock } from 'bun:test'

import { setupTestDb } from '../utils/test-helpers.js'

describe('synthetic-web-search plugin', () => {
  let mockFetch: ReturnType<typeof mock>

  beforeEach(() => {
    setupTestDb()
    mockFetch = mock(async (url: string, init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          results: [
            { url: 'https://example.com/a', title: 'Result A', text: 'Content A', published: '2026-01-01T00:00:00Z' },
            { url: 'https://example.com/b', title: 'Result B', text: 'Content B' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })
  })

  it('returns search results from the API', async () => {
    const factory = (await import('../../plugins/synthetic-web-search/index.js')).default
    const instance = factory()

    const registeredTools: Array<{ name: string; execute: Function }> = []
    const ctx = {
      pluginId: 'synthetic-web-search',
      contextId: '__system__',
      permissions: new Set(['http']),
      adminConfig: { get: (key: string) => (key === 'api_key' ? 'sk-test-key' : undefined) },
      providerRuntime: {
        httpFetch: mockFetch as any,
        allowedHosts: new Set(['api.synthetic.new']),
        logger: { debug() {}, info() {}, warn() {}, error() {} },
      },
      kv: {
        get() {
          return undefined
        },
        set() {},
        delete() {},
        list() {
          return []
        },
      },
      log: { debug() {}, info() {}, warn() {}, error() {} },
      registration: {
        registerTool(tool: any) {
          registeredTools.push(tool)
        },
        registerPromptFragment() {},
        registerCommand() {},
        registerScheduledJob() {},
        registerTaskProviderType() {},
      },
    }

    instance.activate(ctx as any)

    const searchTool = registeredTools.find((t) => t.name === 'search')
    expect(searchTool).toBeDefined()

    const result = await searchTool!.execute(
      { query: 'test query' },
      {
        pluginId: 'synthetic-web-search',
        storageContextId: 'ctx-1',
        chatUserId: 'user-1',
        rateLimit: { check: () => ({ allowed: true }) },
        taskProvider: {} as any,
        kv: ctx.kv,
      },
      { toolCallId: 'call-1' },
    )

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.synthetic.new/v2/search',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result).toHaveProperty('results')
    expect((result as any).results).toHaveLength(2)
  })

  it('returns rate_limited error when rate limit is exceeded', async () => {
    const factory = (await import('../../plugins/synthetic-web-search/index.js')).default
    const instance = factory()

    const registeredTools: Array<{ name: string; execute: Function }> = []
    const ctx = {
      pluginId: 'synthetic-web-search',
      contextId: '__system__',
      permissions: new Set(['http']),
      adminConfig: { get: (key: string) => (key === 'api_key' ? 'sk-test-key' : undefined) },
      providerRuntime: {
        httpFetch: mockFetch as any,
        allowedHosts: new Set(['api.synthetic.new']),
        logger: { debug() {}, info() {}, warn() {}, error() {} },
      },
      kv: {
        get() {
          return undefined
        },
        set() {},
        delete() {},
        list() {
          return []
        },
      },
      log: { debug() {}, info() {}, warn() {}, error() {} },
      registration: {
        registerTool(tool: any) {
          registeredTools.push(tool)
        },
        registerPromptFragment() {},
        registerCommand() {},
        registerScheduledJob() {},
        registerTaskProviderType() {},
      },
    }

    instance.activate(ctx as any)

    const searchTool = registeredTools.find((t) => t.name === 'search')
    const result = await searchTool!.execute(
      { query: 'test query' },
      {
        pluginId: 'synthetic-web-search',
        storageContextId: 'ctx-1',
        chatUserId: 'user-1',
        rateLimit: { check: () => ({ allowed: false, retryAfterSec: 120 }) },
        taskProvider: {} as any,
        kv: ctx.kv,
      },
      { toolCallId: 'call-1' },
    )

    expect(result).toEqual({ error: 'rate_limited', retryAfterSec: 120 })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('applies index filter to return a single result', async () => {
    const factory = (await import('../../plugins/synthetic-web-search/index.js')).default
    const instance = factory()

    const registeredTools: Array<{ name: string; execute: Function }> = []
    const ctx = {
      pluginId: 'synthetic-web-search',
      contextId: '__system__',
      permissions: new Set(['http']),
      adminConfig: { get: (key: string) => (key === 'api_key' ? 'sk-test-key' : undefined) },
      providerRuntime: {
        httpFetch: mockFetch as any,
        allowedHosts: new Set(['api.synthetic.new']),
        logger: { debug() {}, info() {}, warn() {}, error() {} },
      },
      kv: {
        get() {
          return undefined
        },
        set() {},
        delete() {},
        list() {
          return []
        },
      },
      log: { debug() {}, info() {}, warn() {}, error() {} },
      registration: {
        registerTool(tool: any) {
          registeredTools.push(tool)
        },
        registerPromptFragment() {},
        registerCommand() {},
        registerScheduledJob() {},
        registerTaskProviderType() {},
      },
    }

    instance.activate(ctx as any)

    const searchTool = registeredTools.find((t) => t.name === 'search')
    const result = await searchTool!.execute(
      { query: 'test query', index: 1 },
      {
        pluginId: 'synthetic-web-search',
        storageContextId: 'ctx-1',
        chatUserId: 'user-1',
        rateLimit: { check: () => ({ allowed: true }) },
        taskProvider: {} as any,
        kv: ctx.kv,
      },
      { toolCallId: 'call-1' },
    )

    expect((result as any).results).toHaveLength(1)
    expect((result as any).results[0].title).toBe('Result B')
  })

  it('returns error for out-of-range index', async () => {
    const factory = (await import('../../plugins/synthetic-web-search/index.js')).default
    const instance = factory()

    const registeredTools: Array<{ name: string; execute: Function }> = []
    const ctx = {
      pluginId: 'synthetic-web-search',
      contextId: '__system__',
      permissions: new Set(['http']),
      adminConfig: { get: (key: string) => (key === 'api_key' ? 'sk-test-key' : undefined) },
      providerRuntime: {
        httpFetch: mockFetch as any,
        allowedHosts: new Set(['api.synthetic.new']),
        logger: { debug() {}, info() {}, warn() {}, error() {} },
      },
      kv: {
        get() {
          return undefined
        },
        set() {},
        delete() {},
        list() {
          return []
        },
      },
      log: { debug() {}, info() {}, warn() {}, error() {} },
      registration: {
        registerTool(tool: any) {
          registeredTools.push(tool)
        },
        registerPromptFragment() {},
        registerCommand() {},
        registerScheduledJob() {},
        registerTaskProviderType() {},
      },
    }

    instance.activate(ctx as any)

    const searchTool = registeredTools.find((t) => t.name === 'search')
    const result = await searchTool!.execute(
      { query: 'test query', index: 5 },
      {
        pluginId: 'synthetic-web-search',
        storageContextId: 'ctx-1',
        chatUserId: 'user-1',
        rateLimit: { check: () => ({ allowed: true }) },
        taskProvider: {} as any,
        kv: ctx.kv,
      },
      { toolCallId: 'call-1' },
    )

    expect(result).toHaveProperty('error', 'index_out_of_range')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/synthetic-web-search.test.ts`
Expected: FAIL — plugin module does not exist.

- [ ] **Step 3: Create plugin manifest**

Create `plugins/synthetic-web-search/plugin.json`:

```json
{
  "id": "synthetic-web-search",
  "name": "Synthetic Web Search",
  "version": "1.0.0",
  "description": "Web search via Synthetic Search API",
  "apiVersion": 1,
  "main": "index.ts",
  "contributes": {
    "tools": ["search"],
    "promptFragments": ["web-search-hint"]
  },
  "permissions": ["http"],
  "providerAllowedHosts": ["api.synthetic.new"],
  "defaultEnabled": false,
  "configRequirements": [
    {
      "key": "api_key",
      "label": "Synthetic API Key",
      "required": true,
      "sensitive": true,
      "scope": "admin"
    }
  ],
  "activationTimeoutMs": 3000
}
```

- [ ] **Step 4: Create plugin entry point**

Create `plugins/synthetic-web-search/index.ts`:

```typescript
import { z } from 'zod'

import type { PluginContext } from '../../src/plugins/context.js'
import type { PluginFactory, PluginToolRuntimeContext } from '../../src/plugins/types.js'

const API_ENDPOINT = 'https://api.synthetic.new/v2/search'

const searchInputSchema = z.object({
  query: z.string().max(400),
  max_length: z.number().int().min(0).max(10000).optional().default(0),
  index: z.number().int().min(0).optional(),
})

const searchResultSchema = z.object({
  url: z.string(),
  title: z.string(),
  text: z.string(),
  published: z.string().optional(),
})

const searchResponseSchema = z.object({
  results: z.array(searchResultSchema),
})

type SearchResult = z.infer<typeof searchResultSchema>

function truncate(text: string, maxLength: number): string {
  if (maxLength <= 0) return text
  return text.length > maxLength ? text.slice(0, maxLength) + '...' : text
}

const factory: PluginFactory = () => {
  let apiKey: string | undefined
  let httpFetch: ((url: string, init?: RequestInit) => Promise<Response>) | undefined

  return {
    activate(ctx: PluginContext): void {
      apiKey = ctx.adminConfig.get('api_key')
      httpFetch = ctx.providerRuntime?.httpFetch

      ctx.log.info({}, 'synthetic-web-search plugin activated')

      ctx.registration.registerTool({
        name: 'search',
        description: 'Uses a search engine which returns title, url, and content in markdown',
        inputSchema: searchInputSchema,
        async execute(input: unknown, runtimeContext: PluginToolRuntimeContext): Promise<unknown> {
          const rateResult = runtimeContext.rateLimit.check(runtimeContext.storageContextId)
          if (!rateResult.allowed) {
            return { error: 'rate_limited', retryAfterSec: rateResult.retryAfterSec }
          }

          if (apiKey === undefined || httpFetch === undefined) {
            return { error: 'not_configured', message: 'Synthetic API key is not configured' }
          }

          const parsed = searchInputSchema.parse(input)

          try {
            const response = await httpFetch(API_ENDPOINT, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ query: parsed.query }),
            })

            if (!response.ok) {
              const errorText = await response.text()
              return { error: 'api_error', status: response.status, message: errorText }
            }

            const data = await response.json()
            const validated = searchResponseSchema.parse(data)

            if (validated.results.length === 0) {
              return { results: [] }
            }

            let selectedResults: SearchResult[] = validated.results

            if (parsed.index !== undefined) {
              if (parsed.index >= validated.results.length) {
                return {
                  error: 'index_out_of_range',
                  message: `Index ${parsed.index} is out of range (only ${validated.results.length} results available)`,
                }
              }
              selectedResults = [validated.results[parsed.index]]
            }

            let charsPerResult = Infinity
            if (parsed.max_length > 0 && selectedResults.length > 0) {
              charsPerResult = Math.floor(parsed.max_length / selectedResults.length)
            }

            return {
              results: selectedResults.map((result) => ({
                title: result.title,
                url: result.url,
                text: truncate(result.text, charsPerResult),
                published: result.published,
              })),
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            if (err instanceof Error && err.name === 'AbortError') {
              return { error: 'timeout', message }
            }
            return { error: 'network_error', message }
          }
        },
      })

      ctx.registration.registerPromptFragment({
        name: 'web-search-hint',
        content:
          'When the user asks a question that requires up-to-date information not in your training data, use the search tool to find relevant web content. Use web_fetch to read full page content when a search result looks promising.',
      })
    },

    deactivate(ctx: PluginContext): void {
      ctx.log.info({}, 'synthetic-web-search plugin deactivated')
    },
  }
}

export default factory
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/plugins/synthetic-web-search.test.ts`
Expected: PASS

- [ ] **Step 6: Run full test suite to verify no regressions**

Run: `bun test`
Expected: All PASS

- [ ] **Step 7: Run lint and typecheck**

Run: `bun lint && bun typecheck`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add plugins/synthetic-web-search/ tests/plugins/synthetic-web-search.test.ts
git commit -m "feat(plugins): add synthetic-web-search plugin with search tool"
```

---

### Task 9: Final verification

- [ ] **Step 1: Run the full check suite**

Run: `bun check:verbose`
Expected: All checks pass (lint, typecheck, format:check, knip, test, duplicates).

- [ ] **Step 2: Run format check**

Run: `bun format:check`
Expected: No formatting issues.

- [ ] **Step 3: Build client**

Run: `bun build:client`
Expected: Build succeeds.

- [ ] **Step 4: Verify plugin discovery works**

Run a quick smoke test — start the bot with `DEBUG_SERVER=true` and verify the plugin appears in `/plugin list` output (or check the debug server admin UI loads the plugin config section). This step is optional if Docker/E2E setup is not available locally.

- [ ] **Step 5: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "chore: fixups from final verification"
```
