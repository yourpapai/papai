<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plugin / Core Separation — Phase 2c-2: Module Command & Prompt-Fragment Contribution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a **trusted module** contribute chat commands and system-prompt fragments, mirroring Phase 2c-1's tool contribution. This completes the module contribution surface so Phase 2c-3 can migrate the acp plugin's `/acp` command and `acp-hint` prompt fragment (alongside its already-migratable tools) into `src/modules/coding/`. Behavior-preserving: no module contributes commands/fragments yet, so the production command set and system prompt are unchanged.

**Architecture:** Two-tier ports & adapters. Reuses the proven registry-singleton pattern from 2c-1 (`moduleToolRegistry`). A module is trusted (no sandbox, no manifest, always active), so its commands skip the plugin path's per-context eligibility re-check and its prompt fragments skip the `getPluginsForContext` filter — everything else (namespacing, budget/truncation, `chat.registerCommand`) is the same generic machinery plugins use. Namespacing parallels plugins: `module_<id>_<command>` for commands, `<!-- module:<id>:<fragment> -->` for prompt sections.

**Tech Stack:** Bun + strict TypeScript, `bun:test`. Imports use the `.js` extension.

---

## Scope & Deferred (read first)

**This is plan 2c-2 of the "acp becomes a trusted module" sub-epic:**

- 2c-1 (done): module **tool** contribution.
- **2c-2 (this plan):** module **command + prompt-fragment** contribution. Foundational; no acp change; production no-op.
- 2c-3 (later): migrate the acp plugin into `src/modules/coding/` (its 9 tools, `/acp` command, `acp-hint` fragment; build its magi `httpFetch` + admin config directly).
- 2c-4 (later): delete `codingSecrets`/`codingRepos` from `PluginToolRuntimeContext`, delete `src/plugins/coding-secrets-facade.ts`, drop `coding.secrets` from `PLUGIN_PERMISSIONS`.

**In scope for 2c-2:**

- `src/ports/module-contributions.ts` — `ModuleCommand`, `ModulePromptFragment` types + `moduleCommandRegistry` / `modulePromptFragmentRegistry` singletons (register/list/clear each). Feature-agnostic.
- `src/plugins/module-command-contributions.ts` — `registerModuleCommands(chat)` + `namespacedModuleCommandName`.
- `src/plugins/module-prompt-contributions.ts` — `buildModulePromptSection()` + `appendModulePromptSection(basePrompt)`.
- `src/ports/module.ts` — add `readonly commands?` and `readonly promptFragments?` to `TrustedModule`.
- `src/composition/load-trusted-modules.ts` — extend the registration pass to also register commands + fragments.
- `src/bot.ts` — call `registerModuleCommands(observedChat)` beside `registerPluginCommands`.
- `src/system-prompt.ts` — chain `appendModulePromptSection` after the plugin prompt append in both `buildSystemPrompt` and `buildProviderlessSystemPrompt`.

**Deliberately deferred:** the acp migration (2c-3), the facade/permission removal (2c-4), module scheduled jobs / attachment transformers (not needed for acp).

**Behavior invariant:** identical runtime behavior. The only module (`codingModule`) declares no `commands`/`promptFragments`, so both registries are empty: `registerModuleCommands` registers nothing and `buildModulePromptSection()` returns `''` (so `appendModulePromptSection` returns the prompt unchanged). Full suite stays green; mechanisms proven with test fixtures.

**Guard note:** `src/ports/module-contributions.ts` must stay feature-agnostic (guard scans `src/ports/**`). Type-only imports of chat message types (`IncomingMessage`/`ReplyFn`/`AuthorizationResult`) are fine — not feature names. `src/plugins/*` and `src/bot.ts`/`src/system-prompt.ts` are not guard-scanned.

---

## Reference: the plugin machinery being mirrored

