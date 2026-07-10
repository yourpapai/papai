<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plugin / Core Separation — Phase 2c-1: Module Tool Contribution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a **trusted module** contribute LLM tools to the orchestrator's tool set — the prerequisite for migrating the acp coding-session tools out of the sandboxed plugin and into `src/modules/coding/`. Build `TrustedModule.tools`, a feature-agnostic `moduleToolRegistry`, and a `buildModuleToolSet` that mirrors `buildPluginToolSet` and is injected at the one tool-merge choke point. Behavior-preserving: no module contributes tools yet, so the production tool set is unchanged.

**Architecture:** Two-tier ports & adapters (spec `docs/superpowers/specs/2026-07-02-plugin-core-separation-design.md`). Trusted modules already contribute migrations + `onActivate`; this adds a **tool contribution** surface. Because a module is trusted (no sandbox, no manifest, loaded at boot), its tools skip the plugin machinery's manifest/permission gating and reuse only the generic, manifest-independent primitives: `wrapToolExecution`, the `ai` `tool()` factory, and the `toolGateRegistry` port for operator-gating. Module tools are namespaced `module_<id>__<tool>` (parallel to `plugin_<id>__<tool>`).

**Tech Stack:** Bun + strict TypeScript, Zod v4, Vercel AI SDK (`ai`), `bun:test`. Imports use the `.js` extension.

---

## Scope & Deferred (read first)

**This is plan 2c-1 of a ~4-plan sub-epic ("acp becomes a trusted module"):**

- **2c-1 (this plan):** module **tool** contribution infrastructure. Foundational; no acp change; production no-op.
- **2c-2 (later):** module **command + prompt-fragment** contribution.
- **2c-3 (later):** migrate the acp plugin into `src/modules/coding/` (convert structural→direct imports; wire its 9 tools, `/acp` command, `acp-hint` fragment; build its magi `httpFetch` + admin config directly).
- **2c-4 (later):** delete `codingSecrets`/`codingRepos` from `PluginToolRuntimeContext`, delete `src/plugins/coding-secrets-facade.ts`, drop `coding.secrets` from `PLUGIN_PERMISSIONS` — the actual leak removal (only possible once acp, inside the module, calls the resolvers directly).

**In scope for 2c-1:**

- `src/ports/module-tools.ts` — `ModuleTool` type, `ModuleToolRuntimeContext`, `ModuleToolRegistry` interface, `createModuleToolRegistry()`, `moduleToolRegistry` singleton. Feature-agnostic.
- `src/tools/module-tool-set.ts` — `buildModuleToolSet(existingToolNames, runtime)` + `namespacedModuleToolName`.
- `src/ports/module.ts` — add `readonly tools?: readonly ModuleTool[]` to `TrustedModule`.
- `src/composition/load-trusted-modules.ts` — register each module's tools into `moduleToolRegistry` at load.
- `src/tools/index.ts` — inject `buildModuleToolSet(...)` into both `buildToolDescriptors` and `buildProviderlessToolDescriptors` at the existing tool-merge.

**Deliberately deferred (do NOT build here):** module commands, module prompt fragments, the acp migration, the facade/permission removal, and any module tool runtime-context field beyond `{ storageContextId, chatUserId }` (a module builds its own `httpFetch`/config/kv by calling the plain store/provider-runtime functions directly and closing over them in its tool factories — proven feasible by recon, wired in 2c-3).

**Behavior invariant:** identical runtime behavior. In production no `TrustedModule` sets `tools` (the only module, `codingModule`, does not), so `moduleToolRegistry` is empty and `buildModuleToolSet` returns `{}` — the merged tool set is byte-identical. The full suite stays green; the mechanism is proven with a test fixture module.

**Guard note:** `src/ports/module-tools.ts` must stay feature-agnostic (the architecture guard scans `src/ports/**` for `kaneo|youtrack|magi|coding|plugin_acp__`). Zod / `ai` type imports are fine (not feature names). `src/tools/module-tool-set.ts` and `src/tools/index.ts` are not guard-scanned.

---

## Design notes (why this shape)

