<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# User-Configurable Tool Access ("Tool Toggles") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users (personal) and group managers (group) enable/disable the tools exposed to the LLM at domain-group granularity with per-tool overrides, while keeping the system prompt coherent with the effective tool set.

**Architecture:** A per-context JSON denylist (default all-on) stored in the existing config KV under a reserved `tool_prefs` key. `makeTools()` applies the denylist as a final filter (structural enforcement — disabled tools are physically absent from the `ToolSet`). `buildSystemPrompt()` is refactored into a core block plus domain-keyed fragments included only when ≥1 of their tools is enabled, plus a safety-net "do not use" line for partially-disabled domains. A "🧰 Tools" section in `/config` drives toggles through `tgl:` inline-button callbacks, mirroring the existing `plg:` plugin-toggle flow.

**Tech Stack:** Bun, TypeScript (strict, `.js` import extensions), Zod v4, Vercel AI SDK (`ToolSet`), Drizzle/SQLite (via config cache), `bun test`.

**Spec:** `docs/superpowers/specs/2026-05-25-user-configurable-tool-access-design.md`

**Conventions reminder:**
- Every new `.ts` file starts with the 4-line BUSL-1.1 `//` header (copy from any existing `src/**/*.ts`).
- Use `.js` extensions in imports.
- Never add `eslint-disable`/`@ts-ignore`; fix the underlying issue.
- Run `bun test <path>` for a single file; commit after each task.
- Error extraction: `error instanceof Error ? error.message : String(error)`.

---

## File Structure

**New files:**
- `src/tools/tool-preferences.ts` — `ToolPrefs` type, parse/serialize, read/write via config KV, effective-state evaluation, domain status, toggle helpers. Owns cache invalidation on write.
- `src/commands/tool-config-view.ts` — pure rendering of the Tools menu (domain list + per-domain drill-in) into status text + `ChatButton[]`.
- `src/chat/tool-toggle-interaction-handler.ts` — routes `tgl:` callbacks, applies toggles, re-renders the menu.
- Test files mirroring each under `tests/`.

**Modified files:**
- `src/cache.ts` — add `clearCachedToolsByPrefix(contextId)`.
- `src/tools/index.ts` — apply the preference filter inside `makeTools()`.
- `src/system-prompt.ts` — fragment refactor + optional `enabledToolNames` awareness.
- `src/llm-orchestrator-tools.ts` — return `enabledToolNames` from `prepareLlmInvocation`.
- `src/llm-orchestrator-types.ts` — add `enabledToolNames` to `InvokeModelArgs`.
- `src/llm-orchestrator.ts` — pass `enabledToolNames` into the invoke args.
- `src/llm-orchestrator-invoke.ts` — pass `enabledToolNames` to `buildSystemPrompt`.
- `src/deferred-prompts/proactive-llm.ts` — capture full set names, pass to `buildSystemPrompt`.
- `src/commands/config.ts` — add the "🧰 Tools" entry button + status line.
- `src/chat/interaction-router.ts` — route `tgl:` to the new handler.
- `CLAUDE.md`, `src/tools/CLAUDE.md`, `src/commands/CLAUDE.md` — document the feature.

---

## Task 1: Tool-preferences module + cache prefix clear

**Files:**
- Create: `src/tools/tool-preferences.ts`
- Modify: `src/cache.ts` (add `clearCachedToolsByPrefix`)
- Test: `tests/tools/tool-preferences.test.ts`

This task adds pure preference logic and storage with no behavior change to assembly yet.

- [ ] **Step 1: Add `clearCachedToolsByPrefix` to `src/cache.ts`**

Insert directly after the existing `clearCachedTools` function (currently `src/cache.ts:223-225`):

```typescript
/**
 * Clear cached tools for a context id and all of its derived group cache keys.
 * DM cache key is the bare contextId; group cache keys are `${contextId}:${chatUserId}:${username}`.
 */
export function clearCachedToolsByPrefix(contextId: string): void {
  const prefix = `${contextId}:`
  for (const [key, cache] of userCaches) {
    if (key === contextId || key.startsWith(prefix)) {
      cache.tools = null
    }
  }
  log.debug({ contextId }, 'Cleared cached tools by prefix')
}
```

- [ ] **Step 2: Write the failing test for `tool-preferences`**

Create `tests/tools/tool-preferences.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import {
  getDomainStatus,
  isToolEnabled,
  parseToolPrefs,
  partitionToolNames,
  serializeToolPrefs,
  toggleDomain,
  toggleTool,
  type ToolPrefs,
} from '../../src/tools/tool-preferences.js'

const empty: ToolPrefs = { disabledDomains: [], toolOverrides: {} }

describe('parseToolPrefs', () => {
  it('returns empty prefs for null', () => {
    expect(parseToolPrefs(null)).toEqual(empty)
  })

  it('returns empty prefs for corrupt JSON', () => {
    expect(parseToolPrefs('{not json')).toEqual(empty)
  })

  it('coerces missing fields and drops non-array/object shapes', () => {
    expect(parseToolPrefs('{"disabledDomains":"web"}')).toEqual(empty)
  })

  it('round-trips a valid blob', () => {
    const prefs: ToolPrefs = { disabledDomains: ['web'], toolOverrides: { delete_task: false } }
    expect(parseToolPrefs(serializeToolPrefs(prefs))).toEqual(prefs)
  })
})

describe('isToolEnabled', () => {
  it('defaults every tool to enabled with empty prefs', () => {
    expect(isToolEnabled(empty, 'web_fetch')).toBe(true)
    expect(isToolEnabled(empty, 'delete_task')).toBe(true)
  })

  it('disables every tool in a disabled domain', () => {
    const prefs: ToolPrefs = { disabledDomains: ['web'], toolOverrides: {} }
    expect(isToolEnabled(prefs, 'web_fetch')).toBe(false)
  })

  it('lets a per-tool override win over the domain default (off within on domain)', () => {
    const prefs: ToolPrefs = { disabledDomains: [], toolOverrides: { delete_task: false } }
    expect(isToolEnabled(prefs, 'delete_task')).toBe(false)
    expect(isToolEnabled(prefs, 'create_task')).toBe(true)
  })

  it('lets a per-tool override win over the domain default (on within off domain)', () => {
    const prefs: ToolPrefs = { disabledDomains: ['web'], toolOverrides: { web_fetch: true } }
    expect(isToolEnabled(prefs, 'web_fetch')).toBe(true)
  })

  it('treats unknown (un-classified) tools as always enabled', () => {
    const prefs: ToolPrefs = { disabledDomains: ['web'], toolOverrides: {} }
    expect(isToolEnabled(prefs, 'plugin_hello_world__greet')).toBe(true)
  })
})

describe('partitionToolNames', () => {
  it('splits candidate names into enabled and disabled sets', () => {
    const prefs: ToolPrefs = { disabledDomains: [], toolOverrides: { delete_task: false } }
    const { enabled, disabled } = partitionToolNames(prefs, ['create_task', 'delete_task', 'web_fetch'])
    expect([...enabled].sort()).toEqual(['create_task', 'web_fetch'])
    expect([...disabled]).toEqual(['delete_task'])
  })
})

describe('getDomainStatus', () => {
  it('reports on when nothing in the domain is disabled', () => {
    expect(getDomainStatus(empty, 'task', ['create_task', 'delete_task'])).toBe('on')
  })

  it('reports off when the whole domain is disabled and no overrides re-enable', () => {
    const prefs: ToolPrefs = { disabledDomains: ['task'], toolOverrides: {} }
    expect(getDomainStatus(prefs, 'task', ['create_task', 'delete_task'])).toBe('off')
  })

  it('reports partial when some tools in the domain differ from the rest', () => {
    const prefs: ToolPrefs = { disabledDomains: [], toolOverrides: { delete_task: false } }
    expect(getDomainStatus(prefs, 'task', ['create_task', 'delete_task'])).toBe('partial')
  })
})

describe('toggleDomain', () => {
  it('flips an on domain to off and prunes redundant overrides', () => {
    const prefs: ToolPrefs = { disabledDomains: [], toolOverrides: { delete_task: false } }
    const next = toggleDomain(prefs, 'task', ['create_task', 'delete_task'])
    expect(next.disabledDomains).toContain('task')
    // delete_task override (false) now equals the domain default (off) -> pruned
    expect(next.toolOverrides['delete_task']).toBeUndefined()
  })

  it('flips an off domain back to on', () => {
    const prefs: ToolPrefs = { disabledDomains: ['task'], toolOverrides: {} }
    const next = toggleDomain(prefs, 'task', ['create_task'])
    expect(next.disabledDomains).not.toContain('task')
  })
})

describe('toggleTool', () => {
  it('disables a single tool inside an on domain via an override', () => {
    const next = toggleTool(empty, 'delete_task', ['create_task', 'delete_task'])
    expect(next.toolOverrides['delete_task']).toBe(false)
  })

  it('prunes the override when it returns to matching the domain default', () => {
    const prefs: ToolPrefs = { disabledDomains: [], toolOverrides: { delete_task: false } }
    const next = toggleTool(prefs, 'delete_task', ['create_task', 'delete_task'])
    expect(next.toolOverrides['delete_task']).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test tests/tools/tool-preferences.test.ts`
