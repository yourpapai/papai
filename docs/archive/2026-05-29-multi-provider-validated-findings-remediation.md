<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-Provider Validated Findings Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all validated multi-provider review findings from the approved layered remediation spec.

**Architecture:** Keep the DB-backed instance model and `/api/platform-instances/apply` reconciliation boundary. Harden key derivation and row decoding first, then make router lifecycle state truthful, split task-provider validation by instance-only versus effective config, remove env-shaped construction seams, and finish with dead-code and observability cleanup.

**Tech Stack:** Bun, TypeScript, Bun test runner, SQLite via `bun:sqlite` and Drizzle, Zod v4, Node `crypto.scryptSync`, p-limit, existing admin/debug API routes.

---

## File Structure

- Modify: `src/instances/encryption.ts` — key-mode diagnostics, scrypt passphrase derivation, host-local fallback derivation.
- Modify: `tests/instances/encryption.test.ts` — explicit key, passphrase, host-local fallback, and legacy payload round-trip coverage.
- Modify: `src/instances/platform-store.ts` — safe platform row decoding and active-list helper.
- Modify: `src/instances/task-store.ts` — safe task row decoding for admin diagnostics.
- Modify: `src/instances/types.ts` — shared unreadable-row diagnostic types used by both stores and routes.
- Modify: `src/index.ts` — startup uses safe active platform list and skips unreadable rows.
- Modify: `src/debug/instance-routes.ts` — admin list diagnostics for unreadable instance rows.
- Modify: `src/debug/instance-route-support.ts` — desired status aware `/apply`, accurate remove failure action, detailed removed diagnostics.
- Modify: `client/shared/api-types.ts` — expanded apply and list response types.
- Modify: `client/admin/fetcher-schemas.ts` and `client/admin/instance-fetchers.ts` — parse expanded apply and list response shapes.
- Modify: `tests/debug/instance-routes.test.ts` — safe decode, pending/stopped apply, remove failure action, and route diagnostic tests.
- Modify: `src/chat/router.ts` — idempotent active start, truthful stop state, remove non-strict dead method.
- Modify: `tests/chat/router.test.ts` — active-start and failed-stop tests, update remove tests.
- Modify: `src/providers/config-validation.ts` — explicit instance-only and effective-config validation helpers.
- Modify: `src/debug/instance-config-validation.ts` — route uses instance-only task validation.
- Modify: `src/providers/resolver.ts` — resolver uses effective-config validation and context-aware Kaneo workspace API.
- Modify: `tests/providers/resolver.test.ts` — effective validation and context-aware Kaneo tests.
- Modify: `src/plugins/types.ts` — remove manual optionality override for defaulted manifest fields.
- Modify: `tests/plugins/manifest-schema.test.ts` and `tests/plugins/types.test.ts` — parsed manifest defaults are non-optional.
- Modify: `src/chat/telegram/index.ts`, `src/chat/discord/index.ts`, `src/chat/mattermost/config.ts`, `src/chat/kontur-talk/config.ts` — remove env fallback construction.
- Modify: `src/chat/*/metadata.ts` — align config requirement keys with DB descriptor keys.
- Modify: `tests/chat/*/index.test.ts` — explicit constructor config, no env fallback expectations.
- Modify: `src/users.ts`, `src/cache.ts`, `src/providers/kaneo/provision.ts`, `src/commands/setup.ts`, `src/scheduler.ts` — rename Kaneo workspace helpers to context-aware APIs.
- Modify: `src/db/drizzle.ts` — retain and close raw sqlite handle.
- Modify: `src/db/migrations/041_users_platform_instance_index.ts`, `src/db/migrations/045_provider_base_url.ts` — migration completion logging.
- Modify: `src/instances/bootstrap.ts` — remove unreachable partial-env recheck branch.
- Modify or create tests under `tests/db/` and `tests/instances/` for Drizzle close and bootstrap branch behavior.

---

## Task 1: Harden Instance Config Key Derivation

**Files:**

- Modify: `src/instances/encryption.ts`
- Test: `tests/instances/encryption.test.ts`

- [ ] **Step 1: Add failing key-derivation tests**

Add these imports in `tests/instances/encryption.test.ts`:

```typescript
import { createHash } from 'node:crypto'
```

Extend the existing encryption import:

```typescript
import {
  decryptInstanceConfig,
  encryptInstanceConfig,
  maskConfig,
  resolveInstanceConfigKey,
  resolveInstanceConfigKeyInfo,
} from '../../src/instances/encryption.js'
```

Add these tests inside `describe('encryption', () => { ... })`, replacing the current SHA-256 non-hex and generic fallback tests:

```typescript
test('resolveInstanceConfigKey derives non-hex passphrases with scrypt instead of SHA-256', () => {
  process.env['INSTANCE_CONFIG_KEY'] = 'not-a-hex-key'

  const info = resolveInstanceConfigKeyInfo()
  const bareSha = createHash('sha256').update('not-a-hex-key', 'utf8').digest()

  expect(info.mode).toBe('passphrase')
  expect(info.key.length).toBe(32)
  expect(info.key.equals(bareSha)).toBe(false)
  expect(resolveInstanceConfigKey().equals(info.key)).toBe(true)
})

test('resolveInstanceConfigKey derives missing-key fallback from host material', () => {
  delete process.env['INSTANCE_CONFIG_KEY']

  const left = resolveInstanceConfigKeyInfo({ hostname: () => 'host-a', homeDir: () => '/home/a' })
  const right = resolveInstanceConfigKeyInfo({ hostname: () => 'host-b', homeDir: () => '/home/a' })
  const repeat = resolveInstanceConfigKeyInfo({ hostname: () => 'host-a', homeDir: () => '/home/a' })

  expect(left.mode).toBe('host-local-fallback')
  expect(left.key.length).toBe(32)
  expect(left.warning).toContain('not portable')
  expect(left.key.equals(right.key)).toBe(false)
  expect(left.key.equals(repeat.key)).toBe(true)
})
```

- [ ] **Step 2: Run encryption tests to verify failure**

Run: `bun test tests/instances/encryption.test.ts -t "resolveInstanceConfigKey"`

