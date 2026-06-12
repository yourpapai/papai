<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Task-Provider-as-Plugin — Phase 1 (Plugin API Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the router-independent plugin-API surface that lets a plugin contribute a task-provider type — the `provider.task` and `identity` permissions, the provider-type manifest fields, the `registerTaskProviderType` registration call, the contributed-provider registry map, and the `ctx.providerRuntime` / `ctx.identity` facades — with no router callers wired in yet.

**Architecture:** Extend the existing first-party plugin system (`src/plugins/*`) only. Plugins declare a single task-provider **type** in the manifest; `activate()` registers a **factory** into a new in-memory map in `src/providers/registry.ts`. The map is populated but **not yet consumed** by `createProvider` — that consumption, plus `listTaskProviderTypes()` and the Kaneo/YouTrack migration, is deferred to Phase 2 (see Scope). The provider runtime facade reuses the SSRF guard `assertPublicUrl()` from `src/web/safe-fetch.ts` plus a manifest host allowlist; the identity facade adapts over the existing `(context_id, provider_name)` mapping store.

**Tech Stack:** Bun, TypeScript (strict, `.js` import extensions), Zod v4, Drizzle (SQLite), `bun:test`. Lint: oxlint (max-lines 300). Format: oxfmt.

---

## Scope & Dependencies

**This plan is Phase 1 of the task-provider-as-plugin migration** (spec: `docs/superpowers/specs/2026-05-23-task-provider-as-plugin-design.md`, rollout step 1). It is deliberately scoped to changes that are **independent of the Multi-Provider Router** (in active development on branch `claude/multi-provider-phase-1-plan-8kqwN`, not yet on `master`). Everything here builds and ships on `master` today.

**In scope (Phase 1):**

- New permissions `provider.task`, `identity`.
- Manifest contribution `contributes.taskProviderTypes` (max 1) + metadata fields `providerCapabilities`, `providerConfigSchema`, `providerAllowedHosts`, `providerConfigValidator`, with cross-field validation.
- `registerTaskProviderType` on `PluginRegistration`.
- Contributed-provider registry map + register/unregister setters in `src/providers/registry.ts` (populated, **not** consumed).
- `ctx.providerRuntime` facade (allowlisted `httpFetch`, `allowedHosts`, `logger`), gated by `provider.task`.
- `ctx.identity` facade (`lookupForChatUser`, `recordClaim`), gated by `identity` + a declared task-provider type.
- Loader cleanup wiring so a deactivated/failed plugin's type registration is removed.

**Deferred (Phase 2+, written once the router merges to `master`):**

- Extending `createProvider(name, config)` to consult the contributed map.
- `listTaskProviderTypes()` and the schema-driven admin instances UI.
- Phase 5 capability-source reads from contributed entries.
- Migrating Kaneo/YouTrack into `plugins/`, `seedBuiltinProviderPlugins()`, `BOOTSTRAP_ENV_MAP`.
- The `papai/plugin-types` import alias — only needed once an in-repo plugin imports it (i.e. the migration), and it touches build config, so it is **not** part of this router-independent foundation.
- The identity hub-and-spoke model and proof-of-ownership challenge (`beginVerification`) — a separate later phase. This plan implements only the facade **interface** over the existing flat store; `verified` reflects today's weak reality (`matchMethod === 'auto'`).

**Why "no consumers" is still shippable:** the registry map and facades are exercised by unit tests and the loader wiring; they add a tested, stable API surface that Phase 2 builds on without rework.

---

## File Structure

| File                                           | Responsibility                                              | Change                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/plugins/types.ts`                         | Manifest Zod schema, permission list, contribution types    | Modify: add permissions, provider-type fields, cross-field refine         |
| `src/providers/registry.ts`                    | Built-in provider factory map + `createProvider`            | Modify: add contributed-provider map + register/unregister setters        |
| `src/plugins/provider-runtime.ts`              | `ctx.providerRuntime` facade builder (allowlisted fetch)    | Create                                                                    |
| `src/plugins/identity-facade.ts`               | `ctx.identity` facade builder over the mapping store        | Create                                                                    |
| `src/plugins/context.ts`                       | `PluginContext`, `PluginRegistration`, `buildPluginContext` | Modify: add `registerTaskProviderType`, wire the two facades              |
| `src/plugins/loader.ts`                        | Activation/deactivation lifecycle                           | Modify: unregister contributed types on deactivate/failure                |
| `tests/providers/contributed-registry.test.ts` | Registry map register/unregister/duplicate                  | Create                                                                    |
| `tests/plugins/provider-runtime.test.ts`       | Allowlist + SSRF behavior of `httpFetch`                    | Create                                                                    |
| `tests/plugins/identity-facade.test.ts`        | `lookupForChatUser` / `recordClaim` mapping                 | Create                                                                    |
| `tests/plugins/types.test.ts`                  | Manifest schema validation                                  | Modify: add cases + update `baseManifest`                                 |
| `tests/plugins/context.test.ts`                | Context building + registration gating                      | Modify: add cases + update `makeManifest`                                 |
| `tests/plugins/contributions.test.ts`          | (manifest literal builder)                                  | Modify: update `makeManifest` for new required output fields              |
| `tests/plugins/loader.test.ts`                 | (manifest literal builder)                                  | Modify: update `makeManifest` for new required output fields              |
| `tests/bot.test.ts`                            | (manifest literal builder)                                  | Modify: update `makePluginCommandManifest` for new required output fields |

---

## Task 1: Add `provider.task` and `identity` permissions

**Files:**

- Modify: `src/plugins/types.ts:17-24` (`PLUGIN_PERMISSIONS`)
- Test: `tests/plugins/types.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the existing `describe('pluginManifestSchema', ...)` block in `tests/plugins/types.test.ts`:

```typescript
describe('provider permissions', () => {
  test('accepts provider.task and identity permissions', () => {
    const result = pluginManifestSchema.safeParse({
      ...baseManifest,
      permissions: ['provider.task', 'identity'],
    })
    expect(result.success).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/types.test.ts`
Expected: FAIL — `'provider.task'`/`'identity'` are not in the permission enum, so `safeParse` returns `success: false`.

- [ ] **Step 3: Add the permissions**

In `src/plugins/types.ts`, extend `PLUGIN_PERMISSIONS`:

```typescript
/** All permissions a plugin may request. */
export const PLUGIN_PERMISSIONS = [
  'storage',
  'scheduler',
  'commands',
  'chat.send',
  'tasks.read',
  'tasks.write',
  'provider.task',
  'identity',
] as const
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugins/types.ts tests/plugins/types.test.ts
git commit -m "feat(plugins): add provider.task and identity permissions"
```

---

## Task 2: Add provider-type manifest fields + cross-field validation

**Files:**

- Modify: `src/plugins/types.ts` (schemas)
- Test: `tests/plugins/types.test.ts`
- Modify (typecheck fixups): `tests/plugins/context.test.ts`, `tests/plugins/contributions.test.ts`, `tests/plugins/loader.test.ts`, `tests/bot.test.ts`

The new defaulted array fields (`taskProviderTypes`, `providerCapabilities`, `providerConfigSchema`, `providerAllowedHosts`) become **required in the `PluginManifest` output type**, matching the existing convention for `requiredTaskCapabilities` etc. Hand-built manifest literals in tests must include them, so Steps 5–6 update those builders before typecheck.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block in `tests/plugins/types.test.ts`:

```typescript
describe('task provider type contribution', () => {
  test('accepts a single task provider type with provider.task permission', () => {
    const result = pluginManifestSchema.safeParse({
      ...baseManifest,
      permissions: ['provider.task'],
      contributes: { ...baseManifest.contributes, taskProviderTypes: ['kaneo'] },
      providerCapabilities: ['comments.create', 'labels.list'],
      providerConfigSchema: [{ key: 'base_url', label: 'Kaneo URL', required: true, sensitive: false }],
      providerAllowedHosts: ['api.kaneo.io'],
    })
    expect(result.success).toBe(true)
  })

  test('rejects a task provider type without provider.task permission', () => {
    const result = pluginManifestSchema.safeParse({
      ...baseManifest,
      permissions: ['storage'],
      contributes: { ...baseManifest.contributes, taskProviderTypes: ['kaneo'] },
    })
    expect(result.success).toBe(false)
  })

  test('rejects more than one task provider type', () => {
    const result = pluginManifestSchema.safeParse({
      ...baseManifest,
      permissions: ['provider.task'],
      contributes: { ...baseManifest.contributes, taskProviderTypes: ['kaneo', 'youtrack'] },
    })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/plugins/types.test.ts`
Expected: FAIL — `taskProviderTypes`/`providerCapabilities`/etc. are stripped or rejected; the cross-field rule does not exist yet.

- [ ] **Step 3: Add the field schemas**

In `src/plugins/types.ts`, add these schema constants near the other field schemas (after `configKeySchema`, around line 119):

```typescript
const providerTypeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/u, 'Provider type must be lowercase kebab-case starting with a letter')

const providerHostSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(/^[a-z0-9.-]+$/iu, 'Provider allowed host must be a bare hostname')
```

Add `taskProviderTypes` to `pluginContributesSchema` (the `z.object({...})` at line 121):

```typescript
const pluginContributesSchema = z.object({
  tools: z.array(toolNameSchema).optional().default([]),
  promptFragments: z.array(z.string().min(1).max(64)).optional().default([]),
  commands: z.array(commandNameSchema).optional().default([]),
  jobs: z.array(z.string().min(1).max(64)).optional().default([]),
  configKeys: z.array(configKeySchema).optional().default([]),
  taskProviderTypes: z.array(providerTypeSchema).max(1).optional().default([]),
})
```

- [ ] **Step 4: Add the manifest fields + cross-field refine**

In `src/plugins/types.ts`, add the four fields to the `pluginManifestSchema` object (after `configRequirements`, before `activationTimeoutMs`), and append a `.refine` to the whole object. The schema currently ends at line 176 (`})`); replace that closing with the fields + refine:

```typescript
  configRequirements: z.array(pluginConfigRequirementSchema).optional().default([]),
  providerCapabilities: z.array(z.enum(taskCapabilityTuple)).optional().default([]),
  providerConfigSchema: z.array(pluginConfigRequirementSchema).optional().default([]),
  providerAllowedHosts: z.array(providerHostSchema).optional().default([]),
  providerConfigValidator: z.string().min(1).max(64).optional(),
  activationTimeoutMs: z.number().int().min(100).max(10000).optional().default(5000),
}).refine(
  (m) => m.contributes.taskProviderTypes.length === 0 || m.permissions.includes('provider.task'),
  {
    message: "Declaring contributes.taskProviderTypes requires the 'provider.task' permission",
    path: ['permissions'],
  },
)
```

- [ ] **Step 5: Update `baseManifest` in `tests/plugins/types.test.ts`**

The `baseManifest` literal must include the new defaulted fields (and `taskProviderTypes` inside `contributes`) so it typechecks as `PluginManifest`. Add to its `contributes` object: `taskProviderTypes: []`. Add to the top-level object: `providerCapabilities: []`, `providerConfigSchema: []`, `providerAllowedHosts: []`. (`providerConfigValidator` is optional — omit it.)

- [ ] **Step 6: Update the other manifest literal builders**

Apply the identical additions to every hand-built `PluginManifest` literal so typecheck passes. In each builder's `contributes` object add `taskProviderTypes: []`, and in each top-level manifest object add `providerCapabilities: []`, `providerConfigSchema: []`, `providerAllowedHosts: []`:

- `tests/plugins/context.test.ts` → `makeManifest` (line 13)
- `tests/plugins/contributions.test.ts` → `makeManifest` (line 36)
- `tests/plugins/loader.test.ts` → `makeManifest` (line 25)
- `tests/bot.test.ts` → `makePluginCommandManifest` (line 350)

- [ ] **Step 7: Run tests + typecheck to verify pass**

Run: `bun test tests/plugins/types.test.ts && bun typecheck`
Expected: PASS — schema cases pass and no `PluginManifest` literal type errors remain.

- [ ] **Step 8: Commit**

```bash
git add src/plugins/types.ts tests/plugins/types.test.ts tests/plugins/context.test.ts tests/plugins/contributions.test.ts tests/plugins/loader.test.ts tests/bot.test.ts
git commit -m "feat(plugins): add task provider type manifest fields and validation"
```

---

## Task 3: Contributed-provider registry map + register/unregister setters

**Files:**

- Modify: `src/providers/registry.ts`
- Test: `tests/providers/contributed-registry.test.ts` (create)

`createProvider` is **not** changed in this task (that consumption is Phase 2). The map and setters exist and are exercised by tests and (Task 7) the loader.

- [ ] **Step 1: Write the failing test**

Create `tests/providers/contributed-registry.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
  getContributedTaskProviderType,
} from '../../src/providers/registry.js'
import type { TaskProvider } from '../../src/providers/types.js'
import { mockLogger } from '../utils/test-helpers.js'

const fakeProvider = { name: 'kaneo' } as unknown as TaskProvider
const entry = {
  pluginId: 'task-provider-kaneo',
  factory: () => fakeProvider,
  capabilities: new Set<never>(),
}

describe('contributed task provider registry', () => {
  afterEach(() => {
    unregisterContributedTaskProviderType('task-provider-kaneo')
    unregisterContributedTaskProviderType('other-plugin')
  })

  test('registers and resolves a contributed type', () => {
    mockLogger()
    registerContributedTaskProviderType('kaneo', entry)
    const found = getContributedTaskProviderType('kaneo')
    expect(found?.pluginId).toBe('task-provider-kaneo')
  })

  test('first-wins: duplicate type from another plugin throws', () => {
    mockLogger()
    registerContributedTaskProviderType('kaneo', entry)
    expect(() =>
      registerContributedTaskProviderType('kaneo', {
        pluginId: 'other-plugin',
        factory: () => fakeProvider,
        capabilities: new Set<never>(),
      }),
    ).toThrow()
  })

  test('unregister by pluginId removes its types', () => {
    mockLogger()
    registerContributedTaskProviderType('kaneo', entry)
    unregisterContributedTaskProviderType('task-provider-kaneo')
    expect(getContributedTaskProviderType('kaneo')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/providers/contributed-registry.test.ts`
Expected: FAIL — the three functions are not exported from `registry.ts`.

- [ ] **Step 3: Implement the map + setters**

Append to `src/providers/registry.ts` (after `createProvider`):

```typescript
import type { TaskCapability } from './task-capability.js'

export type TaskProviderFactory = (config: Record<string, string>) => TaskProvider

export type ContributedTaskProviderEntry = {
  pluginId: string
  factory: TaskProviderFactory
  capabilities: ReadonlySet<TaskCapability>
}

const pluginContributedTaskProviderFactories = new Map<string, ContributedTaskProviderEntry>()

/** Register a plugin-contributed task provider type. First-wins on duplicate type. */
export function registerContributedTaskProviderType(type: string, entry: ContributedTaskProviderEntry): void {
  const existing = pluginContributedTaskProviderFactories.get(type)
  if (existing !== undefined) {
    log.error({ type, existing: existing.pluginId, attempted: entry.pluginId }, 'Duplicate task provider type')
    throw new Error(`Task provider type '${type}' already registered by plugin '${existing.pluginId}'`)
  }
  pluginContributedTaskProviderFactories.set(type, entry)
  log.info({ type, pluginId: entry.pluginId }, 'Registered contributed task provider type')
}

/** Remove all contributed types owned by a plugin (deactivation / failure cleanup). */
export function unregisterContributedTaskProviderType(pluginId: string): void {
  for (const [type, entry] of pluginContributedTaskProviderFactories) {
    if (entry.pluginId === pluginId) {
      pluginContributedTaskProviderFactories.delete(type)
      log.debug({ type, pluginId }, 'Unregistered contributed task provider type')
    }
  }
}

/** Look up a contributed task provider entry by type. */
export function getContributedTaskProviderType(type: string): ContributedTaskProviderEntry | undefined {
  return pluginContributedTaskProviderFactories.get(type)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/providers/contributed-registry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/providers/registry.ts tests/providers/contributed-registry.test.ts
git commit -m "feat(providers): add contributed task provider registry map"
```

---

## Task 4: `registerTaskProviderType` on `PluginRegistration`

**Files:**

- Modify: `src/plugins/context.ts`
- Test: `tests/plugins/context.test.ts`

`buildRegistration` reads `manifest.permissions` and `manifest.contributes.taskProviderTypes` and delegates to the Task 3 registry setter.

- [ ] **Step 1: Write the failing tests**

Add to `tests/plugins/context.test.ts`. Import the registry helpers at the top:

```typescript
import { getContributedTaskProviderType, unregisterContributedTaskProviderType } from '../../src/providers/registry.js'
```

Add a `describe` block:

```typescript
describe('registerTaskProviderType', () => {
  beforeEach(() => {
    unregisterContributedTaskProviderType('test-plugin')
  })

  test('registers a declared type when provider.task is held', () => {
    const manifest = makeManifest({
      permissions: ['provider.task'],
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: ['kaneo'],
      },
      providerCapabilities: ['labels.list'],
    })
    const { ctx } = buildPluginContext(manifest, 'ctx-1')
    ctx.registration.registerTaskProviderType('kaneo', {
      factory: () => ({ name: 'kaneo' }) as never,
    })
    expect(getContributedTaskProviderType('kaneo')?.pluginId).toBe('test-plugin')
  })

  test('throws without provider.task permission', () => {
    const manifest = makeManifest({
      permissions: [],
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: ['kaneo'],
      },
    })
    const { ctx } = buildPluginContext(manifest, 'ctx-1')
    expect(() => ctx.registration.registerTaskProviderType('kaneo', { factory: () => ({}) as never })).toThrow()
  })

  test('throws when type is not the declared one', () => {
    const manifest = makeManifest({
      permissions: ['provider.task'],
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: ['kaneo'],
      },
    })
    const { ctx } = buildPluginContext(manifest, 'ctx-1')
    expect(() => ctx.registration.registerTaskProviderType('youtrack', { factory: () => ({}) as never })).toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/plugins/context.test.ts`
Expected: FAIL — `registerTaskProviderType` is not on `PluginRegistration`.

- [ ] **Step 3: Extend the `PluginRegistration` type**

In `src/plugins/context.ts`, add to the `PluginRegistration` type (after `registerScheduledJob`):

```typescript
  /** Register the plugin's single declared task provider type. Requires the 'provider.task' permission. */
  registerTaskProviderType(type: string, descriptor: { factory: TaskProviderFactory }): void
```

Add the imports at the top of the file:

```typescript
import { registerContributedTaskProviderType, type TaskProviderFactory } from '../providers/registry.js'
```

- [ ] **Step 4: Implement the method in `buildRegistration`**

`buildRegistration` already receives `manifest`. Add inside the returned frozen object (after `registerScheduledJob`):

```typescript
    registerTaskProviderType(type: string, descriptor: { factory: TaskProviderFactory }): void {
      if (!manifest.permissions.includes('provider.task')) {
        throw new Error(`Plugin ${manifest.id} cannot register a task provider type without 'provider.task'`)
      }
      const declared = manifest.contributes.taskProviderTypes
      if (declared.length !== 1 || declared[0] !== type) {
        throw new Error(`Task provider type '${type}' is not declared in plugin manifest contributes.taskProviderTypes`)
      }
      registerContributedTaskProviderType(type, {
        pluginId: manifest.id,
        factory: descriptor.factory,
        capabilities: new Set(manifest.providerCapabilities),
      })
    },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/plugins/context.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/plugins/context.ts tests/plugins/context.test.ts
git commit -m "feat(plugins): add registerTaskProviderType to plugin registration"
```

---

## Task 5: `ctx.providerRuntime` facade (allowlisted httpFetch)

**Files:**

- Create: `src/plugins/provider-runtime.ts`
- Modify: `src/plugins/context.ts` (`PluginContext` type + `buildPluginContext` wiring)
- Test: `tests/plugins/provider-runtime.test.ts` (create)

`httpFetch` enforces the manifest host allowlist, then calls `assertPublicUrl()` (SSRF guard from `safe-fetch.ts`), then performs a real `fetch` (any method/body). Deps are injectable for testing.

- [ ] **Step 1: Write the failing test**

Create `tests/plugins/provider-runtime.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import { buildProviderRuntime } from '../../src/plugins/provider-runtime.js'
import { mockLogger } from '../utils/test-helpers.js'

function logger() {
  return { debug() {}, info() {}, warn() {}, error() {} }
}

describe('buildProviderRuntime.httpFetch', () => {
  test('rejects a host not in the allowlist before fetching', async () => {
    mockLogger()
    const fetchSpy = mock(() => Promise.resolve(new Response('ok')))
    const assertPublicUrl = mock(() => Promise.resolve())
    const runtime = buildProviderRuntime(['api.kaneo.io'], logger(), {
      fetch: fetchSpy as never,
      assertPublicUrl,
    })

    await expect(runtime.httpFetch('https://evil.example.com/x')).rejects.toThrow()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(assertPublicUrl).not.toHaveBeenCalled()
  })

  test('allows an allowlisted host through the SSRF guard then fetch', async () => {
    mockLogger()
    const fetchSpy = mock(() => Promise.resolve(new Response('ok')))
    const assertPublicUrl = mock(() => Promise.resolve())
    const runtime = buildProviderRuntime(['api.kaneo.io'], logger(), {
      fetch: fetchSpy as never,
      assertPublicUrl,
    })

    const res = await runtime.httpFetch('https://api.kaneo.io/v1/tasks', { method: 'POST' })
    expect(await res.text()).toBe('ok')
    expect(assertPublicUrl).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  test('exposes the allowlist as a readonly set', () => {
    mockLogger()
    const runtime = buildProviderRuntime(['api.kaneo.io'], logger())
    expect(runtime.allowedHosts.has('api.kaneo.io')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/provider-runtime.test.ts`
Expected: FAIL — `src/plugins/provider-runtime.ts` does not exist.

- [ ] **Step 3: Implement the facade builder**

Create `src/plugins/provider-runtime.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { assertPublicUrl as defaultAssertPublicUrl } from '../web/safe-fetch.js'
import type { PluginLogger } from './context.js'

export type PluginProviderRuntime = {
  readonly httpFetch: (url: string, init?: RequestInit) => Promise<Response>
  readonly allowedHosts: ReadonlySet<string>
  readonly logger: PluginLogger
}

export interface ProviderRuntimeDeps {
  fetch: typeof fetch
  assertPublicUrl: (url: URL) => Promise<void>
}

const defaultDeps: ProviderRuntimeDeps = {
  fetch,
  assertPublicUrl: defaultAssertPublicUrl,
}

export function buildProviderRuntime(
  allowedHosts: readonly string[],
  logger: PluginLogger,
  deps: ProviderRuntimeDeps = defaultDeps,
): PluginProviderRuntime {
  const hostSet: ReadonlySet<string> = new Set(allowedHosts.map((h) => h.toLowerCase()))

  return Object.freeze({
    allowedHosts: hostSet,
    logger,
    async httpFetch(rawUrl: string, init?: RequestInit): Promise<Response> {
      const url = new URL(rawUrl)
      if (!hostSet.has(url.hostname.toLowerCase())) {
        throw new Error(`Host '${url.hostname}' is not in the plugin providerAllowedHosts allowlist`)
      }
      await deps.assertPublicUrl(url)
      return deps.fetch(url.toString(), init)
    },
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/provider-runtime.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into `PluginContext`**

In `src/plugins/context.ts`, import the builder and add the field to the `PluginContext` type (after `registration`):

```typescript
import { buildProviderRuntime, type PluginProviderRuntime } from './provider-runtime.js'
```

```typescript
  readonly registration: PluginRegistration
  /** Present only when the 'provider.task' permission is held. */
  readonly providerRuntime?: PluginProviderRuntime
```

In `buildPluginContext`, after computing `permissions`, build the runtime and add it to the frozen `ctx`:

```typescript
const providerRuntime = permissions.has('provider.task')
  ? buildProviderRuntime(manifest.providerAllowedHosts, buildPluginLogger(manifest.id))
  : undefined

const ctx: PluginContext = Object.freeze({
  pluginId: manifest.id,
  contextId,
  permissions,
  kv,
  log: buildPluginLogger(manifest.id),
  registration: buildRegistration(manifest, collected),
  providerRuntime,
})
```

- [ ] **Step 6: Add a context-gating test**

Add to `tests/plugins/context.test.ts`:

```typescript
describe('providerRuntime gating', () => {
  test('present when provider.task is held', () => {
    const { ctx } = buildPluginContext(makeManifest({ permissions: ['provider.task'] }), 'ctx-1')
    expect(ctx.providerRuntime).toBeDefined()
  })

  test('absent without provider.task', () => {
    const { ctx } = buildPluginContext(makeManifest({ permissions: ['storage'] }), 'ctx-1')
    expect(ctx.providerRuntime).toBeUndefined()
  })
})
```

- [ ] **Step 7: Run tests + typecheck to verify pass**

Run: `bun test tests/plugins/context.test.ts tests/plugins/provider-runtime.test.ts && bun typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/plugins/provider-runtime.ts src/plugins/context.ts tests/plugins/provider-runtime.test.ts tests/plugins/context.test.ts
git commit -m "feat(plugins): add provider.task-gated providerRuntime facade"
```

---

## Task 6: `ctx.identity` facade over the mapping store

**Files:**

- Create: `src/plugins/identity-facade.ts`
- Modify: `src/plugins/context.ts` (`PluginContext` type + `buildPluginContext` wiring)
- Test: `tests/plugins/identity-facade.test.ts` (create)

The facade adapts over the existing `(context_id, provider_name)` mapping store. `verified` is derived from `matchMethod === 'auto'`; `recordClaim` writes an unverified `manual_nl` claim. No `beginVerification` (deferred proof phase). Gated by the `identity` permission **and** a single declared task-provider type (the `providerName`).

- [ ] **Step 1: Write the failing test**

Create `tests/plugins/identity-facade.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { buildIdentityFacade } from '../../src/plugins/identity-facade.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('buildIdentityFacade', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('recordClaim then lookup returns an unverified mapping', () => {
    const identity = buildIdentityFacade('kaneo')
    identity.recordClaim('ctx-1', 'kaneo-u-7', 'alice')
    const found = identity.lookupForChatUser('ctx-1')
    expect(found).toEqual({ providerUserId: 'kaneo-u-7', providerLogin: 'alice', verified: false })
  })

  test('lookup returns null when no mapping exists', () => {
    const identity = buildIdentityFacade('kaneo')
    expect(identity.lookupForChatUser('ctx-unknown')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/identity-facade.test.ts`
Expected: FAIL — `src/plugins/identity-facade.ts` does not exist.

- [ ] **Step 3: Implement the facade builder**

Create `src/plugins/identity-facade.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  getIdentityMapping as defaultGetIdentityMapping,
  setIdentityMapping as defaultSetIdentityMapping,
} from '../identity/mapping.js'

export type PluginIdentityFacade = {
  /** Resolve the recorded provider account for a chat context, or null. */
  lookupForChatUser(chatUserId: string): { providerUserId: string; providerLogin: string; verified: boolean } | null
  /** Record an unverified ('manual_nl') claim. Never marks the mapping verified. */
  recordClaim(chatUserId: string, providerUserId: string, providerLogin: string, displayName?: string): void
}

export interface IdentityFacadeDeps {
  getIdentityMapping: typeof defaultGetIdentityMapping
  setIdentityMapping: typeof defaultSetIdentityMapping
}

const defaultDeps: IdentityFacadeDeps = {
  getIdentityMapping: defaultGetIdentityMapping,
  setIdentityMapping: defaultSetIdentityMapping,
}

export function buildIdentityFacade(
  providerName: string,
  deps: IdentityFacadeDeps = defaultDeps,
): PluginIdentityFacade {
  return Object.freeze({
    lookupForChatUser(chatUserId: string) {
      const mapping = deps.getIdentityMapping(chatUserId, providerName)
      if (mapping === null || mapping.providerUserId === null || mapping.providerUserLogin === null) {
        return null
      }
      return {
        providerUserId: mapping.providerUserId,
        providerLogin: mapping.providerUserLogin,
        verified: mapping.matchMethod === 'auto',
      }
    },
    recordClaim(chatUserId: string, providerUserId: string, providerLogin: string, displayName?: string) {
      deps.setIdentityMapping({
        contextId: chatUserId,
        providerName,
        providerUserId,
        providerUserLogin: providerLogin,
        displayName: displayName ?? null,
        matchMethod: 'manual_nl',
        confidence: 100,
      })
    },
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/identity-facade.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into `PluginContext`**

In `src/plugins/context.ts`, import and add the field to the `PluginContext` type:

```typescript
import { buildIdentityFacade, type PluginIdentityFacade } from './identity-facade.js'
```

```typescript
  /** Present only when 'identity' is held and the plugin declares one task provider type. */
  readonly identity?: PluginIdentityFacade
```

In `buildPluginContext`, after the `providerRuntime` block:

```typescript
const declaredTypes = manifest.contributes.taskProviderTypes
const identity =
  permissions.has('identity') && declaredTypes.length === 1
    ? buildIdentityFacade(declaredTypes[0] as string)
    : undefined
```

Add `identity,` to the frozen `ctx` object literal.

- [ ] **Step 6: Add context-gating tests**

Add to `tests/plugins/context.test.ts`:

```typescript
describe('identity gating', () => {
  test('present with identity permission and a declared task provider type', () => {
    const manifest = makeManifest({
      permissions: ['identity', 'provider.task'],
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: ['kaneo'],
      },
    })
    const { ctx } = buildPluginContext(manifest, 'ctx-1')
    expect(ctx.identity).toBeDefined()
  })

  test('absent without identity permission', () => {
    const { ctx } = buildPluginContext(makeManifest({ permissions: ['storage'] }), 'ctx-1')
    expect(ctx.identity).toBeUndefined()
  })
})
```

- [ ] **Step 7: Run tests + typecheck to verify pass**

Run: `bun test tests/plugins/context.test.ts tests/plugins/identity-facade.test.ts && bun typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/plugins/identity-facade.ts src/plugins/context.ts tests/plugins/identity-facade.test.ts tests/plugins/context.test.ts
git commit -m "feat(plugins): add identity-gated ctx.identity facade"
```

---

## Task 7: Loader cleanup wiring

**Files:**

- Modify: `src/plugins/loader.ts`
- Test: `tests/plugins/loader.test.ts`

When a plugin deactivates or fails activation, remove its contributed task-provider type so a later re-activation does not hit the duplicate-type guard.

- [ ] **Step 1: Write the failing test**

Add to `tests/plugins/loader.test.ts`. Import the registry helper:

```typescript
import { getContributedTaskProviderType } from '../../src/providers/registry.js'
```

Add a test that activates a provider plugin, then deactivates all, and asserts the type is gone. Use the suite's existing plugin-activation harness (`activatePlugins` / `deactivateAllPlugins`) and a manifest built via the suite's `makeManifest` with `permissions: ['provider.task']`, `contributes.taskProviderTypes: ['demo']`, and an entry point whose `activate` calls `ctx.registration.registerTaskProviderType('demo', { factory: () => ({}) as never })`. Follow the existing fixture pattern in this file for providing an entry-point module.

```typescript
test('removes contributed provider type on deactivation', async () => {
  // ...activate the provider plugin via the suite harness...
  expect(getContributedTaskProviderType('demo')?.pluginId).toBeDefined()
  await deactivateAllPlugins()
  expect(getContributedTaskProviderType('demo')).toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/loader.test.ts`
Expected: FAIL — the type remains registered after deactivation.

- [ ] **Step 3: Implement the cleanup**

In `src/plugins/loader.ts`, import the unregister helper:

```typescript
import { unregisterContributedTaskProviderType } from '../providers/registry.js'
```

In `deactivateOne`, after `contributionRegistry.deregister(pluginId)` (both the success path and the catch path), add:

```typescript
unregisterContributedTaskProviderType(pluginId)
```

In `activateOne`'s catch block, after the existing `contributionRegistry.deregister(manifest.id)`, add:

```typescript
unregisterContributedTaskProviderType(manifest.id)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/loader.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full plugin + provider suites**

Run: `bun test tests/plugins/ tests/providers/ && bun typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/plugins/loader.ts tests/plugins/loader.test.ts
git commit -m "feat(plugins): unregister contributed provider type on plugin teardown"
```

---

## Final Verification

- [ ] **Run the full local check suite**

Run: `bun check:verbose`
Expected: lint, typecheck, format:check, knip, test, and duplicates all pass. In particular, confirm `knip` reports no unused exports — every new export (`registerContributedTaskProviderType`, `unregisterContributedTaskProviderType`, `getContributedTaskProviderType`, `buildProviderRuntime`, `buildIdentityFacade`, `TaskProviderFactory`) has a real caller (context, loader, or tests).

- [ ] **Confirm no router coupling**

Grep the diff for `task_instances`, `resolver`, `bootstrap`, `instances/` — there must be none. This phase is router-independent by design.

---

## Self-Review Notes (author)

- **Spec coverage:** Implements rollout step 1 of the spec (permission, contribution, manifest fields, `registerTaskProviderType`, `providerRuntime` + `identity` facades). Deferred items are listed under Scope with rationale; `createProvider` consumption, `listTaskProviderTypes`, migration, and the `papai/plugin-types` alias are explicitly Phase 2.
- **Identity faithfulness:** the facade does not introduce hub/proof semantics; `verified` is a read-only derivation from the existing `matchMethod`, and `recordClaim` preserves the current `manual_nl`/confidence-100 convention. The anti-impersonation hardening is the separate later phase per the spec.
- **`httpFetch` correctness:** built on `assertPublicUrl` (the reusable SSRF guard), not `safeFetchContent` (which is GET-only and content-type-restricted and would not serve a provider API client).
- **Type-output churn:** defaulted array fields force `PluginManifest` literal updates (Task 2, Steps 5–6) — five builders enumerated to keep typecheck green.
