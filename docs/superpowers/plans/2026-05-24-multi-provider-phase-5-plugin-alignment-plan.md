# Multi-Provider Phase 5 Plugin Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make plugin compatibility and eligibility multi-provider-aware without changing plugin storage schema or plugin tool runtime contracts.

**Architecture:** Startup compatibility becomes a registry-level multi-instance check fed by a small startup capability collector. Context eligibility stays in `src/plugins/registry.ts`, but it now reads Phase 4 context assignments, task instance capabilities, and runtime chat-router capabilities before exposing plugin tools or prompt fragments. Scheduled jobs keep their existing `execute(contextId)` API and gain eligibility plus resolver guards before execution.

**Tech Stack:** Bun test runner, TypeScript, Drizzle-backed instance stores, `TaskProviderResolver`, `ChatRouter`, plugin registry/contribution modules, Vercel AI SDK tool sets.

---

## Current Context

- Phase 4 is complete on this branch. `ChatRouter` now manages active platform instances and `src/debug/chat-router-runtime.ts` stores the active router for runtime calls.
- `src/index.ts` currently evaluates plugin compatibility against `defaultTaskProviderResolver.resolve(adminUserId)` and aggregate `chatProvider.capabilities`; this is still effectively admin-context/global behavior.
- `src/plugins/registry.ts` currently has `PluginRegistry.evaluateCompatibility(pluginId, taskCapabilities, chatCapabilities)` and `PluginContextEligibility` only supports `inactive`, `disabled`, and `config_missing` failure reasons.
- `src/plugins/contributions.ts` currently runs scheduled jobs for enabled contexts without checking plugin eligibility and without resolving task providers.
- `src/tools/index.ts` already receives the resolved provider from orchestrator/proactive call paths. Phase 5 must preserve `PluginToolSetRuntime` and add regression coverage rather than changing plugin tool runtime shape.

## File Structure

- Modify `src/plugins/registry.ts`
  - Add `PluginCompatibilityInstance` and `evaluateCompatibilityAcrossInstances()`.
  - Add `capability_missing` to `PluginContextEligibility`.
  - Read context assignment from `getContextSettings()`, task capabilities from `getCapabilitiesForTaskInstance()`, and chat capabilities from the active `ChatRouter`.
- Modify `src/providers/registry.ts`
  - Add `getCapabilitiesForTaskInstance(instance)` for capability-only provider inspection.
- Modify `src/chat/router.ts`
  - Add `getPlatformInstanceCapabilities(id)` to read capabilities for one managed chat instance without exposing internals.
- Create `src/plugins/startup-compatibility.ts`
  - Build startup compatibility entries from active task instances and active platform instances.
- Modify `src/index.ts`
  - Replace admin-provider-only plugin compatibility evaluation with `evaluateCompatibilityAcrossInstances(collectStartupCompatibilityInstances(chatProvider, listTaskInstances(), activePlatformInstances))`.
- Modify `src/plugins/contributions.ts`
  - Add scheduled-job eligibility checks and resolver guard for plugins that need task providers.
- Modify `src/commands/plugin.ts`
  - Include required capabilities and source-context missing capability details in `/plugin info`.
- Modify `src/commands/config.ts`
  - Show missing capability details in plugin status rows.
- Test files:
  - `tests/plugins/registry.test.ts`
  - `tests/providers/registry.test.ts`
  - `tests/chat/router.test.ts`
  - `tests/plugins/startup-compatibility.test.ts`
  - `tests/index-startup.test.ts`
  - `tests/plugins/contributions.test.ts`
  - `tests/commands/plugin.test.ts`
  - `tests/commands/config.test.ts`
  - `tests/plugins/integration.test.ts`

## Task 1: Multi-Instance Compatibility In PluginRegistry

**Files:**

- Modify: `src/plugins/registry.ts`
- Test: `tests/plugins/registry.test.ts`

- [ ] **Step 1: Write failing tests for multi-instance compatibility**

Append these tests inside the `describe('PluginRegistry', () => { })` block in `tests/plugins/registry.test.ts` after the existing `evaluateCompatibility leaves compatible plugin as approved` test:

```typescript
test('evaluateCompatibilityAcrossInstances keeps approved when any capability set satisfies requirements', () => {
  const plugin = makePlugin({
    manifest: {
      ...makePlugin().manifest,
      requiredTaskCapabilities: ['workItems.list'],
      requiredChatCapabilities: ['messages.buttons'],
    },
  })
  registry.registerDiscovered(plugin)
  registry.approve('test-plugin', 'admin', 'hash-abc')

  registry.evaluateCompatibilityAcrossInstances([
    { taskCapabilities: new Set(), chatCapabilities: new Set(['messages.buttons']) },
    { taskCapabilities: new Set(['workItems.list']), chatCapabilities: new Set(['messages.buttons']) },
  ])

  expect(registry.getEntry('test-plugin')?.state).toBe('approved')
})

test('evaluateCompatibilityAcrossInstances marks approved plugin incompatible when no set satisfies requirements', () => {
  const plugin = makePlugin({
    manifest: { ...makePlugin().manifest, requiredTaskCapabilities: ['workItems.list'] },
  })
  registry.registerDiscovered(plugin)
  registry.approve('test-plugin', 'admin', 'hash-abc')

  registry.evaluateCompatibilityAcrossInstances([
    { taskCapabilities: new Set(['comments.read']), chatCapabilities: new Set() },
    { taskCapabilities: new Set(['tasks.delete']), chatCapabilities: new Set() },
  ])

  expect(registry.getEntry('test-plugin')?.state).toBe('incompatible')
  expect(registry.getEntry('test-plugin')?.compatibilityReason).toBe(
    'No active instance satisfies required capabilities',
  )
})

test('evaluateCompatibilityAcrossInstances keeps plugins with no requirements approved when no instances are active', () => {
  const plugin = makePlugin()
  registry.registerDiscovered(plugin)
  registry.approve('test-plugin', 'admin', 'hash-abc')

  registry.evaluateCompatibilityAcrossInstances([])

  expect(registry.getEntry('test-plugin')?.state).toBe('approved')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test ./tests/plugins/registry.test.ts -t "evaluateCompatibilityAcrossInstances"`

