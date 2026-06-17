<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tool Permission Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one-click permission presets (Read-only, Non-destructive, Allow all) to the Tools section of the settings web UI, backed by a new sticky risk-default tier in `tool_prefs`.

**Architecture:** Extend the existing `ToolPrefs` model with a `riskDefaults` tier resolved below `domainDefaults` (priority `tool > domain > risk > allow`), so newly-added tools inherit the active preset by their static `ToolRisk` class. Applying a preset resets `domainDefaults`/`toolOverrides` and writes `riskDefaults`. The settings route gains a `kind: 'preset'` branch and returns an `activePreset` field; the Svelte section renders a preset bar with a confirm step.

**Tech Stack:** TypeScript (strict, `.js` import paths), Bun test runner, Zod v4, Svelte 5 (runes), happy-dom for client tests.

---

## Background facts (verified against current code)

- `src/tools/tool-preferences.ts` — `ToolPrefs { domainDefaults, toolOverrides }`, `Permission = 'allow'|'ask'|'deny'`, `resolveToolPermission`, `parseToolPrefs`/`serializeToolPrefs`, `cycleDomain`/`cycleTool`, `getDomainSummary`. `allow`-valued defaults are pruned on write. No Zod schema; hand-written guards.
- `src/tools/tool-metadata.ts` — `ToolRisk = 'read'|'write'|'destructive'|'open-world'`; `getToolMetadata(name)` returns `{ domain, operation, risk }` or `undefined`. MCP/plugin tools resolve to `open-world`.
- `src/debug/settings/tools-routes.ts` — `GET /settings/api/tools` and `POST /settings/api/tools/toggle`. Local helpers `setDomainPermission`/`setToolPermission` construct `ToolPrefs` literals. `ToggleBodySchema` currently requires `permission`.
- `client/settings/fetcher-schemas.ts` — `ToolsResponseSchema`, `ToolPermissionSchema`, `ToolRiskSchema`.
- `client/settings/fetchers.ts` — `fetchTools`, `setToolPermission`.
- `client/settings/sections/ToolsSection.svelte` — domain cards + per-tool segmented controls.
- `Btn.svelte` variants: `primary | secondary | outline | ghost | danger`. `Pill.svelte` tones: `accent | warn | danger | info | neutral | mute`.

## Design decisions locked from the spec

- `riskDefaults` is **optional** on the interface (`riskDefaults?:`) so the ~20 existing test literals that omit it keep compiling; runtime reads use `prefs.riskDefaults ?? {}`. `parseToolPrefs`/`emptyPrefs`/`serializeToolPrefs` always materialize it as `{}` when absent.
- Resolution: `toolOverrides[name]` → `domainDefaults[meta.domain]` → `riskDefaults[meta.risk]` → `'allow'`.
- Preset risk maps (already in pruned form — `allow` entries omitted):
  - `allow-all`: `{}`
  - `non-destructive`: `{ destructive: 'ask', 'open-world': 'ask' }`
  - `read-only`: `{ write: 'ask', destructive: 'ask', 'open-world': 'ask' }`
- Applying a preset clears `domainDefaults` and `toolOverrides`. An untouched (empty) context therefore reports `activePreset = 'allow-all'`.
- `activePreset` is `null` ("Custom") whenever `domainDefaults` or `toolOverrides` are non-empty, or `riskDefaults` matches no preset.

## File structure

- **Modify** `src/tools/tool-preferences.ts` — add `riskDefaults` tier, risk-aware resolution + pruning, `ToolPreset`, `PRESET_RISK_DEFAULTS`, `applyPreset`, `detectActivePreset`. (Tasks 1–2)
- **Modify** `tests/tools/tool-preferences.test.ts` — update existing literals + add new coverage. (Tasks 1–2)
- **Modify** `src/debug/settings/tools-routes.ts` — discriminated-union body schema, `preset` branch, `activePreset` in GET + toggle responses, risk-aware local helpers. (Task 3)
- **Modify** `tests/debug/settings/tools-routes.test.ts` — preset + activePreset coverage. (Task 3)
- **Modify** `client/settings/fetcher-schemas.ts` — `ToolPresetSchema`, `activePreset` on `ToolsResponseSchema`. (Task 4)
- **Modify** `client/settings/fetchers.ts` — `applyToolPreset` fetcher. (Task 4)
- **Modify** `client/settings/sections/ToolsSection.svelte` — preset bar, active indicator, confirm-then-apply. (Task 5)
- **Modify** `tests/client/settings/sections/ToolsSection.test.ts` — preset UI coverage. (Task 5)

---

## Task 1: Add the `riskDefaults` tier to the preferences model

**Files:**

- Modify: `src/tools/tool-preferences.ts`
- Test: `tests/tools/tool-preferences.test.ts`

- [ ] **Step 1: Update existing test literals and add failing tests for the new tier**

In `tests/tools/tool-preferences.test.ts`, change the shared `empty` constant (line 20) and the round-trip / equality literals so they include `riskDefaults`, because `parseToolPrefs` will now always materialize it:

