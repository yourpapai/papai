<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-Provider Review Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the staged multi-provider review cleanup: full platform runtime reconciliation, validation hardening, plugin provider metadata alignment, and safe removal of obsolete compatibility surfaces.

**Architecture:** Preserve DB-first instance management. Admin routes persist desired state; `POST /api/platform-instances/apply` reconciles desired DB platform rows with safe `ChatRouter` runtime snapshots. Later phases centralize validation, make plugin manifest metadata effective, and remove compatibility paths only after replacement tests prove the supported path.

**Tech Stack:** Bun, TypeScript, Bun test runner, SQLite via Drizzle/Bun SQLite, Zod v4, p-limit, Svelte admin client schemas.

---

## File Structure

- Modify: `src/chat/router-types.ts` — add safe runtime snapshot fields for config comparison.
- Modify: `src/chat/router.ts` — store per-instance config fingerprints and expose safe snapshots.
- Modify: `src/chat/router-helpers.ts` — keep snapshot construction focused and secret-free.
- Modify: `src/debug/instance-route-support.ts` — replace additive apply with full reconciliation and detailed result shape.
- Modify: `src/debug/instance-routes.ts` — map duplicate insert constraint errors to `409`, centralize cache invalidation around instance mutations.
- Modify: `client/shared/api-types.ts` — expand `ApplyInstancesResult` for detailed reconciliation results.
- Modify: `client/admin/fetcher-schemas.ts` — parse the expanded apply result.
- Modify: `tests/chat/router.test.ts` — verify safe snapshots and fingerprint changes.
- Modify: `tests/debug/instance-routes.test.ts` — verify full apply reconciliation, duplicate create errors, and cache invalidation behavior.
- Modify: `src/debug/instance-config-validation.ts` — expose non-HTTP config validation result helpers.
- Modify: `src/debug/task-provider-type-routes.ts` — reuse shared validation result helpers for route responses.
- Modify: `src/providers/resolver.ts` — validate contributed task provider config before provider construction.
- Modify: `tests/providers/resolver.test.ts` — verify resolver-time contributed config rejection.
- Modify: `src/plugins/types.ts` — add provider traits and storage key schema support for provider config fields.
- Modify: `src/plugins/loader.ts` — resolve manifest-named provider validators from plugin module exports.
- Modify: `src/plugins/context.ts` — preserve validator, storage key, and traits in contributed provider registration.
- Modify: `tests/plugins/context.test.ts` — verify storage keys and provider traits through the facade.
- Modify: `tests/plugins/loader.test.ts` — verify manifest validator export resolution and activation failure on invalid validator exports.
- Modify later cleanup files only after each compatibility test is green: `src/chat/registry.ts`, built-in adapter constructors, `src/providers/registry.ts`, tests that still rely on combined `configSchema`, and any now-unused manual cascade helpers.

---

## Task 1: Router Runtime Fingerprints And Safe Snapshots

**Files:**

- Modify: `src/chat/router-types.ts`
- Modify: `src/chat/router.ts`
- Modify: `src/chat/router-helpers.ts`
- Test: `tests/chat/router.test.ts`

- [ ] **Step 1: Write the failing snapshot test**

Add this test near the existing `listInstances()` tests in `tests/chat/router.test.ts`:

```typescript
test('listInstances exposes safe config fingerprints without raw config', () => {
  const router = new ChatRouter((id, type, config) => fakeProviderForInstance(id, type, config))

  router.addInstance('telegram-main', 'telegram', { token: 'secret-token' })

  const [snapshot] = router.listInstances()

  expect(snapshot).toMatchObject({ id: 'telegram-main', type: 'telegram', status: 'pending' })
  expect(snapshot?.configFingerprint).toBeString()
  expect(JSON.stringify(snapshot)).not.toContain('secret-token')
})
```

If the local helper is not named `fakeProviderForInstance`, use the existing provider factory helper in the file and keep the assertion shape unchanged.

- [ ] **Step 2: Run the failing router test**

Run: `bun test tests/chat/router.test.ts -t "safe config fingerprints"`

Expected: FAIL because `configFingerprint` does not exist on snapshots.

- [ ] **Step 3: Add the snapshot field type**

In `src/chat/router-types.ts`, extend `ManagedChatInstance` and `ManagedChatInstanceSnapshot`:

```typescript
export type ManagedChatInstance = {
  readonly id: string
  readonly type: PlatformInstanceType
  readonly provider: ChatProvider
  status: InstanceStatus
  readonly configFingerprint: string
}

export type ManagedChatInstanceSnapshot = {
  readonly id: string
  readonly type: PlatformInstanceType
  readonly status: InstanceStatus
  readonly configFingerprint: string
}
```

Keep existing fields and imports; add `InstanceStatus` import if the file currently uses the literal union inline.

- [ ] **Step 4: Implement deterministic config fingerprinting**

In `src/chat/router.ts`, add local helpers above the class:

```typescript
const stableConfigEntries = (config: InstanceConfig): readonly (readonly [string, string])[] =>
  Object.entries(config).toSorted(([left], [right]) => left.localeCompare(right))

const configFingerprint = (type: PlatformInstanceType, config: InstanceConfig): string => {
  const payload = JSON.stringify({ type, config: stableConfigEntries(config) })
  return Bun.hash(payload).toString(16)
}
```

Then update `addInstance()` to set the fingerprint:

```typescript
const instance: ManagedChatInstance = {
  id,
  type,
  provider,
  status: 'pending',
  configFingerprint: configFingerprint(type, config),
}
```

- [ ] **Step 5: Return the field from snapshots**

In `src/chat/router-helpers.ts`, update `managedInstanceSnapshots()`:

```typescript
export const managedInstanceSnapshots = (
  instances: Iterable<ManagedChatInstance>,
): readonly ManagedChatInstanceSnapshot[] =>
  [...instances].map((instance) => ({
    id: instance.id,
    type: instance.type,
    status: instance.status,
    configFingerprint: instance.configFingerprint,
  }))
```

- [ ] **Step 6: Run router tests**

Run: `bun test tests/chat/router.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/chat/router-types.ts src/chat/router.ts src/chat/router-helpers.ts tests/chat/router.test.ts
git commit -m "feat: add safe chat router config fingerprints"
```

---

## Task 2: Full `/apply` Runtime Reconciliation

**Files:**

- Modify: `src/debug/instance-route-support.ts`
- Modify: `src/debug/instance-routes.ts`
- Modify: `client/shared/api-types.ts`
- Modify: `client/admin/fetcher-schemas.ts`
- Test: `tests/debug/instance-routes.test.ts`
- Test: `tests/client/admin/instance-fetcher-schemas.test.ts`

- [ ] **Step 1: Write failing apply tests for config rotation and stopped DB rows**

Add tests to `tests/debug/instance-routes.test.ts` near the existing apply tests:

```typescript
test('apply recreates active runtime instance when DB config changes', async () => {
  const start = mock(async () => {})
  const stop = mock(async () => {})
  const seenConfigs: InstanceConfig[] = []
  const router = new ChatRouter((_id, _type, config) => {
    seenConfigs.push(config)
    return fakeProvider(start, stop)
  })
  router.addInstance('telegram-main', 'telegram', { token: 'old-secret' })
  await router.startInstance('telegram-main')

  const instance: PlatformInstance = {
    id: 'telegram-main',
    type: 'telegram',
    config: { token: 'new-secret' },
    status: 'active',
    createdAt: '2026-05-29 00:00:00',
  }

  const res = expectResponse(
    await routeWithDeps(
      '/api/platform-instances/apply',
      { getRuntimeChatRouter: () => router, listActivePlatformInstances: () => [instance] },
      { method: 'POST', headers: jsonHeaders() },
    ),
  )

  expect(res.status).toBe(200)
  expect(await readJson(res)).toMatchObject({ recreated: ['telegram-main'], failed: [] })
  expect(stop).toHaveBeenCalledTimes(1)
  expect(start).toHaveBeenCalledTimes(2)
  expect(seenConfigs).toEqual([{ token: 'old-secret' }, { token: 'new-secret' }])
})

test('apply removes runtime instance when DB row is no longer active', async () => {
  const start = mock(async () => {})
  const stop = mock(async () => {})
  const router = new ChatRouter(() => fakeProvider(start, stop))
  router.addInstance('telegram-main', 'telegram', { token: 'secret' })
  await router.startInstance('telegram-main')

  const res = expectResponse(
    await routeWithDeps(
      '/api/platform-instances/apply',
      { getRuntimeChatRouter: () => router, listActivePlatformInstances: () => [] },
      { method: 'POST', headers: jsonHeaders() },
    ),
  )

  expect(res.status).toBe(200)
  expect(await readJson(res)).toMatchObject({ removed: ['telegram-main'], failed: [] })
  expect(router.getInstance('telegram-main')).toBeNull()
  expect(stop).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run failing apply tests**

Run: `bun test tests/debug/instance-routes.test.ts -t "apply recreates|apply removes runtime"`

Expected: FAIL because `/apply` returns only `{ applied }` and does not recreate changed instances.

- [ ] **Step 3: Update shared apply result types**

In `client/shared/api-types.ts`, replace the current `ApplyInstancesResult` shape with:

```typescript
export type ApplyInstancesResult = {
  readonly applied: number
  readonly started: readonly string[]
  readonly stopped: readonly string[]
  readonly removed: readonly string[]
  readonly recreated: readonly string[]
  readonly unchanged: readonly string[]
  readonly failed: readonly Array<{ readonly id: string; readonly action: string; readonly error: string }>
}
```

In `client/admin/fetcher-schemas.ts`, update `ApplyInstancesResultSchema`:

```typescript
const ApplyFailureSchema = z.object({ id: z.string(), action: z.string(), error: z.string() })

export const ApplyInstancesResultSchema = z.object({
  applied: z.number(),
  started: z.array(z.string()),
  stopped: z.array(z.string()),
  removed: z.array(z.string()),
  recreated: z.array(z.string()),
  unchanged: z.array(z.string()),
  failed: z.array(ApplyFailureSchema),
}) satisfies z.ZodType<ApplyInstancesResult>
```

- [ ] **Step 4: Add schema tests**

In `tests/client/admin/instance-fetcher-schemas.test.ts`, add:

```typescript
test('ApplyInstancesResultSchema accepts detailed reconciliation result', () => {
  const parsed = ApplyInstancesResultSchema.parse({
    applied: 2,
    started: ['telegram-a'],
    stopped: ['telegram-b'],
    removed: ['telegram-b'],
    recreated: ['telegram-c'],
    unchanged: ['telegram-d'],
    failed: [{ id: 'telegram-e', action: 'start', error: 'bad token' }],
  })

  expect(parsed.recreated).toEqual(['telegram-c'])
  expect(parsed.failed[0]?.error).toBe('bad token')
})
```

- [ ] **Step 5: Implement apply result helpers**

In `src/debug/instance-route-support.ts`, add types and a factory:

```typescript
type ApplyAction = 'start' | 'stop' | 'remove' | 'recreate'

