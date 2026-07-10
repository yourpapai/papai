<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plugin / Core Separation — Phase 0+1: Foundation & ToolGate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the `src/ports/` convention and the first port (`ToolGatePort`), then use it to delete the hardcoded `plugin_acp__*` operator-gating allowlist from the core LLM orchestrator — behavior-preserving — and lock the win with an architecture guard test.

**Architecture:** Hexagonal ports & adapters (see spec `docs/superpowers/specs/2026-07-02-plugin-core-separation-design.md`). Tools declare an optional `gate: 'operator'` on their runtime object; a process-wide `ToolGateRegistry` is populated at plugin tool-set assembly and consulted by the who-may-use filter. The filter stops enumerating plugin tool names, so core no longer names any feature.

**Tech Stack:** Bun + strict TypeScript, Zod v4, Vercel AI SDK (`ai`), `bun:test`. Imports use the `.js` extension.

---

## Scope & Deferred (read first)

This is **plan 1 of ~6** in the spec's strangler rollout. It intentionally covers spec rollout steps **1 (partial) + 2 (ToolGate)**.

**In scope:**

- `src/ports/` directory convention + `ToolGatePort` (`src/ports/tool-gate.ts`).
- `gate?: 'operator'` on the runtime `PluginTool` type + registry population at assembly.
- Refactor `applyWhoMayUseFilter` to consult the registry; delete `ACP_SESSION_ACTION_TOOLS`.
- Declare `gate: 'operator'` on the five acp session-action tools.
- Architecture guard test (`tests/architecture-guard.test.ts`).

**Deliberately deferred (do NOT build here — YAGNI):**

- The composition root + trust-gated module loader. There is **no `src/modules/` and no `src/kernel/` yet**; a loader with no module to load is premature. It lands in **Phase 2 (coding module)**, the first real trusted module.
- `src/llm-orchestrator-tools.ts` still imports `resolveCodingGuardrails` from `./coding-credentials/guardrails.js` to obtain the operator allowlist (`whoMayUse`). That coupling is a **coding-module concern removed in Phase 2/3**, not here. This plan removes only the enumerated tool-name leak, which is the highest-value, self-contained slice.

**Behavior invariant:** operator-gating behavior must be identical before and after. After this plan, a non-allowlisted actor still loses exactly the five acp session-action tools — but because those tools now _declare_ `gate: 'operator'`, not because core hardcodes their names.

**Ops note:** editing files under `plugins/acp/` changes the plugin's manifest hash, which clears its approval (see `docs/architecture/plugins.md`). After Task 5, the acp plugin must be re-approved in the settings UI on next startup for a manual end-to-end check. This does not affect the automated tests in this plan.

---

## File Structure

**Create:**

- `src/ports/tool-gate.ts` — the `ToolGatePort`: `ToolGate` type, `ToolGateRegistry` interface, `createToolGateRegistry()` factory, and the process-wide `toolGateRegistry` singleton. No dependencies (a port is dependency-free).
- `src/plugins/tool-gate-registration.ts` — `registerToolGates(pluginId, tools, registry?)`: maps each plugin tool to its namespaced name and records its gate. Bridges the plugins layer to the port. Depends on `contribution-names.ts` + the port.
- `tests/ports/tool-gate.test.ts` — unit tests for the registry.
- `tests/plugins/tool-gate-registration.test.ts` — unit tests for `registerToolGates`.
- `tests/llm-orchestrator-who-may-use.test.ts` — unit tests for the refactored `applyWhoMayUseFilter` (replaces any existing test of that function).
- `tests/plugins/acp-tool-gates.test.ts` — asserts the five acp factories return `gate: 'operator'`.
- `tests/architecture-guard.test.ts` — the ratcheting architecture guard.

**Modify:**