```typescript
const empty: ToolPrefs = { riskDefaults: {}, domainDefaults: {}, toolOverrides: {} }
```

Update the round-trip literal in `describe('parseToolPrefs')` ("round-trips a valid blob"):

```typescript
it('round-trips a valid blob', () => {
  const prefs: ToolPrefs = { riskDefaults: {}, domainDefaults: { web: 'deny' }, toolOverrides: { delete_task: 'deny' } }
  expect(parseToolPrefs(serializeToolPrefs(prefs))).toEqual(prefs)
})
```

Update the `serializeToolPrefs new shape` round-trip literal:

```typescript
const prefs: ToolPrefs = {
  riskDefaults: {},
  domainDefaults: { task: 'ask', project: 'deny' },
  toolOverrides: { delete_task: 'allow' },
}
```

Update the three inline expectations in `parseToolPrefs legacy migration` that compare to a bare object:

```typescript
test('unknown permission string → dropped', () => {
  const garbage = JSON.stringify({ domainDefaults: { task: 'maybe' }, toolOverrides: { x: 'sometimes' } })
  const prefs = parseToolPrefs(garbage)
  expect(prefs).toEqual({ riskDefaults: {}, domainDefaults: {}, toolOverrides: {} })
})

test('null or empty input → empty prefs', () => {
  expect(parseToolPrefs(null)).toEqual({ riskDefaults: {}, domainDefaults: {}, toolOverrides: {} })
  expect(parseToolPrefs('')).toEqual({ riskDefaults: {}, domainDefaults: {}, toolOverrides: {} })
})
```

Then append a new describe block at the end of the file:

```typescript
describe('riskDefaults tier', () => {
  test('resolveToolPermission falls back to riskDefaults by tool risk', () => {
    const prefs: ToolPrefs = {
      riskDefaults: { write: 'ask', destructive: 'ask', 'open-world': 'ask' },
      domainDefaults: {},
      toolOverrides: {},
    }
    expect(resolveToolPermission(prefs, 'list_tasks')).toBe('allow') // read
    expect(resolveToolPermission(prefs, 'create_task')).toBe('ask') // write
    expect(resolveToolPermission(prefs, 'delete_task')).toBe('ask') // destructive
    expect(resolveToolPermission(prefs, 'web_fetch')).toBe('ask') // open-world
  })

  test('domainDefaults wins over riskDefaults', () => {
    const prefs: ToolPrefs = { riskDefaults: { write: 'ask' }, domainDefaults: { task: 'allow' }, toolOverrides: {} }
    expect(resolveToolPermission(prefs, 'create_task')).toBe('allow')
  })

  test('toolOverrides wins over both domain and risk defaults', () => {
    const prefs: ToolPrefs = {
      riskDefaults: { write: 'ask' },
      domainDefaults: { task: 'deny' },
      toolOverrides: { create_task: 'allow' },
    }
    expect(resolveToolPermission(prefs, 'create_task')).toBe('allow')
  })

  test('a new open-world tool (mcp_*) inherits the risk default', () => {
    const prefs: ToolPrefs = { riskDefaults: { 'open-world': 'ask' }, domainDefaults: {}, toolOverrides: {} }
    expect(resolveToolPermission(prefs, 'mcp_server__search')).toBe('ask')
  })

  test('round-trips riskDefaults through parse/serialize', () => {
    const prefs: ToolPrefs = {
      riskDefaults: { write: 'ask', destructive: 'ask' },
      domainDefaults: {},
      toolOverrides: {},
    }
    expect(parseToolPrefs(serializeToolPrefs(prefs))).toEqual(prefs)
  })

  test('legacy prefs without riskDefaults parse to riskDefaults: {}', () => {
    const legacy = JSON.stringify({ domainDefaults: { task: 'ask' }, toolOverrides: {} })
    expect(parseToolPrefs(legacy).riskDefaults).toEqual({})
  })

  test('cycleTool preserves an existing riskDefaults layer', () => {
    let prefs: ToolPrefs = { riskDefaults: { destructive: 'ask' }, domainDefaults: {}, toolOverrides: {} }
    prefs = cycleTool(prefs, 'create_task')
    expect(prefs.riskDefaults).toEqual({ destructive: 'ask' })
  })

  test('cycleDomain preserves an existing riskDefaults layer', () => {
    let prefs: ToolPrefs = { riskDefaults: { destructive: 'ask' }, domainDefaults: {}, toolOverrides: {} }
    prefs = cycleDomain(prefs, 'task', ['create_task', 'delete_task'])
    expect(prefs.riskDefaults).toEqual({ destructive: 'ask' })
  })
})
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `bun test tests/tools/tool-preferences.test.ts`
Expected: FAIL — the new `riskDefaults`-tier assertions fail (resolution ignores `riskDefaults`; parse/serialize drop it) and the updated equality literals fail.

- [ ] **Step 3: Implement the `riskDefaults` tier in `src/tools/tool-preferences.ts`**

Add the `ToolRisk` import:

```typescript
import { getToolMetadata, TOOL_DOMAINS, type ToolDomain, type ToolRisk } from './tool-metadata.js'
```

Extend the interface (optional field):

```typescript
export interface ToolPrefs {
  /** Per-risk default permission applied by presets. Resolved below domainDefaults. Missing entry = 'allow'. */
  riskDefaults?: Partial<Record<ToolRisk, Permission>>
  /** Per-domain default permission. Missing entry = 'allow'. */
  domainDefaults: Partial<Record<ToolDomain, Permission>>
  /** Per-tool override that wins over the domain default. */
  toolOverrides: Record<string, Permission>
}
```

Update `emptyPrefs`:

```typescript
function emptyPrefs(): ToolPrefs {
  return { riskDefaults: {}, domainDefaults: {}, toolOverrides: {} }
}
```

Add a risk guard next to `isToolDomain`:

```typescript
const TOOL_RISK_SET: ReadonlySet<string> = new Set<ToolRisk>(['read', 'write', 'destructive', 'open-world'])