type ApplyInstancesResult = {
  applied: number
  started: string[]
  stopped: string[]
  removed: string[]
  recreated: string[]
  unchanged: string[]
  failed: Array<{ id: string; action: ApplyAction; error: string }>
}

const emptyApplyResult = (applied: number): ApplyInstancesResult => ({
  applied,
  started: [],
  stopped: [],
  removed: [],
  recreated: [],
  unchanged: [],
  failed: [],
})

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))
```

- [ ] **Step 6: Implement changed-instance detection**

In `src/debug/instance-route-support.ts`, add a local fingerprint helper matching the router:

```typescript
const stableConfigEntries = (config: InstanceConfig): readonly (readonly [string, string])[] =>
  Object.entries(config).toSorted(([left], [right]) => left.localeCompare(right))

const configFingerprint = (type: PlatformInstance['type'], config: InstanceConfig): string =>
  Bun.hash(JSON.stringify({ type, config: stableConfigEntries(config) })).toString(16)

const runtimeNeedsRecreate = (runtime: ReturnType<ChatRouter['getInstance']>, desired: PlatformInstance): boolean => {
  if (runtime === null) return false
  return runtime.type !== desired.type || runtime.configFingerprint !== configFingerprint(desired.type, desired.config)
}
```

- [ ] **Step 7: Replace `/apply` implementation**

Replace `applyPlatformInstances()` with bounded lifecycle helpers that update the result arrays:

```typescript
export const applyPlatformInstances = async (deps: InstanceApiDeps): Promise<Response> => {
  const router = deps.getRuntimeChatRouter()
  if (router === null) return jsonResponse({ error: 'router not initialised' }, { status: 503 })

  const activeInstances = deps.listActivePlatformInstances()
  const result = emptyApplyResult(activeInstances.length)
  const activeById = new Map(activeInstances.map((instance) => [instance.id, instance]))
  const runtimeIds = router.listInstances().map((instance) => instance.id)
  const limit = pLimit(INSTANCE_APPLY_CONCURRENCY)

  await Promise.all(
    runtimeIds
      .filter((id) => !activeById.has(id))
      .map((id) =>
        limit(async () => {
          try {
            await router.removeInstance(id)
            result.stopped.push(id)
            result.removed.push(id)
          } catch (error) {
            result.failed.push({ id, action: 'remove', error: errorMessage(error) })
          }
        }),
      ),
  )

  await Promise.all(
    activeInstances.map((instance) =>
      limit(async () => {
        const runtime = router.getInstance(instance.id)
        try {
          if (runtime === null) {
            router.addInstance(instance.id, instance.type, instance.config)
            await router.startInstance(instance.id)
            result.started.push(instance.id)
            return
          }
          if (runtimeNeedsRecreate(runtime, instance)) {
            await router.removeInstance(instance.id)
            result.stopped.push(instance.id)
            result.removed.push(instance.id)
            router.addInstance(instance.id, instance.type, instance.config)
            await router.startInstance(instance.id)
            result.started.push(instance.id)
            result.recreated.push(instance.id)
            return
          }
          if (runtime.status === 'stopped') {
            await router.startInstance(instance.id)
            result.started.push(instance.id)
            return
          }
          result.unchanged.push(instance.id)
        } catch (error) {
          result.failed.push({ id: instance.id, action: 'recreate', error: errorMessage(error) })
        }
      }),
    ),
  )

  return jsonResponse(result)
}
```

If `ChatRouter['getInstance']` typing is awkward, introduce a local `type RuntimeInstance = NonNullable<ReturnType<ChatRouter['getInstance']>>` and use `RuntimeInstance | null`.

- [ ] **Step 8: Run apply and schema tests**

Run: `bun test tests/debug/instance-routes.test.ts tests/client/admin/instance-fetcher-schemas.test.ts`

Expected: PASS after updating old `{ applied }` assertions to include the detailed arrays.

- [ ] **Step 9: Commit**

```bash
git add src/debug/instance-route-support.ts src/debug/instance-routes.ts client/shared/api-types.ts client/admin/fetcher-schemas.ts tests/debug/instance-routes.test.ts tests/client/admin/instance-fetcher-schemas.test.ts
git commit -m "feat: reconcile platform instances on apply"
```

---

## Task 3: Duplicate Create Errors And Consistent Cache Invalidation

**Files:**

- Modify: `src/debug/instance-routes.ts`
- Test: `tests/debug/instance-routes.test.ts`

- [ ] **Step 1: Write duplicate-create tests**

Add tests that inject duplicate errors through dependencies or by pre-seeding and bypassing the preflight with a race helper. The simplest local pattern is to add a direct exported helper test if the route already supports DI; otherwise simulate by creating two rows in sequence and asserting the second route call:

```typescript
test('POST /api/platform-instances maps duplicate insert failures to 409', async () => {
  insertPlatformInstance({ id: 'telegram-main', type: 'telegram', config: { token: 'secret' }, status: 'active' })

  const res = expectResponse(
    await route('/api/platform-instances', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ id: 'telegram-main', type: 'telegram', config: { token: 'other-secret' } }),
    }),
  )

  expect(res.status).toBe(409)
  expect(await readJson(res)).toEqual({ error: 'instance_exists', id: 'telegram-main' })
})

