<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 4b — Context/Group-Scoped Settings-Descriptor Serving + `visibleWhen` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve module-contributed settings sections at `'context'`/`'group'` scope through a new per-context route, sourcing field values from the per-context config store, and evaluate section-level `visibleWhen` rules server-side so the client only receives resolved sections.

**Architecture:** Phase 4a shipped the descriptor _contract_ (`SettingsSection` with `scope`/`visibleWhen`/`actions`/field `control`) and an admin-only serving path that ignores `scope`/`visibleWhen`. Phase 4b makes `scope` load-bearing: one shared snapshot builder (`src/debug/admin-module-sections.ts`) branches value I/O on `section.scope` — `'admin'` → `getPluginAdminConfig` (`system_config`, `plg:<id>:<key>`), `'context'`/`'group'` → `getPluginConfig` (`user_config`, `plugin:<id>:<key>`). A new pure evaluator (`src/debug/settings-section-visibility.ts`) resolves `visibleWhen` via the `context → bound task instance → provider capabilities` chain (the idiom already inlined in `kaneo-credentials-routes.ts`). A new route `/settings/api/sections?contextId=` authenticates via `resolveContextScope` (mirroring `config-routes.ts`), leaving `/settings/api/admin/module-sections` untouched. 4b builds and tests against _fabricated_ sections only — the real task-tracker/coding sections migrate in 4d/4e.

**Tech Stack:** Bun + `bun:test`; strict TypeScript (`.js` import extensions); Zod v4; oxlint (pedantic, `typeAware`; note `oxc/no-optional-chaining` is an **error** in `src/**` — never use `?.` in `src/`; `typescript/no-unsafe-type-assertion` is on everywhere — never use `as`); Svelte SPA client fetchers.

**Decisions locked (from recon + user):**

- **(a) Endpoint shape:** new separate route `/settings/api/sections`; admin route unchanged.
- **(b) `visibleWhen` surface:** keep the single `{ kind: 'providerCapability'; capability }` rule (YAGNI); evaluator stays trivially extensible.
- **(c) Storage key:** reuse `plugin:<section.id>:<field.key>` via `getPluginConfig`/`setPluginConfig`/`unsetPluginConfig`.
- **(d) Admin unified:** one shared scope-aware snapshot builder; admin route calls it with no `contextId` → identical behavior.

---

## File Structure

**Create:**

- `src/debug/settings-section-visibility.ts` — pure, server-side `visibleWhen` evaluator (`evaluateSectionVisibility`). Imports the provider-capability chain; lives outside `src/ports/**` so it may name providers freely.
- `src/debug/settings/context-module-sections-routes.ts` — `handleContextModuleSectionsRoutes(req, url)`: GET/PATCH for `/settings/api/sections`, `resolveContextScope`-gated.
- `tests/debug/settings-section-visibility.test.ts`
- `tests/debug/settings/context-module-sections-routes.test.ts`
- `tests/client/settings/context-module-sections-fetchers.test.ts`

**Modify:**

- `src/debug/admin-module-sections.ts` — thread optional `contextId` through `getModuleSectionsSnapshot`/`applyModuleSectionUpdate`/`applyModuleSectionUnset`; branch value I/O on `section.scope`; filter by `visibleWhen`; export scope predicates `isAdminScopeSection` / `isSectionServableInScopeKind`.
- `src/debug/settings/admin/module-sections-routes.ts` — filter to admin-scope descriptors so the admin route never serves a context/group section.
- `src/debug/settings-api-router.ts` — register `/settings/api/sections`.
- `client/settings/fetchers.ts` — add `fetchContextSections` / `patchContextSection` / `unsetContextSection`.
- `tests/debug/admin-module-sections.test.ts` — add context/group + `visibleWhen` unit coverage.

---

## Task 1: `visibleWhen` evaluator

**Files:**

- Create: `src/debug/settings-section-visibility.ts`
- Test: `tests/debug/settings-section-visibility.test.ts`

The evaluator resolves a section's `visibleWhen` rule against a context by walking `getContextSettings(contextId) → getTaskInstance(taskInstanceId) → getCapabilitiesForTaskInstance(instance)`, returning `false` at every null/inactive/error step (the exact pattern `kaneo-credentials-routes.ts:getInstancePublicUrl` already uses). Capability comparison avoids a type assertion by iterating the set and comparing strings.

- [ ] **Step 1: Write the failing test**

