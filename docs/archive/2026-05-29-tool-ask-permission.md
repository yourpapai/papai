<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tool `ask` Permission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third per-tool permission state, `ask`, alongside the existing `allow`/`deny`, so that tools marked `ask` are exposed to the LLM but each call is gated behind a synchronous inline Allow/Deny button prompt before execution.

**Architecture:** Per-tool execute wrapping. `tool_prefs` becomes tri-state with lazy migration. `applyToolPreferences()` in `src/tools/index.ts` wraps each `ask` tool's `execute` with a gate that posts an inline-button prompt via an injected `askPermission` callback, awaits the user's click (or a 5-min timeout), then either runs the original execute or returns a `permission_denied` tool result. The chat layer holds the pending-request registry and the new `perm:` callback handler. The orchestrator builds the `askPermission` closure per turn and threads it through `makeTools()`.

**Tech Stack:** Bun, TypeScript (strict), Zod v4, Vercel AI SDK `ToolSet`/`tool()`, pino logging. Conventions per `CLAUDE.md`, `src/tools/CLAUDE.md`, `src/chat/CLAUDE.md`, `tests/CLAUDE.md`.

**Spec:** `docs/superpowers/specs/2026-05-29-tool-ask-permission-design.md`.

---

## File Map

**Created:**

- `src/tools/permission-gate.ts` — `gatedExecute`, `buildPermissionDenied`, `extendSchemaForAsk`
- `src/chat/permission-prompt.ts` — pending-request registry + `askPermissionViaChat`
- `src/chat/permission-interaction-handler.ts` — `handlePermissionInteraction`
- `tests/tools/permission-gate.test.ts`
- `tests/chat/permission-prompt.test.ts`
- `tests/chat/permission-interaction-handler.test.ts`

**Modified:**

- `src/tools/tool-preferences.ts` — tri-state `ToolPrefs`, legacy migration, `cycleDomain`/`cycleTool`, `resolveToolPermission`, `getDomainSummary`
- `src/tools/types.ts` — `MakeToolsOptions.askPermission`
- `src/tools/index.ts` — split into descriptor-build vs. permission-apply; integrate the gate
- `src/llm-orchestrator-tools.ts` — accept `askPermission`, cache pre-permission descriptors
- `src/llm-orchestrator.ts` — build `askPermission` closure in `callLlm`, pass through
- `src/chat/interaction-router.ts` — route `perm:` callbacks
- `src/system-prompt.ts` — `ask`-tools fragment
- `src/commands/tool-config-view.ts` — 3-state markers, External pseudo-domain, footer
- `src/chat/tool-toggle-interaction-handler.ts` — call cycle functions
- `src/commands/config.ts` — Tools summary counts blocked + ask
- `tests/tools/tool-preferences.test.ts`
- `tests/tools/index.test.ts`
- `tests/chat/interaction-router.test.ts`
- `tests/system-prompt.test.ts`
- `tests/commands/tool-config-view.test.ts`
- `tests/commands/config.test.ts`

---

## Phase 1 — Storage tri-state foundation

The whole feature rests on `ToolPrefs` being tri-state, with lazy migration so existing blobs keep working. Tests drive the parser, resolver, pruning, and cycling before anything else moves.

### Task 1.1: Failing test for `resolveToolPermission` defaults and override precedence

**Files:**

- Modify: `tests/tools/tool-preferences.test.ts`

- [ ] **Step 1: Append the failing test block**

Append this `describe` block at the end of `tests/tools/tool-preferences.test.ts`:

```ts
import { resolveToolPermission, type ToolPrefs } from '../../src/tools/tool-preferences.js'

describe('resolveToolPermission', () => {
  test('returns "allow" when nothing is set (default)', () => {
    const prefs: ToolPrefs = { domainDefaults: {}, toolOverrides: {} }
    expect(resolveToolPermission(prefs, 'create_task')).toBe('allow')
  })

  test('uses domain default when no override', () => {
    const prefs: ToolPrefs = { domainDefaults: { task: 'ask' }, toolOverrides: {} }
    expect(resolveToolPermission(prefs, 'create_task')).toBe('ask')
  })

  test('per-tool override wins over domain default', () => {
    const prefs: ToolPrefs = { domainDefaults: { task: 'deny' }, toolOverrides: { create_task: 'allow' } }
    expect(resolveToolPermission(prefs, 'create_task')).toBe('allow')
  })

  test('unclassified tool (no metadata) ignores domainDefaults', () => {
    const prefs: ToolPrefs = { domainDefaults: { task: 'deny' }, toolOverrides: {} }
    expect(resolveToolPermission(prefs, 'plugin_foo__bar')).toBe('allow')
  })

  test('unclassified tool honours its own override', () => {
    const prefs: ToolPrefs = { domainDefaults: {}, toolOverrides: { plugin_foo__bar: 'deny' } }
    expect(resolveToolPermission(prefs, 'plugin_foo__bar')).toBe('deny')
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
bun test tests/tools/tool-preferences.test.ts -t 'resolveToolPermission'
```

Expected: fails at import — `resolveToolPermission`/`ToolPrefs` shape mismatch.

- [ ] **Step 3: Update `ToolPrefs` shape and add `resolveToolPermission`**

Replace `ToolPrefs`, `emptyPrefs`, and add `resolveToolPermission` in `src/tools/tool-preferences.ts`:

```ts
export type Permission = 'allow' | 'ask' | 'deny'

export interface ToolPrefs {
  /** Per-domain default permission. Missing entry = 'allow'. */
  domainDefaults: Partial<Record<ToolDomain, Permission>>
  /** Per-tool override that wins over the domain default. */
  toolOverrides: Record<string, Permission>
}

function emptyPrefs(): ToolPrefs {
  return { domainDefaults: {}, toolOverrides: {} }
}

const PERMISSIONS: ReadonlySet<Permission> = new Set(['allow', 'ask', 'deny'])

function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && PERMISSIONS.has(value as Permission)
}

export function resolveToolPermission(prefs: ToolPrefs, toolName: string): Permission {
  const override = prefs.toolOverrides[toolName]
  if (override !== undefined) return override
  const meta = getToolMetadata(toolName)
  if (meta === undefined) return 'allow'
  return prefs.domainDefaults[meta.domain] ?? 'allow'
}
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
bun test tests/tools/tool-preferences.test.ts -t 'resolveToolPermission'
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/tool-preferences.ts tests/tools/tool-preferences.test.ts
git commit -m "feat(tools): add resolveToolPermission for tri-state ToolPrefs"
```

### Task 1.2: Failing test for legacy `tool_prefs` migration

**Files:**

- Modify: `tests/tools/tool-preferences.test.ts`

- [ ] **Step 1: Add the migration test block**

Append to `tests/tools/tool-preferences.test.ts`:

```ts
describe('parseToolPrefs legacy migration', () => {
  test('legacy disabledDomains → domainDefaults deny', () => {
    const legacy = JSON.stringify({ disabledDomains: ['task', 'project'], toolOverrides: {} })
    const prefs = parseToolPrefs(legacy)
    expect(prefs.domainDefaults).toEqual({ task: 'deny', project: 'deny' })
    expect(prefs.toolOverrides).toEqual({})
  })

  test('legacy boolean overrides map to allow/deny', () => {
    const legacy = JSON.stringify({ disabledDomains: [], toolOverrides: { create_task: true, delete_task: false } })
    const prefs = parseToolPrefs(legacy)
    expect(prefs.toolOverrides).toEqual({ create_task: 'allow', delete_task: 'deny' })
  })

  test('new-shape strings pass through', () => {
    const fresh = JSON.stringify({
      domainDefaults: { task: 'ask' },
      toolOverrides: { delete_task: 'deny' },
    })
    const prefs = parseToolPrefs(fresh)
    expect(prefs.domainDefaults).toEqual({ task: 'ask' })
    expect(prefs.toolOverrides).toEqual({ delete_task: 'deny' })
  })

  test('unknown permission string → dropped', () => {
    const garbage = JSON.stringify({ domainDefaults: { task: 'maybe' }, toolOverrides: { x: 'sometimes' } })
    const prefs = parseToolPrefs(garbage)
    expect(prefs).toEqual({ domainDefaults: {}, toolOverrides: {} })
  })

  test('null or empty input → empty prefs', () => {
    expect(parseToolPrefs(null)).toEqual({ domainDefaults: {}, toolOverrides: {} })
    expect(parseToolPrefs('')).toEqual({ domainDefaults: {}, toolOverrides: {} })
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

```bash
bun test tests/tools/tool-preferences.test.ts -t 'parseToolPrefs legacy migration'
```

Expected: FAIL (parser still returns the legacy boolean shape).

- [ ] **Step 3: Rewrite `parseToolPrefs`**

Replace `parseToolPrefs` in `src/tools/tool-preferences.ts`:

```ts
const DOMAIN_SET: ReadonlySet<string> = new Set(Object.values(TOOL_METADATA).map((m) => m.domain))

function isDomain(value: unknown): value is ToolDomain {
  return typeof value === 'string' && DOMAIN_SET.has(value)
}

function parseDomainDefaults(parsed: Record<string, unknown>): Partial<Record<ToolDomain, Permission>> {
  const out: Partial<Record<ToolDomain, Permission>> = {}
  // New-shape: domainDefaults: { task: 'ask' }
  const newShape = parsed['domainDefaults']
  if (isPlainObject(newShape)) {
    for (const [key, value] of Object.entries(newShape)) {
      if (isDomain(key) && isPermission(value)) out[key] = value
    }
  }
  // Legacy: disabledDomains: ['task']  → domainDefaults: { task: 'deny' }
  const legacy = parsed['disabledDomains']
  if (Array.isArray(legacy)) {
    for (const value of legacy) {
      if (isDomain(value)) out[value] = 'deny'
    }
  }
  return out
}

function parseToolOverrides(parsed: Record<string, unknown>): Record<string, Permission> {
  const out: Record<string, Permission> = {}
  const overridesRaw = parsed['toolOverrides']
  if (!isPlainObject(overridesRaw)) return out
  for (const [name, value] of Object.entries(overridesRaw)) {
    if (isPermission(value)) {
      out[name] = value
    } else if (value === true) {
      out[name] = 'allow'
    } else if (value === false) {
      out[name] = 'deny'
    }
  }
  return out
}