Expected: FAIL — module `src/tools/tool-preferences.js` does not exist.

- [ ] **Step 4: Implement `src/tools/tool-preferences.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getCachedConfig, setCachedConfig, clearCachedToolsByPrefix } from '../cache.js'
import { logger } from '../logger.js'
import { getToolMetadata, type ToolDomain } from './tool-metadata.js'

const log = logger.child({ scope: 'tools:preferences' })

/** Reserved, non-user-visible config key holding the per-context tool denylist JSON. */
export const TOOL_PREFS_CONFIG_KEY = 'tool_prefs'

export interface ToolPrefs {
  /** Domains turned off wholesale. */
  disabledDomains: ToolDomain[]
  /** Per-tool overrides that win over the domain default. true = force on, false = force off. */
  toolOverrides: Record<string, boolean>
}

const EMPTY_PREFS: ToolPrefs = { disabledDomains: [], toolOverrides: {} }

function emptyPrefs(): ToolPrefs {
  return { disabledDomains: [], toolOverrides: {} }
}

export function parseToolPrefs(raw: string | null): ToolPrefs {
  if (raw === null || raw.trim() === '') return emptyPrefs()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return emptyPrefs()
    const record = parsed as Record<string, unknown>
    const disabledDomains = Array.isArray(record['disabledDomains'])
      ? (record['disabledDomains'].filter((d): d is ToolDomain => typeof d === 'string') as ToolDomain[])
      : []
    const overridesRaw = record['toolOverrides']
    const toolOverrides: Record<string, boolean> = {}
    if (typeof overridesRaw === 'object' && overridesRaw !== null) {
      for (const [name, value] of Object.entries(overridesRaw as Record<string, unknown>)) {
        if (typeof value === 'boolean') toolOverrides[name] = value
      }
    }
    return { disabledDomains, toolOverrides }
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Corrupt tool_prefs; using empty prefs')
    return emptyPrefs()
  }
}

export function serializeToolPrefs(prefs: ToolPrefs): string {
  return JSON.stringify({ disabledDomains: prefs.disabledDomains, toolOverrides: prefs.toolOverrides })
}

export function getToolPrefs(contextId: string): ToolPrefs {
  return parseToolPrefs(getCachedConfig(contextId, TOOL_PREFS_CONFIG_KEY))
}

/** Persist prefs for a context and invalidate the context's cached tool sets. */
export function setToolPrefs(contextId: string, prefs: ToolPrefs): void {
  setCachedConfig(contextId, TOOL_PREFS_CONFIG_KEY, serializeToolPrefs(prefs))
  clearCachedToolsByPrefix(contextId)
  log.info({ contextId, disabledDomains: prefs.disabledDomains.length }, 'Tool prefs updated')
}

/** Domain default: true (on) unless the domain is in disabledDomains. */
function domainEnabled(prefs: ToolPrefs, domain: ToolDomain): boolean {
  return !prefs.disabledDomains.includes(domain)
}

export function isToolEnabled(prefs: ToolPrefs, toolName: string): boolean {
  const override = prefs.toolOverrides[toolName]
  if (override !== undefined) return override
  const meta = getToolMetadata(toolName)
  if (meta === undefined) return true // un-classified tools (e.g. plugin tools) are never grouped/disabled here
  return domainEnabled(prefs, meta.domain)
}

export function partitionToolNames(
  prefs: ToolPrefs,
  names: readonly string[],
): { enabled: Set<string>; disabled: Set<string> } {
  const enabled = new Set<string>()
  const disabled = new Set<string>()
  for (const name of names) {
    if (isToolEnabled(prefs, name)) enabled.add(name)
    else disabled.add(name)
  }
  return { enabled, disabled }
}

export type DomainStatus = 'on' | 'off' | 'partial'

export function getDomainStatus(prefs: ToolPrefs, domain: ToolDomain, domainToolNames: readonly string[]): DomainStatus {
  if (domainToolNames.length === 0) return domainEnabled(prefs, domain) ? 'on' : 'off'
  const states = domainToolNames.map((name) => isToolEnabled(prefs, name))
  const allOn = states.every((s) => s)
  const allOff = states.every((s) => !s)
  if (allOn) return 'on'
  if (allOff) return 'off'
  return 'partial'
}

/** Remove overrides that now equal the domain default, keeping the blob minimal. */
function pruneRedundantOverrides(prefs: ToolPrefs): ToolPrefs {
  const toolOverrides: Record<string, boolean> = {}
  for (const [name, value] of Object.entries(prefs.toolOverrides)) {
    const meta = getToolMetadata(name)
    const def = meta === undefined ? true : domainEnabled(prefs, meta.domain)
    if (value !== def) toolOverrides[name] = value
  }
  return { disabledDomains: [...prefs.disabledDomains], toolOverrides }
}

/** Toggle a whole domain on/off, dropping per-tool overrides that become redundant. */
export function toggleDomain(prefs: ToolPrefs, domain: ToolDomain, domainToolNames: readonly string[]): ToolPrefs {
  const currentlyOn = getDomainStatus(prefs, domain, domainToolNames) !== 'off'
  const disabledDomains = prefs.disabledDomains.filter((d) => d !== domain)
  if (currentlyOn) disabledDomains.push(domain)
  // Clear per-tool overrides within the domain so the bulk action wins cleanly.
  const toolOverrides: Record<string, boolean> = {}
  for (const [name, value] of Object.entries(prefs.toolOverrides)) {
    const meta = getToolMetadata(name)
    if (meta !== undefined && meta.domain === domain) continue
    toolOverrides[name] = value
  }
  return pruneRedundantOverrides({ disabledDomains, toolOverrides })
}

/** Toggle a single tool, expressed as an override; prunes when it matches the domain default. */
export function toggleTool(prefs: ToolPrefs, toolName: string, _domainToolNames: readonly string[]): ToolPrefs {
  const next = !isToolEnabled(prefs, toolName)
  const toolOverrides = { ...prefs.toolOverrides, [toolName]: next }
  return pruneRedundantOverrides({ disabledDomains: [...prefs.disabledDomains], toolOverrides })
}

void EMPTY_PREFS
```

> Note: the unused `EMPTY_PREFS`/`void EMPTY_PREFS` lines are not needed — delete the `const EMPTY_PREFS` declaration and the trailing `void EMPTY_PREFS;` before finishing if `knip`/lint flag them. They are omitted from the final file; use `emptyPrefs()` everywhere.

- [ ] **Step 5: Remove the dead `EMPTY_PREFS` constant**

Delete the `const EMPTY_PREFS: ToolPrefs = ...` line and the trailing `void EMPTY_PREFS` line from the file written in Step 4. The module should reference only `emptyPrefs()`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test tests/tools/tool-preferences.test.ts`
Expected: PASS (all cases).

- [ ] **Step 7: Lint/typecheck the touched files**

Run: `bun lint:agent-strict -- src/tools/tool-preferences.ts src/cache.ts && bun typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/tools/tool-preferences.ts src/cache.ts tests/tools/tool-preferences.test.ts
git commit -m "feat(tools): add per-context tool preferences module + cache prefix clear"
```

---

## Task 2: Apply the preference filter in `makeTools()`

**Files:**
- Modify: `src/tools/index.ts`
- Test: `tests/tools/make-tools-preferences.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/tools/make-tools-preferences.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'