test('POST /api/task-instances maps duplicate insert failures to 409', async () => {
  insertTaskInstance({
    id: 'tasks-main',
    type: 'kaneo',
    config: { baseUrl: 'https://kaneo.invalid' },
    status: 'active',
  })

  const res = expectResponse(
    await route('/api/task-instances', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ id: 'tasks-main', type: 'kaneo', config: { baseUrl: 'https://other.invalid' } }),
    }),
  )

  expect(res.status).toBe(409)
  expect(await readJson(res)).toEqual({ error: 'instance_exists', id: 'tasks-main' })
})
```

- [ ] **Step 2: Run duplicate tests**

Run: `bun test tests/debug/instance-routes.test.ts -t "duplicate insert failures"`

Expected: PASS for preflight duplicates today, or FAIL if the test is upgraded to inject an insert-race error. Keep the stronger race-injection test if feasible with local DI.

- [ ] **Step 3: Add SQLite constraint detection helper**

In `src/debug/instance-routes.ts`, add near route helpers:

```typescript
const isSqliteConstraintError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false
  const candidate = error as Error & { readonly code?: string }
  return candidate.code === 'SQLITE_CONSTRAINT' || error.message.includes('UNIQUE constraint failed')
}

const insertOrConflict = (id: string, insert: () => void): Response | null => {
  try {
    insert()
    return null
  } catch (error) {
    if (isSqliteConstraintError(error)) return instanceExistsError(id)
    throw error
  }
}
```

- [ ] **Step 4: Wrap platform and task inserts**

Update the platform POST path:

```typescript
const conflict = insertOrConflict(body.id, () => insertPlatformInstance({ ...body, status: 'active' }))
if (conflict !== null) return conflict
```

Update the task POST path similarly:

```typescript
const conflict = insertOrConflict(body.id, () => insertTaskInstance({ ...body, status: 'active' }))
if (conflict !== null) return conflict
```

- [ ] **Step 5: Add platform mutation cache invalidation tests**

Add a test proving platform PATCH clears referencing context caches:

```typescript
test('PATCH /api/platform-instances/:id clears referencing context tool cache', async () => {
  seedPlatformInstance('telegram-main')
  seedTaskInstance('tasks-main')
  setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'tasks-main', platformInstanceId: 'telegram-main' })
  setCachedTools('ctx-1', { old_tool: {} })

  const res = expectResponse(
    await route('/api/platform-instances/telegram-main', {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ status: 'stopped' }),
    }),
  )

  expect(res.status).toBe(200)
  expect(cachedToolsFor('ctx-1')).toBeNull()
})
```

- [ ] **Step 6: Clear platform caches consistently**

In `handlePlatformStatusUpdate()` and `handlePlatformPatch()`, collect referencing context IDs before update and call:

```typescript
clearToolCachesForContexts(referencingContextIds)
```

Use the same pattern already present in task PATCH and platform DELETE.

- [ ] **Step 7: Run instance route tests**

Run: `bun test tests/debug/instance-routes.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/debug/instance-routes.ts tests/debug/instance-routes.test.ts
git commit -m "fix: harden instance route mutations"
```

---

## Task 4: Resolver-Time Contributed Config Validation

**Files:**

- Modify: `src/debug/instance-config-validation.ts`
- Modify: `src/debug/task-provider-type-routes.ts`
- Modify: `src/providers/resolver.ts`
- Test: `tests/providers/resolver.test.ts`
- Test: `tests/debug/instance-routes.test.ts`

- [ ] **Step 1: Write resolver validation test**

Add to `tests/providers/resolver.test.ts`:

```typescript
test('returns null when contributed provider validator rejects resolved config', async () => {
  const factory = mock(() => createMockProvider({ name: resolverProviderType }))
  const validateConfig = mock(async (_config: Record<string, string>) => ({
    ok: false as const,
    reason: 'invalid token',
  }))
  registerContributedTaskProviderType(resolverProviderType, {
    pluginId: resolverPluginId,
    factory,
    validateConfig,
    capabilities: new Set(),
    displayName: 'Plugin Tracker',
    instanceConfigSchema: [{ key: 'baseUrl', label: 'Base URL', required: true, sensitive: false, scope: 'instance' }],
    contextConfigSchema: [{ key: 'token', label: 'Token', required: true, sensitive: true, scope: 'context' }],
    traits: new Set(),
  })
  try {
    insertTaskInstance({
      id: 'resolver-plugin-validated',
      type: resolverProviderType,
      config: { baseUrl: 'https://tracker.invalid' },
      status: 'active',
    })
    setContextSettings({
      contextId: 'ctx-resolver-plugin',
      taskInstanceId: 'resolver-plugin-validated',
      platformInstanceId: 'telegram-default',
    })
    setConfigValue('ctx-resolver-plugin', `plugin:${resolverPluginId}:provider:token`, 'bad-token')

    const provider = await new TaskProviderResolver().resolve('ctx-resolver-plugin')

    expect(provider).toBeNull()
    expect(validateConfig).toHaveBeenCalledWith({ baseUrl: 'https://tracker.invalid', token: 'bad-token' })
    expect(factory).not.toHaveBeenCalled()
  } finally {
    unregisterContributedTaskProviderType(resolverPluginId)
  }
})
```

If `resolve()` remains synchronous, update the implementation to return `Promise<TaskProvider | null>` and update call sites deliberately. If that churn is too broad, add a synchronous validator contract instead. Prefer async only if call sites already await resolver-compatible functions.

- [ ] **Step 2: Run the failing resolver test**

Run: `bun test tests/providers/resolver.test.ts -t "validator rejects resolved config"`

Expected: FAIL because resolver does not call contributed validators.

- [ ] **Step 3: Extract validation result helpers**

In `src/debug/instance-config-validation.ts`, define reusable types:

```typescript
export type InstanceConfigValidationFailure =
  | { readonly kind: 'unknown_task_provider_type'; readonly type: string }
  | {
      readonly kind: 'invalid_task_instance_config'
      readonly type: string
      readonly missing: readonly string[]
      readonly invalidUrls: readonly string[]
    }
  | { readonly kind: 'invalid_task_instance_config'; readonly type: string; readonly reason: string }