export function parseToolPrefs(raw: string | null): ToolPrefs {
  if (raw === null || raw.trim() === '') return emptyPrefs()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isPlainObject(parsed)) return emptyPrefs()
    return {
      domainDefaults: parseDomainDefaults(parsed),
      toolOverrides: parseToolOverrides(parsed),
    }
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Corrupt tool_prefs; using empty prefs')
    return emptyPrefs()
  }
}
```

Required imports already exist (`TOOL_METADATA`, `ToolDomain`, `getToolMetadata`); `TOOL_METADATA` may need to be added to the existing tool-metadata import:

```ts
import { getToolMetadata, TOOL_METADATA, type ToolDomain } from './tool-metadata.js'
```

- [ ] **Step 4: Run and confirm tests pass**

```bash
bun test tests/tools/tool-preferences.test.ts -t 'parseToolPrefs legacy migration'
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/tool-preferences.ts tests/tools/tool-preferences.test.ts
git commit -m "feat(tools): lazy migration of legacy tool_prefs to tri-state"
```

### Task 1.3: Replace `serializeToolPrefs`, drop `isToolEnabled`, update `partitionToolNames`

**Files:**

- Modify: `src/tools/tool-preferences.ts`
- Modify: `tests/tools/tool-preferences.test.ts`

- [ ] **Step 1: Write failing test for new-shape serialize round-trip**

Append:

```ts
describe('serializeToolPrefs new shape', () => {
  test('round-trips through parse/serialize', () => {
    const prefs: ToolPrefs = {
      domainDefaults: { task: 'ask', project: 'deny' },
      toolOverrides: { delete_task: 'allow' },
    }
    const round = parseToolPrefs(serializeToolPrefs(prefs))
    expect(round).toEqual(prefs)
  })
})

describe('partitionToolNames', () => {
  test('separates deny from allow/ask', () => {
    const prefs: ToolPrefs = { domainDefaults: {}, toolOverrides: { delete_task: 'deny', create_task: 'ask' } }
    const { exposed, denied } = partitionToolNames(prefs, ['create_task', 'delete_task', 'list_tasks'])
    expect(exposed).toEqual(new Set(['create_task', 'list_tasks']))
    expect(denied).toEqual(new Set(['delete_task']))
  })
})
```

- [ ] **Step 2: Run and confirm failure**

```bash
bun test tests/tools/tool-preferences.test.ts -t 'serializeToolPrefs new shape'
bun test tests/tools/tool-preferences.test.ts -t 'partitionToolNames'
```

Expected: FAIL — `partitionToolNames` currently returns `{ enabled, disabled }`.

- [ ] **Step 3: Update `serializeToolPrefs` and `partitionToolNames`; delete `isToolEnabled`**

In `src/tools/tool-preferences.ts`:

```ts
export function serializeToolPrefs(prefs: ToolPrefs): string {
  return JSON.stringify({
    domainDefaults: prefs.domainDefaults,
    toolOverrides: prefs.toolOverrides,
  })
}

export function partitionToolNames(
  prefs: ToolPrefs,
  names: readonly string[],
): { exposed: Set<string>; denied: Set<string> } {
  const exposed = new Set<string>()
  const denied = new Set<string>()
  for (const name of names) {
    if (resolveToolPermission(prefs, name) === 'deny') denied.add(name)
    else exposed.add(name)
  }
  return { exposed, denied }
}
```

Delete the old `isToolEnabled` export. Search for callers:

```bash
grep -rn "isToolEnabled\|partitionToolNames" src/ tests/
```

Expected callers: `src/tools/index.ts`, `src/commands/tool-config-view.ts`, `src/chat/tool-toggle-interaction-handler.ts`, the tests. They'll fail typechecking — Tasks 1.4 / 3.x / 7.x fix them.

- [ ] **Step 4: Run targeted test, confirm it passes**

```bash
bun test tests/tools/tool-preferences.test.ts -t 'serializeToolPrefs new shape'
bun test tests/tools/tool-preferences.test.ts -t 'partitionToolNames'
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/tool-preferences.ts tests/tools/tool-preferences.test.ts
git commit -m "refactor(tools): tri-state partitionToolNames; drop isToolEnabled"
```

### Task 1.4: `pruneRedundantOverrides`, `cycleDomain`, `cycleTool`, `getDomainSummary`

**Files:**

- Modify: `src/tools/tool-preferences.ts`
- Modify: `tests/tools/tool-preferences.test.ts`

- [ ] **Step 1: Write failing tests**

Append:

```ts
import { cycleDomain, cycleTool, getDomainSummary } from '../../src/tools/tool-preferences.js'

describe('cycleTool', () => {
  test('cycles allow → ask → deny → allow', () => {
    let prefs: ToolPrefs = { domainDefaults: {}, toolOverrides: {} }
    prefs = cycleTool(prefs, 'create_task') // allow → ask
    expect(resolveToolPermission(prefs, 'create_task')).toBe('ask')
    prefs = cycleTool(prefs, 'create_task') // ask → deny
    expect(resolveToolPermission(prefs, 'create_task')).toBe('deny')
    prefs = cycleTool(prefs, 'create_task') // deny → allow
    expect(resolveToolPermission(prefs, 'create_task')).toBe('allow')
  })

  test('prunes override when it matches the domain default', () => {
    let prefs: ToolPrefs = { domainDefaults: { task: 'ask' }, toolOverrides: { create_task: 'deny' } }
    prefs = cycleTool(prefs, 'create_task') // deny → allow (override stays; differs from default 'ask')
    expect(prefs.toolOverrides['create_task']).toBe('allow')
    prefs = cycleTool(prefs, 'create_task') // allow → ask (matches domain default → pruned)
    expect(prefs.toolOverrides['create_task']).toBeUndefined()
    expect(resolveToolPermission(prefs, 'create_task')).toBe('ask')
  })
})

describe('cycleDomain', () => {
  test('cycles domain default and clears per-tool overrides in that domain', () => {
    let prefs: ToolPrefs = {
      domainDefaults: { task: 'allow' },
      toolOverrides: { create_task: 'deny', save_memo: 'deny' },
    }
    prefs = cycleDomain(prefs, 'task', ['create_task', 'delete_task'])
    expect(prefs.domainDefaults['task']).toBe('ask')
    expect(prefs.toolOverrides['create_task']).toBeUndefined() // cleared
    expect(prefs.toolOverrides['save_memo']).toBe('deny') // untouched (different domain)
  })

  test('cycles allow → ask → deny → allow on the domain itself', () => {
    let prefs: ToolPrefs = { domainDefaults: {}, toolOverrides: {} }
    prefs = cycleDomain(prefs, 'task', [])
    expect(prefs.domainDefaults['task']).toBe('ask')
    prefs = cycleDomain(prefs, 'task', [])
    expect(prefs.domainDefaults['task']).toBe('deny')
    prefs = cycleDomain(prefs, 'task', [])
    expect(prefs.domainDefaults['task']).toBeUndefined() // pruned when returning to 'allow' default
  })
})

describe('getDomainSummary', () => {
  test('returns allow/ask/deny when all tools share the same permission', () => {
    const prefs: ToolPrefs = { domainDefaults: { task: 'ask' }, toolOverrides: {} }
    expect(getDomainSummary(prefs, 'task', ['create_task', 'delete_task'])).toBe('ask')
  })

  test('returns partial when tools disagree', () => {
    const prefs: ToolPrefs = {
      domainDefaults: { task: 'allow' },
      toolOverrides: { delete_task: 'deny' },
    }
    expect(getDomainSummary(prefs, 'task', ['create_task', 'delete_task'])).toBe('partial')
  })

  test('falls back to the domain default when name list is empty', () => {
    const prefs: ToolPrefs = { domainDefaults: { task: 'deny' }, toolOverrides: {} }
    expect(getDomainSummary(prefs, 'task', [])).toBe('deny')
  })
})
```

- [ ] **Step 2: Run and confirm failure**

```bash
bun test tests/tools/tool-preferences.test.ts -t 'cycleTool'
bun test tests/tools/tool-preferences.test.ts -t 'cycleDomain'
bun test tests/tools/tool-preferences.test.ts -t 'getDomainSummary'
```

Expected: FAIL (functions not exported).

- [ ] **Step 3: Implement cycling and summary; replace old toggle functions**

In `src/tools/tool-preferences.ts`, delete `toggleDomain`, `toggleTool`, `getDomainStatus`, and the old `pruneRedundantOverrides`, replace with:

```ts
const CYCLE_ORDER: readonly Permission[] = ['allow', 'ask', 'deny']

function nextPermission(current: Permission): Permission {
  const index = CYCLE_ORDER.indexOf(current)
  return CYCLE_ORDER[(index + 1) % CYCLE_ORDER.length] ?? 'allow'
}

function domainDefault(prefs: ToolPrefs, domain: ToolDomain): Permission {
  return prefs.domainDefaults[domain] ?? 'allow'
}

function pruneRedundantOverrides(prefs: ToolPrefs): ToolPrefs {
  const toolOverrides: Record<string, Permission> = {}
  for (const [name, value] of Object.entries(prefs.toolOverrides)) {
    const meta = getToolMetadata(name)
    const def: Permission = meta === undefined ? 'allow' : domainDefault(prefs, meta.domain)
    if (value !== def) toolOverrides[name] = value
  }
  return { domainDefaults: { ...prefs.domainDefaults }, toolOverrides }
}

function pruneRedundantDomainDefaults(prefs: ToolPrefs): ToolPrefs {
  const domainDefaults: Partial<Record<ToolDomain, Permission>> = {}
  for (const [domain, value] of Object.entries(prefs.domainDefaults)) {
    if (value !== 'allow') domainDefaults[domain as ToolDomain] = value
  }
  return { domainDefaults, toolOverrides: prefs.toolOverrides }
}

export type DomainSummary = 'allow' | 'ask' | 'deny' | 'partial'