import { userCachesForTesting } from '../../src/cache.js'
import { makeTools } from '../../src/tools/index.js'
import { setToolPrefs } from '../../src/tools/tool-preferences.js'
import { makeFakeProvider } from '../utils/test-helpers.js'

const CONTEXT = 'test-tool-prefs-user'

afterEach(() => {
  userCachesForTesting.delete(CONTEXT)
})

describe('makeTools preference filtering', () => {
  it('returns the full set when no prefs are configured', () => {
    const provider = makeFakeProvider()
    const tools = makeTools(provider, { storageContextId: CONTEXT, chatUserId: CONTEXT, contextType: 'dm' })
    expect(Object.keys(tools)).toContain('create_task')
  })

  it('removes a tool whose domain is disabled', () => {
    const provider = makeFakeProvider()
    setToolPrefs(CONTEXT, { disabledDomains: ['memo'], toolOverrides: {} })
    const tools = makeTools(provider, { storageContextId: CONTEXT, chatUserId: CONTEXT, contextType: 'dm' })
    expect(Object.keys(tools)).not.toContain('save_memo')
    expect(Object.keys(tools)).toContain('create_task')
  })

  it('honors a per-tool override that disables one tool in an enabled domain', () => {
    const provider = makeFakeProvider()
    setToolPrefs(CONTEXT, { disabledDomains: [], toolOverrides: { create_task: false } })
    const tools = makeTools(provider, { storageContextId: CONTEXT, chatUserId: CONTEXT, contextType: 'dm' })
    expect(Object.keys(tools)).not.toContain('create_task')
    expect(Object.keys(tools)).toContain('search_tasks')
  })
})
```

> If `makeFakeProvider` does not exist in `tests/utils/test-helpers.ts`, check that file for the existing fake/stub provider helper name (commonly used across `tests/tools/*`) and use that instead. Read an existing `tests/tools/*.test.ts` to copy the exact provider-construction pattern this repo uses.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/tools/make-tools-preferences.test.ts`
Expected: FAIL — the disabled tools are still present (filter not yet applied).

- [ ] **Step 3: Apply the filter in `src/tools/index.ts`**

Add the import near the other tool imports:

```typescript
import { getToolPrefs, partitionToolNames } from './tool-preferences.js'
```

Add this helper above `makeTools`:

```typescript
function applyToolPreferences(tools: ToolSet, contextId: string | undefined): ToolSet {
  if (contextId === undefined) return tools
  const prefs = getToolPrefs(contextId)
  if (prefs.disabledDomains.length === 0 && Object.keys(prefs.toolOverrides).length === 0) return tools
  const { enabled } = partitionToolNames(prefs, Object.keys(tools))
  return Object.fromEntries(Object.entries(tools).filter(([name]) => enabled.has(name)))
}
```

Replace the two `return` statements at the end of `makeTools` (currently `src/tools/index.ts:60` and `:64`) so the final set is filtered. The function currently ends:

```typescript
      return { ...wrappedBuiltins, ...pluginTools }
    }
  }

  return wrappedBuiltins
}
```

Change to:

```typescript
      return applyToolPreferences({ ...wrappedBuiltins, ...pluginTools }, contextId)
    }
  }

  return applyToolPreferences(wrappedBuiltins, contextId)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/tools/make-tools-preferences.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the existing tool-assembly suite for regressions**

Run: `bun test tests/tools/`
Expected: PASS (empty-prefs path leaves existing behavior unchanged).

- [ ] **Step 6: Lint/typecheck**

Run: `bun lint:agent-strict -- src/tools/index.ts && bun typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/tools/index.ts tests/tools/make-tools-preferences.test.ts
git commit -m "feat(tools): filter disabled tools out of makeTools by context preferences"
```

---

## Task 3: System-prompt fragment refactor + enabled-set awareness

**Files:**
- Modify: `src/system-prompt.ts`
- Test: `tests/system-prompt.test.ts` (extend if it exists; otherwise create)

**Behavior contract:**
- `buildSystemPrompt(provider, contextId)` (no enabled set) → identical output to today (all fragments, no safety-net line). Backward-compatible.
- `buildSystemPrompt(provider, contextId, enabledToolNames)` → include a domain fragment only if ≥1 of its tools is in `enabledToolNames`; append a safety-net line listing **partially-disabled** tools (a tool disabled by prefs whose domain still has ≥1 enabled tool).

- [ ] **Step 1: Write the failing test**

Create or extend `tests/system-prompt.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { buildSystemPrompt } from '../src/system-prompt.js'
import { makeFakeProvider } from './utils/test-helpers.js'

const CTX = 'sysprompt-test-ctx'

describe('buildSystemPrompt fragment coherence', () => {
  it('includes the web-fetch fragment when web_fetch is enabled', () => {
    const provider = makeFakeProvider()
    const enabled = new Set(['web_fetch', 'create_task', 'get_current_time'])
    const prompt = buildSystemPrompt(provider, CTX, enabled)
    expect(prompt).toContain('WEB FETCH')
  })

  it('omits the web-fetch fragment when web_fetch is not enabled', () => {
    const provider = makeFakeProvider()
    const enabled = new Set(['create_task', 'get_current_time'])
    const prompt = buildSystemPrompt(provider, CTX, enabled)
    expect(prompt).not.toContain('WEB FETCH')
  })

  it('omits the recurring-tasks fragment when no recurring tool is enabled', () => {
    const provider = makeFakeProvider()
    const enabled = new Set(['create_task', 'get_current_time'])
    const prompt = buildSystemPrompt(provider, CTX, enabled)
    expect(prompt).not.toContain('RECURRING TASKS')
  })

  it('emits a safety-net line for a partially-disabled domain (task on, delete_task off)', () => {
    const provider = makeFakeProvider()
    // task domain present (create_task enabled) but delete_task is NOT in the enabled set
    const enabled = new Set(['create_task', 'update_task', 'search_tasks', 'get_current_time'])
    const prompt = buildSystemPrompt(provider, CTX, enabled)
    expect(prompt).toContain('Unavailable tools')
    expect(prompt).toContain('delete_task')
  })

  it('preserves legacy output (no safety-net line) when no enabled set is passed', () => {
    const provider = makeFakeProvider()
    const prompt = buildSystemPrompt(provider, CTX)
    expect(prompt).not.toContain('Unavailable tools')
    expect(prompt).toContain('RECURRING TASKS')
    expect(prompt).toContain('WEB FETCH')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/system-prompt.test.ts`
Expected: FAIL — `buildSystemPrompt` does not accept a third arg / fragments are not conditional.

- [ ] **Step 3: Rewrite `src/system-prompt.ts`**

Replace the whole file with the fragment-composed version below. The fragment text is copied verbatim from the current `BASE_PROMPT`/`STATIC_RULES`; only the structure changes.

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { buildInstructionsBlock } from './instructions.js'
import { buildPluginPromptSection } from './plugins/prompt-contributions.js'
import { getPluginsForContext } from './plugins/registry.js'
import type { TaskProvider } from './providers/types.js'
import { getToolPrefs, isToolEnabled, type ToolPrefs } from './tools/tool-preferences.js'
import { getToolMetadata } from './tools/tool-metadata.js'

const CORE_INTRO = `You are papai, a personal assistant that helps the user manage their tasks.

When the user asks you to do something, figure out which tool(s) to call and execute them autonomously — fetch any missing context (projects, columns, task details) with additional tool calls before acting, without asking the user.

TIME — For any date or time queries, use the get_current_time tool to get the current date and time before performing calculations.`

const DUE_DATES = `DUE DATES — When the user mentions a due date or time:
- Express dates as { date: "YYYY-MM-DD" } and times as { time: "HH:MM" } in 24-hour local time — the tool handles UTC conversion.
- "tomorrow at 5pm" → dueDate: { date: "YYYY-MM-DD", time: "17:00" } (tomorrow's date).
- "end of day" → dueDate: { date: "YYYY-MM-DD", time: "23:59" }.
- "next Monday" → dueDate: { date: "YYYY-MM-DD" } (date only, no time field).`

const RECURRING = `RECURRING TASKS — The user can set up tasks that repeat automatically:
- "cron" trigger: Use create_recurring_task with triggerType "cron" and a schedule object.
  - schedule.freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY"
  - schedule.byDay: weekday codes e.g. ["MO"] for Monday, ["MO","WE","FR"] for Mon/Wed/Fri
  - schedule.byHour / schedule.byMinute: local-time arrays, e.g. byHour: [9], byMinute: [0] for 9:00 am
  - schedule.interval: optional, e.g. interval: 2 with freq "WEEKLY" = every 2 weeks
  - schedule.byMonthDay: optional day-of-month array, e.g. [1] for the 1st of each month
  - Examples: "every Monday at 9am" → { freq: "WEEKLY", byDay: ["MO"], byHour: [9], byMinute: [0] }
  - "weekdays at 9am" → { freq: "WEEKLY", byDay: ["MO","TU","WE","TH","FR"], byHour: [9], byMinute: [0] }
  - "1st of each month at 10am" → { freq: "MONTHLY", byMonthDay: [1], byHour: [10], byMinute: [0] }
- "on_complete" trigger: creates the next task only after the current one is marked done. Use triggerType "on_complete" (no schedule needed).
- Use list_recurring_tasks to show all recurring definitions. Use pause/resume/skip/delete tools to manage them.
- When resuming, set createMissed=true to retroactively create tasks for missed cycles during the pause.
- When the user says "stop" or "cancel" a recurring task, use delete_recurring_task.
- When they say "pause", use pause_recurring_task. When "skip the next one", use skip_recurring_task.`

const DEFERRED = `DEFERRED PROMPTS — The user can set up automated tasks and alerts:
- SCHEDULED PROMPTS: Use create_deferred_prompt with a schedule to set up one-time or recurring LLM tasks.
  - One-time: provide schedule.fire_at as { date: "YYYY-MM-DD", time: "HH:MM" } in local time — tool converts to UTC.
  - Recurring: provide schedule.rrule with freq and optional byDay/byHour/byMinute.
  - freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY"
  - byDay: weekday codes e.g. ["MO"] for Monday, ["MO","WE","FR"] for Mon/Wed/Fri
  - byHour / byMinute: local-time hour and minute arrays, e.g. byHour: [9], byMinute: [0] for 9:00 am
  - "every Monday at 9am" → { freq: "WEEKLY", byDay: ["MO"], byHour: [9], byMinute: [0] }
  - "daily at 9am" → { freq: "DAILY", byHour: [9], byMinute: [0] }
- ALERTS: Use create_deferred_prompt with a condition to monitor task changes.
  - Conditions use a filter schema: { field, op, value }. Fields: task.status, task.priority, task.assignee, task.dueDate, task.project, task.labels.
  - Operators: eq, neq, changed_to, lt, gt, overdue, contains, not_contains.
  - Combine with { and: [...] } or { or: [...] }.
  - Set cooldown_minutes to control how often alerts can fire (default: 60 minutes).
- Use list_deferred_prompts to show active prompts/alerts. Use cancel_deferred_prompt to cancel one.
- For daily briefings, use schedule.rrule: { freq: "DAILY", byHour: [9], byMinute: [0] }.
- PROMPT CONTENT: When creating a deferred prompt, the prompt field should describe the deliverable action, not the scheduling. Write it as what to DO when it fires, not what to SCHEDULE. Good: "Tell the user to check the gigachat model". Bad: "Remind the user in 5 minutes to check the gigachat model". The schedule handles timing; the prompt handles content.`

const PROACTIVE = `PROACTIVE MODE — When you receive a [PROACTIVE EXECUTION] system message at the end of the conversation, a deferred prompt has fired. You are delivering a previously scheduled result to the user. The user message marked with ===DEFERRED_TASK=== is the stored prompt — fulfill it directly. For reminders, deliver the message conversationally. For actions, execute them with tools and report the result. Never create new deferred prompts during proactive execution. Never mention triggers, cron jobs, or scheduling internals. Be warm and concise.`

const WEB_FETCH = `WEB FETCH — When the user shares or refers back to a public URL and you need the page contents, call web_fetch. Use its returned summary/excerpt as source material for your answer. Only save the result via memo/task tools if the user explicitly asks you to persist it.`

const WORKFLOW = `WORKFLOW:
1. Understand the user's intent from natural language.
2. Gather context if needed (e.g. call list_projects to resolve a project name, call list_columns before setting a task status).
3. Call the appropriate tool(s) to fulfil the request.
4. Reply with a concise confirmation.

AMBIGUITY — When the user's phrasing implies a single target (uses "the task", "it", "that one", or a specific title) but the search returns multiple equally-likely candidates, ask ONE short question to disambiguate before acting. When the phrasing implies multiple targets ("all", "every", "these", plural nouns), operate on all matches without asking. For referential phrases ("move it", "close that"), resolve from conversation context first; only ask if truly unresolvable.`

const DESTRUCTIVE = `DESTRUCTIVE ACTIONS — delete_task, delete_project, delete_column, remove_label:
These tools require a confidence field (0–1) reflecting how explicitly the user requested the action.
- Set 1.0 when the user has already confirmed (e.g. replied "yes").
- Set 0.9 for a direct, unambiguous command ("archive the Auth project").
- Set ≤0.7 when the intent is indirect or inferred.
If the tool returns { status: "confirmation_required", message: "..." }, send the message to the user as a natural question and wait for their reply before retrying the tool call with confidence 1.0.`

const RELATIONS = `RELATION TYPES — map user language to the correct type when calling add_task_relation / update_task_relation:
- "depends on" / "blocked by" / "waiting on" → blocked_by
- "blocks" / "is blocking" → blocks
- "duplicate of" / "same as" / "copy of" / "identical to" → duplicate
- "child of" / "subtask of" / "part of" → parent
- "related to" / "linked to" / anything else → related`

const MEMOS = `MEMOS — Personal notes and observations:
- When the user shares information, a thought, a link, or a fact (not actionable work), call save_memo. Populate tags from any hashtags, "tag: X" mentions, or inferred topics.
- When the user wants to act on something (a task to complete), call create_task instead.
- When searching memos, explain why each result matched (e.g. "This note matched because it mentions…").
- To promote a memo to a task, call search_memos or list_memos first to get the memo_id, then call promote_memo.`

const OUTPUT_CORE = `OUTPUT RULES:
- When referencing tasks or projects, format them as Markdown links: [Task title](url). Never output raw IDs.
- Keep replies short and friendly. Don't use tables.`

const INSTRUCTIONS_RULE = `- When the user expresses a persistent preference ("always", "never", "from now on"), call save_instruction. To list them, call list_instructions. To remove one, call list_instructions first, then delete_instruction.`

interface PromptFragment {
  readonly text: string
  /** Fragment is included when at least one of these tools is enabled. Empty = always. */
  readonly requiredTools: readonly string[]
}