Expected: FAIL because `resolveInstanceConfigKeyInfo` does not exist and the non-hex path still uses SHA-256.

- [ ] **Step 3: Implement key-mode diagnostics and scrypt derivation**

In `src/instances/encryption.ts`, replace the crypto import with:

```typescript
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { homedir, hostname } from 'node:os'
```

Replace the fallback seed and SHA helper area with:

```typescript
const PASSPHRASE_SALT = 'papai:instance-config:passphrase:v1'
const HOST_FALLBACK_SALT = 'papai:instance-config:host-fallback:v1'
const HOST_FALLBACK_WARNING =
  'INSTANCE_CONFIG_KEY is unset; using host-local fallback. DB copies are not portable; production must set INSTANCE_CONFIG_KEY.'

export type InstanceConfigKeyMode = 'explicit' | 'passphrase' | 'host-local-fallback'

export type InstanceConfigKeyInfo = Readonly<{
  key: Buffer
  mode: InstanceConfigKeyMode
  warning?: string
}>

export type InstanceConfigKeyDeps = Readonly<{
  hostname: () => string
  homeDir: () => string
}>

const defaultKeyDeps: InstanceConfigKeyDeps = {
  hostname,
  homeDir: homedir,
}

const deriveKey = (secret: string, salt: string): Buffer => scryptSync(secret, salt, 32)

const hostFallbackMaterial = (deps: InstanceConfigKeyDeps): string => `${deps.hostname()}\n${deps.homeDir()}`
```

Replace `resolveInstanceConfigKey()` with:

```typescript
export const resolveInstanceConfigKeyInfo = (deps: InstanceConfigKeyDeps = defaultKeyDeps): InstanceConfigKeyInfo => {
  const raw = process.env['INSTANCE_CONFIG_KEY']
  if (raw !== undefined && raw.trim() !== '') {
    const trimmed = raw.trim()
    if (isHex64(trimmed)) return { key: Buffer.from(trimmed, 'hex'), mode: 'explicit' }
    return { key: deriveKey(trimmed, PASSPHRASE_SALT), mode: 'passphrase' }
  }
  if (!fallbackWarned) {
    log.warn(HOST_FALLBACK_WARNING)
    fallbackWarned = true
  }
  return {
    key: deriveKey(hostFallbackMaterial(deps), HOST_FALLBACK_SALT),
    mode: 'host-local-fallback',
    warning: HOST_FALLBACK_WARNING,
  }
}

export const resolveInstanceConfigKey = (): Buffer => resolveInstanceConfigKeyInfo().key
```

- [ ] **Step 4: Run encryption tests**

Run: `bun test tests/instances/encryption.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit key derivation hardening**

```bash
git add src/instances/encryption.ts tests/instances/encryption.test.ts
git commit -m "fix: harden instance config key derivation"
```

---

## Task 2: Isolate Unreadable Instance Rows During Startup And Admin Reads

**Files:**

- Modify: `src/instances/types.ts`
- Modify: `src/instances/platform-store.ts`
- Modify: `src/instances/task-store.ts`
- Modify: `src/index.ts`
- Modify: `src/debug/instance-routes.ts`
- Test: `tests/instances/platform-store.test.ts`
- Test: `tests/debug/instance-routes.test.ts`

- [ ] **Step 1: Write failing safe platform decode tests**

Create `tests/instances/platform-store.test.ts` with:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { platformInstances } from '../../src/db/schema.js'
import { insertPlatformInstance, listActivePlatformInstancesSafe } from '../../src/instances/platform-store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('platform instance safe decoding', () => {
  beforeEach(async () => {
    mockLogger()
    process.env['INSTANCE_CONFIG_KEY'] = '5'.repeat(64)
    await setupTestDb()
  })

  test('listActivePlatformInstancesSafe skips unreadable active rows and returns failures', () => {
    insertPlatformInstance({ id: 'good', type: 'telegram', config: { token: 'secret' }, status: 'active' })
    getDrizzleDb()
      .insert(platformInstances)
      .values({ id: 'bad', type: 'telegram', config: 'not-base64', status: 'active' })
      .run()

    const result = listActivePlatformInstancesSafe()

    expect(result.instances.map((instance) => instance.id)).toEqual(['good'])
    expect(result.failures).toEqual([
      {
        table: 'platform_instances',
        id: 'bad',
        type: 'telegram',
        error: expect.stringContaining('Encrypted payload'),
      },
    ])
  })
})
```

- [ ] **Step 2: Run the new store test to verify failure**

Run: `bun test tests/instances/platform-store.test.ts`

Expected: FAIL because `listActivePlatformInstancesSafe` does not exist.

- [ ] **Step 3: Add shared decode result types**

In `src/instances/types.ts`, add:

```typescript
export type InstanceDecodeFailure = Readonly<{
  table: 'platform_instances' | 'task_instances'
  id: string
  type: string
  error: string
}>

export type InstanceDecodeResult<T> = Readonly<{
  instances: T[]
  failures: InstanceDecodeFailure[]
}>
```

- [ ] **Step 4: Implement safe platform decoding**

In `src/instances/platform-store.ts`, extend the type import:

```typescript
import type {
  InstanceConfig,
  InstanceDecodeFailure,
  InstanceDecodeResult,
  InstanceStatus,
  PlatformInstance,
  PlatformInstanceType,
} from './types.js'
```

Add helpers below `rowToInstance`:

```typescript
const decodeFailure = (row: typeof platformInstances.$inferSelect, error: unknown): InstanceDecodeFailure => ({
  table: 'platform_instances',
  id: row.id,
  type: row.type,
  error: error instanceof Error ? error.message : String(error),
})

const rowsToInstancesSafe = (
  rows: readonly (typeof platformInstances.$inferSelect)[],
): InstanceDecodeResult<PlatformInstance> => {
  const instances: PlatformInstance[] = []
  const failures: InstanceDecodeFailure[] = []
  for (const row of rows) {
    try {
      instances.push(rowToInstance(row))
    } catch (error) {
      failures.push(decodeFailure(row, error))
    }
  }
  return { instances, failures }
}
```

Add exports after `listPlatformInstances()`:

```typescript
export const listPlatformInstancesSafe = (): InstanceDecodeResult<PlatformInstance> => {
  const rows = getDrizzleDb().select().from(platformInstances).all()
  return rowsToInstancesSafe(rows)
}

export const listActivePlatformInstancesSafe = (): InstanceDecodeResult<PlatformInstance> => {
  const result = listPlatformInstancesSafe()
  return {
    instances: result.instances.filter((instance) => instance.status === 'active'),
    failures: result.failures,
  }
}
```

- [ ] **Step 5: Implement safe task decoding**

In `src/instances/task-store.ts`, mirror the platform-store pattern with `table: 'task_instances'`, `TaskInstance`, and these exports:

```typescript
export const listTaskInstancesSafe = (): InstanceDecodeResult<TaskInstance> => {
  const rows = getDrizzleDb().select().from(taskInstances).all()
  return rowsToInstancesSafe(rows)
}
```

Keep `listTaskInstances()` unchanged for strict call sites until all callers are intentionally migrated.

- [ ] **Step 6: Use safe active platform decoding at startup**

In `src/index.ts`, change the import from platform store to include `listActivePlatformInstancesSafe` instead of `listActivePlatformInstances`, then replace startup loading with:

```typescript
const activePlatformResult = listActivePlatformInstancesSafe()
for (const failure of activePlatformResult.failures) {
  log.warn(failure, 'Skipping unreadable active platform instance during startup')
}
const chatProvider = new ChatRouter((id, type, config) => createChatProviderFromConfig(id, type, config))
for (const instance of activePlatformResult.instances) {
  try {
    chatProvider.addInstance(instance.id, instance.type, instance.config)
  } catch (error) {
    log.error(
      {
        platformInstanceId: instance.id,
        type: instance.type,
        error: error instanceof Error ? error.message : String(error),
      },
      'Skipping invalid active platform instance during startup',
    )
  }
}
```

- [ ] **Step 7: Surface unreadable rows from admin list routes without breaking clean responses**

In `src/debug/instance-routes.ts`, import `listPlatformInstancesSafe` and `listTaskInstancesSafe`. Add:

```typescript
const instanceListResponse = <T>(instances: readonly T[], unreadable: readonly unknown[]): Response => {
  if (unreadable.length === 0) return jsonResponse(instances)
  return jsonResponse({ instances, unreadable })
}
```

Change platform `GET /api/platform-instances` to:

```typescript
const result = listPlatformInstancesSafe()
return instanceListResponse(
  result.instances.map((instance) => maskedPlatformInstance(instance)),
  result.failures,
)
```

Change task `GET /api/task-instances` to:

```typescript
const result = listTaskInstancesSafe()
return instanceListResponse(
  result.instances.map((instance) => taskInstanceView(instance)),
  result.failures,
)
```

- [ ] **Step 8: Add admin route diagnostic test**

In `tests/debug/instance-routes.test.ts`, add near the platform GET tests:

```typescript
test('GET /api/platform-instances returns readable rows plus unreadable diagnostics', async () => {
  insertPlatformInstance({ id: 'good', type: 'telegram', config: { token: 'secret' }, status: 'active' })
  getTestDb()
    .$client.query(`INSERT INTO platform_instances (id, type, config, status) VALUES (?, ?, ?, ?)`)
    .run('bad', 'telegram', 'not-base64', 'active')

  const res = expectResponse(await route('/api/platform-instances'))

  expect(res.status).toBe(200)
  expect(await readJson(res)).toMatchObject({
    instances: [{ id: 'good', type: 'telegram', config: { token: '********' }, status: 'active' }],
    unreadable: [{ table: 'platform_instances', id: 'bad', type: 'telegram' }],
  })
})
```

- [ ] **Step 9: Run safe decode and route tests**

Run: `bun test tests/instances/platform-store.test.ts tests/debug/instance-routes.test.ts -t "unreadable|safe decoding"`

Expected: PASS.

- [ ] **Step 10: Commit safe decode work**

```bash
git add src/instances/types.ts src/instances/platform-store.ts src/instances/task-store.ts src/index.ts src/debug/instance-routes.ts tests/instances/platform-store.test.ts tests/debug/instance-routes.test.ts
git commit -m "fix: isolate unreadable instance rows"
```

---

## Task 3: Correct Router Lifecycle And `/apply` Desired Status Reporting

**Files:**

- Modify: `src/chat/router.ts`
- Modify: `src/debug/instance-route-support.ts`
- Modify: `src/debug/instance-routes.ts`
- Modify: `client/shared/api-types.ts`
- Modify: `client/admin/fetcher-schemas.ts`
- Test: `tests/chat/router.test.ts`
- Test: `tests/debug/instance-routes.test.ts`
- Test: `tests/client/admin/instance-fetcher-schemas.test.ts`

- [ ] **Step 1: Add router lifecycle failing tests**

In `tests/chat/router.test.ts`, replace the test named `marks instance inactive before awaiting stop to refuse racing sends` with:

```typescript
test('keeps instance active until stop succeeds and preserves state when stop fails', async () => {
  const stop = mock(() => Promise.reject(new Error('stop failed')))
  factory = (id: string, type: PlatformInstanceType): ChatProvider => {
    const fakeProvider = makeProvider(type, { stop })
    providers[id] = fakeProvider
    return fakeProvider
  }
  router = new ChatRouter(factory)
  router.addInstance('telegram-main', 'telegram', {})
  await router.startInstance('telegram-main')

  await expect(router.stopInstance('telegram-main')).rejects.toThrow('stop failed')

  expect(router.isInstanceActive('telegram-main')).toBe(true)
})
```

Add this test near the other lifecycle tests:

```typescript
test('startInstance is a no-op for already active instances', async () => {
  const start = mock(async () => {})
  factory = (id: string, type: PlatformInstanceType): ChatProvider => {
    const fakeProvider = makeProvider(type, { start })
    providers[id] = fakeProvider
    return fakeProvider
  }
  router = new ChatRouter(factory)
  router.addInstance('telegram-main', 'telegram', {})

  await router.startInstance('telegram-main')
  await router.startInstance('telegram-main')

  expect(start).toHaveBeenCalledTimes(1)
  expect(router.isInstanceActive('telegram-main')).toBe(true)
})
```