export function getDomainSummary(
  prefs: ToolPrefs,
  domain: ToolDomain,
  domainToolNames: readonly string[],
): DomainSummary {
  if (domainToolNames.length === 0) return domainDefault(prefs, domain)
  const set = new Set(domainToolNames.map((name) => resolveToolPermission(prefs, name)))
  if (set.size === 1) {
    const only = [...set][0]
    if (only !== undefined) return only
  }
  return 'partial'
}

export function cycleDomain(prefs: ToolPrefs, domain: ToolDomain, domainToolNames: readonly string[]): ToolPrefs {
  const current = getDomainSummary(prefs, domain, domainToolNames)
  const base: Permission = current === 'partial' ? 'allow' : current
  const next = nextPermission(base)
  const domainDefaults = { ...prefs.domainDefaults, [domain]: next }
  // Clear any per-tool override inside the domain so the bulk action wins cleanly.
  const toolOverrides: Record<string, Permission> = {}
  for (const [name, value] of Object.entries(prefs.toolOverrides)) {
    const meta = getToolMetadata(name)
    if (meta !== undefined && meta.domain === domain) continue
    toolOverrides[name] = value
  }
  return pruneRedundantDomainDefaults(pruneRedundantOverrides({ domainDefaults, toolOverrides }))
}

export function cycleTool(prefs: ToolPrefs, toolName: string): ToolPrefs {
  const current = resolveToolPermission(prefs, toolName)
  const next = nextPermission(current)
  const toolOverrides = { ...prefs.toolOverrides, [toolName]: next }
  return pruneRedundantOverrides({ domainDefaults: { ...prefs.domainDefaults }, toolOverrides })
}
```

The signature of `cycleTool` drops `_domainToolNames` (was unused). Update call sites in Task 7.

- [ ] **Step 4: Run and confirm tests pass**

```bash
bun test tests/tools/tool-preferences.test.ts
```

Expected: PASS for all `tool-preferences` tests.

- [ ] **Step 5: Commit**

```bash
git add src/tools/tool-preferences.ts tests/tools/tool-preferences.test.ts
git commit -m "feat(tools): tri-state cycle + domain summary in ToolPrefs"
```

---

## Phase 2 — Permission gate module

A pure module that wraps a single tool's `execute` with the permission check, extends its input schema, and produces the structured failure shape. No chat/orchestrator dependencies — those are injected.

### Task 2.1: `buildPermissionDenied` + `permission_denied` shape

**Files:**

- Create: `src/tools/permission-gate.ts`
- Create: `tests/tools/permission-gate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/tools/permission-gate.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildPermissionDenied } from '../../src/tools/permission-gate.js'

describe('buildPermissionDenied', () => {
  test('returns structured permission_denied shape', () => {
    const result = buildPermissionDenied('User denied the call.')
    expect(result).toEqual({ status: 'permission_denied', message: 'User denied the call.' })
  })
})
```

- [ ] **Step 2: Run and confirm failure**

```bash
bun test tests/tools/permission-gate.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the module**

Create `src/tools/permission-gate.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface PermissionDeniedResult {
  readonly status: 'permission_denied'
  readonly message: string
}

export function buildPermissionDenied(message: string): PermissionDeniedResult {
  return { status: 'permission_denied', message }
}
```

- [ ] **Step 4: Run and confirm pass**

```bash
bun test tests/tools/permission-gate.test.ts
```

Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/tools/permission-gate.ts tests/tools/permission-gate.test.ts
git commit -m "feat(tools): permission_denied result shape"
```

### Task 2.2: `extendSchemaForAsk` adds the `_permission_reason` field

**Files:**

- Modify: `src/tools/permission-gate.ts`
- Modify: `tests/tools/permission-gate.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/tools/permission-gate.test.ts`:

```ts
import { z } from 'zod'
import { extendSchemaForAsk } from '../../src/tools/permission-gate.js'

describe('extendSchemaForAsk', () => {
  test('adds required _permission_reason field', () => {
    const original = z.object({ id: z.string() })
    const extended = extendSchemaForAsk(original)
    expect(extended.safeParse({ id: 'x' }).success).toBe(false)
    expect(extended.safeParse({ id: 'x', _permission_reason: 'because' }).success).toBe(true)
  })

  test('rejects empty reason', () => {
    const extended = extendSchemaForAsk(z.object({ id: z.string() }))
    expect(extended.safeParse({ id: 'x', _permission_reason: '' }).success).toBe(false)
  })

  test('rejects reason over 280 chars', () => {
    const extended = extendSchemaForAsk(z.object({ id: z.string() }))
    const tooLong = 'x'.repeat(281)
    expect(extended.safeParse({ id: 'x', _permission_reason: tooLong }).success).toBe(false)
  })

  test('preserves original fields', () => {
    const original = z.object({ id: z.string(), count: z.number() })
    const extended = extendSchemaForAsk(original)
    expect(extended.safeParse({ id: 'x', _permission_reason: 'r' }).success).toBe(false) // missing count
    expect(extended.safeParse({ id: 'x', count: 1, _permission_reason: 'r' }).success).toBe(true)
  })
})
```

- [ ] **Step 2: Run and confirm failure**

```bash
bun test tests/tools/permission-gate.test.ts -t 'extendSchemaForAsk'
```

Expected: FAIL — `extendSchemaForAsk` not exported.

- [ ] **Step 3: Implement `extendSchemaForAsk`**

Append to `src/tools/permission-gate.ts`:

```ts
import { z } from 'zod'

const PERMISSION_REASON_DESCRIPTION =
  'Brief, user-facing reason this tool call is needed. ' +
  'Shown verbatim in the permission prompt. ' +
  'One sentence, present tense, no markdown.'

export const PERMISSION_REASON_FIELD = '_permission_reason'

export function extendSchemaForAsk<T extends z.ZodObject>(schema: T) {
  return schema.extend({
    [PERMISSION_REASON_FIELD]: z.string().min(1).max(280).describe(PERMISSION_REASON_DESCRIPTION),
  })
}
```

- [ ] **Step 4: Run and confirm pass**

```bash
bun test tests/tools/permission-gate.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/permission-gate.ts tests/tools/permission-gate.test.ts
git commit -m "feat(tools): extendSchemaForAsk adds _permission_reason field"
```

### Task 2.3: `gatedExecute` posts prompt, awaits decision, runs or denies

**Files:**

- Modify: `src/tools/permission-gate.ts`
- Modify: `tests/tools/permission-gate.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/tools/permission-gate.test.ts`:

```ts
import { gatedExecute, type AskPermissionFn } from '../../src/tools/permission-gate.js'

describe('gatedExecute', () => {
  const fakeExecute = async (input: { id: string }, _opts: unknown): Promise<string> => `ran:${input.id}`

  test('runs the original execute when askPermission returns "allow"', async () => {
    const ask: AskPermissionFn = async () => 'allow'
    const gated = gatedExecute(fakeExecute, 'demo_tool', ask)
    const result = await gated({ id: 'X', _permission_reason: 'because' }, {} as never)
    expect(result).toBe('ran:X')
  })

  test('strips _permission_reason before forwarding to original execute', async () => {
    let seen: Record<string, unknown> | null = null
    const recorder = async (input: Record<string, unknown>) => {
      seen = input
      return 'ok'
    }
    const ask: AskPermissionFn = async () => 'allow'
    const gated = gatedExecute(recorder, 'demo_tool', ask)
    await gated({ id: 'X', _permission_reason: 'r' }, {} as never)
    expect(seen).toEqual({ id: 'X' })
  })

  test('returns permission_denied when askPermission returns "deny"', async () => {
    const ask: AskPermissionFn = async () => 'deny'
    const gated = gatedExecute(fakeExecute, 'demo_tool', ask)
    const result = await gated({ id: 'X', _permission_reason: 'r' }, {} as never)
    expect(result).toEqual({ status: 'permission_denied', message: expect.stringContaining('demo_tool') })
  })

  test('returns permission_denied when askPermission is undefined (no chat surface)', async () => {
    const gated = gatedExecute(fakeExecute, 'demo_tool', undefined)
    const result = await gated({ id: 'X', _permission_reason: 'r' }, {} as never)
    expect(result).toEqual({ status: 'permission_denied', message: expect.stringContaining('no chat surface') })
  })

  test('passes toolName and reason to askPermission', async () => {
    let captured: { toolName: string; reason: string } | null = null
    const ask: AskPermissionFn = async (req) => {
      captured = req
      return 'allow'
    }
    const gated = gatedExecute(fakeExecute, 'demo_tool', ask)
    await gated({ id: 'X', _permission_reason: 'cleanup' }, {} as never)
    expect(captured).toEqual({ toolName: 'demo_tool', reason: 'cleanup' })
  })
})
```

- [ ] **Step 2: Run and confirm failure**

```bash
bun test tests/tools/permission-gate.test.ts -t 'gatedExecute'
```

Expected: FAIL — `gatedExecute`/`AskPermissionFn` not exported.

- [ ] **Step 3: Implement `gatedExecute`**

Append to `src/tools/permission-gate.ts`:

```ts
export type AskPermissionFn = (req: { toolName: string; reason: string }) => Promise<'allow' | 'deny'>

type ExecuteFn<I, O> = (input: I, options: unknown) => Promise<O>

export function gatedExecute<I extends Record<string, unknown>, O>(
  execute: ExecuteFn<I, O>,
  toolName: string,
  askPermission: AskPermissionFn | undefined,
): ExecuteFn<I, O | PermissionDeniedResult> {
  return async (input: I, options: unknown) => {
    if (askPermission === undefined) {
      return buildPermissionDenied(`Tool '${toolName}' requires user permission, but no chat surface is available.`)
    }
    const reason = String(input[PERMISSION_REASON_FIELD] ?? '')
    const cleaned: Record<string, unknown> = { ...input }
    delete cleaned[PERMISSION_REASON_FIELD]
    const decision = await askPermission({ toolName, reason })
    if (decision === 'deny') {
      return buildPermissionDenied(`User denied execution of '${toolName}'.`)
    }
    return execute(cleaned as I, options)
  }
}
```

- [ ] **Step 4: Run and confirm pass**

```bash
bun test tests/tools/permission-gate.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/permission-gate.ts tests/tools/permission-gate.test.ts
git commit -m "feat(tools): gatedExecute permission wrapper"
```

---

## Phase 3 — Thread `askPermission` through `makeTools`

Wire the option, integrate the gate into `applyToolPreferences`, split caching so the per-turn closure is captured fresh.

### Task 3.1: Add `askPermission` to `MakeToolsOptions`

**Files:**

- Modify: `src/tools/types.ts`

- [ ] **Step 1: Add the option**

Edit `src/tools/types.ts` to add the field (after `stagedDownloadFn` line):

```ts
  stagedDownloadFn?: import('../attachments/types.js').StagedFileDownloadFn
  /**
   * Per-turn callback used to gate tools whose effective permission is 'ask'.
   * The orchestrator constructs this closure with the user's chat reply bound
   * inside it. When undefined, ask-marked tools deny on each call.
   */
  askPermission?: import('./permission-gate.js').AskPermissionFn