// Order here defines prompt order. Empty requiredTools = always included.
const FRAGMENTS: readonly PromptFragment[] = [
  { text: DUE_DATES, requiredTools: ['create_task', 'update_task'] },
  { text: RECURRING, requiredTools: ['create_recurring_task', 'list_recurring_tasks'] },
  { text: DEFERRED, requiredTools: ['create_deferred_prompt', 'list_deferred_prompts'] },
  { text: PROACTIVE, requiredTools: [] },
  { text: WEB_FETCH, requiredTools: ['web_fetch'] },
  { text: WORKFLOW, requiredTools: [] },
  { text: DESTRUCTIVE, requiredTools: ['delete_task', 'delete_project', 'delete_status', 'remove_label'] },
  { text: RELATIONS, requiredTools: ['add_task_relation', 'update_task_relation'] },
  { text: MEMOS, requiredTools: ['save_memo', 'search_memos', 'list_memos'] },
]

function fragmentIncluded(fragment: PromptFragment, enabled: ReadonlySet<string> | undefined): boolean {
  if (enabled === undefined) return true
  if (fragment.requiredTools.length === 0) return true
  return fragment.requiredTools.some((name) => enabled.has(name))
}

function buildOutputRules(enabled: ReadonlySet<string> | undefined): string {
  const includeInstructions = enabled === undefined || enabled.has('save_instruction')
  return includeInstructions ? `${OUTPUT_CORE}\n${INSTRUCTIONS_RULE}` : OUTPUT_CORE
}

