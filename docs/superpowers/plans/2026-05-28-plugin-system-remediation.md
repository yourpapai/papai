<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plugin System Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the plugin-system lifecycle, eligibility, and documentation gaps found in the architecture review without changing the trusted repo-local plugin model.

**Architecture:** Keep provider registry concerns in `src/providers/registry.ts`, persisted instance lifecycle in a small plugin-side lifecycle helper, and per-context eligibility as the single gate for tools, prompts, commands, and jobs. Unknown or deactivated contributed task providers fail closed by returning unavailable state instead of throwing through conversations, and startup activates plugins before command registration so command contributions are visible.

**Tech Stack:** Bun, TypeScript strict mode, Drizzle/SQLite, Zod v4, `bun:test`, oxlint/oxfmt.

**Source Review:** Architectural report verified against current branch on 2026-05-28. Validated high-priority files include `src/providers/registry.ts`, `src/providers/resolver.ts`, `src/plugins/loader.ts`, `src/plugins/contributions.ts`, `src/plugins/command-contributions.ts`, `src/plugins/registry-context-eligibility.ts`, `src/plugins/context.ts`, `src/plugins/tool-runtime.ts`, `src/plugins/runtime-types.ts`, `src/index.ts`, and plugin docs.

---

## File Structure

| File                                                                                                   | Responsibility                                        | Change                                                                                                                          |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/providers/registry.ts`                                                                            | Provider descriptor and contributed provider registry | return removed contributed provider types, expose owner lookup for lifecycle helper, keep unknown descriptors non-instantiating |
| `src/providers/resolver.ts`                                                                            | Context task-provider resolution                      | catch unknown/failed provider creation and return `null` with a warning                                                         |
| `src/plugins/registry-context-eligibility.ts`                                                          | Per-context plugin eligibility                        | treat unknown task-provider type as `capability_missing` instead of throwing                                                    |
| `src/plugins/startup-compatibility.ts`                                                                 | Startup compatibility instance collection             | skip unknown task-provider capability sets instead of aborting all compatibility evaluation                                     |
| `src/plugins/task-provider-lifecycle.ts`                                                               | New contributed-provider persisted instance cleanup   | stop active task instances whose type belongs to a deactivated plugin                                                           |
| `src/plugins/loader.ts`                                                                                | Activation/deactivation cleanup                       | call lifecycle cleanup before unregistering provider factories                                                                  |
| `src/index.ts`                                                                                         | Startup ordering                                      | discover/evaluate/activate plugins before `setupBot()` and `chatProvider.start()`                                               |
| `src/plugins/command-contributions.ts`                                                                 | Plugin command registration                           | check active context eligibility at execution time and give deterministic denial text                                           |
| `src/plugins/eligibility-message.ts`                                                                   | New user-facing eligibility message helper            | centralize reason formatting for commands and future surfaces                                                                   |
| `src/plugins/store.ts`                                                                                 | Plugin enablement queries                             | add a helper that returns explicit enabled/disabled rows for a plugin                                                           |
| `src/instances/context-store.ts`                                                                       | Context-settings queries                              | add `listContextSettings()` for default-enabled scheduled jobs                                                                  |
| `src/plugins/contributions.ts`                                                                         | Scheduled-job context enumeration                     | include default-enabled configured contexts minus explicit opt-outs                                                             |
| `src/plugins/runtime-types.ts`                                                                         | Plugin tool runtime contract                          | add optional `identity` facade                                                                                                  |
| `src/plugins/tool-runtime.ts`                                                                          | Runtime context construction                          | attach identity facade for identity-capable provider plugins                                                                    |
| `src/plugins/prompt-contributions.ts`                                                                  | Prompt-fragment assembly                              | catch fragment function failures and skip only the bad fragment                                                                 |
| `src/plugins/provider-runtime.ts`                                                                      | Provider runtime host exposure                        | stop claiming `Object.freeze(new Set())` makes a set immutable; expose an array-backed readonly view or adjust comments         |
| `src/commands/plugin-auth.ts`                                                                          | Command authorization helper                          | become the shared target-context authorization surface                                                                          |
| `src/chat/plugin-interaction-handler.ts`                                                               | Plugin toggle interactions                            | use shared target-context authorization and block ghost disable rows                                                            |
| `src/chat/tool-toggle-interaction-handler.ts`                                                          | Tool toggle interactions                              | use shared target-context authorization                                                                                         |
| `src/plugins/registry.ts`                                                                              | Registry compatibility API                            | remove or deprecate single-instance `evaluateCompatibility()` after tests migrate to `evaluateCompatibilityAcrossInstances()`   |
| `CLAUDE.md`                                                                                            | Top-level plugin guidance                             | document current permissions and contributed task-provider surface                                                              |
| `docs/plugins/developer-guide.md`                                                                      | Plugin developer docs                                 | document provider task plugins, identity runtime, command/job eligibility, and current permissions                              |
| `tests/providers/resolver.test.ts`                                                                     | Resolver tests                                        | add unknown contributed-type graceful degradation                                                                               |
| `tests/plugins/registry-context-eligibility.test.ts`                                                   | Eligibility tests                                     | add unknown task-provider row behavior                                                                                          |
| `tests/plugins/startup-compatibility.test.ts`                                                          | Startup compatibility tests                           | add unknown task-provider skip behavior                                                                                         |
| `tests/plugins/loader.test.ts`                                                                         | Lifecycle tests                                       | add dependent task-instance stop behavior                                                                                       |
| `tests/plugins/contributions.test.ts`                                                                  | Command/job/prompt tests                              | add command eligibility, default-enabled jobs, prompt fragment failure tests                                                    |
| `tests/plugins/tool-runtime.test.ts`                                                                   | Runtime facade tests                                  | add identity facade availability/absence tests                                                                                  |
| `tests/chat/plugin-interaction-handler.test.ts`                                                        | Interaction tests                                     | add ghost-disable prevention and shared authorization behavior                                                                  |
| `tests/chat/tool-toggle-interaction-handler.test.ts`                                                   | Tool toggle tests                                     | update expected authorization behavior if needed                                                                                |
| `tests/plugins/registry.test.ts`, `tests/plugins/integration.test.ts`, `tests/commands/plugin.test.ts` | Compatibility API tests                               | replace `evaluateCompatibility()` calls with `evaluateCompatibilityAcrossInstances()`                                           |

---

## Task 1: Fail Closed For Unknown Task Provider Types

**Files:**

- Modify: `src/providers/resolver.ts:101-129`
- Modify: `src/plugins/registry-context-eligibility.ts:48-65`
- Modify: `src/plugins/startup-compatibility.ts:16-20`
- Test: `tests/providers/resolver.test.ts`
- Test: `tests/plugins/registry-context-eligibility.test.ts`
- Test: `tests/plugins/startup-compatibility.test.ts`

- [ ] **Step 1: Write failing resolver test**

Add this test to `tests/providers/resolver.test.ts` in the `TaskProviderResolver` suite. If the file uses local helpers, keep the existing setup helpers and only add the test body.

```typescript
test('returns null when assigned task instance type is not registered', () => {
  setContextSettings({
    contextId: 'ctx-plugin-gone',
    taskInstanceId: 'missing-provider',
    platformInstanceId: 'telegram-a',
  })
  insertTaskInstance({ id: 'missing-provider', type: 'ghost-provider', config: {}, status: 'active' })

  const resolver = new TaskProviderResolver()

  expect(resolver.resolve('ctx-plugin-gone')).toBeNull()
})
```

- [ ] **Step 2: Write failing eligibility test**

Add this test to `tests/plugins/registry-context-eligibility.test.ts` or `tests/plugins/registry.test.ts` next to existing capability tests.

```typescript
test('returns capability_missing instead of throwing when assigned task provider type is unknown', () => {
  const pluginId = 'unknown-provider-eligibility-plugin'
  const contextId = 'ctx-unknown-provider'
  const plugin = makePlugin({
    manifest: {
      ...makePlugin().manifest,
      id: pluginId,
      name: 'Unknown Provider Eligibility Plugin',
      defaultEnabled: true,
      requiredTaskCapabilities: ['workItems.list'],
    },
    manifestHash: 'hash-unknown-provider-eligibility',
  })
  insertTaskInstance({ id: 'ghost-task', type: 'ghost-provider', config: {}, status: 'active' })
  seedTestPlatformInstance({ id: 'telegram-a' })
  setContextSettings({ contextId, taskInstanceId: 'ghost-task', platformInstanceId: 'telegram-a' })

  pluginRegistry.registerDiscovered(plugin)
  pluginRegistry.approve(pluginId, 'admin', 'hash-unknown-provider-eligibility')
  pluginRegistry.markActive(pluginId)

  expect(getPluginContextEligibility(pluginId, contextId)).toEqual({
    eligible: false,
    reason: 'capability_missing',
    missingCapabilities: ['workItems.list'],
  })
})
```

- [ ] **Step 3: Write failing startup compatibility test**

Add this test to `tests/plugins/startup-compatibility.test.ts`.

```typescript
test('skips unknown task provider types while collecting startup compatibility', () => {
  const router = new ChatRouter(() => createMockChat())
  router.addInstance('telegram-a', 'telegram', { token: 'x' })

  const instances = collectStartupCompatibilityInstances(
    router,
    [
      { id: 'ghost-task', type: 'ghost-provider', config: {}, status: 'active', createdAt: new Date().toISOString() },
      { id: 'kaneo-a', type: 'kaneo', config: {}, status: 'active', createdAt: new Date().toISOString() },
    ],
    [{ id: 'telegram-a', type: 'telegram', config: {}, status: 'active', createdAt: new Date().toISOString() }],
  )

  expect(instances.length).toBeGreaterThan(0)
})
```

- [ ] **Step 4: Run failing tests**

Run: `bun test tests/providers/resolver.test.ts tests/plugins/registry-context-eligibility.test.ts tests/plugins/startup-compatibility.test.ts`

Expected: at least one test fails with `Unknown provider: ghost-provider` before implementation.

- [ ] **Step 5: Implement resolver fail-closed behavior**

In `src/providers/resolver.ts`, replace the tail of `resolve()` with this pattern:

```typescript
log.info({ contextId, taskInstanceId: instance.id, taskProvider: instance.type }, 'Task provider resolved')
try {
  return this.deps.createProvider(instance.type, config)
} catch (error) {
  log.warn(
    {
      contextId,
      taskInstanceId: instance.id,
      taskProvider: instance.type,
      error: error instanceof Error ? error.message : String(error),
    },
    'Cannot resolve task provider: provider creation failed',
  )
  return null
}
```

- [ ] **Step 6: Implement safe capability reads for eligibility**

In `src/plugins/registry-context-eligibility.ts`, add this helper near `emptyTaskCapabilities()`:

```typescript
const safeTaskCapabilities = (
  taskInstance: NonNullable<ReturnType<typeof getTaskInstance>>,
): ReadonlySet<TaskCapability> => {
  try {
    return getCapabilitiesForTaskInstance(taskInstance)
  } catch {
    return emptyTaskCapabilities()
  }
}
```

Then replace the `taskCapabilities` expression in `getMissingRequiredCapabilities()` with:

```typescript
const taskCapabilities =
  taskInstance === null || taskInstance.status !== 'active'
    ? emptyTaskCapabilities()
    : safeTaskCapabilities(taskInstance)
