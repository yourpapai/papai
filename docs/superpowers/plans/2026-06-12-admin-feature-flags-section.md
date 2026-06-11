<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Admin Feature-Flags Settings Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A super-admin-only "Feature flags" section in the settings UI that lists every known context (users + groups, all platform instances) and toggles its `tool_context_flags` reduction flags, per the approved spec `docs/superpowers/specs/2026-06-12-admin-feature-flags-section-design.md`.

**Architecture:** Shared strict JSON parser exported from `src/tools/feature-flags.ts`; a snapshot/update module `src/debug/admin-feature-flags.ts` (mirrors `admin-plugin-config.ts`); a thin route handler `src/debug/settings/admin/feature-flags-routes.ts` gated by `requireSuperAdmin` + CSRF, wired in `settings-api-router.ts`; Zod-validated client fetchers and a new Svelte admin section. Writes go through `setConfigValue`, which already invalidates the per-context tool-descriptor cache.

**Tech Stack:** Bun, strict TypeScript (`.js` import extensions, single quotes, no semicolons), Zod v4, Svelte 5 runes, bun:test.

**Repo rules for every task:** TDD hooks block `src/`/`client/` `.ts` edits without a failing test (write tests first); BUSL header on every new file (`//` style for `.ts`, `<!-- -->` for `.svelte`/`.md`); no lint-disable comments; oxfmt formatter (`bun format`); run targeted tests with `bun test <path>`.

---

### Task 1: Export the strict flag parser

**Files:**

- Modify: `src/tools/feature-flags.ts` (extract private `parse` → exported `parseReductionFlagsJson`)
- Test: `tests/tools/feature-flags.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/tools/feature-flags.test.ts` (match the file's existing import style — static or top-level `await import` of `../../src/tools/feature-flags.js`):

```typescript
describe('parseReductionFlagsJson', () => {
  it('parses only literal true values', () => {
    const flags = parseReductionFlagsJson(
      '{"result_compaction":true,"progressive_disclosure":"true","semantic_tool_retrieval":1}',
    )
    expect(flags).toEqual({ resultCompaction: true, progressiveDisclosure: false, semanticToolRetrieval: false })
  })

  it('returns all OFF for null, empty, and corrupt input', () => {
    const allOff = { resultCompaction: false, progressiveDisclosure: false, semanticToolRetrieval: false }
    expect(parseReductionFlagsJson(null)).toEqual(allOff)
    expect(parseReductionFlagsJson('')).toEqual(allOff)
    expect(parseReductionFlagsJson('{not json')).toEqual(allOff)
    expect(parseReductionFlagsJson('[1,2]')).toEqual(allOff)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/feature-flags.test.ts`
Expected: FAIL — `parseReductionFlagsJson` is not exported.

- [ ] **Step 3: Implement**

In `src/tools/feature-flags.ts`, rename the private `parse` function to an exported one (body unchanged) and update its caller:

```typescript
/** Parse a raw tool_context_flags JSON string. Only literal `true` enables a flag. */
export function parseReductionFlagsJson(raw: string | null): ReductionFlags {
  if (raw === null || raw.trim() === '') return { ...ALL_OFF }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return { ...ALL_OFF }
    return {
      progressiveDisclosure: parsed['progressive_disclosure'] === true,
      resultCompaction: parsed['result_compaction'] === true,
      semanticToolRetrieval: parsed['semantic_tool_retrieval'] === true,
    }
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Corrupt reduction flags; all OFF')
    return { ...ALL_OFF }
  }
}

/** Resolve the three reduction flags for a storage context id. Kill switch wins. */
export function resolveReductionFlags(storageContextId: string): ReductionFlags {
  if (killSwitchEngaged()) return { ...ALL_OFF }
  const configContextId = getConfigContextIdFromStorageContextId(storageContextId)
  return parseReductionFlagsJson(getCachedConfig(configContextId, REDUCTION_FLAGS_CONFIG_KEY))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/tools/feature-flags.test.ts`
Expected: PASS (new + all existing resolveReductionFlags tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/feature-flags.ts tests/tools/feature-flags.test.ts
git commit -m "refactor(flags): export strict reduction-flags JSON parser"
```

---

### Task 2: Snapshot/update module

**Files:**

- Create: `src/debug/admin-feature-flags.ts`
- Test: `tests/debug/admin-feature-flags.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/debug/admin-feature-flags.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { toScopedContextId } from '../../src/chat/scoped-context.js'
import { setConfigValue } from '../../src/config.js'
import {
  AdminFeatureFlagsError,
  applyAdminFeatureFlagsUpdate,
  getAdminFeatureFlagsSnapshot,
} from '../../src/debug/admin-feature-flags.js'
import { upsertKnownGroupContext } from '../../src/group-settings/registry.js'
import { addUser } from '../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../utils/test-helpers.js'

const ALL_OFF = { result_compaction: false, progressive_disclosure: false, semantic_tool_retrieval: false }
const userCtx = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'u-1' })
const groupCtx = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'g-1' })