/**
 * Safety-net: list tools that are disabled by prefs but whose domain still has at least
 * one enabled tool (a "partial" disable). Whole-domain disables are already handled by
 * fragment exclusion, so they are intentionally not repeated here.
 */
function buildUnavailableLine(
  prefs: ToolPrefs,
  enabled: ReadonlySet<string>,
): string | null {
  const enabledDomains = new Set<string>()
  for (const name of enabled) {
    const meta = getToolMetadata(name)
    if (meta !== undefined) enabledDomains.add(meta.domain)
  }
  const names = new Set<string>()
  for (const [name, value] of Object.entries(prefs.toolOverrides)) {
    if (value === true) continue
    const meta = getToolMetadata(name)
    if (meta !== undefined && enabledDomains.has(meta.domain) && !enabled.has(name)) names.add(name)
  }
  if (names.size === 0) return null
  return `Unavailable tools — do not use or mention: ${[...names].sort().join(', ')}.`
}

export const buildSystemPrompt = (
  provider: TaskProvider,
  contextId: string,
  enabledToolNames?: ReadonlySet<string>,
): string => {
  const parts: string[] = [CORE_INTRO]
  for (const fragment of FRAGMENTS) {
    if (fragmentIncluded(fragment, enabledToolNames)) parts.push(fragment.text)
  }
  parts.push(buildOutputRules(enabledToolNames))

  if (enabledToolNames !== undefined) {
    const line = buildUnavailableLine(getToolPrefs(contextId), enabledToolNames)
    if (line !== null) parts.push(line)
  }

  const basePromptBody = parts.join('\n\n')
  const addendum = provider.getPromptAddendum()
  const basePrompt = `${buildInstructionsBlock(contextId)}${addendum === '' ? basePromptBody : `${basePromptBody}\n\n${addendum}`}`

  const activePlugins = getPluginsForContext(contextId)
  if (activePlugins.length === 0) return basePrompt

  const activePluginIds = activePlugins.map((p) => p.manifest.id)
  const pluginSection = buildPluginPromptSection(activePluginIds)
  if (pluginSection === '') return basePrompt

  return `${basePrompt}\n\n${pluginSection}`
}
```

> The function-ordering of declarations vs. use inside the module may trip a `no-use-before-define` lint rule. If `bun lint:agent-strict` flags it, move the `const FRAGMENTS`/helper declarations above `buildSystemPrompt` (they already are) — the exported arrow function is last, which is correct.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/system-prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the broader suite that touches the prompt**

Run: `bun test tests/system-prompt.test.ts tests/llm-orchestrator*.test.ts`
Expected: PASS. If a snapshot of the exact prompt string exists and now differs by whitespace, update the snapshot deliberately (the legacy no-arg path must remain semantically identical — same sections, same order).

- [ ] **Step 6: Lint/typecheck**

Run: `bun lint:agent-strict -- src/system-prompt.ts && bun typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/system-prompt.ts tests/system-prompt.test.ts
git commit -m "feat(prompt): compose system prompt from tool-gated fragments + safety-net line"
```

---

## Task 4: Thread the enabled-tool set into the prompt builders

**Files:**
- Modify: `src/llm-orchestrator-tools.ts`, `src/llm-orchestrator-types.ts`, `src/llm-orchestrator.ts`, `src/llm-orchestrator-invoke.ts`, `src/deferred-prompts/proactive-llm.ts`
- Test: `tests/llm-orchestrator-tools.test.ts` (extend or create)

The enabled set is the **full configured set before per-message routing** (`Object.keys(makeTools(...))`).

- [ ] **Step 1: Write the failing test**

Add to `tests/llm-orchestrator-tools.test.ts` (create if missing, copying provider/setup patterns from a neighboring orchestrator test):

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { prepareLlmInvocation } from '../src/llm-orchestrator-tools.js'
import { makeFakeProvider } from './utils/test-helpers.js'

describe('prepareLlmInvocation enabledToolNames', () => {
  it('returns the full pre-routing enabled tool-name set', () => {
    const provider = makeFakeProvider()
    const result = prepareLlmInvocation(
      'ctx-1',
      'ctx-1',
      'ctx-1',
      null,
      'dm',
      provider,
      [],
      'hello there',
      undefined,
    )
    expect(result.enabledToolNames instanceof Set).toBe(true)
    expect(result.enabledToolNames.has('create_task')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/llm-orchestrator-tools.test.ts`
Expected: FAIL — `enabledToolNames` is not on the return value.

- [ ] **Step 3: Return `enabledToolNames` from `prepareLlmInvocation`**

In `src/llm-orchestrator-tools.ts`, change the return type and value of `prepareLlmInvocation` (currently `src/llm-orchestrator-tools.ts:57-89`). After `const fullTools = getOrCreateTools(...)` add:

```typescript
  const enabledToolNames = new Set(Object.keys(fullTools))
```

Update the function's return type annotation and final `return`:

```typescript
): {
  routingResult: ReturnType<typeof routeToolsForMessage>
  validatedMessages: ModelMessage[]
  enabledToolNames: ReadonlySet<string>
} => {
```

```typescript
  return { routingResult, validatedMessages, enabledToolNames }
```

- [ ] **Step 4: Add `enabledToolNames` to `InvokeModelArgs`**

In `src/llm-orchestrator-types.ts`, add the field to the `InvokeModelArgs` type (after `tools: ToolSet`):

```typescript
  tools: ToolSet
  enabledToolNames: ReadonlySet<string>
```

- [ ] **Step 5: Pass it through in `src/llm-orchestrator.ts`**

In the `invokeModelWithTyping` call (currently `src/llm-orchestrator.ts:174-186`), add `enabledToolNames: routingResult` is wrong — use the new return field. The destructure at `src/llm-orchestrator.ts:163` becomes:

```typescript
  const { routingResult, validatedMessages, enabledToolNames } = prepareLlmInvocation(
```

and add to the invoke args object (next to `tools: routingResult.tools,`):

```typescript
    tools: routingResult.tools,
    enabledToolNames,
```

- [ ] **Step 6: Use it in `src/llm-orchestrator-invoke.ts`**

In `invokeModel` (currently `src/llm-orchestrator-invoke.ts:147-173`), destructure `enabledToolNames` from `args` and pass it to `buildSystemPrompt`:

```typescript
  const { contextId, chatUserId, contextType, mainModel, model, provider, tools, messages, deps, reply, turnId, enabledToolNames } = args
```

```typescript
    system: buildSystemPrompt(provider, contextId, enabledToolNames),
```

- [ ] **Step 7: Pass the enabled set in the proactive full path**

In `src/deferred-prompts/proactive-llm.ts`, change `buildFullToolSet` (currently `:197-211`) to also return the full names, and use them in `invokeFull`:

```typescript
function buildFullToolSet(
  provider: TaskProvider,
  createdByUserId: string,
  storageContextId: string,
  contextType: 'dm' | 'group',
  prompt: string,
): { tools: ToolSet; enabledToolNames: ReadonlySet<string> } {
  const fullTools = makeTools(provider, {
    storageContextId,
    chatUserId: createdByUserId,
    mode: 'proactive',
    contextType,
  })
  return { tools: routeToolsForMessage(prompt, fullTools).tools, enabledToolNames: new Set(Object.keys(fullTools)) }
}
```

In `invokeFull` (currently `:236-276`), replace the two relevant lines:

```typescript
  const { tools, enabledToolNames } = buildFullToolSet(
    provider,
    createdByUserId,
    storageContextId,
    deliveryTarget.contextType,
    prompt,
  )
  const systemPrompt = buildSystemPrompt(provider, createdByUserId, enabledToolNames)
```

- [ ] **Step 8: Run tests**