- [ ] **Step 2: Run router lifecycle tests to verify failure**

Run: `bun test tests/chat/router.test.ts -t "stop succeeds|no-op for already active"`

Expected: FAIL because stop currently marks stopped before awaiting, and active start is not guarded.

- [ ] **Step 3: Update router lifecycle methods**

In `src/chat/router.ts`, change `startInstance()` to include an active guard:

```typescript
if (instance.status === 'active') {
  log.debug({ platformInstanceId: id }, 'chat instance already active')
  return
}
```

Place it after the unknown-instance guard and before `provider.start()`.

Change `stopInstance()` to:

```typescript
async stopInstance(id: string): Promise<void> {
  const instance = this.instances.get(id)
  if (instance === undefined) {
    log.warn({ platformInstanceId: id }, 'cannot stop unknown chat instance')
    return
  }
  if (instance.status === 'stopped') {
    log.debug({ platformInstanceId: id }, 'chat instance already stopped')
    return
  }

  await instance.provider.stop()
  instance.status = 'stopped'
}
```

- [ ] **Step 4: Add desired-status apply tests**

In `tests/debug/instance-routes.test.ts`, add near existing apply removal tests:

```typescript
test('apply reports pending desired status when removing runtime instance', async () => {
  const start = mock(async () => {})
  const stop = mock(async () => {})
  const router = new ChatRouter(() => fakeProvider(start, stop))
  router.addInstance('telegram-main', 'telegram', { token: 'secret' })
  await router.startInstance('telegram-main')
  const pending: PlatformInstance = {
    id: 'telegram-main',
    type: 'telegram',
    config: { token: 'secret' },
    status: 'pending',
    createdAt: '2026-05-29 00:00:00',
  }

  const res = expectResponse(
    await routeWithDeps(
      '/api/platform-instances/apply',
      { getRuntimeChatRouter: () => router, listPlatformInstances: () => [pending] },
      { method: 'POST', headers: jsonHeaders() },
    ),
  )

  expect(res.status).toBe(200)
  expect(await readJson(res)).toMatchObject({
    removed: ['telegram-main'],
    removedDetails: [{ id: 'telegram-main', desiredStatus: 'pending' }],
    failed: [],
  })
})

test('apply reports remove action when runtime removal fails', async () => {
  const start = mock(async () => {})
  const stop = mock(() => Promise.reject(new Error('stop failed')))
  const router = new ChatRouter(() => fakeProvider(start, stop))
  router.addInstance('telegram-main', 'telegram', { token: 'secret' })
  await router.startInstance('telegram-main')

  const res = expectResponse(
    await routeWithDeps(
      '/api/platform-instances/apply',
      { getRuntimeChatRouter: () => router, listPlatformInstances: () => [] },
      { method: 'POST', headers: jsonHeaders() },
    ),
  )

  expect(res.status).toBe(200)
  expect(await readJson(res)).toMatchObject({
    stopped: [],
    removed: [],
    failed: [{ id: 'telegram-main', action: 'remove', error: 'stop failed' }],
  })
})
```

- [ ] **Step 5: Change apply dependencies to full platform desired state**

In `src/debug/instance-route-support.ts`, update `InstanceApiDeps`:

```typescript
export type InstanceApiDeps = {
  readonly getRuntimeChatRouter: () => ChatRouter | null
  readonly listPlatformInstances: () => PlatformInstance[]
}
```

Update default deps in `src/debug/instance-routes.ts` to pass `listPlatformInstances` instead of `listActivePlatformInstances`.

Update tests that build deps by renaming `listActivePlatformInstances` to `listPlatformInstances`. Where a test wants no desired rows, return `[]`. Where a test wants active rows, return those active rows unchanged.

- [ ] **Step 6: Implement removed details and accurate remove failures**

In `src/debug/instance-route-support.ts`, add:

```typescript
type RemovedDetail = Readonly<{
  id: string
  desiredStatus: 'pending' | 'stopped' | null
}>
```

Extend `ApplyResultPatch` and `ApplyInstancesResult` with:

```typescript
removedDetails?: readonly RemovedDetail[]
```

and:

```typescript
removedDetails: readonly RemovedDetail[]
```

Update `mergeApplyResult()` to include:

```typescript
removedDetails: patches.flatMap((patch) => patch.removedDetails ?? []),
```

Change `removeRuntimeInstance()` signature and failure action:

```typescript
const removeRuntimeInstance = async (
  router: ChatRouter,
  id: string,
  desiredStatus: RemovedDetail['desiredStatus'],
): Promise<ApplyResultPatch> => {
  try {
    await router.removeInstanceStrict(id)
    return { stopped: [id], removed: [id], removedDetails: [{ id, desiredStatus }] }
  } catch (error) {
    return failedPatch(id, 'remove', error)
  }
}
```

Update recreate calls to pass `null` or the active row status context:

```typescript
const removed = await removeRuntimeInstance(router, instance.id, null)
```

In `reconcilePlatformInstances()`, build maps from all rows:

```typescript
const desiredInstances = deps.listPlatformInstances()
const desiredById = new Map(desiredInstances.map((instance) => [instance.id, instance]))
const activeInstances = desiredInstances.filter((instance) => instance.status === 'active')
const activeIds = new Set(activeInstances.map((instance) => instance.id))
const runtimeIdsToRemove = router
  .listInstances()
  .map((instance) => instance.id)
  .filter((id) => !activeIds.has(id))
const removePatches = runtimeIdsToRemove.map((id) => {
  const desired = desiredById.get(id)
  const desiredStatus = desired === undefined ? null : desired.status === 'active' ? null : desired.status
  return limit(removeRuntimeInstance, router, id, desiredStatus)
})
```

- [ ] **Step 7: Update client schemas for removedDetails**

In `client/shared/api-types.ts`, add the `removedDetails` field to `ApplyInstancesResult`:

```typescript
removedDetails: readonly { readonly id: string; readonly desiredStatus: 'pending' | 'stopped' | null }[]
```