- Commands: `src/plugins/command-contributions.ts` — `registerPluginCommands(chat)` iterates `contributionRegistry.getAllContributions()`, namespaces `plugin_<sanitized-id>_<command>` (`namespacedCommandName`), wraps in a `CommandHandler` that re-checks `getPluginContextEligibility` per invocation, then `chat.registerCommand(name, handler)`. Called once at `src/bot.ts:128`.
- Prompt fragments: `src/plugins/prompt-contributions.ts` — `buildPluginPromptSection(activePluginIds)` evaluates each fragment's `content` (string or thunk), truncates to `MAX_FRAGMENT_LENGTH_PER_PLUGIN` (2000), caps total at `MAX_TOTAL_PLUGIN_PROMPT_LENGTH` (8000), wraps `<!-- plugin:<id>:<fragment> -->…<!-- /plugin:<id>:<fragment> -->`, joins with `\n\n`. Injected by `appendPluginPromptSection`/`appendProviderlessPluginPromptSection` (`src/system-prompt.ts:225-245`), called at `src/system-prompt.ts:279` and `:294`.
- Types: `PluginCommand` (`{ name; description; execute(message, reply, auth): Promise<void> | void }`) and `PluginPromptFragment` (`{ name; content: string | (() => string) }`) at `src/plugins/runtime-types.ts:99-110`. `CommandHandler` = `(msg, reply, auth) => Promise<void>` and `ChatProvider.registerCommand(name, handler)` at `src/chat/types.ts:185,254`.

Module versions differ only by: no eligibility re-check (modules always active), no `getPluginsForContext` filter, and `module_`/`module:` namespacing with independent budgets.

---

## Task 1: `ModuleCommand`/`ModulePromptFragment` types + registries

**Files:** Create `src/ports/module-contributions.ts`; Test `tests/ports/module-contributions.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/ports/module-contributions.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  createModuleCommandRegistry,
  createModulePromptFragmentRegistry,
  moduleCommandRegistry,
  modulePromptFragmentRegistry,
  type ModuleCommand,
  type ModulePromptFragment,
} from '../../src/ports/module-contributions.js'

const cmd = (name: string): ModuleCommand => ({
  name,
  description: name,
  execute: (): Promise<void> => Promise.resolve(),
})
const frag = (name: string): ModulePromptFragment => ({ name, content: name })

describe('module contribution registries', () => {
  test('command registry registers/lists/clears', () => {
    const reg = createModuleCommandRegistry()
    reg.register('coding', [cmd('acp')])
    expect(reg.list().map((e) => `${e.moduleId}:${e.command.name}`)).toEqual(['coding:acp'])
    reg.clear()
    expect(reg.list()).toEqual([])
  })

  test('prompt-fragment registry registers/lists/clears', () => {
    const reg = createModulePromptFragmentRegistry()
    reg.register('coding', [frag('acp-hint')])
    expect(reg.list().map((e) => `${e.moduleId}:${e.fragment.name}`)).toEqual(['coding:acp-hint'])
    reg.clear()
    expect(reg.list()).toEqual([])
  })

  test('exposes shared singletons', () => {
    expect(typeof moduleCommandRegistry.list).toBe('function')
    expect(typeof modulePromptFragmentRegistry.list).toBe('function')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/ports/module-contributions.test.ts`
Expected: FAIL — module cannot be resolved.

- [ ] **Step 3: Write the port**

Create `src/ports/module-contributions.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AuthorizationResult, IncomingMessage, ReplyFn } from '../chat/types.js'

/** A chat command contributed by a trusted module (mirrors PluginCommand, no eligibility gating). */
export type ModuleCommand = {
  name: string
  description: string
  execute: (message: IncomingMessage, reply: ReplyFn, auth: AuthorizationResult) => Promise<void> | void
}

/** A system-prompt fragment contributed by a trusted module (mirrors PluginPromptFragment). */
export type ModulePromptFragment = {
  name: string
  content: string | (() => string)
}

/**
 * Registries of module-contributed commands / prompt fragments, populated at the composition root
 * from each module's `commands`/`promptFragments`. Read by the command-registration adapter and the
 * prompt-section builder.
 *
 * NOTE: keep this file feature-agnostic — the architecture guard scans `src/ports/**` for
 * feature/provider names. Do not reference concrete module or feature names here.
 */
export interface ModuleCommandRegistry {
  register(moduleId: string, commands: readonly ModuleCommand[]): void
  list(): readonly { moduleId: string; command: ModuleCommand }[]
  clear(): void
}