export const validateTaskInstanceConfigResult = async (
  type: string,
  config: InstanceConfig,
): Promise<InstanceConfigValidationFailure | null> => {
  const descriptor = getTaskProviderDescriptor(type)
  if (descriptor === undefined) return { kind: 'unknown_task_provider_type', type }
  const descriptorResult = validateDescriptorConfig(descriptor.instanceConfigSchema, config)
  if (descriptorResult.missing.length > 0 || descriptorResult.invalidUrls.length > 0) {
    return { kind: 'invalid_task_instance_config', type, ...descriptorResult }
  }
  const validator = getTaskProviderConfigValidator(type)
  if (validator === undefined) return null
  const result = await validator(config)
  return result.ok ? null : { kind: 'invalid_task_instance_config', type, reason: result.reason }
}
```

Import `getTaskProviderConfigValidator` from `src/providers/registry.ts`. Keep existing route response helpers by mapping this result to `Response`.

- [ ] **Step 4: Reuse helper from route validation**

In `validateTaskInstanceRouteConfig()`, call `validateTaskInstanceConfigResult()` and convert failures:

```typescript
export const taskConfigValidationFailureResponse = (failure: InstanceConfigValidationFailure): Response => {
  if (failure.kind === 'unknown_task_provider_type') {
    return jsonResponse({ error: 'unknown_task_provider_type', type: failure.type }, { status: 400 })
  }
  if ('reason' in failure) {
    return jsonResponse({ error: 'invalid_task_instance_config', reason: failure.reason }, { status: 400 })
  }
  return validationResponse('invalid_task_instance_config', failure.type, failure)!
}