```

- [ ] **Step 2: Typecheck**

```bash
bun typecheck
```

Expected: PASS (no callers reference the new field yet).

- [ ] **Step 3: Commit**

```bash
git add src/tools/types.ts
git commit -m "feat(tools): MakeToolsOptions.askPermission"
```

### Task 3.2: Integrate gate into `applyToolPreferences`

**Files:**

- Modify: `src/tools/index.ts`
- Modify: `tests/tools/index.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/tools/index.test.ts`:

```ts
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { setToolPrefs } from '../../src/tools/tool-preferences.js'

function fakeTool(name: string) {
  return tool({
    description: `fake ${name}`,
    inputSchema: z.object({ id: z.string() }),
    execute: async ({ id }: { id: string }) => `${name}:${id}`,
  })
}

describe('applyToolPreferences (ask integration)', () => {
  const contextId = 'ctx-ask-1'

  test('deny removes tool from set', () => {
    setToolPrefs(contextId, { domainDefaults: {}, toolOverrides: { create_task: 'deny' } })
    const tools: ToolSet = { create_task: fakeTool('create_task'), list_tasks: fakeTool('list_tasks') }
    const result = applyToolPreferences(tools, contextId, undefined)
    expect(Object.keys(result).toSorted()).toEqual(['list_tasks'])
  })

  test('allow leaves tool unwrapped', () => {
    setToolPrefs(contextId, { domainDefaults: {}, toolOverrides: {} })
    const tools: ToolSet = { create_task: fakeTool('create_task') }
    const result = applyToolPreferences(tools, contextId, undefined)
    expect(result['create_task']).toBe(tools['create_task'])
  })

  test('ask wraps execute and extends schema', async () => {
    setToolPrefs(contextId, { domainDefaults: {}, toolOverrides: { create_task: 'ask' } })
    const tools: ToolSet = { create_task: fakeTool('create_task') }
    const result = applyToolPreferences(tools, contextId, async () => 'allow')
    const wrapped = result['create_task']
    expect(wrapped).toBeDefined()
    // Schema now requires _permission_reason
    const parsed = wrapped!.inputSchema.safeParse({ id: 'X' })
    expect(parsed.success).toBe(false)
    // Execute runs original tool when allowed
    const out = await wrapped!.execute!({ id: 'X', _permission_reason: 'r' }, { toolCallId: 't1' } as never)
    expect(out).toBe('create_task:X')
  })

  test('ask denies when no askPermission provided', async () => {
    setToolPrefs(contextId, { domainDefaults: {}, toolOverrides: { create_task: 'ask' } })
    const tools: ToolSet = { create_task: fakeTool('create_task') }
    const result = applyToolPreferences(tools, contextId, undefined)
    const out = await result['create_task']!.execute!({ id: 'X', _permission_reason: 'r' }, {
      toolCallId: 't1',
    } as never)
    expect(out).toMatchObject({ status: 'permission_denied' })
  })
})
```

The existing `tests/tools/index.test.ts` already imports `applyToolPreferences`; if it does not, add the import:

```ts
import { applyToolPreferences } from '../../src/tools/index.js'
```

- [ ] **Step 2: Run and confirm failure**

```bash
bun test tests/tools/index.test.ts -t 'applyToolPreferences (ask integration)'
```

Expected: FAIL — `applyToolPreferences` is not currently exported, and even if it were it doesn't take an `askPermission` argument.

- [ ] **Step 3: Rewrite `applyToolPreferences` and export it**

In `src/tools/index.ts`, replace `applyToolPreferences` and add the wrapping:

```ts
import { extendSchemaForAsk, gatedExecute, type AskPermissionFn } from './permission-gate.js'
import { getToolPrefs, resolveToolPermission } from './tool-preferences.js'

export function applyToolPreferences(
  tools: ToolSet,
  contextId: string | undefined,
  askPermission: AskPermissionFn | undefined,
): ToolSet {
  if (contextId === undefined) return tools
  const prefsContextId = getConfigContextIdFromStorageContextId(contextId)
  const prefs = getToolPrefs(prefsContextId)
  const out: ToolSet = {}
  for (const [name, t] of Object.entries(tools)) {
    if (t === undefined) continue
    const perm = resolveToolPermission(prefs, name)
    if (perm === 'deny') continue
    if (perm === 'allow') {
      out[name] = t
      continue
    }
    // perm === 'ask'
    const extendedSchema = extendSchemaForAsk(t.inputSchema as z.ZodObject)
    const wrappedExecute =
      t.execute === undefined ? undefined : gatedExecute(t.execute.bind(t) as never, name, askPermission)
    out[name] = { ...t, inputSchema: extendedSchema, execute: wrappedExecute }
  }
  return out
}
```

Add `import { z } from 'zod'` if missing. Then in `makeTools(...)`, change the final line:

```ts
return applyToolPreferences({ ...wrappedBuiltins, ...mcpTools, ...pluginTools }, contextId, options?.askPermission)
```

Remove the old private `applyToolPreferences` definition.

- [ ] **Step 4: Run and confirm pass**

```bash
bun test tests/tools/index.test.ts -t 'applyToolPreferences (ask integration)'
```

Expected: PASS.

- [ ] **Step 5: Update other callers of `partitionToolNames` / `isToolEnabled`**

```bash
bun typecheck
```

Likely failures: `src/commands/tool-config-view.ts` (uses `isToolEnabled`/`getDomainStatus`) — handled in Phase 7. `src/chat/tool-toggle-interaction-handler.ts` (uses `toggleDomain`/`toggleTool`) — handled in Phase 7. For now, comment out their usages with a `// TODO(Phase 7): tri-state` annotation or add a temporary shim. Prefer the **shim** approach to keep CI green between phases:

In `src/tools/tool-preferences.ts`, add at the bottom (delete in Phase 7):

```ts
// --- TEMPORARY SHIMS for Phase 7 callers; remove when tool-config-view migrates ---
export function isToolEnabled(prefs: ToolPrefs, toolName: string): boolean {
  return resolveToolPermission(prefs, toolName) !== 'deny'
}
export type DomainStatus = 'on' | 'off' | 'partial'
export function getDomainStatus(
  prefs: ToolPrefs,
  domain: ToolDomain,
  domainToolNames: readonly string[],
): DomainStatus {
  const summary = getDomainSummary(prefs, domain, domainToolNames)
  if (summary === 'partial') return 'partial'
  return summary === 'deny' ? 'off' : 'on'
}
export function toggleDomain(prefs: ToolPrefs, domain: ToolDomain, domainToolNames: readonly string[]): ToolPrefs {
  return cycleDomain(prefs, domain, domainToolNames)
}
export function toggleTool(prefs: ToolPrefs, toolName: string, _domainToolNames: readonly string[]): ToolPrefs {
  return cycleTool(prefs, toolName)
}
```

- [ ] **Step 6: Run typecheck and all tests**

```bash
bun typecheck && bun test tests/tools/
```

Expected: PASS. Some `tool-toggle-interaction-handler.test.ts` and `tool-config-view.test.ts` assertions may break because the old toggle is now a 3-state cycle (toggling once now lands on `ask`, not `off`). Those tests are updated in Phase 7.

- [ ] **Step 7: Commit**

```bash
git add src/tools/index.ts src/tools/tool-preferences.ts tests/tools/index.test.ts
git commit -m "feat(tools): apply tri-state preferences and gate ask tools"
```

### Task 3.3: Split orchestrator cache to pre-permission descriptors

**Files:**

- Modify: `src/tools/index.ts`
- Modify: `src/llm-orchestrator-tools.ts`

- [ ] **Step 1: Add exported `buildToolDescriptors` to `src/tools/index.ts`**

Refactor `makeTools` so the orchestrator can cache the _unwrapped_ set and reapply preferences each turn. After the existing `makeTools(...)` definition, add:

```ts
/** Same as makeTools but skips the final per-permission step (used by callers that cache descriptors). */
export async function buildToolDescriptors(provider: TaskProvider, options: MakeToolsOptions): Promise<ToolSet> {
  const storageContextId = options.storageContextId
  const chatUserId = options.chatUserId
  const username = options.username
  const sharedContextId =
    storageContextId === undefined ? undefined : getConfigContextIdFromStorageContextId(storageContextId)
  const mode = options.mode ?? 'normal'
  const contextType = options.contextType
  const stagedDownloadFn = options.stagedDownloadFn

  const tools = buildTools(provider, chatUserId, storageContextId, mode, contextType, username, stagedDownloadFn)
  const wrappedBuiltins = wrapToolSet(tools)

  let mcpTools: ToolSet = {}
  if (sharedContextId !== undefined) {
    try {
      mcpTools = await buildMcpToolSet(sharedContextId)
    } catch {
      /* MCP failures don't break the pipeline */
    }
  }

  let pluginTools: ToolSet = {}
  if (sharedContextId !== undefined && chatUserId !== undefined) {
    const result = await buildPluginAndMcpTools(provider, sharedContextId, chatUserId, wrappedBuiltins)
    pluginTools = result.pluginTools
    Object.assign(mcpTools, result.extraMcpTools)
  }

  return { ...wrappedBuiltins, ...mcpTools, ...pluginTools }
}
```

(Refactor by extracting the existing body of `makeTools` if you prefer; the simplest change is to have `makeTools` delegate to `buildToolDescriptors`:)