Expected: FAIL with TypeScript errors that `evaluateCompatibilityAcrossInstances` does not exist on `PluginRegistry`.

- [ ] **Step 3: Add multi-instance compatibility types and helper**

In `src/plugins/registry.ts`, add this type after the `PluginRegistryEntry` export:

```typescript
export type PluginCompatibilityInstance = Readonly<{
  taskCapabilities: ReadonlySet<TaskCapability>
  chatCapabilities: ReadonlySet<ChatCapability>
}>

const NO_ACTIVE_INSTANCE_COMPATIBILITY_REASON = 'No active instance satisfies required capabilities'
const EMPTY_CAPABILITIES: ReadonlySet<never> = new Set()

const normalizeCompatibilityInstances = (
  instances: readonly PluginCompatibilityInstance[],
): readonly PluginCompatibilityInstance[] => {
  if (instances.length > 0) return instances
  return [{ taskCapabilities: EMPTY_CAPABILITIES, chatCapabilities: EMPTY_CAPABILITIES }]
}
```

- [ ] **Step 4: Add `evaluateCompatibilityAcrossInstances()`**

In `src/plugins/registry.ts`, add this method immediately after the existing `evaluateCompatibility()` method:

```typescript
  /** Evaluate compatibility against all active task/chat capability combinations. */
  evaluateCompatibilityAcrossInstances(instances: readonly PluginCompatibilityInstance[]): void {
    const candidates = normalizeCompatibilityInstances(instances)
    for (const [pluginId, entry] of this.entries.entries()) {
      if (entry.state !== 'approved') continue
      const compatible = candidates.some((candidate) => {
        const result = checkPluginCompatibility(
          entry.discoveredPlugin.manifest,
          candidate.taskCapabilities,
          candidate.chatCapabilities,
        )
        return result.compatible
      })
      if (compatible) {
        entry.compatibilityReason = undefined
        continue
      }
      entry.state = 'incompatible'
      entry.compatibilityReason = NO_ACTIVE_INSTANCE_COMPATIBILITY_REASON
      log.warn({ pluginId, reason: NO_ACTIVE_INSTANCE_COMPATIBILITY_REASON }, 'Plugin marked incompatible')
    }
  }
```

- [ ] **Step 5: Run focused registry tests**

Run: `bun test ./tests/plugins/registry.test.ts`

Expected: PASS.

- [ ] **Step 6: Run strict checks for touched files**

Run: `bun lint:agent-strict -- src/plugins/registry.ts tests/plugins/registry.test.ts`

Expected: PASS with `0 errors`.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/plugins/registry.ts tests/plugins/registry.test.ts
git commit -m "feat(plugins): evaluate compatibility across instances"
```

## Task 2: Startup Capability Collection

**Files:**

- Modify: `src/providers/registry.ts`
- Modify: `src/chat/router.ts`
- Create: `src/plugins/startup-compatibility.ts`
- Modify: `src/index.ts`
- Test: `tests/providers/registry.test.ts`
- Test: `tests/chat/router.test.ts`
- Test: `tests/plugins/startup-compatibility.test.ts`
- Test: `tests/index-startup.test.ts`

- [ ] **Step 1: Write failing provider capability tests**

Create `tests/providers/registry.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { getCapabilitiesForTaskInstance } from '../../src/providers/registry.js'
import type { TaskInstance } from '../../src/instances/types.js'

const taskInstance = (type: TaskInstance['type']): TaskInstance => ({
  id: `${type}-default`,
  type,
  config: { url: `https://${type}.invalid` },
  status: 'active',
  createdAt: 'now',
})

describe('provider registry capability lookup', () => {
  test('returns Kaneo task capabilities without requiring context credentials', () => {
    const capabilities = getCapabilitiesForTaskInstance(taskInstance('kaneo'))

    expect(capabilities.has('comments.read')).toBe(true)
    expect(capabilities.has('workItems.list')).toBe(false)
  })

  test('returns YouTrack task capabilities without requiring context credentials', () => {
    const capabilities = getCapabilitiesForTaskInstance(taskInstance('youtrack'))

    expect(capabilities.has('comments.read')).toBe(true)
    expect(capabilities.has('workItems.list')).toBe(true)
  })
})
```

- [ ] **Step 2: Write failing router capability test**

Append this test inside `describe('ChatRouter', () => { })` in `tests/chat/router.test.ts`:

```typescript
test('getPlatformInstanceCapabilities returns capabilities for a managed instance', () => {
  const capabilityRouter = new ChatRouter((id: string, type: PlatformInstanceType, _config: InstanceConfig) => {
    const fakeProvider = makeProvider(type, { capabilities: ['messages.buttons'] })
    providers[id] = fakeProvider
    return fakeProvider
  })
  capabilityRouter.addInstance('telegram-a', 'telegram', { token: 'x' })

  expect(capabilityRouter.getPlatformInstanceCapabilities('telegram-a')).toEqual(new Set(['messages.buttons']))
  expect(capabilityRouter.getPlatformInstanceCapabilities('missing')).toEqual(new Set())
})
```

- [ ] **Step 3: Write failing startup collector tests**

Create `tests/plugins/startup-compatibility.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ChatRouter } from '../../src/chat/router.js'
import type { ChatCapability, ChatProvider } from '../../src/chat/types.js'
import type { PlatformInstance, TaskInstance } from '../../src/instances/types.js'
import { collectStartupCompatibilityInstances } from '../../src/plugins/startup-compatibility.js'
import { createMockChat } from '../utils/test-helpers.js'

const platformInstance = (id: string, status: PlatformInstance['status']): PlatformInstance => ({
  id,
  type: 'telegram',
  config: { token: 'x' },
  status,
  createdAt: 'now',
})