- `src/plugins/runtime-types.ts` — add `gate?: 'operator'` to `PluginTool`.
- `src/plugins/contributions.ts` — call `registerToolGates(...)` inside `buildPluginToolSet`.
- `src/llm-orchestrator-tools.ts` — registry-based `applyWhoMayUseFilter`; delete `ACP_SESSION_ACTION_TOOLS`; genericize the section comment.
- `plugins/acp/tools.ts` — add `gate?: 'operator'` to the local structural `Tool` type (line ~49).
- `plugins/acp/session-tools.ts` — add `gate: 'operator'` to `start_session`, `finish_session`, `cancel_session`, `answer_permission`.
- `plugins/acp/continue-tool.ts` — add `gate: 'operator'` to `continue_session`.

---

## Task 1: `ToolGatePort` (`src/ports/tool-gate.ts`)

**Files:**

- Create: `src/ports/tool-gate.ts`
- Test: `tests/ports/tool-gate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/ports/tool-gate.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createToolGateRegistry, toolGateRegistry } from '../../src/ports/tool-gate.js'

describe('ToolGateRegistry', () => {
  test('defaults to non-operator gate for unknown tools', () => {
    const reg = createToolGateRegistry()
    expect(reg.getGate('plugin_x__y')).toBe('default')
    expect(reg.isOperatorGated('plugin_x__y')).toBe(false)
  })

  test('records and reports an operator gate', () => {
    const reg = createToolGateRegistry()
    reg.setGate('plugin_acp__start_session', 'operator')
    expect(reg.getGate('plugin_acp__start_session')).toBe('operator')
    expect(reg.isOperatorGated('plugin_acp__start_session')).toBe(true)
  })

  test('exposes a shared singleton', () => {
    expect(typeof toolGateRegistry.isOperatorGated).toBe('function')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/ports/tool-gate.test.ts`
Expected: FAIL — module `../../src/ports/tool-gate.js` cannot be resolved.

- [ ] **Step 3: Write minimal implementation**

Create `src/ports/tool-gate.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Access gate for a tool. 'operator' tools are restricted by the who-may-use guardrail. */
export type ToolGate = 'operator' | 'default'

/**
 * Maps a namespaced tool name (e.g. `plugin_<id>__<tool>`) to its gate.
 *
 * Populated at tool-set assembly from each tool's declared gate and consulted by the
 * who-may-use filter, so core enforces operator-gating without ever enumerating tool names.
 *
 * NOTE: keep this file feature-agnostic — the architecture guard test scans `src/ports/**`
 * for feature/provider names. Do not reference concrete plugin or tool names here.
 */
export interface ToolGateRegistry {
  setGate(toolName: string, gate: ToolGate): void
  getGate(toolName: string): ToolGate
  isOperatorGated(toolName: string): boolean
}

/** Create an isolated registry (used by tests and, as a singleton, by the runtime). */
export function createToolGateRegistry(): ToolGateRegistry {
  const gates = new Map<string, ToolGate>()
  return {
    setGate: (toolName, gate) => {
      gates.set(toolName, gate)
    },
    getGate: (toolName) => gates.get(toolName) ?? 'default',
    isOperatorGated: (toolName) => (gates.get(toolName) ?? 'default') === 'operator',
  }
}

/**
 * Process-wide singleton. Tool names are globally unique (plugin-id namespaced), and a gate
 * is static per tool, so a shared registry is safe and stable across contexts.
 */
export const toolGateRegistry: ToolGateRegistry = createToolGateRegistry()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/ports/tool-gate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ports/tool-gate.ts tests/ports/tool-gate.test.ts
git commit -m "feat(ports): add ToolGatePort registry"
```

---

## Task 2: `gate?` on `PluginTool` + `registerToolGates` bridge

**Files:**

- Modify: `src/plugins/runtime-types.ts:85-91`
- Create: `src/plugins/tool-gate-registration.ts`
- Test: `tests/plugins/tool-gate-registration.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/plugins/tool-gate-registration.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createToolGateRegistry } from '../../src/ports/tool-gate.js'
import type { PluginTool } from '../../src/plugins/runtime-types.js'
import { registerToolGates } from '../../src/plugins/tool-gate-registration.js'