export interface ModulePromptFragmentRegistry {
  register(moduleId: string, fragments: readonly ModulePromptFragment[]): void
  list(): readonly { moduleId: string; fragment: ModulePromptFragment }[]
  clear(): void
}

export function createModuleCommandRegistry(): ModuleCommandRegistry {
  const entries: { moduleId: string; command: ModuleCommand }[] = []
  return {
    register: (moduleId, commands) => {
      for (const command of commands) entries.push({ moduleId, command })
    },
    list: () => entries,
    clear: () => {
      entries.length = 0
    },
  }
}

export function createModulePromptFragmentRegistry(): ModulePromptFragmentRegistry {
  const entries: { moduleId: string; fragment: ModulePromptFragment }[] = []
  return {
    register: (moduleId, fragments) => {
      for (const fragment of fragments) entries.push({ moduleId, fragment })
    },
    list: () => entries,
    clear: () => {
      entries.length = 0
    },
  }
}

/** Process-wide singletons: composition registers here; the command/prompt adapters read them. */
export const moduleCommandRegistry: ModuleCommandRegistry = createModuleCommandRegistry()
export const modulePromptFragmentRegistry: ModulePromptFragmentRegistry = createModulePromptFragmentRegistry()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/ports/module-contributions.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ports/module-contributions.ts tests/ports/module-contributions.test.ts
git commit -m "feat(ports): add ModuleCommand/ModulePromptFragment types + registries"
```

> A transient `knip` "unused" for these exports is expected until later tasks consume them — not a pre-commit gate.

---

## Task 2: `registerModuleCommands` adapter

**Files:** Create `src/plugins/module-command-contributions.ts`; Test `tests/plugins/module-command-contributions.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/plugins/module-command-contributions.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { moduleCommandRegistry } from '../../src/ports/module-contributions.js'
import { namespacedModuleCommandName, registerModuleCommands } from '../../src/plugins/module-command-contributions.js'
import { createMockChat } from '../utils/test-helpers.js'

afterEach(() => {
  moduleCommandRegistry.clear()
})

describe('registerModuleCommands', () => {
  test('namespaces commands as module_<id>_<command>', () => {
    expect(namespacedModuleCommandName('task-provider-kaneo', 'sync')).toBe('module_task_provider_kaneo_sync')
  })

  test('registers each module command under its namespaced name and invokes execute', async () => {
    let called = false
    moduleCommandRegistry.register('coding', [
      {
        name: 'acp',
        description: 'acp',
        execute: (): Promise<void> => {
          called = true
          return Promise.resolve()
        },
      },
    ])
    const chat = createMockChat()
    registerModuleCommands(chat)
    // Capture what was registered — see the note below on the exact assertion mechanism.
    // Assert: a handler was registered under 'module_coding_acp', and invoking it runs execute (called === true).
    expect(called).toBe(false) // not called until the handler runs
  })
})
```

> **Test-authoring note (delegate the mechanics to lint/typecheck):** the exact way to capture registrations depends on what `createMockChat()` (`tests/utils/test-helpers.ts`) exposes. Read it first. If it records registered commands (or lets you spy `registerCommand` via `mock()`), assert the namespaced name `'module_coding_acp'` was registered and that invoking the captured handler sets `called === true` (await it). If `createMockChat` doesn't fit, build a lint-clean minimal `ChatProvider` (a typed object or a `mock()`-based double) — do **not** add any lint-disable comment (the hook blocks them) and do **not** use raw `as unknown as` casts that trip `no-unsafe-type-assertion`; prefer `mock()` spies and the existing helper. The required assertions are: (1) `namespacedModuleCommandName` formats `module_<sanitized-id>_<command>`, and (2) `registerModuleCommands` registers the namespaced handler and that handler invokes the command's `execute`. Adjust the test body to whatever is lint-clean while keeping those two assertions.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/module-command-contributions.test.ts`
Expected: FAIL — module cannot be resolved.

- [ ] **Step 3: Write the adapter**