Create `tests/debug/settings-section-visibility.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { evaluateSectionVisibility } from '../../src/debug/settings-section-visibility.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../../src/providers/registry.js'
import type { TaskCapability } from '../../src/providers/types.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../utils/test-helpers.js'

const PLUGIN_ID = 'task-provider-kaneo'
const CAP: TaskCapability = 'members.provision'

const registerProvider = (capabilities: ReadonlySet<TaskCapability>): void => {
  registerContributedTaskProviderType('kaneo', {
    pluginId: PLUGIN_ID,
    factory: () => {
      throw new Error('factory not needed in visibility tests')
    },
    capabilities,
    displayName: 'Kaneo',
    instanceConfigSchema: [],
    contextConfigSchema: [],
  })
}

describe('evaluateSectionVisibility (providerCapability)', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
  })

  afterEach(() => {
    unregisterContributedTaskProviderType(PLUGIN_ID)
  })

  test('true when the bound provider has the capability', () => {
    registerProvider(new Set<TaskCapability>([CAP]))
    insertTaskInstance({ id: 'k-1', type: 'kaneo', config: {}, status: 'active' })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'k-1', platformInstanceId: 'pi-1' })
    expect(evaluateSectionVisibility({ kind: 'providerCapability', capability: CAP }, 'ctx-1')).toBe(true)
  })

  test('false when the bound provider lacks the capability', () => {
    registerProvider(new Set<TaskCapability>())
    insertTaskInstance({ id: 'k-2', type: 'kaneo', config: {}, status: 'active' })
    setContextSettings({ contextId: 'ctx-2', taskInstanceId: 'k-2', platformInstanceId: 'pi-1' })
    expect(evaluateSectionVisibility({ kind: 'providerCapability', capability: CAP }, 'ctx-2')).toBe(false)
  })

  test('false when the context has no settings', () => {
    registerProvider(new Set<TaskCapability>([CAP]))
    expect(evaluateSectionVisibility({ kind: 'providerCapability', capability: CAP }, 'ctx-missing')).toBe(false)
  })

  test('false when the bound task instance is not active', () => {
    registerProvider(new Set<TaskCapability>([CAP]))
    insertTaskInstance({ id: 'k-3', type: 'kaneo', config: {}, status: 'stopped' })
    setContextSettings({ contextId: 'ctx-3', taskInstanceId: 'k-3', platformInstanceId: 'pi-1' })
    expect(evaluateSectionVisibility({ kind: 'providerCapability', capability: CAP }, 'ctx-3')).toBe(false)
  })

  test('false (error-safe) when the provider type is unregistered', () => {
    insertTaskInstance({ id: 'k-4', type: 'kaneo', config: {}, status: 'active' })
    setContextSettings({ contextId: 'ctx-4', taskInstanceId: 'k-4', platformInstanceId: 'pi-1' })
    expect(evaluateSectionVisibility({ kind: 'providerCapability', capability: CAP }, 'ctx-4')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/settings-section-visibility.test.ts`
Expected: FAIL — `Cannot find module '../../src/debug/settings-section-visibility.js'`.

- [ ] **Step 3: Write the evaluator**

Create `src/debug/settings-section-visibility.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getContextSettings } from '../instances/context-store.js'
import { getTaskInstance } from '../instances/task-store.js'
import type { SettingsVisibilityRule } from '../ports/settings-sections.js'
import { getCapabilitiesForTaskInstance } from '../providers/registry.js'

/**
 * Whether the task provider bound to `contextId` exposes `capability`. Null/inactive/unknown-provider
 * all resolve to `false` — matching the error-safe chain in kaneo-credentials-routes.ts. Compares by
 * string iteration to avoid a `TaskCapability` assertion on the raw descriptor value.
 */
function contextHasTaskCapability(contextId: string, capability: string): boolean {
  const settings = getContextSettings(contextId)
  if (settings === null) return false
  const instance = getTaskInstance(settings.taskInstanceId)
  if (instance === null || instance.status !== 'active') return false
  try {
    const capabilities = getCapabilitiesForTaskInstance(instance)
    return [...capabilities].some((candidate) => candidate === capability)
  } catch {
    return false
  }
}

/**
 * Evaluate a section-level visibility rule for a context. Pure and server-side; the client only ever
 * receives already-resolved sections. Single-rule surface today (Phase 4b decision b) — a second
 * `kind` becomes a discriminated-union switch, a pure additive change.
 */
export function evaluateSectionVisibility(rule: SettingsVisibilityRule, contextId: string): boolean {
  return contextHasTaskCapability(contextId, rule.capability)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/debug/settings-section-visibility.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Lint + typecheck the new file**

Run: `bunx oxlint src/debug/settings-section-visibility.ts && bun typecheck`
Expected: no errors. (If `oxc/no-optional-chaining` fires, you introduced a `?.` — rewrite with an explicit null guard.)

- [ ] **Step 6: Commit**

```bash
git add src/debug/settings-section-visibility.ts tests/debug/settings-section-visibility.test.ts
git commit -m "feat(settings): add server-side visibleWhen evaluator for settings sections"
```

---

## Task 2: Scope-aware snapshot builder

**Files:**

- Modify: `src/debug/admin-module-sections.ts`
- Test: `tests/debug/admin-module-sections.test.ts`

Thread an optional `contextId` through the three exported functions. Value I/O branches on `section.scope`: `'admin'`/absent → the existing `getPluginAdminConfig`/`setPluginAdminConfig`/`deletePluginAdminConfig`; `'context'`/`'group'` → `getPluginConfig`/`setPluginConfig`/`unsetPluginConfig` (throwing `bad-section` if no `contextId` was supplied). `getModuleSectionsSnapshot` additionally drops any section whose `visibleWhen` evaluates `false` (only when a `contextId` is present — admin calls skip visibility). Export two scope predicates for the routes.

- [ ] **Step 1: Write the failing tests (append to existing suite)**

Append these tests inside the top-level `describe('admin module sections', …)` block in `tests/debug/admin-module-sections.test.ts` (after the last existing test, before the closing `})`). Also add the imports listed below to the top of the file.

Add to the imports at the top of the file:

```typescript
import { getPluginConfig, setPluginConfig } from '../../src/config.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../../src/providers/registry.js'
import type { TaskCapability } from '../../src/providers/types.js'
import { seedTestPlatformInstance } from '../utils/test-helpers.js'
```

Append the tests:

```typescript
test('context-scoped section reads and writes the per-context store, not the admin store', () => {
  moduleSettingsRegistry.clear()
  moduleSettingsRegistry.register([
    { id: 'fab-ctx', label: 'Fabricated ctx', scope: 'context', fields: [{ key: 'note', label: 'Note' }] },
  ])
  const descriptors = buildModuleSectionDescriptors()

  applyModuleSectionUpdate({ id: 'fab-ctx', key: 'note', value: 'hello' }, 'u-1', descriptors, 'ctx-A')

  expect(getPluginConfig('ctx-A', 'fab-ctx', 'note')).toBe('hello')
  expect(getPluginConfig('ctx-B', 'fab-ctx', 'note')).toBeNull()
  expect(getPluginAdminConfig('fab-ctx', 'note')).toBeUndefined()

  const snapA = getModuleSectionsSnapshot(descriptors, 'ctx-A')
  expect(snapA.sections[0]!.fields[0]!.value).toBe('hello')
  const snapB = getModuleSectionsSnapshot(descriptors, 'ctx-B')
  expect(snapB.sections[0]!.fields[0]!.value).toBeNull()
})