- **One choke point.** `buildToolDescriptors` / `buildProviderlessToolDescriptors` (`src/tools/index.ts:180-261`) both end with `return { ...wrappedBuiltins, ...mcpTools, ...pluginTools }`. Adding `...moduleTools` there is the only injection needed — everything downstream (`makeTools` → `applyToolPreferences` → orchestrator) consumes the merged set opaquely.
- **Reuse, don't fork, the generic primitives.** `wrapToolExecution` (`src/tools/wrap-tool-execution.ts`, converts throws → `buildToolFailureResult`) and `toolGateRegistry.setGate` (`src/ports/tool-gate.ts`) are manifest-independent. Module tools use them directly. Operator-gating (`gate: 'operator'`) then works through the existing `applyWhoMayUseFilter` with no new code.
- **Minimal module tool context.** A module tool's `execute` receives only `{ storageContextId, chatUserId }` — the per-call varying data. Static collaborators (`httpFetch`, admin config, kv, coding resolvers) are built once by the module and captured in its tool closures (exactly how the acp plugin does `startSessionTool(httpFetch)` today) — that wiring lands in 2c-3, not here.
- **Registry over direct import.** `src/tools/` reads a generic `moduleToolRegistry` (populated by the composition root from `TrustedModule.tools`), rather than importing `TRUSTED_MODULES` — mirroring how `buildPluginToolSet` reads `contributionRegistry`, and keeping `src/tools` free of a direct `src/composition`/`src/modules` dependency.

---

## Task 1: `ModuleTool` types + `moduleToolRegistry` port

**Files:** Create `src/ports/module-tools.ts`; Test `tests/ports/module-tools.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/ports/module-tools.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { z } from 'zod'

import { createModuleToolRegistry, moduleToolRegistry, type ModuleTool } from '../../src/ports/module-tools.js'

const fakeTool = (name: string): ModuleTool => ({
  name,
  description: name,
  inputSchema: z.object({}),
  execute: (): Promise<null> => Promise.resolve(null),
})

describe('ModuleToolRegistry', () => {
  test('registers and lists tools tagged with their module id', () => {
    const reg = createModuleToolRegistry()
    reg.register('coding', [fakeTool('start_session'), fakeTool('list_sessions')])
    expect(reg.list().map((e) => `${e.moduleId}:${e.tool.name}`)).toEqual([
      'coding:start_session',
      'coding:list_sessions',
    ])
  })

  test('clear empties the registry', () => {
    const reg = createModuleToolRegistry()
    reg.register('m', [fakeTool('t')])
    reg.clear()
    expect(reg.list()).toEqual([])
  })

  test('exposes a shared singleton', () => {
    expect(typeof moduleToolRegistry.list).toBe('function')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/ports/module-tools.test.ts`
Expected: FAIL — module `../../src/ports/module-tools.js` cannot be resolved.

- [ ] **Step 3: Write the port**

Create `src/ports/module-tools.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolExecutionOptions } from 'ai'
import type { z } from 'zod'

/** Per-call context handed to a module tool's execute. Trusted modules build their own
 * collaborators (httpFetch/config/storage) at load and close over them in tool factories,
 * so only the per-call varying identity is passed here. */
export type ModuleToolRuntimeContext = {
  storageContextId: string
  chatUserId: string
}

/** A tool contributed by a trusted module. Unlike a sandboxed plugin tool it uses a Zod schema
 * directly and is not permission-gated (a module is trusted). `gate: 'operator'` restricts it
 * via the who-may-use filter through the ToolGatePort, exactly like plugin tools. */
export type ModuleTool = {
  name: string
  description: string
  inputSchema: z.ZodType
  gate?: 'operator'
  execute: (input: unknown, runtimeContext: ModuleToolRuntimeContext, options: ToolExecutionOptions) => Promise<unknown>
}

/** Process-wide registry of tools contributed by trusted modules, populated at the composition
 * root from each module's `tools`. Read by `buildModuleToolSet` at tool assembly.
 *
 * NOTE: keep this file feature-agnostic — the architecture guard scans `src/ports/**` for
 * feature/provider names. Do not reference concrete module or tool names here. */
export interface ModuleToolRegistry {
  register(moduleId: string, tools: readonly ModuleTool[]): void
  list(): readonly { moduleId: string; tool: ModuleTool }[]
  clear(): void
}

/** Create an isolated registry (used by tests and, as a singleton, by the runtime). */
export function createModuleToolRegistry(): ModuleToolRegistry {
  const entries: { moduleId: string; tool: ModuleTool }[] = []
  return {
    register: (moduleId, tools) => {
      for (const tool of tools) entries.push({ moduleId, tool })
    },
    list: () => entries,
    clear: () => {
      entries.length = 0
    },
  }
}