```ts
export async function makeTools(
  provider: TaskProvider,
  ...args: readonly [MakeToolsOptions] | readonly []
): Promise<ToolSet> {
  const options = args[0] ?? { chatUserId: '' }
  const descriptors = await buildToolDescriptors(provider, options)
  return applyToolPreferences(descriptors, options.storageContextId, options.askPermission)
}
```

- [ ] **Step 2: Switch orchestrator to descriptors + per-turn permission application**

Replace `getOrCreateTools` and `prepareLlmInvocation` in `src/llm-orchestrator-tools.ts`:

```ts
import { applyToolPreferences, buildToolDescriptors } from './tools/index.js'
import type { AskPermissionFn } from './tools/permission-gate.js'

const getOrCreateDescriptors = async (
  contextId: string,
  chatUserId: string,
  username: string | null,
  provider: TaskProvider,
  contextType: 'dm' | 'group' | undefined,
  stagedDownloadFn: StagedFileDownloadFn | undefined,
): Promise<ToolSet> => {
  let cacheKey = contextId
  if (contextType === 'group') {
    const usernameSuffix = username === null ? '' : username
    cacheKey = `${contextId}:${chatUserId}:${usernameSuffix}`
  }
  const cached = getCachedTools(cacheKey)
  if (cached !== undefined && cached !== null && isToolSet(cached)) {
    log.debug({ contextId, chatUserId, hasUsername: username !== null }, 'Using cached tool descriptors')
    return cached
  }
  log.debug({ contextId, chatUserId, hasUsername: username !== null }, 'Building tool descriptors (cache miss)')
  const descriptors = await buildToolDescriptors(provider, {
    storageContextId: contextId,
    chatUserId,
    username,
    contextType,
    stagedDownloadFn,
  })
  setCachedTools(cacheKey, descriptors)
  return descriptors
}

export const prepareLlmInvocation = async (
  contextId: string,
  configId: string,
  chatUserId: string,
  username: string | null,
  contextType: 'dm' | 'group',
  provider: TaskProvider,
  history: readonly ModelMessage[],
  userText: string,
  stagedDownloadFn: StagedFileDownloadFn | undefined,
  askPermission: AskPermissionFn | undefined,
): Promise<{
  routingResult: ReturnType<typeof routeToolsForMessage>
  validatedMessages: ModelMessage[]
  enabledToolNames: ReadonlySet<string>
}> => {
  const descriptors = await getOrCreateDescriptors(
    contextId,
    chatUserId,
    username,
    provider,
    contextType,
    stagedDownloadFn,
  )
  const fullTools = applyToolPreferences(descriptors, contextId, askPermission)
  const enabledToolNames = new Set(Object.keys(fullTools))
  const routingResult = routeToolsForMessage(userText, fullTools)
  log.debug(
    {
      contextId,
      routingIntent: routingResult.decision.intent,
      routingConfidence: routingResult.decision.confidence,
      routingReason: routingResult.decision.reason,
      fullToolCount: routingResult.fullToolCount,
      exposedToolCount: routingResult.exposedToolCount,
    },
    'Tool routing selected subset',
  )
  const timezone = resolveTimezone(configId)
  const { messages: messagesWithMemory, memoryMsg } = buildMessagesWithMemory(contextId, history)
  const validatedMessages = validateToolResults(messagesWithMemory)
  log.debug(
    { contextId, historyLength: history.length, hasMemory: memoryMsg !== null, timezone },
    'Calling generateText',
  )
  return { routingResult, validatedMessages, enabledToolNames }
}
```

- [ ] **Step 3: Update the caller in `src/llm-orchestrator.ts`**

Find the call to `prepareLlmInvocation` in `src/llm-orchestrator.ts` around `callLlm` (currently at line 191) and append the `askPermission` argument:

```ts
const askPermission: AskPermissionFn = (req) => askPermissionViaChat(reply, configId, req)
const { routingResult, validatedMessages, enabledToolNames } = await prepareLlmInvocation(
  contextId,
  configId,
  chatUserId,
  username,
  contextType,
  provider,
  history,
  userText,
  deps.stagedDownloadFn,
  askPermission,
)
```

Add imports near the top of `src/llm-orchestrator.ts`:

```ts
import { askPermissionViaChat } from './chat/permission-prompt.js'
import type { AskPermissionFn } from './tools/permission-gate.js'
```

The `askPermissionViaChat` import will fail to resolve until Phase 4 lands. Stub it temporarily by adding to `src/chat/permission-prompt.ts` (created in Phase 4 — for now, create an empty stub):

```ts
// SPDX-License-Identifier: BUSL-1.1
// (Stub; real implementation in Phase 4)
import type { ReplyFn } from './types.js'

export async function askPermissionViaChat(
  _reply: ReplyFn,
  _contextId: string,
  _req: { toolName: string; reason: string },
): Promise<'allow' | 'deny'> {
  return 'deny'
}
```

This keeps the build green between phases.

- [ ] **Step 4: Typecheck and run main test suite**

```bash
bun typecheck && bun test tests/tools tests/llm-orchestrator*.test.ts
```

Expected: PASS. Some llm-orchestrator tests may need the extra `undefined` argument when calling `prepareLlmInvocation` directly — update them by appending `undefined` as the new `askPermission` argument.

- [ ] **Step 5: Commit**

```bash
git add src/tools/index.ts src/llm-orchestrator-tools.ts src/llm-orchestrator.ts src/chat/permission-prompt.ts tests/
git commit -m "feat(tools): cache descriptors; apply tri-state prefs per turn"
```

---

## Phase 4 — Chat-layer prompt and callback handler

Replace the Phase 3 stub with the real `askPermissionViaChat`, add the callback handler, and route `perm:` callbacks.

### Task 4.1: Pending-request registry + `askPermissionViaChat`

**Files:**

- Modify: `src/chat/permission-prompt.ts` (replace the Phase 3 stub)
- Create: `tests/chat/permission-prompt.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/chat/permission-prompt.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import {
  __resetPermissionPromptForTests,
  askPermissionViaChat,
  resolvePermissionRequest,
} from '../../src/chat/permission-prompt.js'
import type { ReplyFn } from '../../src/chat/types.js'

function makeReply() {
  const buttons = mock(() => Promise.resolve())
  const text = mock(() => Promise.resolve())
  const reply = {
    text,
    formatted: mock(() => Promise.resolve()),
    typing: mock(() => Promise.resolve()),
    buttons,
  } as unknown as ReplyFn
  return { reply, buttons, text }
}

describe('askPermissionViaChat', () => {
  beforeEach(() => __resetPermissionPromptForTests())
  afterEach(() => __resetPermissionPromptForTests())

  test('posts an Allow/Deny prompt and resolves on allow', async () => {
    const { reply, buttons } = makeReply()
    const promise = askPermissionViaChat(reply, 'ctx-1', { toolName: 'delete_task', reason: 'cleanup T-123' })

    await new Promise((r) => setTimeout(r, 0)) // let microtask post the buttons
    expect(buttons).toHaveBeenCalledTimes(1)
    const callArgs = buttons.mock.calls[0]
    const [, btns] = callArgs as [string, Array<{ callbackData: string }>]
    expect(btns).toHaveLength(2)
    const allowId = btns[0]!.callbackData.replace('perm:a:', '')
    expect(btns[0]!.callbackData).toBe(`perm:a:${allowId}`)
    expect(btns[1]!.callbackData).toBe(`perm:d:${allowId}`)

    const resolved = resolvePermissionRequest(allowId, 'allow')
    expect(resolved).toBe(true)
    await expect(promise).resolves.toBe('allow')
  })

  test('resolves on deny', async () => {
    const { reply, buttons } = makeReply()
    const promise = askPermissionViaChat(reply, 'ctx-1', { toolName: 'delete_task', reason: 'r' })
    await new Promise((r) => setTimeout(r, 0))
    const id = (buttons.mock.calls[0]![1] as Array<{ callbackData: string }>)[0]!.callbackData.replace('perm:a:', '')
    expect(resolvePermissionRequest(id, 'deny')).toBe(true)
    await expect(promise).resolves.toBe('deny')
  })

  test('resolvePermissionRequest returns false for unknown id', () => {
    expect(resolvePermissionRequest('nope', 'allow')).toBe(false)
  })

  test('callback data uses 8-char base64url id', async () => {
    const { reply, buttons } = makeReply()
    void askPermissionViaChat(reply, 'ctx-1', { toolName: 't', reason: 'r' })
    await new Promise((r) => setTimeout(r, 0))
    const id = (buttons.mock.calls[0]![1] as Array<{ callbackData: string }>)[0]!.callbackData.replace('perm:a:', '')
    expect(id).toMatch(/^[A-Za-z0-9_-]{8}$/)
  })

  test('prompt body contains tool name and reason', async () => {
    const { reply, buttons } = makeReply()
    void askPermissionViaChat(reply, 'ctx-1', { toolName: 'delete_task', reason: 'cleanup' })
    await new Promise((r) => setTimeout(r, 0))
    const [body] = buttons.mock.calls[0]! as [string, unknown]
    expect(body).toContain('delete_task')
    expect(body).toContain('cleanup')
  })
})
```

- [ ] **Step 2: Run and confirm failure**

```bash
bun test tests/chat/permission-prompt.test.ts
```

Expected: FAIL — stub does not match the contract.

- [ ] **Step 3: Replace the stub with the real implementation**

Overwrite `src/chat/permission-prompt.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomBytes } from 'node:crypto'

import { logger } from '../logger.js'
import type { ReplyFn } from './types.js'

const log = logger.child({ scope: 'chat:permission-prompt' })

const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000

export type PermissionDecision = 'allow' | 'deny'

interface PendingRequest {
  contextId: string
  toolName: string
  resolve: (decision: PermissionDecision) => void
  timer: ReturnType<typeof setTimeout>
}

const pending = new Map<string, PendingRequest>()

function generateRequestId(): string {
  return randomBytes(6).toString('base64url') // 6 bytes → 8 base64url chars
}

function formatPrompt(toolName: string, reason: string): string {
  return `🔐 Run \`${toolName}\`?\n\n${reason}`
}

