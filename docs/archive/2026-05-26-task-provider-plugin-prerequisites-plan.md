<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Task-Provider-as-Plugin — Phase 3 Prerequisites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make per-context credentials reach any task-provider factory through a config-scope concept, collapse the special-cased `buildKaneoConfig`/`buildYouTrackConfig` into one generic descriptor-driven merge, and close the dangling Phase-2 items — so a Phase-3 plugin migration becomes a pure code-move.

**Architecture:** A `scope: 'instance' | 'user'` tag on each provider config field. The resolver reads instance-scoped fields from `task_instances.config` and user-scoped fields from per-context config via a small core read adapter, merges them into one flat record, and hands it to the unchanged `(config) => TaskProvider` factory. Kaneo's API-key-vs-session-cookie branching moves into its factory. The admin instance form and config masking become descriptor-driven; plugin-vs-plugin duplicate registration becomes first-wins; `providerConfigValidator` is invoked before persist; a `papai/plugin-types` import alias is added.

**Tech Stack:** Bun, TypeScript (strict), Zod v4, Drizzle/SQLite, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-05-26-task-provider-plugin-prerequisites-design.md`

---

## File Structure

| File                                     | Responsibility                                                                                | Change                                                                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/providers/types.ts`                 | `ProviderConfigRequirement` type                                                              | add `scope?` field                                                                                                     |
| `src/plugins/types.ts`                   | `pluginConfigRequirementSchema` Zod schema                                                    | add `scope` field                                                                                                      |
| `src/providers/registry.ts`              | built-in descriptor seeds, capabilities, factories, duplicate registration, descriptor lookup | expand seeds, bake capabilities, move Kaneo credential branching into factory, first-wins, `getTaskProviderDescriptor` |
| `src/providers/resolver.ts`              | descriptor-driven config merge + read adapter                                                 | replace `buildKaneoConfig`/`buildYouTrackConfig`                                                                       |
| `src/debug/task-provider-type-routes.ts` | `/api/task-provider-types` serialization                                                      | filter to instance-scoped fields                                                                                       |
| `src/instances/encryption.ts`            | `maskConfig`                                                                                  | accept an explicit sensitive-key set                                                                                   |
| `src/debug/instance-routes.ts`           | task-instance masking + create validation                                                     | descriptor-driven masking; call `providerConfigValidator`                                                              |
| `src/plugins/context.ts`                 | `registerTaskProviderType` wrapper                                                            | thread optional `validateConfig`                                                                                       |
| `src/providers/public-types.ts`          | **new** stable re-export surface                                                              | create                                                                                                                 |
| `package.json` / `tsconfig.json`         | `papai/plugin-types` alias                                                                    | add `exports` + `paths`                                                                                                |
| `tests/providers/resolver.test.ts`       | resolver behavior                                                                             | update to `credential` shape                                                                                           |
| `tests/providers/registry.test.ts`       | registry behavior                                                                             | extend                                                                                                                 |
| `tests/plugins/*.test.ts`                | manifest schema, validator wiring, first-wins                                                 | extend/add                                                                                                             |
| `tests/instances/encryption.test.ts`     | masking                                                                                       | extend                                                                                                                 |
| `tests/providers/public-types.test.ts`   | **new** alias surface                                                                         | create                                                                                                                 |

---

## Task 1: Add `scope` to config-requirement types

**Files:**

- Modify: `src/providers/types.ts:77`
- Modify: `src/plugins/types.ts:147-152`
- Test: `tests/plugins/manifest-schema.test.ts` (create if absent; otherwise add to the existing manifest-schema suite)

- [ ] **Step 1: Write the failing test**

Find the existing manifest-schema test file first: `grep -rl "pluginManifestSchema" tests/plugins`. Add to it (or create `tests/plugins/manifest-schema.test.ts`):

```typescript
import { describe, expect, test } from 'bun:test'

import { pluginManifestSchema } from '../../src/plugins/types.js'

describe('pluginManifestSchema providerConfigSchema scope', () => {
  const base = {
    id: 'p',
    name: 'P',
    version: '1.0.0',
    description: 'd',
    apiVersion: 1,
    permissions: ['provider.task'],
    contributes: { taskProviderTypes: ['p'] },
  }

  test('defaults provider config field scope to instance', () => {
    const parsed = pluginManifestSchema.parse({
      ...base,
      providerConfigSchema: [{ key: 'baseUrl', label: 'URL', required: true }],
    })
    expect(parsed.providerConfigSchema[0]?.scope).toBe('instance')
  })

  test('accepts an explicit user scope', () => {
    const parsed = pluginManifestSchema.parse({
      ...base,
      providerConfigSchema: [{ key: 'apiKey', label: 'Key', required: true, sensitive: true, scope: 'user' }],
    })
    expect(parsed.providerConfigSchema[0]?.scope).toBe('user')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/manifest-schema.test.ts`
Expected: FAIL — `scope` is `undefined` (schema strips unknown key / no default).

- [ ] **Step 3: Add `scope` to the TS type**

In `src/providers/types.ts`, replace line 77:

```typescript
/** Configuration keys that a provider requires to function. */
export type ProviderConfigRequirement = {
  key: string
  label: string
  required: boolean
  sensitive?: boolean
  /** Where the value is sourced: instance config (shared) or per-context config (per user). Default 'instance'. */
  scope?: 'instance' | 'user'
}
```

- [ ] **Step 4: Add `scope` to the Zod schema**

In `src/plugins/types.ts`, update `pluginConfigRequirementSchema` (around line 147):

```typescript
const pluginConfigRequirementSchema = z.object({
  key: configKeySchema,
  label: z.string().min(1),
  required: z.boolean(),
  sensitive: z.boolean().optional().default(false),
  scope: z.enum(['instance', 'user']).optional().default('instance'),
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/plugins/manifest-schema.test.ts`
Expected: PASS

- [ ] **Step 6: Typecheck**

Run: `bun typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/providers/types.ts src/plugins/types.ts tests/plugins/manifest-schema.test.ts
git commit -m "feat(providers): add scope field to provider config requirements"
```

---

## Task 2: Complete built-in descriptors; filter type-routes to instance scope

**Files:**

- Modify: `src/providers/registry.ts:150-161`
- Modify: `src/debug/task-provider-type-routes.ts`
- Test: `tests/providers/registry.test.ts`, `tests/debug/task-provider-type-routes.test.ts` (extend; create the latter if absent)

- [ ] **Step 1: Write the failing registry test**

Add to `tests/providers/registry.test.ts`:

```typescript
import { listTaskProviderTypes } from '../../src/providers/registry.js'

describe('listTaskProviderTypes built-in scopes', () => {
  test('kaneo declares instance baseUrl and user credential + workspaceId', () => {
    const kaneo = listTaskProviderTypes().find((d) => d.type === 'kaneo')
    const byKey = Object.fromEntries((kaneo?.configSchema ?? []).map((f) => [f.key, f]))
    expect(byKey['baseUrl']?.scope ?? 'instance').toBe('instance')
    expect(byKey['credential']?.scope).toBe('user')
    expect(byKey['credential']?.sensitive).toBe(true)
    expect(byKey['workspaceId']?.scope).toBe('user')
  })

  test('youtrack declares instance baseUrl and user token', () => {
    const yt = listTaskProviderTypes().find((d) => d.type === 'youtrack')
    const byKey = Object.fromEntries((yt?.configSchema ?? []).map((f) => [f.key, f]))
    expect(byKey['baseUrl']?.scope ?? 'instance').toBe('instance')
    expect(byKey['token']?.scope).toBe('user')
    expect(byKey['token']?.sensitive).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/providers/registry.test.ts -t "built-in scopes"`
Expected: FAIL — `credential`/`workspaceId`/`token` not present in the seed configSchema.

- [ ] **Step 3: Expand the built-in descriptor seeds**

In `src/providers/registry.ts`, replace `builtinDescriptorSeeds` (lines 150-161):

```typescript
const builtinDescriptorSeeds: readonly BuiltinDescriptorSeed[] = [
  {
    type: 'kaneo',
    displayName: 'Kaneo',
    configSchema: [
      { key: 'baseUrl', label: 'Kaneo URL', required: true, sensitive: false, scope: 'instance' },
      { key: 'internalUrl', label: 'Kaneo Internal URL', required: false, sensitive: false, scope: 'instance' },
      { key: 'credential', label: 'Kaneo API Key', required: true, sensitive: true, scope: 'user' },
      { key: 'workspaceId', label: 'Workspace ID', required: true, sensitive: false, scope: 'user' },
    ],
  },
  {
    type: 'youtrack',
    displayName: 'YouTrack',
    configSchema: [
      { key: 'baseUrl', label: 'YouTrack URL', required: true, sensitive: false, scope: 'instance' },
      { key: 'token', label: 'YouTrack Permanent Token', required: true, sensitive: true, scope: 'user' },
    ],
  },
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/providers/registry.test.ts -t "built-in scopes"`
Expected: PASS

- [ ] **Step 5: Write the failing type-routes test**