Run: `bun test tests/llm-orchestrator-tools.test.ts tests/system-prompt.test.ts && bun test tests/deferred-prompts/`
Expected: PASS.

- [ ] **Step 9: Lint/typecheck**

Run: `bun lint:agent-strict -- src/llm-orchestrator-tools.ts src/llm-orchestrator-types.ts src/llm-orchestrator.ts src/llm-orchestrator-invoke.ts src/deferred-prompts/proactive-llm.ts && bun typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/llm-orchestrator-tools.ts src/llm-orchestrator-types.ts src/llm-orchestrator.ts src/llm-orchestrator-invoke.ts src/deferred-prompts/proactive-llm.ts tests/llm-orchestrator-tools.test.ts
git commit -m "feat(prompt): pass effective enabled tool set into system-prompt builders"
```

---

## Task 5: Tools menu rendering + `tgl:` interaction handler + `/config` entry

**Files:**
- Create: `src/commands/tool-config-view.ts`, `src/chat/tool-toggle-interaction-handler.ts`
- Modify: `src/commands/config.ts`, `src/chat/interaction-router.ts`
- Test: `tests/commands/tool-config-view.test.ts`, `tests/chat/tool-toggle-interaction-handler.test.ts`

**Callback scheme** (base64url-encoded context id, mirroring `plg:`):
- `tgl:menu:<ctx>` — open the domain list
- `tgl:open:<domain>:<ctx>` — drill into a domain's tools
- `tgl:dom:<domain>:<ctx>` — toggle a whole domain, re-render domain list
- `tgl:tool:<name>:<ctx>` — toggle one tool, re-render that domain's drill-in
- `tgl:back:<ctx>` — back to the domain list

Risk labels from `TOOL_METADATA.risk`: `read`→📖, `write`→✏️, `destructive`→⚠️, `open-world`→🌐.

- [ ] **Step 1: Write the failing test for the view module**

Create `tests/commands/tool-config-view.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { buildDomainListView, buildDomainDrillView } from '../../src/commands/tool-config-view.js'

const AVAILABLE = ['create_task', 'update_task', 'search_tasks', 'delete_task', 'web_fetch', 'get_current_time']

describe('buildDomainListView', () => {
  it('lists domains present in the available set with on status by default', () => {
    const view = buildDomainListView('ctx', AVAILABLE, { disabledDomains: [], toolOverrides: {} })
    expect(view.text).toContain('Tools')
    expect(view.buttons.some((b) => b.callbackData.startsWith('tgl:dom:task:'))).toBe(true)
    expect(view.buttons.some((b) => b.callbackData.startsWith('tgl:open:task:'))).toBe(true)
  })

  it('marks a partially-disabled domain', () => {
    const view = buildDomainListView('ctx', AVAILABLE, { disabledDomains: [], toolOverrides: { delete_task: false } })
    const taskRow = view.text.split('\n').find((l) => l.toLowerCase().includes('task'))
    expect(taskRow).toContain('🟡')
  })
})

describe('buildDomainDrillView', () => {
  it('renders per-tool buttons with risk labels for the domain', () => {
    const view = buildDomainDrillView('ctx', 'task', AVAILABLE, { disabledDomains: [], toolOverrides: {} })
    expect(view.buttons.some((b) => b.callbackData.startsWith('tgl:tool:delete_task:'))).toBe(true)
    expect(view.text).toContain('⚠️') // delete_task is destructive
    expect(view.buttons.some((b) => b.callbackData.startsWith('tgl:back:'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/commands/tool-config-view.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/commands/tool-config-view.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatButton } from '../chat/types.js'
import { getDomainStatus, isToolEnabled, type ToolPrefs } from '../tools/tool-preferences.js'
import { getToolMetadata, type ToolDomain, type ToolRisk } from '../tools/tool-metadata.js'

export interface ToolMenuView {
  text: string
  buttons: ChatButton[]
}

function encodeCtx(contextId: string): string {
  return Buffer.from(contextId).toString('base64url')
}

const DOMAIN_LABELS: Record<ToolDomain, string> = {
  task: 'Tasks',
  project: 'Projects',
  comment: 'Comments',
  label: 'Labels',
  status: 'Statuses',
  attachment: 'Attachments',
  work: 'Work logs',
  sprint: 'Sprints',
  query: 'Saved queries',
  collaboration: 'Collaboration',
  memo: 'Memos',
  recurring: 'Recurring tasks',
  deferred: 'Deferred prompts',
  instruction: 'Instructions',
  history: 'History',
  web: 'Web fetch',
  identity: 'Identity',
  time: 'Time',
}

const RISK_EMOJI: Record<ToolRisk, string> = {
  read: '📖',
  write: '✏️',
  destructive: '⚠️',
  'open-world': '🌐',
}

/** Group available tool names by their classified domain (unclassified names are skipped). */
function groupByDomain(availableToolNames: readonly string[]): Map<ToolDomain, string[]> {
  const map = new Map<ToolDomain, string[]>()
  for (const name of availableToolNames) {
    const meta = getToolMetadata(name)
    if (meta === undefined) continue
    const list = map.get(meta.domain) ?? []
    list.push(name)
    map.set(meta.domain, list)
  }
  return map
}

function statusMarker(status: 'on' | 'off' | 'partial'): string {
  if (status === 'on') return '🟢'
  if (status === 'off') return '⭕'
  return '🟡'
}

export function buildDomainListView(
  contextId: string,
  availableToolNames: readonly string[],
  prefs: ToolPrefs,
): ToolMenuView {
  const ctx = encodeCtx(contextId)
  const grouped = groupByDomain(availableToolNames)
  const domains = [...grouped.keys()].sort((a, b) => DOMAIN_LABELS[a].localeCompare(DOMAIN_LABELS[b]))
  const lines = ['🧰 **Tools** — tap a domain to toggle it on/off, or “Edit” to pick individual tools.\n']
  const buttons: ChatButton[] = []
  for (const domain of domains) {
    const names = grouped.get(domain) ?? []
    const status = getDomainStatus(prefs, domain, names)
    lines.push(`${statusMarker(status)} ${DOMAIN_LABELS[domain]}`)
    buttons.push({
      text: `${statusMarker(status)} ${DOMAIN_LABELS[domain]}`,
      callbackData: `tgl:dom:${domain}:${ctx}`,
      style: status === 'off' ? 'secondary' : 'primary',
    })
    buttons.push({ text: `✏️ Edit ${DOMAIN_LABELS[domain]}`, callbackData: `tgl:open:${domain}:${ctx}`, style: 'secondary' })
  }
  return { text: lines.join('\n'), buttons }
}

export function buildDomainDrillView(
  contextId: string,
  domain: ToolDomain,
  availableToolNames: readonly string[],
  prefs: ToolPrefs,
): ToolMenuView {
  const ctx = encodeCtx(contextId)
  const names = groupByDomain(availableToolNames).get(domain) ?? []
  const sorted = [...names].sort()
  const lines = [`🧰 **${DOMAIN_LABELS[domain]}** — tap a tool to toggle it.\n`]
  const buttons: ChatButton[] = []
  for (const name of sorted) {
    const meta = getToolMetadata(name)
    const risk = meta === undefined ? '' : RISK_EMOJI[meta.risk]
    const enabled = isToolEnabled(prefs, name)
    lines.push(`${enabled ? '🟢' : '⭕'} ${risk} ${name}`)
    buttons.push({
      text: `${enabled ? '🟢' : '⭕'} ${risk} ${name}`,
      callbackData: `tgl:tool:${name}:${ctx}`,
      style: enabled ? 'primary' : 'secondary',
    })
  }
  buttons.push({ text: '⬅️ Back', callbackData: `tgl:back:${ctx}`, style: 'secondary' })
  return { text: lines.join('\n'), buttons }
}
```

- [ ] **Step 4: Run the view test to verify it passes**

Run: `bun test tests/commands/tool-config-view.test.ts`
Expected: PASS.

> If `ChatButton` does not include a `'secondary'` style value, open `src/chat/types.ts` and use the styles that type actually permits (the same set `buildPluginButtons` uses: `'primary' | 'danger' | 'secondary'`). Match the existing union exactly.