export async function askPermissionViaChat(
  reply: ReplyFn,
  contextId: string,
  req: { toolName: string; reason: string },
): Promise<PermissionDecision> {
  const id = generateRequestId()
  const body = formatPrompt(req.toolName, req.reason)
  await reply.buttons(body, [
    { text: '✅ Allow', callbackData: `perm:a:${id}`, style: 'primary' },
    { text: '🚫 Deny', callbackData: `perm:d:${id}`, style: 'secondary' },
  ])
  return new Promise<PermissionDecision>((resolve) => {
    const timer = setTimeout(() => {
      const entry = pending.get(id)
      if (entry === undefined) return
      pending.delete(id)
      log.warn({ contextId, toolName: req.toolName, id }, 'Permission prompt timed out; denying')
      entry.resolve('deny')
    }, PERMISSION_TIMEOUT_MS)
    pending.set(id, { contextId, toolName: req.toolName, resolve, timer })
  })
}

/** Resolve a pending request from a callback handler. Returns true if a request was found. */
export function resolvePermissionRequest(id: string, decision: PermissionDecision): boolean {
  const entry = pending.get(id)
  if (entry === undefined) return false
  pending.delete(id)
  clearTimeout(entry.timer)
  entry.resolve(decision)
  return true
}

/** Return the context ID of a pending request without resolving it. */
export function peekPermissionRequest(id: string): { contextId: string; toolName: string } | null {
  const entry = pending.get(id)
  if (entry === undefined) return null
  return { contextId: entry.contextId, toolName: entry.toolName }
}

/** Test-only: clear the registry and pending timers. */
export function __resetPermissionPromptForTests(): void {
  for (const entry of pending.values()) clearTimeout(entry.timer)
  pending.clear()
}
```

`reply.buttons` signature: confirm by checking `src/chat/types.ts` — buttons accepts `(message: string, buttons: ChatButton[])`. The `style` keys (`'primary'`/`'secondary'`) exist for `ChatButton`.

- [ ] **Step 4: Run and confirm pass**

```bash
bun test tests/chat/permission-prompt.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chat/permission-prompt.ts tests/chat/permission-prompt.test.ts
git commit -m "feat(chat): askPermissionViaChat with pending-request registry"
```

### Task 4.2: `handlePermissionInteraction` callback handler

**Files:**

- Create: `src/chat/permission-interaction-handler.ts`
- Create: `tests/chat/permission-interaction-handler.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/chat/permission-interaction-handler.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { handlePermissionInteraction } from '../../src/chat/permission-interaction-handler.js'
import { __resetPermissionPromptForTests, askPermissionViaChat } from '../../src/chat/permission-prompt.js'
import type { IncomingInteraction, ReplyFn } from '../../src/chat/types.js'

function makeReply() {
  const text = mock(() => Promise.resolve())
  const buttons = mock(() => Promise.resolve())
  return {
    reply: {
      text,
      formatted: mock(() => Promise.resolve()),
      typing: mock(() => Promise.resolve()),
      buttons,
    } as unknown as ReplyFn,
    text,
    buttons,
  }
}

function makeInteraction(callbackData: string, userId = 'u-1', contextId = 'u-1'): IncomingInteraction {
  return {
    callbackData,
    user: { id: userId },
    contextType: 'dm',
    storageContextId: contextId,
    platformInstanceId: 'p-1',
  } as IncomingInteraction
}

async function postPrompt(reply: ReplyFn, contextId = 'u-1') {
  const promise = askPermissionViaChat(reply, contextId, { toolName: 'demo_tool', reason: 'why' })
  await new Promise((r) => setTimeout(r, 0))
  return promise
}

describe('handlePermissionInteraction', () => {
  beforeEach(() => __resetPermissionPromptForTests())
  afterEach(() => __resetPermissionPromptForTests())

  test('ignores non-perm: callbacks', async () => {
    const { reply } = makeReply()
    const result = await handlePermissionInteraction(makeInteraction('tgl:dom:task'), reply)
    expect(result).toBe(false)
  })

  test('resolves promise with allow on perm:a', async () => {
    const { reply, buttons } = makeReply()
    const pending = postPrompt(reply)
    const id = (buttons.mock.calls[0]![1] as Array<{ callbackData: string }>)[0]!.callbackData.replace('perm:a:', '')
    const handled = await handlePermissionInteraction(makeInteraction(`perm:a:${id}`), reply)
    expect(handled).toBe(true)
    await expect(pending).resolves.toBe('allow')
  })

  test('resolves promise with deny on perm:d', async () => {
    const { reply, buttons } = makeReply()
    const pending = postPrompt(reply)
    const id = (buttons.mock.calls[0]![1] as Array<{ callbackData: string }>)[0]!.callbackData.replace('perm:a:', '')
    await handlePermissionInteraction(makeInteraction(`perm:d:${id}`), reply)
    await expect(pending).resolves.toBe('deny')
  })

  test('expired id replies "expired" without throwing', async () => {
    const { reply, text } = makeReply()
    const handled = await handlePermissionInteraction(makeInteraction('perm:a:zzzzzzzz'), reply)
    expect(handled).toBe(true)
    expect(text.mock.calls.length + (reply.formatted as ReturnType<typeof mock>).mock.calls.length).toBeGreaterThan(0)
  })

  test('rejects when user cannot manage the target context', async () => {
    const { reply, buttons } = makeReply()
    void postPrompt(reply, 'group-A') // request belongs to group-A
    const id = (buttons.mock.calls[0]![1] as Array<{ callbackData: string }>)[0]!.callbackData.replace('perm:a:', '')
    const handled = await handlePermissionInteraction(
      makeInteraction(`perm:a:${id}`, 'other-user', 'other-user'),
      reply,
    )
    expect(handled).toBe(true)
    // Pending request must NOT have been resolved
  })
})
```

- [ ] **Step 2: Run and confirm failure**

```bash
bun test tests/chat/permission-interaction-handler.test.ts
```

Expected: FAIL (module missing).

- [ ] **Step 3: Implement the handler**

Create `src/chat/permission-interaction-handler.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { listManageableGroups } from '../group-settings/access.js'
import { getMissingGroupTargetMessage } from '../group-settings/target-validation.js'
import { logger } from '../logger.js'
import { replyTextPreferReplace } from './interaction-router-replies.js'
import { peekPermissionRequest, resolvePermissionRequest } from './permission-prompt.js'
import type { IncomingInteraction, ReplyFn } from './types.js'

const log = logger.child({ scope: 'chat:permission-interaction' })

function canManageTargetContext(interaction: IncomingInteraction, targetContextId: string): boolean {
  if (interaction.contextType !== 'dm') return targetContextId === interaction.storageContextId
  if (targetContextId === interaction.user.id) return true
  return listManageableGroups(interaction.user.id).some((group) => group.contextId === targetContextId)
}

export async function handlePermissionInteraction(interaction: IncomingInteraction, reply: ReplyFn): Promise<boolean> {
  const { callbackData } = interaction
  if (!callbackData.startsWith('perm:')) return false

  const match = /^perm:([ad]):([A-Za-z0-9_-]{8})$/.exec(callbackData)
  if (match === null) {
    log.warn({ callbackData }, 'Malformed permission callback')
    await replyTextPreferReplace(reply, 'Invalid permission action.')
    return true
  }
  const decision = match[1] === 'a' ? 'allow' : 'deny'
  const id = match[2]!

  const pendingMeta = peekPermissionRequest(id)
  if (pendingMeta === null) {
    await replyTextPreferReplace(reply, '🕘 This permission request has expired.')
    return true
  }

  if (!canManageTargetContext(interaction, pendingMeta.contextId)) {
    await replyTextPreferReplace(reply, getMissingGroupTargetMessage(interaction.user.id, pendingMeta.contextId))
    return true
  }

  const resolved = resolvePermissionRequest(id, decision)
  if (!resolved) {
    await replyTextPreferReplace(reply, '🕘 This permission request has expired.')
    return true
  }

  log.info(
    { id, decision, contextId: pendingMeta.contextId, toolName: pendingMeta.toolName, userId: interaction.user.id },
    'Permission decision recorded',
  )
  await replyTextPreferReplace(
    reply,
    decision === 'allow' ? `✅ Allowed \`${pendingMeta.toolName}\`.` : `🚫 Denied \`${pendingMeta.toolName}\`.`,
  )
  return true
}
```

- [ ] **Step 4: Run and confirm pass**

```bash
bun test tests/chat/permission-interaction-handler.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chat/permission-interaction-handler.ts tests/chat/permission-interaction-handler.test.ts
git commit -m "feat(chat): handlePermissionInteraction for perm: callbacks"
```

### Task 4.3: Route `perm:` callbacks in `interaction-router`

**Files:**

- Modify: `src/chat/interaction-router.ts`
- Modify: `tests/chat/interaction-router.test.ts`

- [ ] **Step 1: Add a failing test**

In `tests/chat/interaction-router.test.ts`, add (mirroring the existing `tgl:` test):

```ts
test('routes perm: callbacks to handlePermissionInteraction', async () => {
  const handler = mock(() => Promise.resolve(true))
  const interaction = {
    callbackData: 'perm:a:abcd1234',
    user: { id: 'u-1' },
    contextType: 'dm',
    storageContextId: 'u-1',
    platformInstanceId: 'p-1',
  } as IncomingInteraction
  const reply = makeReply()
  const auth: AuthorizationResult = { allowed: true, isBotAdmin: false, isGroupAdmin: false, storageContextId: 'u-1' }
  await routeInteraction(interaction, reply, auth, { handlePermissionInteraction: handler })
  expect(handler).toHaveBeenCalledTimes(1)
})
```

(Use existing helpers/imports in the test file to match style. If a `makeReply` helper does not exist, copy the inline pattern from existing tests.)

- [ ] **Step 2: Run and confirm failure**

```bash
bun test tests/chat/interaction-router.test.ts -t 'perm:'
```

Expected: FAIL — router does not know about `perm:`.

- [ ] **Step 3: Add the route**

In `src/chat/interaction-router.ts`:

```ts
import { handlePermissionInteraction } from './permission-interaction-handler.js'

