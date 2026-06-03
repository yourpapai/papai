<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-Provider Phase 3 Provider Catalog Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the provider catalog refactor so platform and task provider metadata, credentials, masking, setup/config, and tool gating are descriptor-driven instead of provider-name-driven.

**Architecture:** Keep the current static task catalog as the baseline and migrate it to a shared descriptor model with separate instance/context schemas and traits. Add a parallel platform provider catalog, then move API, admin UI, setup/config, resolver, and tools to the descriptor model in small compatibility-preserving steps.

**Tech Stack:** TypeScript, Bun test runner, Zod v4, Svelte 5 admin client, Drizzle/SQLite migrations, existing papai provider/chat registries.

---

## Current Baseline

- `src/providers/registry.ts:139-201` already exposes static task provider descriptors through `listTaskProviderTypes()`.
- `src/debug/task-provider-type-routes.ts:48-51` already serves `GET /api/task-provider-types` with the legacy `configSchema` response.
- `client/admin/sections/InstancesSection.svelte:95-121` and `:297-320` already render task instance creation from task provider descriptors.
- `client/admin/sections/InstancesSection.svelte:266-276` still hard-codes platform provider choices and raw JSON config.
- `src/providers/resolver.ts:37-90` already merges built-in instance config with Kaneo/YouTrack context credentials, but plugin provider context credentials are not available through the default config store path.
- `src/instances/bootstrap.ts:50-75` still writes `url` keys for Mattermost, Kaneo, and YouTrack.
- `src/tools/tools-builder.ts:173` and `src/tools/kaneo-label-helpers.ts:9` still use `provider.name` as a behavioral flag.

## File Structure

- Modify `src/providers/domain-types.ts`: replace the legacy provider config requirement shape with a descriptor field that supports `scope: 'instance' | 'context'`, optional `storageKey`, and explicit `sensitive`.
- Modify `src/providers/task-capability.ts` or create `src/providers/task-traits.ts`: define task provider trait strings used by descriptors and tool gating.
- Modify `src/providers/registry.ts`: convert task descriptors to `instanceConfigSchema`, `contextConfigSchema`, `traits`, and a registration object containing `factory`, `descriptor`, and optional `validateConfig`.
- Modify `src/plugins/types.ts` and `src/plugins/context.ts`: add `providerContextConfigSchema` to plugin manifests and register it into contributed task provider descriptors.
- Modify `src/chat/types.ts` and `src/chat/registry.ts`: add platform descriptor types and static platform provider catalog functions.
- Create `src/debug/platform-provider-type-routes.ts`: serve `GET /api/platform-provider-types`.
- Modify `src/debug/task-provider-type-routes.ts` and `src/debug/instance-routes.ts`: expose split schemas, traits, and descriptor-aware masking for both platform and task instances.
- Modify `client/shared/api-types.ts`, `client/admin/instance-fetcher-schemas.ts`, `client/admin/instance-fetchers.ts`, and `client/admin/sections/InstancesSection.svelte`: consume split provider schemas and render both platform and task instance forms from descriptors.
- Modify `src/config.ts`, `src/config-keys.ts`, `src/config-editor/handlers.ts`, `src/config-editor/types.ts`, `src/config-editor/validation.ts`, `src/wizard/types.ts`, `src/wizard/steps.ts`, `src/wizard/engine.ts`, and `src/wizard/save.ts`: replace closed provider credential unions with a typed dynamic config field model.
- Modify `src/providers/resolver.ts`: read descriptor context fields from `user_config`, including plugin provider namespaced keys, before invoking factories.
- Modify `src/tools/tools-builder.ts`, `src/tools/kaneo-label-helpers.ts`, and related tests: gate behavior through capabilities/traits, not provider names.
- Create `src/db/migrations/045_provider_base_url.ts` and register it in `src/db/index.ts`: backfill `baseUrl` from legacy `url` for platform and task instances.
- Modify `src/instances/bootstrap.ts` and `src/chat/registry.ts`: write/read `baseUrl` for new configs while keeping a read compatibility fallback for persisted `url` rows.

---

### Task 1: Shared Task Descriptor Shape

**Files:**

- Modify: `src/providers/domain-types.ts:241-248`
- Modify: `src/providers/registry.ts:56-201`
- Modify: `src/providers/public-types.ts`
- Test: `tests/providers/registry.test.ts`
- Test: `tests/debug/task-provider-type-routes.test.ts`

- [ ] **Step 1: Write failing registry tests for split schemas and traits**

Add tests in `tests/providers/registry.test.ts`:

```typescript
test('built-in descriptors expose split instance and context schemas plus traits', () => {
  const kaneo = listTaskProviderTypes().find((d) => d.type === 'kaneo')
  const youtrack = listTaskProviderTypes().find((d) => d.type === 'youtrack')

  expect(kaneo?.instanceConfigSchema.map((f) => f.key)).toEqual(['baseUrl', 'internalUrl'])
  expect(kaneo?.contextConfigSchema.find((f) => f.key === 'credential')?.storageKey).toBe('kaneo_apikey')
  expect(kaneo?.contextConfigSchema.find((f) => f.key === 'workspaceId')?.storageKey).toBe('kaneo_workspace_id')
  expect(kaneo?.traits.has('workspace-scoped')).toBe(true)

  expect(youtrack?.instanceConfigSchema.map((f) => f.key)).toEqual(['baseUrl'])
  expect(youtrack?.contextConfigSchema.find((f) => f.key === 'token')?.storageKey).toBe('youtrack_token')
  expect(youtrack?.traits.has('command-language:youtrack')).toBe(true)
})
```

- [ ] **Step 2: Run failing registry tests**

Run: `bun test ./tests/providers/registry.test.ts`

Expected: FAIL because `instanceConfigSchema`, `contextConfigSchema`, and `traits` are not yet on `TaskProviderTypeDescriptor`.

- [ ] **Step 3: Implement the descriptor types and registry shape**

Update `src/providers/domain-types.ts`:

```typescript
export type ProviderConfigField = {
  key: string
  label: string
  required: boolean
  sensitive: boolean
  scope: 'instance' | 'context'
  storageKey?: string
}

export type ProviderConfigRequirement = ProviderConfigField
```

Update `src/providers/registry.ts` around the current descriptor definitions:

```typescript
export type TaskProviderTrait =
  | 'workspace-scoped'
  | 'task-label-read-requires-provider-specific-api'
  | 'supports-command-language'
  | 'command-language:youtrack'
  | 'custom-fields'

export type TaskProviderTypeDescriptor = {
  type: string
  displayName: string
  source: 'builtin' | { plugin: string }
  instanceConfigSchema: readonly ProviderConfigField[]
  contextConfigSchema: readonly ProviderConfigField[]
  capabilities: ReadonlySet<TaskCapability>
  traits: ReadonlySet<TaskProviderTrait>
}
```

Keep a temporary compatibility helper for clients that still read `configSchema`:

```typescript
const legacyConfigSchema = (descriptor: TaskProviderTypeDescriptor): readonly ProviderConfigField[] =>
  descriptor.instanceConfigSchema
```

- [ ] **Step 4: Run registry tests to verify green**

Run: `bun test ./tests/providers/registry.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/providers/domain-types.ts src/providers/public-types.ts src/providers/registry.ts tests/providers/registry.test.ts
git commit -m "feat(providers): split task provider descriptors"
```

---

### Task 2: Task Provider API Response Migration

**Files:**

- Modify: `src/debug/task-provider-type-routes.ts:13-34`
- Modify: `src/debug/instance-routes.ts:57-75`
- Modify: `client/shared/api-types.ts:194-207`
- Modify: `client/admin/instance-fetcher-schemas.ts:29-37`
- Test: `tests/debug/task-provider-type-routes.test.ts`
- Test: `tests/client/admin/instance-fetcher-schemas.test.ts`

- [ ] **Step 1: Write failing API tests for split schemas and traits**

Add to `tests/debug/task-provider-type-routes.test.ts`:

```typescript
test('GET /api/task-provider-types returns split schemas and traits', async () => {
  const res = expectResponse(route('/api/task-provider-types'))
  const body = assertArray(await readJson(res))
  const youtrack = assertObject(body.find((entry) => pick(assertObject(entry), 'type') === 'youtrack'))

  expect(assertArray(pick(youtrack, 'instanceConfigSchema')).map((f) => pick(assertObject(f), 'key'))).toEqual([
    'baseUrl',
  ])
  expect(assertArray(pick(youtrack, 'contextConfigSchema')).map((f) => pick(assertObject(f), 'storageKey'))).toContain(
    'youtrack_token',
  )
  expect(assertArray(pick(youtrack, 'traits'))).toContain('command-language:youtrack')
})
```

- [ ] **Step 2: Run failing API tests**

Run: `bun test ./tests/debug/task-provider-type-routes.test.ts`

Expected: FAIL because the route still emits only `configSchema` and `capabilities`.