function isToolRisk(value: string): value is ToolRisk {
  return TOOL_RISK_SET.has(value)
}
```

Replace `resolveToolPermission` with the risk-aware version:

```typescript
export function resolveToolPermission(prefs: ToolPrefs, toolName: string): Permission {
  const override = prefs.toolOverrides[toolName]
  if (override !== undefined) return override
  const meta = getToolMetadata(toolName)
  if (meta === undefined) return 'allow'
  return prefs.domainDefaults[meta.domain] ?? (prefs.riskDefaults ?? {})[meta.risk] ?? 'allow'
}
```

Add a `parseRiskDefaults` helper (mirrors `parseDomainDefaults`):

```typescript
function parseRiskDefaults(parsed: Record<string, unknown>): Partial<Record<ToolRisk, Permission>> {
  const out: Partial<Record<ToolRisk, Permission>> = {}
  const raw = parsed['riskDefaults']
  if (isStringRecord(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (isToolRisk(key) && isPermission(value)) out[key] = value
    }
  }
  return out
}
```

Update the return of `parseToolPrefs`:

```typescript
return {
  riskDefaults: parseRiskDefaults(parsed),
  domainDefaults: parseDomainDefaults(parsed),
  toolOverrides: parseToolOverrides(parsed),
}
```

Update `serializeToolPrefs`:

```typescript
export function serializeToolPrefs(prefs: ToolPrefs): string {
  return JSON.stringify({
    riskDefaults: prefs.riskDefaults ?? {},
    domainDefaults: prefs.domainDefaults,
    toolOverrides: prefs.toolOverrides,
  })
}
```

Make pruning risk-aware. In `pruneRedundantOverrides`, replace the `def` computation and carry `riskDefaults` through:

```typescript
function pruneRedundantOverrides(prefs: ToolPrefs): ToolPrefs {
  const toolOverrides: Record<string, Permission> = {}
  for (const [name, value] of Object.entries(prefs.toolOverrides)) {
    const meta = getToolMetadata(name)
    const def: Permission =
      meta === undefined
        ? 'allow'
        : (prefs.domainDefaults[meta.domain] ?? (prefs.riskDefaults ?? {})[meta.risk] ?? 'allow')
    if (value !== def) toolOverrides[name] = value
  }
  return { riskDefaults: prefs.riskDefaults ?? {}, domainDefaults: { ...prefs.domainDefaults }, toolOverrides }
}
```

In `pruneRedundantDomainDefaults`, carry `riskDefaults` through:

```typescript
function pruneRedundantDomainDefaults(prefs: ToolPrefs): ToolPrefs {
  const domainDefaults: Partial<Record<ToolDomain, Permission>> = {}
  for (const [domain, value] of Object.entries(prefs.domainDefaults)) {
    if (value !== 'allow' && isToolDomain(domain)) domainDefaults[domain] = value
  }
  return { riskDefaults: prefs.riskDefaults ?? {}, domainDefaults, toolOverrides: prefs.toolOverrides }
}
```

In `cycleDomain`, include `riskDefaults` in the constructed object passed to the pruners:

```typescript
return pruneRedundantDomainDefaults(
  pruneRedundantOverrides({ riskDefaults: prefs.riskDefaults ?? {}, domainDefaults, toolOverrides }),
)
```

In `cycleTool`, include `riskDefaults` in the constructed object:

```typescript
return pruneRedundantOverrides({
  riskDefaults: prefs.riskDefaults ?? {},
  domainDefaults: { ...prefs.domainDefaults },
  toolOverrides,
})
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/tools/tool-preferences.test.ts`
Expected: PASS (all existing + new tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/tool-preferences.ts tests/tools/tool-preferences.test.ts
git commit -m "feat(tools): add riskDefaults tier to tool preferences"
```

---

## Task 2: Add preset definitions, `applyPreset`, and `detectActivePreset`

**Files:**

- Modify: `src/tools/tool-preferences.ts`
- Test: `tests/tools/tool-preferences.test.ts`

- [ ] **Step 1: Write failing tests for presets**

Append to `tests/tools/tool-preferences.test.ts`. Add `applyPreset`, `detectActivePreset`, and `PRESET_RISK_DEFAULTS` to the import block from `'../../src/tools/tool-preferences.js'`, plus the type import:

```typescript
import {
  applyPreset,
  cycleDomain,
  cycleTool,
  detectActivePreset,
  getDomainSummary,
  parseToolPrefs,
  partitionToolNames,
  PRESET_RISK_DEFAULTS,
  resolveToolPermission,
  serializeToolPrefs,
  type ToolPreset,
  type ToolPrefs,
} from '../../src/tools/tool-preferences.js'
```

Then add:

```typescript
describe('applyPreset', () => {
  test('allow-all yields empty prefs', () => {
    expect(applyPreset('allow-all')).toEqual({ riskDefaults: {}, domainDefaults: {}, toolOverrides: {} })
  })

  test('non-destructive asks on destructive + open-world only', () => {
    expect(applyPreset('non-destructive')).toEqual({
      riskDefaults: { destructive: 'ask', 'open-world': 'ask' },
      domainDefaults: {},
      toolOverrides: {},
    })
  })

  test('read-only asks on write + destructive + open-world', () => {
    expect(applyPreset('read-only')).toEqual({
      riskDefaults: { write: 'ask', destructive: 'ask', 'open-world': 'ask' },
      domainDefaults: {},
      toolOverrides: {},
    })
  })

  test('clears any prior domain/tool customization (reset-to-baseline)', () => {
    const result = applyPreset('read-only')
    expect(result.domainDefaults).toEqual({})
    expect(result.toolOverrides).toEqual({})
  })
})

describe('detectActivePreset', () => {
  test('empty prefs report allow-all', () => {
    expect(detectActivePreset({ riskDefaults: {}, domainDefaults: {}, toolOverrides: {} })).toBe('allow-all')
  })

  test('matches each preset exactly', () => {
    for (const preset of Object.keys(PRESET_RISK_DEFAULTS) as ToolPreset[]) {
      expect(detectActivePreset(applyPreset(preset))).toBe(preset)
    }
  })

  test('any domain override → Custom (null)', () => {
    const prefs: ToolPrefs = {
      riskDefaults: { write: 'ask', destructive: 'ask', 'open-world': 'ask' },
      domainDefaults: { task: 'deny' },
      toolOverrides: {},
    }
    expect(detectActivePreset(prefs)).toBeNull()
  })

  test('any tool override → Custom (null)', () => {
    const prefs: ToolPrefs = {
      riskDefaults: { destructive: 'ask', 'open-world': 'ask' },
      domainDefaults: {},
      toolOverrides: { delete_task: 'deny' },
    }
    expect(detectActivePreset(prefs)).toBeNull()
  })

  test('riskDefaults matching no preset → Custom (null)', () => {
    const prefs: ToolPrefs = { riskDefaults: { read: 'ask' }, domainDefaults: {}, toolOverrides: {} }
    expect(detectActivePreset(prefs)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `bun test tests/tools/tool-preferences.test.ts`
Expected: FAIL — `applyPreset`, `detectActivePreset`, `PRESET_RISK_DEFAULTS` are not exported.

- [ ] **Step 3: Implement presets in `src/tools/tool-preferences.ts`**

Add near the top (after the `Permission` type) the preset type and table:

```typescript
export type ToolPreset = 'allow-all' | 'non-destructive' | 'read-only'

/** Per-preset risk-default maps in pruned form ('allow' entries omitted). */
export const PRESET_RISK_DEFAULTS: Readonly<Record<ToolPreset, Partial<Record<ToolRisk, Permission>>>> = {
  'allow-all': {},
  'non-destructive': { destructive: 'ask', 'open-world': 'ask' },
  'read-only': { write: 'ask', destructive: 'ask', 'open-world': 'ask' },
}
```

Add the helpers near the bottom of the file (after `getDomainSummary`):

```typescript
function pruneRiskDefaults(rd: Partial<Record<ToolRisk, Permission>>): Partial<Record<ToolRisk, Permission>> {
  const out: Partial<Record<ToolRisk, Permission>> = {}
  for (const [key, value] of Object.entries(rd)) {
    if (value !== undefined && value !== 'allow' && isToolRisk(key)) out[key] = value
  }
  return out
}

function riskDefaultsEqual(
  a: Partial<Record<ToolRisk, Permission>>,
  b: Partial<Record<ToolRisk, Permission>>,
): boolean {
  const pa = pruneRiskDefaults(a)
  const pb = pruneRiskDefaults(b)
  const keysA = Object.keys(pa)
  if (keysA.length !== Object.keys(pb).length) return false
  return keysA.every((key) => pa[key as ToolRisk] === pb[key as ToolRisk])
}

/** Build prefs for a preset: writes the risk-default layer and clears domain/tool customization. */
export function applyPreset(preset: ToolPreset): ToolPrefs {
  return { riskDefaults: { ...PRESET_RISK_DEFAULTS[preset] }, domainDefaults: {}, toolOverrides: {} }
}