// ... inside InteractionRouteHandlers add:
  handlePermissionInteraction: (interaction: IncomingInteraction, reply: ReplyFn) => Promise<boolean>

// ... inside defaultDeps add:
  handlePermissionInteraction,

// ... inside routeInteraction, after the tgl: block:
  if (callbackData.startsWith('perm:')) {
    return resolvedDeps.handlePermissionInteraction(interaction, reply)
  }
```

- [ ] **Step 4: Run and confirm pass**

```bash
bun test tests/chat/interaction-router.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chat/interaction-router.ts tests/chat/interaction-router.test.ts
git commit -m "feat(chat): route perm: callbacks to permission handler"
```

---

## Phase 5 — System prompt fragment

A small fragment that tells the LLM which tools require `_permission_reason`.

### Task 5.1: `ask`-tools instruction line

**Files:**

- Modify: `src/system-prompt.ts`
- Modify: `tests/system-prompt.test.ts`

- [ ] **Step 1: Add failing test**

Append to `tests/system-prompt.test.ts`:

```ts
import { setToolPrefs } from '../src/tools/tool-preferences.js'

describe('ask-tools instruction', () => {
  test('appears when any tool is set to ask', () => {
    setToolPrefs('ctx-ask-prompt', { domainDefaults: {}, toolOverrides: { delete_task: 'ask' } })
    const prompt = buildSystemPrompt(fakeProvider(), 'ctx-ask-prompt', new Set(['delete_task', 'create_task']))
    expect(prompt).toContain('_permission_reason')
    expect(prompt).toContain('delete_task')
  })

  test('omitted when no tool is ask', () => {
    setToolPrefs('ctx-no-ask', { domainDefaults: {}, toolOverrides: { delete_task: 'deny' } })
    const prompt = buildSystemPrompt(fakeProvider(), 'ctx-no-ask', new Set(['create_task']))
    expect(prompt).not.toContain('_permission_reason')
  })
})
```

(Reuse `fakeProvider()` / `buildSystemPrompt` import patterns already used in the existing test file. If the file uses a different setup, follow it.)

- [ ] **Step 2: Run and confirm failure**

```bash
bun test tests/system-prompt.test.ts -t 'ask-tools instruction'
```

Expected: FAIL.

- [ ] **Step 3: Add `buildAskToolsLine` and wire it**

In `src/system-prompt.ts`, near `buildUnavailableLine`:

```ts
function buildAskToolsLine(prefs: ToolPrefs, exposed: ReadonlySet<string>): string | null {
  const askNames = [...exposed].filter((name) => resolveToolPermission(prefs, name) === 'ask').toSorted()
  if (askNames.length === 0) return null
  return [
    'Some tools require user permission before each call. Listed tools must include',
    '`_permission_reason` (one sentence, present tense) describing why the call is needed:',
    askNames.map((n) => `  - ${n}`).join('\n'),
  ].join('\n')
}
```

Add `resolveToolPermission` to the existing import from `./tools/tool-preferences.js`. Then in `assembleSystemPrompt`, after the unavailable line:

```ts
const askLine = buildAskToolsLine(getToolPrefs(sharedContextId), enabledToolNames)
if (askLine !== null) parts.push(askLine)
```

- [ ] **Step 4: Run and confirm pass**

```bash
bun test tests/system-prompt.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/system-prompt.ts tests/system-prompt.test.ts
git commit -m "feat(system-prompt): announce ask tools and require _permission_reason"
```

---

## Phase 6 — UI: 3-state markers, cycle, External pseudo-domain, summary

### Task 6.1: 3-state markers and domain summary in `tool-config-view`

**Files:**

- Modify: `src/commands/tool-config-view.ts`
- Modify: `tests/commands/tool-config-view.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/commands/tool-config-view.test.ts`:

```ts
import { setToolPrefs } from '../../src/tools/tool-preferences.js'
import { buildDomainListView, buildDomainDrillView } from '../../src/commands/tool-config-view.js'

describe('tool-config-view tri-state markers', () => {
  test('shows ❓ when domain default is ask', () => {
    setToolPrefs('ctx-view-ask', { domainDefaults: { task: 'ask' }, toolOverrides: {} })
    const view = buildDomainListView('ctx-view-ask', ['create_task', 'delete_task'], getToolPrefs('ctx-view-ask'))
    expect(view.text).toContain('❓')
  })

  test('shows ⭕ when domain default is deny', () => {
    setToolPrefs('ctx-view-deny', { domainDefaults: { task: 'deny' }, toolOverrides: {} })
    const view = buildDomainListView('ctx-view-deny', ['create_task'], getToolPrefs('ctx-view-deny'))
    expect(view.text).toContain('⭕')
  })

  test('shows 🟡 when tools in the domain disagree', () => {
    setToolPrefs('ctx-view-partial', {
      domainDefaults: { task: 'allow' },
      toolOverrides: { delete_task: 'deny' },
    })
    const view = buildDomainListView(
      'ctx-view-partial',
      ['create_task', 'delete_task'],
      getToolPrefs('ctx-view-partial'),
    )
    expect(view.text).toContain('🟡')
  })

  test('drill view shows ❓ marker for ask tool', () => {
    setToolPrefs('ctx-view-tool-ask', { domainDefaults: {}, toolOverrides: { delete_task: 'ask' } })
    const view = buildDomainDrillView(
      'ctx-view-tool-ask',
      'task',
      ['create_task', 'delete_task'],
      getToolPrefs('ctx-view-tool-ask'),
    )
    expect(view.text).toContain('❓ ⚠️ delete_task')
  })

  test('footer hint always present at the bottom of the domain list', () => {
    const view = buildDomainListView('ctx-view-footer', ['create_task'], getToolPrefs('ctx-view-footer'))
    expect(view.text).toContain('🟢 = always allowed')
    expect(view.text).toContain('❓ = ask each time')
    expect(view.text).toContain('⭕ = blocked')
  })
})
```

(Adjust `getToolPrefs` import to match the existing test file.)

- [ ] **Step 2: Run and confirm failure**

```bash
bun test tests/commands/tool-config-view.test.ts -t 'tri-state markers'
```

Expected: FAIL.

- [ ] **Step 3: Replace markers and add footer**

In `src/commands/tool-config-view.ts`:

```ts
import {
  getDomainSummary,
  resolveToolPermission,
  type DomainSummary,
  type ToolPrefs,
} from '../tools/tool-preferences.js'

function summaryMarker(summary: DomainSummary): string {
  if (summary === 'allow') return '🟢'
  if (summary === 'ask') return '❓'
  if (summary === 'deny') return '⭕'
  return '🟡'
}

function permissionMarker(perm: 'allow' | 'ask' | 'deny'): string {
  if (perm === 'allow') return '🟢'
  if (perm === 'ask') return '❓'
  return '⭕'
}
```

Delete `statusMarker`. Replace its call sites:

```ts
// in buildDomainListView, replace getDomainStatus + statusMarker:
const summary = getDomainSummary(prefs, domain, names)
lines.push(`${summaryMarker(summary)} ${DOMAIN_LABELS[domain]}`)
// ...
buttons.push({
  text: `${summaryMarker(summary)} ${DOMAIN_LABELS[domain]}`,
  callbackData: toggleCallback,
  style: summary === 'deny' ? 'secondary' : 'primary',
})
```

```ts
// in buildDomainDrillView, replace isToolEnabled:
const perm = resolveToolPermission(prefs, name)
lines.push(`${permissionMarker(perm)} ${risk} ${name}`)
// ...
buttons.push({
  text: `${permissionMarker(perm)} ${risk} ${name}`,
  callbackData: toolCallback,
  style: perm === 'deny' ? 'secondary' : 'primary',
})
```

At the end of `buildDomainListView`, append the footer:

```ts
lines.push('')
lines.push('🟢 = always allowed   ❓ = ask each time   ⭕ = blocked')
```

- [ ] **Step 4: Run and confirm pass**

```bash
bun test tests/commands/tool-config-view.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/tool-config-view.ts tests/commands/tool-config-view.test.ts
git commit -m "feat(commands): 3-state markers and footer hint in tool config view"
```

### Task 6.2: Cycle behaviour in `tool-toggle-interaction-handler`

**Files:**

- Modify: `src/chat/tool-toggle-interaction-handler.ts`
- Modify: `tests/chat/tool-toggle-interaction-handler.test.ts`

- [ ] **Step 1: Adjust expectations and add a failing test**

In `tests/chat/tool-toggle-interaction-handler.test.ts`, replace any test that asserts a domain or tool flips from on→off in a single tap with the 3-state cycle. Add:

```ts
test('tapping a tool cycles allow → ask → deny → allow', async () => {
  setToolPrefs('ctx-cycle-1', { domainDefaults: {}, toolOverrides: {} })
  // Simulate three taps on `tgl:tool:delete_task:<ctx>` — exact mechanics depend on test harness.
  // Each tap calls handleToolToggleInteraction; verify resolveToolPermission progresses through the cycle.
  // (Use the existing test pattern in this file as a template.)
})
```

If the existing test asserted `toggleTool` semantics that no longer hold, change those assertions to the new cycle.

- [ ] **Step 2: Run and confirm failure**

```bash
bun test tests/chat/tool-toggle-interaction-handler.test.ts
```

Expected: at least one failure — old assertions no longer match.

- [ ] **Step 3: Switch handler to `cycleDomain`/`cycleTool`**

In `src/chat/tool-toggle-interaction-handler.ts`, replace the imports and call sites:

```ts
import { cycleDomain, cycleTool, getToolPrefs, setToolPrefs } from '../tools/tool-preferences.js'

// inside 'dom' branch:
setToolPrefs(contextId, cycleDomain(getToolPrefs(contextId), resolvedMiddle, domainNames))