```

- [ ] **Step 7: Implement safe startup compatibility collection**

In `src/plugins/startup-compatibility.ts`, replace `activeTaskCapabilitySets()` with:

```typescript
const activeTaskCapabilitySets = (taskInstances: readonly TaskInstance[]): readonly ReadonlySet<TaskCapability>[] =>
  taskInstances.flatMap((instance) => {
    if (instance.status !== 'active') return []
    try {
      return [getCapabilitiesForTaskInstance(instance)]
    } catch {
      return []
    }
  })
```

- [ ] **Step 8: Run tests and commit**

Run: `bun test tests/providers/resolver.test.ts tests/plugins/registry-context-eligibility.test.ts tests/plugins/startup-compatibility.test.ts`

Expected: PASS.

Run: `bun typecheck`

Expected: PASS.

Commit:

```bash
git add src/providers/resolver.ts src/plugins/registry-context-eligibility.ts src/plugins/startup-compatibility.ts tests/providers/resolver.test.ts tests/plugins/registry-context-eligibility.test.ts tests/plugins/startup-compatibility.test.ts
git commit -m "fix(plugins): fail closed for unknown task providers"
```

---

## Task 2: Stop Persisted Task Instances For Deactivated Provider Plugins

**Files:**

- Modify: `src/providers/registry.ts:138-151`
- Create: `src/plugins/task-provider-lifecycle.ts`
- Modify: `src/plugins/loader.ts:97-103,132-149`
- Test: `tests/plugins/loader.test.ts`

- [ ] **Step 1: Write failing lifecycle test**

Add this test to `tests/plugins/loader.test.ts` after `removes contributed provider type on deactivation`.

```typescript
test('stops active task instances that depend on a deactivated contributed provider type', async () => {
  const entryPoint = writeTempPluginModule(`
    export default function createPlugin() {
      return {
        activate(ctx) {
          ctx.registration.registerTaskProviderType('demo-stop', { factory: () => ({}) })
        },
      }
    }
  `)
  const plugin = makePlugin('provider-stop-plugin', entryPoint, {
    permissions: ['provider.task'],
    contributes: {
      tools: [],
      promptFragments: [],
      commands: [],
      jobs: [],
      configKeys: [],
      taskProviderTypes: ['demo-stop'],
    },
  })
  approvePlugin(plugin)
  insertTaskInstance({ id: 'demo-stop-instance', type: 'demo-stop', config: {}, status: 'active' })

  await activatePlugins([plugin])
  await deactivateAllPlugins()

  expect(getTaskInstance('demo-stop-instance')?.status).toBe('stopped')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/loader.test.ts -t "stops active task instances"`

Expected: FAIL because the task instance remains `active`.

- [ ] **Step 3: Return removed contributed types from registry unregister**

In `src/providers/registry.ts`, replace `unregisterContributedTaskProviderType()` and add the owner lookup helper:

```typescript
export function listContributedTaskProviderTypesForPlugin(pluginId: string): string[] {
  return [...pluginContributedTaskProviderFactories.entries()]
    .filter(([, entry]) => entry.pluginId === pluginId)
    .map(([type]) => type)
}

/** Remove all contributed types owned by a plugin (deactivation / failure cleanup). */
export function unregisterContributedTaskProviderType(pluginId: string): string[] {
  const removedTypes: string[] = []
  for (const [type, entry] of pluginContributedTaskProviderFactories) {
    if (entry.pluginId === pluginId) {
      pluginContributedTaskProviderFactories.delete(type)
      removedTypes.push(type)
      log.debug({ type, pluginId }, 'Unregistered contributed task provider type')
    }
  }
  return removedTypes
}
```

- [ ] **Step 4: Create lifecycle helper**

Create `src/plugins/task-provider-lifecycle.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { listTaskInstances, updateTaskInstance } from '../instances/task-store.js'
import { logger } from '../logger.js'
import {
  listContributedTaskProviderTypesForPlugin,
  unregisterContributedTaskProviderType,
} from '../providers/registry.js'

const log = logger.child({ scope: 'plugins:task-provider-lifecycle' })

export type DeactivateContributedTaskProviderTypesDeps = Readonly<{
  listTypesForPlugin: typeof listContributedTaskProviderTypesForPlugin
  unregisterTypesForPlugin: typeof unregisterContributedTaskProviderType
  listTaskInstances: typeof listTaskInstances
  updateTaskInstance: typeof updateTaskInstance
}>

const defaultDeps: DeactivateContributedTaskProviderTypesDeps = {
  listTypesForPlugin: listContributedTaskProviderTypesForPlugin,
  unregisterTypesForPlugin: unregisterContributedTaskProviderType,
  listTaskInstances,
  updateTaskInstance,
}

export function deactivateContributedTaskProviderTypes(
  pluginId: string,
  deps: DeactivateContributedTaskProviderTypesDeps = defaultDeps,
): string[] {
  const providerTypes = deps.listTypesForPlugin(pluginId)
  if (providerTypes.length === 0) return []

  const providerTypeSet = new Set(providerTypes)
  const affectedInstances = deps
    .listTaskInstances()
    .filter((instance) => instance.status === 'active' && providerTypeSet.has(instance.type))

  for (const instance of affectedInstances) {
    deps.updateTaskInstance(instance.id, { config: undefined, status: 'stopped' })
  }

  const removedTypes = deps.unregisterTypesForPlugin(pluginId)
  log.warn(
    { pluginId, providerTypes: removedTypes, stoppedTaskInstanceIds: affectedInstances.map((instance) => instance.id) },
    'Deactivated contributed task provider types',
  )
  return removedTypes
}
```

- [ ] **Step 5: Use lifecycle helper in loader**

In `src/plugins/loader.ts`, replace the import of `unregisterContributedTaskProviderType` with:

```typescript
import { deactivateContributedTaskProviderTypes } from './task-provider-lifecycle.js'
```

Replace every `unregisterContributedTaskProviderType(manifest.id)` or `unregisterContributedTaskProviderType(pluginId)` call with the matching lifecycle call:

```typescript
deactivateContributedTaskProviderTypes(manifest.id)
```

and:

```typescript
deactivateContributedTaskProviderTypes(pluginId)
```

- [ ] **Step 6: Run tests and commit**

Run: `bun test tests/plugins/loader.test.ts tests/providers/registry.test.ts`

Expected: PASS.

Run: `bun typecheck`

Expected: PASS.

Commit:

```bash
git add src/providers/registry.ts src/plugins/task-provider-lifecycle.ts src/plugins/loader.ts tests/plugins/loader.test.ts
git commit -m "fix(plugins): stop orphaned contributed task instances"
```

---

## Task 3: Activate Plugins Before Command Registration And Gate Plugin Commands

**Files:**

- Modify: `src/index.ts:112-152`
- Create: `src/plugins/eligibility-message.ts`
- Modify: `src/plugins/command-contributions.ts:14-24`
- Test: `tests/plugins/contributions.test.ts`
- Test: `tests/bot.test.ts`

- [ ] **Step 1: Write failing command eligibility test**

Add this test to `tests/plugins/contributions.test.ts` next to `registers command contributions`.

```typescript
test('plugin command handler refuses execution when plugin is disabled for the context', async () => {
  let executed = false
  const textCalls: string[] = []
  const manifest = makeManifest({
    contributes: {
      tools: [],
      promptFragments: [],
      commands: ['sync'],
      jobs: [],
      configKeys: [],
      taskProviderTypes: [],
    },
  })
  markPluginActive(manifest)
  contributionRegistry.register(
    'test-plugin',
    {
      tools: [],
      promptFragments: [],
      commands: [
        {
          name: 'sync',
          description: 'Sync plugin data',
          execute: (): void => {
            executed = true
          },
        },
      ],
      jobs: [],
    },
    manifest,
  )
  setPluginEnabledForContext('test-plugin', 'user-1', false)
  const { provider, commandHandlers } = createMockChatWithCommandHandlers()

  registerPluginCommands(provider)
  await commandHandlers.get('plugin_test_plugin_sync')!(
    createDmMessage('user-1'),
    {
      text: (text) => {
        textCalls.push(text)
        return Promise.resolve()
      },
      formatted: () => Promise.resolve(),
      typing: () => {},
      buttons: () => Promise.resolve(),
    },
    createAuth('user-1'),
  )

  expect(executed).toBe(false)
  expect(textCalls[0]).toContain('disabled')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/contributions.test.ts -t "plugin command handler refuses"`

Expected: FAIL because `executed` is `true`.

- [ ] **Step 3: Add eligibility message helper**

Create `src/plugins/eligibility-message.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { PluginContextEligibility } from './registry.js'

export function formatPluginEligibilityMessage(pluginId: string, eligibility: PluginContextEligibility): string {
  if (eligibility.eligible) return `Plugin \`${pluginId}\` is available.`
  if (eligibility.reason === 'inactive') return `Plugin \`${pluginId}\` is not active.`
  if (eligibility.reason === 'disabled') return `Plugin \`${pluginId}\` is disabled for this context.`
  if (eligibility.reason === 'config_missing') {
    return `Plugin \`${pluginId}\` is missing required configuration: ${eligibility.missingKeys.join(', ')}.`
  }
  return `Plugin \`${pluginId}\` is missing required capabilities: ${eligibility.missingCapabilities.join(', ')}.`
}
```

- [ ] **Step 4: Gate plugin commands**

In `src/plugins/command-contributions.ts`, replace the file with:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatProvider, CommandHandler } from '../chat/types.js'
import { sanitizePluginId } from './contribution-names.js'
import { contributionRegistry } from './contributions.js'
import { formatPluginEligibilityMessage } from './eligibility-message.js'
import { getPluginContextEligibility } from './registry.js'

export function namespacedCommandName(pluginId: string, commandName: string): string {
  return `plugin_${sanitizePluginId(pluginId)}_${commandName}`
}

export function registerPluginCommands(chat: ChatProvider): void {
  contributionRegistry.getAllContributions().forEach((contributions) => {
    contributions.commands.forEach((command) => {
      const commandName = namespacedCommandName(contributions.pluginId, command.name)
      const handler: CommandHandler = async (message, reply, auth) => {
        const eligibility = getPluginContextEligibility(contributions.pluginId, auth.storageContextId)
        if (!eligibility.eligible) {
          await reply.text(formatPluginEligibilityMessage(contributions.pluginId, eligibility))
          return
        }
        await Promise.resolve(command.execute(message, reply, auth))
      }
      chat.registerCommand(commandName, handler)
    })
  })
}
```

- [ ] **Step 5: Move plugin activation before bot setup/start**

In `src/index.ts`, move the discovery/evaluation/activation block currently at lines 134-156 so it appears after `botDeps` is constructed and before `setupBot(chatProvider, adminUserId, botDeps)`.

The resulting order must be:

```typescript
const stagedDownloadFn = createStagedDownloadFn()
const botDeps: BotDeps = { processMessage, stagedDownloadFn }

// Discover and activate plugins before command registration so contributed commands are registered.
const pluginDir = 'plugins'
const { plugins: discoveredPlugins, errors: pluginErrors } = discoverPlugins(pluginDir)
if (pluginErrors.length > 0) {
  log.warn({ errors: pluginErrors.map((e) => e.reason) }, 'Some plugins failed discovery')
}
syncRegistryFromDb(discoveredPlugins)
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
const toActivate = pluginRegistry.getApprovedCompatiblePlugins()
await activatePlugins(toActivate)
log.info(
  { activeCount: getActivatedPluginIds().length, requestedCount: toActivate.length },
  'Plugin activation complete',
)

setupBot(chatProvider, adminUserId, botDeps)

await chatProvider.start()
```

Remove the old duplicate plugin activation block below `scheduler.startAll()`.

- [ ] **Step 6: Run tests and commit**

Run: `bun test tests/plugins/contributions.test.ts tests/bot.test.ts`

Expected: PASS.

Run: `bun typecheck`

Expected: PASS.

Commit:

```bash
git add src/index.ts src/plugins/eligibility-message.ts src/plugins/command-contributions.ts tests/plugins/contributions.test.ts
git commit -m "fix(plugins): gate and register plugin commands correctly"
```

---

## Task 4: Make Default-Enabled Scheduled Jobs Run For Configured Contexts

**Files:**

- Modify: `src/instances/context-store.ts:47-68`
- Modify: `src/plugins/store.ts:90-134`
- Modify: `src/plugins/contributions.ts:16-24,209-241`
- Test: `tests/plugins/contributions.test.ts`

- [ ] **Step 1: Write failing default-enabled job test**

Add this test to `tests/plugins/contributions.test.ts` after the explicit enabled-context job test.

```typescript
test('scheduled jobs run for configured contexts when plugin is default enabled', async () => {
  const seenContexts: string[] = []
  const manifest = makeManifest({
    defaultEnabled: true,
    contributes: {
      tools: [],
      promptFragments: [],
      commands: [],
      jobs: ['daily'],
      configKeys: [],
      taskProviderTypes: [],
    },
  })
  markPluginActive(manifest)
  seedTestPlatformInstance({ id: 'telegram-a' })
  seedTestTaskInstance({ id: 'task-a' })
  setContextSettings({ contextId: 'ctx-default-a', taskInstanceId: 'task-a', platformInstanceId: 'telegram-a' })
  setContextSettings({ contextId: 'ctx-default-b', taskInstanceId: 'task-a', platformInstanceId: 'telegram-a' })
  setPluginEnabledForContext('test-plugin', 'ctx-default-b', false)
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
            seenContexts.push(contextId)
          },
        },
      ],
    },
    manifest,
  )

  await runPluginScheduledJob('test-plugin', 'daily')

  expect(seenContexts).toEqual(['ctx-default-a'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugins/contributions.test.ts -t "default enabled"`

Expected: FAIL because no explicit enabled row exists for `ctx-default-a`.

- [ ] **Step 3: Add context listing helper**

In `src/instances/context-store.ts`, add after `getContextSettings()`:

```typescript
export const listContextSettings = (): ContextSettings[] => {
  const rows = getDrizzleDb().select().from(contextSettings).all()
  return rows.map((row) => rowToSettings(row))
}
```

- [ ] **Step 4: Add explicit plugin context state helper**

In `src/plugins/store.ts`, add after `getEnabledContextsForPlugin()`:

```typescript
export function getContextStatesForPlugin(pluginId: string): Array<{ contextId: string; enabled: boolean }> {
  const db = getDrizzleDb()
  return db
    .select({ contextId: pluginContextState.contextId, enabled: pluginContextState.enabled })
    .from(pluginContextState)
    .where(eq(pluginContextState.pluginId, pluginId))
    .all()
}
```

- [ ] **Step 5: Enumerate runnable contexts consistently**

In `src/plugins/contributions.ts`, update imports:

```typescript
import { listContextSettings } from '../instances/context-store.js'
import { getContextStatesForPlugin } from './store.js'
```

Replace the `getEnabledContextsForPlugin` import with `getContextStatesForPlugin`.

Add this helper above `runPluginScheduledJob()`:

```typescript
const getScheduledJobContextIds = (pluginId: string, manifest: PluginManifest): string[] => {
  const explicitStates = getContextStatesForPlugin(pluginId)
  if (!manifest.defaultEnabled) {
    return explicitStates.filter((row) => row.enabled).map((row) => row.contextId)
  }

  const explicitDisabled = new Set(explicitStates.filter((row) => !row.enabled).map((row) => row.contextId))
  const explicitEnabled = explicitStates.filter((row) => row.enabled).map((row) => row.contextId)
  const configuredDefaults = listContextSettings()
    .map((settings) => settings.contextId)
    .filter((contextId) => !explicitDisabled.has(contextId))

  return [...new Set([...configuredDefaults, ...explicitEnabled])]
}
```

Then replace:

```typescript
  await getEnabledContextsForPlugin(pluginId).reduce(async (chain, contextId) => {
```

with:

```typescript
  await getScheduledJobContextIds(pluginId, contributions.manifest).reduce(async (chain, contextId) => {
```

- [ ] **Step 6: Run tests and commit**

Run: `bun test tests/plugins/contributions.test.ts tests/plugins/registry.test.ts`

Expected: PASS.

Run: `bun typecheck`

Expected: PASS.

Commit:

```bash
git add src/instances/context-store.ts src/plugins/store.ts src/plugins/contributions.ts tests/plugins/contributions.test.ts
git commit -m "fix(plugins): honor default enabled scheduled jobs"
```

---

## Task 5: Expose Identity Facade At Plugin Tool Runtime

**Files:**

- Modify: `src/plugins/runtime-types.ts:18-27`
- Modify: `src/plugins/tool-runtime.ts:1-113`
- Test: `tests/plugins/tool-runtime.test.ts`
- Docs: `docs/plugins/developer-guide.md`

- [ ] **Step 1: Write failing runtime identity test**

Add this test to `tests/plugins/tool-runtime.test.ts`.

```typescript
test('tool runtime exposes identity facade for identity provider plugins', () => {
  const runtime = buildPluginToolRuntimeContext(
    'identity-plugin',
    {
      ...makeManifest(),
      permissions: ['identity'],
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: ['identity-provider'],
      },
    },
    { provider: createMockProvider(), storageContextId: 'ctx-1', chatUserId: 'chat-user-1' },
  )

  expect(runtime.identity).toBeDefined()
  expect(runtime.identity?.lookupForChatUser('chat-user-1')).toBeNull()
})
```

Add the negative test:

```typescript
test('tool runtime omits identity facade when plugin lacks identity permission', () => {
  const runtime = buildPluginToolRuntimeContext(
    'no-identity-plugin',
    {
      ...makeManifest(),
      permissions: [],
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: ['identity-provider'],
      },
    },
    { provider: createMockProvider(), storageContextId: 'ctx-1', chatUserId: 'chat-user-1' },
  )

  expect(runtime.identity).toBeUndefined()
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `bun test tests/plugins/tool-runtime.test.ts -t "identity facade"`

Expected: FAIL because `runtime.identity` is not part of the runtime context.

- [ ] **Step 3: Update runtime type**

In `src/plugins/runtime-types.ts`, import the facade type and add optional identity:

```typescript
import type { PluginIdentityFacade } from './identity-facade.js'
```

Update `PluginToolRuntimeContext`:

```typescript
export type PluginToolRuntimeContext = {
  pluginId: string
  storageContextId: string
  chatUserId: string
  taskProvider: PluginTaskProviderFacade
  kv: PluginContext['kv']
  identity?: PluginIdentityFacade
  rateLimit: {
    check(actorId: string): { allowed: boolean; retryAfterSec?: number }
  }
}
```

- [ ] **Step 4: Build identity facade in tool runtime**

In `src/plugins/tool-runtime.ts`, import `buildIdentityFacade`:

```typescript
import { buildIdentityFacade } from './identity-facade.js'
```

Add this helper above `buildPluginToolRuntimeContext()`:

```typescript
const buildRuntimeIdentity = (manifest: PluginManifest): PluginToolRuntimeContext['identity'] => {
  const [providerType] = manifest.contributes.taskProviderTypes
  if (!manifest.permissions.includes('identity')) return undefined
  if (manifest.contributes.taskProviderTypes.length !== 1 || providerType === undefined) return undefined
  return buildIdentityFacade(providerType)
}
```

Add `identity` to the returned object:

```typescript
    identity: buildRuntimeIdentity(manifest),
```

- [ ] **Step 5: Document runtime identity**

In `docs/plugins/developer-guide.md`, add to the tool runtime section:

```markdown
When a plugin declares `permissions: ["identity"]` and exactly one `contributes.taskProviderTypes` value, tool executions receive `runtimeContext.identity`. The facade supports `lookupForChatUser(chatUserId)` and `recordClaim(chatUserId, providerUserId, providerLogin, displayName?)`. Claims are recorded as `manual_nl` mappings and are not treated as auto-verified.
```

- [ ] **Step 6: Run tests and commit**

Run: `bun test tests/plugins/tool-runtime.test.ts tests/plugins/context.test.ts`

Expected: PASS.

Run: `bun typecheck`

Expected: PASS.

Commit:

```bash
git add src/plugins/runtime-types.ts src/plugins/tool-runtime.ts tests/plugins/tool-runtime.test.ts docs/plugins/developer-guide.md
git commit -m "feat(plugins): expose identity facade to tools"
```

---

## Task 6: Share Target-Context Authorization And Prevent Ghost Plugin Rows

**Files:**

- Modify: `src/commands/plugin-auth.ts:1-50`
- Modify: `src/chat/plugin-interaction-handler.ts:25-76`
- Modify: `src/chat/tool-toggle-interaction-handler.ts:39-43`
- Test: `tests/chat/plugin-interaction-handler.test.ts`
- Test: `tests/chat/tool-toggle-interaction-handler.test.ts`
- Test: `tests/commands/plugin.test.ts`

- [ ] **Step 1: Write failing ghost-disable interaction test**

Add this test to `tests/chat/plugin-interaction-handler.test.ts`.

```typescript
test('disable interaction refuses unknown plugin instead of writing a ghost row', async () => {
  const { reply, textCalls } = createMockReply()
  await handlePluginInteraction(
    {
      ...createDmInteraction(
        'admin-user',
        `plg:disable:no-such-plugin:${Buffer.from('admin-user').toString('base64url')}`,
      ),
      storageContextId: 'admin-user',
    },
    reply,
  )

  expect(textCalls[0]).toContain('not available')
  expect(getPluginContextState('no-such-plugin', 'admin-user')).toBeUndefined()
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun test tests/chat/plugin-interaction-handler.test.ts -t "ghost row"`

Expected: FAIL because a disabled row is written for `no-such-plugin`.

- [ ] **Step 3: Extend shared authorization helper**

In `src/commands/plugin-auth.ts`, add imports:

```typescript
import { listManageableGroups } from '../group-settings/access.js'
import type { IncomingInteraction } from '../chat/types.js'
```

Add this exported helper:

```typescript
export const canManageInteractionTargetContext = (
  interaction: IncomingInteraction,
  targetContextId: string,
): TargetContextAuthorization => {
  if (interaction.contextType !== 'dm') {
    return targetContextId === interaction.storageContextId
      ? { allowed: true }
      : { allowed: false, reason: 'not_authorized' }
  }
  if (targetContextId === interaction.user.id) return { allowed: true }
  const manageable = listManageableGroups(interaction.user.id).some((group) => group.contextId === targetContextId)
  return manageable ? { allowed: true } : { allowed: false, reason: 'not_authorized' }
}
```

- [ ] **Step 4: Use shared helper in plugin interaction handler**

In `src/chat/plugin-interaction-handler.ts`, remove the local `canManageTargetContext()` function and its `listManageableGroups` import. Import shared helpers:

```typescript
import { canManageInteractionTargetContext } from '../commands/plugin-auth.js'
```

Replace the authorization block with:

```typescript
const authorization = canManageInteractionTargetContext(interaction, contextId)
if (!authorization.allowed) {
  await replyTextPreferReplace(reply, getMissingGroupTargetMessage(interaction.user.id, contextId))
  return true
}
```

In `handleDisablePlugin()`, add an availability guard before writing state:

```typescript
const entry = pluginRegistry.getEntry(pluginId)
if (entry === undefined || entry.state !== 'active') {
  await replyTextPreferReplace(reply, `Plugin \`${pluginId}\` is not available.`)
  return
}
```

- [ ] **Step 5: Use shared helper in tool toggle handler**

In `src/chat/tool-toggle-interaction-handler.ts`, remove the local `canManageTargetContext()` function and import:

```typescript
import { canManageInteractionTargetContext } from '../commands/plugin-auth.js'
```

Replace calls with:

```typescript
const authorization = canManageInteractionTargetContext(interaction, contextId)
if (!authorization.allowed) {
  await replyTextPreferReplace(reply, getMissingGroupTargetMessage(interaction.user.id, contextId))
  return true
}
```

- [ ] **Step 6: Run tests and commit**

Run: `bun test tests/chat/plugin-interaction-handler.test.ts tests/chat/tool-toggle-interaction-handler.test.ts tests/commands/plugin.test.ts`

Expected: PASS.

Run: `bun typecheck`

Expected: PASS.

Commit:

```bash
git add src/commands/plugin-auth.ts src/chat/plugin-interaction-handler.ts src/chat/tool-toggle-interaction-handler.ts tests/chat/plugin-interaction-handler.test.ts tests/chat/tool-toggle-interaction-handler.test.ts tests/commands/plugin.test.ts
git commit -m "fix(plugins): share target authorization"
```

---

## Task 7: Isolate Prompt Fragment Failures And Correct Provider Runtime Host Immutability Claim

**Files:**

- Modify: `src/plugins/prompt-contributions.ts:21-50`
- Modify: `src/plugins/provider-runtime.ts:120-129`
- Test: `tests/plugins/contributions.test.ts`
- Test: `tests/plugins/provider-runtime.test.ts`

- [ ] **Step 1: Write failing prompt fragment failure test**

Add this test to `tests/plugins/contributions.test.ts` in the prompt contribution section.

```typescript
test('prompt section skips throwing fragment and keeps later fragments', () => {
  const manifest = makeManifest({
    contributes: {
      tools: [],
      promptFragments: ['bad', 'good'],
      commands: [],
      jobs: [],
      configKeys: [],
      taskProviderTypes: [],
    },
  })
  contributionRegistry.register(
    'test-plugin',
    {
      tools: [],
      promptFragments: [
        {
          name: 'bad',
          content: (): string => {
            throw new Error('fragment boom')
          },
        },
        { name: 'good', content: 'SAFE_FRAGMENT' },
      ],
      commands: [],
      jobs: [],
    },
    manifest,
  )

  expect(buildPluginPromptSection(['test-plugin'])).toContain('SAFE_FRAGMENT')
})
```

- [ ] **Step 2: Write provider runtime exposed-host mutation test**

Add this test to `tests/plugins/provider-runtime.test.ts`.

```typescript
test('mutating exposed allowedHosts does not affect httpFetch enforcement', async () => {
  const runtime = buildProviderRuntime(['allowed.example'], createTestPluginLogger(), {
    fetch: () => Promise.resolve(new Response('ok')),
    assertPublicUrl: () => Promise.resolve(),
  })
  ;(runtime.allowedHosts as Set<string>).add('evil.example')

  await expect(runtime.httpFetch('https://evil.example/data')).rejects.toThrow('Host evil.example is not allowed')
})
```

- [ ] **Step 3: Run tests to verify prompt failure**

Run: `bun test tests/plugins/contributions.test.ts -t "throwing fragment"`

Expected: FAIL because `buildPluginPromptSection()` throws.

- [ ] **Step 4: Catch prompt fragment errors**

In `src/plugins/prompt-contributions.ts`, replace the raw content line with a try/catch block:

```typescript
let rawContent: string
try {
  rawContent = typeof fragment.content === 'function' ? fragment.content() : fragment.content
} catch (error) {
  log.warn(
    { pluginId, fragmentName: fragment.name, error: error instanceof Error ? error.message : String(error) },
    'Plugin prompt fragment threw — skipping',
  )
  continue
}
```

- [ ] **Step 5: Correct provider runtime host exposure comment**

In `src/plugins/provider-runtime.ts`, replace lines 120-126 with:

```typescript
// Private enforcement set. Never exposed directly; httpFetch closes over this
// copy, so mutations to the exposed Set cannot affect enforcement.
const hostSet: ReadonlySet<string> = new Set(allowedHosts.map((h) => h.toLowerCase()))

// This is a diagnostic copy, not a security boundary. Object.freeze() does not
// make Set entries immutable; security comes from the private hostSet above.
const exposedHosts: ReadonlySet<string> = Object.freeze(new Set(hostSet))
```

- [ ] **Step 6: Run tests and commit**

Run: `bun test tests/plugins/contributions.test.ts tests/plugins/provider-runtime.test.ts`

Expected: PASS.

Run: `bun typecheck`

Expected: PASS.

Commit:

```bash
git add src/plugins/prompt-contributions.ts src/plugins/provider-runtime.ts tests/plugins/contributions.test.ts tests/plugins/provider-runtime.test.ts
git commit -m "fix(plugins): isolate prompt fragment failures"
```

---

## Task 8: Remove Stale Compatibility API And Update Plugin Docs

**Files:**

- Modify: `src/plugins/registry.ts:154-168`
- Modify: `tests/plugins/registry.test.ts`
- Modify: `tests/plugins/integration.test.ts`
- Modify: `tests/commands/plugin.test.ts`
- Modify: `CLAUDE.md:316-336`
- Modify: `docs/plugins/developer-guide.md:56-159`

- [ ] **Step 1: Replace single-instance compatibility calls in tests**

In tests, replace calls like:

```typescript
pluginRegistry.evaluateCompatibility(plugin.manifest.id, provider.capabilities, new Set())
```

with:

```typescript
pluginRegistry.evaluateCompatibilityAcrossInstances([
  { taskCapabilities: provider.capabilities, chatCapabilities: new Set() },
])
```

For tests using `new Set(['tasks.delete'])`, use:

```typescript
registry.evaluateCompatibilityAcrossInstances([
  { taskCapabilities: new Set(['tasks.delete']), chatCapabilities: new Set() },
])
```

For tests expecting incompatibility, use:

```typescript
registry.evaluateCompatibilityAcrossInstances([{ taskCapabilities: new Set(), chatCapabilities: new Set() }])
```

- [ ] **Step 2: Run tests before removing API**

Run: `bun test tests/plugins/registry.test.ts tests/plugins/integration.test.ts tests/commands/plugin.test.ts`

Expected: PASS after test migration.

- [ ] **Step 3: Remove `evaluateCompatibility()`**

In `src/plugins/registry.ts`, delete the method:

```typescript
  evaluateCompatibility(
    pluginId: string,
    taskCapabilities: ReadonlySet<TaskCapability>,
    chatCapabilities: ReadonlySet<ChatCapability>,
  ): void {
    const entry = this.entries.get(pluginId)
    if (entry === undefined || entry.state !== 'approved') return

    const result = checkPluginCompatibility(entry.discoveredPlugin.manifest, taskCapabilities, chatCapabilities)
    if (!result.compatible) {
      entry.state = 'incompatible'
      entry.compatibilityReason = result.reason
      log.warn({ pluginId, reason: result.reason }, 'Plugin marked incompatible')
    }
  }
```

Remove now-unused type imports from the top of `src/plugins/registry.ts`:

```typescript
import type { ChatCapability } from '../chat/types.js'
import type { TaskCapability } from '../providers/types.js'
```

- [ ] **Step 4: Update top-level plugin docs**

In `CLAUDE.md`, replace the plugin context facade and permissions bullets around lines 316-336 with:

```markdown
Activation receives a frozen `PluginContext` exposing only:

- `ctx.pluginId`, `ctx.contextId` (activation runs against `__system__`), `ctx.permissions`
- `ctx.log.{debug,info,warn,error}(data, msg)` — pino child logger scoped by `pluginId`. Never log secrets.
- `ctx.kv.{get,set,delete,list}` — context-scoped string KV, only when the `storage` permission is declared. Without it, all KV calls throw. KV is not a secret store.
- `ctx.adminConfig.get(key)` — read-only admin-scoped plugin config declared in `configRequirements`.
- `ctx.providerRuntime` — HTTP helper for provider plugins when `provider.task` or `http` is declared; every hop must match `providerAllowedHosts` and pass public URL checks.
- `ctx.identity` — available when `identity` is declared and the plugin declares exactly one task provider type.
- `ctx.registration.{registerTool,registerPromptFragment,registerCommand,registerScheduledJob,registerTaskProviderType}` — registrations are rejected unless declared in `contributes.{tools,promptFragments,commands,jobs,taskProviderTypes}`.

Plugins never receive a raw `TaskProvider`, `ChatProvider`, DB handle, or `process.env`. Tool executions receive a request-scoped `PluginToolRuntimeContext` with `pluginId`, `storageContextId`, `chatUserId`, a permission-gated task-provider facade, optional `identity`, rate-limit helper, and plugin/context KV.

### Permissions (MVP)

`storage`, `scheduler`, `commands`, `chat.send`, `tasks.read`, `tasks.write`, `provider.task`, `identity`, and `http`. Runtime gating exists for storage, task reads/writes, provider HTTP runtime, contributed task-provider registration, and identity facade exposure. Raw chat sending, raw provider access, raw DB access, and arbitrary unallowlisted network access are not exposed.
```

- [ ] **Step 5: Update developer guide manifest and permissions docs**

In `docs/plugins/developer-guide.md`, update the manifest field table to include:

```markdown
| `contributes.taskProviderTypes` | At most one plugin-owned task provider type. Requires `provider.task`. |
| `providerCapabilities` | Task capabilities exposed by the contributed provider type. |
| `providerConfigSchema` | Instance-scoped config fields for the contributed provider type. |
| `providerContextConfigSchema` | Context-scoped credential/config fields for the contributed provider type. |
| `providerAllowedHosts` | Host allowlist used by `ctx.providerRuntime.httpFetch()`. |
```

Replace the permissions table with:

```markdown
| Permission      | Effect                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------- |
| `storage`       | Enables plugin KV access. Without it, KV calls fail closed.                              |
| `tasks.read`    | Enables read methods on the task-provider facade.                                        |
| `tasks.write`   | Enables write methods on the task-provider facade.                                       |
| `provider.task` | Allows registering one declared task-provider type and exposes provider runtime helpers. |
| `identity`      | Exposes identity facade when exactly one task-provider type is declared.                 |
| `http`          | Exposes provider runtime HTTP helper without requiring a contributed task provider.      |
| `commands`      | Reserved declaration for command-capable plugins; registration is still manifest-gated.  |
| `scheduler`     | Reserved declaration for scheduled-job plugins; registration is still manifest-gated.    |
| `chat.send`     | Declared in the permission list but no raw chat-send facade is exposed in the MVP.       |
```

Add this paragraph to the commands section:

```markdown
Plugin command handlers run only when the plugin is active and eligible for the current command context. Disabled plugins, missing config, or missing capabilities produce a denial message and the plugin handler is not invoked.
```

- [ ] **Step 6: Run tests and docs checks**

Run: `bun test tests/plugins/registry.test.ts tests/plugins/integration.test.ts tests/commands/plugin.test.ts`

Expected: PASS.

Run: `bun knip`

Expected: PASS or no newly introduced unused exports.

Run: `bun typecheck`

Expected: PASS.

Commit:

```bash
git add src/plugins/registry.ts tests/plugins/registry.test.ts tests/plugins/integration.test.ts tests/commands/plugin.test.ts CLAUDE.md docs/plugins/developer-guide.md
git commit -m "chore(plugins): remove stale compatibility API"
```

---

## Final Verification

- [ ] Run targeted plugin suites:

```bash
bun test tests/plugins
```

Expected: PASS.

- [ ] Run command/chat/provider targeted suites touched by this plan:

```bash
bun test tests/providers/resolver.test.ts tests/chat/plugin-interaction-handler.test.ts tests/chat/tool-toggle-interaction-handler.test.ts tests/commands/plugin.test.ts tests/bot.test.ts
```

Expected: PASS.

- [ ] Run typecheck and lint:

```bash
bun typecheck
bun lint
```

Expected: PASS.

- [ ] Run formatting check:

```bash
bun format:check
```

Expected: PASS.

- [ ] Run broader release gate if time allows:

```bash
bun check:full
```

Expected: PASS. If it fails outside touched files, record the unrelated failure and run the targeted passing commands above before handoff.

---

## Self-Review Notes

- Spec coverage: provider lifecycle, resolver degradation, command eligibility, default-enabled jobs, identity runtime access, shared authorization, prompt-fragment failure isolation, provider-runtime Set comment, stale compatibility API, and docs drift are each mapped to a task.
- Placeholder scan: no deferred implementation placeholders remain; each task contains exact files, tests, implementation snippets, commands, and expected outcomes.
- Type consistency: new helpers use existing repo types (`TaskInstance`, `PluginManifest`, `PluginContextEligibility`, `PluginIdentityFacade`, `ContextSettings`) and preserve `.js` import paths.