/** The preset whose state matches prefs exactly, or null ("Custom") if customized / unmatched. */
export function detectActivePreset(prefs: ToolPrefs): ToolPreset | null {
  if (Object.keys(prefs.domainDefaults).length > 0) return null
  if (Object.keys(prefs.toolOverrides).length > 0) return null
  const riskDefaults = prefs.riskDefaults ?? {}
  for (const preset of Object.keys(PRESET_RISK_DEFAULTS) as ToolPreset[]) {
    if (riskDefaultsEqual(riskDefaults, PRESET_RISK_DEFAULTS[preset])) return preset
  }
  return null
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/tools/tool-preferences.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/tool-preferences.ts tests/tools/tool-preferences.test.ts
git commit -m "feat(tools): add permission preset definitions and detection"
```

---

## Task 3: Wire the preset branch into the settings tools route

**Files:**

- Modify: `src/debug/settings/tools-routes.ts`
- Test: `tests/debug/settings/tools-routes.test.ts`

- [ ] **Step 1: Write failing route tests**

Append to `tests/debug/settings/tools-routes.test.ts`. First extend the response schema near the top to expect `activePreset`:

```typescript
const PresetSchema = z.enum(['allow-all', 'non-destructive', 'read-only'])

const DomainsResponseWithPresetSchema = DomainsResponseSchema.extend({
  activePreset: PresetSchema.nullable(),
})
```

Then add tests inside the `describe('settings tools routes', ...)` block:

```typescript
test('GET includes activePreset (allow-all for an untouched context)', async () => {
  const url = new URL('https://x/settings/api/tools')
  const res = await handleToolsRoutes(new Request(url, { headers: authHeaders(session) }), url, '/settings/api/tools')
  expect(res.status).toBe(200)
  const body = DomainsResponseWithPresetSchema.parse(await res.json())
  expect(body.activePreset).toBe('allow-all')
})

test('preset apply persists riskDefaults and returns the active preset', async () => {
  const url = new URL('https://x/settings/api/tools/toggle')
  const res = await handleToolsRoutes(
    new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'preset', preset: 'read-only' }),
    }),
    url,
    '/settings/api/tools/toggle',
  )
  expect(res.status).toBe(200)
  const body = DomainsResponseWithPresetSchema.parse(await res.json())
  expect(body.activePreset).toBe('read-only')
  const prefs = getToolPrefs(personalContextId)
  expect(prefs.riskDefaults).toEqual({ write: 'ask', destructive: 'ask', 'open-world': 'ask' })
  expect(prefs.domainDefaults).toEqual({})
  expect(prefs.toolOverrides).toEqual({})
})

test('preset apply resets prior customization', async () => {
  setToolPrefs(personalContextId, {
    riskDefaults: {},
    domainDefaults: { task: 'deny' },
    toolOverrides: { delete_task: 'deny' },
  })
  const url = new URL('https://x/settings/api/tools/toggle')
  const res = await handleToolsRoutes(
    new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'preset', preset: 'allow-all' }),
    }),
    url,
    '/settings/api/tools/toggle',
  )
  expect(res.status).toBe(200)
  const prefs = getToolPrefs(personalContextId)
  expect(prefs.domainDefaults).toEqual({})
  expect(prefs.toolOverrides).toEqual({})
  expect(prefs.riskDefaults).toEqual({})
})

test('preset apply with unknown preset is 422', async () => {
  const url = new URL('https://x/settings/api/tools/toggle')
  const res = await handleToolsRoutes(
    new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'preset', preset: 'nonsense' }),
    }),
    url,
    '/settings/api/tools/toggle',
  )
  expect(res.status).toBe(422)
})

test('preset apply without CSRF is 403', async () => {
  const url = new URL('https://x/settings/api/tools/toggle')
  const res = await handleToolsRoutes(
    new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'preset', preset: 'read-only' }),
    }),
    url,
    '/settings/api/tools/toggle',
  )
  expect(res.status).toBe(403)
})
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `bun test tests/debug/settings/tools-routes.test.ts`
Expected: FAIL — `activePreset` missing from responses; `kind: 'preset'` rejected by the current schema (422 for the unknown-preset case may pass coincidentally, but the apply/active-preset cases fail).

- [ ] **Step 3: Implement the route changes in `src/debug/settings/tools-routes.ts`**

Extend the imports from `tool-preferences.js`:

```typescript
import {
  applyPreset,
  detectActivePreset,
  getDomainSummary,
  getToolPrefs,
  resolveToolPermission,
  setToolPrefs,
  type Permission,
  type ToolPrefs,
} from '../../tools/tool-preferences.js'
```

Make the two local helpers carry `riskDefaults` through and use a risk-aware baseline. Replace `setDomainPermission`'s return:

```typescript
return { riskDefaults: prefs.riskDefaults ?? {}, domainDefaults: prunedDomainDefaults, toolOverrides }
```

Replace `setToolPermission` so the baseline and the returned object are risk-aware:

```typescript
function setToolPermission(prefs: ToolPrefs, toolName: string, permission: Permission): ToolPrefs {
  const meta = getToolMetadata(toolName)
  const baseline: Permission =
    meta === undefined
      ? 'allow'
      : (prefs.domainDefaults[meta.domain] ?? (prefs.riskDefaults ?? {})[meta.risk] ?? 'allow')
  const toolOverrides: Record<string, Permission> = {}
  for (const [name, value] of Object.entries(prefs.toolOverrides)) {
    if (name !== toolName) toolOverrides[name] = value
  }
  if (permission !== baseline) toolOverrides[toolName] = permission
  return { riskDefaults: prefs.riskDefaults ?? {}, domainDefaults: { ...prefs.domainDefaults }, toolOverrides }
}
```

Replace `ToggleBodySchema` with a discriminated union (keeps `permission` required for domain/tool, so existing "missing permission → 422" behavior is preserved):

```typescript
const ToggleBodySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('domain'),
    permission: z.enum(['allow', 'ask', 'deny']),
    domain: z.string(),
    contextId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('tool'),
    permission: z.enum(['allow', 'ask', 'deny']),
    tool: z.string(),
    contextId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('preset'),
    preset: z.enum(['allow-all', 'non-destructive', 'read-only']),
    contextId: z.string().optional(),
  }),
])
```

Replace the dispatch block in `handleToggle` (the `if (body.data.kind === 'domain') { ... } else { ... }` section) with:

```typescript
if (body.data.kind === 'domain') {
  const domain = body.data.domain
  if (!isToolDomain(domain)) return settingsJson(422, { error: 'unknown tool domain' })
  setToolPrefs(scope.scope.contextId, setDomainPermission(prefs, domain, body.data.permission))
  log.info(
    { contextId: scope.scope.contextId, domain, permission: body.data.permission },
    'Settings tool domain permission set',
  )
} else if (body.data.kind === 'tool') {
  const toolName = body.data.tool
  const meta = getToolMetadata(toolName)
  if (meta === undefined || !names.includes(toolName)) return settingsJson(422, { error: 'unknown tool' })
  setToolPrefs(scope.scope.contextId, setToolPermission(prefs, toolName, body.data.permission))
  log.info(
    { contextId: scope.scope.contextId, tool: toolName, permission: body.data.permission },
    'Settings tool permission set',
  )
} else {
  setToolPrefs(scope.scope.contextId, applyPreset(body.data.preset))
  log.info({ contextId: scope.scope.contextId, preset: body.data.preset }, 'Settings tool preset applied')
}
```

Update both responses to include `activePreset`. In `handleToggle`:

```typescript
const updated = getToolPrefs(scope.scope.contextId)
return settingsJson(200, {
  contextId: scope.scope.contextId,
  domains: buildDomainView(names, updated),
  activePreset: detectActivePreset(updated),
})
```

In `handleGet`:

```typescript
const prefs = getToolPrefs(scope.scope.contextId)
return settingsJson(200, {
  contextId: scope.scope.contextId,
  domains: buildDomainView(names, prefs),
  activePreset: detectActivePreset(prefs),
})
```

- [ ] **Step 4: Run the route tests to verify they pass**

Run: `bun test tests/debug/settings/tools-routes.test.ts`
Expected: PASS (existing + new). The existing `DomainsResponseSchema.parse(...)` calls still pass because Zod strips the extra `activePreset` key.

- [ ] **Step 5: Commit**

```bash
git add src/debug/settings/tools-routes.ts tests/debug/settings/tools-routes.test.ts
git commit -m "feat(settings): add preset branch + activePreset to tools route"
```

---

## Task 4: Add the client schema and fetcher for presets

**Files:**

- Modify: `client/settings/fetcher-schemas.ts`
- Modify: `client/settings/fetchers.ts`
- Test: `tests/client/settings/sections/ToolsSection.test.ts` (covered in Task 5; this task is typecheck-gated)

- [ ] **Step 1: Add the schema in `client/settings/fetcher-schemas.ts`**

In the `// --- Tools ---` section, add the preset enum and extend the response schema. `activePreset` uses `.nullable().default(null)` so existing mock payloads that omit it still parse:

```typescript
export const ToolPresetSchema = z.enum(['allow-all', 'non-destructive', 'read-only'])
export type ToolPreset = z.infer<typeof ToolPresetSchema>
```

Replace `ToolsResponseSchema`:

```typescript
export const ToolsResponseSchema = z.object({
  contextId: z.string(),
  domains: z.array(ToolDomainSchema),
  activePreset: ToolPresetSchema.nullable().default(null),
})
```

- [ ] **Step 2: Add the fetcher in `client/settings/fetchers.ts`**

Add `ToolPreset` to the type imports from `./fetcher-schemas.js`, then add below `setToolPermission`:

```typescript
export const applyToolPreset = (input: { preset: ToolPreset; contextId: string }): Promise<ToolsResponse> =>
  writeJson('/settings/api/tools/toggle', 'POST', { kind: 'preset', ...input }, (b) => ToolsResponseSchema.parse(b))
```

- [ ] **Step 3: Typecheck**

Run: `bun typecheck`
Expected: PASS (no type errors from the new exports/usages).

- [ ] **Step 4: Commit**

```bash
git add client/settings/fetcher-schemas.ts client/settings/fetchers.ts
git commit -m "feat(settings-client): add tool preset schema and fetcher"
```

---