In `client/admin/fetcher-schemas.ts`, extend the apply result schema with:

```typescript
removedDetails: z
  .array(z.object({ id: z.string(), desiredStatus: z.enum(['pending', 'stopped']).nullable() }))
  .default([]),
```

- [ ] **Step 8: Run router, route, and client schema tests**

Run: `bun test tests/chat/router.test.ts tests/debug/instance-routes.test.ts tests/client/admin/instance-fetcher-schemas.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit lifecycle and apply fixes**

```bash
git add src/chat/router.ts src/debug/instance-route-support.ts src/debug/instance-routes.ts client/shared/api-types.ts client/admin/fetcher-schemas.ts tests/chat/router.test.ts tests/debug/instance-routes.test.ts tests/client/admin/instance-fetcher-schemas.test.ts
git commit -m "fix: report platform apply desired status"
```

---

## Task 4: Split Task Provider Validation Semantics And Fix Plugin Manifest Defaults

**Files:**

- Modify: `src/providers/config-validation.ts`
- Modify: `src/debug/instance-config-validation.ts`
- Modify: `src/providers/resolver.ts`
- Modify: `src/plugins/types.ts`
- Test: `tests/providers/resolver.test.ts`
- Test: `tests/plugins/manifest-schema.test.ts`
- Test: `tests/plugins/types.test.ts`

- [ ] **Step 1: Add failing validation tests**

In `tests/providers/resolver.test.ts`, add:

```typescript
test('admin-style task config validation does not require context-scoped fields', async () => {
  const failure = await validateTaskInstanceConfigResult('youtrack', { baseUrl: 'https://yt.invalid' })

  expect(failure).toBeNull()
})

test('effective task config validation requires context-scoped fields', async () => {
  const { validateEffectiveTaskProviderConfigResult } = await import('../../src/providers/config-validation.js')

  const failure = await validateEffectiveTaskProviderConfigResult('youtrack', { baseUrl: 'https://yt.invalid' })

  expect(failure).toEqual({
    kind: 'invalid_task_instance_config',
    type: 'youtrack',
    missing: ['token'],
    invalidUrls: [],
  })
})
```

In `tests/plugins/manifest-schema.test.ts`, add:

```typescript
test('parsed plugin manifest exposes defaulted provider arrays', () => {
  const parsed = pluginManifestSchema.parse({
    id: 'defaults-plugin',
    name: 'Defaults Plugin',
    version: '1.0.0',
    apiVersion: 1,
    entry: 'index.ts',
  })

  expect(parsed.providerTraits).toEqual([])
  expect(parsed.providerContextConfigSchema).toEqual([])
})
```

- [ ] **Step 2: Run targeted tests to verify failure**

Run: `bun test tests/providers/resolver.test.ts -t "admin-style|effective task" && bun test tests/plugins/manifest-schema.test.ts -t "defaulted provider arrays"`

Expected: FAIL because `validateEffectiveTaskProviderConfigResult` does not exist and manifest type/default behavior is not guaranteed by the exported type.

- [ ] **Step 3: Add effective config validation helper**

In `src/providers/config-validation.ts`, add this helper near `validateTaskInstanceConfigResult`:

```typescript
const descriptorFieldsForMode = (
  descriptor: TaskProviderTypeDescriptor,
  includeContext: boolean,
): readonly ProviderConfigField[] =>
  includeContext
    ? [...descriptor.instanceConfigSchema, ...descriptor.contextConfigSchema]
    : descriptor.instanceConfigSchema
```

Change the existing descriptor validation lines in `validateTaskInstanceConfigResult()` to use:

```typescript
const descriptorResult = validateDescriptorConfig(descriptorFieldsForMode(descriptor, false), config, mode)
```

and validator normalization to use only instance fields:

```typescript
const validatorConfig = normalizeDescriptorConfig(descriptor.instanceConfigSchema, config, mode)
```

Add:

```typescript
export const validateEffectiveTaskProviderConfigResult = async (
  type: string,
  config: InstanceConfig,
  deps: TaskInstanceConfigValidationDeps = defaultDeps,
  mode: TaskInstanceConfigKeyMode = 'logical',
): Promise<TaskInstanceConfigValidationFailure | null> => {
  const descriptor = deps.getTaskProviderDescriptor(type)
  if (descriptor === undefined) return { kind: 'unknown_task_provider', type }

  const fields = descriptorFieldsForMode(descriptor, true)
  const descriptorResult = validateDescriptorConfig(fields, config, mode)
  if (descriptorResult.missing.length > 0 || descriptorResult.invalidUrls.length > 0) {
    return { kind: 'invalid_task_instance_config', type, ...descriptorResult }
  }

  const validator = deps.getTaskProviderConfigValidator(type)
  if (validator === undefined) return null
  const validatorConfig = normalizeDescriptorConfig(fields, config, mode)
  const result = await Promise.resolve()
    .then(() => validator(validatorConfig))
    .catch((error: unknown) => ({
      ok: false as const,
      reason: errorMessage(error),
      validatorFailed: true as const,
    }))
  if ('validatorFailed' in result) {
    return { kind: 'task_provider_config_validator_failed', type, reason: result.reason }
  }
  if (result.ok) return null
  return { kind: 'task_provider_config_validator_rejected', type, reason: result.reason }
}
```

- [ ] **Step 4: Use effective validation in resolver only**

In `src/providers/resolver.ts`, change the import:

```typescript
import { validateEffectiveTaskProviderConfigResult } from './config-validation.js'
```

In `createValidatedProvider()`, replace:

```typescript
const validationFailure = await validateTaskInstanceConfigResult(instance.type, config, deps, 'logical')
```

with:

```typescript
const validationFailure = await validateEffectiveTaskProviderConfigResult(instance.type, config, deps, 'logical')
```

Leave `src/debug/instance-config-validation.ts` using `validateTaskInstanceConfigResult()` so admin routes validate instance fields only.

- [ ] **Step 5: Remove plugin manifest manual optionality override**

In `src/plugins/types.ts`, replace:

```typescript
type ParsedPluginManifest = z.output<typeof pluginManifestSchema>
export type PluginManifest = Omit<ParsedPluginManifest, 'providerContextConfigSchema' | 'providerTraits'> & {
  providerContextConfigSchema?: ParsedPluginManifest['providerContextConfigSchema']
  providerTraits?: ParsedPluginManifest['providerTraits']
}
```

with:

```typescript
export type PluginManifest = z.output<typeof pluginManifestSchema>
```

Then remove unnecessary `?? []` guards for `manifest.providerContextConfigSchema` and `manifest.providerTraits` in `src/plugins/context.ts`:

```typescript
contextConfigSchema: manifest.providerContextConfigSchema.map((field) => toProviderConfigField(field, 'context')),
traits: new Set(manifest.providerTraits),
```

- [ ] **Step 6: Run validation and plugin tests**

Run: `bun test tests/providers/resolver.test.ts tests/plugins/manifest-schema.test.ts tests/plugins/types.test.ts tests/plugins/context.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit validation split**