test('context-scoped sensitive field is masked in the per-context snapshot', () => {
  moduleSettingsRegistry.clear()
  moduleSettingsRegistry.register([
    {
      id: 'fab-sec',
      label: 'Fabricated secret',
      scope: 'context',
      fields: [{ key: 'token', label: 'Token', sensitive: true }],
    },
  ])
  const descriptors = buildModuleSectionDescriptors()
  setPluginConfig('ctx-S', 'fab-sec', 'token', 'supersecret9876')

  const snap = getModuleSectionsSnapshot(descriptors, 'ctx-S')
  expect(snap.sections[0]!.fields[0]!.value).toBe('****9876')
})

test('context-scoped unset clears the per-context store', () => {
  moduleSettingsRegistry.clear()
  moduleSettingsRegistry.register([
    { id: 'fab-ctx', label: 'Fabricated ctx', scope: 'context', fields: [{ key: 'note', label: 'Note' }] },
  ])
  const descriptors = buildModuleSectionDescriptors()
  setPluginConfig('ctx-U', 'fab-ctx', 'note', 'temp')

  applyModuleSectionUnset({ id: 'fab-ctx', key: 'note' }, 'u-1', descriptors, 'ctx-U')

  expect(getPluginConfig('ctx-U', 'fab-ctx', 'note')).toBeNull()
})

test('admin-scope section ignores a supplied contextId (scope wins)', () => {
  // The default beforeEach registers the admin-scoped 'acp' section.
  const descriptors = buildModuleSectionDescriptors()
  applyModuleSectionUpdate({ id: 'acp', key: 'magi_base_url', value: 'https://m' }, 'u-1', descriptors, 'ctx-X')
  expect(getPluginAdminConfig('acp', 'magi_base_url')).toBe('https://m')
  expect(getPluginConfig('ctx-X', 'acp', 'magi_base_url')).toBeNull()
})

test('context-scoped write without a contextId is rejected', () => {
  moduleSettingsRegistry.clear()
  moduleSettingsRegistry.register([
    { id: 'fab-ctx', label: 'Fabricated ctx', scope: 'context', fields: [{ key: 'note', label: 'Note' }] },
  ])
  const descriptors = buildModuleSectionDescriptors()
  expect(() => applyModuleSectionUpdate({ id: 'fab-ctx', key: 'note', value: 'x' }, 'u-1', descriptors)).toThrow(
    ModuleSectionConfigError,
  )
})