const tool = (name: string, gate?: 'operator'): PluginTool => ({
  name,
  description: name,
  ...(gate === undefined ? {} : { gate }),
  execute: async () => null,
})

describe('registerToolGates', () => {
  test('records operator gates under the namespaced tool name', () => {
    const reg = createToolGateRegistry()
    registerToolGates('acp', [tool('start_session', 'operator'), tool('list_agents')], reg)
    expect(reg.isOperatorGated('plugin_acp__start_session')).toBe(true)
    expect(reg.isOperatorGated('plugin_acp__list_agents')).toBe(false)
  })

  test('sanitizes dashes in the plugin id', () => {
    const reg = createToolGateRegistry()
    registerToolGates('task-provider-kaneo', [tool('do_thing', 'operator')], reg)
    expect(reg.isOperatorGated('plugin_task_provider_kaneo__do_thing')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/tool-gate-registration.test.ts`
Expected: FAIL — `registerToolGates` / the `gate` field do not exist.

- [ ] **Step 3a: Add `gate?` to `PluginTool`**

In `src/plugins/runtime-types.ts`, replace the `PluginTool` type (currently lines 85-91):

```ts
export type PluginTool = {
  /** Raw tool name as declared in the manifest (snake_case). */
  name: string
  description: string
  inputSchema?: z.ZodType
  /**
   * Access gate. `'operator'` restricts the tool to the who-may-use allowlist; omitted means
   * unrestricted. Recorded into the ToolGatePort at assembly and enforced by the orchestrator.
   */
  gate?: 'operator'
  execute: (input: unknown, runtimeContext: PluginToolRuntimeContext, options: ToolExecutionOptions) => Promise<unknown>
}
```

- [ ] **Step 3b: Create the bridge**

Create `src/plugins/tool-gate-registration.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { toolGateRegistry, type ToolGateRegistry } from '../ports/tool-gate.js'
import { namespacedToolName } from './contribution-names.js'
import type { PluginTool } from './runtime-types.js'

/**
 * Record each plugin tool's gate into the ToolGatePort under its namespaced name, so the
 * orchestrator's who-may-use filter can enforce operator-gating without knowing tool names.
 */
export function registerToolGates(
  pluginId: string,
  tools: readonly PluginTool[],
  registry: ToolGateRegistry = toolGateRegistry,
): void {
  for (const t of tools) {
    registry.setGate(namespacedToolName(pluginId, t.name), t.gate ?? 'default')
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/tool-gate-registration.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/runtime-types.ts src/plugins/tool-gate-registration.ts tests/plugins/tool-gate-registration.test.ts
git commit -m "feat(plugins): declare tool gate on PluginTool + registerToolGates bridge"
```

---

## Task 3: Populate the registry during tool-set assembly

**Files:**

- Modify: `src/plugins/contributions.ts:198-244` (`buildPluginToolSet`)

No new test file — this is covered end-to-end by Task 4's orchestrator test and the existing `buildPluginToolSet` suite (run it in Step 3 to confirm no regression).

- [ ] **Step 1: Add the import**

In `src/plugins/contributions.ts`, add to the imports:

```ts
import { registerToolGates } from './tool-gate-registration.js'
```

- [ ] **Step 2: Call `registerToolGates` per plugin**

In `buildPluginToolSet`, inside `for (const pluginId of activePluginIds) { ... }`, immediately after the existing guard:

```ts
const contributions = contributionRegistry.getContributions(pluginId)
if (contributions === undefined) continue

registerToolGates(pluginId, contributions.tools)
```

(Place the `registerToolGates(...)` line right after the `if (contributions === undefined) continue` line, before the `for (const pluginTool of contributions.tools)` loop.)

- [ ] **Step 3: Run the existing plugin-contributions tests to confirm no regression**

Run: `bun test tests/plugins/`
Expected: PASS (all existing plugin tests still green; assembly now also records gates as a side effect).

- [ ] **Step 4: Commit**

```bash
git add src/plugins/contributions.ts
git commit -m "feat(plugins): record tool gates when assembling the plugin tool set"
```

---

## Task 4: Registry-driven `applyWhoMayUseFilter` (delete the acp allowlist)

**Files:**

- Modify: `src/llm-orchestrator-tools.ts:34-58`
- Test: `tests/llm-orchestrator-who-may-use.test.ts`

- [ ] **Step 1: Find and remove any existing test of the old behavior**

Run: `rg -l "applyWhoMayUseFilter" tests`
If a test file references `applyWhoMayUseFilter`, its assertions rely on the hardcoded `ACP_SESSION_ACTION_TOOLS` set. Delete that file (its replacement is written below):

```bash
# only if the grep above found a file, e.g. tests/llm-orchestrator-tools.test.ts
git rm <path-found-by-rg>
```

- [ ] **Step 2: Write the failing test**

Create `tests/llm-orchestrator-who-may-use.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import type { ToolSet } from 'ai'

import { applyWhoMayUseFilter } from '../src/llm-orchestrator-tools.js'
import { createToolGateRegistry } from '../src/ports/tool-gate.js'

const fakeTool = { description: 'x', inputSchema: undefined, execute: async () => null } as unknown as ToolSet[string]
const toolset = (): ToolSet => ({
  plugin_acp__start_session: fakeTool,
  list_tasks: fakeTool,
})

describe('applyWhoMayUseFilter', () => {
  test('returns the same reference when whoMayUse is "members"', () => {
    const reg = createToolGateRegistry()
    reg.setGate('plugin_acp__start_session', 'operator')
    const tools = toolset()
    expect(applyWhoMayUseFilter(tools, 'members', 'anyone', reg)).toBe(tools)
  })

  test('returns the same reference when the actor is on the allowlist', () => {
    const reg = createToolGateRegistry()
    reg.setGate('plugin_acp__start_session', 'operator')
    const tools = toolset()
    expect(applyWhoMayUseFilter(tools, ['op-user'], 'op-user', reg)).toBe(tools)
  })

  test('drops operator-gated tools for a non-allowlisted actor, keeps the rest', () => {
    const reg = createToolGateRegistry()
    reg.setGate('plugin_acp__start_session', 'operator')
    const out = applyWhoMayUseFilter(toolset(), ['op-user'], 'other-user', reg)
    expect('plugin_acp__start_session' in out).toBe(false)
    expect('list_tasks' in out).toBe(true)
  })

  test('keeps a plugin tool that is not operator-gated', () => {
    const reg = createToolGateRegistry() // no gates recorded
    const out = applyWhoMayUseFilter(toolset(), ['op-user'], 'other-user', reg)
    expect('plugin_acp__start_session' in out).toBe(true)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/llm-orchestrator-who-may-use.test.ts`
Expected: FAIL — `applyWhoMayUseFilter` does not yet accept a 4th `registry` argument, so the injected registry is ignored and the "not operator-gated" / injected-gate cases behave wrong.

- [ ] **Step 4: Refactor the filter**

In `src/llm-orchestrator-tools.ts`:

(a) Add the import near the other local imports:

```ts
import { toolGateRegistry, type ToolGateRegistry } from './ports/tool-gate.js'
```

(b) Replace the whole block currently at lines 34-58 (the comment banner, the `ACP_SESSION_ACTION_TOOLS` constant, and `applyWhoMayUseFilter`) with:

```ts
// ---------------------------------------------------------------------------
// Who-may-use filter: drops operator-gated tools for actors not on the
// operator allowlist. Which tools are operator-gated is declared by the tools
// themselves (ToolGatePort) — core never enumerates tool names.
// ---------------------------------------------------------------------------

/**
 * Drops operator-gated tools for actors not on the who-may-use allowlist.
 * Returns `tools` reference-identical when `whoMayUse === 'members'` (the default) or when
 * the actor is on the allowlist.
 */
export function applyWhoMayUseFilter(
  tools: ToolSet,
  whoMayUse: 'members' | string[],
  chatUserId: string,
  gateRegistry: ToolGateRegistry = toolGateRegistry,
): ToolSet {
  if (whoMayUse === 'members') return tools
  if (whoMayUse.includes(chatUserId)) return tools
  const out: ToolSet = {}
  for (const [name, t] of Object.entries(tools)) {
    if (t !== undefined && !gateRegistry.isOperatorGated(name)) out[name] = t
  }
  return out
}
```

The existing call site in `buildFullToolSet` (`applyWhoMayUseFilter(prefTools, resolveCodingGuardrails(pi).whoMayUse, chatUserId)`) needs no change — it uses the default registry.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/llm-orchestrator-who-may-use.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Confirm no other reference to the deleted constant remains**

Run: `rg "ACP_SESSION_ACTION_TOOLS" src tests`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/llm-orchestrator-tools.ts tests/llm-orchestrator-who-may-use.test.ts
git commit -m "refactor(orchestrator): drive who-may-use filter from ToolGatePort, remove acp allowlist"
```

---

## Task 5: Declare `gate: 'operator'` on the acp session-action tools

**Files:**

- Modify: `plugins/acp/tools.ts` (local `Tool` type, ~line 49)
- Modify: `plugins/acp/session-tools.ts` (`start_session`, `finish_session`, `cancel_session`, `answer_permission`)
- Modify: `plugins/acp/continue-tool.ts` (`continue_session`)
- Test: `tests/plugins/acp-tool-gates.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/plugins/acp-tool-gates.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { continueSessionTool } from '../../plugins/acp/continue-tool.js'
import {
  answerPermissionTool,
  cancelSessionTool,
  finishSessionTool,
  startSessionTool,
} from '../../plugins/acp/session-tools.js'

// The factories take an httpFetch; a no-op stub is fine — we only inspect the returned shape.
const noopFetch = (async () => ({})) as never

describe('acp session-action tools declare an operator gate', () => {
  test('all five are gate: "operator"', () => {
    const tools = [
      startSessionTool(noopFetch),
      finishSessionTool(noopFetch),
      cancelSessionTool(noopFetch),
      answerPermissionTool(noopFetch),
      continueSessionTool(noopFetch),
    ]
    for (const t of tools) {
      expect(t.gate).toBe('operator')
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/acp-tool-gates.test.ts`
Expected: FAIL — `t.gate` is `undefined` (and/or a type error that the `Tool` type has no `gate`).

- [ ] **Step 3a: Add `gate?` to the acp-local `Tool` type**

In `plugins/acp/tools.ts` (~line 49), extend the structural `Tool` type:

```ts
export type Tool = { name: string; description: string; inputSchema: unknown; gate?: 'operator'; execute: ToolExecute }
```

- [ ] **Step 3b: Set the gate on each factory**

In `plugins/acp/session-tools.ts`, in the object returned by each of `startSessionTool`, `finishSessionTool`, `cancelSessionTool`, and `answerPermissionTool`, add `gate: 'operator'` next to the existing `name:` field. For example, `startSessionTool` (the object beginning near line 66):

```ts
  return {
    name: 'start_session',
    gate: 'operator',
    description: /* …unchanged… */,
    inputSchema: /* …unchanged… */,
    execute: /* …unchanged… */,
  }
```

Apply the identical one-line addition (`gate: 'operator',` beside `name:`) to `finish_session` (~line 150), `cancel_session` (~line 184), and `answer_permission` (~line 199).

In `plugins/acp/continue-tool.ts`, do the same for `continueSessionTool` (the object with `name: 'continue_session'`, ~line 92):

```ts
return {
  name: 'continue_session',
  gate: 'operator',
  /* …rest unchanged… */
}
```

Leave the non-session-action acp tools (`list_sessions`, `session_status`, `list_projects`, `list_agents`) with **no** gate — this matches the pre-refactor behavior where only the five session-action tools were restricted.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/acp-tool-gates.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add plugins/acp/tools.ts plugins/acp/session-tools.ts plugins/acp/continue-tool.ts tests/plugins/acp-tool-gates.test.ts
git commit -m "feat(acp): declare operator gate on session-action tools"
```

---

## Task 6: Architecture guard test

**Files:**

- Create: `tests/architecture-guard.test.ts`

This is the regression fence. It anchors on what is clean _now_ (the new `src/ports/**`) and on the specific leak this plan removed (`src/llm-orchestrator-tools.ts`). Later phases extend this file with more globs/files as they clean them.

- [ ] **Step 1: Write the test**

Create `tests/architecture-guard.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { Glob } from 'bun'

// Feature/provider names that must never appear in feature-agnostic core.
// `\bmagi\b` uses word boundaries so it does not match words like "imaging".
const FEATURE_NAMES = /\b(kaneo|youtrack|magi)\b|plugin_acp__/iu

const scan = async (pattern: string): Promise<string[]> => {
  const glob = new Glob(pattern)
  const offenders: string[] = []
  for await (const file of glob.scan('.')) {
    if (FEATURE_NAMES.test(readFileSync(file, 'utf8'))) offenders.push(file)
  }
  return offenders
}

describe('architecture guard: core never names a feature', () => {
  test('src/ports/** is feature-agnostic', async () => {
    expect(await scan('src/ports/**/*.ts')).toEqual([])
  })

  test('llm-orchestrator-tools.ts no longer enumerates acp tool names', () => {
    const text = readFileSync('src/llm-orchestrator-tools.ts', 'utf8')
    expect(/plugin_acp__|ACP_SESSION_ACTION_TOOLS/u.test(text)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `bun test tests/architecture-guard.test.ts`
Expected: PASS (2 tests). If the second test fails, Task 4 was not completed — the file still names acp tools.

- [ ] **Step 3: Commit**

```bash
git add tests/architecture-guard.test.ts
git commit -m "test(architecture): guard that ports and orchestrator name no feature"
```

---

## Task 7: Full verification

- [ ] **Step 1: Run the full test suite**

Run: `bun test`
Expected: PASS. Pay attention to any pre-existing plugin/orchestrator suites — none should regress.

- [ ] **Step 2: Run the full check pipeline**

Run: `bun check:full`
Expected: all checks pass (lint, typecheck, format:check, license-headers, knip, tests). Fix any format issues with `bun run format` and re-run.

> Note: if `knip` flags `createToolGateRegistry` or `registerToolGates` as unused, it means a wiring step (Task 2/3/4) was skipped — trace the caller rather than deleting the export.

- [ ] **Step 3: Manual behavior spot-check (optional, requires re-approving the acp plugin)**

In a group where acp is enabled with a restricted `whoMayUse` list, confirm a non-operator user no longer sees the five session-action tools, and an operator still does. Behavior must match pre-refactor.

- [ ] **Step 4: Final confirmation commit (if any format fixes were applied)**

```bash
git add -A
git commit -m "chore: formatting for phase 0+1"
```

---

## Done criteria

- `rg "ACP_SESSION_ACTION_TOOLS" src tests` → no output.
- `bun test tests/architecture-guard.test.ts` → green.
- `bun check:full` → green.
- Operator-gating behavior unchanged: exactly the five acp session-action tools are dropped for non-allowlisted actors, now driven by declared `gate: 'operator'` + the `ToolGatePort`.
- The next plan (Phase 2 — Coding module) can now introduce `src/modules/`, the trust-gated loader, and the `CredentialVaultPort`, extending `tests/architecture-guard.test.ts` with the `src/plugins/runtime-types.ts` (no `coding`) and broader globs.