Create `src/plugins/module-command-contributions.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatProvider, CommandHandler } from '../chat/types.js'
import { moduleCommandRegistry } from '../ports/module-contributions.js'

const sanitizeModuleId = (moduleId: string): string => moduleId.replace(/-/gu, '_')

/** Namespace a module command: `module_<sanitized-id>_<command>` (parallel to plugin commands). */
export function namespacedModuleCommandName(moduleId: string, commandName: string): string {
  return `module_${sanitizeModuleId(moduleId)}_${commandName}`
}

/**
 * Register every trusted-module command with the chat provider. Unlike plugin commands there is no
 * per-context eligibility re-check — a trusted module is always active.
 */
export function registerModuleCommands(chat: ChatProvider): void {
  for (const { moduleId, command } of moduleCommandRegistry.list()) {
    const name = namespacedModuleCommandName(moduleId, command.name)
    const handler: CommandHandler = async (message, reply, auth) => {
      await Promise.resolve(command.execute(message, reply, auth))
    }
    chat.registerCommand(name, handler)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/module-command-contributions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/module-command-contributions.ts tests/plugins/module-command-contributions.test.ts
git commit -m "feat(plugins): registerModuleCommands adapter for trusted-module commands"
```

---

## Task 3: `buildModulePromptSection` + `appendModulePromptSection`

**Files:** Create `src/plugins/module-prompt-contributions.ts`; Test `tests/plugins/module-prompt-contributions.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/plugins/module-prompt-contributions.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { modulePromptFragmentRegistry } from '../../src/ports/module-contributions.js'
import {
  appendModulePromptSection,
  buildModulePromptSection,
  MAX_FRAGMENT_LENGTH_PER_MODULE,
} from '../../src/plugins/module-prompt-contributions.js'

afterEach(() => {
  modulePromptFragmentRegistry.clear()
})

describe('module prompt contributions', () => {
  test('wraps each fragment in a module: comment section', () => {
    modulePromptFragmentRegistry.register('coding', [{ name: 'acp-hint', content: 'use acp' }])
    const section = buildModulePromptSection()
    expect(section).toBe('<!-- module:coding:acp-hint -->\nuse acp\n<!-- /module:coding:acp-hint -->')
  })

  test('evaluates a thunk fragment', () => {
    modulePromptFragmentRegistry.register('coding', [{ name: 'f', content: () => 'dynamic' }])
    expect(buildModulePromptSection()).toContain('dynamic')
  })

  test('truncates an over-length fragment', () => {
    modulePromptFragmentRegistry.register('coding', [
      { name: 'big', content: 'x'.repeat(MAX_FRAGMENT_LENGTH_PER_MODULE + 500) },
    ])
    expect(buildModulePromptSection()).toContain('[truncated]')
  })

  test('appendModulePromptSection returns basePrompt unchanged when there are no fragments', () => {
    expect(appendModulePromptSection('BASE')).toBe('BASE')
  })

  test('appendModulePromptSection appends the section when fragments exist', () => {
    modulePromptFragmentRegistry.register('coding', [{ name: 'acp-hint', content: 'use acp' }])
    expect(appendModulePromptSection('BASE')).toBe(
      'BASE\n\n<!-- module:coding:acp-hint -->\nuse acp\n<!-- /module:coding:acp-hint -->',
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/module-prompt-contributions.test.ts`
Expected: FAIL — module cannot be resolved.

- [ ] **Step 3: Write the builder**

Create `src/plugins/module-prompt-contributions.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import { modulePromptFragmentRegistry } from '../ports/module-contributions.js'

const log = logger.child({ scope: 'modules:prompt-contributions' })

/** Maximum prompt fragment length per module (characters). */
export const MAX_FRAGMENT_LENGTH_PER_MODULE = 2000

/** Maximum total module prompt budget (characters) — independent of the plugin budget. */
export const MAX_TOTAL_MODULE_PROMPT_LENGTH = 8000

/** Build the system-prompt section for all trusted-module prompt fragments (modules are always active). */
export function buildModulePromptSection(): string {
  const sections: string[] = []
  let totalLength = 0

  for (const { moduleId, fragment } of modulePromptFragmentRegistry.list()) {
    if (totalLength >= MAX_TOTAL_MODULE_PROMPT_LENGTH) {
      log.warn({ moduleId }, 'Total module prompt budget exceeded — stopping')
      break
    }

    let rawContent: string
    try {
      rawContent = typeof fragment.content === 'function' ? fragment.content() : fragment.content
    } catch (error) {
      log.warn(
        { moduleId, fragmentName: fragment.name, error: error instanceof Error ? error.message : String(error) },
        'Module prompt fragment threw — skipping',
      )
      continue
    }
    const truncated =
      rawContent.length > MAX_FRAGMENT_LENGTH_PER_MODULE
        ? rawContent.slice(0, MAX_FRAGMENT_LENGTH_PER_MODULE - '[truncated]'.length) + '[truncated]'
        : rawContent

    const section = `<!-- module:${moduleId}:${fragment.name} -->\n${truncated}\n<!-- /module:${moduleId}:${fragment.name} -->`
    sections.push(section)
    totalLength += section.length
  }

  return sections.join('\n\n')
}

/** Append the module prompt section to a base prompt, or return it unchanged when there is none. */
export function appendModulePromptSection(basePrompt: string): string {
  const section = buildModulePromptSection()
  if (section === '') return basePrompt
  return `${basePrompt}\n\n${section}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/module-prompt-contributions.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/plugins/module-prompt-contributions.ts tests/plugins/module-prompt-contributions.test.ts