The `/api/task-provider-types` response feeds the admin instance form, which must only show instance-scoped fields (credentials are entered per-context in `/setup`). Add to `tests/debug/task-provider-type-routes.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'

import { handleTaskProviderTypes } from '../../src/debug/task-provider-type-routes.js'

describe('handleTaskProviderTypes scope filtering', () => {
  test('omits user-scoped fields from the catalog response', async () => {
    const res = await handleTaskProviderTypes(
      new Request('http://x/api/task-provider-types'),
      new URL('http://x/api/task-provider-types'),
    )
    const body = (await res?.json()) as Array<{ type: string; configSchema: Array<{ key: string }> }>
    const kaneo = body.find((d) => d.type === 'kaneo')
    const keys = (kaneo?.configSchema ?? []).map((f) => f.key)
    expect(keys).toContain('baseUrl')
    expect(keys).not.toContain('credential')
    expect(keys).not.toContain('workspaceId')
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `bun test tests/debug/task-provider-type-routes.test.ts`
Expected: FAIL — `credential`/`workspaceId` currently included.

- [ ] **Step 7: Filter the serialization to instance scope**

In `src/debug/task-provider-type-routes.ts`, update `taskProviderTypeView` to drop user-scoped fields:

```typescript
const taskProviderTypeView = (descriptor: TaskProviderTypeDescriptor): TaskProviderTypeView => ({
  type: descriptor.type,
  displayName: descriptor.displayName,
  configSchema: descriptor.configSchema
    .filter((field) => (field.scope ?? 'instance') === 'instance')
    .map((field) => ({
      key: field.key,
      label: field.label,
      required: field.required,
      sensitive: field.sensitive ?? false,
    })),
  capabilities: [...descriptor.capabilities],
  source: descriptor.source,
})
```

- [ ] **Step 8: Run both tests to verify they pass**

Run: `bun test tests/debug/task-provider-type-routes.test.ts tests/providers/registry.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/providers/registry.ts src/debug/task-provider-type-routes.ts tests/providers/registry.test.ts tests/debug/task-provider-type-routes.test.ts
git commit -m "feat(providers): complete built-in provider descriptors with scoped fields"
```

---

## Task 3: Descriptor-driven resolver merge + Kaneo credential in factory

This task changes the resolver's output config shape for Kaneo (now `credential` instead of `apiKey`/`sessionCookie`) and moves the branching into the Kaneo factory. Resolver, factory, and their tests change together so the suite stays green.

**Files:**

- Modify: `src/providers/registry.ts` (add `getTaskProviderDescriptor`; update `createKaneoProvider`)
- Modify: `src/providers/resolver.ts` (replace `buildKaneoConfig`/`buildYouTrackConfig`)
- Test: `tests/providers/resolver.test.ts`, `tests/providers/registry.test.ts`

- [ ] **Step 1: Add descriptor lookup to the registry**

In `src/providers/registry.ts`, after `listTaskProviderTypes` (after line 182):

```typescript
/** Look up a single task-provider type descriptor (built-in or contributed). */
export function getTaskProviderDescriptor(type: string): TaskProviderTypeDescriptor | undefined {
  return listTaskProviderTypes().find((descriptor) => descriptor.type === type)
}
```

- [ ] **Step 2: Update the resolver tests to the new `credential` shape (this is the failing gate)**

This is the deterministic red for the whole task. The resolver currently emits `apiKey`/`sessionCookie` for Kaneo; after the merge it emits a single `credential`. `makeResolver` in this suite injects only `createProvider` (`Partial<TaskProviderResolverDeps>`) and inherits everything else from `defaultDeps`, so removing `isKaneoSessionCookie` from / adding `getTaskProviderDescriptor` to the deps needs **no** test-helper edit — only these two assertions change.

In `tests/providers/resolver.test.ts`, replace the assertion in the "API key" test (lines 84-86):

```typescript
expect(created).toEqual([
  { name: 'kaneo', config: { baseUrl: 'https://kaneo.invalid', credential: 'kn-key', workspaceId: 'workspace-1' } },
])
```

Replace the assertion in the "session cookie" test (lines 104-113):

```typescript
expect(created).toEqual([
  {
    name: 'kaneo',
    config: {
      baseUrl: 'https://kaneo.invalid',
      credential: 'better-auth.session_token=abc',
      workspaceId: 'workspace-1',
    },
  },
])
```

The YouTrack test (lines 62-72) and the contributed-passthrough test (lines 131-145) remain unchanged and must still pass: YouTrack reads `url`→`baseUrl` + `token`; `demo-tracker` has no descriptor and falls through to `{ ...instance.config }`.

- [ ] **Step 3: Run the resolver test to verify it fails**

Run: `bun test tests/providers/resolver.test.ts -t "Kaneo"`
Expected: FAIL — `created` still contains `apiKey` / `sessionCookie` (old `buildKaneoConfig`), but the test now expects a single `credential` key.

- [ ] **Step 4: Move credential branching into the Kaneo factory**

In `src/providers/registry.ts`, replace `createKaneoProvider` (lines 25-36). Import `isKaneoSessionCookie` at the top of the file:

```typescript
import { isKaneoSessionCookie, KaneoProvider, type KaneoConfig } from './kaneo/index.js'
```

(If `isKaneoSessionCookie` is not re-exported from `./kaneo/index.js`, add `export { isKaneoSessionCookie } from './client.js'` to `src/providers/kaneo/index.ts`.)

```typescript
/** Register the built-in Kaneo provider. */
const createKaneoProvider: ProviderFactory = (config) => {
  const baseUrl = configValue(config, 'baseUrl')
  const workspaceId = configValue(config, 'workspaceId')
  const credential = configValue(config, 'credential')

  const kaneoConfig: KaneoConfig = isKaneoSessionCookie(credential)
    ? { apiKey: '', baseUrl, sessionCookie: credential }
    : { apiKey: credential, baseUrl }

  return new KaneoProvider(kaneoConfig, workspaceId)
}
```

- [ ] **Step 5: Replace the resolver build functions with the generic merge**

In `src/providers/resolver.ts`, remove `resolveBaseUrl`, `buildKaneoConfig`, `buildYouTrackConfig` (lines 36-82) and replace with the read adapter + generic merge. Update imports: remove the now-unused `isKaneoSessionCookie` import; add `getTaskProviderDescriptor` and the descriptor type from the registry.

```typescript
import { createProvider, getTaskProviderDescriptor } from './registry.js'
import type { TaskProviderTypeDescriptor } from './registry.js'
```

Add the read adapter and merge (replacing the removed functions):

```typescript
/**
 * Source a user-scoped config field for a built-in provider type from per-context storage.
 * This is the single place that knows storage-key and special-store mappings. Plugin types
 * keep the same mappings keyed by type when they migrate; pure-instance contributed types
 * never reach this branch.
 */
