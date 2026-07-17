<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plugin / Core Separation — Phase 2c-3a: SettingsSectionPort (Backend) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a trusted module contribute a **declarative admin settings section** (field descriptors), served by one generic backend route that reads/writes admin config — the backend half of `SettingsSectionPort`. This gives the acp/coding module a home for its `magi_base_url`/`magi_token` admin config once the acp plugin is retired (the plugin-manifest-driven config UI disappears with it). Backend only; the generic frontend renderer + SPA wiring is Phase 2c-3a-2.

**Architecture:** Two-tier ports & adapters (spec `docs/superpowers/specs/2026-07-02-plugin-core-separation-design.md` §7). Mirrors the existing generic plugin-config admin surface (`src/debug/admin-plugin-config.ts` + `src/debug/settings/admin/plugin-config-routes.ts`) but sources descriptors from a **module settings registry** (populated at composition load from `TrustedModule.settingsSections`) instead of the plugin registry. Reuses the generic `plg:<id>:<key>` config store (`getPluginAdminConfig`/`setPluginAdminConfig`/`deletePluginAdminConfig`) and the `authenticate → requireAdmin → requireCsrf` route skeleton. Authorization-by-declaration: a key is only writable if some registered section declared it.

**Tech Stack:** Bun + strict TypeScript, Zod v4, `bun:test`. Imports use the `.js` extension.

---

## Scope & Deferred (read first)