export const validateTaskInstanceRouteConfig = async (
  type: string,
  config: InstanceConfig,
): Promise<Response | null> => {
  const failure = await validateTaskInstanceConfigResult(type, config)
  return failure === null ? null : taskConfigValidationFailureResponse(failure)
}
```

Remove the now-duplicated route-only `validateTaskInstanceConfig()` path from `task-provider-type-routes.ts` or keep it as a thin wrapper if callers remain.

- [ ] **Step 5: Update resolver to validate contributed config**

If resolver becomes async, update `resolve()`:

```typescript
async resolve(contextId: string): Promise<TaskProvider | null> {
  // existing settings, instance, active, descriptor, config checks
  if (descriptor !== undefined && descriptor.source !== 'builtin') {
    const failure = await validateTaskInstanceConfigResult(instance.type, config)
    if (failure !== null) {
      log.warn({ contextId, taskInstanceId: instance.id, taskProvider: instance.type }, 'Cannot resolve task provider: invalid config')
      return null
    }
  }
  return this.deps.createProvider(instance.type, config)
}
```

If async conversion touches many call sites, add `validateConfig` to `TaskProviderResolverDeps` and use a synchronous local wrapper only for contributed validators that are synchronous. Do not silently fire-and-forget async validators.

- [ ] **Step 6: Update call sites for async resolver if needed**

Search for `defaultTaskProviderResolver.resolve(` and `.resolve(` on `TaskProviderResolver`. Update callers to `await`. Likely files include:

```typescript
// src/scheduler.ts
resolve: (contextId): Promise<TaskProvider | null> => defaultTaskProviderResolver.resolve(contextId)
```

Then update function signatures that consume resolver results to async where they are not already async. Run typecheck to find every required change.

- [ ] **Step 7: Run resolver and route tests**

Run: `bun test tests/providers/resolver.test.ts tests/debug/instance-routes.test.ts`

Expected: PASS.

- [ ] **Step 8: Run typecheck**

Run: `bun typecheck`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/debug/instance-config-validation.ts src/debug/task-provider-type-routes.ts src/providers/resolver.ts tests/providers/resolver.test.ts tests/debug/instance-routes.test.ts
git commit -m "fix: validate task provider config during resolution"
```

---

## Task 5: Plugin Manifest Provider Metadata Alignment

**Files:**

- Modify: `src/plugins/types.ts`
- Modify: `src/plugins/loader.ts`
- Modify: `src/plugins/context.ts`
- Test: `tests/plugins/context.test.ts`
- Test: `tests/plugins/loader.test.ts`

- [ ] **Step 1: Write provider traits and storage key facade tests**

Add to `tests/plugins/context.test.ts`:

```typescript
test('registers provider storage keys and traits from manifest metadata', () => {
  const manifest = baseManifest({
    id: 'provider-metadata-plugin',
    permissions: ['provider.task'],
    contributes: {
      tools: [],
      promptFragments: [],
      commands: [],
      jobs: [],
      configKeys: [],
      taskProviderTypes: ['metadata-tracker'],
    },
    providerCapabilities: ['tasks.commands'],
    providerTraits: ['supports-command-language'],
    providerConfigSchema: [{ key: 'baseUrl', label: 'Base URL', required: true, sensitive: false, scope: 'instance' }],
    providerContextConfigSchema: [
      {
        key: 'apiToken',
        storageKey: 'metadata_token',
        label: 'API Token',
        required: true,
        sensitive: true,
        scope: 'context',
      },
    ],
  })
  const { ctx } = buildPluginContext(manifest, '__system__')

  ctx.registration.registerTaskProviderType('metadata-tracker', {
    factory: () => createMockProvider({ name: 'metadata-tracker' }),
  })

  const descriptor = getTaskProviderDescriptor('metadata-tracker')
  expect(descriptor?.traits.has('supports-command-language')).toBe(true)
  expect(descriptor?.contextConfigSchema.find((field) => field.key === 'apiToken')?.storageKey).toBe('metadata_token')
})
```

Use existing manifest/test helpers in the file; do not introduce new global helpers if local ones already exist.

- [ ] **Step 2: Run failing context metadata test**

Run: `bun test tests/plugins/context.test.ts -t "storage keys and traits"`

Expected: FAIL because manifest schemas do not accept `storageKey`/`providerTraits`, and context hardcodes empty traits.

- [ ] **Step 3: Extend plugin manifest schemas**

In `src/plugins/types.ts`, add a trait tuple near capability tuples:

```typescript
const taskProviderTraitTuple = [
  'workspace-scoped',
  'task-label-read-requires-provider-specific-api',
  'supports-command-language',
  'command-language:youtrack',
  'custom-fields',
] as const satisfies readonly TaskProviderTrait[]
```

Import `TaskProviderTrait` from provider types or task-capability. Extend provider config schemas:

```typescript
const providerInstanceConfigRequirementSchema = configRequirementBaseSchema.extend({
  scope: z.literal('instance').optional().default('instance'),
  storageKey: configKeySchema.optional(),
})

const providerContextConfigRequirementSchema = configRequirementBaseSchema.extend({
  scope: z.literal('context').optional().default('context'),
  storageKey: configKeySchema.optional(),
})
```

Add manifest field:

```typescript
providerTraits: z.array(z.enum(taskProviderTraitTuple)).optional().default([]),
```

- [ ] **Step 4: Preserve storage keys and traits in context facade**

In `src/plugins/context.ts`, update `toProviderConfigField()` input:

```typescript
const toProviderConfigField = (
  field: { key: string; label: string; required: boolean; sensitive: boolean; storageKey?: string },
  scope: ProviderConfigField['scope'],
): ProviderConfigField => ({
  key: field.key,
  label: field.label,
  required: field.required,
  sensitive: field.sensitive,
  scope,
  ...(field.storageKey === undefined ? {} : { storageKey: field.storageKey }),
})
```

Then replace `traits: new Set()` with:

```typescript
traits: new Set(manifest.providerTraits),
```

- [ ] **Step 5: Write loader validator export test**

In `tests/plugins/loader.test.ts`, add a test plugin module that exports a named validator and a manifest with `providerConfigValidator: 'validateTrackerConfig'`. Assert that a task instance create using that provider invokes the validator through the registry after activation.

Use this module body in the temporary plugin entry:

```typescript
export const validateTrackerConfig = async (config: Record<string, string>) =>
  config['baseUrl'] === 'https://ok.invalid'
    ? { ok: true as const }
    : { ok: false as const, reason: 'baseUrl rejected' }

export default () => ({
  activate(ctx) {
    ctx.registration.registerTaskProviderType('validated-plugin-tracker', {
      factory: () => ({
        name: 'validated-plugin-tracker',
        capabilities: new Set(),
        traits: new Set(),
        configRequirements: [],
        async createTask() {
          throw new Error('not used')
        },
        async updateTask() {
          throw new Error('not used')
        },
        async searchTasks() {
          return []
        },
        async listTasks() {
          return []
        },
        async getTask() {
          return null
        },
      }),
    })
  },
})
```

Expected assertion after activation:

```typescript
const validator = getTaskProviderConfigValidator('validated-plugin-tracker')
expect(await validator?.({ baseUrl: 'https://bad.invalid' })).toEqual({ ok: false, reason: 'baseUrl rejected' })
```

- [ ] **Step 6: Run failing loader validator test**

Run: `bun test tests/plugins/loader.test.ts -t "providerConfigValidator"`

Expected: FAIL because loader does not resolve manifest-named validator exports.

- [ ] **Step 7: Resolve validator exports during activation**

In `src/plugins/loader.ts`, change `importPluginModule()` to return both plugin instance and module object:

```typescript
type ImportedPluginModule = Readonly<{ instance: PluginInstance; module: Record<string, unknown> }>

async function importPluginModule(entryPoint: string): Promise<ImportedPluginModule> {
  const mod: unknown = await import(entryPoint)
  const moduleRecord = typeof mod === 'object' && mod !== null ? (mod as Record<string, unknown>) : {}
  const candidate = 'default' in moduleRecord ? moduleRecord.default : mod
  if (!isPluginFactory(candidate))
    throw new Error('Invalid plugin module contract: default export must be a factory function')
  const instance = candidate()
  if (!isPluginInstance(instance))
    throw new Error('Invalid plugin module contract: factory must return an object with activate(ctx)')
  return { instance, module: moduleRecord }
}
```

Add validator resolver:

```typescript
const resolveManifestProviderValidator = (
  plugin: DiscoveredPlugin,
  moduleRecord: Record<string, unknown>,
): TaskProviderConfigValidator | undefined => {
  const exportName = plugin.manifest.providerConfigValidator
  if (exportName === undefined) return undefined
  const candidate = moduleRecord[exportName]
  if (typeof candidate !== 'function') {
    throw new Error(`Provider config validator export '${exportName}' is not a function`)
  }
  return candidate as TaskProviderConfigValidator
}
```

Import `TaskProviderConfigValidator`. Pass this validator into `buildPluginContext()` by adding an optional third parameter or by wrapping `ctx.registration.registerTaskProviderType()` during activation. Prefer extending `buildPluginContext(manifest, contextId, { providerConfigValidator })` so `context.ts` owns registration mapping.

- [ ] **Step 8: Thread validator through context registration**

In `src/plugins/context.ts`, add options:

```typescript
export type BuildPluginContextOptions = Readonly<{ providerConfigValidator?: TaskProviderConfigValidator }>
```

Update `buildRegisterTaskProviderType()` to receive options and use:

```typescript
validateConfig: descriptor.validateConfig ?? options.providerConfigValidator,
```

Keep explicit runtime descriptor validators winning over manifest validators.

- [ ] **Step 9: Run plugin tests**

Run: `bun test tests/plugins/context.test.ts tests/plugins/loader.test.ts`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/plugins/types.ts src/plugins/loader.ts src/plugins/context.ts tests/plugins/context.test.ts tests/plugins/loader.test.ts
git commit -m "feat: honor plugin provider metadata"
```

---

## Task 6: Typed Chat Adapter Config And Env Boundary Cleanup

**Files:**

- Modify: `src/chat/registry.ts`
- Modify: `src/chat/telegram/index.ts`
- Modify: `src/chat/discord/index.ts`
- Modify: `src/chat/mattermost/config.ts`
- Modify: `src/chat/mattermost/index.ts`
- Test: `tests/chat/registry.test.ts`
- Test: provider-specific constructor tests if present under `tests/chat/{telegram,discord,mattermost}`

- [ ] **Step 1: Write registry test for typed instance config**

Add to `tests/chat/registry.test.ts`:

```typescript
test('createChatProviderFromConfig constructs adapters from typed instance config without env mapping', () => {
  const provider = createChatProviderFromConfig('telegram-main', 'telegram', { token: 'secret-token' })

  expect(provider.name).toBe('telegram')
  expect(provider).toHaveProperty('start')
})
```

Add a Mattermost variant that passes `{ baseUrl: 'https://mm.invalid', token: 'secret' }` and asserts construction succeeds.

- [ ] **Step 2: Run registry tests**

Run: `bun test tests/chat/registry.test.ts`

Expected: PASS today through env mapping. Keep the test as a safety net while refactoring internals.

- [ ] **Step 3: Introduce typed factory map**

In `src/chat/registry.ts`, add:

```typescript
type InstanceChatProviderFactory = (id: string, config: InstanceConfig) => ChatProvider

const instanceProviders = new Map<PlatformInstanceType, InstanceChatProviderFactory>([
  ['telegram', (id, config) => new TelegramChatProvider({ token: config['token'], platformInstanceId: id })],
  [
    'mattermost',
    (id, config) =>
      new MattermostChatProvider({ baseUrl: config['baseUrl'], token: config['token'], platformInstanceId: id }),
  ],
  ['discord', (id, config) => new DiscordChatProvider({ token: config['token'], platformInstanceId: id })],
])
```

Then make `createChatProviderFromConfig()` validate typed config and call this map instead of `configToEnv()`.

- [ ] **Step 4: Update adapter constructors to accept typed objects**

Use backward-compatible constructor overloads only where tests still need them. Target shapes:

```typescript
// Telegram
constructor(config: { readonly token?: string; readonly platformInstanceId?: string })

// Discord
constructor(config: { readonly clientFactory?: DiscordClientFactory; readonly token?: string; readonly platformInstanceId?: string })

// Mattermost config
export type MattermostConstructorConfig = Partial<{
  baseUrl: string
  token: string
  platformInstanceId: string
}>
```

Env fallback should remain only in `createChatProvider(name, deps)` for legacy env bootstrap tests, not in DB-managed instance construction.

- [ ] **Step 5: Remove `configToEnv()`**

Delete `configToEnv()` from `src/chat/registry.ts`. Keep validation through `validatePlatformInstanceConfig()` or `validateChatProviderEnv()` equivalent checks so missing tokens still fail clearly.

- [ ] **Step 6: Run chat tests**

Run: `bun test tests/chat/registry.test.ts tests/chat/router.test.ts tests/chat/telegram/commands.test.ts tests/chat/mattermost/index.test.ts tests/chat/discord/index.test.ts`

Expected: PASS. If some files do not exist, run the existing provider-specific suites returned by `glob tests/chat/**/*.test.ts` for touched adapters.

- [ ] **Step 7: Commit**

```bash
git add src/chat/registry.ts src/chat/telegram/index.ts src/chat/discord/index.ts src/chat/mattermost/config.ts src/chat/mattermost/index.ts tests/chat/registry.test.ts tests/chat
git commit -m "refactor: construct chat adapters from typed config"
```

---

## Task 7: Legacy Descriptor And URL Compatibility Cleanup

**Files:**

- Modify: `src/providers/registry.ts`
- Modify: `src/providers/resolver.ts`
- Modify: `src/providers/kaneo/provision.ts`
- Modify: `src/commands/setup.ts`
- Modify tests that still use `configSchema` or `url` legacy fields.

- [ ] **Step 1: Find remaining production `configSchema` readers**

Run: `rg "\.configSchema|configSchema" src client tests`

Expected: production readers are limited to `src/providers/registry.ts` compatibility construction; tests may still use `configSchema` fixtures.

- [ ] **Step 2: Replace test fixtures with split schemas**

For every contributed provider test fixture, replace:

```typescript
configSchema: [{ key: 'baseUrl', label: 'URL', required: true, sensitive: false, scope: 'instance' }]
```

with:

```typescript
instanceConfigSchema: [{ key: 'baseUrl', label: 'URL', required: true, sensitive: false, scope: 'instance' }]
```

For context fields, use:

```typescript
contextConfigSchema: [{ key: 'token', label: 'Token', required: true, sensitive: true, scope: 'context' }]
```

- [ ] **Step 3: Remove legacy combined descriptor field**

In `src/providers/registry.ts`, remove:

```typescript
configSchema?: readonly LegacyProviderConfigField[]
configSchema: readonly ProviderConfigField[]
legacyConfigSchema()
```

Update `contributedInstanceFields()` and `contributedContextFields()` to read only `entry.instanceConfigSchema` and `entry.contextConfigSchema`.

- [ ] **Step 4: Remove `scope: 'user'` remap**

In `src/providers/registry.ts`, change `LegacyProviderConfigField` to `ProviderConfigField` or remove the legacy type entirely. `normalizeConfigField()` should no longer remap `'user'` to `'context'`.

- [ ] **Step 5: Remove `url` fallback after migration coverage**

In `src/providers/resolver.ts`, update `readInstanceScopedField()`:

```typescript
const readInstanceScopedField = (instance: TaskInstance, fieldKey: string): string | undefined =>
  instance.config[fieldKey]
```

In `src/providers/kaneo/provision.ts` and `src/commands/setup.ts`, replace `config['url']` fallbacks with `config['baseUrl']` and ensure tests seed `baseUrl`.

- [ ] **Step 6: Run registry, resolver, config, and setup tests**

Run: `bun test tests/providers/registry.test.ts tests/providers/resolver.test.ts tests/config-keys.test.ts tests/config-editor/index.test.ts tests/config-editor/handlers.test.ts tests/commands/config.test.ts tests/commands/setup.test.ts tests/wizard/steps.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/providers/registry.ts src/providers/resolver.ts src/providers/kaneo/provision.ts src/commands/setup.ts tests/providers tests/config-keys.test.ts tests/config-editor tests/commands tests/wizard
git commit -m "refactor: remove legacy provider config schema paths"
```

---

## Task 8: Manual Cascade Helper And Default Instance ID Cleanup

**Files:**

- Modify: `src/instances/context-store.ts`
- Modify: `src/instances/admin-store.ts`
- Modify: chat adapter constructors if default IDs remain after Task 6.
- Test: `tests/db/migrations/044_instance_integrity.test.ts`
- Test: `tests/debug/instance-routes.test.ts`
- Test: relevant chat adapter tests.

- [ ] **Step 1: Verify helper references**

Run: `rg "deleteContextsByTaskInstance|deleteContextsByPlatformInstance|deleteAdminsByPlatformInstance|telegram-default|discord-default|mattermost-default" src tests`

Expected: manual cascade helpers have no production callers; default IDs appear in tests and seed helpers only after Task 6.

- [ ] **Step 2: Remove manual cascade helper exports if unused**

Delete these functions if `rg` confirms no production callers:

```typescript
deleteContextsByTaskInstance
deleteContextsByPlatformInstance
deleteAdminsByPlatformInstance
```

Do not remove `listContextsByTaskInstance()` or `listContextsByPlatformInstance()`; routes still need them for cache invalidation and references display.

- [ ] **Step 3: Move default instance IDs to tests**

If adapter constructors still invent default IDs, remove the fallback from production constructors and update tests to pass explicit IDs:

```typescript
new TelegramChatProvider({ token: 'test-token', platformInstanceId: 'telegram-default' })
new DiscordChatProvider({ token: 'test-token', platformInstanceId: 'discord-default' })
new MattermostChatProvider({
  baseUrl: 'https://mm.invalid',
  token: 'test-token',
  platformInstanceId: 'mattermost-default',
})
```

- [ ] **Step 4: Run cascade and chat tests**

Run: `bun test tests/db/migrations/044_instance_integrity.test.ts tests/debug/instance-routes.test.ts tests/chat/router.test.ts`

Expected: PASS.

- [ ] **Step 5: Run dead export check**

Run: `bun knip`

Expected: PASS or no new unused export findings from removed helpers.

- [ ] **Step 6: Commit**

```bash
git add src/instances/context-store.ts src/instances/admin-store.ts src/chat tests
git commit -m "refactor: remove obsolete multi-provider compatibility helpers"
```

---

## Task 9: Full Verification

**Files:**

- No source changes expected.

- [ ] **Step 1: Run focused suites**

Run: `bun test tests/chat/router.test.ts tests/debug/instance-routes.test.ts tests/providers/resolver.test.ts tests/providers/registry.test.ts tests/plugins/context.test.ts tests/plugins/loader.test.ts tests/client/admin/instance-fetcher-schemas.test.ts tests/scripts/check.test.ts`

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `bun typecheck`

Expected: PASS.

- [ ] **Step 3: Run lint**

Run: `bun lint`

Expected: PASS.

- [ ] **Step 4: Run format check**

Run: `bun format:check`

Expected: PASS.

- [ ] **Step 5: Run main curated tests**

Run: `bun test`

Expected: PASS.

- [ ] **Step 6: Run admin client tests if client schemas changed**

Run: `bun test:client`

Expected: PASS.

- [ ] **Step 7: Commit final verification note only if files changed**

If no files changed, do not create an empty commit. If verification required updating this implementation plan with final notes, commit that file explicitly:

```bash
git add docs/superpowers/plans/2026-05-29-multi-provider-review-cleanup.md
git commit -m "docs: update multi-provider cleanup notes"
```

---

## Self-Review

- Spec coverage: Phase 1 runtime reconciliation is covered by Tasks 1-3. Phase 2 validation hardening is covered by Task 4. Phase 3 plugin metadata alignment is covered by Task 5. Phase 4 compatibility cleanup is covered by Tasks 6-8. Full verification is covered by Task 9.
- Placeholder scan: no task uses unresolved placeholder markers or unspecified “add tests” instructions. Each task names exact files, commands, and expected outcomes.
- Type consistency: plan uses `configFingerprint`, `ApplyInstancesResult`, `providerTraits`, `providerConfigValidator`, and `validateTaskInstanceConfigResult` consistently across tasks.