/** Process-wide singleton: composition registers module tools here; `src/tools` reads them. */
export const moduleToolRegistry: ModuleToolRegistry = createModuleToolRegistry()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/ports/module-tools.test.ts`
Expected: PASS (3 tests). If oxlint flags the test's `execute` arrow, use `(): Promise<null> => Promise.resolve(null)` as shown (already lint-clean for explicit-return-type/require-await).

- [ ] **Step 5: Commit**

```bash
git add src/ports/module-tools.ts tests/ports/module-tools.test.ts
git commit -m "feat(ports): add ModuleTool types + moduleToolRegistry"
```

---

## Task 2: `buildModuleToolSet`

**Files:** Create `src/tools/module-tool-set.ts`; Test `tests/tools/module-tool-set.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/tools/module-tool-set.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'

import { moduleToolRegistry, type ModuleTool, type ModuleToolRuntimeContext } from '../../src/ports/module-tools.js'
import { toolGateRegistry } from '../../src/ports/tool-gate.js'
import { buildModuleToolSet, namespacedModuleToolName } from '../../src/tools/module-tool-set.js'

const ctx: ModuleToolRuntimeContext = { storageContextId: 'ctx-1', chatUserId: 'u-1' }

const echoTool = (name: string, gate?: 'operator'): ModuleTool => ({
  name,
  description: name,
  inputSchema: z.object({}),
  ...(gate === undefined ? {} : { gate }),
  // returns the context it was called with, so the test can prove wiring
  execute: (_input, runtimeContext): Promise<ModuleToolRuntimeContext> => Promise.resolve(runtimeContext),
})

afterEach(() => {
  moduleToolRegistry.clear()
})

