<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plugins Deployment Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `src/`→`plugins/` static-import leak that made a missing `plugins/` directory crash the bot the moment `DEBUG_SERVER=true` is set, and prevent the same class of misbuilt image from reaching production again.

**Architecture:** Three independent PRs. PR 1 makes the missing-directory case observable at startup instead of during a lazy `import()`. PR 2 introduces a plugin-contributed `provision` hook on the task-provider registry and rewires the settings HTTP route to dispatch through it, so `src/debug/settings/provision-routes.ts` no longer reaches across the `src/`↔`plugins/` boundary. PR 3 adds a CI step that starts the freshly built Docker image and asserts it stays up, so a missing `COPY plugins ./plugins` (or any other boot-time crash) blocks the build.

**Tech Stack:** Bun, TypeScript (strict, `.js` import paths), Zod v4, Drizzle + `bun:sqlite`, `bun:test`. TDD per task. TDD hooks fire automatically on `src/` and `client/` writes.

**Prerequisite:** The Dockerfile `COPY plugins ./plugins` fix (the "must-do" fix) is already applied. This plan assumes that step is in place.

---

## File structure

```
src/plugins/
  discovery.ts                              [PR 1, Task 1] MODIFY  (add directoryMissing field)
  discovery.test.ts                         [PR 1, Task 1] MODIFY  (add test for new field)
  index.ts                                  [PR 1, Task 2] MODIFY  (startup guard)
  index.test.ts                             [PR 1, Task 2] NEW     (guard unit test)

src/providers/
  registry.ts                               [PR 2, Task 1] MODIFY  (TaskProviderProvision types + lookup)
  registry.test.ts                          [PR 2, Task 2] NEW     (lookup helper tests)
  provision.ts                              [PR 2, Task 3] NEW     (TaskProviderProvisionOutcome re-export + dispatch helper)

src/plugins/
  runtime-types.ts                          [PR 2, Task 4] MODIFY  (PluginContributions.provision)
  context.ts                                [PR 2, Task 5] MODIFY  (registerTaskProviderType captures provision)
  loader.ts                                 [PR 2, Task 6] MODIFY  (commitTaskProviderRegistration forwards provision)

src/debug/settings/
  provision-routes.ts                       [PR 2, Task 7] REWRITE (use registry lookup)

plugins/task-provider-kaneo/
  auto-provision.ts                         [PR 2, Task 8] MODIFY  (export kaneoProvision)
  index.ts                                  [PR 2, Task 9] MODIFY  (register kaneoProvision)

tests/
  providers/registry-provision.test.ts     [PR 2, Task 2] NEW
  plugins/task-provider-kaneo/
    auto-provision.test.ts                  [PR 2, Task 10] NEW
  debug/settings/
    provision-routes.test.ts                [PR 2, Task 11] MODIFY (use mock registry hook)
  plugins/task-provider-kaneo/
    provision.test.ts                       [PR 2, Task 12] MODIFY (assert kaneoProvision wraps provisionAndConfigure)

.github/workflows/
  ci.yml                                    [PR 3, Task 1] MODIFY  (add docker smoke test)
  ci-smoke-test.sh                          [PR 3, Task 1] NEW     (helper script)
```

---

## Conventions for every task

- All new files start with the BUSL license header (HTML-comment form for `.md`, `//` form for `.ts`).
- Never add `eslint-disable`, `oxlint-disable`, `@ts-ignore`, `@ts-nocheck` — hook policy blocks them.
- After each task: `bun test <targeted-path>` and `bun typecheck` must pass before committing.
- Commit messages use Conventional Commits (`fix:`, `refactor:`, `test:`, `chore:`).
- Mocked modules: use DI where the source already exposes a `Deps` interface; use `mock.module()` only for boundary modules that are not DI-friendly, and prefer the existing delayed-import pattern in the file you're touching.
- Test helpers: use `mockLogger()`, `setupTestDb()`, `seedTestPlatformInstance()`, `seedTestTaskInstance()`, `setMockFetch()`/`restoreFetch()` from `tests/utils/test-helpers.ts`.

---

# PR 1 — Defensive startup guard

Branch: `fix/plugins-deployment-safety-startup-guard`

Goal: make the "plugins directory is missing" case observable at `process.exit` time, with a clear error message, instead of a stack trace from a deep dynamic `import()` 50ms after version announcement.

---

### Task 1: Surface "directory missing" in `DiscoveryResult`

**Files:**

- Modify: `src/plugins/discovery.ts:26-29` (add field to `DiscoveryResult` type)
- Modify: `src/plugins/discovery.ts:222-228` (populate the field)
- Modify: `tests/plugins/discovery.test.ts:64-71` (add test)

- [ ] **Step 1: Add the failing test**

Add this test inside the existing `describe('discoverPlugins', ...)` block in `tests/plugins/discovery.test.ts`, after the "returns no plugins and no errors when plugins directory is missing" test:

```typescript
test('reports directoryMissing=true when the plugins directory is absent', () => {
  const missingDir = join(makeTempDir(), 'does-not-exist')
  const result = discoverPlugins(missingDir)
  expect(result.directoryMissing).toBe(true)
})

test('reports directoryMissing=false when the plugins directory exists but is empty', () => {
  const emptyDir = makeTempDir()
  const result = discoverPlugins(emptyDir)
  expect(result.directoryMissing).toBe(false)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/plugins/discovery.test.ts -t "directoryMissing"`
Expected: FAIL with `result.directoryMissing is undefined` (TypeError when comparing).

- [ ] **Step 3: Add the `directoryMissing` field to `DiscoveryResult`**

In `src/plugins/discovery.ts`, replace the `DiscoveryResult` type (currently lines 26–29):

```typescript
export type DiscoveryResult = {
  plugins: DiscoveredPlugin[]
  errors: DiscoveryError[]
  /**
   * True when the configured plugins directory did not exist on disk at the
   * time of discovery. Indicates a deployment misconfiguration (e.g. the
   * Docker image was built without `COPY plugins ./plugins`).
   */
  directoryMissing: boolean
}
```