describe('admin-feature-flags', () => {
  const savedKill = process.env['TOOL_CONTEXT_REDUCTION_DISABLED']

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    delete process.env['TOOL_CONTEXT_REDUCTION_DISABLED']
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: 'alice' })
    upsertKnownGroupContext({
      contextId: groupCtx,
      provider: 'mattermost',
      displayName: 'Dev Team',
      parentName: 'Acme',
    })
  })

  afterEach(() => {
    if (savedKill === undefined) delete process.env['TOOL_CONTEXT_REDUCTION_DISABLED']
    else process.env['TOOL_CONTEXT_REDUCTION_DISABLED'] = savedKill
  })

  it('lists user and group contexts with parsed flags, users first, sorted by label', () => {
    setConfigValue(userCtx, 'tool_context_flags', '{"result_compaction":true}')
    const snapshot = getAdminFeatureFlagsSnapshot()
    expect(snapshot.killSwitchEngaged).toBe(false)
    const userRow = snapshot.contexts.find((r) => r.contextId === userCtx)
    const groupRow = snapshot.contexts.find((r) => r.contextId === groupCtx)
    expect(userRow).toEqual({
      contextId: userCtx,
      kind: 'user',
      label: 'alice',
      platformInstanceLabel: 'pi-1',
      flags: { ...ALL_OFF, result_compaction: true },
    })
    expect(groupRow).toEqual({
      contextId: groupCtx,
      kind: 'group',
      label: 'Dev Team — Acme',
      platformInstanceLabel: 'pi-1',
      flags: ALL_OFF,
    })
    expect(snapshot.contexts.indexOf(userRow!)).toBeLessThan(snapshot.contexts.indexOf(groupRow!))
  })

  it('reports the kill switch', () => {
    process.env['TOOL_CONTEXT_REDUCTION_DISABLED'] = 'true'
    expect(getAdminFeatureFlagsSnapshot().killSwitchEngaged).toBe(true)
  })

  it('applies an update for a known context and returns the updated row', () => {
    const updated = applyAdminFeatureFlagsUpdate(userCtx, { ...ALL_OFF, progressive_disclosure: true })
    expect(updated.flags.progressive_disclosure).toBe(true)
    const snapshot = getAdminFeatureFlagsSnapshot()
    expect(snapshot.contexts.find((r) => r.contextId === userCtx)?.flags.progressive_disclosure).toBe(true)
  })

  it('rejects an unknown context', () => {
    expect(() => applyAdminFeatureFlagsUpdate('pi:bogus:ctx:bogus', ALL_OFF)).toThrow(AdminFeatureFlagsError)
  })
})
```

Adjust `addUser`/`seedTestPlatformInstance`/`upsertKnownGroupContext` argument shapes if the helpers differ (check `tests/utils/test-helpers.ts` and `tests/debug/settings/admin/system-access-routes.test.ts:391` for the exact group upsert shape — `{ contextId, provider, displayName, parentName }`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/debug/admin-feature-flags.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/debug/admin-feature-flags.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { toScopedContextId } from '../chat/scoped-context.js'
import { getConfigValue, setConfigValue } from '../config.js'
import { listKnownGroupContextsForPlatform } from '../group-settings/admin-group-list.js'
import { listPlatformInstancesSafe } from '../instances/platform-store.js'
import { parseReductionFlagsJson, REDUCTION_FLAGS_CONFIG_KEY, type ReductionFlags } from '../tools/feature-flags.js'
import { listUsers } from '../users.js'

/** Wire/storage shape: snake_case keys exactly as parseReductionFlagsJson reads them. */
export interface AdminFlagState {
  result_compaction: boolean
  progressive_disclosure: boolean
  semantic_tool_retrieval: boolean
}

export interface AdminFlagContextRow {
  contextId: string
  kind: 'user' | 'group'
  label: string
  platformInstanceLabel: string
  flags: AdminFlagState
}

export interface AdminFeatureFlagsSnapshot {
  killSwitchEngaged: boolean
  contexts: AdminFlagContextRow[]
}

export class AdminFeatureFlagsError extends Error {}

const toWire = (flags: ReductionFlags): AdminFlagState => ({
  result_compaction: flags.resultCompaction,
  progressive_disclosure: flags.progressiveDisclosure,
  semantic_tool_retrieval: flags.semanticToolRetrieval,
})

const readFlags = (contextId: string): AdminFlagState =>
  toWire(parseReductionFlagsJson(getConfigValue(contextId, REDUCTION_FLAGS_CONFIG_KEY)))

const kindRank = (kind: 'user' | 'group'): number => (kind === 'user' ? 0 : 1)

function listContextRows(): AdminFlagContextRow[] {
  const rows: AdminFlagContextRow[] = []
  for (const instance of listPlatformInstancesSafe().instances) {
    for (const user of listUsers(instance.id)) {
      const contextId = toScopedContextId({ platformInstanceId: instance.id, nativeContextId: user.platform_user_id })
      rows.push({
        contextId,
        kind: 'user',
        label: user.username ?? user.platform_user_id,
        platformInstanceLabel: instance.id,
        flags: readFlags(contextId),
      })
    }
    for (const group of listKnownGroupContextsForPlatform(instance.id)) {
      rows.push({
        contextId: group.contextId,
        kind: 'group',
        label: group.parentName === null ? group.displayName : `${group.displayName} — ${group.parentName}`,
        platformInstanceLabel: instance.id,
        flags: readFlags(group.contextId),
      })
    }
  }
  return rows.toSorted((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.label.localeCompare(b.label))
}

export function getAdminFeatureFlagsSnapshot(): AdminFeatureFlagsSnapshot {
  return {
    killSwitchEngaged: process.env['TOOL_CONTEXT_REDUCTION_DISABLED'] === 'true',
    contexts: listContextRows(),
  }
}

export function applyAdminFeatureFlagsUpdate(contextId: string, flags: AdminFlagState): AdminFlagContextRow {
  const row = listContextRows().find((r) => r.contextId === contextId)
  if (row === undefined) throw new AdminFeatureFlagsError('unknown context')
  setConfigValue(contextId, REDUCTION_FLAGS_CONFIG_KEY, JSON.stringify(flags))
  return { ...row, flags: readFlags(contextId) }
}
```

