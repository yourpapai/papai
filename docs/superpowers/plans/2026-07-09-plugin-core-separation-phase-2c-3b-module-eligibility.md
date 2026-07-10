<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plugin / Core Separation — Phase 2c-3b: Module Per-Context Eligibility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a trusted module gate its contributions per chat context, so its tools/commands/prompt fragments surface only where the module is "set up" — preserving today's opt-in behavior once acp becomes an always-loaded module. A module declares an optional `isEligibleForContext(storageContextId)` predicate; the three module-contribution assembly points (tools, commands, prompt fragments) consult it. Behavior-preserving: no module declares a predicate yet, so everything stays eligible everywhere.

**Architecture:** Extends the module contribution system (2c-1/2c-2). A feature-agnostic `moduleEligibilityRegistry` (populated at composition load from each module's predicate) is consulted by `buildModuleToolSet`, `registerModuleCommands`, and `buildModulePromptSection` — mirroring how the plugin path consults `getPluginContextEligibility`. Default (no predicate) is "eligible", so the change is a no-op until a module opts in (acp will, in 2c-3c).

**Tech Stack:** Bun + strict TypeScript, `bun:test`. Imports use the `.js` extension.

---

## Scope & Deferred (read first)

**This is plan 2c-3b of the "acp becomes a trusted module" sub-epic:**

- 2c-1/2c-2 (done): module tools / commands / prompt fragments. 2c-3a/2c-3a-2 (done): SettingsSectionPort (backend + frontend).
- **2c-3b (this plan): module per-context eligibility gate.** Foundational; no module declares a predicate yet; production no-op.
- 2c-3c (later): migrate acp into `src/modules/coding/` — declares its magi settings section AND an `isEligibleForContext` predicate (e.g. "coding configured for this context") so acp only surfaces where set up.
- 2c-4 (later): remove `codingSecrets`/`codingRepos` + the `coding.secrets` permission.

**In scope:**

- `src/ports/module-eligibility.ts` — `ModuleEligibilityPredicate` type + `moduleEligibilityRegistry` singleton (register/isEligible/clear). Feature-agnostic.
- `src/ports/module.ts` — add `readonly isEligibleForContext?: (storageContextId: string) => boolean` to `TrustedModule`.
- `src/composition/load-trusted-modules.ts` — register each module's predicate at load.
- `src/tools/module-tool-set.ts` — `buildModuleToolSet` skips tools whose module is ineligible for `runtime.storageContextId`.
- `src/plugins/module-command-contributions.ts` — the command handler checks eligibility per-invocation (against `auth.storageContextId`); when ineligible it replies with a short message and does not execute.
- `src/plugins/module-prompt-contributions.ts` — `buildModulePromptSection(storageContextId)` / `appendModulePromptSection(basePrompt, storageContextId)` filter fragments by module eligibility.
- `src/system-prompt.ts` — pass the context id to `appendModulePromptSection` at both call sites.

**Deliberately deferred:** the acp predicate itself + its "coding configured" logic (2c-3c), any per-context enable _toggle UI_ (this slice is config/predicate-driven, not a user toggle), per-user (chatUserId) eligibility granularity (the predicate takes only `storageContextId`; finer granularity can be added later), and the leak removal (2c-4).

**Behavior invariant:** identical runtime behavior. No `TrustedModule` sets `isEligibleForContext`, so `moduleEligibilityRegistry.isEligible(moduleId, ctx)` returns `true` for every module (the default), and none of the three assembly points filter anything out. The full suite stays green; mechanisms proven with fixture modules.

**Guard note:** `src/ports/module-eligibility.ts` + `src/ports/module.ts` must stay feature-agnostic (guard scans `src/ports/**`). The assembly files under `src/tools/`/`src/plugins/` and `src/system-prompt.ts` are not guard-scanned.

---

## Reference: current assembly points (mirror the plugin eligibility pattern)

- Plugins re-check `getPluginContextEligibility(pluginId, auth.storageContextId)` per command invocation (`src/plugins/command-contributions.ts:20-27`) and filter prompt fragments/tools by `getPluginsForContext(sharedContextId)`. Module contributions currently do NONE of this — they are always active. This plan adds the module equivalent.
- `buildModuleToolSet(existingToolNames, runtime)` (`src/tools/module-tool-set.ts:26`) iterates `moduleToolRegistry.list()`; `runtime: ModuleToolRuntimeContext` has `storageContextId`.
- `registerModuleCommands(chat)` (`src/plugins/module-command-contributions.ts:20`) wraps each command in a `CommandHandler = async (message, reply, auth) => {...}`; `auth.storageContextId` is available.
- `buildModulePromptSection()` / `appendModulePromptSection(basePrompt)` (`src/plugins/module-prompt-contributions.ts:18,52`) take no context today; called at `src/system-prompt.ts:280` (`buildSystemPrompt`, has local `contextId` + `sharedContextId`) and `:294` (`buildProviderlessSystemPrompt`, has local `contextId`).

The predicate receives the raw thread-scoped `storageContextId`; a module derives the group/config context itself if it needs to (`getConfigContextIdFromStorageContextId`), exactly as the coding facades already do.

---

## Task 1: `moduleEligibilityRegistry` port

**Files:** Create `src/ports/module-eligibility.ts`; Test `tests/ports/module-eligibility.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/ports/module-eligibility.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createModuleEligibilityRegistry, moduleEligibilityRegistry } from '../../src/ports/module-eligibility.js'

describe('moduleEligibilityRegistry', () => {
  test('defaults to eligible for a module with no predicate', () => {
    const reg = createModuleEligibilityRegistry()
    expect(reg.isEligible('coding', 'ctx-1')).toBe(true)
  })

  test('consults the registered predicate', () => {
    const reg = createModuleEligibilityRegistry()
    reg.register('coding', (ctx) => ctx === 'ctx-ok')
    expect(reg.isEligible('coding', 'ctx-ok')).toBe(true)
    expect(reg.isEligible('coding', 'ctx-no')).toBe(false)
  })

  test('clear removes predicates (back to default-eligible)', () => {
    const reg = createModuleEligibilityRegistry()
    reg.register('coding', () => false)
    reg.clear()
    expect(reg.isEligible('coding', 'ctx-1')).toBe(true)
  })

  test('exposes a shared singleton', () => {
    expect(typeof moduleEligibilityRegistry.isEligible).toBe('function')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/ports/module-eligibility.test.ts`
Expected: FAIL — module cannot be resolved.

- [ ] **Step 3: Write the port**

Create `src/ports/module-eligibility.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Returns whether a module's contributions should surface in the given chat context. */
export type ModuleEligibilityPredicate = (storageContextId: string) => boolean

/**
 * Registry of module eligibility predicates, populated at the composition root from each module's
 * `isEligibleForContext`. Consulted by the module tool/command/prompt assembly. A module with no
 * registered predicate is eligible everywhere (the default), so this is a no-op until a module opts in.
 *
 * NOTE: keep this file feature-agnostic — the architecture guard scans `src/ports/**` for
 * feature/provider names. Do not reference concrete module or feature names here.
 */
export interface ModuleEligibilityRegistry {
  register(moduleId: string, predicate: ModuleEligibilityPredicate): void
  isEligible(moduleId: string, storageContextId: string): boolean
  clear(): void
}

/** Create an isolated registry (used by tests and, as a singleton, by the runtime). */
export function createModuleEligibilityRegistry(): ModuleEligibilityRegistry {
  const predicates = new Map<string, ModuleEligibilityPredicate>()
  return {
    register: (moduleId, predicate) => {
      predicates.set(moduleId, predicate)
    },
    isEligible: (moduleId, storageContextId) => {
      const predicate = predicates.get(moduleId)
      return predicate === undefined ? true : predicate(storageContextId)
    },
    clear: () => {
      predicates.clear()
    },
  }
}

/** Process-wide singleton: composition registers predicates here; the assembly consults it. */
export const moduleEligibilityRegistry: ModuleEligibilityRegistry = createModuleEligibilityRegistry()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/ports/module-eligibility.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ports/module-eligibility.ts tests/ports/module-eligibility.test.ts
git commit -m "feat(ports): add moduleEligibilityRegistry"
```

> Transient `knip` "unused" is expected until later tasks consume it — not a pre-commit gate.

---

## Task 2: `TrustedModule.isEligibleForContext` + register at load

**Files:** Modify `src/ports/module.ts`, `src/composition/load-trusted-modules.ts`; Test `tests/composition/load-trusted-modules.test.ts` (extend).

- [ ] **Step 1: Add the field to `TrustedModule`**

In `src/ports/module.ts`, add the import (near the other module-related type imports):

```ts
import type { ModuleEligibilityPredicate } from './module-eligibility.js'
```

Add to the `TrustedModule` interface (after `settingsSections?`):

```ts
  /** Per-context eligibility predicate; when present, this module's contributions surface only where it returns true. */
  readonly isEligibleForContext?: ModuleEligibilityPredicate
```

- [ ] **Step 2: Write the failing test (extend the loader suite)**

In `tests/composition/load-trusted-modules.test.ts`, add the import:

```ts
import { moduleEligibilityRegistry } from '../../src/ports/module-eligibility.js'
```

Add a test inside the `describe('loadTrustedModules', …)` block:

```ts
test("registers each module's eligibility predicate", async () => {
  moduleEligibilityRegistry.clear()
  const mod: TrustedModule = { id: 'fixture', isEligibleForContext: (ctx) => ctx === 'ok' }
  await loadTrustedModules([mod], () => {})
  expect(moduleEligibilityRegistry.isEligible('fixture', 'ok')).toBe(true)
  expect(moduleEligibilityRegistry.isEligible('fixture', 'no')).toBe(false)
  moduleEligibilityRegistry.clear()
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/composition/load-trusted-modules.test.ts`
Expected: FAIL — the loader does not yet register predicates.

- [ ] **Step 4: Register predicates in the loader**

In `src/composition/load-trusted-modules.ts`, add the import:

```ts
import { moduleEligibilityRegistry } from '../ports/module-eligibility.js'
```

Inside the existing contribution-registration loop (the `for (const mod of modules)` loop registering tools/commands/promptFragments/settingsSections), after the settingsSections registration, add:

```ts
if (mod.isEligibleForContext !== undefined) {
  moduleEligibilityRegistry.register(mod.id, mod.isEligibleForContext)
}
```

(Keep the pass ordering: migrations → contributions → onActivate.)

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/composition/load-trusted-modules.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ports/module.ts src/composition/load-trusted-modules.ts tests/composition/load-trusted-modules.test.ts
git commit -m "feat(modules): TrustedModule.isEligibleForContext + register at load"
```

---

## Task 3: Gate module tools by eligibility

**Files:** Modify `src/tools/module-tool-set.ts`; Test `tests/tools/module-tool-set.test.ts` (extend).

- [ ] **Step 1: Write the failing test (extend)**

In `tests/tools/module-tool-set.test.ts`, add the import:

```ts
import { moduleEligibilityRegistry } from '../../src/ports/module-eligibility.js'
```

In the existing `afterEach`, also clear eligibility (so predicates don't leak):

```ts
afterEach(() => {
  moduleToolRegistry.clear()
  moduleEligibilityRegistry.clear()
})
```

Add a test:

```ts
test('omits tools whose module is ineligible for the context', () => {
  moduleToolRegistry.register('coding', [echoTool('start_session')])
  moduleEligibilityRegistry.register('coding', (ctx) => ctx === 'ctx-ok')
  expect(
    'module_coding__start_session' in
      buildModuleToolSet(new Set<string>(), { storageContextId: 'ctx-no', chatUserId: 'u' }),
  ).toBe(false)
  expect(
    'module_coding__start_session' in
      buildModuleToolSet(new Set<string>(), { storageContextId: 'ctx-ok', chatUserId: 'u' }),
  ).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/tools/module-tool-set.test.ts`
Expected: FAIL — the `ctx-no` case still includes the tool (no eligibility gating yet).

- [ ] **Step 3: Add the eligibility check**

In `src/tools/module-tool-set.ts`, add the import:

```ts
import { moduleEligibilityRegistry } from '../ports/module-eligibility.js'
```

In `buildModuleToolSet`'s loop, immediately after computing `name` (or right at the top of the loop body, before the collision check), skip ineligible modules:

```ts
if (!moduleEligibilityRegistry.isEligible(moduleId, runtime.storageContextId)) continue
```

Place this BEFORE the `toolGateRegistry.setGate(...)` call so an omitted tool doesn't register a gate.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/tools/module-tool-set.test.ts`
Expected: PASS (existing tests + the new one).

- [ ] **Step 5: Commit**

```bash
git add src/tools/module-tool-set.ts tests/tools/module-tool-set.test.ts
git commit -m "feat(tools): gate module tools by per-context eligibility"
```

---

## Task 4: Gate module commands by eligibility

**Files:** Modify `src/plugins/module-command-contributions.ts`; Test `tests/plugins/module-command-contributions.test.ts` (extend).

- [ ] **Step 1: Write the failing test (extend)**

In `tests/plugins/module-command-contributions.test.ts`, add the import + clear eligibility in `afterEach`:

```ts
import { moduleEligibilityRegistry } from '../../src/ports/module-eligibility.js'
// afterEach: also moduleEligibilityRegistry.clear()
```

Add a test: register a command + an eligibility predicate that returns false for the invoking `auth.storageContextId`; invoke the registered handler; assert the command's `execute` did NOT run (its flag stays false) and a reply was sent. Then a second case where the predicate returns true → `execute` runs. Mirror the existing command test's chat-mock + `createAuth`/`createMockReply` harness (read the current test to reuse its fixtures; the `auth` object must carry the `storageContextId` the predicate checks).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/module-command-contributions.test.ts`
Expected: FAIL — the handler runs `execute` regardless of eligibility.

- [ ] **Step 3: Add the eligibility check to the handler**

In `src/plugins/module-command-contributions.ts`, add the import:

```ts
import { moduleEligibilityRegistry } from '../ports/module-eligibility.js'
```

Update the handler so it re-checks eligibility per invocation (mirroring `registerPluginCommands`), replying and returning when ineligible:

```ts
const handler: CommandHandler = async (message, reply, auth) => {
  if (!moduleEligibilityRegistry.isEligible(moduleId, auth.storageContextId)) {
    await reply.text('This command is not available in this context.')
    return
  }
  await Promise.resolve(command.execute(message, reply, auth))
}
```

Update the function's doc comment (it currently says "there is no per-context eligibility re-check — a trusted module is always active") to reflect that eligibility is now checked when a predicate is registered.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugins/module-command-contributions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/module-command-contributions.ts tests/plugins/module-command-contributions.test.ts
git commit -m "feat(plugins): gate module commands by per-context eligibility"
```

---

## Task 5: Gate module prompt fragments by eligibility

**Files:** Modify `src/plugins/module-prompt-contributions.ts`, `src/system-prompt.ts`; Test `tests/plugins/module-prompt-contributions.test.ts` (extend).

- [ ] **Step 1: Write the failing test (extend)**

In `tests/plugins/module-prompt-contributions.test.ts`, add the import + clear eligibility in `afterEach`. Note the signatures now take a `storageContextId` — update existing calls (`buildModulePromptSection()` → `buildModulePromptSection('ctx')`, `appendModulePromptSection('BASE')` → `appendModulePromptSection('BASE', 'ctx')`). Add a test:

```ts
test('omits fragments whose module is ineligible for the context', () => {
  modulePromptFragmentRegistry.register('coding', [{ name: 'acp-hint', content: 'use acp' }])
  moduleEligibilityRegistry.register('coding', (ctx) => ctx === 'ctx-ok')
  expect(buildModulePromptSection('ctx-no')).toBe('')
  expect(buildModulePromptSection('ctx-ok')).toContain('use acp')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/module-prompt-contributions.test.ts`
Expected: FAIL — signatures don't take a context id / no eligibility filtering.

- [ ] **Step 3: Add the context param + eligibility filter**

In `src/plugins/module-prompt-contributions.ts`, add the import:

```ts
import { moduleEligibilityRegistry } from '../ports/module-eligibility.js'
```

Change `buildModulePromptSection()` → `buildModulePromptSection(storageContextId: string)`, and in its loop, after destructuring `{ moduleId, fragment }`, skip ineligible modules:

```ts
if (!moduleEligibilityRegistry.isEligible(moduleId, storageContextId)) continue
```

Change `appendModulePromptSection(basePrompt)` → `appendModulePromptSection(basePrompt: string, storageContextId: string)`, and call `buildModulePromptSection(storageContextId)`.

- [ ] **Step 4: Update the `src/system-prompt.ts` call sites**

In `buildSystemPrompt` (~line 280): `return appendModulePromptSection(appendPluginPromptSection(withAddendum, sharedContextId), contextId)`.

In `buildProviderlessSystemPrompt` (~line 294): `return appendModulePromptSection(appendProviderlessPluginPromptSection(basePrompt, sharedContextId), contextId)`.

(Both functions have a local `contextId` — the raw storage context id — which the predicate expects.)

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/plugins/module-prompt-contributions.test.ts tests/system-prompt.test.ts`
Expected: PASS (the extended prompt tests + the system-prompt suite; the latter is behavior-preserving since no module registers a predicate).

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: clean (the `appendModulePromptSection` signature change is reflected at both call sites).

- [ ] **Step 7: Commit**

```bash
git add src/plugins/module-prompt-contributions.ts src/system-prompt.ts tests/plugins/module-prompt-contributions.test.ts
git commit -m "feat(plugins): gate module prompt fragments by per-context eligibility"
```

---

## Task 6: Full verification

- [ ] **Step 1: Build client bundles + full suite**

```bash
bun build:client
```

Run: `bun test`
Expected: PASS with the new tests (Task 1: +4, Task 2: +1, Task 3: +1, Task 4: +~2, Task 5: +1). No production behavior change: no module declares `isEligibleForContext`, so every module is eligible everywhere and none of the three assembly points filter anything.

- [ ] **Step 2: Full check pipeline**

Run: `bun check:full`
Expected: all green. Fix formatting with `bun run format` and re-run if needed.

- [ ] **Step 3: Confirm the production no-op**

Run: `rg -n "isEligibleForContext" src/modules/coding/module.ts`
Expected: no output — `codingModule` declares no predicate yet, so `moduleEligibilityRegistry` is empty and every module tool/command/prompt is eligible in every context (the acp predicate lands in 2c-3c). The mechanism is present and unit-tested with fixtures, but dormant.

---

## Done criteria

- A `TrustedModule` can declare `isEligibleForContext`; `loadTrustedModules` registers it; `buildModuleToolSet` omits ineligible modules' tools, `registerModuleCommands`' handler skips (with a reply) ineligible invocations, and `buildModulePromptSection` omits ineligible modules' fragments — all keyed by the runtime `storageContextId`.
- `src/ports/module-eligibility.ts` + `src/ports/module.ts` are feature-agnostic (architecture guard green).
- `bun test` + `bun check:full` green; production behavior unchanged (no module declares a predicate; all eligible everywhere).
- The next plan (2c-3c) migrates acp into `src/modules/coding/` — declaring both the `'acp'` magi settings section (rendered by 2c-3a-2) and an `isEligibleForContext` predicate (so acp only surfaces where coding is configured) — after which 2c-4 removes the `codingSecrets`/`codingRepos` facades and the `coding.secrets` permission.
