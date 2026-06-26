<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Admin Default Tool Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a bot admin define a per-platform-instance default `tool_prefs` configuration that is **seeded once** into each context's own prefs the first time its toolset is built with no stored prefs — never overriding a user who later customizes, and never retroactively changing already-seeded contexts.

**Architecture:** The admin default is a normal `ToolPrefs` blob stored under a reserved sentinel context id `__admin_tool_defaults__:<platformInstanceId>`, edited via a new bot-admin route that reuses the existing tools response/toggle helpers over the static tool catalog. Seeding happens in `applyToolPreferences` (the single chokepoint that reads prefs): when a real context has no stored `tool_prefs` row and an admin default exists for its instance, the default is copied in once via `setToolPrefs`. Resolution (`resolveToolPermission`) is unchanged — this is a seed, not a live fallback tier.

**Tech Stack:** Bun, TypeScript (strict, `.js` import paths), Drizzle ORM + bun:sqlite, Zod v4, Vercel AI SDK `ToolSet`, Svelte 5 (runes) settings SPA, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-06-18-admin-default-tool-permissions-design.md`

---

## Conventions for every task

- Run a single test file with: `bun test <path>` (serial, fine for one file). Full suite is `bun run test`. Client tests: `bun test:client <path>`.
- Never add lint-disable/ts-ignore comments — fix the underlying issue (hook policy blocks them).
- New `.ts` files start with the 4-line SPDX header; new `.svelte` files start with the 4-line HTML-comment header (copy from any existing section).

---

## Task 1: `hasStoredToolPrefs` helper (distinguish "no row" from "empty prefs")

**Why:** Seeding must fire only when a context has **no** `tool_prefs` row. `getToolPrefs` returns `emptyPrefs()` for both an absent row and an empty/corrupt row, so we need a presence check. `getCachedConfig(contextId, key)` returns `string | null` (`null` ⇒ no row).

**Files:**

- Modify: `src/tools/tool-preferences.ts`
- Test: `tests/tools/tool-preferences.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/tools/tool-preferences.test.ts` (it already uses `setupTestDb`/`mockLogger`; add `hasStoredToolPrefs`, `setToolPrefs` to the `../../src/tools/tool-preferences.js` import if not present):

```typescript
describe('hasStoredToolPrefs', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('false when no row, true after a write', () => {
    expect(hasStoredToolPrefs('ctx-none')).toBe(false)
    setToolPrefs('ctx-none', { riskDefaults: {}, domainDefaults: { web: 'deny' }, toolOverrides: {} })
    expect(hasStoredToolPrefs('ctx-none')).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/tools/tool-preferences.test.ts`
Expected: FAIL — `hasStoredToolPrefs` is not exported.

- [ ] **Step 3: Implement it**

In `src/tools/tool-preferences.ts` (the file already imports `getCachedConfig` and defines `TOOL_PREFS_CONFIG_KEY`), add after `getToolPrefs`:

```typescript
/** True when a tool_prefs row exists for the context (distinct from an empty/allow-all prefs object). */
export function hasStoredToolPrefs(contextId: string): boolean {
  return getCachedConfig(contextId, TOOL_PREFS_CONFIG_KEY) !== null
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/tools/tool-preferences.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/tool-preferences.ts tests/tools/tool-preferences.test.ts
git commit -m "feat(tool-prefs): hasStoredToolPrefs presence check"
```

---

## Task 2: Admin-tool-defaults module (context id, read, seed)

**Files:**

- Create: `src/tools/admin-tool-defaults.ts`
- Test: `tests/tools/admin-tool-defaults.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/tools/admin-tool-defaults.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { toScopedContextId } from '../../src/chat/scoped-context.js'
import {
  adminToolDefaultsContextId,
  getAdminToolDefaults,
  maybeSeedAdminToolDefaults,
} from '../../src/tools/admin-tool-defaults.js'
import { getToolPrefs, hasStoredToolPrefs, setToolPrefs, type ToolPrefs } from '../../src/tools/tool-preferences.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const PI = 'pi-1'
const DEFAULT: ToolPrefs = { riskDefaults: {}, domainDefaults: { web: 'deny' }, toolOverrides: {} }

describe('admin tool defaults', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('context id has the reserved prefix', () => {
    expect(adminToolDefaultsContextId(PI)).toBe('__admin_tool_defaults__:pi-1')
  })

  test('getAdminToolDefaults returns null when unset, prefs when set', () => {
    expect(getAdminToolDefaults(PI)).toBeNull()
    setToolPrefs(adminToolDefaultsContextId(PI), DEFAULT)
    expect(getAdminToolDefaults(PI)).toEqual(DEFAULT)
  })

  test('getAdminToolDefaults treats empty prefs as no default', () => {
    setToolPrefs(adminToolDefaultsContextId(PI), { riskDefaults: {}, domainDefaults: {}, toolOverrides: {} })
    expect(getAdminToolDefaults(PI)).toBeNull()
  })

  test('seeds a fresh scoped context once from the instance default', () => {
    setToolPrefs(adminToolDefaultsContextId(PI), DEFAULT)
    const ctx = toScopedContextId({ platformInstanceId: PI, nativeContextId: 'user-1' })
    expect(hasStoredToolPrefs(ctx)).toBe(false)
    maybeSeedAdminToolDefaults(ctx)
    expect(hasStoredToolPrefs(ctx)).toBe(true)
    expect(getToolPrefs(ctx)).toEqual(DEFAULT)
  })

  test('does not overwrite an existing context', () => {
    setToolPrefs(adminToolDefaultsContextId(PI), DEFAULT)
    const ctx = toScopedContextId({ platformInstanceId: PI, nativeContextId: 'user-1' })
    const own: ToolPrefs = { riskDefaults: {}, domainDefaults: {}, toolOverrides: { web_fetch: 'allow' } }
    setToolPrefs(ctx, own)
    maybeSeedAdminToolDefaults(ctx)
    expect(getToolPrefs(ctx)).toEqual(own)
  })

  test('no-op when no admin default exists', () => {
    const ctx = toScopedContextId({ platformInstanceId: PI, nativeContextId: 'user-2' })
    maybeSeedAdminToolDefaults(ctx)
    expect(hasStoredToolPrefs(ctx)).toBe(false)
  })

  test('no-op for a non-scoped context id', () => {
    setToolPrefs(adminToolDefaultsContextId(PI), DEFAULT)
    maybeSeedAdminToolDefaults('plain-user-id')
    expect(hasStoredToolPrefs('plain-user-id')).toBe(false)
  })

  test('no-op (no recursion) for the admin-default sentinel context', () => {
    setToolPrefs(adminToolDefaultsContextId(PI), DEFAULT)
    // Calling seed on the sentinel itself must not try to seed/parse it.
    maybeSeedAdminToolDefaults(adminToolDefaultsContextId(PI))
    expect(getAdminToolDefaults(PI)).toEqual(DEFAULT)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/tools/admin-tool-defaults.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

Create `src/tools/admin-tool-defaults.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { parseScopedContextId } from '../chat/scoped-context.js'
import { logger } from '../logger.js'
import { getToolPrefs, hasStoredToolPrefs, setToolPrefs, type ToolPrefs } from './tool-preferences.js'

const log = logger.child({ scope: 'tools:admin-defaults' })

/** Reserved sentinel prefix for the per-instance admin default tool_prefs context. */
const ADMIN_TOOL_DEFAULTS_PREFIX = '__admin_tool_defaults__:'

export function adminToolDefaultsContextId(platformInstanceId: string): string {
  return `${ADMIN_TOOL_DEFAULTS_PREFIX}${platformInstanceId}`
}

function isAdminToolDefaultsContextId(contextId: string): boolean {
  return contextId.startsWith(ADMIN_TOOL_DEFAULTS_PREFIX)
}

function prefsAreEmpty(prefs: ToolPrefs): boolean {
  return (
    Object.keys(prefs.riskDefaults ?? {}).length === 0 &&
    Object.keys(prefs.domainDefaults).length === 0 &&
    Object.keys(prefs.toolOverrides).length === 0
  )
}

/** The configured admin default for an instance, or null when unset / empty (allow-all). */
export function getAdminToolDefaults(platformInstanceId: string): ToolPrefs | null {
  const prefs = getToolPrefs(adminToolDefaultsContextId(platformInstanceId))
  return prefsAreEmpty(prefs) ? null : prefs
}

/**
 * Seed a context's tool_prefs from its instance admin default the first time the context
 * is built with no stored prefs. Idempotent (guarded by row presence); never seeds the
 * sentinel context, a non-scoped context, or when no admin default exists.
 */
export function maybeSeedAdminToolDefaults(prefsContextId: string): void {
  if (isAdminToolDefaultsContextId(prefsContextId)) return
  if (hasStoredToolPrefs(prefsContextId)) return
  const parsed = parseScopedContextId(prefsContextId)
  if (parsed === null) return
  const adminDefault = getAdminToolDefaults(parsed.platformInstanceId)
  if (adminDefault === null) return
  setToolPrefs(prefsContextId, adminDefault)
  log.info({ contextId: prefsContextId, platformInstanceId: parsed.platformInstanceId }, 'Seeded admin tool defaults')
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/tools/admin-tool-defaults.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/admin-tool-defaults.ts tests/tools/admin-tool-defaults.test.ts
git commit -m "feat(tools): admin tool-defaults store + seed helper"
```

---

## Task 3: Seed hook in `applyToolPreferences`

**Files:**

- Modify: `src/tools/index.ts`
- Test: `tests/tools/admin-tool-defaults-seed.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/tools/admin-tool-defaults-seed.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolSet } from 'ai'
import { beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'

import { toScopedContextId } from '../../src/chat/scoped-context.js'
import { adminToolDefaultsContextId } from '../../src/tools/admin-tool-defaults.js'
import { applyToolPreferences } from '../../src/tools/index.js'
import { getToolPrefs, setToolPrefs, type ToolPrefs } from '../../src/tools/tool-preferences.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const PI = 'pi-seed'
// web_fetch is domain 'web'; denying the domain removes it from the applied set.
const DENY_WEB: ToolPrefs = { riskDefaults: {}, domainDefaults: { web: 'deny' }, toolOverrides: {} }

const stubTools = (): ToolSet =>
  ({
    web_fetch: { description: '', inputSchema: z.object({}), execute: async () => 'ok' },
  }) as unknown as ToolSet

describe('admin default seeding via applyToolPreferences', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('seeds a fresh context and applies the default (web_fetch denied)', () => {
    setToolPrefs(adminToolDefaultsContextId(PI), DENY_WEB)
    const ctx = toScopedContextId({ platformInstanceId: PI, nativeContextId: 'u1' })
    const applied = applyToolPreferences(stubTools(), ctx, undefined)
    expect(applied['web_fetch']).toBeUndefined()
    expect(getToolPrefs(ctx)).toEqual(DENY_WEB)
  })

  test('does not re-seed after the user customizes', () => {
    setToolPrefs(adminToolDefaultsContextId(PI), DENY_WEB)
    const ctx = toScopedContextId({ platformInstanceId: PI, nativeContextId: 'u2' })
    applyToolPreferences(stubTools(), ctx, undefined) // first build seeds DENY_WEB
    setToolPrefs(ctx, { riskDefaults: {}, domainDefaults: {}, toolOverrides: { web_fetch: 'allow' } })
    const applied = applyToolPreferences(stubTools(), ctx, undefined)
    expect(applied['web_fetch']).toBeDefined() // user override wins; no re-seed
  })

  test('later admin-default change does not affect an already-seeded context', () => {
    setToolPrefs(adminToolDefaultsContextId(PI), DENY_WEB)
    const ctx = toScopedContextId({ platformInstanceId: PI, nativeContextId: 'u3' })
    applyToolPreferences(stubTools(), ctx, undefined) // seeds DENY_WEB
    setToolPrefs(adminToolDefaultsContextId(PI), { riskDefaults: {}, domainDefaults: {}, toolOverrides: {} })
    const applied = applyToolPreferences(stubTools(), ctx, undefined)
    expect(applied['web_fetch']).toBeUndefined() // still the seeded DENY_WEB
  })

  test('no admin default ⇒ allow-all baseline (web_fetch present)', () => {
    const ctx = toScopedContextId({ platformInstanceId: PI, nativeContextId: 'u4' })
    const applied = applyToolPreferences(stubTools(), ctx, undefined)
    expect(applied['web_fetch']).toBeDefined()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/tools/admin-tool-defaults-seed.test.ts`
Expected: FAIL — first test: `web_fetch` is still defined (no seeding yet), and `getToolPrefs(ctx)` is empty.

- [ ] **Step 3: Add the seed call**

In `src/tools/index.ts`, add the import:

```typescript
import { maybeSeedAdminToolDefaults } from './admin-tool-defaults.js'
```

In `applyToolPreferences`, insert the seed call between computing `prefsContextId` and reading `getToolPrefs`:

```typescript
export function applyToolPreferences(
  tools: ToolSet,
  contextId: string | undefined,
  askPermission: AskPermissionFn | undefined,
): ToolSet {
  if (contextId === undefined) return tools
  const prefsContextId = getConfigContextIdFromStorageContextId(contextId)
  maybeSeedAdminToolDefaults(prefsContextId)
  const prefs = getToolPrefs(prefsContextId)
  // ...unchanged below...
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/tools/admin-tool-defaults-seed.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the existing tools suites to confirm no regression**

Run: `bun test tests/tools/`
Expected: PASS (allow-all/no-default path is reference-identical; existing tool-prefs tests unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/tools/index.ts tests/tools/admin-tool-defaults-seed.test.ts
git commit -m "feat(tools): seed admin tool defaults on first toolset build"
```

---

## Task 4: Export shared tools-route helpers for reuse

**Why:** The admin route reuses the existing domain-view builder and per-domain/per-tool setters from `tools-routes.ts` so the admin UI is byte-identical to the per-context UI. These are currently module-private.

**Files:**

- Modify: `src/debug/settings/tools-routes.ts`

- [ ] **Step 1: Export the three helpers**

In `src/debug/settings/tools-routes.ts`, add the `export` keyword to three existing functions (no body changes):

```typescript
export function buildDomainView(names: readonly string[], prefs: ToolPrefs): unknown[] {
```

```typescript
export function setDomainPermission(prefs: ToolPrefs, domain: ToolDomain, permission: Permission): ToolPrefs {
```

```typescript
export function setToolPermission(prefs: ToolPrefs, toolName: string, permission: Permission): ToolPrefs {
```

- [ ] **Step 2: Typecheck + existing route tests**

Run: `bun run typecheck`
Expected: clean.
Run: `bun test tests/debug/settings/tools-routes.test.ts` (if present)
Expected: PASS (no behavior change).

- [ ] **Step 3: Commit**

```bash
git add src/debug/settings/tools-routes.ts
git commit -m "refactor(settings): export tools-route view/setter helpers"
```

---

## Task 5: Admin tool-defaults route + registration

**Files:**

- Create: `src/debug/settings/admin/tool-defaults-routes.ts`
- Modify: `src/debug/settings-api-router.ts`
- Test: `tests/debug/settings/admin/tool-defaults-routes.test.ts`

**Design note:** the admin default applies globally (every context, any provider), so the editable name list is the **static catalog** `Object.keys(TOOL_METADATA)` — no provider build. MCP/plugin tools (dynamic, `open-world`) are governed by the `open-world` risk tier via presets, not per-row. The response includes `contextId` (the sentinel) so the client's existing `ToolsResponseSchema` parses unchanged.

- [ ] **Step 1: Write the failing route test**

Create `tests/debug/settings/admin/tool-defaults-routes.test.ts`. Read an existing settings admin-route test first (e.g. the system-access or byok route test) and copy its session+CSRF harness exactly. Assert:

```typescript
// Match the existing settings admin-route test harness for session + CSRF + bot-admin principal.
// 1. GET /settings/api/admin/tool-defaults → 200 with { contextId, domains, activePreset: null } by default.
// 2. POST { kind: 'preset', preset: 'read-only' } → 200; getAdminToolDefaults(principal.platformInstanceId)
//    is non-null and detectActivePreset(...) === 'read-only'.
// 3. POST { kind: 'domain', domain: 'web', permission: 'deny' } → 200 and the admin context prefs reflect it.
// 4. POST { kind: 'tool', tool: 'web_fetch', permission: 'ask' } → 200.
// 5. POST with an unknown domain → 422; unknown tool → 422.
// 6. A non-bot-admin principal → 403 on GET and POST; a POST without CSRF → 403.
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/debug/settings/admin/tool-defaults-routes.test.ts`
Expected: FAIL — route returns 404.

- [ ] **Step 3: Implement the route**

Create `src/debug/settings/admin/tool-defaults-routes.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../../../logger.js'
import type { AuthenticatedSettingsRequest } from '../../../settings/request-auth.js'
import { adminToolDefaultsContextId } from '../../../tools/admin-tool-defaults.js'
import { getToolMetadata, TOOL_METADATA, type ToolDomain } from '../../../tools/tool-metadata.js'
import { applyPreset, detectActivePreset, getToolPrefs, setToolPrefs } from '../../../tools/tool-preferences.js'
import { buildDomainView, setDomainPermission, setToolPermission } from '../tools-routes.js'
import { authenticate, parseJsonBody, requireCsrf, settingsJson } from '../respond.js'
import { requireAdmin } from './admin-guard.js'

const log = logger.child({ scope: 'debug-server:settings-admin-tool-defaults' })

const CATALOG_NAMES: readonly string[] = Object.keys(TOOL_METADATA)
const DOMAIN_SET = new Set<string>(Object.values(TOOL_METADATA).map((m) => m.domain))

function isToolDomain(value: string): value is ToolDomain {
  return DOMAIN_SET.has(value)
}

const ToggleBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('domain'), permission: z.enum(['allow', 'ask', 'deny']), domain: z.string() }),
  z.object({ kind: z.literal('tool'), permission: z.enum(['allow', 'ask', 'deny']), tool: z.string() }),
  z.object({ kind: z.literal('preset'), preset: z.enum(['allow-all', 'non-destructive', 'read-only']) }),
])

function view(contextId: string): Response {
  const prefs = getToolPrefs(contextId)
  return settingsJson(200, {
    contextId,
    domains: buildDomainView(CATALOG_NAMES, prefs),
    activePreset: detectActivePreset(prefs),
  })
}

async function handleGet(authed: AuthenticatedSettingsRequest): Promise<Response> {
  const guard = requireAdmin(authed, 'read')
  if (guard !== null) return guard
  return view(adminToolDefaultsContextId(authed.principal.platformInstanceId))
}

async function handlePost(req: Request, authed: AuthenticatedSettingsRequest): Promise<Response> {
  const guard = requireAdmin(authed, 'write')
  if (guard !== null) return guard
  const csrf = requireCsrf(req, authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = ToggleBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const ctx = adminToolDefaultsContextId(authed.principal.platformInstanceId)
  const prefs = getToolPrefs(ctx)

  if (body.data.kind === 'domain') {
    if (!isToolDomain(body.data.domain)) return settingsJson(422, { error: 'unknown tool domain' })
    setToolPrefs(ctx, setDomainPermission(prefs, body.data.domain, body.data.permission))
  } else if (body.data.kind === 'tool') {
    if (getToolMetadata(body.data.tool) === undefined) return settingsJson(422, { error: 'unknown tool' })
    setToolPrefs(ctx, setToolPermission(prefs, body.data.tool, body.data.permission))
  } else {
    setToolPrefs(ctx, applyPreset(body.data.preset))
  }
  log.info({ platformInstanceId: authed.principal.platformInstanceId, kind: body.data.kind }, 'Admin tool default set')
  return view(ctx)
}

export function handleAdminToolDefaultsRoutes(req: Request, _url: URL, pathname: string): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return Promise.resolve(auth.response)
  if (pathname === '/settings/api/admin/tool-defaults') {
    if (req.method === 'GET') return handleGet(auth.authed)
    if (req.method === 'POST') return handlePost(req, auth.authed)
    return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
  }
  return Promise.resolve(settingsJson(404, { error: 'not found' }))
}
```

(Note: `buildDomainView` returns `unknown[]`; that is exactly what the per-context route returns and what `ToolsResponseSchema` validates on the client. No cast needed.)

- [ ] **Step 4: Register the route**

In `src/debug/settings-api-router.ts`, add the import:

```typescript
import { handleAdminToolDefaultsRoutes } from './settings/admin/tool-defaults-routes.js'
```

Add a branch (place it near the other `/settings/api/admin/*` branches):

```typescript
if (url.pathname === '/settings/api/admin/tool-defaults') {
  return handleAdminToolDefaultsRoutes(req, url, url.pathname)
}
```

- [ ] **Step 5: Run the route test to verify it passes**

Run: `bun test tests/debug/settings/admin/tool-defaults-routes.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/debug/settings/admin/tool-defaults-routes.ts src/debug/settings-api-router.ts tests/debug/settings/admin/tool-defaults-routes.test.ts
git commit -m "feat(settings): admin tool-defaults GET/POST route"
```

---

## Task 6: Parameterize `ToolsSection` (defaults preserve current behavior)

**Why:** `ToolsSection`'s built-in fetchers target the per-context routes, which reject the admin sentinel context. Inject the fetchers (and section id/title) via optional props so the admin section can reuse the exact same UI without duplicating ~200 lines. Omitting the new props leaves current behavior byte-identical, so the existing `ToolsSection` test stays green.

**Files:**

- Modify: `client/settings/sections/ToolsSection.svelte`
- Test: existing `tests/client/settings/ToolsSection.test.ts` must still pass unchanged.

- [ ] **Step 1: Update the imports + Props + destructure**

In the `<script>` of `client/settings/sections/ToolsSection.svelte`, change the fetcher import to also pull the type, and add a `ToolsResponse` type import:

```typescript
import type {
  ToolDomainSummary,
  ToolDomainView,
  ToolPermission,
  ToolPreset,
  ToolRisk,
  ToolsResponse,
} from '../fetcher-schemas-tools.js'
import { applyToolPreset, fetchTools, setToolPermission } from '../fetchers.js'
```

Replace the `Props` interface + destructure (currently `{ contextId }`) with:

```typescript
type SetToolPermissionInput =
  | { kind: 'domain'; domain: string; permission: ToolPermission; contextId: string }
  | { kind: 'tool'; tool: string; permission: ToolPermission; contextId: string }

interface Props {
  contextId: string
  sectionId?: string
  eyebrow?: string
  title?: string
  fetchToolsFn?: (contextId: string) => Promise<ToolsResponse>
  setToolPermissionFn?: (input: SetToolPermissionInput) => Promise<ToolsResponse>
  applyToolPresetFn?: (input: { preset: ToolPreset; contextId: string }) => Promise<ToolsResponse>
}

let {
  contextId,
  sectionId = 'tools',
  eyebrow = 'Personal',
  title = 'Tools',
  fetchToolsFn = fetchTools,
  setToolPermissionFn = setToolPermission,
  applyToolPresetFn = applyToolPreset,
}: Props = $props()
```

- [ ] **Step 2: Route the internal calls through the injected fns**

In `load`, replace `await fetchTools(id)` with `await fetchToolsFn(id)`.
In `onSetDomainPermission`, replace `await setToolPermission({ kind: 'domain', ... })` with `await setToolPermissionFn({ kind: 'domain', ... })`.
In `onSetToolPermission`, replace `await setToolPermission({ kind: 'tool', ... })` with `await setToolPermissionFn({ kind: 'tool', ... })`.
In `confirmPreset`, replace `await applyToolPreset({ preset, contextId })` with `await applyToolPresetFn({ preset, contextId })`.

- [ ] **Step 3: Parameterize the section id + header**

Change the section element and header:

```svelte
<section id={sectionId} class="settings-section">
  <PageHeader eyebrow={eyebrow} title={title}>
```

- [ ] **Step 4: Run the existing ToolsSection test to confirm no regression**

Run: `bun test:client tests/client/settings/ToolsSection.test.ts`
Expected: PASS (props defaulted → identical behavior). If the repo has no such test, run `bun run typecheck` to confirm the component still type-checks.

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/ToolsSection.svelte
git commit -m "refactor(settings-ui): parameterize ToolsSection (section id, header, fetchers)"
```

---

## Task 7: Admin fetchers + `AdminToolDefaultsSection` + SettingsApp wiring

**Files:**

- Modify: `client/settings/admin-fetchers.ts`
- Create: `client/settings/sections/admin/AdminToolDefaultsSection.svelte`
- Modify: `client/settings/SettingsApp.svelte`
- Test: `tests/client/settings/AdminToolDefaultsSection.test.ts`

- [ ] **Step 1: Write the failing component test**

Create `tests/client/settings/AdminToolDefaultsSection.test.ts`. Copy the harness from an existing client section test that mocks fetchers (e.g. the `ToolsSection` test). Assert:

```typescript
// Match the existing client section-test harness (happy-dom + fetcher mocks):
// 1. Mounting AdminToolDefaultsSection calls fetchToolDefaults (admin endpoint), not fetchTools.
// 2. It renders a section with id="tool-defaults" and the title "Default tool permissions".
// 3. Applying a preset calls applyToolDefaultPreset.
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test:client tests/client/settings/AdminToolDefaultsSection.test.ts`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Add the admin fetchers**

In `client/settings/admin-fetchers.ts`, add (import `ToolsResponse`, `ToolsResponseSchema`, `ToolPreset` from `./fetcher-schemas-tools.js`; `getJson`/`writeJson` are already imported):

```typescript
export const fetchToolDefaults = (): Promise<ToolsResponse> =>
  getJson('/settings/api/admin/tool-defaults', (b) => ToolsResponseSchema.parse(b))

export const setToolDefault = (
  input:
    | { kind: 'domain'; domain: string; permission: 'allow' | 'ask' | 'deny'; contextId: string }
    | { kind: 'tool'; tool: string; permission: 'allow' | 'ask' | 'deny'; contextId: string },
): Promise<ToolsResponse> =>
  writeJson('/settings/api/admin/tool-defaults', 'POST', input, (b) => ToolsResponseSchema.parse(b))

export const applyToolDefaultPreset = (input: { preset: ToolPreset; contextId: string }): Promise<ToolsResponse> =>
  writeJson('/settings/api/admin/tool-defaults', 'POST', { kind: 'preset', preset: input.preset }, (b) =>
    ToolsResponseSchema.parse(b),
  )
```

(The admin route ignores any `contextId` field in the body — Zod object schemas strip unknown keys — so forwarding the same input shape is safe.)

- [ ] **Step 4: Create the wrapper component**

Create `client/settings/sections/admin/AdminToolDefaultsSection.svelte`:

```svelte
<!-- SPDX-License-Identifier: BUSL-1.1 -->
<!-- Copyright (c) 2026 Dmitriy Lazarev -->
<!-- Use of this software is governed by the Business Source License 1.1. -->
<!-- See LICENSE in the project root for details. -->

<script lang="ts">
  import { applyToolDefaultPreset, fetchToolDefaults, setToolDefault } from '../../admin-fetchers.js'
  import ToolsSection from '../ToolsSection.svelte'
</script>

<ToolsSection
  contextId="admin-default"
  sectionId="tool-defaults"
  eyebrow="Admin · Access"
  title="Default tool permissions"
  fetchToolsFn={fetchToolDefaults}
  setToolPermissionFn={setToolDefault}
  applyToolPresetFn={applyToolDefaultPreset} />
```

- [ ] **Step 5: Wire it into SettingsApp**

In `client/settings/SettingsApp.svelte`:

1. Import the component near the other admin section imports:

```typescript
import AdminToolDefaultsSection from './sections/admin/AdminToolDefaultsSection.svelte'
```

2. In `buildAdminSidebarItems`, add the item to the `isBotAdmin` push (after `{ id: 'tools' ...}` is personal; place this in the admin list, e.g. right after `users`):

```typescript
      { id: 'users', label: 'Users' },
      { id: 'tool-defaults', label: 'Tool defaults' },
      { id: 'groups', label: 'Groups' },
```

3. In the admin template block, mount it inside `{#if settingsSession.isBotAdmin}` (e.g. after `<AdminUsersSection />`):

```svelte
      <AdminUsersSection />
      <AdminToolDefaultsSection />
      <AdminGroupsSection />
```

- [ ] **Step 6: Run the component test to verify it passes**

Run: `bun test:client tests/client/settings/AdminToolDefaultsSection.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/settings/admin-fetchers.ts client/settings/sections/admin/AdminToolDefaultsSection.svelte client/settings/SettingsApp.svelte tests/client/settings/AdminToolDefaultsSection.test.ts
git commit -m "feat(settings-ui): admin Default tool permissions section"
```

---

## Task 8: Document the feature

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a note under the Tools section**

In the Tools area of `CLAUDE.md` (near the "User-configurable access" / "Permission presets" paragraphs), add:

> **Admin default tool permissions** — a bot admin can set a per-platform-instance default `tool_prefs` (settings-UI admin "Default tool permissions" section, `GET/POST /settings/api/admin/tool-defaults`, stored under the reserved `__admin_tool_defaults__:<platformInstanceId>` context). The default is **seeded once** into a context's own `tool_prefs` the first time its toolset is built with no stored prefs (`maybeSeedAdminToolDefaults` in `applyToolPreferences`), applying globally to DM and group contexts of that instance. It is a seed, not a live tier — later admin edits never override an already-seeded or user-customized context; no admin default (or an allow-all default) preserves today's implicit allow-all baseline. MCP/plugin tools are covered by the `open-world` risk tier via presets.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: admin default tool permissions"
```

---

## Task 9: Full verification

- [ ] **Step 1: Build clients**

Run: `bun build:client`
Expected: bundles written to `public/`.

- [ ] **Step 2: Server suite**

Run: `bun run test`
Expected: all pass.

- [ ] **Step 3: Client suite**

Run: `bun test:client`
Expected: all pass.

- [ ] **Step 4: Full check**

Run: `bun check:full`
Expected: lint + typecheck + format + license-headers all pass.

- [ ] **Step 5: Manual smoke (optional)**

As bot admin in the settings UI: open **Default tool permissions**, apply the **Read-only** preset. From a fresh (never-configured) user/group context, trigger a bot turn, then open that context's **Tools** section — it should reflect the seeded read-only posture. Change a tool in that context, then change the admin default again — the context keeps its own settings.

- [ ] **Step 6: Final commit (if any cleanup remains)**

```bash
git add -A
git commit -m "test: full-suite green for admin default tool permissions"
```

---

## Self-review notes (addressed)

- **Spec coverage:** reserved-context storage + `getAdminToolDefaults` (T2); seed-once in `applyToolPreferences`, global DM+group, cross-platform-safe, no resolution-tier change (T3); admin GET/POST route reusing shared helpers (T4, T5); admin UI reusing the parameterized ToolsSection (T6, T7); docs (T8). All spec sections map to a task.
- **Per-context route rejects the sentinel:** confirmed — `resolveContextScope` only accepts personal/manageable-group contexts, so the admin route is separate and the UI injects admin fetchers (T6/T7) rather than reusing the per-context endpoint.
- **"No row" vs "empty prefs":** `hasStoredToolPrefs` (T1) gates seeding so allow-all/empty contexts are not perpetually re-seeded; an allow-all admin default is treated as "no default" (`prefsAreEmpty`).
- **Editable name list:** the admin default uses the static `Object.keys(TOOL_METADATA)` catalog (provider-independent); dynamic MCP/plugin tools are covered by the `open-world` risk tier via presets — documented, not silently dropped.
- **Type consistency:** `adminToolDefaultsContextId`, `getAdminToolDefaults`, `maybeSeedAdminToolDefaults`, `hasStoredToolPrefs`, `buildDomainView`/`setDomainPermission`/`setToolPermission`, `fetchToolDefaults`/`setToolDefault`/`applyToolDefaultPreset`, and the `ToolsResponse`/`ToolsResponseSchema` reuse are consistent across server, client, and tests.
- **No cycle:** `admin-tool-defaults.ts` imports `tool-preferences.ts`; `tool-preferences.ts` imports neither — `tools/index.ts` imports both. No circular dependency.