## Task 5: Render the preset bar in ToolsSection

**Files:**

- Modify: `client/settings/sections/ToolsSection.svelte`
- Test: `tests/client/settings/sections/ToolsSection.test.ts`

- [ ] **Step 1: Write failing client tests**

Append to `tests/client/settings/sections/ToolsSection.test.ts`. First add an `activePreset` to the shared payload object and a preset-capable toggle body schema near the top:

Change `toolsPayload` to include `activePreset`:

```typescript
const toolsPayload = {
  contextId: 'user:1',
  activePreset: 'allow-all',
  domains: [
    {
      domain: 'task',
      summary: 'partial',
      tools: [
        { name: 'create_task', permission: 'allow', risk: 'write' },
        { name: 'delete_task', permission: 'deny', risk: 'destructive' },
      ],
    },
  ],
}
```

Extend `ToggleBodySchema` to allow the preset kind:

```typescript
const ToggleBodySchema = z.union([
  z.object({ kind: z.literal('tool'), tool: z.string(), permission: z.string(), contextId: z.string() }),
  z.object({ kind: z.literal('domain'), domain: z.string(), permission: z.string(), contextId: z.string() }),
  z.object({ kind: z.literal('preset'), preset: z.string(), contextId: z.string() }),
])
```

Then add the tests:

```typescript
test('renders the preset bar with the active preset highlighted', async () => {
  setMockFetch(() => Promise.resolve(json(toolsPayload)))
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(ToolsSection, { target, props: { contextId: 'user:1' } })
  await drain()
  expect(target.querySelector('[data-testid="tools-presets"]')).not.toBeNull()
  expect(target.querySelector('[data-testid="preset-read-only"]')).not.toBeNull()
  expect(target.querySelector('[data-testid="preset-active"]')!.textContent).toContain('Allow all')
  void unmount(component)
})

test('applying a preset requires confirmation then posts kind=preset', async () => {
  setCsrfToken('c')
  setMockFetch(captureToggleMock)
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(ToolsSection, { target, props: { contextId: 'user:1' } })
  await drain()
  // Clicking the preset surfaces a confirm row, not an immediate POST.
  target.querySelector<HTMLButtonElement>('[data-testid="preset-read-only"]')!.click()
  flushSync()
  expect(capturedBody).toBeNull()
  expect(target.querySelector('[data-testid="preset-confirm"]')).not.toBeNull()
  // Confirming POSTs the preset.
  target.querySelector<HTMLButtonElement>('[data-testid="preset-confirm-apply"]')!.click()
  await drain()
  const parsed = ToggleBodySchema.parse(capturedBody)
  expect(parsed.kind).toBe('preset')
  if (parsed.kind === 'preset') expect(parsed.preset).toBe('read-only')
  expect(parsed.contextId).toBe('user:1')
  void unmount(component)
})

test('cancelling the confirm does not post', async () => {
  setCsrfToken('c')
  setMockFetch(captureToggleMock)
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(ToolsSection, { target, props: { contextId: 'user:1' } })
  await drain()
  target.querySelector<HTMLButtonElement>('[data-testid="preset-read-only"]')!.click()
  flushSync()
  target.querySelector<HTMLButtonElement>('[data-testid="preset-confirm-cancel"]')!.click()
  flushSync()
  expect(capturedBody).toBeNull()
  expect(target.querySelector('[data-testid="preset-confirm"]')).toBeNull()
  void unmount(component)
})

test('shows Custom when activePreset is null', async () => {
  setMockFetch(() => Promise.resolve(json({ ...toolsPayload, activePreset: null })))
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(ToolsSection, { target, props: { contextId: 'user:1' } })
  await drain()
  expect(target.querySelector('[data-testid="preset-active"]')!.textContent).toContain('Custom')
  void unmount(component)
})
```

- [ ] **Step 2: Run the new client tests to verify they fail**

Run: `bun test:client tests/client/settings/sections/ToolsSection.test.ts`
Expected: FAIL — no `tools-presets` / `preset-*` elements exist yet.

- [ ] **Step 3: Implement the preset bar in `client/settings/sections/ToolsSection.svelte`**

Update the imports/types: add `ToolPreset` to the type import and `applyToolPreset` to the fetcher import:

```typescript
import type { ToolDomainSummary, ToolDomainView, ToolPermission, ToolPreset, ToolRisk } from '../fetcher-schemas.js'
import { applyToolPreset, fetchTools, setToolPermission } from '../fetchers.js'
```

Add preset metadata and state after `PERM_OPTIONS`:

```typescript
const PRESET_OPTIONS = [
  { value: 'read-only', label: 'Read-only' },
  { value: 'non-destructive', label: 'Non-destructive' },
  { value: 'allow-all', label: 'Allow all' },
] as const

const presetLabel = (preset: ToolPreset): string => PRESET_OPTIONS.find((p) => p.value === preset)?.label ?? preset
```

Add the reactive state next to the existing `let domains`:

```typescript
let activePreset: ToolPreset | null = $state(null)
let pendingPreset: ToolPreset | null = $state(null)
```

Set `activePreset` in `load` (replace the `domains = ...` line in the `try`):