// inside 'tool' branch:
setToolPrefs(contextId, cycleTool(getToolPrefs(contextId), resolvedMiddle))
```

(`cycleTool` drops the `_domainToolNames` argument; remove it from the call.)

- [ ] **Step 4: Run and confirm pass**

```bash
bun test tests/chat/tool-toggle-interaction-handler.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chat/tool-toggle-interaction-handler.ts tests/chat/tool-toggle-interaction-handler.test.ts
git commit -m "feat(chat): tool/domain taps cycle through allow/ask/deny"
```

### Task 6.3: External pseudo-domain for plugin/MCP tools

**Files:**

- Modify: `src/commands/tool-config-view.ts`
- Modify: `tests/commands/tool-config-view.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
describe('external pseudo-domain', () => {
  test('absent when no plugin/MCP tools', () => {
    const view = buildDomainListView('ctx-ext-none', ['create_task'], getToolPrefs('ctx-ext-none'))
    expect(view.text).not.toContain('External')
  })

  test('shown when plugin/MCP tools present', () => {
    const view = buildDomainListView(
      'ctx-ext-yes',
      ['create_task', 'plugin_foo__greet', 'mcp_bar__ping'],
      getToolPrefs('ctx-ext-yes'),
    )
    expect(view.text).toContain('External')
  })

  test('no bulk-toggle button for External; only Edit', () => {
    const view = buildDomainListView('ctx-ext-buttons', ['plugin_foo__greet'], getToolPrefs('ctx-ext-buttons'))
    const editButtons = view.buttons.filter((b) => b.text.includes('External'))
    expect(editButtons.every((b) => b.text.startsWith('✏️'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run and confirm failure**

```bash
bun test tests/commands/tool-config-view.test.ts -t 'external pseudo-domain'
```

Expected: FAIL.

- [ ] **Step 3: Add the External section to `buildDomainListView`**

In `src/commands/tool-config-view.ts`, after the existing domain loop and before the footer:

```ts
const externalNames = availableToolNames.filter((name) => getToolMetadata(name) === undefined)
if (externalNames.length > 0) {
  lines.push(`🧩 External — ${externalNames.length} tools`)
  const editCallback = callbackData(`tgl:open:external:${ctx}`, `tgl:o:ext:${ctx}`)
  if (editCallback !== null) {
    buttons.push({ text: '✏️ Edit External', callbackData: editCallback, style: 'secondary' })
  }
}
```

Add an `'external'` branch in `buildDomainDrillView` that lists `externalNames` instead of a metadata-domain:

```ts
if ((domain as string) === 'external') {
  const sortedExt = availableToolNames.filter((n) => getToolMetadata(n) === undefined).toSorted()
  const lines = ['🧰 **External tools** — tap a tool to cycle its permission.\n']
  const buttons: ChatButton[] = []
  for (const name of sortedExt) {
    const perm = resolveToolPermission(prefs, name)
    lines.push(`${permissionMarker(perm)} ${name}`)
    const toolCallback = callbackData(`tgl:tool:${name}:${ctx}`, null)
    if (toolCallback !== null) {
      buttons.push({
        text: `${permissionMarker(perm)} ${name}`,
        callbackData: toolCallback,
        style: perm === 'deny' ? 'secondary' : 'primary',
      })
    }
  }
  const backCallback = callbackData(`tgl:back:${ctx}`, `tgl:b:${ctx}`)
  if (backCallback !== null) buttons.push({ text: '⬅️ Back', callbackData: backCallback, style: 'secondary' })
  return { text: lines.join('\n'), buttons }
}
```

Update `resolveToolDomainCode` and `isToolDomain` in `src/chat/tool-toggle-interaction-handler.ts` to accept the literal string `'external'`. In the handler, guard the cycle path so `cycleDomain` is never called with `external` (since there's no metadata domain). The existing `open` branch already covers the drill-in.

- [ ] **Step 4: Run and confirm pass**

```bash
bun test tests/commands/tool-config-view.test.ts
bun test tests/chat/tool-toggle-interaction-handler.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/tool-config-view.ts src/chat/tool-toggle-interaction-handler.ts tests/
git commit -m "feat(commands): external pseudo-domain in tool config view"
```

### Task 6.4: `/config` summary line counts blocked + ask

**Files:**

- Modify: `src/commands/config.ts`
- Modify: `tests/commands/config.test.ts`

- [ ] **Step 1: Add failing test**

```ts
test('Tools section shows blocked and ask counts', async () => {
  setToolPrefs('ctx-cfg-summary', {
    domainDefaults: {},
    toolOverrides: { delete_task: 'deny', remove_attachment: 'ask' },
  })
  // Render the /config message for ctx-cfg-summary and assert it includes
  // "1 blocked" and "1 ask".
})
```

(Plug into the existing test for `/config` Tools section; follow that file's pattern.)

- [ ] **Step 2: Run and confirm failure**

```bash
bun test tests/commands/config.test.ts -t 'Tools section'
```

Expected: FAIL.

- [ ] **Step 3: Update the summary line in `src/commands/config.ts`**

Around line 163–165:

```ts
const toolPrefs = getToolPrefs(targetContextId)
const blocked =
  Object.values(toolPrefs.domainDefaults).filter((v) => v === 'deny').length +
  Object.values(toolPrefs.toolOverrides).filter((v) => v === 'deny').length
const ask =
  Object.values(toolPrefs.domainDefaults).filter((v) => v === 'ask').length +
  Object.values(toolPrefs.toolOverrides).filter((v) => v === 'ask').length
const toolsSummary = `🧰 Tools — ${blocked} blocked, ${ask} ask`
```

Use `toolsSummary` in the existing place that built the previous summary string.

- [ ] **Step 4: Run and confirm pass**

```bash
bun test tests/commands/config.test.ts -t 'Tools section'
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/config.ts tests/commands/config.test.ts
git commit -m "feat(commands): /config Tools summary counts blocked and ask"
```

---

## Phase 7 — Cleanup shims + final smoke check

### Task 7.1: Remove temporary `tool-preferences` shims

**Files:**

- Modify: `src/tools/tool-preferences.ts`

- [ ] **Step 1: Verify no callers remain**

```bash
grep -rn "isToolEnabled\|getDomainStatus\|toggleDomain\|toggleTool\b" src/ tests/
```

Expected: only the shim definitions in `src/tools/tool-preferences.ts` and possibly stale test references. Update or delete.

- [ ] **Step 2: Delete the shim block**

Delete the `// --- TEMPORARY SHIMS ---` block added in Task 3.2.

- [ ] **Step 3: Run typecheck + all tests**

```bash
bun typecheck && bun test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/tools/tool-preferences.ts
git commit -m "refactor(tools): drop temporary toggle/isToolEnabled shims"
```

### Task 7.2: Full check pipeline

**Files:** none

- [ ] **Step 1: Run full check**

```bash
bun check:full
```

Expected: all checks pass. If `bun lint:agent-strict` flags new files, fix the underlying issue (do not add suppression comments — hook policy blocks them).

- [ ] **Step 2: Run targeted test suites**

```bash
bun test tests/tools/ tests/chat/ tests/commands/ tests/system-prompt.test.ts
```

Expected: PASS.

- [ ] **Step 3: Manual smoke check (local Telegram instance)**

In a DM with the bot:

1. `/config` → 🧰 Tools — verify domain list shows 3-state markers and footer hint
2. Tap a domain — confirm it cycles `allow → ask → deny → allow`
3. Drill into a domain — confirm individual tool cycling works
4. Set `delete_task` to `ask` and `remove_attachment` to `deny`
5. Verify `/config` summary reads `🧰 Tools — 1 blocked, 1 ask`
6. Send: "delete task T-999"
7. Verify the bot posts the `🔐 Run \`delete_task\`?`prompt with`[✅ Allow] [🚫 Deny]` buttons and the LLM-supplied reason
8. Tap **Deny** — verify the message updates to `🚫 Denied delete_task`, and the LLM reports the denied result to the user
9. Re-issue, tap **Allow** — verify the tool executes and the result is reported
10. Re-issue, do not tap; wait 5 minutes — verify timeout fires and the bot reports the denied result
11. Re-issue and confirm a plugin tool marked `ask` from the External section is also gated

- [ ] **Step 4: Confirm no leftover stubs**

```bash
grep -rn "Phase [0-9]\|TODO(Phase\|Stub;" src/
```

Expected: no matches.

---

## Self-Review

**Spec coverage:**

- Storage model (Spec §Storage) → Phase 1 (Tasks 1.1–1.4)
- Runtime gate (Spec §Runtime gate) → Phase 2 (Tasks 2.1–2.3) + Phase 3 (Tasks 3.1–3.2)
- Cache strategy (Spec §Cache invalidation) → Phase 3 (Task 3.3)
- Schema extension (Spec §Schema extension) → Phase 2 (Task 2.2)
- System prompt fragment (Spec §System prompt fragment) → Phase 5
- Chat-layer prompt + registry (Spec §Chat layer) → Phase 4 (Tasks 4.1–4.3)
- UI 3-state markers, cycle, External, footer, /config summary (Spec §/config → 🧰 Tools UI) → Phase 6 (Tasks 6.1–6.4)
- Testing (Spec §Testing) → tests embedded in each task; full check in Task 7.2
- Process restart, group contexts, timeout (Spec §Chat layer) → tests in Tasks 4.1–4.2, behaviour in `permission-prompt.ts`

**Type consistency check:**

- `Permission` type used uniformly
- `ToolPrefs` shape: `domainDefaults` + `toolOverrides` everywhere
- `AskPermissionFn` signature `(req: { toolName: string; reason: string }) => Promise<'allow' | 'deny'>` used in: `permission-gate.ts`, `tool-preferences` orchestrator path, `types.ts`
- `PERMISSION_REASON_FIELD = '_permission_reason'` used as the schema field name and in `gatedExecute`'s strip step
- `resolvePermissionRequest` / `peekPermissionRequest` API surface used by both the prompt module and the handler
- Callback prefix `perm:[a|d]:<8charId>` consistent across `permission-prompt.ts`, `permission-interaction-handler.ts`, `interaction-router.ts`

No gaps found.

---

## Plan Header Note for Executors

Each task includes the failing test, the code, the verification command, and the commit. Phases land cleanly: Phase 3 introduces a temporary shim block in `tool-preferences.ts` that Phase 7 deletes after Phase 6 migrates the consumers. Cache split (Task 3.3) keeps the per-turn `askPermission` closure capturable while preserving the existing tool-build cache hit rate.