- [ ] **Step 3: Update route and client schemas**

Update the route view in `src/debug/task-provider-type-routes.ts`:

```typescript
export type ProviderConfigFieldView = {
  readonly key: string
  readonly label: string
  readonly required: boolean
  readonly sensitive: boolean
  readonly storageKey?: string
}

export type TaskProviderTypeView = {
  readonly type: string
  readonly displayName: string
  readonly instanceConfigSchema: readonly ProviderConfigFieldView[]
  readonly contextConfigSchema: readonly ProviderConfigFieldView[]
  readonly capabilities: readonly string[]
  readonly traits: readonly string[]
  readonly source: 'builtin' | { readonly plugin: string }
}
```

Map descriptor fields without leaking `scope` in the API response:

```typescript
const fieldView = (field: ProviderConfigField): ProviderConfigFieldView => ({
  key: field.key,
  label: field.label,
  required: field.required,
  sensitive: field.sensitive,
  ...(field.storageKey === undefined ? {} : { storageKey: field.storageKey }),
})
```

Update `client/shared/api-types.ts` and `client/admin/instance-fetcher-schemas.ts` to parse the same shape.

- [ ] **Step 4: Keep masking descriptor-aware**

Update `src/debug/instance-routes.ts` task masking to use `descriptor.instanceConfigSchema` instead of filtering legacy `configSchema`.

```typescript
const declared =
  descriptor === undefined
    ? []
    : descriptor.instanceConfigSchema.filter((field) => field.sensitive).map((field) => field.key)
```

- [ ] **Step 5: Run API and client schema tests**

Run: `bun test ./tests/debug/task-provider-type-routes.test.ts ./tests/client/admin/instance-fetcher-schemas.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/debug/task-provider-type-routes.ts src/debug/instance-routes.ts client/shared/api-types.ts client/admin/instance-fetcher-schemas.ts tests/debug/task-provider-type-routes.test.ts tests/client/admin/instance-fetcher-schemas.test.ts
git commit -m "feat(debug): expose split task provider catalog"
```

---

### Task 3: Platform Provider Catalog

**Files:**

- Modify: `src/chat/types.ts:44-72`
- Modify: `src/chat/registry.ts:16-83`
- Create: `src/debug/platform-provider-type-routes.ts`
- Modify: `src/debug/instance-routes.ts:90-99` and `:253-260`
- Test: `tests/debug/platform-provider-type-routes.test.ts`
- Test: `tests/chat/registry.test.ts`

- [ ] **Step 1: Write failing platform catalog route test**

Create `tests/debug/platform-provider-type-routes.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test'

import { handlePlatformProviderTypes } from '../../src/debug/platform-provider-type-routes.js'

const route = (path: string, method = 'GET'): Response | null =>
  handlePlatformProviderTypes(new Request(`http://localhost${path}`, { method }), new URL(`http://localhost${path}`))

describe('handlePlatformProviderTypes', () => {
  test('GET /api/platform-provider-types returns built-in platform descriptors', async () => {
    const res = route('/api/platform-provider-types')
    expect(res?.status).toBe(200)
    const body = (await res?.json()) as Array<{ type: string; instanceConfigSchema: Array<{ key: string }> }>

    expect(body.map((entry) => entry.type)).toEqual(['telegram', 'mattermost', 'discord'])
    expect(body.find((entry) => entry.type === 'mattermost')?.instanceConfigSchema.map((field) => field.key)).toEqual([
      'baseUrl',
      'token',
    ])
  })
})
```

- [ ] **Step 2: Run failing platform route test**

Run: `bun test ./tests/debug/platform-provider-type-routes.test.ts`

Expected: FAIL because `platform-provider-type-routes.ts` does not exist.

- [ ] **Step 3: Add platform descriptor types and registry functions**

Update `src/chat/types.ts`:

```typescript
export type ChatProviderConfigField = {
  key: string
  label: string
  required: boolean
  sensitive: boolean
  scope: 'instance' | 'context'
}