describe('buildModuleToolSet', () => {
  test('namespaces module tools as module_<id>__<tool>', () => {
    expect(namespacedModuleToolName('task-provider-kaneo', 'do_thing')).toBe('module_task_provider_kaneo__do_thing')
  })

  test('assembles registered module tools into a ToolSet under the namespaced name', () => {
    moduleToolRegistry.register('coding', [echoTool('start_session')])
    const out = buildModuleToolSet(new Set<string>(), ctx)
    expect('module_coding__start_session' in out).toBe(true)
  })

  test('passes the runtime context to the tool execute', async () => {
    moduleToolRegistry.register('coding', [echoTool('start_session')])
    const out = buildModuleToolSet(new Set<string>(), ctx)
    const entry = out['module_coding__start_session']
    const result = await entry?.execute?.({}, { toolCallId: 't1', messages: [] })
    expect(result).toEqual(ctx)
  })

  test('records an operator gate in the ToolGatePort', () => {
    moduleToolRegistry.register('coding', [echoTool('start_session', 'operator'), echoTool('list_sessions')])
    buildModuleToolSet(new Set<string>(), ctx)
    expect(toolGateRegistry.isOperatorGated('module_coding__start_session')).toBe(true)
    expect(toolGateRegistry.isOperatorGated('module_coding__list_sessions')).toBe(false)
  })

  test('skips a tool whose namespaced name collides with an existing tool', () => {
    moduleToolRegistry.register('coding', [echoTool('start_session')])
    const out = buildModuleToolSet(new Set<string>(['module_coding__start_session']), ctx)
    expect('module_coding__start_session' in out).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/module-tool-set.test.ts`
Expected: FAIL — module `../../src/tools/module-tool-set.js` cannot be resolved.

- [ ] **Step 3: Write the assembler**

Create `src/tools/module-tool-set.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool, type ToolSet } from 'ai'

import { logger } from '../logger.js'
import { moduleToolRegistry, type ModuleToolRuntimeContext } from '../ports/module-tools.js'
import { toolGateRegistry } from '../ports/tool-gate.js'
import { wrapToolExecution } from './wrap-tool-execution.js'

const log = logger.child({ scope: 'tools:module' })

const sanitizeModuleId = (moduleId: string): string => moduleId.replace(/-/gu, '_')

/** Namespace a module tool name: `module_<sanitized-id>__<tool>` (parallel to plugin tools). */
export const namespacedModuleToolName = (moduleId: string, toolName: string): string =>
  `module_${sanitizeModuleId(moduleId)}__${toolName}`

/**
 * Assemble the tools contributed by trusted modules into a `ToolSet`, namespaced and wrapped like
 * plugin tools. Records each tool's gate into the ToolGatePort so operator-gating works via the
 * existing who-may-use filter. Names colliding with an already-assembled tool are skipped.
 */
export function buildModuleToolSet(existingToolNames: ReadonlySet<string>, runtime: ModuleToolRuntimeContext): ToolSet {
  const out: ToolSet = {}
  const used = new Set(existingToolNames)
  for (const { moduleId, tool: moduleTool } of moduleToolRegistry.list()) {
    const name = namespacedModuleToolName(moduleId, moduleTool.name)
    if (used.has(name)) {
      log.warn({ moduleId, tool: moduleTool.name, name }, 'Module tool name collision; skipping')
      continue
    }
    used.add(name)
    toolGateRegistry.setGate(name, moduleTool.gate ?? 'default')
    const wrapped = wrapToolExecution((input, options) => moduleTool.execute(input, runtime, options), name)
    out[name] = tool({ description: moduleTool.description, inputSchema: moduleTool.inputSchema, execute: wrapped })
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools/module-tool-set.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/module-tool-set.ts tests/tools/module-tool-set.test.ts
git commit -m "feat(tools): add buildModuleToolSet for trusted-module tools"
```

---

## Task 3: `TrustedModule.tools` + register at composition load

**Files:** Modify `src/ports/module.ts`, `src/composition/load-trusted-modules.ts`; Test `tests/composition/load-trusted-modules.test.ts` (extend).

- [ ] **Step 1: Add `tools?` to `TrustedModule`**

In `src/ports/module.ts`, add the import and the field. The `Migration` import is already present; add:

```ts
import type { ModuleTool } from './module-tools.js'
```

Add to the `TrustedModule` interface (after `migrations?`):

```ts
  /** LLM tools this module contributes (assembled by buildModuleToolSet, namespaced module_<id>__<tool>). */
  readonly tools?: readonly ModuleTool[]
```

- [ ] **Step 2: Write the failing test (extend the loader suite)**

In `tests/composition/load-trusted-modules.test.ts`, add these imports at the top (alongside the existing ones):

```ts
import { moduleToolRegistry } from '../../src/ports/module-tools.js'
import { z } from 'zod'
```

Add a test inside the existing `describe('loadTrustedModules', …)` block:

```ts
test("registers each module's tools into the moduleToolRegistry", async () => {
  moduleToolRegistry.clear()
  const mod: TrustedModule = {
    id: 'fixture',
    tools: [
      {
        name: 'do_it',
        description: 'do_it',
        inputSchema: z.object({}),
        execute: (): Promise<null> => Promise.resolve(null),
      },
    ],
  }
  await loadTrustedModules([mod], () => {})
  expect(moduleToolRegistry.list().map((e) => `${e.moduleId}:${e.tool.name}`)).toContain('fixture:do_it')
  moduleToolRegistry.clear()
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/composition/load-trusted-modules.test.ts`
Expected: FAIL — `loadTrustedModules` does not yet register module tools, so the registry stays empty.

- [ ] **Step 4: Register module tools in the loader**

In `src/composition/load-trusted-modules.ts`, add the import:

```ts
import { moduleToolRegistry } from '../ports/module-tools.js'
```

In `loadTrustedModules`, add a registration pass. Place it BEFORE the `onActivate` pass (so a module's `onActivate`, if it inspects the registry, sees tools already registered), and AFTER the migrations pass:

```ts
for (const mod of modules) {
  if (mod.tools !== undefined && mod.tools.length > 0) {
    moduleToolRegistry.register(mod.id, mod.tools)
  }
}
```

So the function body is: migrations pass → tool-registration pass → `onActivate` pass.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/composition/load-trusted-modules.test.ts`
Expected: PASS (existing loader tests + the new one).

- [ ] **Step 6: Commit**

```bash
git add src/ports/module.ts src/composition/load-trusted-modules.ts tests/composition/load-trusted-modules.test.ts
git commit -m "feat(modules): TrustedModule.tools + register module tools at load"
```

---

## Task 4: Inject module tools into the assembled tool set

**Files:** Modify `src/tools/index.ts`.

Both `buildToolDescriptors` (`:180-220`) and `buildProviderlessToolDescriptors` (`:222-261`) currently end with `return { ...wrappedBuiltins, ...mcpTools, ...pluginTools }`. Add module tools to both, keyed on the same `contextId`/`chatUserId` guard the plugin path uses.

No new test file — this is covered by Task 2's `buildModuleToolSet` unit tests plus the full suite (the production registry is empty, so both descriptor builders return byte-identical sets today). The wiring is verified in Task 5.

- [ ] **Step 1: Add the import**

In `src/tools/index.ts`, add alongside the other local imports (respect import ordering):

```ts
import { buildModuleToolSet } from './module-tool-set.js'
```

- [ ] **Step 2: Inject into `buildToolDescriptors`**

Replace the final `return { ...wrappedBuiltins, ...mcpTools, ...pluginTools }` (line 219) with:

```ts
let moduleTools: ToolSet = {}
if (contextId !== undefined && chatUserId !== undefined) {
  const existing = new Set([...Object.keys(wrappedBuiltins), ...Object.keys(mcpTools), ...Object.keys(pluginTools)])
  moduleTools = buildModuleToolSet(existing, { storageContextId: contextId, chatUserId })
}
return { ...wrappedBuiltins, ...mcpTools, ...pluginTools, ...moduleTools }
```

- [ ] **Step 3: Inject into `buildProviderlessToolDescriptors`**

Replace the final `return { ...wrappedBuiltins, ...mcpTools, ...pluginTools }` (line 260) with the identical block:

```ts
let moduleTools: ToolSet = {}
if (contextId !== undefined && chatUserId !== undefined) {
  const existing = new Set([...Object.keys(wrappedBuiltins), ...Object.keys(mcpTools), ...Object.keys(pluginTools)])
  moduleTools = buildModuleToolSet(existing, { storageContextId: contextId, chatUserId })
}
return { ...wrappedBuiltins, ...mcpTools, ...pluginTools, ...moduleTools }
```

(`contextId` and `chatUserId` are already in scope in both functions.)

- [ ] **Step 4: Typecheck + confirm no regression**

Run: `bun run typecheck`
Expected: clean.

Run: `bun test tests/tools/ tests/llm-orchestrator-tools.test.ts`
Expected: PASS. In tests the `moduleToolRegistry` is empty (nothing registers module tools unless a test does), so `buildModuleToolSet` returns `{}` and the merged set is unchanged.

Run: `bun run knip`
Expected: clean — `buildModuleToolSet` is now consumed by `src/tools/index.ts`, and `moduleToolRegistry`/`ModuleTool` are consumed by the loader + assembler. (If knip flags any as unused, a wiring step was missed.)

- [ ] **Step 5: Commit**

```bash
git add src/tools/index.ts
git commit -m "feat(tools): merge trusted-module tools into the assembled tool set"
```

---

## Task 5: Full verification

- [ ] **Step 1: Build client bundles, run the full test suite**

```bash
bun build:client
```

Run: `bun test`
Expected: PASS with the same pass count as before this phase plus the new tests added here (Task 1: +3, Task 2: +5, Task 3: +1 — so +9 total). No production behavior change: no module contributes tools, so `moduleToolRegistry` is empty at runtime and the assembled tool set is byte-identical.

- [ ] **Step 2: Full check pipeline**

Run: `bun check:full`
Expected: all green. Fix formatting with `bun run format` and re-run if needed.

- [ ] **Step 3: Confirm the production no-op explicitly**

Run: `rg -n "tools:" src/modules/coding/module.ts`
Expected: no output — `codingModule` does NOT set `tools` in this phase, confirming production `moduleToolRegistry` stays empty (the acp tool migration is 2c-3). The infrastructure is present and unit-tested with a fixture, but dormant in production.

---

## Done criteria

- `TrustedModule` can declare `tools`; `loadTrustedModules` registers them into `moduleToolRegistry`; `buildModuleToolSet` namespaces (`module_<id>__<tool>`), records gates into the ToolGatePort, wraps with `wrapToolExecution`, and is merged into both `buildToolDescriptors` / `buildProviderlessToolDescriptors`.
- `src/ports/module-tools.ts` is feature-agnostic (architecture guard green).
- `bun test` and `bun check:full` green; production tool set unchanged (no module sets `tools` yet).
- The next plan (2c-2) adds module **command + prompt-fragment** contribution (`registerModuleCommands` beside `registerPluginCommands` in `src/bot.ts`; a module prompt section beside `appendPluginPromptSection` in `src/system-prompt.ts`), reusing the choke points identified in recon — after which 2c-3 can move the acp tools/command/fragment into `src/modules/coding/` and 2c-4 can delete the `codingSecrets`/`codingRepos` facades and the `coding.secrets` permission.