const taskInstance = (id: string, type: TaskInstance['type'], status: TaskInstance['status']): TaskInstance => ({
  id,
  type,
  config: { url: `https://${id}.invalid` },
  status,
  createdAt: 'now',
})

describe('startup plugin compatibility collection', () => {
  test('builds compatibility entries from active task and platform instances', () => {
    const router = new ChatRouter(
      (_id, _type, _config): ChatProvider =>
        createMockChat({ capabilities: new Set<ChatCapability>(['messages.buttons']) }),
    )
    router.addInstance('telegram-a', 'telegram', { token: 'x' })

    const result = collectStartupCompatibilityInstances(
      router,
      [taskInstance('yt-a', 'youtrack', 'active'), taskInstance('kaneo-stopped', 'kaneo', 'stopped')],
      [platformInstance('telegram-a', 'active'), platformInstance('telegram-stopped', 'stopped')],
    )

    expect(result).toHaveLength(1)
    expect(result[0]?.taskCapabilities.has('workItems.list')).toBe(true)
    expect(result[0]?.chatCapabilities.has('messages.buttons')).toBe(true)
  })

  test('uses an empty capability set for a missing side', () => {
    const router = new ChatRouter(() => createMockChat())

    const result = collectStartupCompatibilityInstances(router, [], [])

    expect(result).toHaveLength(1)
    expect(result[0]?.taskCapabilities.size).toBe(0)
    expect(result[0]?.chatCapabilities.size).toBe(0)
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `bun test ./tests/providers/registry.test.ts ./tests/chat/router.test.ts ./tests/plugins/startup-compatibility.test.ts`

Expected: FAIL because `getCapabilitiesForTaskInstance`, `getPlatformInstanceCapabilities`, and `collectStartupCompatibilityInstances` are not implemented.

- [ ] **Step 5: Add `getCapabilitiesForTaskInstance()`**

In `src/providers/registry.ts`, update imports and add the helper after `createProvider()`:

```typescript
import type { TaskInstance } from '../instances/types.js'
import type { TaskCapability, TaskProvider } from './types.js'
```

```typescript
const capabilityConfigForTaskInstance = (instance: TaskInstance): Record<string, string> => {
  if (instance.type === 'kaneo') {
    const baseUrl = instance.config['baseUrl'] ?? instance.config['url'] ?? ''
    return { apiKey: '', baseUrl, workspaceId: '' }
  }
  const baseUrl = instance.config['baseUrl'] ?? instance.config['url'] ?? ''
  return { baseUrl, token: '' }
}

export function getCapabilitiesForTaskInstance(instance: TaskInstance): ReadonlySet<TaskCapability> {
  return createProvider(instance.type, capabilityConfigForTaskInstance(instance)).capabilities
}
```

- [ ] **Step 6: Add `ChatRouter.getPlatformInstanceCapabilities()`**

In `src/chat/router.ts`, add this method after `getInstanceTraits()`:

```typescript
  getPlatformInstanceCapabilities(platformInstanceId: string): ReadonlySet<ChatCapability> {
    const instance = this.instances.get(platformInstanceId)
    if (instance === undefined) return new Set()
    return instance.provider.capabilities
  }
```

- [ ] **Step 7: Add startup compatibility collector**

Create `src/plugins/startup-compatibility.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatRouter } from '../chat/router.js'
import type { ChatCapability } from '../chat/types.js'
import type { PlatformInstance, TaskInstance } from '../instances/types.js'
import { getCapabilitiesForTaskInstance } from '../providers/registry.js'
import type { TaskCapability } from '../providers/types.js'
import type { PluginCompatibilityInstance } from './registry.js'

const EMPTY_TASK_CAPABILITIES: ReadonlySet<TaskCapability> = new Set()
const EMPTY_CHAT_CAPABILITIES: ReadonlySet<ChatCapability> = new Set()

const activeTaskCapabilitySets = (taskInstances: readonly TaskInstance[]): readonly ReadonlySet<TaskCapability>[] =>
  taskInstances
    .filter((instance) => instance.status === 'active')
    .map((instance) => getCapabilitiesForTaskInstance(instance))

const activeChatCapabilitySets = (
  router: ChatRouter,
  platformInstances: readonly PlatformInstance[],
): readonly ReadonlySet<ChatCapability>[] =>
  platformInstances
    .filter((instance) => instance.status === 'active')
    .map((instance) => router.getPlatformInstanceCapabilities(instance.id))

export const buildCompatibilityInstances = (
  taskCapabilities: readonly ReadonlySet<TaskCapability>[],
  chatCapabilities: readonly ReadonlySet<ChatCapability>[],
): readonly PluginCompatibilityInstance[] => {
  const taskSets = taskCapabilities.length === 0 ? [EMPTY_TASK_CAPABILITIES] : taskCapabilities
  const chatSets = chatCapabilities.length === 0 ? [EMPTY_CHAT_CAPABILITIES] : chatCapabilities
  return taskSets.flatMap((taskSet) =>
    chatSets.map((chatSet) => ({ taskCapabilities: taskSet, chatCapabilities: chatSet })),
  )
}

export const collectStartupCompatibilityInstances = (
  router: ChatRouter,
  taskInstances: readonly TaskInstance[],
  platformInstances: readonly PlatformInstance[],
): readonly PluginCompatibilityInstance[] =>
  buildCompatibilityInstances(
    activeTaskCapabilitySets(taskInstances),
    activeChatCapabilitySets(router, platformInstances),
  )
```

- [ ] **Step 8: Wire startup compatibility in `src/index.ts`**

Modify imports in `src/index.ts`:

```typescript
import { listTaskInstances } from './instances/task-store.js'
import { collectStartupCompatibilityInstances } from './plugins/startup-compatibility.js'
```

Replace lines 150-159 in `src/index.ts` with:

```typescript
try {
  const compatibilityInstances = collectStartupCompatibilityInstances(
    chatProvider,
    listTaskInstances(),
    activePlatformInstances,
  )
  pluginRegistry.evaluateCompatibilityAcrossInstances(compatibilityInstances)
} catch (error) {
  log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Plugin compatibility evaluation skipped')
}
```

- [ ] **Step 9: Add an index startup regression test**

In `tests/index-startup.test.ts`, add a focused assertion to the existing startup test that mocks plugin registry behavior. Use the file's existing delayed-import pattern. The assertion must verify that startup calls `evaluateCompatibilityAcrossInstances` and does not call `defaultTaskProviderResolver.resolve(adminUserId)` for plugin compatibility.

Add this helper variable near the suite's plugin registry mocks:

```typescript
let evaluatedCompatibilityInstances = 0
```

In the mocked `pluginRegistry`, add:

```typescript
evaluateCompatibilityAcrossInstances: (instances: readonly unknown[]): void => {
  evaluatedCompatibilityInstances = instances.length
},
```

In the test body after startup completes, assert:

```typescript
expect(evaluatedCompatibilityInstances).toBeGreaterThan(0)
```

- [ ] **Step 10: Run focused tests**

Run: `bun test ./tests/providers/registry.test.ts ./tests/chat/router.test.ts ./tests/plugins/startup-compatibility.test.ts ./tests/index-startup.test.ts`

Expected: PASS.

- [ ] **Step 11: Run strict checks for touched files**

Run: `bun lint:agent-strict -- src/providers/registry.ts src/chat/router.ts src/plugins/startup-compatibility.ts src/index.ts tests/providers/registry.test.ts tests/chat/router.test.ts tests/plugins/startup-compatibility.test.ts tests/index-startup.test.ts`

Expected: PASS with `0 errors`.

- [ ] **Step 12: Commit Task 2**

```bash
git add src/providers/registry.ts src/chat/router.ts src/plugins/startup-compatibility.ts src/index.ts tests/providers/registry.test.ts tests/chat/router.test.ts tests/plugins/startup-compatibility.test.ts tests/index-startup.test.ts
git commit -m "feat(plugins): collect startup capabilities by instance"
```

## Task 3: Per-Context Capability Eligibility And Operator Surface

**Files:**

- Modify: `src/plugins/registry.ts`
- Modify: `src/commands/plugin.ts`
- Modify: `src/commands/config.ts`
- Test: `tests/plugins/registry.test.ts`
- Test: `tests/commands/plugin.test.ts`
- Test: `tests/commands/config.test.ts`

- [ ] **Step 1: Write failing registry eligibility tests**

Update imports in `tests/plugins/registry.test.ts`:

```typescript
import { ChatRouter } from '../../src/chat/router.js'
import { clearRuntimeChatRouter, setRuntimeChatRouter } from '../../src/debug/chat-router-runtime.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import { createMockChat } from '../utils/test-helpers.js'
```

Update the `afterEach` in `describe('singleton registry helpers', () => { })`:

```typescript
afterEach(() => {
  clearRuntimeChatRouter()
})
```

Append these tests in `describe('singleton registry helpers', () => { })`:

```typescript
test('returns capability_missing when assigned task instance lacks a required task capability', () => {
  const pluginId = 'task-capability-plugin'
  const contextId = 'ctx-task-capability'
  const plugin = makePlugin({
    manifest: {
      ...makePlugin().manifest,
      id: pluginId,
      name: 'Task Capability Plugin',
      defaultEnabled: true,
      requiredTaskCapabilities: ['workItems.list'],
    },
    manifestHash: 'hash-task-capability',
  })
  insertTaskInstance({ id: 'kaneo-a', type: 'kaneo', config: { url: 'https://kaneo.invalid' }, status: 'active' })
  setContextSettings({ contextId, taskInstanceId: 'kaneo-a', platformInstanceId: 'telegram-a' })

  pluginRegistry.registerDiscovered(plugin)
  pluginRegistry.approve(pluginId, 'admin', 'hash-task-capability')
  pluginRegistry.markActive(pluginId)

  expect(getPluginContextEligibility(pluginId, contextId)).toEqual({
    eligible: false,
    reason: 'capability_missing',
    missingCapabilities: ['workItems.list'],
  })
  expect(getPluginsForContext(contextId)).toEqual([])
})

test('returns capability_missing when assigned platform instance lacks a required chat capability', () => {
  const pluginId = 'chat-capability-plugin'
  const contextId = 'ctx-chat-capability'
  const plugin = makePlugin({
    manifest: {
      ...makePlugin().manifest,
      id: pluginId,
      name: 'Chat Capability Plugin',
      defaultEnabled: true,
      requiredChatCapabilities: ['messages.buttons'],
    },
    manifestHash: 'hash-chat-capability',
  })
  insertTaskInstance({ id: 'yt-a', type: 'youtrack', config: { url: 'https://yt.invalid' }, status: 'active' })
  setContextSettings({ contextId, taskInstanceId: 'yt-a', platformInstanceId: 'telegram-a' })
  const router = new ChatRouter(() => createMockChat({ capabilities: new Set() }))
  router.addInstance('telegram-a', 'telegram', { token: 'x' })
  setRuntimeChatRouter(router)

  pluginRegistry.registerDiscovered(plugin)
  pluginRegistry.approve(pluginId, 'admin', 'hash-chat-capability')
  pluginRegistry.markActive(pluginId)

  expect(getPluginContextEligibility(pluginId, contextId)).toEqual({
    eligible: false,
    reason: 'capability_missing',
    missingCapabilities: ['messages.buttons'],
  })
})

test('skips capability checks when context settings are absent', () => {
  const pluginId = 'pre-setup-plugin'
  const plugin = makePlugin({
    manifest: {
      ...makePlugin().manifest,
      id: pluginId,
      name: 'Pre Setup Plugin',
      defaultEnabled: true,
      requiredTaskCapabilities: ['workItems.list'],
    },
    manifestHash: 'hash-pre-setup',
  })
  pluginRegistry.registerDiscovered(plugin)
  pluginRegistry.approve(pluginId, 'admin', 'hash-pre-setup')
  pluginRegistry.markActive(pluginId)

  expect(getPluginContextEligibility(pluginId, 'ctx-without-settings')).toEqual({ eligible: true })
})
```

- [ ] **Step 2: Run registry tests to verify they fail**

Run: `bun test ./tests/plugins/registry.test.ts -t "capability_missing"`

Expected: FAIL because `capability_missing` is not part of `PluginContextEligibility` and the registry does not inspect context capabilities.

- [ ] **Step 3: Add capability lookup helpers to `src/plugins/registry.ts`**

Add imports:

```typescript
import { getRuntimeChatRouter } from '../debug/chat-router-runtime.js'
import { getContextSettings } from '../instances/context-store.js'
import { getTaskInstance } from '../instances/task-store.js'
import { getCapabilitiesForTaskInstance } from '../providers/registry.js'
```

Replace `PluginContextEligibility` with:

```typescript
export type PluginContextEligibility =
  | { eligible: true }
  | { eligible: false; reason: 'inactive' | 'disabled' | 'config_missing'; missingKeys?: readonly string[] }
  | { eligible: false; reason: 'capability_missing'; missingCapabilities: readonly string[] }
```

Add these helpers after `getMissingRequiredConfigKeys()`:

```typescript
const missingFromSet = <Capability extends string>(
  required: readonly Capability[],
  available: ReadonlySet<Capability>,
): readonly string[] => required.filter((capability) => !available.has(capability))

const getTaskCapabilitiesForContext = (contextId: string): ReadonlySet<TaskCapability> | null => {
  const settings = getContextSettings(contextId)
  if (settings === null) return null
  const instance = getTaskInstance(settings.taskInstanceId)
  if (instance === null || instance.status !== 'active') return new Set()
  return getCapabilitiesForTaskInstance(instance)
}

const getChatCapabilitiesForContext = (contextId: string): ReadonlySet<ChatCapability> | null => {
  const settings = getContextSettings(contextId)
  if (settings === null) return null
  const router = getRuntimeChatRouter()
  if (router === null) return new Set()
  return router.getPlatformInstanceCapabilities(settings.platformInstanceId)
}

function getMissingRequiredCapabilities(plugin: DiscoveredPlugin, contextId: string): readonly string[] {
  const taskCapabilities = getTaskCapabilitiesForContext(contextId)
  const chatCapabilities = getChatCapabilitiesForContext(contextId)
  if (taskCapabilities === null || chatCapabilities === null) return []
  return [
    ...missingFromSet(plugin.manifest.requiredTaskCapabilities, taskCapabilities),
    ...missingFromSet(plugin.manifest.requiredChatCapabilities, chatCapabilities),
  ]
}
```

- [ ] **Step 4: Fold capability checks into `getPluginContextEligibility()`**

In `src/plugins/registry.ts`, add this before `return { eligible: true }`:

```typescript
const missingCapabilities = getMissingRequiredCapabilities(entry.discoveredPlugin, contextId)
if (missingCapabilities.length > 0) {
  return { eligible: false, reason: 'capability_missing', missingCapabilities }
}
```

- [ ] **Step 5: Run registry tests**

Run: `bun test ./tests/plugins/registry.test.ts`

Expected: PASS.

- [ ] **Step 6: Add `/plugin info` missing-capability test**

In `tests/commands/plugin.test.ts`, add imports:

```typescript
import { ChatRouter } from '../../src/chat/router.js'
import { clearRuntimeChatRouter, setRuntimeChatRouter } from '../../src/debug/chat-router-runtime.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import { createMockChat } from '../utils/test-helpers.js'
```

In the suite `afterEach`, call:

```typescript
clearRuntimeChatRouter()
```

Append this test:

```typescript
test('plugin info reports source-context missing capabilities', async () => {
  const basePlugin = makePlugin('capability-info-plugin')
  const plugin: DiscoveredPlugin = {
    ...basePlugin,
    manifest: {
      ...basePlugin.manifest,
      defaultEnabled: true,
      requiredTaskCapabilities: ['workItems.list'],
      requiredChatCapabilities: ['messages.buttons'],
    },
  }
  pluginRegistry.registerDiscovered(plugin)
  pluginRegistry.approve(plugin.manifest.id, 'root-admin', plugin.manifestHash)
  pluginRegistry.markActive(plugin.manifest.id)
  insertTaskInstance({ id: 'kaneo-a', type: 'kaneo', config: { url: 'https://kaneo.invalid' }, status: 'active' })
  setContextSettings({ contextId: 'root-admin', taskInstanceId: 'kaneo-a', platformInstanceId: 'telegram-default' })
  const router = new ChatRouter(() => createMockChat({ capabilities: new Set() }))
  router.addInstance('telegram-default', 'telegram', { token: 'x' })
  setRuntimeChatRouter(router)
  addAdmin('root-admin', SUPER_ADMIN_PLATFORM_ID)
  const handler = registerCommandForTest()
  const reply = createMockReply()

  await handler(
    {
      ...createDmMessage('root-admin', '/plugin info capability-info-plugin'),
      commandMatch: 'info capability-info-plugin',
      platformInstanceId: 'telegram-default',
    },
    reply.reply,
    createAuth('root-admin'),
  )

  expect(reply.textCalls[0]).toContain('Required task capabilities: workItems.list')
  expect(reply.textCalls[0]).toContain('Required chat capabilities: messages.buttons')
  expect(reply.textCalls[0]).toContain('Missing for this context: workItems.list, messages.buttons')
})
```

- [ ] **Step 7: Update `/plugin info` formatting**

In `src/commands/plugin.ts`, update the registry import:

```typescript
import { getPluginContextEligibility, pluginRegistry, setPluginEnabledForContext } from '../plugins/registry.js'
```

In `src/commands/plugin.ts`, change the signature:

```typescript
function buildPluginInfoMessage(pluginId: string, sourceContextId: string): string {
```

After the existing `Config keys:` line, add:

```typescript
    `Required task capabilities: ${manifest.requiredTaskCapabilities.length > 0 ? manifest.requiredTaskCapabilities.join(', ') : 'none'}`,
    `Required chat capabilities: ${manifest.requiredChatCapabilities.length > 0 ? manifest.requiredChatCapabilities.join(', ') : 'none'}`,
```

After the existing compatibility-reason line, add:

```typescript
const eligibility = getPluginContextEligibility(pluginId, sourceContextId)
if (!eligibility.eligible && eligibility.reason === 'capability_missing') {
  lines.push(`Missing for this context: ${eligibility.missingCapabilities.join(', ')}`)
}
```

Update the `info` branch in `runPluginSubcommand()`:

```typescript
await ctx.reply.text(
  id === undefined ? 'Usage: /plugin info <plugin-id>' : buildPluginInfoMessage(id, ctx.sourceContextId),
)
```

- [ ] **Step 8: Add `/config` missing-capability status test**

In `tests/commands/config.test.ts`, add a test inside `describe('with interactive button support', () => { })` using the file's existing `renderConfigForTarget()` pattern:

```typescript
test('plugin rows show missing capability status for selected context', async () => {
  const plugin = makePlugin('config-capability-plugin', {
    defaultEnabled: true,
    requiredTaskCapabilities: ['workItems.list'],
  })
  pluginRegistry.registerDiscovered(plugin)
  pluginRegistry.approve(plugin.manifest.id, 'admin', plugin.manifestHash)
  pluginRegistry.markActive(plugin.manifest.id)
  insertTaskInstance({
    id: `${USER_ID}-missing-capability`,
    type: 'kaneo',
    config: { url: 'https://kaneo.invalid' },
    status: 'active',
  })
  setContextSettings({
    contextId: USER_ID,
    taskInstanceId: `${USER_ID}-missing-capability`,
    platformInstanceId: 'telegram-default',
  })

  const { reply, buttonCalls } = createMockReply()
  await renderConfigForTarget(reply, USER_ID, true)

  assert.ok(buttonCalls[0] !== undefined, 'expected buttonCalls[0] to be defined')
  expect(buttonCalls[0]).toContain('unavailable (missing capability: workItems.list)')
})
```

- [ ] **Step 9: Update `/config` plugin status formatting**

In `src/commands/config.ts`, update `formatPluginStatus()`:

```typescript
if (eligibility.reason === 'config_missing') return 'unavailable (missing config)'
if (eligibility.reason === 'capability_missing') {
  return `unavailable (missing capability: ${eligibility.missingCapabilities.join(', ')})`
}
return 'disabled'
```

- [ ] **Step 10: Run command and registry tests**

Run: `bun test ./tests/plugins/registry.test.ts ./tests/commands/plugin.test.ts ./tests/commands/config.test.ts`

Expected: PASS.

- [ ] **Step 11: Run strict checks for touched files**

Run: `bun lint:agent-strict -- src/plugins/registry.ts src/commands/plugin.ts src/commands/config.ts tests/plugins/registry.test.ts tests/commands/plugin.test.ts tests/commands/config.test.ts`

Expected: PASS with `0 errors`.

- [ ] **Step 12: Commit Task 3**

```bash
git add src/plugins/registry.ts src/commands/plugin.ts src/commands/config.ts tests/plugins/registry.test.ts tests/commands/plugin.test.ts tests/commands/config.test.ts
git commit -m "feat(plugins): gate eligibility by context capabilities"
```

## Task 4: Scheduled Job Eligibility And Resolver Guards

**Files:**

- Modify: `src/plugins/contributions.ts`
- Test: `tests/plugins/contributions.test.ts`

- [ ] **Step 1: Write failing scheduled-job tests**

Append these tests inside `describe('PluginContributionRegistry', () => { })` in `tests/plugins/contributions.test.ts` after `runs scheduled jobs only for explicitly enabled plugin contexts`:

```typescript
test('scheduled jobs skip contexts that are not plugin eligible', async () => {
  const seenContexts: string[] = []
  const manifest = makeManifest({
    contributes: { tools: [], promptFragments: [], commands: [], jobs: ['daily'], configKeys: [] },
    configRequirements: [{ key: 'api_token', label: 'API Token', required: true, sensitive: true }],
  })
  contributionRegistry.register(
    'test-plugin',
    {
      tools: [],
      promptFragments: [],
      commands: [],
      jobs: [{ name: 'daily', intervalMs: 60_000, execute: (contextId): void => seenContexts.push(contextId) }],
    },
    manifest,
  )
  setPluginEnabledForContext('test-plugin', 'ctx-enabled', true)

  await runPluginScheduledJob('test-plugin', 'daily')

  expect(seenContexts).toEqual([])
})

test('scheduled jobs skip task plugins when resolver returns null for the context', async () => {
  const seenContexts: string[] = []
  const resolvedContexts: string[] = []
  const manifest = makeManifest({
    permissions: ['tasks.read'],
    contributes: { tools: [], promptFragments: [], commands: [], jobs: ['daily'], configKeys: [] },
  })
  contributionRegistry.register(
    'test-plugin',
    {
      tools: [],
      promptFragments: [],
      commands: [],
      jobs: [{ name: 'daily', intervalMs: 60_000, execute: (contextId): void => seenContexts.push(contextId) }],
    },
    manifest,
  )
  setPluginEnabledForContext('test-plugin', 'ctx-enabled', true)

  await runPluginScheduledJob('test-plugin', 'daily', {
    resolveTaskProvider: (contextId) => {
      resolvedContexts.push(contextId)
      return null
    },
  })

  expect(resolvedContexts).toEqual(['ctx-enabled'])
  expect(seenContexts).toEqual([])
})

test('scheduled jobs continue after one context throws', async () => {
  const seenContexts: string[] = []
  const manifest = makeManifest({
    contributes: { tools: [], promptFragments: [], commands: [], jobs: ['daily'], configKeys: [] },
  })
  contributionRegistry.register(
    'test-plugin',
    {
      tools: [],
      promptFragments: [],
      commands: [],
      jobs: [
        {
          name: 'daily',
          intervalMs: 60_000,
          execute: (contextId): void => {
            if (contextId === 'ctx-a') throw new Error('boom')
            seenContexts.push(contextId)
          },
        },
      ],
    },
    manifest,
  )
  setPluginEnabledForContext('test-plugin', 'ctx-a', true)
  setPluginEnabledForContext('test-plugin', 'ctx-b', true)

  await runPluginScheduledJob('test-plugin', 'daily')

  expect(seenContexts).toEqual(['ctx-b'])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test ./tests/plugins/contributions.test.ts -t "scheduled jobs"`

Expected: FAIL because scheduled jobs do not check eligibility, do not accept resolver deps, and stop on thrown execution.

- [ ] **Step 3: Add scheduled-job dependency type and task-need helper**

In `src/plugins/contributions.ts`, add imports:

```typescript
import { getPluginContextEligibility } from './registry.js'
import { defaultTaskProviderResolver } from '../providers/resolver.js'
import type { TaskProvider } from '../providers/types.js'
```

Add after `export type { PluginToolSetRuntime } from './tool-runtime.js'`:

```typescript
export type PluginScheduledJobDeps = Readonly<{
  resolveTaskProvider: (contextId: string) => TaskProvider | null
}>

const defaultScheduledJobDeps: PluginScheduledJobDeps = {
  resolveTaskProvider: (contextId) => defaultTaskProviderResolver.resolve(contextId),
}

const pluginNeedsTaskProvider = (manifest: PluginManifest): boolean =>
  manifest.permissions.includes('tasks.read') ||
  manifest.permissions.includes('tasks.write') ||
  manifest.requiredTaskCapabilities.length > 0
```

- [ ] **Step 4: Replace `runPluginScheduledJob()`**

Replace the current function in `src/plugins/contributions.ts` with:

```typescript
export async function runPluginScheduledJob(
  pluginId: string,
  jobName: string,
  deps: PluginScheduledJobDeps = defaultScheduledJobDeps,
): Promise<void> {
  const contributions = contributionRegistry.getContributions(pluginId)
  const job = contributions?.jobs.find((candidate) => candidate.name === jobName)
  if (job === undefined || contributions === undefined) return

  for (const contextId of getEnabledContextsForPlugin(pluginId)) {
    const eligibility = getPluginContextEligibility(pluginId, contextId)
    if (!eligibility.eligible) {
      log.warn(
        { pluginId, jobName, contextId, reason: eligibility.reason },
        'Plugin job skipping context — not eligible',
      )
      continue
    }
    if (pluginNeedsTaskProvider(contributions.manifest) && deps.resolveTaskProvider(contextId) === null) {
      log.warn({ pluginId, jobName, contextId }, 'Plugin job skipping context — task provider unresolved')
      continue
    }
    try {
      await job.execute(contextId)
    } catch (error) {
      log.error(
        { pluginId, jobName, contextId, error: error instanceof Error ? error.message : String(error) },
        'Plugin job execute threw',
      )
    }
  }
}
```

- [ ] **Step 5: Run contribution tests**

Run: `bun test ./tests/plugins/contributions.test.ts`

Expected: PASS.

- [ ] **Step 6: Run strict checks for touched files**

Run: `bun lint:agent-strict -- src/plugins/contributions.ts tests/plugins/contributions.test.ts`

Expected: PASS with `0 errors`.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/plugins/contributions.ts tests/plugins/contributions.test.ts
git commit -m "feat(plugins): guard scheduled jobs by eligibility"
```

## Task 5: Context-Resolved Plugin Tool Regression

**Files:**

- Modify: `tests/plugins/integration.test.ts`

- [ ] **Step 1: Write failing integration test for context capabilities and resolved providers**

Update imports in `tests/plugins/integration.test.ts`:

```typescript
import { ChatRouter } from '../../src/chat/router.js'
import { clearRuntimeChatRouter, setRuntimeChatRouter } from '../../src/debug/chat-router-runtime.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import { defaultTaskProviderResolver } from '../../src/providers/resolver.js'
import { setConfig } from '../../src/config.js'
import { setKaneoWorkspace } from '../../src/users.js'
import { createMockChat } from '../utils/test-helpers.js'
```

Update `afterEach` in `describe('plugin lifecycle integration', () => { })`:

```typescript
clearRuntimeChatRouter()
```

Append this test:

```typescript
test('exposes plugin tools only for contexts whose resolved provider has required capabilities', async () => {
  const rootDir = createTempPlugin({
    pluginId: 'provider-capability-plugin',
    source: workingPluginSource,
    manifestPatch: { defaultEnabled: true, requiredTaskCapabilities: ['workItems.list'] },
  })
  const plugin = discoverSinglePlugin(rootDir)
  pluginRegistry.registerDiscovered(plugin)
  pluginRegistry.approve(plugin.manifest.id, 'admin-user', plugin.manifestHash)
  pluginRegistry.evaluateCompatibilityAcrossInstances([
    { taskCapabilities: new Set(['workItems.list']), chatCapabilities: new Set() },
  ])
  await activatePlugins(pluginRegistry.getApprovedCompatiblePlugins())

  insertTaskInstance({ id: 'kaneo-a', type: 'kaneo', config: { url: 'https://kaneo.invalid' }, status: 'active' })
  insertTaskInstance({ id: 'youtrack-a', type: 'youtrack', config: { url: 'https://yt.invalid' }, status: 'active' })
  setContextSettings({ contextId: 'ctx-kaneo', taskInstanceId: 'kaneo-a', platformInstanceId: 'telegram-default' })
  setContextSettings({
    contextId: 'ctx-youtrack',
    taskInstanceId: 'youtrack-a',
    platformInstanceId: 'telegram-default',
  })
  setConfig('ctx-kaneo', 'kaneo_apikey', 'kn-key')
  setKaneoWorkspace('ctx-kaneo', 'workspace-1')
  setConfig('ctx-youtrack', 'youtrack_token', 'perm:abc')
  const router = new ChatRouter(() => createMockChat())
  router.addInstance('telegram-default', 'telegram', { token: 'x' })
  setRuntimeChatRouter(router)

  const kaneoProvider = defaultTaskProviderResolver.resolve('ctx-kaneo')
  const youtrackProvider = defaultTaskProviderResolver.resolve('ctx-youtrack')
  if (kaneoProvider === null || youtrackProvider === null) throw new Error('providers should resolve')

  const kaneoTools = makeTools(kaneoProvider, {
    storageContextId: 'ctx-kaneo',
    chatUserId: 'user-1',
    contextType: 'dm',
  })
  const youtrackTools = makeTools(youtrackProvider, {
    storageContextId: 'ctx-youtrack',
    chatUserId: 'user-1',
    contextType: 'dm',
  })

  expect(kaneoTools).not.toHaveProperty('plugin_provider_capability_plugin__echo_context')
  expect(youtrackTools).toHaveProperty('plugin_provider_capability_plugin__echo_context')
})
```

- [ ] **Step 2: Run integration test to verify it fails before Task 3 code is present**

Run: `bun test ./tests/plugins/integration.test.ts -t "resolved provider has required capabilities"`

Expected before Task 3 is implemented: FAIL because `getPluginContextEligibility()` does not apply `capability_missing`. Expected after Tasks 1-4: PASS.

- [ ] **Step 3: Verify no legacy provider builder exists**

Run: `rg "buildProviderForUser" src tests`

Expected: no matches.

- [ ] **Step 4: Run focused plugin integration tests**

Run: `bun test ./tests/plugins/integration.test.ts ./tests/tools/index.test.ts`

Expected: PASS.

- [ ] **Step 5: Run strict checks for touched files**

Run: `bun lint:agent-strict -- tests/plugins/integration.test.ts`

Expected: PASS with `0 errors`.

- [ ] **Step 6: Commit Task 5**

```bash
git add tests/plugins/integration.test.ts
git commit -m "test(plugins): cover context resolved provider eligibility"
```

## Task 6: Final Verification And Documentation Sync

**Files:**

- Verify: `docs/superpowers/specs/2026-04-13-multi-provider-phase-5-plugin-alignment.md`
- Verify: source and tests changed in Tasks 1-5

- [ ] **Step 1: Run focused Phase 5 tests**

Run:

```bash
bun test ./tests/plugins/registry.test.ts ./tests/providers/registry.test.ts ./tests/chat/router.test.ts ./tests/plugins/startup-compatibility.test.ts ./tests/index-startup.test.ts ./tests/plugins/contributions.test.ts ./tests/commands/plugin.test.ts ./tests/commands/config.test.ts ./tests/plugins/integration.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full backend verification**

Run:

```bash
bun lint
bun format:check
bun typecheck
bun knip
bun test
```

Expected: every command exits `0`; `bun test` reports `0 fail`.

- [ ] **Step 3: Run security scan**

Run: `bun security`

Expected: PASS with `0 findings`. A Semgrep `safe.directory` warning can appear in this worktree; it is non-blocking only when the scan summary still reports `0 findings`.

- [ ] **Step 4: Inspect git status and whitespace**

Run:

```bash
git status --short
git diff --check
git log --oneline -10
```

Expected: working tree is clean after commits; `git diff --check` prints no output; recent commits include one focused commit for each Phase 5 task.

- [ ] **Step 5: Re-read the aligned spec against implementation**

Open `docs/superpowers/specs/2026-04-13-multi-provider-phase-5-plugin-alignment.md` and verify these statements are true in code:

- `checkPluginCompatibility()` still has the same signature.
- `PluginRegistry.evaluateCompatibilityAcrossInstances()` exists and is used by startup.
- `PluginContextEligibility` includes `capability_missing` with `missingCapabilities`.
- `runPluginScheduledJob()` checks eligibility and calls the resolver guard only for task-provider plugins.
- Plugin tool runtime still receives `runtime.provider`; `buildPluginToolRuntimeContext()` is unchanged in shape.
- No migration or schema file was added for Phase 5.

Expected: no spec update needed after implementation. If implementation intentionally diverged, edit only the spec and commit it with `docs: align phase 5 plugin spec`.

## Self-Review

### Spec Coverage

- Startup compatibility across instances: Tasks 1 and 2 implement registry method, capability lookup, startup collector, and `src/index.ts` wiring.
- `checkPluginCompatibility` no signature change: Task 1 adds a wrapper method without changing `src/plugins/compatibility.ts`.
- Per-context `capability_missing`: Task 3 adds the union member, context assignment checks, command/config operator surfaces, and registry tests.
- Scheduled jobs: Task 4 adds eligibility and resolver guards while preserving `execute(contextId)`.
- Tool runtime plumbing: Task 5 proves plugin tools use the provider resolved for the active context and confirms no legacy builder remains.
- No DB schema changes: no task creates or modifies migrations or schema files.

### Placeholder Scan

- The placeholder scan found no open-ended implementation steps or missing code blocks.
- Every code-changing task includes concrete test code, implementation code, commands, expected outcomes, and a commit command.

### Type Consistency

- `PluginCompatibilityInstance`, `PluginContextEligibility`, `missingCapabilities`, `getCapabilitiesForTaskInstance`, `getPlatformInstanceCapabilities`, and `collectStartupCompatibilityInstances` are named consistently across tasks.
- Capability strings use existing `TaskCapability` and `ChatCapability` values from `src/providers/types.ts` and `src/chat/types.ts`.
- Context assignment uses existing Phase 4 `getContextSettings()` and `context_settings` terminology, not the stale `getContextAssignment()` name.