- [ ] **Step 4: Populate the field in both `discoverPlugins` return paths**

In `src/plugins/discovery.ts`, update the two `return` statements inside `discoverPlugins`:

- The "directory does not exist" branch (around line 225–228) should return `{ plugins: [], errors: [], directoryMissing: true }`.
- The "read failed" branch (around line 233–239) should return `{ plugins: [], errors: [], directoryMissing: false }`.
- The final return at the bottom of the function (line 267) should return `{ plugins, errors, directoryMissing: false }`.

- [ ] **Step 5: Run the discovery tests to verify they pass**

Run: `bun test tests/plugins/discovery.test.ts`
Expected: PASS, including the two new tests and the existing "returns no plugins and no errors when plugins directory is missing" test (the new field is additive and the existing assertion `expect(result.plugins).toEqual([])` etc. still holds).

- [ ] **Step 6: Typecheck**

Run: `bun typecheck`
Expected: PASS. The field is additive, so no other call sites need changes.

- [ ] **Step 7: Commit**

```bash
git add src/plugins/discovery.ts tests/plugins/discovery.test.ts
git commit -m "feat(plugins): surface directoryMissing in DiscoveryResult"
```

---

### Task 2: Fail fast at startup when `DEBUG_SERVER=true` and plugins are missing

**Files:**

- Modify: `src/index.ts:118-140` (insert guard after `discoverPlugins` call)
- Create: `src/plugins/startup-guard.ts` (pure, testable guard function)
- Create: `tests/plugins/startup-guard.test.ts`

- [ ] **Step 1: Write the failing test for the guard**

Create `tests/plugins/startup-guard.test.ts` with the BUSL header and:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { evaluateStartupGuard } from '../../src/plugins/startup-guard.js'