- [ ] **Step 5: Write the failing test for the interaction handler**

Create `tests/chat/tool-toggle-interaction-handler.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'

import { handleToolToggleInteraction } from '../../src/chat/tool-toggle-interaction-handler.js'
import { userCachesForTesting } from '../../src/cache.js'
import { getToolPrefs } from '../../src/tools/tool-preferences.js'
import { makeReplyCapture } from '../utils/test-helpers.js'

const USER = 'tgl-user-1'
const CTX = Buffer.from(USER).toString('base64url')

function dmInteraction(callbackData: string) {
  return {
    callbackData,
    contextType: 'dm' as const,
    storageContextId: USER,
    user: { id: USER, username: null },
  }
}

afterEach(() => {
  userCachesForTesting.delete(USER)
})

describe('handleToolToggleInteraction', () => {
  it('returns false for non-tgl callbacks', async () => {
    const reply = makeReplyCapture()
    const handled = await handleToolToggleInteraction(dmInteraction('plg:enable:x:y') as never, reply.fn)
    expect(handled).toBe(false)
  })

  it('toggling a domain off persists a disabled domain for the user', async () => {
    const reply = makeReplyCapture()
    const handled = await handleToolToggleInteraction(dmInteraction(`tgl:dom:memo:${CTX}`) as never, reply.fn)
    expect(handled).toBe(true)
    expect(getToolPrefs(USER).disabledDomains).toContain('memo')
  })

  it('rejects toggling for a context the user cannot manage', async () => {
    const reply = makeReplyCapture()
    const otherCtx = Buffer.from('someone-else').toString('base64url')
    const handled = await handleToolToggleInteraction(dmInteraction(`tgl:dom:memo:${otherCtx}`) as never, reply.fn)
    expect(handled).toBe(true)
    expect(getToolPrefs('someone-else').disabledDomains).not.toContain('memo')
  })
})
```

> Check `tests/utils/test-helpers.ts` for the existing reply-capture helper name and `IncomingInteraction` shape used by `tests/chat/*`. If `makeReplyCapture` does not exist, copy the reply-stub pattern from an existing `tests/chat/*interaction*.test.ts` and adjust. The `as never` casts keep the test focused on behavior without rebuilding the full `IncomingInteraction` type.

- [ ] **Step 6: Run the handler test to verify it fails**

Run: `bun test tests/chat/tool-toggle-interaction-handler.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 7: Implement `src/chat/tool-toggle-interaction-handler.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { buildDomainDrillView, buildDomainListView, type ToolMenuView } from '../commands/tool-config-view.js'
import { listManageableGroups } from '../group-settings/access.js'
import { getMissingGroupTargetMessage } from '../group-settings/target-validation.js'
import { logger } from '../logger.js'
import { safeBuildProvider } from '../commands/context-tool-resolution.js'
import { buildTools } from '../tools/tools-builder.js'
import { getToolPrefs, setToolPrefs, toggleDomain, toggleTool } from '../tools/tool-preferences.js'
import { getToolMetadata, type ToolDomain } from '../tools/tool-metadata.js'
import { replyTextPreferReplace } from './interaction-router-replies.js'
import type { IncomingInteraction, ReplyFn } from './types.js'

const log = logger.child({ scope: 'chat:tool-toggle-interaction' })

function decodeContextId(encoded: string): string | null {
  try {
    return Buffer.from(encoded, 'base64url').toString('utf8')
  } catch {
    return null
  }
}

function canManageTargetContext(interaction: IncomingInteraction, targetContextId: string): boolean {
  if (interaction.contextType !== 'dm') return targetContextId === interaction.storageContextId
  if (targetContextId === interaction.user.id) return true
  return listManageableGroups(interaction.user.id).some((group) => group.contextId === targetContextId)
}

/** Build the universe of toggleable (classified) tool names available for a target context. */
function availableToolNames(targetContextId: string, actorUserId: string, contextType: 'dm' | 'group'): string[] {
  const provider = safeBuildProvider(targetContextId)
  if (provider === null) return []
  const tools = buildTools(provider, actorUserId, targetContextId, 'normal', contextType)
  return Object.keys(tools).filter((name) => getToolMetadata(name) !== undefined)
}

function isToolDomain(value: string): value is ToolDomain {
  return getToolMetadataDomainSet().has(value)
}

// Domains are exactly the union of domains present in TOOL_METADATA.
let cachedDomainSet: Set<string> | null = null
function getToolMetadataDomainSet(): Set<string> {
  if (cachedDomainSet === null) {
    // Import lazily to avoid a cycle at module load; TOOL_METADATA is static.
    const { TOOL_METADATA } = require('../tools/tool-metadata.js') as typeof import('../tools/tool-metadata.js')
    cachedDomainSet = new Set(Object.values(TOOL_METADATA).map((m) => m.domain))
  }
  return cachedDomainSet
}

async function renderView(reply: ReplyFn, view: ToolMenuView): Promise<void> {
  await reply.buttons(view.text, { buttons: view.buttons })
}

/** Handle tgl: callbacks for per-context tool enable/disable. */
export async function handleToolToggleInteraction(
  interaction: IncomingInteraction,
  reply: ReplyFn,
): Promise<boolean> {
  const { callbackData } = interaction
  if (!callbackData.startsWith('tgl:')) return false

  const parts = callbackData.slice(4).split(':')
  const action = parts[0]
  // For tool actions the name itself never contains ':'; ctx is always the last segment.
  const encodedContextId = parts[parts.length - 1]
  const middle = parts.slice(1, parts.length - 1).join(':')

  if (action === undefined || encodedContextId === undefined) {
    log.warn({ callbackData }, 'Malformed tool toggle callback')
    await replyTextPreferReplace(reply, 'Invalid tool action. Please try again.')
    return true
  }
  const contextId = decodeContextId(encodedContextId)
  if (contextId === null) {
    await replyTextPreferReplace(reply, 'Invalid tool action. Please try again.')
    return true
  }
  if (!canManageTargetContext(interaction, contextId)) {
    await replyTextPreferReplace(reply, getMissingGroupTargetMessage(interaction.user.id, contextId))
    return true
  }

  const names = availableToolNames(contextId, interaction.user.id, interaction.contextType)

  if (action === 'menu') {
    await renderView(reply, buildDomainListView(contextId, names, getToolPrefs(contextId)))
    return true
  }
  if (action === 'back') {
    await renderView(reply, buildDomainListView(contextId, names, getToolPrefs(contextId)))
    return true
  }
  if (action === 'open') {
    if (!isToolDomain(middle)) {
      await replyTextPreferReplace(reply, 'Unknown tool domain.')
      return true
    }
    await renderView(reply, buildDomainDrillView(contextId, middle, names, getToolPrefs(contextId)))
    return true
  }
  if (action === 'dom') {
    if (!isToolDomain(middle)) {
      await replyTextPreferReplace(reply, 'Unknown tool domain.')
      return true
    }
    const domainNames = names.filter((n) => getToolMetadata(n)?.domain === middle)
    setToolPrefs(contextId, toggleDomain(getToolPrefs(contextId), middle, domainNames))
    log.info({ contextId, domain: middle, userId: interaction.user.id }, 'Tool domain toggled')
    await renderView(reply, buildDomainListView(contextId, names, getToolPrefs(contextId)))
    return true
  }
  if (action === 'tool') {
    const toolName = middle
    const meta = getToolMetadata(toolName)
    if (meta === undefined) {
      await replyTextPreferReplace(reply, 'Unknown tool.')
      return true
    }
    const domainNames = names.filter((n) => getToolMetadata(n)?.domain === meta.domain)
    setToolPrefs(contextId, toggleTool(getToolPrefs(contextId), toolName, domainNames))
    log.info({ contextId, tool: toolName, userId: interaction.user.id }, 'Tool toggled')
    await renderView(reply, buildDomainDrillView(contextId, meta.domain, names, getToolPrefs(contextId)))
    return true
  }

  log.warn({ callbackData, action }, 'Unknown tool toggle action')
  await replyTextPreferReplace(reply, 'Unknown tool action.')
  return true
}
```

> **Avoid `require`:** the lazy `require` above is a placeholder to dodge a potential import cycle. Prefer a static `import { TOOL_METADATA } from '../tools/tool-metadata.js'` at the top of the file and delete the `getToolMetadataDomainSet`/`require` machinery if no cycle exists (tool-metadata.ts imports nothing from this module, so there is no cycle — use the static import). Rewrite `isToolDomain` as:
> ```typescript
> import { TOOL_METADATA } from '../tools/tool-metadata.js'
> const DOMAIN_SET = new Set<string>(Object.values(TOOL_METADATA).map((m) => m.domain))
> function isToolDomain(value: string): value is ToolDomain { return DOMAIN_SET.has(value) }
> ```
> Use this static form in the final code; `require` is forbidden by lint.

- [ ] **Step 8: Run the handler test to verify it passes**

Run: `bun test tests/chat/tool-toggle-interaction-handler.test.ts`
Expected: PASS.

- [ ] **Step 9: Route `tgl:` in `src/chat/interaction-router.ts`**

Add the import near the other handler imports (top of file):

```typescript
import { handleToolToggleInteraction } from './tool-toggle-interaction-handler.js'
```

Add a branch alongside the `plg:` branch (currently `src/chat/interaction-router.ts:280-282`):

```typescript
  if (callbackData.startsWith('tgl:')) {
    return handleToolToggleInteraction(interaction, reply)
  }