```typescript
    try {
      const res = await fetchTools(id)
      domains = res.domains
      activePreset = res.activePreset
    } catch (err) {
```

Add the preset handlers below `onSetToolPermission`:

```typescript
function requestPreset(preset: ToolPreset): void {
  error = null
  pendingPreset = preset
}

async function confirmPreset(): Promise<void> {
  const preset = pendingPreset
  if (preset === null) return
  pendingPreset = null
  error = null
  try {
    const res = await applyToolPreset({ preset, contextId })
    domains = res.domains
    activePreset = res.activePreset
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }
}
```

Add the markup immediately after the `{#if error !== null}...{/if}` block and before `{#if domains.length > 0}`:

```svelte
  <div class="settings-tools__presets" data-testid="tools-presets">
    <span class="settings-tools__presets-label">Preset</span>
    {#each PRESET_OPTIONS as preset (preset.value)}
      <Btn
        variant={activePreset === preset.value ? 'primary' : 'ghost'}
        size="sm"
        testid={`preset-${preset.value}`}
        onClick={() => requestPreset(preset.value)}>
        {#snippet children()}{preset.label}{/snippet}
      </Btn>
    {/each}
    <span class="settings-tools__presets-active" data-testid="preset-active">
      <Pill tone="mute">{#snippet children()}{activePreset === null ? 'Custom' : presetLabel(activePreset)}{/snippet}</Pill>
    </span>
  </div>
  <p class="settings-tools__presets-hint">New tools follow the selected preset by their risk level.</p>

  {#if pendingPreset !== null}
    <div class="settings-tools__confirm" data-testid="preset-confirm">
      <span>Apply “{presetLabel(pendingPreset)}”? This replaces your per-tool and per-domain settings.</span>
      <Btn variant="primary" size="sm" testid="preset-confirm-apply" onClick={() => void confirmPreset()}>
        {#snippet children()}Apply{/snippet}
      </Btn>
      <Btn variant="ghost" size="sm" testid="preset-confirm-cancel" onClick={() => (pendingPreset = null)}>
        {#snippet children()}Cancel{/snippet}
      </Btn>
    </div>
  {/if}
```

Add styles inside the `<style>` block:

```css
.settings-tools__presets {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}
.settings-tools__presets-label {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg2);
}
.settings-tools__presets-active {
  margin-left: auto;
}
.settings-tools__presets-hint {
  margin: 0 0 12px;
  font-size: 11px;
  color: var(--fg3);
}
.settings-tools__confirm {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 10px;
  margin-bottom: 12px;
  border: 1px solid var(--border);
  background: var(--surface);
  font-size: 12px;
}
```

- [ ] **Step 4: Run the client tests to verify they pass**

Run: `bun test:client tests/client/settings/sections/ToolsSection.test.ts`
Expected: PASS (existing + new).

- [ ] **Step 5: Commit**

```bash
git add client/settings/sections/ToolsSection.svelte tests/client/settings/sections/ToolsSection.test.ts
git commit -m "feat(settings-ui): add permission preset bar to Tools section"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Build the client bundles**

Run: `bun build:client`
Expected: builds `client/{debug,admin,settings}/` into `public/` without errors.

- [ ] **Step 2: Run the server-side suite**

Run: `bun run test`
Expected: PASS. Watch the tool-preferences and tools-routes suites in particular.

- [ ] **Step 3: Run the client suite**

Run: `bun test:client`
Expected: PASS, including the ToolsSection tests.

- [ ] **Step 4: Lint, typecheck, format**

Run: `bun check:full`
Expected: PASS (lint, typecheck, format, license headers).

- [ ] **Step 5: Commit any formatting fixups**

```bash
git add -A
git commit -m "chore: format and lint fixups for tool permission presets" || echo "nothing to commit"
```

---

## Self-Review Notes (author checklist — performed)

- **Spec coverage:** model tier (Task 1), preset definitions + reset-to-baseline + detection (Task 2), API `kind: 'preset'` + `activePreset` in GET/toggle (Task 3), client schema/fetcher (Task 4), preset bar + active/Custom indicator + confirm + sticky helper line (Task 5). Open-world → `ask` under read-only is encoded directly in `PRESET_RISK_DEFAULTS` and asserted in Task 1/Task 2 tests.
- **Type consistency:** `applyPreset(preset)`, `detectActivePreset(prefs)`, `PRESET_RISK_DEFAULTS`, `ToolPreset` used identically in src + tests; client `ToolPresetSchema`/`ToolPreset` and `applyToolPreset` align with the route's `kind: 'preset'` body. `riskDefaults` is optional everywhere and read via `?? {}`.
- **No placeholders:** every code step contains full code and exact run commands with expected outcomes.
- **Behavior-preservation risks addressed:** the discriminated-union schema keeps `permission` required for `domain`/`tool` (existing "missing permission → 422" test stays green); `activePreset` added as a strip-tolerated extra key for server tests and `.nullable().default(null)` on the client so existing payloads parse; existing tool-preferences equality literals updated for the always-present `riskDefaults: {}`.
  </content>