const readUserScopedField = (
  type: string,
  fieldKey: string,
  contextId: string,
  deps: TaskProviderResolverDeps,
): string | null => {
  if (type === 'kaneo' && fieldKey === 'credential') return deps.getConfig(contextId, 'kaneo_apikey')
  if (type === 'kaneo' && fieldKey === 'workspaceId') return deps.getKaneoWorkspace(contextId)
  if (type === 'youtrack' && fieldKey === 'token') return deps.getConfig(contextId, 'youtrack_token')
  return null
}

const readInstanceScopedField = (instance: TaskInstance, fieldKey: string): string | undefined => {
  const value = instance.config[fieldKey]
  if (value !== undefined) return value
  // Back-compat: some instances persist the URL under the legacy `url` key.
  if (fieldKey === 'baseUrl') return instance.config['url']
  return undefined
}

const buildConfigFromDescriptor = (
  contextId: string,
  instance: TaskInstance,
  descriptor: TaskProviderTypeDescriptor,
  deps: TaskProviderResolverDeps,
): Record<string, string> | null => {
  const merged: Record<string, string> = {}
  const missing: string[] = []
  for (const field of descriptor.configSchema) {
    const scope = field.scope ?? 'instance'
    const raw =
      scope === 'instance'
        ? readInstanceScopedField(instance, field.key)
        : (readUserScopedField(instance.type, field.key, contextId, deps) ?? undefined)
    if (raw !== undefined && raw !== '') {
      merged[field.key] = raw
    } else if (field.required) {
      missing.push(field.key)
    }
  }
  if (missing.length > 0) {
    log.warn(
      { contextId, taskInstanceId: instance.id, taskProvider: instance.type, missing },
      'Cannot resolve task provider: missing config',
    )
    return null
  }
  return merged
}
```

Then add `getTaskProviderDescriptor` to `TaskProviderResolverDeps` and `defaultDeps`:

```typescript
export interface TaskProviderResolverDeps {
  getContextSettings: typeof getContextSettings
  getTaskInstance: typeof getTaskInstance
  getConfig: typeof getConfig
  getKaneoWorkspace: typeof getKaneoWorkspace
  getTaskProviderDescriptor: typeof getTaskProviderDescriptor
  createProvider: typeof createProvider
}

const defaultDeps: TaskProviderResolverDeps = {
  getContextSettings,
  getTaskInstance,
  getConfig,
  getKaneoWorkspace,
  getTaskProviderDescriptor,
  createProvider,
}
```

(Remove `isKaneoSessionCookie` from `TaskProviderResolverDeps`, `defaultDeps`, and the import — it is no longer used by the resolver.)

Replace the config-building block in `resolve()` (lines 111-117):

```typescript
const descriptor = this.deps.getTaskProviderDescriptor(instance.type)
const config =
  descriptor === undefined
    ? { ...instance.config }
    : buildConfigFromDescriptor(contextId, instance, descriptor, this.deps)
if (config === null) return null
```

- [ ] **Step 6: Add a Kaneo factory characterization guard**

The resolver test (Step 2) only checks the merged config shape because `makeResolver` stubs `createProvider`, so it never exercises the factory's credential branching. This guard documents that the real factory accepts the merged `credential` key and constructs a Kaneo provider for both an API key and a session cookie without throwing. It passes after Steps 4-5 (it characterizes the contract rather than driving it — the resolver test is the red).

Add to `tests/providers/registry.test.ts`:

```typescript
import { createProvider } from '../../src/providers/registry.js'

describe('createProvider kaneo credential branching', () => {
  test('treats a non-cookie credential as an API key', () => {
    const provider = createProvider('kaneo', { baseUrl: 'https://k.invalid', credential: 'kn-key', workspaceId: 'w' })
    expect(provider.name).toBe('kaneo')
  })

  test('treats a session-cookie credential as a cookie', () => {
    const provider = createProvider('kaneo', {
      baseUrl: 'https://k.invalid',
      credential: 'better-auth.session_token=abc',
      workspaceId: 'w',
    })
    expect(provider.name).toBe('kaneo')
  })
})
```

Run: `bun test tests/providers/registry.test.ts -t "credential branching"`
Expected: PASS.

- [ ] **Step 7: Run the resolver and registry suites**

Run: `bun test tests/providers/resolver.test.ts tests/providers/registry.test.ts`
Expected: PASS (all cases incl. unchanged YouTrack and demo-tracker passthrough).

- [ ] **Step 8: Typecheck**

Run: `bun typecheck`
Expected: no errors (confirms no dangling `isKaneoSessionCookie`/`resolveBaseUrl` references).

- [ ] **Step 9: Commit**

```bash
git add src/providers/registry.ts src/providers/resolver.ts src/providers/kaneo/index.ts tests/providers/resolver.test.ts tests/providers/registry.test.ts
git commit -m "refactor(providers): descriptor-driven resolver merge; Kaneo credential branching in factory"
```

---

## Task 4: Capability resolution cleanup

Remove the dummy-credential provider construction used only to read capabilities.

**Files:**

- Modify: `src/providers/registry.ts` (`BuiltinDescriptorSeed`, seeds, `listTaskProviderTypes`, `getCapabilitiesForTaskInstance`; remove `capabilityConfigForTaskInstance`)
- Test: `tests/providers/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/providers/registry.test.ts`:

```typescript
import { getCapabilitiesForTaskInstance } from '../../src/providers/registry.js'