```

> If the router dispatches through an injected `resolvedDeps` object (as `plg:` does via `resolvedDeps.handlePluginInteraction`), follow that pattern: add `handleToolToggleInteraction` to the deps type/defaults and call `resolvedDeps.handleToolToggleInteraction(...)`. Inspect how `handlePluginInteraction` is wired into the deps (search `handlePluginInteraction` in this file and its deps definition) and mirror it exactly so tests that inject deps keep working.

- [ ] **Step 10: Add the "🧰 Tools" entry to `/config`**

In `src/commands/config.ts`:

Add the import:

```typescript
import { getToolPrefs } from '../tools/tool-preferences.js'
```

Add a status line in `renderConfigForTarget` after `appendPluginConfigLines(lines, targetContextId)` (currently `src/commands/config.ts:142`):

```typescript
  const toolPrefs = getToolPrefs(targetContextId)
  const disabledCount = toolPrefs.disabledDomains.length + Object.values(toolPrefs.toolOverrides).filter((v) => !v).length
  lines.push(`\n🧰 **Tools**: ${disabledCount === 0 ? 'all enabled' : `${disabledCount} disabled`}`)
```

Add a Tools button to the interactive button set. In the `reply.buttons` call (currently `src/commands/config.ts:151-153`), include a tools-menu opener:

```typescript
  const encodedCtx = Buffer.from(targetContextId).toString('base64url')
  await reply.buttons(lines.join('\n'), {
    buttons: [
      ...buildConfigButtons(config, targetContextId),
      ...buildPluginButtons(targetContextId),
      { text: '🧰 Tools', callbackData: `tgl:menu:${encodedCtx}`, style: 'secondary' },
    ],
  })
```

- [ ] **Step 11: Run targeted tests + the command/chat suites**

Run: `bun test tests/commands/tool-config-view.test.ts tests/chat/tool-toggle-interaction-handler.test.ts tests/commands/ tests/chat/`
Expected: PASS. Fix any interaction-router deps test that needs the new handler added to its deps stub.

- [ ] **Step 12: Lint/typecheck**

Run: `bun lint:agent-strict -- src/commands/tool-config-view.ts src/chat/tool-toggle-interaction-handler.ts src/commands/config.ts src/chat/interaction-router.ts && bun typecheck`
Expected: no errors.

- [ ] **Step 13: Commit**

```bash
git add src/commands/tool-config-view.ts src/chat/tool-toggle-interaction-handler.ts src/commands/config.ts src/chat/interaction-router.ts tests/commands/tool-config-view.test.ts tests/chat/tool-toggle-interaction-handler.test.ts
git commit -m "feat(config): add Tools toggle section to /config with tgl: interaction handler"
```

---

## Task 6: Documentation

**Files:**
- Modify: `CLAUDE.md`, `src/tools/CLAUDE.md`, `src/commands/CLAUDE.md`

- [ ] **Step 1: Document in `src/tools/CLAUDE.md`**

Under "Assembly", add a bullet describing the preference filter:

```markdown
- After capability + context gating and plugin merge, `makeTools()` applies the
  per-context tool denylist from `src/tools/tool-preferences.ts` (default all-on).
  Disabled tools are physically removed from the returned `ToolSet`, so they cannot be
  invoked. Preferences are keyed by the same `storageContextId` used elsewhere.
```

- [ ] **Step 2: Document in `src/commands/CLAUDE.md`**

Under "Current Command Behavior", add:

```markdown
- `/config` includes a "🧰 Tools" section. Tapping it opens a domain list; users toggle
  whole domains (`tgl:dom:`) or drill in (`tgl:open:`) to toggle individual tools
  (`tgl:tool:`) with risk labels. Callbacks are routed in
  `src/chat/interaction-router.ts` to `handleToolToggleInteraction`. Personal-vs-group
  targeting reuses the group-settings selector, identical to plugin toggles.
```

- [ ] **Step 3: Document in root `CLAUDE.md`**

Add a short subsection after the "Available Tools" section explaining user-configurable tool access:

```markdown
### User-Configurable Tool Access

Beyond capability + context gating, each personal or managed-group context can disable
tools. Preferences are an opt-out denylist (default: all enabled) stored as JSON under a
reserved `tool_prefs` config key and applied as the final filter in `makeTools()`. The
system prompt (`src/system-prompt.ts`) is composed from tool-gated fragments so it never
instructs the agent to use a disabled tool, and appends an "Unavailable tools" line for
partially-disabled domains. Managed via the "🧰 Tools" section of `/config`.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md src/tools/CLAUDE.md src/commands/CLAUDE.md
git commit -m "docs: document user-configurable tool access"
```

---

## Final Verification

- [ ] **Step 1: Run the full check suite**

Run: `bun check:full`
Expected: all checks pass (lint, typecheck, format, license-headers, knip, tests, duplicates).

- [ ] **Step 2: Manual smoke (optional, requires a running bot)**

In a DM: `/config` → tap **🧰 Tools** → toggle **Memos** off → confirm the domain row shows ⭕ → send a message that would normally trigger `save_memo` and confirm the bot does not call it. Re-enable and confirm it works again.

---

## Self-Review Notes (author)

- **Spec coverage:** §1 storage → Task 1; §2 filter placement → Task 2; §3 cache invalidation → Task 1 (`clearCachedToolsByPrefix`) + Task 2 (write path via `setToolPrefs`); §4 prompt coherence → Tasks 3 & 4; §5 UI → Task 5; §6 edge cases → covered by Task 1 tests (empty/corrupt prefs, unclassified tools) and Task 2 (plugin tools filterable, backward-compat); testing section → per-task tests + final `bun check:full`.
- **Safety-net scope decision:** the "Unavailable tools" line intentionally lists only *partially-disabled* domains' tools (e.g. `delete_task` off while task domain on). Whole-domain disables are handled by fragment exclusion, so repeating them would be redundant noise. This is the meaningful safety case (disabling a destructive tool while keeping its domain) the spec's safety motivation targets.
- **Type consistency:** `ToolPrefs`, `getToolPrefs`, `setToolPrefs`, `isToolEnabled`, `partitionToolNames`, `getDomainStatus`, `toggleDomain`, `toggleTool` are defined in Task 1 and used unchanged in Tasks 2–5. View functions `buildDomainListView`/`buildDomainDrillView` defined in Task 5 Step 3 and consumed by the handler in Step 7. `enabledToolNames` (a `ReadonlySet<string>`) is introduced in Task 4 and consumed by the Task 3 `buildSystemPrompt` signature.
- **Known adapt-on-contact points (flagged inline):** exact test-helper names (`makeFakeProvider`, `makeReplyCapture`) and the `ChatButton` style union must be confirmed against the repo before writing each test; the interaction-router `tgl:` branch must mirror however `plg:` is wired (direct call vs injected deps).