If `listPlatformInstancesSafe()`'s result property is named differently than `instances` (type `InstanceDecodeResult<T> = { instances: T[]; failures: ... }` in `src/instances/types.ts:35`), follow the actual type.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/debug/admin-feature-flags.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/debug/admin-feature-flags.ts tests/debug/admin-feature-flags.test.ts
git commit -m "feat(admin): feature-flags snapshot and update module"
```

---

### Task 3: Route handler + router wiring

**Files:**

- Create: `src/debug/settings/admin/feature-flags-routes.ts`
- Modify: `src/debug/settings-api-router.ts` (one import + one branch)
- Test: `tests/debug/settings/admin/feature-flags-routes.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/debug/settings/admin/feature-flags-routes.test.ts`, mirroring `plugin-config-routes.test.ts` (session helpers from `../helpers.js`):

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { toScopedContextId } from '../../../../src/chat/scoped-context.js'
import { handleAdminFeatureFlagsRoutes } from '../../../../src/debug/settings/admin/feature-flags-routes.js'
import { addAdmin, SUPER_ADMIN_PLATFORM_ID } from '../../../../src/instances/admin-store.js'
import { addUser } from '../../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from '../helpers.js'

const URL_PATH = 'http://localhost/settings/api/admin/feature-flags'
const PATHNAME = '/settings/api/admin/feature-flags'
const userCtx = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'u-1' })
const FLAGS_ON = { result_compaction: true, progressive_disclosure: true, semantic_tool_retrieval: false }

const call = (req: Request): Promise<Response> => handleAdminFeatureFlagsRoutes(req, new URL(req.url), PATHNAME)

describe('settings admin feature-flags routes', () => {
  let superSession: SettingsSession
  let botAdminSession: SettingsSession
  let plainSession: SettingsSession
  const savedKill = process.env['TOOL_CONTEXT_REDUCTION_DISABLED']

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    delete process.env['TOOL_CONTEXT_REDUCTION_DISABLED']
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'sa-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    addUser({ userId: 'ba-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: 'alice' })
    addAdmin('sa-1', SUPER_ADMIN_PLATFORM_ID)
    addAdmin('ba-1', 'pi-1')
    superSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'sa-1' })
    botAdminSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'ba-1' })
    plainSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
  })

  afterEach(() => {
    if (savedKill === undefined) delete process.env['TOOL_CONTEXT_REDUCTION_DISABLED']
    else process.env['TOOL_CONTEXT_REDUCTION_DISABLED'] = savedKill
  })

  test('GET requires a session', async () => {
    const res = await call(new Request(URL_PATH))
    expect(res.status).toBe(401)
  })

  test('GET rejects plain users and plain bot admins', async () => {
    expect((await call(new Request(URL_PATH, { headers: authHeaders(plainSession) }))).status).toBe(403)
    expect((await call(new Request(URL_PATH, { headers: authHeaders(botAdminSession) }))).status).toBe(403)
  })

  test('GET returns the snapshot for a super admin', async () => {
    const res = await call(new Request(URL_PATH, { headers: authHeaders(superSession) }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { killSwitchEngaged: boolean; contexts: { contextId: string }[] }
    expect(body.killSwitchEngaged).toBe(false)
    expect(body.contexts.some((c) => c.contextId === userCtx)).toBe(true)
  })

  test('PUT requires CSRF', async () => {
    const res = await call(
      new Request(URL_PATH, {
        method: 'PUT',
        headers: authHeaders(superSession),
        body: JSON.stringify({ contextId: userCtx, flags: FLAGS_ON }),
      }),
    )
    expect(res.status).toBe(403)
  })

  test('PUT round-trips flags and returns the updated row', async () => {
    const res = await call(
      new Request(URL_PATH, {
        method: 'PUT',
        headers: authHeaders(superSession, true),
        body: JSON.stringify({ contextId: userCtx, flags: FLAGS_ON }),
      }),
    )
    expect(res.status).toBe(200)
    const row = (await res.json()) as { flags: typeof FLAGS_ON }
    expect(row.flags).toEqual(FLAGS_ON)
    const after = await call(new Request(URL_PATH, { headers: authHeaders(superSession) }))
    const body = (await after.json()) as { contexts: { contextId: string; flags: typeof FLAGS_ON }[] }
    expect(body.contexts.find((c) => c.contextId === userCtx)?.flags).toEqual(FLAGS_ON)
  })

  test('PUT rejects an unknown context with 422', async () => {
    const res = await call(
      new Request(URL_PATH, {
        method: 'PUT',
        headers: authHeaders(superSession, true),
        body: JSON.stringify({ contextId: 'pi:bogus:ctx:bogus', flags: FLAGS_ON }),
      }),
    )
    expect(res.status).toBe(422)
  })

  test('PUT rejects a schema-invalid body with 422', async () => {
    const res = await call(
      new Request(URL_PATH, {
        method: 'PUT',
        headers: authHeaders(superSession, true),
        body: JSON.stringify({ contextId: userCtx, flags: { result_compaction: 'yes' } }),
      }),
    )
    expect(res.status).toBe(422)
  })

  test('GET reflects the kill switch', async () => {
    process.env['TOOL_CONTEXT_REDUCTION_DISABLED'] = 'true'
    const res = await call(new Request(URL_PATH, { headers: authHeaders(superSession) }))
    const body = (await res.json()) as { killSwitchEngaged: boolean }
    expect(body.killSwitchEngaged).toBe(true)
  })

  test('POST is not allowed', async () => {
    const res = await call(new Request(URL_PATH, { method: 'POST', headers: authHeaders(superSession, true) }))
    expect(res.status).toBe(405)
  })
})
```