export type ChatProviderDescriptor = {
  type: string
  displayName: string
  source: 'builtin'
  instanceConfigSchema: readonly ChatProviderConfigField[]
  contextConfigSchema: readonly ChatProviderConfigField[]
  capabilities: ReadonlySet<ChatCapability>
  traits: ChatProviderTraits
}
```

Update `src/chat/registry.ts`:

```typescript
const platformDescriptors: readonly ChatProviderDescriptor[] = [
  {
    type: 'telegram',
    displayName: 'Telegram',
    source: 'builtin',
    instanceConfigSchema: [
      { key: 'token', label: 'Telegram Bot Token', required: true, sensitive: true, scope: 'instance' },
    ],
    contextConfigSchema: [],
    capabilities: telegramCapabilities,
    traits: telegramTraits,
  },
  {
    type: 'mattermost',
    displayName: 'Mattermost',
    source: 'builtin',
    instanceConfigSchema: [
      { key: 'baseUrl', label: 'Mattermost URL', required: true, sensitive: false, scope: 'instance' },
      { key: 'token', label: 'Mattermost Bot Token', required: true, sensitive: true, scope: 'instance' },
    ],
    contextConfigSchema: [],
    capabilities: mattermostCapabilities,
    traits: mattermostTraits,
  },
  {
    type: 'discord',
    displayName: 'Discord',
    source: 'builtin',
    instanceConfigSchema: [
      { key: 'token', label: 'Discord Bot Token', required: true, sensitive: true, scope: 'instance' },
    ],
    contextConfigSchema: [],
    capabilities: discordCapabilities,
    traits: discordTraits,
  },
]