describe('getCapabilitiesForTaskInstance without credentials', () => {
  test('returns kaneo capabilities for an instance with no credentials in config', () => {
    const caps = getCapabilitiesForTaskInstance({
      id: 'k',
      type: 'kaneo',
      config: { baseUrl: 'https://k.invalid' },
      status: 'active',
    })
    expect(caps.has('comments.create')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it passes today, then make the cleanup**

Run: `bun test tests/providers/registry.test.ts -t "without credentials"`
Expected: PASS today (via the dummy-cred path). This test is the regression guard for the cleanup — keep it.

- [ ] **Step 3: Bake capabilities into the seeds**

In `src/providers/registry.ts`, import the capability sets and add `capabilities` to the seed type and entries. At the top imports add:

```typescript
import { ALL_CAPABILITIES } from './kaneo/constants.js'
import { YOUTRACK_CAPABILITIES } from './youtrack/constants.js'
```

Update `BuiltinDescriptorSeed`:

```typescript
type BuiltinDescriptorSeed = {
  type: string
  displayName: string
  capabilities: ReadonlySet<TaskCapability>
  configSchema: readonly ProviderConfigRequirement[]
}
```

Add `capabilities` to each seed (`kaneo: ALL_CAPABILITIES`, `youtrack: YOUTRACK_CAPABILITIES`).

- [ ] **Step 4: Read capabilities from the seeds, not from a constructed provider**

Update `listTaskProviderTypes` to use `seed.capabilities` instead of `createProvider(seed.type, {}).capabilities`:

```typescript
const builtin: TaskProviderTypeDescriptor[] = builtinDescriptorSeeds.map((seed) => ({
  type: seed.type,
  displayName: seed.displayName,
  configSchema: seed.configSchema,
  capabilities: seed.capabilities,
  source: 'builtin',
}))
```

Replace `getCapabilitiesForTaskInstance` (lines 100-104) and delete `capabilityConfigForTaskInstance` (lines 88-98):

```typescript
export function getCapabilitiesForTaskInstance(instance: TaskInstance): ReadonlySet<TaskCapability> {
  const descriptor = getTaskProviderDescriptor(instance.type)
  if (descriptor !== undefined) return descriptor.capabilities
  throw new Error(`Unknown provider: ${instance.type}`)
}
```

(`getTaskProviderDescriptor` already merges built-in seeds and contributed entries, so this covers both. Remove the now-unused `configValue` import usage only if nothing else references it — it is still used by the factories, so keep it.)

- [ ] **Step 5: Run the registry suite**

Run: `bun test tests/providers/registry.test.ts`
Expected: PASS

- [ ] **Step 6: Typecheck**

Run: `bun typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/providers/registry.ts tests/providers/registry.test.ts
git commit -m "refactor(providers): source built-in capabilities from descriptors"
```

---

## Task 5: Descriptor-`sensitive` config masking

**Files:**

- Modify: `src/instances/encryption.ts:74-80`
- Modify: `src/debug/instance-routes.ts:68-71`
- Test: `tests/instances/encryption.test.ts`, `tests/debug/instance-routes.test.ts` (extend)

- [ ] **Step 1: Write the failing encryption test**

Add to `tests/instances/encryption.test.ts`:

```typescript
import { maskConfig } from '../../src/instances/encryption.js'

describe('maskConfig with explicit sensitive keys', () => {
  test('masks only the keys in the provided set', () => {
    const masked = maskConfig({ baseUrl: 'u', secretField: 's' }, new Set(['secretField']))
    expect(masked).toEqual({ baseUrl: 'u', secretField: '***' })
  })

  test('falls back to the name pattern when no set is given', () => {
    const masked = maskConfig({ token: 't', baseUrl: 'u' })
    expect(masked).toEqual({ token: '***', baseUrl: 'u' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/instances/encryption.test.ts -t "explicit sensitive keys"`
Expected: FAIL — `maskConfig` ignores the second argument.

- [ ] **Step 3: Make `maskConfig` accept an explicit key set**

In `src/instances/encryption.ts`, replace `maskConfig` (lines 74-80):

```typescript
export const maskConfig = (plain: InstanceConfig, sensitiveKeys?: ReadonlySet<string>): InstanceConfig => {
  const out: InstanceConfig = {}
  for (const [k, v] of Object.entries(plain)) {
    const sensitive = sensitiveKeys === undefined ? SECRET_KEY_PATTERN.test(k) : sensitiveKeys.has(k)
    out[k] = sensitive ? '***' : v
  }
  return out
}
```

- [ ] **Step 4: Run encryption test to verify it passes**

Run: `bun test tests/instances/encryption.test.ts`
Expected: PASS

- [ ] **Step 5: Wire descriptor-driven masking into task-instance views**

In `src/debug/instance-routes.ts`, replace `maskedTaskInstance` (lines 68-71). It already has access to `listTaskProviderTypes` (imported line 27):

```typescript
const instanceScopedSensitiveKeys = (type: string): ReadonlySet<string> => {
  const descriptor = listTaskProviderTypes().find((d) => d.type === type)
  if (descriptor === undefined) return new Set()
  return new Set(
    descriptor.configSchema
      .filter((field) => (field.scope ?? 'instance') === 'instance' && field.sensitive === true)
      .map((field) => field.key),
  )
}

const maskedTaskInstance = (instance: TaskInstance): TaskInstance => ({
  ...instance,
  config: maskConfig(instance.config, instanceScopedSensitiveKeys(instance.type)),
})
```

Platform instances keep `maskConfig(instance.config)` (no descriptor — pattern fallback), so `maskedPlatformInstance` is unchanged.

- [ ] **Step 6: Run the instance-routes suite**

Run: `bun test tests/debug/instance-routes.test.ts`
Expected: PASS (built-in task instances have no instance-scoped sensitive field today, so a `baseUrl` is no longer masked even if a future pattern would have matched — assert this if the suite covers masking; otherwise the existing assertions still hold).

- [ ] **Step 7: Commit**

```bash
git add src/instances/encryption.ts src/debug/instance-routes.ts tests/instances/encryption.test.ts tests/debug/instance-routes.test.ts
git commit -m "feat(instances): descriptor-sensitive config masking"
```

---

## Task 6: First-wins duplicate registration

**Files:**

- Modify: `src/providers/registry.ts:107-119`
- Test: `tests/providers/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/providers/registry.test.ts`. Use the existing register/unregister helpers and a try/finally to keep the registry clean:

```typescript
import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
  getContributedTaskProviderType,
} from '../../src/providers/registry.js'
import { createMockProvider } from '../tools/mock-provider.js'

describe('registerContributedTaskProviderType duplicates', () => {
  test('first registration wins; the second is skipped without throwing', () => {
    const entry = (pluginId: string) => ({
      pluginId,
      factory: () => createMockProvider({ name: 'dup' }),
      capabilities: new Set<never>(),
      displayName: pluginId,
      configSchema: [],
    })
    try {
      registerContributedTaskProviderType('dup', entry('plugin-a'))
      expect(() => registerContributedTaskProviderType('dup', entry('plugin-b'))).not.toThrow()
      expect(getContributedTaskProviderType('dup')?.pluginId).toBe('plugin-a')
    } finally {
      unregisterContributedTaskProviderType('plugin-a')
      unregisterContributedTaskProviderType('plugin-b')
    }
  })

  test('a contributed type that shadows a built-in still throws', () => {
    expect(() =>
      registerContributedTaskProviderType('kaneo', {
        pluginId: 'evil',
        factory: () => createMockProvider({ name: 'kaneo' }),
        capabilities: new Set<never>(),
        displayName: 'evil',
        configSchema: [],
      }),
    ).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/providers/registry.test.ts -t "duplicates"`
Expected: FAIL — the second registration currently throws.

- [ ] **Step 3: Change plugin-vs-plugin duplicate to first-wins**

In `src/providers/registry.ts`, replace the duplicate branch in `registerContributedTaskProviderType` (lines 112-116):

```typescript
const existing = pluginContributedTaskProviderFactories.get(type)
if (existing !== undefined) {
  log.error(
    { type, existing: existing.pluginId, attempted: entry.pluginId },
    'Duplicate task provider type; keeping first registration',
  )
  return
}
```

The built-in-shadow branch (lines 108-110) stays a hard `throw` — unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/providers/registry.test.ts -t "duplicates"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/providers/registry.ts tests/providers/registry.test.ts
git commit -m "fix(providers): first-wins on duplicate contributed task provider type"
```

---

## Task 7: Wire `providerConfigValidator` before persist

Carry an optional `validateConfig` through registration and invoke it in the task-instance create route. (Resolving the validator from the manifest export name is loader-coupled and deferred to Phase 3; this task delivers the invocation mechanism, testable via a registered contributed type.)

**Files:**

- Modify: `src/providers/registry.ts` (`ContributedTaskProviderEntry`, `TaskProviderFactory` callers; add `getTaskProviderConfigValidator`)
- Modify: `src/plugins/context.ts:48,102-120` (thread `validateConfig`)
- Modify: `src/debug/instance-routes.ts:204-213` (call validator)
- Test: `tests/debug/instance-routes.test.ts`, `tests/providers/registry.test.ts`

- [ ] **Step 1: Add the validator type and entry field**

In `src/providers/registry.ts`, near `TaskProviderFactory` (line 15):

```typescript
export type TaskProviderConfigValidator = (
  config: Record<string, string>,
) => Promise<{ ok: true } | { ok: false; reason: string }>
```

Add `validateConfig?: TaskProviderConfigValidator` to `ContributedTaskProviderEntry` (after line 55). Then add a lookup:

```typescript
/** Resolve the optional instance-config validator for a task-provider type. */
export function getTaskProviderConfigValidator(type: string): TaskProviderConfigValidator | undefined {
  return pluginContributedTaskProviderFactories.get(type)?.validateConfig
}
```

(Built-in types return `undefined` — they have no validator and persist as-is.)

- [ ] **Step 2: Thread `validateConfig` through the registration wrapper**

In `src/plugins/context.ts`, widen the descriptor type on `registerTaskProviderType` (interface line 48 and the builder, lines 102-103, 113-119):

```typescript
  registerTaskProviderType(
    type: string,
    descriptor: { factory: TaskProviderFactory; validateConfig?: TaskProviderConfigValidator },
  ): void
```

```typescript
function buildRegisterTaskProviderType(
  manifest: PluginManifest,
): (type: string, descriptor: { factory: TaskProviderFactory; validateConfig?: TaskProviderConfigValidator }) => void {
  return function registerTaskProviderType(type, descriptor): void {
    // ... existing permission + declaration checks unchanged ...
    registerContributedTaskProviderType(type, {
      pluginId: manifest.id,
      factory: descriptor.factory,
      validateConfig: descriptor.validateConfig,
      capabilities: new Set(manifest.providerCapabilities),
      displayName: manifest.name,
      configSchema: manifest.providerConfigSchema,
    })
  }
}
```

Import `TaskProviderConfigValidator` from the registry at the top of `context.ts` alongside `TaskProviderFactory`.

- [ ] **Step 3: Write the failing route test**

Add to `tests/debug/instance-routes.test.ts` (mirror the suite's existing auth/setup helpers — set `DEBUG_TOKEN` and `Authorization` header as the existing POST tests do). Register a contributed type with a failing validator:

```typescript
import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../../src/providers/registry.js'
import { createMockProvider } from '../tools/mock-provider.js'

test('rejects a task-instance create when the provider validator fails', async () => {
  registerContributedTaskProviderType('validated', {
    pluginId: 'val',
    factory: () => createMockProvider({ name: 'validated' }),
    validateConfig: async () => ({ ok: false, reason: 'bad url' }),
    capabilities: new Set<never>(),
    displayName: 'Validated',
    configSchema: [{ key: 'baseUrl', label: 'URL', required: true, sensitive: false, scope: 'instance' }],
  })
  try {
    const res = await handleInstanceApiRouteWithDeps(
      new Request('http://x/api/task-instances', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-token', 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'v1', type: 'validated', config: { baseUrl: 'bad' } }),
      }),
      new URL('http://x/api/task-instances'),
      { getRuntimeChatRouter: () => null, listActivePlatformInstances: () => [] },
    )
    expect(res?.status).toBe(400)
    const body = (await res?.json()) as { error: string; reason?: string }
    expect(body.reason).toBe('bad url')
  } finally {
    unregisterContributedTaskProviderType('val')
  }
})
```

(Match the actual exported route entry and `DEBUG_TOKEN` setup used by the surrounding tests; adjust the token value accordingly.)

- [ ] **Step 4: Run test to verify it fails**

Run: `bun test tests/debug/instance-routes.test.ts -t "validator fails"`
Expected: FAIL — the route persists without validating (returns 201).

- [ ] **Step 5: Invoke the validator in the create handler**

In `src/debug/instance-routes.ts`, import the lookup:

```typescript
import { getTaskProviderConfigValidator, listTaskProviderTypes } from '../providers/registry.js'
```

In `handleTaskInstances`, inside the POST branch (after the unknown-type check, before `insertTaskInstance`, around line 209):

```typescript
const validator = getTaskProviderConfigValidator(body.type)
if (validator !== undefined) {
  const result = await validator(body.config)
  if (!result.ok) {
    return jsonResponse({ error: 'invalid_task_instance_config', reason: result.reason }, { status: 400 })
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test tests/debug/instance-routes.test.ts`
Expected: PASS

- [ ] **Step 7: Typecheck and commit**

Run: `bun typecheck`

```bash
git add src/providers/registry.ts src/plugins/context.ts src/debug/instance-routes.ts tests/debug/instance-routes.test.ts tests/providers/registry.test.ts
git commit -m "feat(instances): invoke provider config validator before persisting task instances"
```

---

## Task 8: `papai/plugin-types` import alias

**Files:**

- Create: `src/providers/public-types.ts`
- Modify: `package.json` (`exports`)
- Modify: `tsconfig.json` (`compilerOptions.paths`)
- Test: `tests/providers/public-types.test.ts`

- [ ] **Step 1: Create the re-export module**

Create `src/providers/public-types.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// Stable public surface for in-repo provider plugins. Re-exports types and
// error constructors only — no provider implementation code.

export type {
  Column,
  Comment,
  Label,
  ListTasksParams,
  Project,
  ProviderConfigRequirement,
  RelationType,
  Task,
  TaskLabel,
  TaskListItem,
  TaskProvider,
  TaskSearchResult,
} from './types.js'
export type { TaskCapability } from './task-capability.js'
export type { AppError } from '../errors.js'
export { providerError, systemError, webFetchError, isAppError, extractAppError } from '../errors.js'
```

- [ ] **Step 2: Write the failing test**

Create `tests/providers/public-types.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'

import * as pluginTypes from 'papai/plugin-types'
import { providerError, isAppError } from 'papai/plugin-types'

describe('papai/plugin-types alias', () => {
  test('resolves through the alias and exposes error constructors', () => {
    expect(typeof providerError).toBe('object')
    expect(typeof isAppError).toBe('function')
  })

  test('runtime surface is limited to error helpers — no implementation code', () => {
    // Types are erased at runtime, so the only runtime exports are the AppError
    // helpers. This is the bundle-isolation guard from spec §7: importing the alias
    // must not pull in provider classes (KaneoProvider, YouTrackProvider, …).
    expect(Object.keys(pluginTypes).toSorted()).toEqual(
      ['extractAppError', 'isAppError', 'providerError', 'systemError', 'webFetchError'].toSorted(),
    )
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/providers/public-types.test.ts`
Expected: FAIL — cannot resolve module `papai/plugin-types`.

- [ ] **Step 4: Add the package self-reference export**

In `package.json`, add an `exports` map (after `"name": "papai"`):

```json
  "exports": {
    "./plugin-types": "./src/providers/public-types.ts"
  },
```

- [ ] **Step 5: Add the tsconfig path**

In `tsconfig.json`, under `compilerOptions`, add (preserving any existing `paths`):

```json
    "paths": {
      "papai/plugin-types": ["./src/providers/public-types.ts"]
    }
```

(If `baseUrl` is not set, add `"baseUrl": "."` to `compilerOptions`.)

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test tests/providers/public-types.test.ts`
Expected: PASS

- [ ] **Step 7: Typecheck**

Run: `bun typecheck`
Expected: no errors (TS resolves `papai/plugin-types` via `paths`).

- [ ] **Step 8: Commit**

```bash
git add src/providers/public-types.ts package.json tsconfig.json tests/providers/public-types.test.ts
git commit -m "feat(providers): add papai/plugin-types stable import alias"
```

---

## Final Verification

- [ ] **Run the curated suite**

Run: `bun test`
Expected: PASS

- [ ] **Run the full local checks**

Run: `bun check:verbose`
Expected: lint, typecheck, format:check, knip, test, duplicates all pass. Fix knip findings if the new `public-types.ts` re-exports are flagged unused (they are an intentional public surface — add to knip's `ignoreExportsUsedInFile`/entry config if required, mirroring any existing public-surface exemption).

- [ ] **Confirm spec coverage**

Cross-check against `docs/superpowers/specs/2026-05-26-task-provider-plugin-prerequisites-design.md`: §1 config-scope (Tasks 1–2), §2 resolver merge + read adapter + Kaneo credential in factory (Task 3), §2.4 capability cleanup (Task 4), §3 validator wiring (Task 7), §4 sensitive masking (Task 5), §5 first-wins (Task 6), §7 alias + §8 bundle-isolation runtime-surface assertion (Task 8). §6 (`seedBuiltinProviderPlugins`/`BOOTSTRAP_ENV_MAP`) is intentionally deferred to Phase 3, and the §5 `/plugin info` surfacing of the losing duplicate is deferred (see Notes).

## Notes for the Implementer

- **Deferred to Phase 3 (do not implement here):** `seedBuiltinProviderPlugins()`, `BOOTSTRAP_ENV_MAP`, and resolving `providerConfigValidator` from a plugin module's named export. These require the `plugins/task-provider-kaneo` / `plugins/task-provider-youtrack` packages, which do not exist yet.
- **Read adapter is the single mapping point.** `readUserScopedField` (Task 3) is the only place that knows per-context storage keys (`kaneo_apikey`, `youtrack_token`) and the Kaneo workspace store. When Kaneo/YouTrack migrate to plugins, this mapping stays in core keyed by type — the plugin code never sees it.
- **Behavior change to be aware of:** after Task 3 the resolver emits `credential` (not `apiKey`/`sessionCookie`) for Kaneo; any other caller that constructs Kaneo via `createProvider('kaneo', …)` must pass `credential`. Grep for `createProvider('kaneo'` / `apiKey:` construction sites before finishing and update them.
- **Deferred from spec §5 (`/plugin info` surfacing):** the spec states the skipped duplicate should appear as a compatibility/runtime note in `/plugin info` for the losing plugin. Task 6 delivers the first-wins log-and-skip at the registry boundary, but the registry layer does not own the `plugin_runtime_events` store, and recording a runtime event for the loser crosses into loader-coupled territory. That surfacing is therefore deferred to Phase 3 alongside the other loader-coupled work; the registry `log.error` on the skipped duplicate is the diagnostic for now.