Mirror exact helper shapes from `tests/debug/settings/admin/plugin-config-routes.test.ts` (e.g. `addUser` argument object, `establishSession` principal shape) if they differ.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/debug/settings/admin/feature-flags-routes.test.ts`
Expected: FAIL — route module does not exist.

- [ ] **Step 3: Implement the route handler**

Create `src/debug/settings/admin/feature-flags-routes.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../../../logger.js'
import {
  AdminFeatureFlagsError,
  applyAdminFeatureFlagsUpdate,
  getAdminFeatureFlagsSnapshot,
} from '../../admin-feature-flags.js'
import { authenticate, parseJsonBody, requireCsrf, settingsJson } from '../respond.js'
import { requireSuperAdmin } from './admin-guard.js'

const log = logger.child({ scope: 'debug-server:settings-admin-feature-flags' })

const FlagsSchema = z
  .object({
    result_compaction: z.boolean(),
    progressive_disclosure: z.boolean(),
    semantic_tool_retrieval: z.boolean(),
  })
  .strict()

const PutBodySchema = z.object({ contextId: z.string().min(1), flags: FlagsSchema }).strict()

export function handleAdminFeatureFlagsRoutes(req: Request, _url: URL, pathname: string): Promise<Response> {
  if (pathname !== '/settings/api/admin/feature-flags') {
    return Promise.resolve(settingsJson(404, { error: 'not found' }))
  }

  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)

  if (req.method === 'GET') {
    const guard = requireSuperAdmin(auth.authed, 'read')
    if (guard !== null) return Promise.resolve(guard)
    return Promise.resolve(settingsJson(200, getAdminFeatureFlagsSnapshot()))
  }

  if (req.method === 'PUT') {
    return handlePut(req, auth.authed)
  }

  return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
}