**This is plan 2c-3a of the "acp becomes a trusted module" sub-epic** (re-sequenced after recon: acp's migration is gated on a settings surface + a per-context eligibility gate):

- 2c-1 (done): module tool contribution. 2c-2 (done): module command + prompt-fragment contribution.
- **2c-3a (this plan): SettingsSectionPort — BACKEND.** Module-contributed admin settings sections + generic route. Foundational; no module declares sections yet; production no-op.
- 2c-3a-2 (next): SettingsSectionPort — FRONTEND (generic Svelte renderer + data-driven SPA wiring).
- 2c-3b (later): module per-context eligibility gate.
- 2c-3c (later): migrate acp into `src/modules/coding/` (declares the magi settings section on the coding module; retires the plugin).
- 2c-4 (later): remove `codingSecrets`/`codingRepos` from `PluginToolRuntimeContext` + the `coding.secrets` permission.

**In scope for 2c-3a (backend):**

- `src/ports/settings-sections.ts` — `SettingsField`, `SettingsSection` types + `moduleSettingsRegistry` singleton (register/list/clear). Feature-agnostic.
- `src/ports/module.ts` — add `readonly settingsSections?: readonly SettingsSection[]` to `TrustedModule`.
- `src/composition/load-trusted-modules.ts` — register each module's `settingsSections` at load.
- `src/debug/admin-module-sections.ts` — descriptor build + masked snapshot + validate-and-write update/unset (parallels `admin-plugin-config.ts`).
- `src/debug/settings/admin/module-sections-routes.ts` — `GET`/`PATCH /settings/api/admin/module-sections` (parallels `plugin-config-routes.ts`).
- `src/debug/settings-api-router.ts` — mount the new admin route.

**Deliberately deferred:** the frontend renderer + SPA wiring (2c-3a-2), the eligibility gate (2c-3b), the acp migration + declaring the real magi section (2c-3c), non-admin (context/group-scoped) module sections, and richer field controls (select/toggle/action-button) — this slice covers text + masked-secret fields only, which is all `magi_base_url`/`magi_token` need.

**Behavior invariant:** identical runtime behavior. No `TrustedModule` declares `settingsSections` yet (`codingModule` doesn't), so `moduleSettingsRegistry` is empty and the new route returns an empty section list. Full suite stays green; mechanisms proven with a test fixture.

**Baked-in policy (matches current acp behavior — not new decisions):**

- **Storage**: the generic `plg:<sectionId>:<key>` `systemConfig` primitive — **instance-global** (no `platformInstanceId` scoping) and **plaintext at rest, masked on read** (`****`+last4). This is exactly how the acp plugin stores `magi_base_url`/`magi_token` today, and how `src/debug/transcript-viewer.ts` reads them (`getPluginAdminConfig('acp', …)`). So the coding module will later use `sectionId: 'acp'` to share that storage. (Caveats — global scope, plaintext-at-rest — are pre-existing to the plugin-admin-config path, not introduced here.)
- **Scope**: all module settings sections in this slice are **admin-scoped** (the route is admin-gated). Context/group-scoped module sections are future work.

**Guard note:** `src/ports/settings-sections.ts` and `src/ports/module.ts` must stay feature-agnostic (guard scans `src/ports/**`). The route/logic files under `src/debug/` are not guard-scanned.

---

## Reference: the pattern being mirrored (read the two source files)

- `src/debug/admin-plugin-config.ts`: `PluginConfigDescriptor`, `buildPluginConfigDescriptors()` (sources from `pluginRegistry`), `maskSensitive()` (`****`+last4), `getAdminPluginConfigSnapshot()` (filters admin scope, reads + masks values), `applyAdminPluginConfigUpdate/Unset()` (validate `pluginId`+`key` against descriptors, then `setPluginAdminConfig`/`deletePluginAdminConfig`), `AdminPluginConfigError`, `PatchAdminPluginConfigBodySchema` (union set|unset).
- `src/debug/settings/admin/plugin-config-routes.ts`: route skeleton — `authenticate(req)` → `requireAdmin(authed, 'read'|'write')` → (PATCH) `requireCsrf` → `parseJsonBody` → zod-parse → call logic → `settingsJson(...)`; `AdminPluginConfigError` → 422.
- Store primitives (`src/plugins/store.ts`): `getPluginAdminConfig(id, key): string | undefined`, `setPluginAdminConfig(id, key, value, updatedBy)`, `deletePluginAdminConfig(id, key)` — generic, keyed `plg:<id>:<key>`, work with any id string.

The module version replaces `pluginRegistry`-sourced descriptors with `moduleSettingsRegistry`-sourced ones; everything else is structurally identical.

---

## Task 1: `SettingsSection` types + `moduleSettingsRegistry` port

**Files:** Create `src/ports/settings-sections.ts`; Test `tests/ports/settings-sections.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/ports/settings-sections.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  createSettingsSectionRegistry,
  moduleSettingsRegistry,
  type SettingsSection,
} from '../../src/ports/settings-sections.js'

const section = (id: string): SettingsSection => ({
  id,
  label: id,
  fields: [{ key: 'k', label: 'K' }],
})

describe('moduleSettingsRegistry', () => {
  test('registers and lists sections', () => {
    const reg = createSettingsSectionRegistry()
    reg.register([section('acp'), section('other')])
    expect(reg.list().map((s) => s.id)).toEqual(['acp', 'other'])
  })

  test('clear empties the registry', () => {
    const reg = createSettingsSectionRegistry()
    reg.register([section('acp')])
    reg.clear()
    expect(reg.list()).toEqual([])
  })

  test('exposes a shared singleton', () => {
    expect(typeof moduleSettingsRegistry.list).toBe('function')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/ports/settings-sections.test.ts`
Expected: FAIL — module cannot be resolved.

- [ ] **Step 3: Write the port**

Create `src/ports/settings-sections.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** A single admin settings field. `sensitive` values are masked on read. */
export type SettingsField = {
  key: string
  label: string
  required?: boolean
  sensitive?: boolean
}

/**
 * A declarative admin settings section contributed by a trusted module. `id` doubles as the
 * config storage namespace (`plg:<id>:<key>`) and the section id, so a module may use an id
 * distinct from its own module id (e.g. the coding module contributing an `'acp'` section).
 */
export type SettingsSection = {
  id: string
  label: string
  fields: readonly SettingsField[]
}

/**
 * Registry of module-contributed admin settings sections, populated at the composition root from
 * each module's `settingsSections`. Read by the generic admin module-sections route.
 *
 * NOTE: keep this file feature-agnostic — the architecture guard scans `src/ports/**` for
 * feature/provider names. Do not reference concrete module, section, or field names here.
 */
export interface SettingsSectionRegistry {
  register(sections: readonly SettingsSection[]): void
  list(): readonly SettingsSection[]
  clear(): void
}

/** Create an isolated registry (used by tests and, as a singleton, by the runtime). */
export function createSettingsSectionRegistry(): SettingsSectionRegistry {
  const sections: SettingsSection[] = []
  return {
    register: (toAdd) => {
      for (const s of toAdd) sections.push(s)
    },
    list: () => sections,
    clear: () => {
      sections.length = 0
    },
  }
}

/** Process-wide singleton: composition registers here; the admin route reads it. */
export const moduleSettingsRegistry: SettingsSectionRegistry = createSettingsSectionRegistry()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/ports/settings-sections.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ports/settings-sections.ts tests/ports/settings-sections.test.ts
git commit -m "feat(ports): add SettingsSection types + moduleSettingsRegistry"
```

> Transient `knip` "unused" is expected until later tasks consume these — not a pre-commit gate.

---

## Task 2: `TrustedModule.settingsSections` + register at load

**Files:** Modify `src/ports/module.ts`, `src/composition/load-trusted-modules.ts`; Test `tests/composition/load-trusted-modules.test.ts` (extend).

- [ ] **Step 1: Add the field to `TrustedModule`**

In `src/ports/module.ts`, add the import (near the other `Module*` imports):

```ts
import type { SettingsSection } from './settings-sections.js'
```

Add to the `TrustedModule` interface (after `promptFragments?`):

```ts
  /** Admin settings sections this module contributes (served by the generic module-sections route). */
  readonly settingsSections?: readonly SettingsSection[]
```

- [ ] **Step 2: Write the failing test (extend the loader suite)**

In `tests/composition/load-trusted-modules.test.ts`, add the import:

```ts
import { moduleSettingsRegistry } from '../../src/ports/settings-sections.js'
```

Add a test inside the `describe('loadTrustedModules', …)` block:

```ts
test("registers each module's settings sections", async () => {
  moduleSettingsRegistry.clear()
  const mod: TrustedModule = {
    id: 'fixture',
    settingsSections: [{ id: 'fixture-cfg', label: 'Fixture', fields: [{ key: 'url', label: 'URL' }] }],
  }
  await loadTrustedModules([mod], () => {})
  expect(moduleSettingsRegistry.list().map((s) => s.id)).toContain('fixture-cfg')
  moduleSettingsRegistry.clear()
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/composition/load-trusted-modules.test.ts`
Expected: FAIL — the loader does not yet register settings sections.

- [ ] **Step 4: Register settings sections in the loader**

In `src/composition/load-trusted-modules.ts`, add the import:

```ts
import { moduleSettingsRegistry } from '../ports/settings-sections.js'
```

Inside the existing contribution-registration loop (the one that already registers tools/commands/promptFragments), after the promptFragments registration, add:

```ts
if (mod.settingsSections !== undefined && mod.settingsSections.length > 0) {
  moduleSettingsRegistry.register(mod.settingsSections)
}
```

(Keep the pass ordering: migrations → contributions → onActivate.)

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/composition/load-trusted-modules.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ports/module.ts src/composition/load-trusted-modules.ts tests/composition/load-trusted-modules.test.ts
git commit -m "feat(modules): TrustedModule.settingsSections + register at load"
```

---

## Task 3: Admin module-sections logic

**Files:** Create `src/debug/admin-module-sections.ts`; Test `tests/debug/admin-module-sections.test.ts`.

This parallels `src/debug/admin-plugin-config.ts` but sources descriptors from `moduleSettingsRegistry` and keys config by `sectionId`. Read `admin-plugin-config.ts` first to mirror its structure exactly.

- [ ] **Step 1: Write the failing test**

Create `tests/debug/admin-module-sections.test.ts`. It exercises the pure logic against the real `moduleSettingsRegistry` + the real `plg:` store (which needs a test DB). Mirror the setup used by `tests/debug/admin-plugin-config.test.ts` if it exists (read it first); otherwise use `mockLogger()` + `await setupTestDb()` in `beforeEach`. The test must cover:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  applyModuleSectionUnset,
  applyModuleSectionUpdate,
  buildModuleSectionDescriptors,
  getModuleSectionsSnapshot,
  ModuleSectionConfigError,
} from '../../src/debug/admin-module-sections.js'
import { getPluginAdminConfig } from '../../src/plugins/store.js'
import { moduleSettingsRegistry } from '../../src/ports/settings-sections.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

beforeEach(async () => {
  mockLogger()
  await setupTestDb()
  moduleSettingsRegistry.clear()
  moduleSettingsRegistry.register([
    {
      id: 'acp',
      label: 'Coding sessions (magi)',
      fields: [
        { key: 'magi_base_url', label: 'Magi Base URL', required: true },
        { key: 'magi_token', label: 'Magi Token', required: true, sensitive: true },
      ],
    },
  ])
})

afterEach(() => {
  moduleSettingsRegistry.clear()
})

describe('admin module sections', () => {
  test('snapshot lists declared fields with null values before any are set', () => {
    const snap = getModuleSectionsSnapshot(buildModuleSectionDescriptors())
    const acp = snap.sections.find((s) => s.id === 'acp')
    expect(acp?.fields.map((f) => f.key)).toEqual(['magi_base_url', 'magi_token'])
    expect(acp?.fields.every((f) => f.value === null)).toBe(true)
  })

  test('update writes the value; snapshot masks a sensitive field', () => {
    applyModuleSectionUpdate(
      { id: 'acp', key: 'magi_token', value: 'secrettoken1234' },
      'admin-user',
      buildModuleSectionDescriptors(),
    )
    expect(getPluginAdminConfig('acp', 'magi_token')).toBe('secrettoken1234')
    const snap = getModuleSectionsSnapshot(buildModuleSectionDescriptors())
    const token = snap.sections.find((s) => s.id === 'acp')?.fields.find((f) => f.key === 'magi_token')
    expect(token?.value).toBe('****1234') // masked, not plaintext
  })

  test('non-sensitive field is returned unmasked', () => {
    applyModuleSectionUpdate(
      { id: 'acp', key: 'magi_base_url', value: 'https://magi.example' },
      'admin-user',
      buildModuleSectionDescriptors(),
    )
    const snap = getModuleSectionsSnapshot(buildModuleSectionDescriptors())
    const url = snap.sections.find((s) => s.id === 'acp')?.fields.find((f) => f.key === 'magi_base_url')
    expect(url?.value).toBe('https://magi.example')
  })

  test('rejects an unknown section id', () => {
    expect(() =>
      applyModuleSectionUpdate(
        { id: 'nope', key: 'magi_token', value: 'x' },
        'admin-user',
        buildModuleSectionDescriptors(),
      ),
    ).toThrow(ModuleSectionConfigError)
  })

  test('rejects an undeclared key', () => {
    expect(() =>
      applyModuleSectionUpdate(
        { id: 'acp', key: 'not_a_field', value: 'x' },
        'admin-user',
        buildModuleSectionDescriptors(),
      ),
    ).toThrow(ModuleSectionConfigError)
  })

  test('rejects an empty value', () => {
    expect(() =>
      applyModuleSectionUpdate(
        { id: 'acp', key: 'magi_base_url', value: '   ' },
        'admin-user',
        buildModuleSectionDescriptors(),
      ),
    ).toThrow(ModuleSectionConfigError)
  })

  test('unset removes the value', () => {
    applyModuleSectionUpdate(
      { id: 'acp', key: 'magi_base_url', value: 'https://m' },
      'admin-user',
      buildModuleSectionDescriptors(),
    )
    applyModuleSectionUnset({ id: 'acp', key: 'magi_base_url' }, 'admin-user', buildModuleSectionDescriptors())
    expect(getPluginAdminConfig('acp', 'magi_base_url')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/admin-module-sections.test.ts`
Expected: FAIL — module cannot be resolved.

- [ ] **Step 3: Write the logic (mirror `admin-plugin-config.ts`)**

Create `src/debug/admin-module-sections.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../logger.js'
import { deletePluginAdminConfig, getPluginAdminConfig, setPluginAdminConfig } from '../plugins/store.js'
import { moduleSettingsRegistry, type SettingsSection } from '../ports/settings-sections.js'

const log = logger.child({ scope: 'debug:admin-module-sections' })

export type ModuleSectionFieldState = {
  key: string
  label: string
  value: string | null
  sensitive: boolean
  required: boolean
}

export type ModuleSectionState = {
  id: string
  label: string
  fields: ModuleSectionFieldState[]
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

function maskSensitive(value: string): string {
  return value.length <= 4 ? '****' : `****${value.slice(-4)}`
}

export function getModuleSectionsSnapshot(descriptors: readonly SettingsSection[]): ModuleSectionsSnapshot {
  const sections: ModuleSectionState[] = descriptors.map((section) => ({
    id: section.id,
    label: section.label,
    fields: section.fields.map((field) => {
      const raw = getPluginAdminConfig(section.id, field.key)
      const sensitive = field.sensitive ?? false
      return {
        key: field.key,
        label: field.label,
        value: raw === undefined ? null : sensitive ? maskSensitive(raw) : raw,
        sensitive,
        required: field.required ?? false,
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

const findField = (descriptors: readonly SettingsSection[], id: string, key: string): void => {
  const section = descriptors.find((s) => s.id === id)
  if (section === undefined) throw new ModuleSectionConfigError('bad-section', `unknown section: ${id}`)
  const field = section.fields.find((f) => f.key === key)
  if (field === undefined) throw new ModuleSectionConfigError('bad-key', `undeclared key: ${key}`)
}

export function applyModuleSectionUpdate(
  body: { id: string; key: string; value: string },
  updatedBy: string,
  descriptors: readonly SettingsSection[],
): { id: string; key: string; updatedAt: number } {
  findField(descriptors, body.id, body.key)
  const trimmed = body.value.trim()
  if (trimmed === '') throw new ModuleSectionConfigError('bad-value', 'value must be a non-empty string')
  const updatedAt = Date.now()
  setPluginAdminConfig(body.id, body.key, trimmed, updatedBy)
  log.info({ section: body.id, key: body.key, updatedBy }, 'admin module section config updated')
  return { id: body.id, key: body.key, updatedAt }
}

export function applyModuleSectionUnset(
  body: { id: string; key: string },
  updatedBy: string,
  descriptors: readonly SettingsSection[],
): { id: string; key: string } {
  findField(descriptors, body.id, body.key)
  deletePluginAdminConfig(body.id, body.key)
  log.info({ section: body.id, key: body.key, updatedBy }, 'admin module section config unset')
  return { id: body.id, key: body.key }
}
```

> `Date.now()` is used exactly as `admin-plugin-config.ts` does — this is a route handler, not a workflow script, so it's fine.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/debug/admin-module-sections.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/debug/admin-module-sections.ts tests/debug/admin-module-sections.test.ts
git commit -m "feat(debug): admin module-sections config logic (descriptors, masked snapshot, validated write)"
```

---

## Task 4: The admin route

**Files:** Create `src/debug/settings/admin/module-sections-routes.ts`; Test `tests/debug/settings/admin/module-sections-routes.test.ts`.

This parallels `src/debug/settings/admin/plugin-config-routes.ts`. Read it first and mirror the auth/csrf/parse skeleton exactly.

- [ ] **Step 1: Write the failing test**

Create `tests/debug/settings/admin/module-sections-routes.test.ts`. Read `tests/debug/settings/admin/plugin-config-routes.test.ts` (if it exists) to mirror how it builds an authenticated admin `Request` (session cookie, CSRF header) and asserts responses; reuse the same helpers. The test must cover at minimum: GET returns the section snapshot for an admin; PATCH set writes; PATCH with an unknown section id → 422; a non-admin principal → 403/forbidden. If mirroring the existing route test's auth setup is intricate, keep this test focused on the handler's contract using the same fixtures that suite uses. (Do not hand-roll auth; reuse the existing route-test harness.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/debug/settings/admin/module-sections-routes.test.ts`
Expected: FAIL — the route module cannot be resolved.

- [ ] **Step 3: Write the route (mirror `plugin-config-routes.ts`)**

Create `src/debug/settings/admin/module-sections-routes.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  applyModuleSectionUnset,
  applyModuleSectionUpdate,
  buildModuleSectionDescriptors,
  getModuleSectionsSnapshot,
  ModuleSectionConfigError,
  PatchModuleSectionBodySchema,
} from '../../admin-module-sections.js'
import { logger } from '../../../logger.js'
import { authenticate, parseJsonBody, requireCsrf, settingsJson } from '../respond.js'
import { requireAdmin } from './admin-guard.js'

const log = logger.child({ scope: 'debug-server:settings-admin-module-sections' })

export function handleAdminModuleSectionsRoutes(req: Request, _url: URL, pathname: string): Promise<Response> {
  if (pathname !== '/settings/api/admin/module-sections') {
    return Promise.resolve(settingsJson(404, { error: 'not found' }))
  }

  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)

  if (req.method === 'GET') {
    const guard = requireAdmin(auth.authed, 'read')
    if (guard !== null) return Promise.resolve(guard)
    return Promise.resolve(settingsJson(200, getModuleSectionsSnapshot(buildModuleSectionDescriptors())))
  }

  if (req.method === 'PATCH') {
    return handlePatch(req, auth.authed)
  }

  return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
}

async function handlePatch(req: Request, authed: Parameters<typeof requireAdmin>[0]): Promise<Response> {
  const guard = requireAdmin(authed, 'write')
  if (guard !== null) return guard

  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf

  const rawParsed = await parseJsonBody(req)
  if (!rawParsed.ok) return rawParsed.response

  const body = PatchModuleSectionBodySchema.safeParse(rawParsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  try {
    const descriptors = buildModuleSectionDescriptors()
    if (body.data.action === 'unset') {
      const result = applyModuleSectionUnset(body.data, authed.principal.platformUserId, descriptors)
      log.info({ section: result.id, key: result.key }, 'Settings admin unset module section config')
      return settingsJson(200, { ok: true, id: result.id, key: result.key })
    }
    const result = applyModuleSectionUpdate(body.data, authed.principal.platformUserId, descriptors)
    log.info({ section: result.id, key: result.key }, 'Settings admin updated module section config')
    return settingsJson(200, { ok: true, id: result.id, key: result.key, updatedAt: result.updatedAt })
  } catch (err) {
    if (err instanceof ModuleSectionConfigError) return settingsJson(422, { error: err.message })
    log.error({ err: err instanceof Error ? err.message : String(err) }, 'Settings admin module section PATCH failed')
    return settingsJson(500, { error: 'internal server error' })
  }
}
```

> Verify the import ordering matches the repo convention (`bun run format` will fix). Confirm `authenticate`/`requireCsrf`/`parseJsonBody`/`settingsJson` and `requireAdmin` have the exact signatures used in `plugin-config-routes.ts` (they do — this mirrors that file).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/debug/settings/admin/module-sections-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/debug/settings/admin/module-sections-routes.ts tests/debug/settings/admin/module-sections-routes.test.ts
git commit -m "feat(debug): GET/PATCH /settings/api/admin/module-sections route"
```

---

## Task 5: Mount the route

**Files:** Modify `src/debug/settings-api-router.ts`.

- [ ] **Step 1: Mount `handleAdminModuleSectionsRoutes`**

In `src/debug/settings-api-router.ts`, find `routeAdminApi` (the manual `if`-chain dispatching admin paths, e.g. the branch for `'/settings/api/admin/plugin-config'` → `handleAdminPluginConfigRoutes`). Add the import:

```ts
import { handleAdminModuleSectionsRoutes } from './settings/admin/module-sections-routes.js'
```

and a dispatch branch mirroring the plugin-config one, for path `'/settings/api/admin/module-sections'` → `handleAdminModuleSectionsRoutes(req, url, pathname)`. Match the exact shape of the neighboring admin branches (same args, same return).

- [ ] **Step 2: Typecheck + confirm no regression + knip**

Run: `bun run typecheck`
Expected: clean.

Run: `bun test tests/debug/`
Expected: PASS.

Run: `bun run knip`
Expected: clean (exit 0) — the route, logic, registry, port type, and `settingsSections` field are all now reachable. If knip flags any as unused, a wiring step was missed.

- [ ] **Step 3: Commit**

```bash
git add src/debug/settings-api-router.ts
git commit -m "feat(debug): mount admin module-sections route"
```

---

## Task 6: Full verification

- [ ] **Step 1: Build client bundles, run the full suite**

```bash
bun build:client
```

Run: `bun test`
Expected: PASS with the new tests added here (Task 1: +3, Task 2: +1, Task 3: +7, Task 4: +N). No production behavior change: no module declares `settingsSections`, so the registry is empty and `GET /settings/api/admin/module-sections` returns `{ sections: [] }`.

- [ ] **Step 2: Full check pipeline**

Run: `bun check:full`
Expected: all green. Fix formatting with `bun run format` and re-run if needed.

> Note the intentional structural parallel with `admin-plugin-config.ts`/`plugin-config-routes.ts` (mirrored, not shared). A reviewer may flag the duplication; it is deliberate (the module surface parallels the plugin surface, like the module tool/command/prompt adapters parallel their plugin counterparts). Do not refactor the plugin-config files in this slice.

- [ ] **Step 3: Confirm the production no-op**

Run: `rg -n "settingsSections" src/modules/coding/module.ts`
Expected: no output — `codingModule` declares no `settingsSections` yet (the real magi section lands in 2c-3c with the acp migration). The route + registry are present and unit-tested with a fixture, but dormant.

---

## Done criteria

- A `TrustedModule` can declare `settingsSections`; `loadTrustedModules` registers them; `GET/PATCH /settings/api/admin/module-sections` serves declared sections (masked-on-read for sensitive fields) and writes/validates by declaration via the generic `plg:<id>:<key>` store.
- `src/ports/settings-sections.ts` + `src/ports/module.ts` are feature-agnostic (architecture guard green).
- `bun test` + `bun check:full` green; production behavior unchanged (empty section list; no module declares sections yet).
- The next plan (2c-3a-2, frontend) adds a generic Svelte renderer that fetches `/settings/api/admin/module-sections` and renders each section's fields via the existing `SettingsFieldShell`/`Input`/`Secret`/`Confirm` primitives, plus data-driven sidebar/mount wiring in `SettingsApp.svelte` — after which 2c-3b (eligibility gate), 2c-3c (acp migration, which declares the real `'acp'` magi section), and 2c-4 (leak removal) follow.