test('visibleWhen filters out a section when the capability is absent, keeps it when present', () => {
  seedTestPlatformInstance({ id: 'pi-1' })
  const cap: TaskCapability = 'members.provision'
  registerContributedTaskProviderType('kaneo', {
    pluginId: 'task-provider-kaneo',
    factory: () => {
      throw new Error('factory not needed')
    },
    capabilities: new Set<TaskCapability>([cap]),
    displayName: 'Kaneo',
    instanceConfigSchema: [],
    contextConfigSchema: [],
  })
  insertTaskInstance({ id: 'k-vis', type: 'kaneo', config: {}, status: 'active' })

  moduleSettingsRegistry.clear()
  moduleSettingsRegistry.register([
    {
      id: 'fab-gated',
      label: 'Gated',
      scope: 'context',
      visibleWhen: { kind: 'providerCapability', capability: cap },
      fields: [{ key: 'note', label: 'Note' }],
    },
  ])
  const descriptors = buildModuleSectionDescriptors()

  setContextSettings({ contextId: 'ctx-has', taskInstanceId: 'k-vis', platformInstanceId: 'pi-1' })
  expect(getModuleSectionsSnapshot(descriptors, 'ctx-has').sections).toHaveLength(1)

  // A context with no bound instance lacks the capability → section is filtered out.
  expect(getModuleSectionsSnapshot(descriptors, 'ctx-none').sections).toHaveLength(0)

  unregisterContributedTaskProviderType('task-provider-kaneo')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/debug/admin-module-sections.test.ts`
Expected: FAIL — `applyModuleSectionUpdate`/`getModuleSectionsSnapshot` reject a 4th arg / write to the admin store regardless of scope; several new assertions fail.

- [ ] **Step 3: Rewrite `src/debug/admin-module-sections.ts`**

Replace the file body from the imports through the end with the following (keep the SPDX header lines 1-4 unchanged). This adds `getPluginConfig`/`setPluginConfig`/`unsetPluginConfig` + evaluator imports, scope predicates, per-scope read/write helpers, and threads `contextId`:

```typescript
import { z } from 'zod'

import { getPluginConfig, setPluginConfig, unsetPluginConfig } from '../config.js'
import { logger } from '../logger.js'
import { deletePluginAdminConfig, getPluginAdminConfig, setPluginAdminConfig } from '../plugins/store.js'
import {
  moduleSettingsRegistry,
  type SettingsAction,
  type SettingsFieldControl,
  type SettingsFieldOption,
  type SettingsSection,
  type SettingsSectionScope,
} from '../ports/settings-sections.js'
import { evaluateSectionVisibility } from './settings-section-visibility.js'

const log = logger.child({ scope: 'debug:admin-module-sections' })

export type ModuleSectionFieldState = {
  key: string
  label: string
  value: string | null
  sensitive: boolean
  required: boolean
  control?: SettingsFieldControl
  options?: readonly SettingsFieldOption[]
  actionId?: string
}

export type ModuleSectionState = {
  id: string
  label: string
  fields: ModuleSectionFieldState[]
  scope?: SettingsSectionScope
  actions?: readonly SettingsAction[]
}

export type ModuleSectionsSnapshot = {
  sections: ModuleSectionState[]
}

export type ModuleSectionConfigErrorKind = 'bad-section' | 'bad-key' | 'bad-value'

export class ModuleSectionConfigError extends Error {
  readonly kind: ModuleSectionConfigErrorKind
  constructor(kind: ModuleSectionConfigErrorKind, message: string) {
    super(message)
    this.name = 'ModuleSectionConfigError'
    this.kind = kind
  }
}

/** Snapshot of declared sections, sourced from the module settings registry. */
export function buildModuleSectionDescriptors(): readonly SettingsSection[] {
  return moduleSettingsRegistry.list()
}

function scopeOf(section: SettingsSection): SettingsSectionScope {
  return section.scope ?? 'admin'
}

/** True for admin-scoped sections (the only kind the admin route serves). */
export function isAdminScopeSection(section: SettingsSection): boolean {
  return scopeOf(section) === 'admin'
}

/** True when a section is servable for a resolved context scope kind (context-route filter). */
export function isSectionServableInScopeKind(section: SettingsSection, kind: 'personal' | 'group'): boolean {
  const scope = scopeOf(section)
  if (scope === 'context') return true
  if (scope === 'group') return kind === 'group'
  return false
}

function maskSensitive(value: string): string {
  return value.length <= 4 ? '****' : `****${value.slice(-4)}`
}

/** Read a field's raw stored value from the store its section's scope dictates; null when unset. */
function readFieldRaw(section: SettingsSection, fieldKey: string, contextId: string | undefined): string | null {
  if (scopeOf(section) === 'admin') {
    const raw = getPluginAdminConfig(section.id, fieldKey)
    return raw === undefined ? null : raw
  }
  if (contextId === undefined) return null
  return getPluginConfig(contextId, section.id, fieldKey)
}

function writeFieldValue(
  section: SettingsSection,
  fieldKey: string,
  value: string,
  updatedBy: string,
  contextId: string | undefined,
): void {
  if (scopeOf(section) === 'admin') {
    setPluginAdminConfig(section.id, fieldKey, value, updatedBy)
    return
  }
  if (contextId === undefined) {
    throw new ModuleSectionConfigError('bad-section', `section ${section.id} requires a context`)
  }
  setPluginConfig(contextId, section.id, fieldKey, value)
}

function clearFieldValue(section: SettingsSection, fieldKey: string, contextId: string | undefined): void {
  if (scopeOf(section) === 'admin') {
    deletePluginAdminConfig(section.id, fieldKey)
    return
  }
  if (contextId === undefined) {
    throw new ModuleSectionConfigError('bad-section', `section ${section.id} requires a context`)
  }
  unsetPluginConfig(contextId, section.id, fieldKey)
}

/** Whether a section passes its visibility rule. Admin calls (no contextId) never filter. */
function isSectionVisible(section: SettingsSection, contextId: string | undefined): boolean {
  if (section.visibleWhen === undefined) return true
  if (contextId === undefined) return true
  return evaluateSectionVisibility(section.visibleWhen, contextId)
}

export function getModuleSectionsSnapshot(
  descriptors: readonly SettingsSection[],
  contextId?: string,
): ModuleSectionsSnapshot {
  const visible = descriptors.filter((section) => isSectionVisible(section, contextId))
  const sections: ModuleSectionState[] = visible.map((section) => ({
    id: section.id,
    label: section.label,
    ...(section.scope === undefined ? {} : { scope: section.scope }),
    ...(section.actions === undefined ? {} : { actions: section.actions }),
    fields: section.fields.map((field) => {
      const raw = readFieldRaw(section, field.key, contextId)
      const sensitive = field.sensitive ?? false
      return {
        key: field.key,
        label: field.label,
        value: raw === null ? null : sensitive ? maskSensitive(raw) : raw,
        sensitive,
        required: field.required ?? false,
        ...(field.control === undefined ? {} : { control: field.control }),
        ...(field.options === undefined ? {} : { options: field.options }),
        ...(field.actionId === undefined ? {} : { actionId: field.actionId }),
      }
    }),
  }))
  return { sections }
}

const SetBodySchema = z.object({
  action: z.literal('set').optional(),
  id: z.string(),
  key: z.string(),
  value: z.string(),
})

const UnsetBodySchema = z.object({
  action: z.literal('unset'),
  id: z.string(),
  key: z.string(),
})

export const PatchModuleSectionBodySchema = z.union([UnsetBodySchema, SetBodySchema])

const findSectionField = (descriptors: readonly SettingsSection[], id: string, key: string): SettingsSection => {
  const section = descriptors.find((s) => s.id === id)
  if (section === undefined) throw new ModuleSectionConfigError('bad-section', `unknown section: ${id}`)
  const field = section.fields.find((f) => f.key === key)
  if (field === undefined) throw new ModuleSectionConfigError('bad-key', `undeclared key: ${key}`)
  return section
}

export function applyModuleSectionUpdate(
  body: { id: string; key: string; value: string },
  updatedBy: string,
  descriptors: readonly SettingsSection[],
  contextId?: string,
): { id: string; key: string; updatedAt: number } {
  const section = findSectionField(descriptors, body.id, body.key)
  const trimmed = body.value.trim()
  if (trimmed === '') throw new ModuleSectionConfigError('bad-value', 'value must be a non-empty string')
  const updatedAt = Date.now()
  writeFieldValue(section, body.key, trimmed, updatedBy, contextId)
  log.info({ section: body.id, key: body.key, updatedBy }, 'module section config updated')
  return { id: body.id, key: body.key, updatedAt }
}

export function applyModuleSectionUnset(
  body: { id: string; key: string },
  updatedBy: string,
  descriptors: readonly SettingsSection[],
  contextId?: string,
): { id: string; key: string } {
  const section = findSectionField(descriptors, body.id, body.key)
  clearFieldValue(section, body.key, contextId)
  log.info({ section: body.id, key: body.key, updatedBy }, 'module section config unset')
  return { id: body.id, key: body.key }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/debug/admin-module-sections.test.ts`
Expected: PASS — all pre-existing tests (admin path unchanged) plus the 6 new context/group/`visibleWhen` tests.

- [ ] **Step 5: Lint + typecheck**

Run: `bunx oxlint src/debug/admin-module-sections.ts && bun typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/debug/admin-module-sections.ts tests/debug/admin-module-sections.test.ts
git commit -m "feat(settings): make module-section snapshot builder scope-aware (admin/context/group + visibleWhen)"
```

---

## Task 3: Admin route filters to admin scope

**Files:**

- Modify: `src/debug/settings/admin/module-sections-routes.ts`
- Test: `tests/debug/settings/admin/module-sections-routes.test.ts`

Now that a context/group section can be registered, the admin route must never serve or mutate one. Filter the descriptor list to admin scope in both GET and PATCH.

- [ ] **Step 1: Write the failing test (append to existing suite)**

Add this import at the top of `tests/debug/settings/admin/module-sections-routes.test.ts` (alongside the existing ones):

```typescript
import { getPluginConfig } from '../../../../src/config.js'
```

Append inside `describe('settings admin module-sections routes', …)`, before the closing `})`:

```typescript
test('GET as admin omits a context-scoped section', async () => {
  moduleSettingsRegistry.register([
    { id: 'ctx-only', label: 'Ctx only', scope: 'context', fields: [{ key: 'note', label: 'Note' }] },
  ])
  const url = new URL('https://x/settings/api/admin/module-sections')
  const res = await handleAdminModuleSectionsRoutes(
    new Request(url, { method: 'GET', headers: authHeaders(botAdminSession) }),
    url,
    '/settings/api/admin/module-sections',
  )
  expect(res.status).toBe(200)
  const body = z.object({ sections: z.array(z.object({ id: z.string() })) }).parse(await res.json())
  expect(body.sections.map((s) => s.id)).not.toContain('ctx-only')
  expect(body.sections.map((s) => s.id)).toContain('acp')
})

test('PATCH to a context-scoped section via the admin route is rejected (422) and writes nothing', async () => {
  moduleSettingsRegistry.register([
    { id: 'ctx-only', label: 'Ctx only', scope: 'context', fields: [{ key: 'note', label: 'Note' }] },
  ])
  const url = new URL('https://x/settings/api/admin/module-sections')
  const res = await handleAdminModuleSectionsRoutes(
    new Request(url, {
      method: 'PATCH',
      headers: { ...authHeaders(botAdminSession, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'ctx-only', key: 'note', value: 'x' }),
    }),
    url,
    '/settings/api/admin/module-sections',
  )
  expect(res.status).toBe(422)
  expect(getPluginConfig('any-ctx', 'ctx-only', 'note')).toBeNull()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/debug/settings/admin/module-sections-routes.test.ts`
Expected: FAIL — GET currently lists `ctx-only`; PATCH currently persists it.

- [ ] **Step 3: Filter descriptors to admin scope in the admin route**

In `src/debug/settings/admin/module-sections-routes.ts`, add `isAdminScopeSection` to the existing import from `../../admin-module-sections.js`:

```typescript
import {
  applyModuleSectionUnset,
  applyModuleSectionUpdate,
  buildModuleSectionDescriptors,
  getModuleSectionsSnapshot,
  isAdminScopeSection,
  ModuleSectionConfigError,
  PatchModuleSectionBodySchema,
} from '../../admin-module-sections.js'
```

Replace the GET branch body (line 31) so it filters:

```typescript
if (req.method === 'GET') {
  const guard = requireAdmin(auth.authed, 'read')
  if (guard !== null) return Promise.resolve(guard)
  const descriptors = buildModuleSectionDescriptors().filter(isAdminScopeSection)
  return Promise.resolve(settingsJson(200, getModuleSectionsSnapshot(descriptors)))
}
```

In `handlePatch`, replace the `const descriptors = buildModuleSectionDescriptors()` line (line 55) with:

```typescript
const descriptors = buildModuleSectionDescriptors().filter(isAdminScopeSection)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/debug/settings/admin/module-sections-routes.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Lint + typecheck**

Run: `bunx oxlint src/debug/settings/admin/module-sections-routes.ts && bun typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/debug/settings/admin/module-sections-routes.ts tests/debug/settings/admin/module-sections-routes.test.ts
git commit -m "fix(settings): admin module-sections route serves only admin-scoped sections"
```

---

## Task 4: Context/group serving route

**Files:**

- Create: `src/debug/settings/context-module-sections-routes.ts`
- Modify: `src/debug/settings-api-router.ts`
- Test: `tests/debug/settings/context-module-sections-routes.test.ts`

New route at `/settings/api/sections`, authenticated per-context via `resolveContextScope` (mirroring `config-routes.ts`). GET serves the sections servable for the resolved scope kind, sourcing values from the per-context store and applying `visibleWhen`. PATCH persists set/unset to the per-context store.

- [ ] **Step 1: Write the failing test**

Create `tests/debug/settings/context-module-sections-routes.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { getPluginConfig, setPluginConfig } from '../../../src/config.js'
import { handleContextModuleSectionsRoutes } from '../../../src/debug/settings/context-module-sections-routes.js'
import { moduleSettingsRegistry } from '../../../src/ports/settings-sections.js'
import { resolveSettingsPrincipal } from '../../../src/settings/principal.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const URL_BASE = 'https://x/settings/api/sections'

describe('settings context module-sections routes', () => {
  let session: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    moduleSettingsRegistry.clear()
    moduleSettingsRegistry.register([
      { id: 'fab-ctx', label: 'Fabricated ctx', scope: 'context', fields: [{ key: 'note', label: 'Note' }] },
      { id: 'fab-group', label: 'Fabricated group', scope: 'group', fields: [{ key: 'gnote', label: 'GNote' }] },
    ])
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
  })

  afterEach(() => {
    moduleSettingsRegistry.clear()
  })

  test('GET (personal) returns context-scoped sections and omits group-scoped ones', async () => {
    const res = await handleContextModuleSectionsRoutes(
      new Request(URL_BASE, { headers: authHeaders(session) }),
      new URL(URL_BASE),
    )
    expect(res.status).toBe(200)
    const body = z.object({ sections: z.array(z.object({ id: z.string() })) }).parse(await res.json())
    const ids = body.sections.map((s) => s.id)
    expect(ids).toContain('fab-ctx')
    expect(ids).not.toContain('fab-group')
  })

  test('GET reflects a value already in the per-context store', async () => {
    const { personalConfigContextId } = resolveSettingsPrincipal('pi-1', 'u-1')
    setPluginConfig(personalConfigContextId, 'fab-ctx', 'note', 'stored-value')
    const res = await handleContextModuleSectionsRoutes(
      new Request(URL_BASE, { headers: authHeaders(session) }),
      new URL(URL_BASE),
    )
    const body = z
      .object({
        sections: z.array(z.object({ id: z.string(), fields: z.array(z.object({ value: z.string().nullable() })) })),
      })
      .parse(await res.json())
    const section = body.sections.find((s) => s.id === 'fab-ctx')
    expect(section!.fields[0]!.value).toBe('stored-value')
  })

  test('PATCH set persists to the per-context store', async () => {
    const res = await handleContextModuleSectionsRoutes(
      new Request(URL_BASE, {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'fab-ctx', key: 'note', value: 'written' }),
      }),
      new URL(URL_BASE),
    )
    expect(res.status).toBe(200)
    const { personalConfigContextId } = resolveSettingsPrincipal('pi-1', 'u-1')
    expect(getPluginConfig(personalConfigContextId, 'fab-ctx', 'note')).toBe('written')
  })

  test('PATCH unset clears the per-context store', async () => {
    const { personalConfigContextId } = resolveSettingsPrincipal('pi-1', 'u-1')
    setPluginConfig(personalConfigContextId, 'fab-ctx', 'note', 'temp')
    const res = await handleContextModuleSectionsRoutes(
      new Request(URL_BASE, {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unset', id: 'fab-ctx', key: 'note' }),
      }),
      new URL(URL_BASE),
    )
    expect(res.status).toBe(200)
    expect(getPluginConfig(personalConfigContextId, 'fab-ctx', 'note')).toBeNull()
  })

  test('PATCH to a group-scoped section from a personal principal is rejected (422)', async () => {
    const res = await handleContextModuleSectionsRoutes(
      new Request(URL_BASE, {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'fab-group', key: 'gnote', value: 'x' }),
      }),
      new URL(URL_BASE),
    )
    expect(res.status).toBe(422)
  })

  test('PATCH without CSRF is 403', async () => {
    const res = await handleContextModuleSectionsRoutes(
      new Request(URL_BASE, {
        method: 'PATCH',
        headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'fab-ctx', key: 'note', value: 'x' }),
      }),
      new URL(URL_BASE),
    )
    expect(res.status).toBe(403)
  })

  test('GET unauthenticated is 401', async () => {
    const res = await handleContextModuleSectionsRoutes(new Request(URL_BASE), new URL(URL_BASE))
    expect(res.status).toBe(401)
  })

  test('GET for a non-manageable group contextId is 403', async () => {
    const url = `${URL_BASE}?contextId=group%3Anot-mine`
    const res = await handleContextModuleSectionsRoutes(
      new Request(url, { headers: authHeaders(session) }),
      new URL(url),
    )
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/settings/context-module-sections-routes.test.ts`
Expected: FAIL — `Cannot find module '.../context-module-sections-routes.js'`.

- [ ] **Step 3: Create the route**

Create `src/debug/settings/context-module-sections-routes.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import {
  applyModuleSectionUnset,
  applyModuleSectionUpdate,
  buildModuleSectionDescriptors,
  getModuleSectionsSnapshot,
  isSectionServableInScopeKind,
  ModuleSectionConfigError,
} from '../admin-module-sections.js'
import { logger } from '../../logger.js'
import { authenticate, parseJsonBody, requireCsrf, resolveContextScope, settingsJson } from './respond.js'

const log = logger.child({ scope: 'debug-server:settings-context-module-sections' })

const SetBodySchema = z.object({
  action: z.literal('set').optional(),
  id: z.string(),
  key: z.string(),
  value: z.string(),
  contextId: z.string().optional(),
})
const UnsetBodySchema = z.object({
  action: z.literal('unset'),
  id: z.string(),
  key: z.string(),
  contextId: z.string().optional(),
})
const PatchBodySchema = z.union([UnsetBodySchema, SetBodySchema])

function handleGet(req: Request, url: URL): Response {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const scope = resolveContextScope(auth.authed.principal, 'read', url.searchParams.get('contextId') ?? undefined)
  if (!scope.ok) return scope.response
  const descriptors = buildModuleSectionDescriptors().filter((s) => isSectionServableInScopeKind(s, scope.scope.kind))
  return settingsJson(200, getModuleSectionsSnapshot(descriptors, scope.scope.contextId))
}

async function handlePatch(req: Request): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return csrf

  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = PatchBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const scope = resolveContextScope(auth.authed.principal, 'write', body.data.contextId)
  if (!scope.ok) return scope.response
  const descriptors = buildModuleSectionDescriptors().filter((s) => isSectionServableInScopeKind(s, scope.scope.kind))

  try {
    if (body.data.action === 'unset') {
      const result = applyModuleSectionUnset(
        body.data,
        auth.authed.principal.platformUserId,
        descriptors,
        scope.scope.contextId,
      )
      return settingsJson(200, { ok: true, id: result.id, key: result.key })
    }
    const result = applyModuleSectionUpdate(
      body.data,
      auth.authed.principal.platformUserId,
      descriptors,
      scope.scope.contextId,
    )
    return settingsJson(200, { ok: true, id: result.id, key: result.key, updatedAt: result.updatedAt })
  } catch (err) {
    if (err instanceof ModuleSectionConfigError) return settingsJson(422, { error: err.message })
    log.error({ err: err instanceof Error ? err.message : String(err) }, 'context module section PATCH failed')
    return settingsJson(500, { error: 'internal server error' })
  }
}

export function handleContextModuleSectionsRoutes(req: Request, url: URL): Promise<Response> {
  if (req.method === 'GET') return Promise.resolve(handleGet(req, url))
  if (req.method === 'PATCH') return handlePatch(req)
  return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
}
```

Note the import ordering: oxlint's import sorter expects alphabetical module specifiers — if `bunx oxlint` reports an `import/order`-style issue, let `bun format` reorder (the `../../logger.js` vs `../admin-module-sections.js` ordering is resolved by the formatter).

- [ ] **Step 4: Wire the route into the dispatcher**

In `src/debug/settings-api-router.ts`, add the import (keep alphabetical grouping near the other `./settings/*` imports):

```typescript
import { handleContextModuleSectionsRoutes } from './settings/context-module-sections-routes.js'
```

Then, inside `routeSettingsApi`, add the dispatch line alongside the other non-admin routes (e.g. right after the `/settings/api/config` line):

```typescript
if (url.pathname === '/settings/api/sections') return handleContextModuleSectionsRoutes(req, url)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/debug/settings/context-module-sections-routes.test.ts`
Expected: PASS (8/8).

- [ ] **Step 6: Lint + typecheck + format**

Run: `bun format && bunx oxlint src/debug/settings/context-module-sections-routes.ts src/debug/settings-api-router.ts && bun typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/debug/settings/context-module-sections-routes.ts src/debug/settings-api-router.ts tests/debug/settings/context-module-sections-routes.test.ts
git commit -m "feat(settings): serve context/group module sections at /settings/api/sections"
```

---

## Task 5: Client fetchers

**Files:**

- Modify: `client/settings/fetchers.ts`
- Test: `tests/client/settings/context-module-sections-fetchers.test.ts`

Add context-scoped fetchers mirroring the admin `fetchModuleSections`/`patchModuleSection`/`unsetModuleSection`, reusing `ModuleSectionsResponseSchema` and the `ctxQuery(contextId)` helper.

- [ ] **Step 1: Write the failing test**

Create `tests/client/settings/context-module-sections-fetchers.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { setCsrfToken } from '../../../client/settings/fetchers.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const csrfHeader = (init: RequestInit): string => new Headers(init.headers).get('X-Settings-CSRF') ?? ''
const parseBody = (body: BodyInit | null | undefined): unknown => (typeof body === 'string' ? JSON.parse(body) : null)
const methodOf = (init: RequestInit): string => (init.method ?? 'GET').toUpperCase()

describe('context-module-sections-fetchers', () => {
  test('fetchContextSections GETs /settings/api/sections with contextId and returns parsed sections', async () => {
    const { fetchContextSections } = await import('../../../client/settings/fetchers.js')
    const payload = {
      sections: [
        {
          id: 'fab-ctx',
          label: 'Fab',
          fields: [{ key: 'note', label: 'Note', value: 'v', sensitive: false, required: false }],
        },
      ],
    }
    let seenUrl = ''
    let seenMethod = ''
    setMockFetch((url, init) => {
      seenUrl = url
      seenMethod = methodOf(init)
      return Promise.resolve(json(payload))
    })
    const result = await fetchContextSections('ctx-1')
    expect(seenUrl).toBe('/settings/api/sections?contextId=ctx-1')
    expect(seenMethod).toBe('GET')
    expect(result).toEqual(payload)
  })

  test('patchContextSection PATCHes with id/key/value/contextId and CSRF header', async () => {
    const { patchContextSection } = await import('../../../client/settings/fetchers.js')
    setCsrfToken('csrf-ctx')
    let seenUrl = ''
    let seenCsrf = ''
    let seenMethod = ''
    let seenBody: unknown
    setMockFetch((url, init) => {
      seenUrl = url
      seenCsrf = csrfHeader(init)
      seenMethod = methodOf(init)
      seenBody = parseBody(init.body)
      return Promise.resolve(json({ ok: true }))
    })
    await patchContextSection({ id: 'fab-ctx', key: 'note', value: 'x', contextId: 'ctx-1' })
    expect(seenUrl).toBe('/settings/api/sections')
    expect(seenCsrf).toBe('csrf-ctx')
    expect(seenMethod).toBe('PATCH')
    expect(seenBody).toEqual({ id: 'fab-ctx', key: 'note', value: 'x', contextId: 'ctx-1' })
  })

  test('unsetContextSection PATCHes with action:unset and CSRF header', async () => {
    const { unsetContextSection } = await import('../../../client/settings/fetchers.js')
    setCsrfToken('csrf-ctx2')
    let seenBody: unknown
    let seenMethod = ''
    setMockFetch((_url, init) => {
      seenMethod = methodOf(init)
      seenBody = parseBody(init.body)
      return Promise.resolve(json({ ok: true }))
    })
    await unsetContextSection({ id: 'fab-ctx', key: 'note', contextId: 'ctx-1' })
    expect(seenMethod).toBe('PATCH')
    expect(seenBody).toEqual({ action: 'unset', id: 'fab-ctx', key: 'note', contextId: 'ctx-1' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test:client tests/client/settings/context-module-sections-fetchers.test.ts`
(If `bun test:client` does not accept a path filter, run `bun test tests/client/settings/context-module-sections-fetchers.test.ts`.)
Expected: FAIL — `fetchContextSections` is not exported from `fetchers.js`.

- [ ] **Step 3: Add the fetchers**

In `client/settings/fetchers.ts`, add the schema import near the other `fetcher-schemas-*` imports:

```typescript
import { ModuleSectionsResponseSchema, type ModuleSectionsResponse } from './fetcher-schemas-module-sections.js'
```

Add the fetchers near the other context-scoped fetchers (e.g. after `fetchConfig`/`patchConfig`):

```typescript
export const fetchContextSections = (contextId: string): Promise<ModuleSectionsResponse> =>
  getJson(`/settings/api/sections?${ctxQuery(contextId)}`, (b) => ModuleSectionsResponseSchema.parse(b))

export const patchContextSection = (input: {
  id: string
  key: string
  value: string
  contextId: string
}): Promise<unknown> => writeJson('/settings/api/sections', 'PATCH', input, (b) => b)

export const unsetContextSection = (input: { id: string; key: string; contextId: string }): Promise<unknown> =>
  writeJson('/settings/api/sections', 'PATCH', { action: 'unset', ...input }, (b) => b)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/client/settings/context-module-sections-fetchers.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Lint + typecheck**

Run: `bunx oxlint client/settings/fetchers.ts && bun typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add client/settings/fetchers.ts tests/client/settings/context-module-sections-fetchers.test.ts
git commit -m "feat(settings): add context-scoped module-section client fetchers"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the affected test suites together**

Run:

```bash
bun test tests/debug/settings-section-visibility.test.ts \
  tests/debug/admin-module-sections.test.ts \
  tests/debug/settings/admin/module-sections-routes.test.ts \
  tests/debug/settings/context-module-sections-routes.test.ts \
  tests/client/settings/context-module-sections-fetchers.test.ts \
  tests/client/settings/module-sections-fetchers.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Confirm no knip / architecture-guard regressions**

Run: `bun knip && bun test tests/architecture-guard.test.ts`
Expected: knip reports no new unused exports; the guard passes. (The new `src/debug/*` files may name providers freely — the guard only scans `src/ports/**`, which is untouched.)

- [ ] **Step 3: Run `bun check:full`**

Run: `bun check:full`
Expected: green. If the only failures are the known parallel-load flakes (stats perf timing; `/logs` port `EADDRINUSE` on 19233/9100), re-run those files in isolation to confirm they pass, and treat them as pre-existing — do not "fix" by touching unrelated files.

- [ ] **Step 4: Final review dispatch**

After all tasks are green, dispatch the final full-implementation code reviewer per subagent-driven-development, then proceed to finishing-a-development-branch.

---

## Self-Review

**Spec coverage (Phase 4b scope):**

- Context/group descriptor serving → Tasks 2 (builder value I/O branch) + 4 (route).
- `visibleWhen` evaluation → Task 1 (evaluator) + Task 2 (filter in snapshot) + Task 4 (route serves filtered).
- Per-context config store, `plugin:<id>:<key>` → Task 2 via `getPluginConfig`/`setPluginConfig`/`unsetPluginConfig` (decision c).
- New separate route, admin untouched → Task 4 + Task 3 keeps admin serving admin-only (decision a/d).
- Client wiring → Task 5.
- Fabricated sections only; real 4d/4e sections deferred → all tests use `fab-*`/`acp` only.

**Type consistency:** `getModuleSectionsSnapshot(descriptors, contextId?)`, `applyModuleSectionUpdate(body, updatedBy, descriptors, contextId?)`, `applyModuleSectionUnset(body, updatedBy, descriptors, contextId?)` — same optional-4th-arg shape across builder, admin route (omits it), context route (passes `scope.scope.contextId`). `evaluateSectionVisibility(rule, contextId)` matches its two call sites. `isSectionServableInScopeKind(section, kind)` / `isAdminScopeSection(section)` — exact names used in the route filters. `readFieldRaw` returns `string | null` (normalizes `getPluginAdminConfig`'s `undefined`); snapshot value branch tests `raw === null`.

**Guardrails honored:** no `as` (capability compared by string iteration; `new Set<TaskCapability>([...])` uses explicit generics); no `?.` in `src/` code; comments on their own lines; sensitive values masked on read in every scope; admin path behavior preserved (existing admin tests unchanged, still green).

**Out of scope (noted, not built):** masked-secret "echo = no-change" write guard (admin path lacks it too; add in 4d if a real sensitive context field needs it); `readonly-derived` live/derived value sourcing (4d/4e); widening the architecture guard to `client/**` (4h); any real section relocation.