git commit -m "feat(plugins): buildModulePromptSection for trusted-module prompt fragments"
```

---

## Task 4: `TrustedModule.commands`/`promptFragments` + register at load

**Files:** Modify `src/ports/module.ts`, `src/composition/load-trusted-modules.ts`; Test `tests/composition/load-trusted-modules.test.ts` (extend).

- [ ] **Step 1: Add the fields to `TrustedModule`**

In `src/ports/module.ts`, add imports (near the existing `ModuleTool` import from Task 2c-1):

```ts
import type { ModuleCommand, ModulePromptFragment } from './module-contributions.js'
```

Add to the `TrustedModule` interface (after `tools?`):

```ts
  /** Chat commands this module contributes (registered by registerModuleCommands, namespaced module_<id>_<command>). */
  readonly commands?: readonly ModuleCommand[]
  /** System-prompt fragments this module contributes (assembled by buildModulePromptSection). */
  readonly promptFragments?: readonly ModulePromptFragment[]
```

- [ ] **Step 2: Write the failing test (extend the loader suite)**

In `tests/composition/load-trusted-modules.test.ts`, add imports:

```ts
import { moduleCommandRegistry, modulePromptFragmentRegistry } from '../../src/ports/module-contributions.js'
```

Add a test inside the `describe('loadTrustedModules', …)` block:

```ts
test("registers each module's commands and prompt fragments", async () => {
  moduleCommandRegistry.clear()
  modulePromptFragmentRegistry.clear()
  const mod: TrustedModule = {
    id: 'fixture',
    commands: [{ name: 'go', description: 'go', execute: (): Promise<void> => Promise.resolve() }],
    promptFragments: [{ name: 'hint', content: 'hi' }],
  }
  await loadTrustedModules([mod], () => {})
  expect(moduleCommandRegistry.list().map((e) => `${e.moduleId}:${e.command.name}`)).toContain('fixture:go')
  expect(modulePromptFragmentRegistry.list().map((e) => `${e.moduleId}:${e.fragment.name}`)).toContain('fixture:hint')
  moduleCommandRegistry.clear()
  modulePromptFragmentRegistry.clear()
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/composition/load-trusted-modules.test.ts`
Expected: FAIL — the loader does not yet register commands/fragments.

- [ ] **Step 4: Register commands + fragments in the loader**

In `src/composition/load-trusted-modules.ts`, add the import:

```ts
import { moduleCommandRegistry, modulePromptFragmentRegistry } from '../ports/module-contributions.js'
```

Extend the existing registration pass (the loop that already does `moduleToolRegistry.register(...)`). Inside that same `for (const mod of modules)` loop, after the tools registration, add:

```ts
if (mod.commands !== undefined && mod.commands.length > 0) {
  moduleCommandRegistry.register(mod.id, mod.commands)
}
if (mod.promptFragments !== undefined && mod.promptFragments.length > 0) {
  modulePromptFragmentRegistry.register(mod.id, mod.promptFragments)
}
```

(Keep the ordering: migrations pass → contribution-registration pass (tools + commands + fragments) → onActivate pass.)

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/composition/load-trusted-modules.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ports/module.ts src/composition/load-trusted-modules.ts tests/composition/load-trusted-modules.test.ts
git commit -m "feat(modules): TrustedModule.commands/promptFragments + register at load"
```

---

## Task 5: Wire into the chat provider + system prompt

**Files:** Modify `src/bot.ts`, `src/system-prompt.ts`.

No new test file — behavior-preserving no-op today (registries empty), verified by the full suite in Task 6. The building blocks are unit-tested in Tasks 2–3.

- [ ] **Step 1: Register module commands in `src/bot.ts`**

Add the import alongside the existing plugin-command import (`src/bot.ts:39`):

```ts
import { registerModuleCommands } from './plugins/module-command-contributions.js'
```

Immediately after the existing `registerPluginCommands(observedChat)` call (`src/bot.ts:128`), add:

```ts
registerModuleCommands(observedChat)
```

- [ ] **Step 2: Append the module prompt section in `src/system-prompt.ts`**

Add the import alongside the existing prompt-contributions import:

```ts
import { appendModulePromptSection } from './plugins/module-prompt-contributions.js'
```

In `buildSystemPrompt`, change the final line (`:279`) from:

```ts
return appendPluginPromptSection(withAddendum, sharedContextId)
```

to:

```ts
return appendModulePromptSection(appendPluginPromptSection(withAddendum, sharedContextId))
```

In `buildProviderlessSystemPrompt`, change the final line (`:294`) from:

```ts
return appendProviderlessPluginPromptSection(basePrompt, sharedContextId)
```

to:

```ts
return appendModulePromptSection(appendProviderlessPluginPromptSection(basePrompt, sharedContextId))
```

(The module section is appended after the plugin section in both paths. `appendModulePromptSection` takes no context id — modules are always active.)

- [ ] **Step 3: Typecheck + confirm no regression + knip**

Run: `bun run typecheck`
Expected: clean.

Run: `bun test tests/system-prompt.test.ts tests/plugins/ tests/composition/`
Expected: PASS. The module registries are empty in these suites (nothing registers module commands/fragments), so `registerModuleCommands` is a no-op and `appendModulePromptSection` returns prompts unchanged.

Run: `bun run knip`
Expected: clean — `registerModuleCommands`, `appendModulePromptSection`, and the registries/types are now all reachable. If knip flags any as unused, a wiring step was missed.

- [ ] **Step 4: Commit**

```bash
git add src/bot.ts src/system-prompt.ts
git commit -m "feat(modules): wire module commands + prompt fragments into chat + system prompt"
```

---

## Task 6: Full verification

- [ ] **Step 1: Build client bundles, run the full suite**

```bash
bun build:client
```

Run: `bun test`
Expected: PASS with the same pass count as before plus the new tests (Task 1: +3, Task 2: +2, Task 3: +5, Task 4: +1 — so +11 total). No production behavior change.

- [ ] **Step 2: Full check pipeline**

Run: `bun check:full`
Expected: all green. Fix formatting with `bun run format` and re-run if needed.

- [ ] **Step 3: Confirm the production no-op**

Run: `rg -n "commands:|promptFragments:" src/modules/coding/module.ts`
Expected: no output — `codingModule` declares neither, so both module registries stay empty in production (the acp `/acp` command + `acp-hint` fragment migrate in 2c-3). The infrastructure is present and unit-tested with fixtures, but dormant.

---

## Done criteria

- A `TrustedModule` can declare `commands` and `promptFragments`; `loadTrustedModules` registers them; `registerModuleCommands` (called in `bot.ts`) registers each under `module_<id>_<command>`; `buildModulePromptSection` (via `appendModulePromptSection`, chained in both system-prompt builders) emits `<!-- module:<id>:<fragment> -->` sections with independent budget/truncation.
- `src/ports/module-contributions.ts` is feature-agnostic (architecture guard green).
- `bun test` and `bun check:full` green; production command set + system prompt unchanged (no module declares commands/fragments yet).
- The module contribution surface is now complete (tools from 2c-1 + commands/fragments here), so the next plan (2c-3) can migrate the acp plugin's tools, `/acp` command, and `acp-hint` fragment into `src/modules/coding/`, after which 2c-4 removes the `codingSecrets`/`codingRepos` facades and the `coding.secrets` permission.