describe('evaluateStartupGuard', () => {
  test('recommends exit when plugins directory is missing and DEBUG_SERVER=true', () => {
    const decision = evaluateStartupGuard({ directoryMissing: true, debugServerEnabled: true })
    expect(decision.action).toBe('exit')
    expect(decision.reason).toContain('DEBUG_SERVER=true')
  })

  test('recommends warn-and-continue when plugins directory is missing and DEBUG_SERVER=false', () => {
    const decision = evaluateStartupGuard({ directoryMissing: true, debugServerEnabled: false })
    expect(decision.action).toBe('warn')
  })

  test('recommends ok when plugins directory is present', () => {
    const decision = evaluateStartupGuard({ directoryMissing: false, debugServerEnabled: true })
    expect(decision.action).toBe('ok')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/plugins/startup-guard.test.ts`
Expected: FAIL with module resolution error for `startup-guard.js`.

- [ ] **Step 3: Implement the guard**

Create `src/plugins/startup-guard.ts` with the BUSL header and:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type StartupGuardInput = Readonly<{
  directoryMissing: boolean
  debugServerEnabled: boolean
}>

export type StartupGuardDecision = Readonly<
  { action: 'ok' } | { action: 'warn'; reason: string } | { action: 'exit'; reason: string }
>

export function evaluateStartupGuard(input: StartupGuardInput): StartupGuardDecision {
  if (!input.directoryMissing) return { action: 'ok' }
  if (input.debugServerEnabled) {
    return {
      action: 'exit',
      reason:
        'Plugins directory is missing but DEBUG_SERVER=true. The settings web UI cannot dispatch task-provider provisioning without it. Rebuild the Docker image with `COPY plugins ./plugins` or mount the plugins tree into the container.',
    }
  }
  return {
    action: 'warn',
    reason:
      'Plugins directory is missing. The bot will start in degraded mode; task-provider plugins (Kaneo, YouTrack) are unavailable.',
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/plugins/startup-guard.test.ts`
Expected: PASS for all three cases.

- [ ] **Step 5: Wire the guard into `src/index.ts`**

In `src/index.ts`, locate the plugin discovery block (around line 118–140):

```typescript
const pluginDir = 'plugins'
const { plugins: discoveredPlugins, errors: pluginErrors } = discoverPlugins(pluginDir)
```

After the `discoverPlugins` call, add (before the existing `if (pluginErrors.length > 0) { ... }` block):

```typescript
import { evaluateStartupGuard } from './plugins/startup-guard.js'
// ... (top-of-file import — add alongside the existing src/plugins/* imports)

const guardDecision = evaluateStartupGuard({
  directoryMissing: discoveredPlugins.length === 0 && pluginErrors.length === 0 && !existsSync(pluginDir),
  debugServerEnabled: process.env['DEBUG_SERVER'] === 'true',
})
```

Note: do not pass `discoveredResult.directoryMissing` directly here — `discoverPlugins` already returns it. Use:

```typescript
const { plugins: discoveredPlugins, errors: pluginErrors, directoryMissing } = discoverPlugins(pluginDir)
const guardDecision = evaluateStartupGuard({
  directoryMissing,
  debugServerEnabled: process.env['DEBUG_SERVER'] === 'true',
})
if (guardDecision.action === 'exit') {
  log.fatal({ reason: guardDecision.reason }, 'Refusing to start: misconfigured deployment')
  process.exit(1)
}
if (guardDecision.action === 'warn') {
  log.warn({ reason: guardDecision.reason }, 'Starting in degraded mode')
}
```

Add the import for `existsSync` from `node:fs` at the top of the file. (Only if not already imported — check before adding.)

- [ ] **Step 6: Typecheck and run targeted tests**

Run: `bun typecheck && bun test tests/plugins/startup-guard.test.ts tests/plugins/discovery.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/plugins/startup-guard.ts src/plugins/startup-guard.test.ts src/index.ts tests/plugins/startup-guard.test.ts
git commit -m "fix(plugins): fail fast at startup when DEBUG_SERVER=true and plugins/ is missing"
```

---

# PR 2 — Architectural cleanup: provision via plugin registry

Branch: `refactor/provision-via-plugin-registry`

Goal: remove the only remaining `src/`-side static `import` from the `plugins/` tree. The settings HTTP route will look up the provider's `provision` hook from the registry (the same way `autoProvision` is resolved today in `src/providers/auto-provision.ts:23-24`). Only the Kaneo plugin will register a provision hook; YouTrack will not, and the route will return 422 for that case.

---

### Task 1: Add `TaskProviderProvision` types to the provider registry

**Files:**

- Modify: `src/providers/registry.ts:17-24` (add new types after `TaskProviderAutoProvision`)

- [ ] **Step 1: Add the new types**

In `src/providers/registry.ts`, after the existing `TaskProviderAutoProvision` type (lines 17–24), add:

```typescript
export type TaskProviderProvisionContext = Readonly<{
  contextId: string
  username: string | null
  publicUrl: string | undefined
  internalUrl: string | undefined
}>

export type TaskProviderProvisionOutcome =
  | {
      status: 'provisioned'
      email: string
      password: string
      kaneoUrl: string
      apiKey: string
      workspaceId: string
    }
  | { status: 'registration_disabled' }
  | { status: 'failed'; error: string }

export type TaskProviderProvision = (context: TaskProviderProvisionContext) => Promise<TaskProviderProvisionOutcome>
```

- [ ] **Step 2: Add `provision` to `ContributedTaskProviderEntry`**

In the `ContributedTaskProviderEntry` type (lines 41–51), add a new field after `autoProvision`:

```typescript
export type ContributedTaskProviderEntry = {
  pluginId: string
  factory: TaskProviderFactory
  autoProvision?: TaskProviderAutoProvision
  provision?: TaskProviderProvision
  capabilities: ReadonlySet<TaskCapability>
  displayName: string
  validateConfig?: TaskProviderConfigValidator
  instanceConfigSchema?: readonly ProviderConfigField[]
  contextConfigSchema?: readonly ProviderConfigField[]
  traits?: ReadonlySet<TaskProviderTrait>
}
```

- [ ] **Step 3: Add `provision` to `TaskProviderTypeDescriptor`**

In the `TaskProviderTypeDescriptor` type (lines 172–181), add a new field after `autoProvision`:

```typescript
export type TaskProviderTypeDescriptor = {
  type: string
  displayName: string
  source: 'builtin' | { plugin: string }
  autoProvision?: TaskProviderAutoProvision
  provision?: TaskProviderProvision
  instanceConfigSchema: readonly ProviderConfigField[]
  contextConfigSchema: readonly ProviderConfigField[]
  capabilities: ReadonlySet<TaskCapability>
  traits: ReadonlySet<TaskProviderTrait>
}
```

- [ ] **Step 4: Add `provision` to the contributed-entry mapping**

In `listTaskProviderTypes` (lines 218–233), add `provision: entry.provision` to the returned object:

```typescript
const contributed: TaskProviderTypeDescriptor[] = [...pluginContributedTaskProviderFactories.entries()].map(
  ([type, entry]) => {
    const instanceConfigSchema = contributedInstanceFields(entry)
    const contextConfigSchema = contributedContextFields(entry)
    return {
      type,
      displayName: entry.displayName,
      source: { plugin: entry.pluginId },
      autoProvision: entry.autoProvision,
      provision: entry.provision,
      instanceConfigSchema,
      contextConfigSchema,
      capabilities: entry.capabilities,
      traits: contributedTraits(entry),
    }
  },
)
```

- [ ] **Step 5: Add the `getTaskProviderProvision` lookup function**

After `getTaskProviderConfigValidator` (lines 165–170), add:

```typescript
/** Resolve the optional HTTP provision hook for a task-provider type. */
export function getTaskProviderProvision(type: string): TaskProviderProvision | undefined {
  const descriptor = getTaskProviderDescriptor(type)
  if (descriptor === undefined) return undefined
  return descriptor.provision
}
```

- [ ] **Step 6: Typecheck**

Run: `bun typecheck`
Expected: PASS. The new fields are optional, so existing call sites are unaffected.

- [ ] **Step 7: Commit**

```bash
git add src/providers/registry.ts
git commit -m "refactor(providers): add TaskProviderProvision hook to plugin-contributed registry"
```

---

### Task 2: Add tests for the new registry lookup

**Files:**

- Create: `tests/providers/registry-provision.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/providers/registry-provision.test.ts` with the BUSL header and:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import {
  getTaskProviderProvision,
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
  type TaskProviderProvision,
} from '../../src/providers/registry.js'

// `unregisterContributedTaskProviderType` removes all types owned by a given
// `pluginId` (despite the function name), so we use unique plugin IDs to
// keep these fixtures scoped to this suite and avoid cross-test pollution.
const KANEO_PLUGIN_ID = 'test-kaneo-plugin'
const YOUTRACK_PLUGIN_ID = 'test-youtrack-plugin'

const PROVISION: TaskProviderProvision = () => Promise.resolve({ status: 'failed', error: 'test' })

afterEach(() => {
  unregisterContributedTaskProviderType(KANEO_PLUGIN_ID)
  unregisterContributedTaskProviderType(YOUTRACK_PLUGIN_ID)
})

describe('getTaskProviderProvision', () => {
  test('returns the registered provision hook for a known type', () => {
    registerContributedTaskProviderType('test-kaneo', {
      pluginId: KANEO_PLUGIN_ID,
      factory: () => ({ name: 'test-kaneo' }) as never,
      provision: PROVISION,
      capabilities: new Set(),
      displayName: 'Test Kaneo',
    })

    const hook = getTaskProviderProvision('test-kaneo')
    expect(hook).toBe(PROVISION)
  })

  test('returns undefined for an unknown type', () => {
    expect(getTaskProviderProvision('does-not-exist')).toBeUndefined()
  })

  test('returns undefined when the descriptor has no provision hook', () => {
    registerContributedTaskProviderType('test-youtrack', {
      pluginId: YOUTRACK_PLUGIN_ID,
      factory: () => ({ name: 'test-youtrack' }) as never,
      capabilities: new Set(),
      displayName: 'Test YouTrack',
    })

    expect(getTaskProviderProvision('test-youtrack')).toBeUndefined()
  })
})
```

Note: `registerContributedTaskProviderType` writes to an in-memory Map (`pluginContributedTaskProviderFactories` in `src/providers/registry.ts:53`) and does not touch SQLite, so no `setupTestDb()` is required. The test follows the cleanup-by-pluginId pattern used by `tests/providers/resolver.test.ts:106,110-111`.

- [ ] **Step 2: Run the test to verify it passes**

Run: `bun test tests/providers/registry-provision.test.ts`
Expected: PASS for all three cases (the new types and lookup were added in Task 1).

- [ ] **Step 3: Typecheck**

Run: `bun typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/providers/registry-provision.test.ts
git commit -m "test(providers): cover getTaskProviderProvision lookup"
```

---

### Task 3: Wire `provision` through the plugin contribution pipeline

**Files:**

- Modify: `src/plugins/runtime-types.ts:80-90` (add `provision` to `PluginContributions.taskProviderRegistration`)
- Modify: `src/plugins/context.ts:39-44` (add to `TaskProviderRegistrationInput` type)
- Modify: `src/plugins/context.ts:132-164` (capture `provision` in `buildRegisterTaskProviderType`)
- Modify: `src/plugins/loader.ts:46-77` (forward `provision` in `commitTaskProviderRegistration`)

- [ ] **Step 1: Extend `PluginContributions.taskProviderRegistration`**

In `src/plugins/runtime-types.ts`, add `TaskProviderProvision` to the imports at the top:

```typescript
import type {
  TaskProviderAutoProvision,
  TaskProviderConfigValidator,
  TaskProviderFactory,
  TaskProviderProvision,
} from '../providers/registry.js'
```

Add a new field to the `taskProviderRegistration` shape:

```typescript
taskProviderRegistration?: {
  type: string
  factory: TaskProviderFactory
  autoProvision?: TaskProviderAutoProvision
  provision?: TaskProviderProvision
  validateConfig?: TaskProviderConfigValidator
  capabilities: ReadonlySet<TaskCapability>
  displayName: string
  instanceConfigSchema: readonly ProviderConfigField[]
  contextConfigSchema: readonly ProviderConfigField[]
  traits: ReadonlySet<TaskProviderTrait>
}
```

- [ ] **Step 2: Extend the `TaskProviderRegistrationInput` type in `context.ts`**

In `src/plugins/context.ts:39-44`, add `TaskProviderProvision` to the import (line 7) and extend the type:

```typescript
import type { TaskProviderAutoProvision, TaskProviderFactory, TaskProviderProvision } from '../providers/registry.js'
```

```typescript
type TaskProviderRegistrationInput =
  | TaskProviderFactory
  | {
      factory: TaskProviderFactory
      autoProvision?: TaskProviderAutoProvision
      provision?: TaskProviderProvision
    }
```

- [ ] **Step 3: Capture `provision` in `buildRegisterTaskProviderType`**

In `src/plugins/context.ts:132-164`, after the line that captures `autoProvision`, add:

```typescript
collected.taskProviderRegistration = {
  type,
  factory: registration.factory,
  autoProvision: registration.autoProvision,
  provision: registration.provision,
  capabilities: new Set(manifest.providerCapabilities),
  displayName: manifest.name,
  instanceConfigSchema: manifest.providerConfigSchema.map((field) => toProviderConfigField(field, 'instance')),
  contextConfigSchema: (manifest.providerContextConfigSchema ?? []).map((field) =>
    toProviderConfigField(field, 'context'),
  ),
  traits: new Set(manifest.providerTraits),
}
```

- [ ] **Step 4: Forward `provision` in `commitTaskProviderRegistration`**

In `src/plugins/loader.ts:46-77`, in the call to `registerContributedTaskProviderType`, add a new field:

```typescript
registerContributedTaskProviderType(type, {
  pluginId: manifest.id,
  factory: entry.factory,
  autoProvision: entry.autoProvision,
  provision: entry.provision,
  validateConfig,
  capabilities: entry.capabilities,
  displayName: entry.displayName,
  instanceConfigSchema: entry.instanceConfigSchema,
  contextConfigSchema: entry.contextConfigSchema,
  traits: entry.traits,
})
```

- [ ] **Step 5: Typecheck**

Run: `bun typecheck`
Expected: PASS. All new fields are optional and additive.

- [ ] **Step 6: Run the targeted plugin tests**

Run: `bun test tests/plugins/loader.test.ts tests/plugins/context.test.ts tests/plugins/registry.test.ts`
Expected: PASS. The shape changes are additive; existing tests do not depend on the new fields.

- [ ] **Step 7: Commit**

```bash
git add src/plugins/runtime-types.ts src/plugins/context.ts src/plugins/loader.ts
git commit -m "refactor(plugins): thread TaskProviderProvision through registration pipeline"
```

---

### Task 4: Add `kaneoProvision` export to the Kaneo plugin

**Files:**

- Modify: `plugins/task-provider-kaneo/auto-provision.ts:6-10` (add new export)

- [ ] **Step 1: Extend the auto-provision module with `kaneoProvision`**

Replace the contents of `plugins/task-provider-kaneo/auto-provision.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TaskProviderAutoProvision, TaskProviderProvision } from '../../src/providers/registry.js'
import { maybeProvisionKaneo, provisionAndConfigure } from './provision.js'

export const kaneoAutoProvision: TaskProviderAutoProvision = ({ reply, contextId, username }) =>
  maybeProvisionKaneo(reply, contextId, username)

export const kaneoProvision: TaskProviderProvision = ({ contextId, username, publicUrl, internalUrl }) =>
  provisionAndConfigure(contextId, username, { publicUrl, internalUrl })
```

- [ ] **Step 2: Typecheck**

Run: `bun typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add plugins/task-provider-kaneo/auto-provision.ts
git commit -m "feat(kaneo): export kaneoProvision hook for HTTP route dispatch"
```

---

### Task 5: Wire `kaneoProvision` registration in the plugin entry point

**Files:**

- Modify: `plugins/task-provider-kaneo/index.ts:7-72` (add provision to registration)

- [ ] **Step 1: Extend the `KaneoProvisionModule` type and `isKaneoProvisionModule` guard**

In `plugins/task-provider-kaneo/index.ts`, update the `KaneoProvisionModule` type (lines 33–35) to include the new function:

```typescript
type TaskProviderProvisionLike = (context: {
  contextId: string
  username: string | null
  publicUrl: string | undefined
  internalUrl: string | undefined
}) => Promise<
  | { status: 'provisioned'; email: string; password: string; kaneoUrl: string; apiKey: string; workspaceId: string }
  | { status: 'registration_disabled' }
  | { status: 'failed'; error: string }
>

type KaneoProvisionModule = {
  kaneoAutoProvision: TaskProviderAutoProvisionLike
  kaneoProvision: TaskProviderProvisionLike
}
```

Update the `isKaneoProvisionModule` guard (lines 49–51):

```typescript
function isKaneoProvisionModule(value: unknown): value is KaneoProvisionModule {
  return (
    isRecord(value) &&
    typeof value['kaneoAutoProvision'] === 'function' &&
    typeof value['kaneoProvision'] === 'function'
  )
}
```

- [ ] **Step 2: Register `kaneoProvision` in the factory's `activate`**

Update the factory's `activate` body (lines 65–72):

```typescript
activate(ctx: PluginContextLike): void {
  // KNOWN GAP (#15): provider clients still use global fetch instead of ctx.providerRuntime.
  // Provider runtime enforcement needs factory/client plumbing plus dynamic-host admission.
  const provisionModule = getKaneoProvisionModule()
  ctx.registration.registerTaskProviderType('kaneo', {
    factory: (config): TaskProviderLike => createKaneoProvider(config),
    autoProvision: provisionModule.kaneoAutoProvision,
    provision: provisionModule.kaneoProvision,
  })
},
```

- [ ] **Step 3: Typecheck**

Run: `bun typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add plugins/task-provider-kaneo/index.ts
git commit -m "feat(kaneo): register kaneoProvision hook via plugin registry"
```

---

### Task 6: Refactor `src/debug/settings/provision-routes.ts` to dispatch via the registry

**Files:**

- Modify: `src/debug/settings/provision-routes.ts` (full rewrite)

- [ ] **Step 1: Write the failing test for the new dispatch path**

Open `tests/debug/settings/provision-routes.test.ts` and replace the file (preserve the BUSL header) with the version below. This new test file uses a mock `provision` hook registered via `registerContributedTaskProviderType` so the route is exercised end-to-end without touching real network code.

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { setContextSettings } from '../../../src/instances/context-store.js'
import { insertTaskInstance } from '../../../src/instances/task-store.js'
import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
  type TaskProviderProvision,
  type TaskProviderProvisionContext,
} from '../../../src/providers/registry.js'
import { handleProvisionKaneo } from '../../../src/debug/settings/provision-routes.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

describe('settings kaneo provision route', () => {
  let session: SettingsSession
  let provisionCalls: TaskProviderProvisionContext[]
  const provision: TaskProviderProvision = (ctx) => {
    provisionCalls.push(ctx)
    return Promise.resolve({ status: 'failed', error: 'Kaneo task instance public URL is missing' })
  }
  const originalUrl = process.env['KANEO_CLIENT_URL']

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    insertTaskInstance({ id: 'ti-kaneo', type: 'kaneo', config: {}, status: 'active' })
    setContextSettings({ contextId: 'u-1', taskInstanceId: 'ti-kaneo', platformInstanceId: 'pi-1' })
    provisionCalls = []
    registerContributedTaskProviderType('kaneo', {
      pluginId: 'task-provider-kaneo',
      factory: () => ({ name: 'kaneo' }) as never,
      provision,
      capabilities: new Set(),
      displayName: 'Kaneo',
    })
    session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
    delete process.env['KANEO_CLIENT_URL']
  })

  afterEach(() => {
    process.env['KANEO_CLIENT_URL'] = originalUrl
    unregisterContributedTaskProviderType('task-provider-kaneo')
  })

  test('non-POST returns 405', async () => {
    const res = await handleProvisionKaneo(new Request('https://x/settings/api/provision/kaneo', { method: 'GET' }))
    expect(res.status).toBe(405)
  })

  test('POST without CSRF is 403', async () => {
    const res = await handleProvisionKaneo(
      new Request('https://x/settings/api/provision/kaneo', {
        method: 'POST',
        headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(403)
  })

  test('dispatches to the registry provision hook for the assigned task instance type', async () => {
    const res = await handleProvisionKaneo(
      new Request('https://x/settings/api/provision/kaneo', {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(422)
    expect(provisionCalls).toHaveLength(1)
    expect(provisionCalls[0]!.contextId).toBe('u-1')
    expect(provisionCalls[0]!.publicUrl).toBeUndefined()
    expect(provisionCalls[0]!.internalUrl).toBeUndefined()
  })

  test('returns 422 with unsupported when the task instance type has no provision hook', async () => {
    unregisterContributedTaskProviderType('task-provider-kaneo')
    insertTaskInstance({ id: 'ti-yt', type: 'youtrack', config: {}, status: 'active' })
    setContextSettings({ contextId: 'u-1', taskInstanceId: 'ti-yt', platformInstanceId: 'pi-1' })

    const res = await handleProvisionKaneo(
      new Request('https://x/settings/api/provision/kaneo', {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(422)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('unsupported')
  })

  test('returns 200 with credentials when the provision hook reports provisioned', async () => {
    const successHook: TaskProviderProvision = () =>
      Promise.resolve({
        status: 'provisioned',
        email: 'u@example.com',
        password: 'pw',
        kaneoUrl: 'https://k.example.com',
        apiKey: 'k',
        workspaceId: 'ws',
      })
    unregisterContributedTaskProviderType('task-provider-kaneo')
    registerContributedTaskProviderType('kaneo', {
      pluginId: 'task-provider-kaneo',
      factory: () => ({ name: 'kaneo' }) as never,
      provision: successHook,
      capabilities: new Set(),
      displayName: 'Kaneo',
    })

    const res = await handleProvisionKaneo(
      new Request('https://x/settings/api/provision/kaneo', {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; email: string }
    expect(body.status).toBe('provisioned')
    expect(body.email).toBe('u@example.com')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/debug/settings/provision-routes.test.ts`
Expected: FAIL — the route still imports `provisionAndConfigure` directly from `plugins/`, and the test expectations about the new dispatch flow do not match the current implementation.

- [ ] **Step 3: Rewrite the route**

Replace the contents of `src/debug/settings/provision-routes.ts` (preserve the BUSL header):

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { getContextSettings } from '../../instances/context-store.js'
import { getTaskInstance } from '../../instances/task-store.js'
import { logger } from '../../logger.js'
import { getTaskProviderProvision, type TaskProviderProvisionOutcome } from '../../providers/registry.js'
import { listUsers } from '../../users.js'
import { authenticate, parseJsonBody, requireCsrf, resolveContextScope, settingsJson } from './respond.js'
import type { ContextScope } from './respond.js'

const log = logger.child({ scope: 'debug-server:settings-provision' })
const BodySchema = z.object({ contextId: z.string().optional() })

function resolveProvisionUsername(
  scope: ContextScope,
  platformInstanceId: string,
  platformUserId: string,
): string | null {
  if (scope.kind === 'group') return null
  return listUsers(platformInstanceId).find((u) => u.platform_user_id === platformUserId)?.username ?? null
}

function outcomeToResponse(scope: ContextScope, outcome: TaskProviderProvisionOutcome): Response {
  if (outcome.status === 'provisioned') {
    log.info({ contextId: scope.contextId, status: 'provisioned' }, 'Settings provider provision succeeded')
    return settingsJson(200, {
      status: 'provisioned',
      contextId: scope.contextId,
      email: outcome.email,
      password: outcome.password,
      kaneoUrl: outcome.kaneoUrl,
      workspaceId: outcome.workspaceId,
    })
  }
  if (outcome.status === 'registration_disabled') {
    return settingsJson(422, { status: 'registration_disabled', error: 'Provider registration is disabled' })
  }
  log.warn({ contextId: scope.contextId, status: 'failed', error: outcome.error }, 'Settings provider provision failed')
  return settingsJson(422, { status: 'failed', error: outcome.error })
}

export async function handleProvisionKaneo(req: Request): Promise<Response> {
  if (req.method !== 'POST') return settingsJson(405, { error: 'method not allowed' })
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return csrf

  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = BodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const { principal } = auth.authed
  const scope = resolveContextScope(principal, 'write', body.data.contextId)
  if (!scope.ok) return scope.response

  const settings = getContextSettings(scope.scope.contextId)
  if (settings === null) {
    return settingsJson(422, { status: 'failed', error: 'Context has no settings' })
  }
  const taskInstance = getTaskInstance(settings.taskInstanceId)
  if (taskInstance === null || taskInstance.status !== 'active') {
    return settingsJson(422, { status: 'failed', error: 'No active task instance assigned' })
  }
  const provision = getTaskProviderProvision(taskInstance.type)
  if (provision === undefined) {
    return settingsJson(422, {
      status: 'unsupported',
      error: `Provider type '${taskInstance.type}' has no provision hook`,
    })
  }

  const username = resolveProvisionUsername(scope.scope, principal.platformInstanceId, principal.platformUserId)
  const publicUrl = process.env['KANEO_CLIENT_URL']
  const internalUrl = process.env['KANEO_INTERNAL_URL']
  const outcome = await provision({
    contextId: scope.scope.contextId,
    username,
    publicUrl,
    internalUrl,
  })
  return outcomeToResponse(scope.scope, outcome)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/debug/settings/provision-routes.test.ts`
Expected: PASS for all five tests.

- [ ] **Step 5: Typecheck**

Run: `bun typecheck`
Expected: PASS. Confirm with `git grep "plugins/task-provider-kaneo/provision" src/` that the only `src/`-side reference to the plugin's `provision.js` is gone.

- [ ] **Step 6: Run the full test suite**

Run: `bun test`
Expected: PASS. The `provision.test.ts` for the Kaneo plugin continues to test `provisionAndConfigure` directly (Task 7 below extends it). No other suite imports from `plugins/`.

- [ ] **Step 7: Commit**

```bash
git add src/debug/settings/provision-routes.ts tests/debug/settings/provision-routes.test.ts
git commit -m "refactor(settings): dispatch provision via plugin registry, remove plugins/ import"
```

---

### Task 7: Extend the Kaneo plugin's `auto-provision` test to cover `kaneoProvision`

**Files:**

- Modify: `tests/plugins/task-provider-kaneo/provision.test.ts` (add a test for `kaneoProvision`)

- [ ] **Step 1: Add the failing test**

Append the following `describe` block to the end of `tests/plugins/task-provider-kaneo/provision.test.ts`:

```typescript
import { kaneoProvision } from '../../../plugins/task-provider-kaneo/auto-provision.js'
// (Add to the existing import block at the top of the file.)

describe('kaneoProvision', () => {
  test('forwards publicUrl/internalUrl to provisionAndConfigure and returns its outcome', async () => {
    let captured: {
      contextId: string
      username: string | null
      publicUrl: string | undefined
      internalUrl: string | undefined
    } | null = null
    // Reuse the existing test pattern: monkey-patch provisionAndConfigure by spying on the module.
    // The simplest approach is to set the env vars, call kaneoProvision, and assert the outcome shape.
    process.env['KANEO_CLIENT_URL'] = 'https://k.example.com'
    process.env['KANEO_INTERNAL_URL'] = 'https://k-internal.example.com'

    // With no real network, this will fail inside provisionKaneoUser. The point of this test
    // is to assert the kaneoProvision shape and that the failure outcome is forwarded.
    const outcome = await kaneoProvision({
      contextId: 'ctx-1',
      username: 'alice',
      publicUrl: 'https://k.example.com',
      internalUrl: 'https://k-internal.example.com',
    })

    expect(outcome.status).toBe('failed')
    if (outcome.status === 'failed') {
      expect(typeof outcome.error).toBe('string')
    }

    // Silence the unused-binding lint: assign then read once.
    captured = {
      contextId: 'ctx-1',
      username: 'alice',
      publicUrl: 'https://k.example.com',
      internalUrl: 'https://k-internal.example.com',
    }
    expect(captured.contextId).toBe('ctx-1')
  })
})
```

Drop the `captured` workaround if the test naturally exercises the same surface — for example, if you instead use `setMockFetch()` to satisfy the signup and assert the workspaceId is forwarded, that's stronger. Match the existing style in the rest of `provision.test.ts` (which uses `setMockFetch()` for network responses).

The recommended replacement (matches the surrounding test style):

```typescript
describe('kaneoProvision', () => {
  test('forwards publicUrl/internalUrl/contextId/username to provisionAndConfigure', async () => {
    setMockFetch((url) => {
      if (url.endsWith('/api/auth/sign-up/email')) {
        return new Response(JSON.stringify({ user: { id: 'u' }, token: 'session-cookie' }), { status: 200 })
      }
      if (url.endsWith('/api/workspaces')) {
        return new Response(JSON.stringify({ id: 'ws-1', slug: 's' }), { status: 200 })
      }
      if (url.includes('/api/api-keys')) {
        return new Response(JSON.stringify({ key: 'k' }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    })

    const outcome = await kaneoProvision({
      contextId: 'ctx-1',
      username: 'alice',
      publicUrl: 'https://k.example.com',
      internalUrl: 'https://k-internal.example.com',
    })

    expect(outcome.status).toBe('provisioned')
    if (outcome.status === 'provisioned') {
      expect(outcome.email).toContain('alice')
      expect(outcome.kaneoUrl).toBe('https://k.example.com')
      expect(outcome.workspaceId).toBe('ws-1')
    }
    restoreFetch()
  })
})
```

Use the recommended version (without the `captured` workaround). Confirm the exact mock URL paths by reading the rest of `provision.test.ts` — the surrounding tests for `provisionAndConfigure` already encode the correct paths.

- [ ] **Step 2: Run the test to verify it passes**

Run: `bun test tests/plugins/task-provider-kaneo/provision.test.ts -t "kaneoProvision"`
Expected: PASS.

- [ ] **Step 3: Typecheck**

Run: `bun typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/plugins/task-provider-kaneo/provision.test.ts
git commit -m "test(kaneo): cover kaneoProvision hook delegates to provisionAndConfigure"
```

---

### Task 8: Final cleanup — verify no `src/` file statically imports from `plugins/`

**Files:**

- Verify: no source changes
- Possibly Modify: `AGENTS.md` or `docs/plugins/developer-guide.md` if a contributor note needs updating

- [ ] **Step 1: Grep for any remaining cross-boundary imports**

Run: `git grep -nE "from ['\"][.][/]+plugins/" src/`
Expected: zero matches. If any are present, they are bugs and must be fixed before merging PR 2.

- [ ] **Step 2: Run the full test suite**

Run: `bun test`
Expected: PASS.

- [ ] **Step 3: Run lint and typecheck**

Run: `bun lint && bun typecheck && bun format:check`
Expected: PASS.

- [ ] **Step 4: Knip check for unused exports**

Run: `bun knip`
Expected: PASS. If `kaneoProvision` is flagged as unused, double-check the `auto-provision.ts` import in `plugins/task-provider-kaneo/index.ts` and the test in Task 7.

- [ ] **Step 5: Commit any doc tweaks**

If you edited `AGENTS.md` or `docs/plugins/developer-guide.md` to mention the new `kaneoProvision` hook:

```bash
git add AGENTS.md docs/plugins/developer-guide.md
git commit -m "docs(plugins): document kaneoProvision hook in developer guide"
```

Otherwise skip this step.

---

# PR 3 — CI smoke test for Docker image

Branch: `ci/docker-image-smoke-test`

Goal: catch any boot-time crash (missing `COPY plugins`, bad import, missing required env var) in CI before it ships.

---

### Task 1: Add a smoke-test step to CI

**Files:**

- Modify: `.github/workflows/ci.yml:17-42` (add a `smoke` job after `build`)
- Create: `scripts/ci/docker-smoke-test.sh`

- [ ] **Step 1: Write the smoke-test helper script**

Create `scripts/ci/docker-smoke-test.sh` with executable permissions:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Smoke-tests a freshly built papai Docker image. Asserts that:
#  - the container starts and stays up for at least 15 seconds
#  - the bot logs the "Starting papai..." info line
#  - the bot does NOT exit with a non-zero code within the first 15 seconds
#
# Required env: IMAGE_TAG, ADMIN_USER_ID (any non-empty value)
# Optional env: STARTUP_DEADLINE_SECONDS (default 15)

IMAGE_TAG="${IMAGE_TAG:?IMAGE_TAG is required}"
ADMIN_USER_ID="${ADMIN_USER_ID:?ADMIN_USER_ID is required}"
DEADLINE="${STARTUP_DEADLINE_SECONDS:-15}"

CONTAINER_NAME="papai-smoke-$$"
LOG_FILE="$(mktemp)"
cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  rm -f "$LOG_FILE"
}
trap cleanup EXIT

docker run --rm --name "$CONTAINER_NAME" \
  -e "ADMIN_USER_ID=$ADMIN_USER_ID" \
  -e "DEBUG_SERVER=true" \
  -e "LOG_LEVEL=info" \
  -e "INSTANCE_CONFIG_KEY=$(printf '%064x' 1)" \
  -e "LLM_API_KEY=sk-smoke-test" \
  -e "LLM_BASE_URL=https://example.invalid" \
  -e "MAIN_MODEL=smoke-model" \
  -e "SETTINGS_PUBLIC_BASE_URL=https://settings.example.invalid" \
  "$IMAGE_TAG" \
  >"$LOG_FILE" 2>&1 &

CONTAINER_PID=$!

# Poll the container: it must remain running for the entire deadline.
elapsed=0
while [ "$elapsed" -lt "$DEADLINE" ]; do
  if ! docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null | grep -q true; then
    echo "Container exited early (after ${elapsed}s). Logs:"
    cat "$LOG_FILE"
    exit 1
  fi
  sleep 1
  elapsed=$((elapsed + 1))
done

# Assert the startup line is present.
if ! grep -q '"msg":"Starting papai..."' "$LOG_FILE"; then
  echo "Did not find startup log line. Logs:"
  cat "$LOG_FILE"
  exit 1
fi

# Assert no module-resolution or fatal errors.
if grep -qE 'Cannot find module|process.exit\(1\)|FATAL' "$LOG_FILE"; then
  echo "Found fatal error in logs:"
  cat "$LOG_FILE"
  exit 1
fi

echo "Smoke test passed: container stayed up for ${DEADLINE}s, startup log present, no fatal errors."
```

Make the script executable: `chmod +x scripts/ci/docker-smoke-test.sh`.

- [ ] **Step 2: Wire the smoke job into CI**

In `.github/workflows/ci.yml`, after the `build` job (lines 17–42), add a new job:

```yaml
smoke:
  name: Docker smoke test
  needs: build
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - name: Run smoke test against the freshly built image
      env:
        IMAGE_TAG: papai:ci-build-${{ github.sha }}
        ADMIN_USER_ID: 'smoke-admin'
        STARTUP_DEADLINE_SECONDS: '15'
      run: bash scripts/ci/docker-smoke-test.sh
```

Also add the new job to any other workflow that publishes an image (`.github/workflows/deploy.yml:17-69`) by emitting a `smoke` job that runs against the build's image before the `deploy` job continues. The simplest is to add a `smoke` job to `deploy.yml` that runs after `build-and-push` and before `deploy`, with the same `IMAGE_TAG` env wired from the build's output.

If the `deploy` workflow is heavy, restrict the smoke to `ci.yml` and rely on the `build` job (which already exists) for early detection — this is the recommended scope for this PR.

- [ ] **Step 3: Verify the script syntax locally**

Run: `bash -n scripts/ci/docker-smoke-test.sh`
Expected: no output (syntax ok).

- [ ] **Step 4: Commit**

```bash
git add scripts/ci/docker-smoke-test.sh .github/workflows/ci.yml
git commit -m "ci: smoke-test the built Docker image to catch boot-time crashes"
```

---

### Task 2: Manual verification on a local build (optional but recommended)

- [ ] **Step 1: Build the image locally**

Run: `docker build -t papai:smoke .`
Expected: succeeds.

- [ ] **Step 2: Run the smoke script**

Run: `IMAGE_TAG=papai:smoke ADMIN_USER_ID=local bash scripts/ci/docker-smoke-test.sh`
Expected: prints `Smoke test passed: container stayed up for 15s, startup log present, no fatal errors.`

- [ ] **Step 3: Negative test — break the Dockerfile temporarily and re-run**

Edit `Dockerfile` to comment out the `COPY plugins ./plugins` line. Rebuild. Re-run the smoke script.
Expected: the script exits non-zero with "Found fatal error in logs" and the actual `Cannot find module` stack trace.

Restore the `COPY plugins ./plugins` line and rebuild.

This step is not committed; it just proves the smoke test catches the regression.

---

## Self-review (to run before merging)

1. **Spec coverage:**
   - PR 1 covers "Defensive guard — fail fast at startup" (proposed fix 2).
   - PR 2 covers "Architectural cleanup" (proposed fix 3): new `TaskProviderProvision` types (Task 2.1), registry lookup (Task 2.1+2.2), plugin wiring (Tasks 2.3–2.5), route refactor (Task 2.6), test updates (Tasks 2.6+2.7), no remaining cross-boundary imports (Task 2.8).
   - PR 3 covers "CI smoke test" (proposed fix 4).

2. **Placeholder scan:** the plan contains zero `TBD`/`TODO`/`similar to`/`fill in` strings. The one ambiguous recommendation (the "recommended replacement" inside Task 2.7's `kaneoProvision` test) is explicitly chosen over the initial snippet, with a clear instruction to match the surrounding test style.

3. **Type consistency:**
   - `TaskProviderProvision` / `TaskProviderProvisionContext` / `TaskProviderProvisionOutcome` are defined in `src/providers/registry.ts` and re-used everywhere they're referenced.
   - `provision` field name is consistent across `ContributedTaskProviderEntry`, `TaskProviderTypeDescriptor`, `PluginContributions.taskProviderRegistration`, `TaskProviderRegistrationInput`, `commitTaskProviderRegistration`, `getTaskProviderProvision`, `kaneoProvision`.
   - The route's outcome shape matches `TaskProviderProvisionOutcome` (status discriminated union with `provisioned` / `registration_disabled` / `failed`).
   - Test setup uses `insertTaskInstance` with `config: {}` to match the existing `seedTestTaskInstance` defaults (the route no longer cares about the URL values — it passes them to the hook).

4. **Plan boundary check:** each PR produces a self-contained, mergeable, reviewable change. PR 1 is small and ships quickly. PR 2 is medium and can be reviewed in isolation. PR 3 is independent of both and could be split or merged in either order.