```bash
git add src/providers/config-validation.ts src/debug/instance-config-validation.ts src/providers/resolver.ts src/plugins/types.ts src/plugins/context.ts tests/providers/resolver.test.ts tests/plugins/manifest-schema.test.ts tests/plugins/types.test.ts
git commit -m "fix: split task provider config validation"
```

---

## Task 5: Remove Env-Shaped Adapter Construction And Fix Kaneo Context Naming

**Files:**

- Modify: `src/chat/telegram/index.ts`
- Modify: `src/chat/discord/index.ts`
- Modify: `src/chat/mattermost/config.ts`
- Modify: `src/chat/kontur-talk/config.ts`
- Modify: `src/chat/telegram/metadata.ts`
- Modify: `src/chat/discord/metadata.ts`
- Modify: `src/chat/mattermost/metadata.ts`
- Modify: `src/chat/kontur-talk/metadata.ts`
- Modify: `src/users.ts`
- Modify: `src/cache.ts`
- Modify: `src/providers/resolver.ts`
- Modify: `src/providers/kaneo/provision.ts`
- Modify: `src/commands/setup.ts`
- Modify: `src/scheduler.ts`
- Test: `tests/chat/telegram/index.test.ts`
- Test: `tests/chat/discord/index.test.ts`
- Test: `tests/chat/mattermost/index.test.ts`
- Test: `tests/chat/kontur-talk/index.test.ts`
- Test: `tests/providers/resolver.test.ts`

- [ ] **Step 1: Add explicit constructor tests**

In each chat adapter test file, replace env fallback expectations with explicit-config expectations.

For `tests/chat/discord/index.test.ts`, use this shape:

```typescript
test('constructor requires explicit token and platform instance id', () => {
  expect(() => new DiscordChatProvider({ platformInstanceId: TEST_PLATFORM_ID })).toThrow(
    'DISCORD_BOT_TOKEN environment variable is required',
  )
  expect(() => new DiscordChatProvider({ token: 'fake-discord-token', platformInstanceId: '   ' })).toThrow(
    'platformInstanceId is required',
  )
})
```

For `tests/chat/kontur-talk/index.test.ts`, replace `new KonturTalkChatProvider()` cases with:

```typescript
const provider = new KonturTalkChatProvider({ jwtToken: 'jwt', platformInstanceId: 'kontur-main' })
```

and add:

```typescript
test('constructor does not invent a default platform instance id', () => {
  expect(() => new KonturTalkChatProvider({ jwtToken: 'jwt' })).toThrow('platformInstanceId is required')
})
```

- [ ] **Step 2: Run adapter constructor tests to verify failure**

Run: `bun test tests/chat/discord/index.test.ts tests/chat/kontur-talk/index.test.ts -t "constructor"`

Expected: FAIL where constructors still read env or invent default ids.

- [ ] **Step 3: Remove Telegram constructor overload env fallback**

In `src/chat/telegram/index.ts`, replace the constructor with:

```typescript
constructor(config: TelegramConstructorConfig) {
  const token = config.token
  const platformInstanceId = resolvePlatformInstanceId(config.platformInstanceId)
  if (token === undefined || token.trim() === '') {
    throw new Error('TELEGRAM_BOT_TOKEN environment variable is required')
  }
  this.token = token
  this.platformInstanceId = platformInstanceId
  this.bot = new Bot(token)
  log.debug({ platformInstanceId: this.platformInstanceId }, 'TelegramChatProvider constructed')
  this.bot.on('callback_query:data', (ctx) => this.dispatchCallbackQuery(ctx))
}
```

If `TelegramConstructorConfig.token` is optional, make it optional only if tests rely on the existing error message; otherwise make it required and keep runtime blank validation.

- [ ] **Step 4: Remove Discord constructor env fallback and lazy admin env if possible**

In `src/chat/discord/index.ts`, remove tuple-style constructor handling and keep a single object constructor:

```typescript
constructor(config: DiscordConstructorConfig) {
  const token = config.token
  if (token === undefined || token.trim() === '') {
    throw new Error('DISCORD_BOT_TOKEN environment variable is required')
  }
  const platformInstanceId = config.platformInstanceId
  if (platformInstanceId === undefined || platformInstanceId.trim() === '') {
    throw new Error('platformInstanceId is required')
  }
  this.token = token
  this.platformInstanceId = platformInstanceId
  this.clientFactory = typeof config.clientFactory === 'function' ? config.clientFactory : defaultClientFactory
  log.debug({ platformInstanceId: this.platformInstanceId, tokenLength: this.token.length }, 'DiscordChatProvider constructed')
}
```

Keep `process.env['ADMIN_USER_ID']` handling in `start()` only if command auth has no injected admin path today. If retained, document it as outside provider instance config and add a follow-up comment in the plan execution notes.

- [ ] **Step 5: Remove Mattermost and Kontur env fallback config resolution**

In `src/chat/mattermost/config.ts`, remove `fallbackEnv` and resolve only object config:

```typescript
export const resolveMattermostConfig = (config: MattermostConstructorConfig): ResolvedMattermostConfig => {
  const url = config.baseUrl
  const token = config.token
  if (url === undefined || url.trim() === '') {
    throw new Error('MATTERMOST_URL environment variable is required')
  }
  if (token === undefined || token.trim() === '') {
    throw new Error('MATTERMOST_BOT_TOKEN environment variable is required')
  }
  return {
    baseUrl: url.replace(/\/+$/u, ''),
    token,
    platformInstanceId: resolvePlatformInstanceId(config.platformInstanceId),
  }
}
```

In `src/chat/kontur-talk/config.ts`, require `platformInstanceId`:

```typescript
const resolvePlatformInstanceId = (platformInstanceId: string | undefined): string => {
  if (platformInstanceId === undefined || platformInstanceId.trim() === '') {
    throw new Error('platformInstanceId is required')
  }
  return platformInstanceId
}

export const resolveKonturTalkConfig = (config: KonturTalkConstructorConfig): ResolvedKonturTalkConfig => {
  const jwtToken = config.jwtToken
  if (jwtToken === undefined || jwtToken.trim() === '') {
    throw new Error('KONTUR_TALK_JWT_TOKEN environment variable is required')
  }
  return { jwtToken, platformInstanceId: resolvePlatformInstanceId(config.platformInstanceId) }
}
```

- [ ] **Step 6: Align chat metadata keys with DB descriptors**

Update adapter metadata files:

```typescript
// telegram/metadata.ts
export const telegramConfigRequirements = [{ key: 'token', label: 'Telegram Bot Token', required: true }] as const

// discord/metadata.ts
export const discordConfigRequirements = [{ key: 'token', label: 'Discord Bot Token', required: true }] as const

// mattermost/metadata.ts
export const mattermostConfigRequirements = [
  { key: 'baseUrl', label: 'Mattermost URL', required: true },
  { key: 'token', label: 'Mattermost Bot Token', required: true },
] as const

// kontur-talk/metadata.ts
export const konturTalkConfigRequirements = [
  { key: 'jwtToken', label: 'Kontur Talk JWT Token', required: true },
] as const
```

- [ ] **Step 7: Rename Kaneo workspace helpers to context-aware names**

In `src/cache.ts`, rename functions:

```typescript
export function getCachedWorkspaceForContext(contextId: string): string | null {
  const cache = getOrCreateCache(contextId)
  if (cache.workspaceId === null && !cache.config.has('workspace_loaded')) {
    log.debug({ contextId }, 'Loading workspace from DB into cache')
    const row = getDrizzleDb()
      .select({ value: userConfig.value })
      .from(userConfig)
      .where(sql`${userConfig.userId} = ${contextId} AND ${userConfig.key} = ${KANEO_WORKSPACE_CONFIG_KEY}`)
      .get()
    cache.workspaceId = row === undefined ? null : row.value
    cache.config.set('workspace_loaded', 'true')
    emitUser('cache:load', contextId, { field: 'workspace' })
  }
  return cache.workspaceId
}

export function setCachedWorkspaceForContext(contextId: string, workspaceId: string): void {
  const cache = getOrCreateCache(contextId)
  cache.workspaceId = workspaceId
  syncWorkspaceToDb(contextId, workspaceId)
  emitUser('cache:sync', contextId, { field: 'workspace', operation: 'set' })
}
```

In `src/users.ts`, export:

```typescript
export function getKaneoWorkspaceForContext(contextId: string): string | null {
  log.debug('getKaneoWorkspaceForContext called')
  return getCachedWorkspaceForContext(contextId)
}

export function setKaneoWorkspaceForContext(contextId: string, workspaceId: string): void {
  log.debug('setKaneoWorkspaceForContext called')
  setCachedWorkspaceForContext(contextId, workspaceId)
  log.info('Kaneo workspace ID stored for context')
}
```

Update imports and calls in `src/providers/resolver.ts`, `src/providers/kaneo/provision.ts`, `src/commands/setup.ts`, `src/scheduler.ts`, and tests from `getKaneoWorkspace`/`setKaneoWorkspace` to `getKaneoWorkspaceForContext`/`setKaneoWorkspaceForContext`.

- [ ] **Step 8: Run adapter and resolver tests**

Run: `bun test tests/chat/telegram/index.test.ts tests/chat/discord/index.test.ts tests/chat/mattermost/index.test.ts tests/chat/kontur-talk/index.test.ts tests/providers/resolver.test.ts`

Expected: PASS.

- [ ] **Step 9: Search for removed env fallback paths**

Run: `rg "process\.env\[['\"](?:TELEGRAM_BOT_TOKEN|DISCORD_BOT_TOKEN|MATTERMOST_URL|MATTERMOST_BOT_TOKEN|KONTUR_TALK_JWT_TOKEN)['\"]\]|kontur-talk-default|getKaneoWorkspace\(" src tests`

Expected: no matches for adapter credential env reads or `kontur-talk-default`; matches for bootstrap env reads are acceptable and should be visually confirmed as `src/instances/bootstrap.ts` only.

- [ ] **Step 10: Commit adapter and Kaneo abstraction cleanup**

```bash
git add src/chat src/users.ts src/cache.ts src/providers/resolver.ts src/providers/kaneo/provision.ts src/commands/setup.ts src/scheduler.ts tests/chat tests/providers/resolver.test.ts
git commit -m "refactor: require explicit provider instance config"
```

---

## Task 6: Remove Dead Code, Close Drizzle Handles, And Normalize Migration Logs

**Files:**

- Modify: `src/chat/router.ts`
- Modify: `tests/chat/router.test.ts`
- Modify: `src/db/drizzle.ts`
- Test: `tests/db/drizzle.test.ts`
- Modify: `src/instances/bootstrap.ts`
- Test: `tests/instances/bootstrap.test.ts`
- Modify: `src/db/migrations/041_users_platform_instance_index.ts`
- Modify: `src/db/migrations/045_provider_base_url.ts`

- [ ] **Step 1: Remove or rename non-strict router removal test**

In `tests/chat/router.test.ts`, replace the test named `removes instances even when provider stop fails` with:

```typescript
test('removeInstanceStrict preserves instance when provider stop fails', async () => {
  factory = (id: string, type: PlatformInstanceType): ChatProvider => {
    const fakeProvider = makeProvider(type, { stop: () => Promise.reject(new Error(`stop ${id}`)) })
    providers[id] = fakeProvider
    return fakeProvider
  }
  router = new ChatRouter(factory)
  router.addInstance('telegram-main', 'telegram', {})

  await expect(router.removeInstanceStrict('telegram-main')).rejects.toThrow('stop telegram-main')

  expect(router.getInstance('telegram-main')).not.toBeNull()
})
```

- [ ] **Step 2: Remove non-strict router method**

In `src/chat/router.ts`, delete the entire `async removeInstance(id: string): Promise<void>` method. Keep `removeInstanceStrict()` as the only removal method.

Run: `rg "\.removeInstance\(" src tests`

Expected: no matches. If a match remains, update it to `removeInstanceStrict()` only when the caller expects failures to propagate.

- [ ] **Step 3: Add failing Drizzle close test**

Create `tests/db/drizzle.test.ts` with:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import { closeDrizzleDb, setDrizzleDbForTesting } from '../../src/db/drizzle.js'

describe('closeDrizzleDb', () => {
  test('closes the underlying sqlite handle when present', () => {
    const close = mock(() => {})
    const fakeDb = { $client: { close } } as never

    setDrizzleDbForTesting(fakeDb)
    closeDrizzleDb()

    expect(close).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 4: Implement sqlite handle close**

In `src/db/drizzle.ts`, add a raw handle variable:

```typescript
let sqliteInstance: Database | undefined
```

In `getDrizzleDb()`, assign it:

```typescript
sqliteInstance = sqlite
dbInstance = drizzle(sqlite, { schema })
```

Change `closeDrizzleDb()` to:

```typescript
export const closeDrizzleDb = (): void => {
  if (sqliteInstance !== undefined) {
    sqliteInstance.close()
    sqliteInstance = undefined
  } else if (dbInstance !== undefined && '$client' in dbInstance) {
    dbInstance.$client.close()
  }
  dbInstance = undefined
}
```

Update `resetDrizzleDbForTesting()` to clear both variables without closing:

```typescript
export const resetDrizzleDbForTesting = (): void => {
  dbInstance = undefined
  sqliteInstance = undefined
}
```

Update `setDrizzleDbForTesting()`:

```typescript
export const setDrizzleDbForTesting = (db: ReturnType<typeof drizzle<typeof schema>>): void => {
  dbInstance = db
  sqliteInstance = db.$client
}
```

- [ ] **Step 5: Remove unreachable bootstrap branch**

In `src/instances/bootstrap.ts`, add:

```typescript
type CompleteParsedEnv = Readonly<{
  chatType: PlatformInstanceType
  taskType: BuiltinTaskType
  adminUserId: string
}>

const completeParsedEnv = (parsed: ParsedEnv): CompleteParsedEnv => {
  if (parsed.chatType === null || parsed.taskType === null || parsed.adminUserId === undefined) {
    throw new Error('internal bootstrap invariant violated: parsed env is incomplete after missing check')
  }
  return { chatType: parsed.chatType, taskType: parsed.taskType, adminUserId: parsed.adminUserId }
}
```

Replace lines after the `missing.length > 0` return with:

```typescript
const complete = completeParsedEnv(parsed)
const { platformInstanceId, taskInstanceId } = seedInstances(complete.chatType, complete.taskType, complete.adminUserId)
```

Update the log to use `complete.adminUserId`.

- [ ] **Step 6: Add migration logs**

In `src/db/migrations/041_users_platform_instance_index.ts`, import logger:

```typescript
import { logger } from '../../logger.js'
```

Add:

```typescript
const log = logger.child({ scope: 'migration:041' })
```

At the end of `up()` add:

```typescript
log.info('migration 041: users platform instance index complete')
```

In `src/db/migrations/045_provider_base_url.ts`, import logger and add:

```typescript
const log = logger.child({ scope: 'migration:045' })
```

At the end of `up()` add:

```typescript
log.info('migration 045: provider baseUrl backfill complete')
```

- [ ] **Step 7: Run cleanup tests and searches**

Run: `bun test tests/chat/router.test.ts tests/db/drizzle.test.ts tests/instances/bootstrap.test.ts`

Expected: PASS.

Run: `rg "removeInstance\(|configToEnv|scope: ['\"]user['\"]|manual cascade|deleteContextsByTaskInstance|deleteContextsByPlatformInstance|deleteAdminsByPlatformInstance" src tests docs/superpowers/plans docs/superpowers/specs`

Expected: no production code matches for removed items. Existing historical specs may match; do not edit historical approved specs unless they are the active plan being executed.

- [ ] **Step 8: Commit dead-code and observability cleanup**

```bash
git add src/chat/router.ts tests/chat/router.test.ts src/db/drizzle.ts tests/db/drizzle.test.ts src/instances/bootstrap.ts tests/instances/bootstrap.test.ts src/db/migrations/041_users_platform_instance_index.ts src/db/migrations/045_provider_base_url.ts
git commit -m "refactor: remove stale multi-provider cleanup paths"
```

---

## Task 7: Final Verification

**Files:**

- Verify all files changed by Tasks 1-6.

- [ ] **Step 1: Run focused suites**

Run:

```bash
bun test tests/instances tests/debug/instance-routes.test.ts tests/chat/router.test.ts tests/providers/resolver.test.ts tests/plugins/manifest-schema.test.ts tests/plugins/types.test.ts tests/plugins/context.test.ts tests/db/drizzle.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `bun typecheck`

Expected: PASS.

- [ ] **Step 3: Run formatting check**

Run: `bun format:check`

Expected: PASS.

- [ ] **Step 4: Run lint**

Run: `bun lint`

Expected: PASS.

- [ ] **Step 5: Run curated test suite if focused suites pass**

Run: `bun test`

Expected: PASS.

- [ ] **Step 6: Review final diff**

Run: `git status --short && git diff --stat HEAD~6..HEAD`

Expected: only intended source, test, and plan/spec-related files are changed across the remediation commits.

- [ ] **Step 7: Confirm clean working tree**

Run: `git status --short`

Expected: no output. If files are listed, stop and inspect them with `git diff` before deciding whether a focused follow-up commit is needed.