async function handlePut(req: Request, authed: Parameters<typeof requireSuperAdmin>[0]): Promise<Response> {
  const guard = requireSuperAdmin(authed, 'write')
  if (guard !== null) return guard

  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf

  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = PutBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  try {
    const row = applyAdminFeatureFlagsUpdate(body.data.contextId, body.data.flags)
    log.info({ contextId: body.data.contextId }, 'Settings admin updated reduction flags')
    return settingsJson(200, row)
  } catch (err) {
    if (err instanceof AdminFeatureFlagsError) return settingsJson(422, { error: err.message })
    log.error({ err: err instanceof Error ? err.message : String(err) }, 'Settings admin feature-flags PUT failed')
    return settingsJson(500, { error: 'internal server error' })
  }
}
```

In `src/debug/settings-api-router.ts`, add the import next to the other admin handlers and a branch next to the `plugin-config` one (match its exact call shape):

```typescript
import { handleAdminFeatureFlagsRoutes } from './settings/admin/feature-flags-routes.js'
```

```typescript
if (url.pathname === '/settings/api/admin/feature-flags') {
  return handleAdminFeatureFlagsRoutes(req, url, url.pathname)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/debug/settings/admin/feature-flags-routes.test.ts && bun test tests/debug/settings/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/debug/settings/admin/feature-flags-routes.ts src/debug/settings-api-router.ts tests/debug/settings/admin/feature-flags-routes.test.ts
git commit -m "feat(admin): super-admin feature-flags settings API"
```

---

### Task 4: Client schemas + fetchers

**Files:**

- Modify: `client/settings/fetcher-schemas.ts` (add three schemas + types)
- Modify: `client/settings/admin-fetchers.ts` (two fetchers)
- Test: `tests/client/settings/admin-fetchers.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/client/settings/admin-fetchers.test.ts` (file already has `json`, `csrfHeader`, `setMockFetch`, `setCsrfToken`, delayed-import pattern):

```typescript
const flagsSnapshot = {
  killSwitchEngaged: false,
  contexts: [
    {
      contextId: 'pi:cGktMQ:ctx:dS0x',
      kind: 'user',
      label: 'alice',
      platformInstanceLabel: 'pi-1',
      flags: { result_compaction: true, progressive_disclosure: false, semantic_tool_retrieval: false },
    },
  ],
}

test('fetchAdminFeatureFlags GETs and parses the snapshot', async () => {
  const { fetchAdminFeatureFlags } = await import('../../../client/settings/admin-fetchers.js')
  let seenUrl = ''
  setMockFetch((url) => {
    seenUrl = String(url)
    return Promise.resolve(json(flagsSnapshot))
  })
  const result = await fetchAdminFeatureFlags()
  expect(seenUrl).toBe('/settings/api/admin/feature-flags')
  expect(result.contexts[0]!.label).toBe('alice')
})

test('saveAdminFeatureFlags PUTs with CSRF header', async () => {
  const { saveAdminFeatureFlags } = await import('../../../client/settings/admin-fetchers.js')
  setCsrfToken('csrf-ff')
  let seenCsrf = ''
  let seenMethod = ''
  setMockFetch((_url, init) => {
    seenCsrf = csrfHeader(init)
    seenMethod = init.method ?? ''
    return Promise.resolve(json(flagsSnapshot.contexts[0]))
  })
  await saveAdminFeatureFlags({
    contextId: 'pi:cGktMQ:ctx:dS0x',
    flags: { result_compaction: true, progressive_disclosure: false, semantic_tool_retrieval: false },
  })
  expect(seenCsrf).toBe('csrf-ff')
  expect(seenMethod).toBe('PUT')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test:client` (client tests need the happy-dom preload; bare `bun test` excludes `tests/client/` via bunfig — always use the script).
Expected: FAIL — fetchers not exported (only the two new tests fail).

- [ ] **Step 3: Implement**

In `client/settings/fetcher-schemas.ts`, add (next to the other Admin schemas):

```typescript
export const AdminFeatureFlagStateSchema = z.object({
  result_compaction: z.boolean(),
  progressive_disclosure: z.boolean(),
  semantic_tool_retrieval: z.boolean(),
})

export const AdminFeatureFlagRowSchema = z.object({
  contextId: z.string(),
  kind: z.enum(['user', 'group']),
  label: z.string(),
  platformInstanceLabel: z.string(),
  flags: AdminFeatureFlagStateSchema,
})

export const AdminFeatureFlagsSnapshotSchema = z.object({
  killSwitchEngaged: z.boolean(),
  contexts: z.array(AdminFeatureFlagRowSchema),
})

export type AdminFeatureFlagState = z.infer<typeof AdminFeatureFlagStateSchema>
export type AdminFeatureFlagRow = z.infer<typeof AdminFeatureFlagRowSchema>
export type AdminFeatureFlagsSnapshot = z.infer<typeof AdminFeatureFlagsSnapshotSchema>
```

In `client/settings/admin-fetchers.ts`, add imports for those three names and:

```typescript
// --- Admin: feature flags ---

export const fetchAdminFeatureFlags = (): Promise<AdminFeatureFlagsSnapshot> =>
  getJson('/settings/api/admin/feature-flags', (b) => AdminFeatureFlagsSnapshotSchema.parse(b))

export const saveAdminFeatureFlags = (input: {
  contextId: string
  flags: AdminFeatureFlagState
}): Promise<AdminFeatureFlagRow> =>
  writeJson('/settings/api/admin/feature-flags', 'PUT', input, (b) => AdminFeatureFlagRowSchema.parse(b))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test:client`
Expected: PASS (whole client suite).

- [ ] **Step 5: Commit**

```bash
git add client/settings/fetcher-schemas.ts client/settings/admin-fetchers.ts tests/client/settings/admin-fetchers.test.ts
git commit -m "feat(settings-ui): feature-flags admin fetchers"
```

---

### Task 5: Svelte section + app wiring

**Files:**

- Create: `client/settings/sections/admin/AdminFeatureFlagsSection.svelte`
- Modify: `client/settings/SettingsApp.svelte` (sidebar item + render block)

`.svelte` files are outside the TDD hook's test-first scope; the enforced test layer for this UI is the fetcher tests (Task 4), matching existing admin sections (no peer section component has its own test — verify with `ls tests/client/settings/` and mirror if one exists).

- [ ] **Step 1: Create the section component**

`client/settings/sections/admin/AdminFeatureFlagsSection.svelte` (mirror `AdminPluginsConfigSection.svelte` conventions; reuse `Btn`, `EmptyState`, `IconButton`, `PageHeader` shared components):

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { fetchAdminFeatureFlags, saveAdminFeatureFlags } from '../../admin-fetchers.js'
  import type { AdminFeatureFlagRow, AdminFeatureFlagState } from '../../fetcher-schemas.js'
  import Btn from '../../../shared/ui/Btn.svelte'
  import EmptyState from '../../../shared/ui/EmptyState.svelte'
  import IconButton from '../../../shared/ui/IconButton.svelte'
  import PageHeader from '../../../shared/ui/PageHeader.svelte'

  type FlagKey = keyof AdminFeatureFlagState
  const FLAG_KEYS: FlagKey[] = ['result_compaction', 'progressive_disclosure', 'semantic_tool_retrieval']
  const FLAG_LABELS: Record<FlagKey, string> = {
    result_compaction: 'Compaction',
    progressive_disclosure: 'Disclosure',
    semantic_tool_retrieval: 'Semantic retrieval',
  }

  let killSwitchEngaged = $state(false)
  let rows: AdminFeatureFlagRow[] = $state([])
  let drafts: Record<string, AdminFeatureFlagState> = $state({})
  let error: string | null = $state(null)
  let status: string | null = $state(null)
  let loading = $state(false)
  let savingId: string | null = $state(null)

  function isDirty(row: AdminFeatureFlagRow): boolean {
    const draft = drafts[row.contextId]
    if (draft === undefined) return false
    return FLAG_KEYS.some((key) => draft[key] !== row.flags[key])
  }

  async function load(): Promise<void> {
    error = null
    status = null
    loading = true
    try {
      const snapshot = await fetchAdminFeatureFlags()
      killSwitchEngaged = snapshot.killSwitchEngaged
      rows = snapshot.contexts
      drafts = Object.fromEntries(snapshot.contexts.map((row) => [row.contextId, { ...row.flags }]))
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  async function save(row: AdminFeatureFlagRow): Promise<void> {
    const draft = drafts[row.contextId]
    if (draft === undefined) return
    error = null
    status = null
    savingId = row.contextId
    try {
      const updated = await saveAdminFeatureFlags({ contextId: row.contextId, flags: draft })
      rows = rows.map((r) => (r.contextId === updated.contextId ? updated : r))
      drafts[updated.contextId] = { ...updated.flags }
      status = `${updated.label} updated.`
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      savingId = null
    }
  }

  $effect(() => {
    void load()
  })
</script>

<section id="feature-flags" class="settings-section">
  <PageHeader eyebrow="Admin · Experimental" title="Feature flags">
    {#snippet action()}
      <IconButton label="Refresh" glyph="⟳" busy={loading} onClick={() => void load()} testid="feature-flags-refresh" />
    {/snippet}
  </PageHeader>

  {#if killSwitchEngaged}
    <p class="status-error">
      All reduction flags are forced OFF by TOOL_CONTEXT_REDUCTION_DISABLED; toggles below are stored but inert until
      the variable is unset.
    </p>
  {/if}
  {#if error !== null}<p class="status-error">{error}</p>{/if}
  {#if status !== null}<p class="status-success">{status}</p>{/if}

  {#if rows.length === 0 && !loading}
    <EmptyState text="No known contexts yet." />
  {:else}
    <div class="settings-field-list">
      {#each rows as row (row.contextId)}
        <div class="settings-field" data-testid={`feature-flags-row-${row.contextId}`}>
          <div class="settings-field__head">
            <span class="t-label settings-field__label">{row.label}</span>
            <span class="t-meta">{row.kind} · {row.platformInstanceLabel}</span>
          </div>
          <div class="settings-field__controls">
            {#each FLAG_KEYS as key (key)}
              <label class="t-meta">
                <input
                  type="checkbox"
                  bind:checked={drafts[row.contextId]![key]}
                  data-testid={`feature-flags-${row.contextId}-${key}`} />
                {FLAG_LABELS[key]}
              </label>
            {/each}
            <Btn
              label="Save"
              busy={savingId === row.contextId}
              disabled={!isDirty(row)}
              onClick={() => void save(row)}
              testid={`feature-flags-save-${row.contextId}`} />
          </div>
        </div>
      {/each}
    </div>
  {/if}
</section>
```

Adapt shared-component props to their actual signatures (read `Btn.svelte`/`IconButton.svelte` props first — e.g. `Btn` may use slots or different prop names); keep markup/classes consistent with `AdminPluginsConfigSection.svelte`.

- [ ] **Step 2: Wire into SettingsApp.svelte**

In `client/settings/SettingsApp.svelte`:

- Import: `import AdminFeatureFlagsSection from './sections/admin/AdminFeatureFlagsSection.svelte'`
- In the sidebar `groups` derivation, inside the `if (settingsSession.isSuperAdmin)` items block, append `{ id: 'feature-flags', label: 'Feature flags' }`.
- In the template, inside the existing `{#if settingsSession.isSuperAdmin}` block (next to `AdminAdminsSection`), add `<AdminFeatureFlagsSection />`.

- [ ] **Step 3: Build + test**

Run: `bun build:client && bun test:client`
Expected: bundle succeeds; client suite passes.
Also run `bun check` (staged-file lint/typecheck/format) after `git add`.

- [ ] **Step 4: Commit**

```bash
git add client/settings/sections/admin/AdminFeatureFlagsSection.svelte client/settings/SettingsApp.svelte
git commit -m "feat(settings-ui): super-admin feature-flags section"
```

---

### Task 6: Docs + full verification

**Files:**

- Modify: `CLAUDE.md` (two experimental-flag paragraphs)

- [ ] **Step 1: Update CLAUDE.md**

- In the **Result compaction** paragraph, after "(read via `resolveReductionFlags` in `src/tools/feature-flags.ts`; …)", extend the parenthetical: "…; flags are managed per context in the settings UI super-admin **Feature flags** section (`/settings/api/admin/feature-flags`)".
- In the **Progressive disclosure** paragraph no change is required (same key, already cross-referenced) — verify the result-compaction sentence covers both since they share the `tool_context_flags` key; if the paragraphs read ambiguously, add "managed in the same super-admin Feature flags section" to the disclosure paragraph.

- [ ] **Step 2: Full verification**

Run: `bun run test` → all pass. `bun check:full` → all pass. `bun test:mutate:changed` → report; kill behavioral survivors in files added by this feature (log-string/`describe()`-text survivors acceptable).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: feature flags managed in settings UI admin section"
```

---

## Out of Scope (from the spec)

Bulk apply-to-all; global defaults / `resolveReductionFlags` changes; audit history; non-super-admin exposure; list pagination/search.