export const listPlatformProviderTypes = (): readonly ChatProviderDescriptor[] => platformDescriptors
```

- [ ] **Step 4: Add platform provider route and register it**

Create `src/debug/platform-provider-type-routes.ts` with the same view mapping pattern as task provider routes. Add `/api/platform-provider-types` to `INSTANCE_API_PREFIXES` in `src/debug/instance-routes.ts` and route it before platform instances.

- [ ] **Step 5: Run platform route tests**

Run: `bun test ./tests/debug/platform-provider-type-routes.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/chat/types.ts src/chat/registry.ts src/debug/platform-provider-type-routes.ts src/debug/instance-routes.ts tests/debug/platform-provider-type-routes.test.ts
git commit -m "feat(chat): add platform provider catalog"
```

---

### Task 4: Descriptor-Driven Admin Instance Forms

**Files:**

- Modify: `client/shared/api-types.ts:177-207`
- Modify: `client/admin/instance-fetcher-schemas.ts:19-37`
- Modify: `client/admin/instance-fetchers.ts:8-152`
- Modify: `client/admin/sections/InstancesSection.svelte:31-320`
- Test: `tests/client/admin/sections/InstancesSection.test.ts`
- Test: `tests/client/admin/fetchers.test.ts`

- [ ] **Step 1: Write failing client tests for platform descriptor fetch and form rendering**

In `tests/client/admin/sections/InstancesSection.test.ts`, extend the mock server to respond to `GET /api/platform-provider-types` and assert the rendered platform form uses descriptor fields:

```typescript
expect(fetchCalls).toContain('GET /api/platform-provider-types')
expect(screen.getByTestId('platform-type-input')).toHaveTextContent('Mattermost')
expect(screen.getByTestId('platform-config-baseUrl')).toBeTruthy()
expect(screen.getByTestId('platform-config-token')).toHaveAttribute('type', 'password')
```

- [ ] **Step 2: Run failing client tests**

Run: `bun test:client -- tests/client/admin/sections/InstancesSection.test.ts`

Expected: FAIL because the component does not fetch platform provider types and still renders `platform-config-input` JSON.

- [ ] **Step 3: Add platform provider fetchers and schemas**

Add `PlatformProviderTypeView` to `client/shared/api-types.ts` and `PlatformProviderTypeViewSchema` to `client/admin/instance-fetcher-schemas.ts`. Add `fetchPlatformProviderTypes()` to `client/admin/instance-fetchers.ts`:

```typescript
export const fetchPlatformProviderTypes = async (): Promise<PlatformProviderTypeView[]> => {
  const res = await fetch('/api/platform-provider-types')
  const body = await readBody(res)
  requireOk(res, body)
  return z.array(PlatformProviderTypeViewSchema).parse(body)
}
```

- [ ] **Step 4: Replace raw platform config JSON with descriptor fields**

In `InstancesSection.svelte`, mirror the existing task descriptor flow:

```svelte
{#each selectedPlatformType?.instanceConfigSchema ?? [] as field (field.key)}
  <label>
    <span>{field.label}{field.required ? ' *' : ''}</span>
    <input
      data-testid={`platform-config-${field.key}`}
      type={field.sensitive ? 'password' : 'text'}
      bind:value={platformConfigFields[field.key]}
    />
  </label>
{/each}
```

Build config with the same required-field behavior used by `createTask()`.

- [ ] **Step 5: Run client tests**

Run: `bun test:client -- tests/client/admin/sections/InstancesSection.test.ts tests/client/admin/fetchers.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/shared/api-types.ts client/admin/instance-fetcher-schemas.ts client/admin/instance-fetchers.ts client/admin/sections/InstancesSection.svelte tests/client/admin/sections/InstancesSection.test.ts tests/client/admin/fetchers.test.ts
git commit -m "feat(admin): render platform instances from catalog"
```

---

### Task 5: Dynamic Context Config Model For Setup And Config

**Files:**

- Modify: `src/types/config.ts:12-34`
- Modify: `src/config.ts:14-76`
- Modify: `src/config-keys.ts:10-22`
- Modify: `src/config-editor/handlers.ts:24-145`
- Modify: `src/config-editor/types.ts`
- Modify: `src/config-editor/validation.ts`
- Modify: `src/wizard/types.ts:15-40`
- Modify: `src/wizard/steps.ts:11-107`
- Modify: `src/wizard/engine.ts`
- Modify: `src/wizard/save.ts:12-32`
- Test: `tests/config-keys.test.ts`
- Test: `tests/config-editor/handlers.test.ts`
- Test: `tests/wizard/steps.test.ts`

- [ ] **Step 1: Write failing tests for dynamic provider context fields**

Add a test that registers a contributed provider with a context field and verifies it appears for the assigned context:

```typescript
test('getConfigFieldsForContext includes plugin provider context credentials', () => {
  registerContributedTaskProviderType('plugin-tracker', {
    pluginId: 'plugin-tracker',
    factory: () => createMockProvider({ name: 'plugin-tracker' }),
    capabilities: new Set(),
    displayName: 'Plugin Tracker',
    instanceConfigSchema: [],
    contextConfigSchema: [{ key: 'token', label: 'Plugin Token', required: true, sensitive: true, scope: 'context' }],
    traits: new Set(),
  })

  const fields = getConfigFieldsForContext('ctx-plugin')
  expect(fields.map((field) => field.storageKey)).toContain('plugin:plugin-tracker:provider:token')
})
```

- [ ] **Step 2: Run failing config tests**

Run: `bun test ./tests/config-keys.test.ts ./tests/config-editor/handlers.test.ts ./tests/wizard/steps.test.ts`

Expected: FAIL because config fields are still closed over `ConfigKey`.

- [ ] **Step 3: Introduce a config field model**

Replace `getConfigKeysForContext()` with a new `getConfigFieldsForContext()` while keeping `getConfigKeysForContext()` as a compatibility wrapper for existing core keys until all callers move:

```typescript
export type ConfigField = {
  key: string
  storageKey: string
  label: string
  required: boolean
  sensitive: boolean
  kind: 'preference' | 'provider-context'
}
```

For built-ins, map descriptor fields with `storageKey ?? key`. For plugin providers, compute `plugin:<pluginId>:provider:<key>`.

- [ ] **Step 4: Make config storage accept safe dynamic keys**

In `src/config.ts`, keep `setConfig()` for closed `ConfigKey` callers and add dynamic helpers:

```typescript
export function setConfigValue(contextId: string, key: string, value: string): void {
  if (!isAllowedDynamicConfigKey(key)) throw new Error(`Invalid config key: ${key}`)
  setUserConfigRow(contextId, key, normalizeDynamicConfigValue(key, value))
}

export function getConfigValue(contextId: string, key: string): string | null {
  if (!isAllowedDynamicConfigKey(key)) return null
  return readUserConfigRow(contextId, key)
}
```

Allowed dynamic keys are core `ConfigKey` values plus `plugin:<pluginId>:provider:<fieldKey>`.

- [ ] **Step 5: Move config editor and wizard to ConfigField**

Update editor sessions and wizard data to store `storageKey: string` and labels from `ConfigField`. Validation should be field-based:

```typescript
export function validateConfigField(field: ConfigField, value: string): string | null {
  if (field.required && value.trim() === '') return `${field.label} cannot be empty`
  if (field.storageKey === 'timezone') return validateTimezone(value)
  return null
}
```

- [ ] **Step 6: Run config and wizard tests**

Run: `bun test ./tests/config-keys.test.ts ./tests/config-editor/handlers.test.ts ./tests/wizard/steps.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/types/config.ts src/config.ts src/config-keys.ts src/config-editor src/wizard tests/config-keys.test.ts tests/config-editor/handlers.test.ts tests/wizard/steps.test.ts
git commit -m "feat(config): support dynamic provider context fields"
```

---

### Task 6: Plugin Provider Context Credentials In Resolver

**Files:**

- Modify: `src/plugins/types.ts:171-207`
- Modify: `src/plugins/context.ts:107-130`
- Modify: `src/providers/registry.ts:56-117`
- Modify: `src/providers/resolver.ts:18-90`
- Test: `tests/plugins/context.test.ts`
- Test: `tests/providers/resolver.test.ts`

- [ ] **Step 1: Write failing manifest and resolver tests**

In `tests/plugins/context.test.ts`, assert `providerContextConfigSchema` is accepted and registered. In `tests/providers/resolver.test.ts`, assert missing plugin context credential returns `null` before factory invocation, and a saved credential reaches the factory under the field key.

```typescript
expect(factory).not.toHaveBeenCalled()
expect(provider).toBeNull()

setConfigValue('ctx-plugin', 'plugin:provider-plugin:provider:token', 'secret-token')
expect(factory).toHaveBeenCalledWith({ baseUrl: 'https://tracker.invalid', token: 'secret-token' })
```

- [ ] **Step 2: Run failing plugin/resolver tests**

Run: `bun test ./tests/plugins/context.test.ts ./tests/providers/resolver.test.ts`

Expected: FAIL because manifests and contributed provider entries do not have context schema support.

- [ ] **Step 3: Add `providerContextConfigSchema` to plugin manifests**

Update `src/plugins/types.ts`:

```typescript
providerContextConfigSchema: z.array(pluginConfigRequirementSchema).optional().default([]),
```

Update `src/plugins/context.ts` registration:

```typescript
registerContributedTaskProviderType(type, {
  pluginId: manifest.id,
  factory: descriptor.factory,
  validateConfig: descriptor.validateConfig,
  capabilities: new Set(manifest.providerCapabilities),
  displayName: manifest.name,
  instanceConfigSchema: manifest.providerConfigSchema.map(toInstanceField),
  contextConfigSchema: manifest.providerContextConfigSchema.map(toContextField),
  traits: new Set(),
})
```

- [ ] **Step 4: Update resolver context field reading**

In `src/providers/resolver.ts`, read `descriptor.instanceConfigSchema` from `task_instances.config`, and read `descriptor.contextConfigSchema` from the dynamic config store. For plugin descriptors, compute namespaced storage keys from `source.plugin`.

```typescript
const storageKeyForField = (descriptor: TaskProviderTypeDescriptor, field: ProviderConfigField): string => {
  if (field.storageKey !== undefined) return field.storageKey
  return descriptor.source === 'builtin' ? field.key : `plugin:${descriptor.source.plugin}:provider:${field.key}`
}
```

- [ ] **Step 5: Run plugin and resolver tests**

Run: `bun test ./tests/plugins/context.test.ts ./tests/providers/resolver.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/plugins/types.ts src/plugins/context.ts src/providers/registry.ts src/providers/resolver.ts tests/plugins/context.test.ts tests/providers/resolver.test.ts
git commit -m "feat(providers): resolve plugin context credentials"
```

---

### Task 7: Trait-Driven Tool Assembly

**Files:**

- Modify: `src/tools/tools-builder.ts:160-178`
- Modify: `src/tools/kaneo-label-helpers.ts:1-20`
- Modify: `src/providers/types.ts:78-88`
- Modify: `src/providers/kaneo/index.ts`
- Modify: `src/providers/youtrack/index.ts`
- Test: `tests/tools/tools-builder.test.ts`
- Test: `tests/tools/kaneo-label-helpers.test.ts`

- [ ] **Step 1: Write failing spoofing tests**

Add tests that a mock provider named `youtrack` without the command-language trait does not get `apply_youtrack_command`, and a mock provider with the trait does.

```typescript
const spoofed = createMockProvider({ name: 'youtrack', capabilities: new Set(['tasks.commands']), traits: new Set() })
expect(makeTools(spoofed, context)).not.toHaveProperty('apply_youtrack_command')

const traited = createMockProvider({
  name: 'custom',
  capabilities: new Set(['tasks.commands']),
  traits: new Set(['command-language:youtrack']),
})
expect(makeTools(traited, context)).toHaveProperty('apply_youtrack_command')
```

- [ ] **Step 2: Run failing tool tests**

Run: `bun test ./tests/tools/tools-builder.test.ts ./tests/tools/kaneo-label-helpers.test.ts`

Expected: FAIL because tools still check `provider.name`.

- [ ] **Step 3: Add optional provider traits to runtime providers**

Extend `TaskProvider` with a trait set:

```typescript
readonly traits: ReadonlySet<TaskProviderTrait>
```

Add traits to Kaneo and YouTrack providers from their descriptors.

- [ ] **Step 4: Replace provider-name checks**

In `tools-builder.ts`, replace `provider.name === 'youtrack'` with trait gating:

```typescript
if (provider.traits.has('command-language:youtrack') && provider.capabilities.has('tasks.commands')) {
  tools['apply_youtrack_command'] = makeApplyYouTrackCommandTool(provider)
}
```

In `kaneo-label-helpers.ts`, replace `isKaneoProvider()` with a trait check:

```typescript
export const usesSeparateLabelReadApi = (provider: TaskProvider): boolean =>
  provider.traits.has('task-label-read-requires-provider-specific-api')
```

- [ ] **Step 5: Run tool tests**

Run: `bun test ./tests/tools/tools-builder.test.ts ./tests/tools/kaneo-label-helpers.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/providers/types.ts src/providers/kaneo/index.ts src/providers/youtrack/index.ts src/tools/tools-builder.ts src/tools/kaneo-label-helpers.ts tests/tools/tools-builder.test.ts tests/tools/kaneo-label-helpers.test.ts
git commit -m "feat(tools): gate provider-specific behavior by traits"
```

---

### Task 8: Base URL Migration And Bootstrap Cleanup

**Files:**

- Create: `src/db/migrations/045_provider_base_url.ts`
- Modify: `src/db/index.ts`
- Modify: `src/instances/bootstrap.ts:50-75`
- Modify: `src/chat/registry.ts:60-64`
- Modify: `src/providers/resolver.ts:54-60`
- Test: `tests/db/migration-registration.test.ts`
- Test: `tests/db/provider-base-url-migration.test.ts`
- Test: `tests/instances/bootstrap.test.ts`
- Test: `tests/chat/registry.test.ts`

- [ ] **Step 1: Write failing migration/bootstrap tests**

Add tests that legacy `url` is copied to `baseUrl` and new bootstrap writes only `baseUrl` for URL-bearing providers.

```typescript
expect(readPlatformConfig('mattermost-default')).toMatchObject({ baseUrl: 'https://mattermost.invalid' })
expect(readPlatformConfig('mattermost-default')).not.toHaveProperty('url')
expect(readTaskConfig('youtrack-default')).toMatchObject({ baseUrl: 'https://youtrack.invalid' })
```

- [ ] **Step 2: Run failing migration/bootstrap tests**

Run: `bun test ./tests/db/migration-registration.test.ts ./tests/db/provider-base-url-migration.test.ts ./tests/instances/bootstrap.test.ts ./tests/chat/registry.test.ts`

Expected: FAIL because bootstrap still writes `url` and Mattermost config reads only `url`.

- [ ] **Step 3: Add migration**

Create `src/db/migrations/045_provider_base_url.ts`:

```typescript
import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

type InstanceConfigRow = Readonly<{ id: string; config: string }>

const backfillBaseUrl = (db: Database, table: 'platform_instances' | 'task_instances'): void => {
  const rows = db.query<InstanceConfigRow, []>(`SELECT id, config FROM ${table}`).all()
  for (const row of rows) {
    const config = JSON.parse(row.config) as Record<string, string>
    if (config['baseUrl'] !== undefined || config['url'] === undefined) continue
    config['baseUrl'] = config['url']
    db.query(`UPDATE ${table} SET config = ? WHERE id = ?`).run(JSON.stringify(config), row.id)
  }
}

export const migration045ProviderBaseUrl: Migration = {
  id: '045_provider_base_url',
  up(db) {
    backfillBaseUrl(db, 'platform_instances')
    backfillBaseUrl(db, 'task_instances')
  },
}
```

Register it after migration `044_instance_integrity` in `src/db/index.ts`.

- [ ] **Step 4: Update bootstrap and readers**

Change `src/instances/bootstrap.ts` to write `baseUrl` for Mattermost, Kaneo, and YouTrack. Change `src/chat/registry.ts` Mattermost config mapping to prefer `baseUrl` with `url` fallback:

```typescript
if (type === 'mattermost')
  return { MATTERMOST_URL: config['baseUrl'] ?? config['url'], MATTERMOST_BOT_TOKEN: config['token'] }
```

- [ ] **Step 5: Run migration/bootstrap tests**

Run: `bun test ./tests/db/migration-registration.test.ts ./tests/db/provider-base-url-migration.test.ts ./tests/instances/bootstrap.test.ts ./tests/chat/registry.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations/045_provider_base_url.ts src/db/index.ts src/instances/bootstrap.ts src/chat/registry.ts src/providers/resolver.ts tests/db/migration-registration.test.ts tests/db/provider-base-url-migration.test.ts tests/instances/bootstrap.test.ts tests/chat/registry.test.ts
git commit -m "feat(instances): standardize provider baseUrl config"
```

---

### Task 9: Schema-Driven Instance Masking

**Files:**

- Modify: `src/debug/instance-routes.ts:52-75`
- Modify: `src/instances/encryption.ts`
- Test: `tests/debug/instance-routes.test.ts`

- [ ] **Step 1: Write failing masking tests**

Add tests for descriptor-sensitive platform fields and unknown provider safe masking:

```typescript
test('GET /api/platform-instances masks descriptor-sensitive fields', async () => {
  insertPlatformInstance({ id: 'tg', type: 'telegram', config: { token: 'secret' }, status: 'active' })
  const res = expectResponse(await route('/api/platform-instances'))
  const body = assertArray(await readJson(res))
  expect(pick(assertObject(assertObject(body[0]).config), 'token')).toBe('********')
})

test('unknown task provider masks every config field', async () => {
  insertTaskInstance({ id: 'unknown', type: 'missing', config: { publicish: 'value' }, status: 'active' })
  const res = expectResponse(await route('/api/task-instances'))
  const body = assertArray(await readJson(res))
  expect(pick(assertObject(assertObject(body[0]).config), 'publicish')).toBe('********')
})
```

- [ ] **Step 2: Run failing masking tests**

Run: `bun test ./tests/debug/instance-routes.test.ts`

Expected: FAIL for platform descriptor masking and unknown-provider all-field masking.

- [ ] **Step 3: Implement descriptor-aware masking**

Use platform descriptors for platform instance masking and task descriptors for task instance masking. If a descriptor is unavailable, pass all existing config keys as sensitive.

```typescript
const unknownProviderSensitiveKeys = (config: InstanceConfig): ReadonlySet<string> => new Set(Object.keys(config))
```

Keep `isSecretKeyName()` only as defense-in-depth for extra keys on known providers.

- [ ] **Step 4: Run masking tests**

Run: `bun test ./tests/debug/instance-routes.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/debug/instance-routes.ts src/instances/encryption.ts tests/debug/instance-routes.test.ts
git commit -m "feat(debug): mask instance configs from provider schemas"
```

---

### Task 10: Final Verification And Compatibility Cleanup

**Files:**

- Modify as needed: `docs/superpowers/specs/2026-05-26-multi-provider-phase-3-provider-catalog-refactor.md`
- No source files unless tests expose a defect from prior tasks.

- [ ] **Step 1: Run focused suites**

Run:

```bash
bun test ./tests/providers/registry.test.ts ./tests/providers/resolver.test.ts ./tests/plugins/context.test.ts ./tests/debug/task-provider-type-routes.test.ts ./tests/debug/platform-provider-type-routes.test.ts ./tests/debug/instance-routes.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run client tests for admin instance UI**

Run:

```bash
bun test:client -- tests/client/admin/sections/InstancesSection.test.ts tests/client/admin/fetchers.test.ts tests/client/admin/instance-fetcher-schemas.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typecheck and lint on touched files**

Run:

```bash
bun typecheck
bun lint:agent-strict -- src/providers src/chat src/debug src/config.ts src/config-keys.ts src/config-editor src/wizard src/instances client/admin client/shared tests/providers tests/plugins tests/debug tests/client/admin
```

Expected: PASS.

- [ ] **Step 4: Run broad curated tests**

Run:

```bash
bun test
bun test:client
```

Expected: PASS.

- [ ] **Step 5: Commit verification-only doc updates if any**

```bash
git add docs/superpowers/specs/2026-05-26-multi-provider-phase-3-provider-catalog-refactor.md
git commit -m "docs: finalize provider catalog refactor spec"
```

Only run this commit if the implementation changed the spec or added follow-up notes.

---

## Drift Log

| Date       | Category              | Item                                                                                       | Decision                                                                                  |
| ---------- | --------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 2026-05-27 | In-plan, stale spec   | Spec still described static task descriptors and `/api/task-provider-types` as future work | Updated plan baseline to treat those as existing code and focus Phase 3 on remaining gaps |
| 2026-05-27 | Out-of-scope worktree | `.opencode/package.json` and `.opencode/package-lock.json` were dirty before this session  | Left untouched; not part of provider catalog refactor                                     |
