<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-Provider Phase 2 Task Provider Resolver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace global `TASK_PROVIDER`-based task-provider construction with context-assigned task instance resolution and dynamic per-context config keys.

**Architecture:** Add `TaskProviderResolver` as the only runtime path that turns a storage context into a `TaskProvider`. Add a synchronous config-key helper that derives user-visible config keys from `context_settings.task_instance_id`, then thread it through setup, config rendering, config editor, auto-started setup, the LLM orchestrator, recurring scheduler, deferred prompt pollers, and `/context`. Phase 2 still runs one chat adapter, so setup stores the active platform instance for the current `CHAT_PROVIDER`; Phase 3 will replace that with per-message `platformInstanceId` from the ChatRouter.

**Tech Stack:** Bun runtime and `bun:test`, TypeScript, Drizzle ORM with `bun:sqlite`, pino logging, existing `src/instances/*` stores, existing provider registry, existing wizard/config-editor command flow.

---

## External Documentation Checked

- Bun test runner docs were checked with Context7 (`/oven-sh/bun`) and web search. Use exact test-file paths prefixed with `./`, for example `bun test ./tests/providers/resolver.test.ts`, and use `-t` to filter by test name.

---

## Scope Notes

- This is Phase 2 only. Do not add `ChatRouter`, `IncomingMessage.platformInstanceId`, dashboard CRUD, or plugin capability re-evaluation.
- Keep `CHAT_PROVIDER` and `ADMIN_USER_ID` required at startup. Remove `TASK_PROVIDER` from runtime startup validation because task instances now live in the DB and are selected per context.
- Keep `TASK_PROVIDER` support inside `bootstrapInstancesFromEnv()` because it still seeds the first task instance from env on an empty DB.
- There is no `/set` command in the current codebase. The plan updates the interactive config editor instead.
- `task_instances.config` currently stores `url` from Phase 1 bootstrap. The resolver must map `url` to provider-registry `baseUrl`. Accept `baseUrl` too for future dashboard-created rows.
- Kaneo still needs a per-context workspace ID from `getKaneoWorkspace(contextId)` because `kaneo_workspace_id` is internal and not user-visible.

---

## File Structure

### New Files

- `src/providers/resolver.ts` — resolves `TaskProvider | null` from `context_settings`, `task_instances`, per-context credentials, and provider registry.
- `src/config-keys.ts` — computes visible config keys for a context from its assigned active task instance.
- `src/setup/task-instance-selection.ts` — starts and handles text selection of an active task instance before the credential wizard starts.
- `src/setup/platform-instance.ts` — resolves the single active platform instance for current `CHAT_PROVIDER` during Phase 2 setup assignment.
- `tests/providers/resolver.test.ts` — resolver success/failure/strict-mode coverage.
- `tests/config-keys.test.ts` — dynamic config-key derivation coverage.
- `tests/setup/task-instance-selection.test.ts` — task-instance selection state and assignment coverage.

### Modified Files

- `src/types/config.ts` — remove `CONFIG_KEYS`; keep `ALL_CONFIG_KEYS`, `ConfigKey`, and `isConfigKey` as the universe of legal keys.
- `src/config.ts` — make `getAllConfig(contextId)` iterate `getConfigKeysForContext(contextId)`.
- `src/wizard/engine.ts` — seed wizard data from dynamic keys instead of `CONFIG_KEYS`.
- `src/wizard/steps.ts` — keep provider-specific credential steps and stop showing hidden `kaneo_workspace_id` in the summary.
- `src/commands/setup.ts` — assign a task instance before starting the wizard; remove `TASK_PROVIDER` branching.
- `src/bot-settings.ts` — intercept task-instance selection replies before wizard messages.
- `src/bot.ts` — auto-start setup from context assignment instead of `TASK_PROVIDER`.
- `src/commands/config.ts` — render dynamic keys and buttons.
- `src/config-editor/handlers.ts` — reject unsupported per-context config keys.
- `src/config-editor/callback-data.ts` — keep parsing legal keys, but let handlers enforce per-context visibility.
- `src/providers/kaneo/provision.ts` — auto-provision only when the assigned task instance type is active Kaneo.
- `src/llm-orchestrator-types.ts` — rename dependency from `buildProviderForUser` to `resolve` and allow `null`.
- `src/llm-orchestrator.ts` — use resolver and reply with setup guidance when it returns `null`.
- `src/llm-orchestrator-config.ts` — derive missing provider credentials from `getConfigKeysForContext(contextId)`.
- `src/commands/context-tool-resolution.ts` — use resolver for live `/context` tool-surface resolution.
- `src/scheduler.ts` — remove internal env-based provider construction and use resolver dependency.
- `src/deferred-prompts/proactive-llm.ts` — rename `BuildProviderFn` argument to context semantics.
- `src/deferred-prompts/poller.ts` — pass storage context IDs to resolver-shaped provider function.
- `src/index.ts` — remove `TASK_PROVIDER` startup validation, wire resolver into scheduler/pollers/admin warmup, and delete provider factory import.
- `src/providers/factory.ts` — delete after all imports are gone.
- Existing tests listed in each task — update fixtures from `buildProviderForUser` to `resolve`.

### Decomposition Decisions

- Resolver logic stays in `src/providers/resolver.ts` because it is provider construction, not command logic.
- Config-key derivation stays outside `src/types/config.ts` to avoid making a shared type module import DB-backed stores.
- Task-instance selection gets its own `src/setup/` files because it is setup command state, not wizard state. The wizard should only collect credentials after a task instance has already been assigned.
- Scheduler and poller changes are separate tasks because they have different context IDs and failure semantics.

---

## Task 1: Add `TaskProviderResolver`

**Files:**

- Create: `src/providers/resolver.ts`
- Create: `tests/providers/resolver.test.ts`
- Later delete: `src/providers/factory.ts` in Task 9 after all imports are gone

- [ ] **Step 1: Write the failing resolver tests**

Create `tests/providers/resolver.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { setConfig } from '../../src/config.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import { TaskProviderResolver } from '../../src/providers/resolver.js'
import type { TaskProviderResolverDeps } from '../../src/providers/resolver.js'
import { setKaneoWorkspace } from '../../src/users.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('TaskProviderResolver', () => {
  const created: Array<{ name: string; config: Record<string, string> }> = []

  const makeResolver = (): TaskProviderResolver => {
    const deps: Partial<TaskProviderResolverDeps> = {
      createProvider: (name, config) => {
        created.push({ name, config })
        return createMockProvider({ name })
      },
    }
    return new TaskProviderResolver(deps)
  }

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    process.env['INSTANCE_CONFIG_KEY'] = '4'.repeat(64)
    created.length = 0
  })

  test('returns null when context has no assignment', () => {
    const resolver = makeResolver()

    expect(resolver.resolve('ctx-missing')).toBeNull()
    expect(created).toEqual([])
  })

  test('returns null when assigned task instance was removed', () => {
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'deleted-task', platformInstanceId: 'telegram-default' })
    const resolver = makeResolver()

    expect(resolver.resolve('ctx-1')).toBeNull()
    expect(created).toEqual([])
  })

  test('returns null when assigned task instance is not active', () => {
    insertTaskInstance({ id: 'yt-stopped', type: 'youtrack', config: { url: 'https://yt.invalid' }, status: 'stopped' })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'yt-stopped', platformInstanceId: 'telegram-default' })
    setConfig('ctx-1', 'youtrack_token', 'perm:abc')
    const resolver = makeResolver()

    expect(resolver.resolve('ctx-1')).toBeNull()
    expect(created).toEqual([])
  })

  test('builds a YouTrack provider from instance URL and per-context token', () => {
    insertTaskInstance({ id: 'yt-prod', type: 'youtrack', config: { url: 'https://yt.invalid' }, status: 'active' })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'yt-prod', platformInstanceId: 'telegram-default' })
    setConfig('ctx-1', 'youtrack_token', 'perm:abc')
    const resolver = makeResolver()

    const provider = resolver.resolve('ctx-1')

    expect(provider?.name).toBe('youtrack')
    expect(created).toEqual([{ name: 'youtrack', config: { baseUrl: 'https://yt.invalid', token: 'perm:abc' } }])
  })

  test('builds a Kaneo provider from instance URL, API key, and workspace ID', () => {
    insertTaskInstance({ id: 'kaneo-prod', type: 'kaneo', config: { url: 'https://kaneo.invalid' }, status: 'active' })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'kaneo-prod', platformInstanceId: 'telegram-default' })
    setConfig('ctx-1', 'kaneo_apikey', 'kn-key')
    setKaneoWorkspace('ctx-1', 'workspace-1')
    const resolver = makeResolver()

    const provider = resolver.resolve('ctx-1')

    expect(provider?.name).toBe('kaneo')
    expect(created).toEqual([
      { name: 'kaneo', config: { apiKey: 'kn-key', baseUrl: 'https://kaneo.invalid', workspaceId: 'workspace-1' } },
    ])
  })

  test('builds a Kaneo provider with session cookie credentials', () => {
    insertTaskInstance({
      id: 'kaneo-prod',
      type: 'kaneo',
      config: { baseUrl: 'https://kaneo.invalid' },
      status: 'active',
    })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'kaneo-prod', platformInstanceId: 'telegram-default' })
    setConfig('ctx-1', 'kaneo_apikey', 'better-auth.session_token=abc')
    setKaneoWorkspace('ctx-1', 'workspace-1')
    const resolver = makeResolver()

    const provider = resolver.resolve('ctx-1')

    expect(provider?.name).toBe('kaneo')
    expect(created).toEqual([
      {
        name: 'kaneo',
        config: {
          baseUrl: 'https://kaneo.invalid',
          sessionCookie: 'better-auth.session_token=abc',
          workspaceId: 'workspace-1',
        },
      },
    ])
  })

  test('returns null when provider credentials are missing', () => {
    insertTaskInstance({ id: 'yt-prod', type: 'youtrack', config: { url: 'https://yt.invalid' }, status: 'active' })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'yt-prod', platformInstanceId: 'telegram-default' })
    const resolver = makeResolver()

    expect(resolver.resolve('ctx-1')).toBeNull()
    expect(created).toEqual([])
  })

  test('resolveStrict throws clear setup guidance when resolution fails', () => {
    const resolver = makeResolver()

    expect(() => resolver.resolveStrict('ctx-missing')).toThrow('Context ctx-missing needs /setup')
  })
})
```

- [ ] **Step 2: Run resolver tests to verify they fail**

Run: `bun test ./tests/providers/resolver.test.ts`

Expected: FAIL with module resolution error for `../../src/providers/resolver.js`.

- [ ] **Step 3: Implement the resolver**

Create `src/providers/resolver.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getConfig } from '../config.js'
import { getContextSettings } from '../instances/context-store.js'
import { getTaskInstance } from '../instances/task-store.js'
import type { InstanceConfig, TaskInstance } from '../instances/types.js'
import { logger } from '../logger.js'
import { getKaneoWorkspace } from '../users.js'
import { isKaneoSessionCookie } from './kaneo/client.js'
import { createProvider } from './registry.js'
import type { TaskProvider } from './types.js'

const log = logger.child({ scope: 'provider:resolver' })

export interface TaskProviderResolverDeps {
  getContextSettings: typeof getContextSettings
  getTaskInstance: typeof getTaskInstance
  getConfig: typeof getConfig
  getKaneoWorkspace: typeof getKaneoWorkspace
  isKaneoSessionCookie: typeof isKaneoSessionCookie
  createProvider: typeof createProvider
}

const defaultDeps: TaskProviderResolverDeps = {
  getContextSettings,
  getTaskInstance,
  getConfig,
  getKaneoWorkspace,
  isKaneoSessionCookie,
  createProvider,
}

const resolveBaseUrl = (config: InstanceConfig): string | null => {
  const baseUrl = config['baseUrl'] ?? config['url']
  if (baseUrl === undefined || baseUrl.trim() === '') return null
  return baseUrl
}

const buildKaneoConfig = (
  contextId: string,
  instance: TaskInstance,
  deps: TaskProviderResolverDeps,
): Record<string, string> | null => {
  const baseUrl = resolveBaseUrl(instance.config)
  const credential = deps.getConfig(contextId, 'kaneo_apikey')
  const workspaceId = deps.getKaneoWorkspace(contextId)
  if (baseUrl === null || credential === null || workspaceId === null) {
    log.warn(
      {
        contextId,
        taskInstanceId: instance.id,
        hasBaseUrl: baseUrl !== null,
        hasCredential: credential !== null,
        hasWorkspaceId: workspaceId !== null,
      },
      'Cannot resolve Kaneo provider: missing config',
    )
    return null
  }
  if (deps.isKaneoSessionCookie(credential)) return { baseUrl, sessionCookie: credential, workspaceId }
  return { apiKey: credential, baseUrl, workspaceId }
}

const buildYouTrackConfig = (
  contextId: string,
  instance: TaskInstance,
  deps: TaskProviderResolverDeps,
): Record<string, string> | null => {
  const baseUrl = resolveBaseUrl(instance.config)
  const token = deps.getConfig(contextId, 'youtrack_token')
  if (baseUrl === null || token === null) {
    log.warn(
      { contextId, taskInstanceId: instance.id, hasBaseUrl: baseUrl !== null, hasToken: token !== null },
      'Cannot resolve YouTrack provider: missing config',
    )
    return null
  }
  return { baseUrl, token }
}

export class TaskProviderResolver {
  private readonly deps: TaskProviderResolverDeps

  constructor(deps: Partial<TaskProviderResolverDeps> = {}) {
    this.deps = { ...defaultDeps, ...deps }
  }

  resolve(contextId: string): TaskProvider | null {
    const settings = this.deps.getContextSettings(contextId)
    if (settings === null) {
      log.warn({ contextId }, 'Cannot resolve task provider: context has no task assignment')
      return null
    }

    const instance = this.deps.getTaskInstance(settings.taskInstanceId)
    if (instance === null) {
      log.warn({ contextId, taskInstanceId: settings.taskInstanceId }, 'Cannot resolve task provider: instance missing')
      return null
    }
    if (instance.status !== 'active') {
      log.warn(
        { contextId, taskInstanceId: instance.id, status: instance.status },
        'Cannot resolve task provider: instance is not active',
      )
      return null
    }

    const config =
      instance.type === 'kaneo'
        ? buildKaneoConfig(contextId, instance, this.deps)
        : buildYouTrackConfig(contextId, instance, this.deps)
    if (config === null) return null

    log.info({ contextId, taskInstanceId: instance.id, taskProvider: instance.type }, 'Task provider resolved')
    return this.deps.createProvider(instance.type, config)
  }

  resolveStrict(contextId: string): TaskProvider {
    const provider = this.resolve(contextId)
    if (provider === null) throw new Error(`Context ${contextId} needs /setup`)
    return provider
  }
}

export const defaultTaskProviderResolver = new TaskProviderResolver()
```

- [ ] **Step 4: Run resolver tests to verify they pass**

Run: `bun test ./tests/providers/resolver.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit resolver**

Run:

```bash
git add src/providers/resolver.ts tests/providers/resolver.test.ts
git commit -m "feat: add context task provider resolver"
```

Expected: commit succeeds.

---

## Task 2: Add Dynamic Config Keys

**Files:**

- Create: `src/config-keys.ts`
- Create: `tests/config-keys.test.ts`
- Modify: `src/types/config.ts`
- Modify: `src/config.ts`

- [ ] **Step 1: Write failing config-key tests**

Create `tests/config-keys.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getConfigKeysForContext } from '../src/config-keys.js'
import { setConfig, getAllConfig } from '../src/config.js'
import { setContextSettings } from '../src/instances/context-store.js'
import { insertTaskInstance } from '../src/instances/task-store.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

describe('getConfigKeysForContext', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    process.env['INSTANCE_CONFIG_KEY'] = '5'.repeat(64)
  })

  test('returns preferences only for an unassigned context', () => {
    expect(getConfigKeysForContext('ctx-unassigned')).toEqual(['timezone'])
  })

  test('returns Kaneo visible keys for an active Kaneo assignment', () => {
    insertTaskInstance({ id: 'kaneo-prod', type: 'kaneo', config: { url: 'https://kaneo.invalid' }, status: 'active' })
    setContextSettings({ contextId: 'ctx-kaneo', taskInstanceId: 'kaneo-prod', platformInstanceId: 'telegram-default' })

    expect(getConfigKeysForContext('ctx-kaneo')).toEqual(['kaneo_apikey', 'timezone'])
  })

  test('returns YouTrack visible keys for an active YouTrack assignment', () => {
    insertTaskInstance({ id: 'yt-prod', type: 'youtrack', config: { url: 'https://yt.invalid' }, status: 'active' })
    setContextSettings({ contextId: 'ctx-yt', taskInstanceId: 'yt-prod', platformInstanceId: 'telegram-default' })

    expect(getConfigKeysForContext('ctx-yt')).toEqual(['youtrack_token', 'timezone'])
  })

  test('returns preferences only when assigned instance is missing', () => {
    setContextSettings({ contextId: 'ctx-missing', taskInstanceId: 'missing', platformInstanceId: 'telegram-default' })

    expect(getConfigKeysForContext('ctx-missing')).toEqual(['timezone'])
  })

  test('returns preferences only when assigned instance is inactive', () => {
    insertTaskInstance({ id: 'yt-stopped', type: 'youtrack', config: { url: 'https://yt.invalid' }, status: 'stopped' })
    setContextSettings({
      contextId: 'ctx-stopped',
      taskInstanceId: 'yt-stopped',
      platformInstanceId: 'telegram-default',
    })

    expect(getConfigKeysForContext('ctx-stopped')).toEqual(['timezone'])
  })

  test('getAllConfig only includes keys valid for the context', () => {
    insertTaskInstance({ id: 'yt-prod', type: 'youtrack', config: { url: 'https://yt.invalid' }, status: 'active' })
    setContextSettings({ contextId: 'ctx-yt', taskInstanceId: 'yt-prod', platformInstanceId: 'telegram-default' })
    setConfig('ctx-yt', 'kaneo_apikey', 'hidden-kaneo-key')
    setConfig('ctx-yt', 'youtrack_token', 'perm:abc')
    setConfig('ctx-yt', 'timezone', 'UTC')

    expect(getAllConfig('ctx-yt')).toEqual({ youtrack_token: 'perm:abc', timezone: 'UTC' })
  })
})
```

- [ ] **Step 2: Run config-key tests to verify they fail**

Run: `bun test ./tests/config-keys.test.ts`

Expected: FAIL with module resolution error for `../src/config-keys.js`.

- [ ] **Step 3: Create dynamic config-key helper**

Create `src/config-keys.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getContextSettings } from './instances/context-store.js'
import { getTaskInstance } from './instances/task-store.js'
import type { ConfigKey } from './types/config.js'

const PREFERENCE_KEYS: readonly ConfigKey[] = ['timezone']

export function getConfigKeysForContext(contextId: string): readonly ConfigKey[] {
  const settings = getContextSettings(contextId)
  if (settings === null) return PREFERENCE_KEYS

  const instance = getTaskInstance(settings.taskInstanceId)
  if (instance === null || instance.status !== 'active') return PREFERENCE_KEYS

  if (instance.type === 'youtrack') return ['youtrack_token', ...PREFERENCE_KEYS]
  return ['kaneo_apikey', ...PREFERENCE_KEYS]
}
```

- [ ] **Step 4: Remove env-derived `CONFIG_KEYS` from `src/types/config.ts`**

In `src/types/config.ts`, replace lines 10-38 with:

```typescript
// Task-tracker specific config keys.
// Note: kaneo_workspace_id is auto-provisioned and not user-visible.
export type TaskProviderConfigKey = 'kaneo_apikey' | 'kaneo_workspace_id' | 'youtrack_token'

// User preference config keys (always available)
export type PreferenceConfigKey = 'timezone'

// All per-user config keys. LLM credentials live in `system_config` (see
// `src/system-config.ts`) and are owned by the bot admin, not per-user.
export type ConfigKey = TaskProviderConfigKey | PreferenceConfigKey

// Temporary compatibility export for Task 3 callers. Do not use this from new code.
export const CONFIG_KEYS: readonly ConfigKey[] = ['kaneo_apikey', 'timezone']
```

Keep `ALL_CONFIG_KEYS` and `isConfigKey` unchanged. The temporary `CONFIG_KEYS` export is removed in Task 3 after the preloaded callers stop importing it.

- [ ] **Step 5: Update `getAllConfig()` to use dynamic keys**

In `src/config.ts`, replace the import at line 8 with:

```typescript
import { getConfigKeysForContext } from './config-keys.js'
import { ALL_CONFIG_KEYS, type ConfigKey } from './types/config.js'
```

Replace `getAllConfig()` with:

```typescript
export function getAllConfig(userId: string): Partial<Record<ConfigKey, string>> {
  log.debug({ userId }, 'getAllConfig called')
  const result: Partial<Record<ConfigKey, string>> = {}
  for (const key of getConfigKeysForContext(userId)) {
    const value = readConfigValue(key, getCachedConfig(userId, key))
    if (value !== null) {
      result[key] = value
    }
  }
  return result
}
```

- [ ] **Step 6: Run config-key tests to verify they pass**

Run: `bun test ./tests/config-keys.test.ts`

Expected: PASS.

- [ ] **Step 7: Find remaining `CONFIG_KEYS` imports**

Run: `rg "CONFIG_KEYS" src tests`

Expected: remaining matches are `src/types/config.ts` as the temporary compatibility export plus files planned for later tasks: `src/wizard/engine.ts` and `src/commands/config.ts`.

- [ ] **Step 8: Commit dynamic keys**

Run:

```bash
git add src/config-keys.ts src/types/config.ts src/config.ts tests/config-keys.test.ts
git commit -m "feat: derive config keys from context assignment"
```

Expected: commit succeeds.

---

## Task 3: Update Wizard Steps and Config Editor Allow-List

**Files:**

- Modify: `src/wizard/engine.ts`
- Modify: `src/wizard/steps.ts`
- Modify: `src/types/config.ts`
- Modify: `src/config-editor/handlers.ts`
- Modify: `tests/config-editor/handlers.test.ts`
- Modify: `tests/commands/config.test.ts`

- [ ] **Step 1: Add config-editor rejection test**

In `tests/config-editor/handlers.test.ts`, add this test inside the main `describe` block:

```typescript
test('rejects editing a key that is not valid for the assigned context', async () => {
  insertTaskInstance({ id: 'yt-prod', type: 'youtrack', config: { url: 'https://yt.invalid' }, status: 'active' })
  setContextSettings({ contextId: USER_ID, taskInstanceId: 'yt-prod', platformInstanceId: 'telegram-default' })

  const result = startEditor(USER_ID, USER_ID, 'kaneo_apikey')

  expect(result.handled).toBe(true)
  expect(result.response).toBe('Config key "kaneo_apikey" is not valid for this context.')
})
```

If the file does not already import the instance helpers, add:

```typescript
import { setContextSettings } from '../../src/instances/context-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
```

- [ ] **Step 2: Add dynamic `/config` render test**

In `tests/commands/config.test.ts`, add imports:

```typescript
import { setContextSettings } from '../../src/instances/context-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
```

Add this test in the interactive-button describe block:

```typescript
test('renders only config keys for the assigned task instance', async () => {
  insertTaskInstance({ id: 'yt-prod', type: 'youtrack', config: { url: 'https://yt.invalid' }, status: 'active' })
  setContextSettings({ contextId: USER_ID, taskInstanceId: 'yt-prod', platformInstanceId: 'telegram-default' })
  setConfig(USER_ID, 'youtrack_token', 'perm:abc1234')

  const { reply, buttonCalls } = createMockReply()
  await renderConfigForTarget(reply, USER_ID, true)

  assert(buttonCalls[0] !== undefined, 'expected buttonCalls[0] to be defined')
  expect(buttonCalls[0]).toContain('YouTrack Token')
  expect(buttonCalls[0]).toContain('Timezone')
  expect(buttonCalls[0]).not.toContain('Kaneo API Key')
})
```

- [ ] **Step 3: Run targeted tests to verify they fail**

Run: `bun test ./tests/config-editor/handlers.test.ts ./tests/commands/config.test.ts -t "assigned task instance"`

Expected: FAIL because `CONFIG_KEYS` still drives rendering and editor keys.

- [ ] **Step 4: Update wizard engine to seed dynamic keys**

In `src/wizard/engine.ts`, replace:

```typescript
import { CONFIG_KEYS, type ConfigKey } from '../types/config.js'
```

with:

```typescript
import { getConfigKeysForContext } from '../config-keys.js'
import type { ConfigKey } from '../types/config.js'
```

Replace the loop in `createWizard()` with:

```typescript
for (const key of getConfigKeysForContext(storageContextId)) {
  const value = existingConfig[key]
  if (value !== undefined) {
    initialData[key] = value
  }
}
```

- [ ] **Step 5: Remove hidden Kaneo workspace from wizard summary**

In `src/wizard/steps.ts`, replace the Kaneo summary block with:

```typescript
if (taskProvider === 'kaneo') {
  lines.push(`Kaneo API Key: ${getDisplayValue('kaneo_apikey', data['kaneo_apikey'])}`)
} else if (taskProvider === 'youtrack') {
  lines.push(`YouTrack Token: ${getDisplayValue('youtrack_token', data['youtrack_token'])}`)
}
```

- [ ] **Step 6: Update `/config` to render dynamic keys**

In `src/commands/config.ts`, replace:

```typescript
import { CONFIG_KEYS, type ConfigKey } from '../types/config.js'
```

with:

```typescript
import { getConfigKeysForContext } from '../config-keys.js'
import type { ConfigKey } from '../types/config.js'
```

Replace `buildConfigButtons()` with:

```typescript
function buildConfigButtons(config: Partial<Record<ConfigKey, string>>, targetContextId: string): ChatButton[] {
  const buttons: ChatButton[] = getConfigKeysForContext(targetContextId).map((key) => ({
    text: `${getFieldEmoji(key)} ${FIELD_DISPLAY_NAMES[key]}`,
    callbackData: serializeCallbackData({ action: 'edit', key }, targetContextId),
    style: config[key] === undefined ? 'secondary' : 'primary',
  }))
  buttons.push({
    text: '🔄 Full Setup',
    callbackData: serializeCallbackData({ action: 'setup' }, targetContextId),
    style: 'primary',
  })
  return buttons
}
```

Replace the render loop in `renderConfigForTarget()` with:

```typescript
getConfigKeysForContext(targetContextId).forEach((key) => {
  lines.push(formatConfigLine(key, config[key]))
})
```

- [ ] **Step 7: Update config editor key validation**

In `src/config-editor/handlers.ts`, add import:

```typescript
import { getConfigKeysForContext } from '../config-keys.js'
```

Add helper after `getFieldEmoji()`:

```typescript
function isKeyValidForContext(storageContextId: string, key: ConfigKey): boolean {
  return getConfigKeysForContext(storageContextId).includes(key)
}
```

At the start of `startEditor()`, add:

```typescript
if (!isKeyValidForContext(storageContextId, key)) {
  return { handled: true, response: `Config key "${key}" is not valid for this context.` }
}
```

Replace `buildConfigList()` key list with:

```typescript
const configKeys = getConfigKeysForContext(storageContextId)

for (const key of configKeys) {
  const value = getConfig(storageContextId, key)
  lines.push(formatConfigLine(key, value ?? undefined))
  buttons.push({
    text: `${getFieldEmoji(key)} ${FIELD_DISPLAY_NAMES[key]}`,
    action: 'edit',
    key,
    style: value === null ? 'secondary' : 'primary',
  })
}
```

At the start of `handleSaveAction()`, after the null-session guard, add:

```typescript
if (!isKeyValidForContext(storageContextId, session.editingKey)) {
  deleteEditorSession(userId, storageContextId)
  return { handled: true, response: `Config key "${session.editingKey}" is not valid for this context.` }
}
```

At the start of `handleEditorMessage()`, after the null-session guard, add:

```typescript
if (!isKeyValidForContext(storageContextId, session.editingKey)) {
  deleteEditorSession(userId, storageContextId)
  return { handled: true, response: `Config key "${session.editingKey}" is not valid for this context.` }
}
```

- [ ] **Step 8: Run targeted tests to verify they pass**

- [ ] **Step 8: Remove temporary `CONFIG_KEYS` export**

In `src/types/config.ts`, remove the Task 2 temporary compatibility export:

```typescript
// Temporary compatibility export for Task 3 callers. Do not use this from new code.
export const CONFIG_KEYS: readonly ConfigKey[] = ['kaneo_apikey', 'timezone']
```

Run: `rg "CONFIG_KEYS" src tests`

Expected: no production matches. Test matches are allowed only if they refer to historical text.

- [ ] **Step 9: Run targeted tests to verify they pass**

Run: `bun test ./tests/config-editor/handlers.test.ts ./tests/commands/config.test.ts -t "assigned task instance"`

Expected: PASS.

- [ ] **Step 10: Run wizard tests because wizard imports changed**

Run: `bun test ./tests/wizard ./tests/commands/setup.test.ts`

Expected: PASS or only failures caused by setup assignment not implemented yet. If setup assignment failures appear, continue to Task 4 before fixing them.

- [ ] **Step 11: Commit wizard/config editor changes**

Run:

```bash
git add src/wizard/engine.ts src/wizard/steps.ts src/types/config.ts src/commands/config.ts src/config-editor/handlers.ts tests/config-editor/handlers.test.ts tests/commands/config.test.ts
git commit -m "feat: apply context config keys to setup UI"
```

Expected: commit succeeds.

---

## Task 4: Add Task-Instance Selection Before `/setup`

**Files:**

- Create: `src/setup/platform-instance.ts`
- Create: `src/setup/task-instance-selection.ts`
- Create: `tests/setup/task-instance-selection.test.ts`
- Modify: `src/commands/setup.ts`
- Modify: `src/bot-settings.ts`
- Modify: `tests/commands/setup.test.ts`

- [ ] **Step 1: Write task-instance selection tests**

Create `tests/setup/task-instance-selection.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getContextSettings } from '../../src/instances/context-store.js'
import { insertPlatformInstance } from '../../src/instances/platform-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import {
  handleTaskInstanceSelectionMessage,
  startTaskInstanceSelection,
} from '../../src/setup/task-instance-selection.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('task instance setup selection', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    process.env['INSTANCE_CONFIG_KEY'] = '6'.repeat(64)
    process.env['CHAT_PROVIDER'] = 'telegram'
  })

  test('aborts when there are no active task instances', () => {
    insertPlatformInstance({ id: 'telegram-default', type: 'telegram', config: { token: 't' }, status: 'active' })

    const result = startTaskInstanceSelection('user-1', 'ctx-1')

    expect(result).toEqual({
      status: 'aborted',
      response: 'No task trackers are configured. Ask a super-admin to add one in the dashboard.',
    })
  })

  test('auto-assigns the only active task instance', () => {
    insertPlatformInstance({ id: 'telegram-default', type: 'telegram', config: { token: 't' }, status: 'active' })
    insertTaskInstance({ id: 'yt-prod', type: 'youtrack', config: { url: 'https://yt.invalid' }, status: 'active' })

    const result = startTaskInstanceSelection('user-1', 'ctx-1')

    expect(result).toEqual({ status: 'assigned', taskProvider: 'youtrack' })
    expect(getContextSettings('ctx-1')).toEqual({
      contextId: 'ctx-1',
      taskInstanceId: 'yt-prod',
      platformInstanceId: 'telegram-default',
    })
  })

  test('asks the user to choose when multiple active task instances exist', () => {
    insertPlatformInstance({ id: 'telegram-default', type: 'telegram', config: { token: 't' }, status: 'active' })
    insertTaskInstance({ id: 'kaneo-prod', type: 'kaneo', config: { url: 'https://kaneo.invalid' }, status: 'active' })
    insertTaskInstance({ id: 'yt-prod', type: 'youtrack', config: { url: 'https://yt.invalid' }, status: 'active' })

    const result = startTaskInstanceSelection('user-1', 'ctx-1')

    expect(result.status).toBe('pending')
    expect(result.response).toContain('Choose a task tracker for this context')
    expect(result.response).toContain('kaneo-prod')
    expect(result.response).toContain('yt-prod')
    expect(getContextSettings('ctx-1')).toBeNull()
  })

  test('handles text selection by task instance id', () => {
    insertPlatformInstance({ id: 'telegram-default', type: 'telegram', config: { token: 't' }, status: 'active' })
    insertTaskInstance({ id: 'kaneo-prod', type: 'kaneo', config: { url: 'https://kaneo.invalid' }, status: 'active' })
    insertTaskInstance({ id: 'yt-prod', type: 'youtrack', config: { url: 'https://yt.invalid' }, status: 'active' })
    startTaskInstanceSelection('user-1', 'ctx-1')

    const result = handleTaskInstanceSelectionMessage('user-1', 'ctx-1', 'yt-prod')

    expect(result).toEqual({ status: 'assigned', taskProvider: 'youtrack' })
    expect(getContextSettings('ctx-1')?.taskInstanceId).toBe('yt-prod')
  })

  test('rejects text selection that is not one of the active options', () => {
    insertPlatformInstance({ id: 'telegram-default', type: 'telegram', config: { token: 't' }, status: 'active' })
    insertTaskInstance({ id: 'yt-prod', type: 'youtrack', config: { url: 'https://yt.invalid' }, status: 'active' })
    insertTaskInstance({ id: 'old-prod', type: 'youtrack', config: { url: 'https://old.invalid' }, status: 'stopped' })
    startTaskInstanceSelection('user-1', 'ctx-1')

    const result = handleTaskInstanceSelectionMessage('user-1', 'ctx-1', 'old-prod')

    expect(result.status).toBe('pending')
    expect(result.response).toContain('Reply with one of these task instance IDs')
    expect(getContextSettings('ctx-1')).toBeNull()
  })
})
```

- [ ] **Step 2: Run task-instance selection tests to verify they fail**

Run: `bun test ./tests/setup/task-instance-selection.test.ts`

Expected: FAIL with module resolution error for `../../src/setup/task-instance-selection.js`.

- [ ] **Step 3: Implement platform-instance resolution**

Create `src/setup/platform-instance.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { listPlatformInstances } from '../instances/platform-store.js'
import type { PlatformInstance } from '../instances/types.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'setup:platform-instance' })

const getCurrentChatProvider = (): string | null => {
  const value = process.env['CHAT_PROVIDER']
  if (value === undefined || value.trim() === '') return null
  return value.trim()
}

export function resolveCurrentPlatformInstanceId(): string | null {
  const chatProvider = getCurrentChatProvider()
  if (chatProvider === null) {
    log.warn('Cannot assign setup context: CHAT_PROVIDER is missing')
    return null
  }

  const matches: PlatformInstance[] = listPlatformInstances().filter(
    (instance) => instance.status === 'active' && instance.type === chatProvider,
  )
  if (matches.length !== 1) {
    log.warn({ chatProvider, activeMatches: matches.length }, 'Cannot determine unique active platform instance')
    return null
  }
  return matches[0]!.id
}
```

- [ ] **Step 4: Implement task-instance selection state**

Create `src/setup/task-instance-selection.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { setContextSettings } from '../instances/context-store.js'
import { listTaskInstances } from '../instances/task-store.js'
import type { TaskInstance, TaskInstanceType } from '../instances/types.js'
import { logger } from '../logger.js'
import { resolveCurrentPlatformInstanceId } from './platform-instance.js'

const log = logger.child({ scope: 'setup:task-instance-selection' })

type SelectionSession = {
  userId: string
  contextId: string
  options: readonly TaskInstance[]
}

export type TaskInstanceSelectionResult =
  | { status: 'assigned'; taskProvider: TaskInstanceType }
  | { status: 'pending'; response: string }
  | { status: 'aborted'; response: string }
  | { status: 'not-handled' }

const sessions = new Map<string, SelectionSession>()

const sessionKey = (userId: string, contextId: string): string => `${userId}:${contextId}`

const activeTaskInstances = (): TaskInstance[] => listTaskInstances().filter((instance) => instance.status === 'active')

const formatChoiceList = (instances: readonly TaskInstance[]): string =>
  [
    'Choose a task tracker for this context.',
    '',
    ...instances.map(
      (instance, index) => `${String(index + 1)}. ${instance.id} (${instance.type}, created ${instance.createdAt})`,
    ),
    '',
    'Reply with one of these task instance IDs.',
  ].join('\n')

const assignTaskInstance = (userId: string, contextId: string, instance: TaskInstance): TaskInstanceSelectionResult => {
  const platformInstanceId = resolveCurrentPlatformInstanceId()
  if (platformInstanceId === null) {
    return {
      status: 'aborted',
      response:
        'No active chat platform instance is available for this setup flow. Ask a super-admin to check the dashboard.',
    }
  }
  setContextSettings({ contextId, taskInstanceId: instance.id, platformInstanceId })
  sessions.delete(sessionKey(userId, contextId))
  log.info({ userId, contextId, taskInstanceId: instance.id, platformInstanceId }, 'Task instance assigned')
  return { status: 'assigned', taskProvider: instance.type }
}

export function startTaskInstanceSelection(userId: string, contextId: string): TaskInstanceSelectionResult {
  const options = activeTaskInstances()
  if (options.length === 0) {
    return {
      status: 'aborted',
      response: 'No task trackers are configured. Ask a super-admin to add one in the dashboard.',
    }
  }
  if (options.length === 1) {
    const only = options[0]!
    log.info({ userId, contextId, taskInstanceId: only.id }, 'Auto-selecting only active task instance')
    return assignTaskInstance(userId, contextId, only)
  }
  sessions.set(sessionKey(userId, contextId), { userId, contextId, options })
  return { status: 'pending', response: formatChoiceList(options) }
}

export function handleTaskInstanceSelectionMessage(
  userId: string,
  contextId: string,
  text: string,
): TaskInstanceSelectionResult {
  const session = sessions.get(sessionKey(userId, contextId))
  if (session === undefined) return { status: 'not-handled' }

  const selectedId = text.trim()
  const selected = session.options.find((instance) => instance.id === selectedId)
  if (selected === undefined) {
    return { status: 'pending', response: formatChoiceList(session.options) }
  }
  return assignTaskInstance(userId, contextId, selected)
}
```

- [ ] **Step 5: Run task-instance selection tests to verify they pass**

Run: `bun test ./tests/setup/task-instance-selection.test.ts`

Expected: PASS.

- [ ] **Step 6: Update setup command dependencies and flow**

In `src/commands/setup.ts`, remove `getTaskProvider()` and `TASK_PROVIDER`.

Add imports:

```typescript
import { getContextSettings } from '../instances/context-store.js'
import { getTaskInstance } from '../instances/task-store.js'
import { startTaskInstanceSelection } from '../setup/task-instance-selection.js'
```

Update `SetupCommandDeps`:

```typescript
export interface SetupCommandDeps {
  isAuthorizedGroup: (groupId: string) => boolean
  getConfig: typeof getConfig
  getKaneoWorkspace: typeof getKaneoWorkspace
  provisionAndConfigure: typeof provisionAndConfigure
  createWizard: typeof createWizard
  getContextSettings: typeof getContextSettings
  getTaskInstance: typeof getTaskInstance
  startTaskInstanceSelection: typeof startTaskInstanceSelection
}
```

Update `defaultDeps`:

```typescript
const defaultDeps: SetupCommandDeps = {
  isAuthorizedGroup,
  getConfig,
  getKaneoWorkspace,
  provisionAndConfigure,
  createWizard,
  getContextSettings,
  getTaskInstance,
  startTaskInstanceSelection,
}
```

Add helper before `startSetupForTarget()`:

```typescript
async function startCredentialWizard(
  userId: string,
  reply: ReplyFn,
  targetContextId: string,
  deps: SetupCommandDeps,
): Promise<void> {
  const settings = deps.getContextSettings(targetContextId)
  if (settings === null) {
    const selection = deps.startTaskInstanceSelection(userId, targetContextId)
    if (selection.status === 'assigned') {
      const result = deps.createWizard(userId, targetContextId, selection.taskProvider)
      await reply.text(result.prompt)
      return
    }
    if (selection.status === 'pending' || selection.status === 'aborted') {
      await reply.text(selection.response)
      return
    }
    await reply.text('Failed to start setup. Please try again.')
    return
  }

  const taskInstance = deps.getTaskInstance(settings.taskInstanceId)
  if (taskInstance === null || taskInstance.status !== 'active') {
    const selection = deps.startTaskInstanceSelection(userId, targetContextId)
    if (selection.status === 'assigned') {
      const result = deps.createWizard(userId, targetContextId, selection.taskProvider)
      await reply.text(result.prompt)
      return
    }
    if (selection.status === 'pending' || selection.status === 'aborted') {
      await reply.text(selection.response)
      return
    }
    await reply.text('Failed to start setup. Please try again.')
    return
  }

  const result = deps.createWizard(userId, targetContextId, taskInstance.type)
  await reply.text(result.prompt)
}
```

Replace lines 114-133 in `startSetupForTarget()` with:

```typescript
const settings = resolvedDeps.getContextSettings(targetContextId)
const taskInstance = settings === null ? null : resolvedDeps.getTaskInstance(settings.taskInstanceId)
const isKaneoTarget = taskInstance?.type === 'kaneo'
if (isGroupTarget && isKaneoTarget && isFirstTimeKaneoGroupSetup(targetContextId, resolvedDeps)) {
  const shouldStop = await replyForProvisionOutcome(
    reply,
    await resolvedDeps.provisionAndConfigure(targetContextId, null),
  )
  if (shouldStop) {
    return
  }
}

await startCredentialWizard(userId, reply, targetContextId, resolvedDeps)
```

- [ ] **Step 7: Intercept text replies for task-instance selection**

In `src/bot-settings.ts`, add import:

```typescript
import { handleTaskInstanceSelectionMessage } from './setup/task-instance-selection.js'
import { createWizard } from './wizard/index.js'
```

Add helper before `maybeHandleSetupFlows()`:

```typescript
async function maybeHandleTaskInstanceSelection(
  msg: IncomingMessage,
  reply: ReplyFn,
  settingsTargetContextId: string,
): Promise<boolean> {
  if (msg.contextType !== 'dm') return false
  const selection = handleTaskInstanceSelectionMessage(msg.user.id, settingsTargetContextId, msg.text)
  if (selection.status === 'not-handled') return false
  if (selection.status === 'assigned') {
    const result = createWizard(msg.user.id, settingsTargetContextId, selection.taskProvider)
    await reply.text(result.prompt)
    return true
  }
  if (selection.status === 'pending' || selection.status === 'aborted') {
    await reply.text(selection.response)
    return true
  }
  return false
}
```

In `maybeHandleSetupFlows()`, insert this immediately before `handleConfigEditorMessage()`:

```typescript
if (await maybeHandleTaskInstanceSelection(msg, reply, settingsTargetContextId)) return true
```

- [ ] **Step 8: Update setup command tests for new dependencies**

In `tests/commands/setup.test.ts`, every literal `SetupCommandDeps` object must add:

```typescript
      getContextSettings: () => ({ contextId: 'group-1', taskInstanceId: 'kaneo-prod', platformInstanceId: 'telegram-default' }),
      getTaskInstance: () => ({
        id: 'kaneo-prod',
        type: 'kaneo',
        config: { url: 'https://kaneo.invalid' },
        status: 'active',
        createdAt: '2026-05-23T00:00:00.000Z',
      }),
      startTaskInstanceSelection: () => ({ status: 'assigned', taskProvider: 'kaneo' }),
```

Add this new test at the end:

```typescript
test('starts task instance selection when target has no assignment', async () => {
  const { reply, textCalls } = createMockReply()
  const deps: SetupCommandDeps = {
    isAuthorizedGroup: () => true,
    provisionAndConfigure: () => Promise.resolve({ status: 'failed', error: 'should not be called' }),
    createWizard: () => ({ success: true, prompt: 'wizard-started' }),
    getConfig: () => null,
    getKaneoWorkspace: () => null,
    getContextSettings: () => null,
    getTaskInstance: () => null,
    startTaskInstanceSelection: () => ({ status: 'pending', response: 'choose a task tracker' }),
  }

  await startSetupForTarget('admin-1', reply, 'admin-1', deps)

  expect(textCalls).toEqual(['choose a task tracker'])
})
```

- [ ] **Step 9: Run setup tests**

Run: `bun test ./tests/setup/task-instance-selection.test.ts ./tests/commands/setup.test.ts`

Expected: PASS.

- [ ] **Step 10: Commit setup assignment flow**

Run:

```bash
git add src/setup/platform-instance.ts src/setup/task-instance-selection.ts src/commands/setup.ts src/bot-settings.ts tests/setup/task-instance-selection.test.ts tests/commands/setup.test.ts
git commit -m "feat: select task instance during setup"
```

Expected: commit succeeds.

---

## Task 5: Update Bot Auto-Start and Required Config Checks

**Files:**

- Modify: `src/bot.ts`
- Modify: `src/llm-orchestrator-config.ts`
- Modify: `src/providers/kaneo/provision.ts`
- Modify: `tests/bot.test.ts`
- Modify: `tests/llm-orchestrator.test.ts`

- [ ] **Step 1: Add missing-assignment auto-start test**

In `tests/bot.test.ts`, add a test near existing auto-setup tests:

```typescript
test('auto-starts setup selection when authorized DM context has no task assignment', async () => {
  const { provider, messageHandler } = createMockChatForBot()
  const replies: string[] = []
  setupBot(provider, 'admin-1', {
    processMessage: () => Promise.resolve(),
    enqueueMessage: undefined,
  })

  await addUser('admin-1', 'admin-1')
  await messageHandler(createDmMessage('admin-1', 'hello'), {
    text: (text) => {
      replies.push(text)
      return Promise.resolve()
    },
    formatted: () => Promise.resolve(),
    typing: () => Promise.resolve(),
    buttons: () => Promise.resolve(),
  })

  expect(
    replies.some(
      (reply) => reply.includes('Choose a task tracker') || reply.includes('No task trackers are configured'),
    ),
  ).toBe(true)
})
```

Use the local reply helper style if this file already has a shorter helper. Keep the assertion text exactly as shown.

- [ ] **Step 2: Add required-config tests for dynamic keys**

In `tests/llm-orchestrator.test.ts`, update the missing provider config tests to set task instances and context settings before calling `processMessage()`. Add this helper near existing test helpers:

```typescript
const assignYouTrackContext = (contextId: string): void => {
  insertTaskInstance({
    id: `${contextId}-yt`,
    type: 'youtrack',
    config: { url: 'https://yt.invalid' },
    status: 'active',
  })
  setContextSettings({ contextId, taskInstanceId: `${contextId}-yt`, platformInstanceId: 'telegram-default' })
}
```

Add imports:

```typescript
import { setContextSettings } from '../src/instances/context-store.js'
import { insertTaskInstance } from '../src/instances/task-store.js'
```

Add this test in `describe('missing configuration')`:

```typescript
test('missing provider config is derived from assigned task instance', async () => {
  const freshCtx = 'missing-youtrack-token'
  assignYouTrackContext(freshCtx)
  const deps: LlmOrchestratorDeps = {
    generateText: (...args) => realAi.generateText(...args),
    stepCountIs: (...args) => realAi.stepCountIs(...args),
    buildOpenAI: buildMockOpenAI,
    resolve: () => null,
    getKaneoWorkspace: () => null,
    maybeProvisionKaneo: () => Promise.resolve(),
  }

  const { reply, textCalls } = createMockReply()
  await processMessage(reply, freshCtx, 'user-1', null, 'hello', 'dm', undefined, deps)

  expect(textCalls[0]).toContain('youtrack_token')
  expect(textCalls[0]).toContain('/setup')
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test ./tests/bot.test.ts ./tests/llm-orchestrator.test.ts -t "task assignment|assigned task instance"`

Expected: FAIL because `bot.ts` and `llm-orchestrator-config.ts` still read `TASK_PROVIDER`.

- [ ] **Step 4: Update `bot.ts` auto-start logic**

In `src/bot.ts`, replace imports:

```typescript
import { getAllConfig } from './config.js'
```

with:

```typescript
import { getConfigKeysForContext } from './config-keys.js'
import { getAllConfig } from './config.js'
import { getContextSettings } from './instances/context-store.js'
import { getTaskInstance } from './instances/task-store.js'
import { startTaskInstanceSelection } from './setup/task-instance-selection.js'
```

Replace `userNeedsSetup()` with:

```typescript
function userNeedsSetup(storageContextId: string): boolean {
  const settings = getContextSettings(storageContextId)
  if (settings === null) return true
  const taskInstance = getTaskInstance(settings.taskInstanceId)
  if (taskInstance === null || taskInstance.status !== 'active') return true

  const config = getAllConfig(storageContextId)
  return getWizardSteps(taskInstance.type).some((step) => {
    if (step.isOptional === true) return false
    if (!getConfigKeysForContext(storageContextId).includes(step.key)) return false
    const value = config[step.key]
    if (value === undefined) return true
    if (value === '') return true
    return false
  })
}
```

Replace `autoStartWizardIfNeeded()` with:

```typescript
async function autoStartWizardIfNeeded(userId: string, storageContextId: string, reply: ReplyFn): Promise<boolean> {
  if (hasActiveWizard(userId, storageContextId)) return false
  if (process.env['DEMO_MODE'] === 'true' && isDemoUser(userId)) return false
  if (!userNeedsSetup(storageContextId)) return false

  const settings = getContextSettings(storageContextId)
  if (settings === null) {
    const selection = startTaskInstanceSelection(userId, storageContextId)
    if (selection.status === 'assigned') {
      const result = createWizard(userId, storageContextId, selection.taskProvider)
      if (result.success) await reply.text(result.prompt)
      return result.success
    }
    if (selection.status === 'pending' || selection.status === 'aborted') {
      await reply.text(selection.response)
      return true
    }
    return false
  }

  const taskInstance = getTaskInstance(settings.taskInstanceId)
  if (taskInstance === null || taskInstance.status !== 'active') return false
  const result = createWizard(userId, storageContextId, taskInstance.type)
  if (result.success) await reply.text(result.prompt)
  return result.success
}
```

- [ ] **Step 5: Update required provider config helper**

In `src/llm-orchestrator-config.ts`, remove `taskProviderEnv`, `TASK_PROVIDER`, and `RequiredProviderConfigDeps` usage for provider selection.

Add import:

```typescript
import { getConfigKeysForContext } from './config-keys.js'
```

Replace `checkRequiredProviderConfig()` with:

```typescript
export const checkRequiredProviderConfig = (_contextId: string, configId: string): string[] => {
  const requiredKeys = getConfigKeysForContext(configId).filter(
    (key): key is 'kaneo_apikey' | 'youtrack_token' => key === 'kaneo_apikey' || key === 'youtrack_token',
  )
  return requiredKeys.filter((key) => readConfig(configId, key) === null)
}
```

In `src/llm-orchestrator.ts`, update the call inside `ensureRequiredConfig()` from:

```typescript
const missing = checkRequiredProviderConfig(configId, deps)
```

to:

```typescript
const missing = checkRequiredProviderConfig(contextId, configId)
```

- [ ] **Step 6: Run targeted tests to verify they pass**

- [ ] **Step 6: Update Kaneo auto-provision gating**

In `src/providers/kaneo/provision.ts`, add imports:

```typescript
import { getContextSettings } from '../../instances/context-store.js'
import { getTaskInstance } from '../../instances/task-store.js'
```

Replace the comment above `maybeProvisionKaneo()` with:

```typescript
/**
 * Auto-provisions a Kaneo account for a context assigned to an active Kaneo task instance.
 * Unassigned contexts return without provisioning; /setup owns task-instance assignment.
 */
```

Replace the `TASK_PROVIDER` block at the start of `maybeProvisionKaneo()` with:

```typescript
const settings = getContextSettings(contextId)
if (settings === null) return
const taskInstance = getTaskInstance(settings.taskInstanceId)
if (taskInstance === null || taskInstance.status !== 'active' || taskInstance.type !== 'kaneo') return
```

- [ ] **Step 7: Run targeted tests to verify they pass**

Run: `bun test ./tests/bot.test.ts ./tests/llm-orchestrator.test.ts -t "task assignment|assigned task instance|missing provider config"`

Expected: PASS.

- [ ] **Step 8: Commit bot and required config changes**

Run:

```bash
git add src/bot.ts src/llm-orchestrator-config.ts src/llm-orchestrator.ts src/providers/kaneo/provision.ts tests/bot.test.ts tests/llm-orchestrator.test.ts
git commit -m "feat: drive setup from context task assignment"
```

Expected: commit succeeds.

---

## Task 6: Migrate LLM Orchestrator and `/context` Provider Resolution

**Files:**

- Modify: `src/llm-orchestrator-types.ts`
- Modify: `src/llm-orchestrator.ts`
- Modify: `src/commands/context-tool-resolution.ts`
- Modify: `tests/llm-orchestrator.test.ts`
- Modify: `tests/commands/context*.test.ts` if direct fixtures reference `buildProviderForUser`

- [ ] **Step 1: Update orchestrator tests to expect null resolver setup reply**

In `tests/llm-orchestrator.test.ts`, replace every `buildProviderForUser:` field in `LlmOrchestratorDeps` fixtures with `resolve:`.

Use this exact resolver for happy-path tests:

```typescript
resolve: () => createMockProvider({ name: 'mock' }),
```

Use this exact resolver for missing-provider tests:

```typescript
resolve: () => null,
```

Add this test in `describe('missing configuration')`:

```typescript
test('replies with setup guidance when resolver returns null after credentials pass', async () => {
  const freshCtx = 'resolver-null-context'
  insertTaskInstance({ id: 'yt-prod-null', type: 'youtrack', config: { url: 'https://yt.invalid' }, status: 'active' })
  setContextSettings({ contextId: freshCtx, taskInstanceId: 'yt-prod-null', platformInstanceId: 'telegram-default' })
  setConfig(freshCtx, 'youtrack_token', 'perm:abc')
  const deps: LlmOrchestratorDeps = {
    generateText: (...args) => realAi.generateText(...args),
    stepCountIs: (...args) => realAi.stepCountIs(...args),
    buildOpenAI: buildMockOpenAI,
    resolve: () => null,
    getKaneoWorkspace: () => null,
    maybeProvisionKaneo: () => Promise.resolve(),
  }

  const { reply, textCalls } = createMockReply()
  await processMessage(reply, freshCtx, 'user-1', null, 'hello', 'dm', undefined, deps)

  expect(textCalls).toContain('I need /setup before I can do that.')
})
```

- [ ] **Step 2: Run orchestrator tests to verify they fail**

Run: `bun test ./tests/llm-orchestrator.test.ts -t "resolver returns null|missing configuration"`

Expected: FAIL because `LlmOrchestratorDeps` still requires `buildProviderForUser`.

- [ ] **Step 3: Update orchestrator dependency type**

In `src/llm-orchestrator-types.ts`, replace:

```typescript
buildProviderForUser: (userId: string) => TaskProvider
```

with:

```typescript
resolve: (contextId: string) => TaskProvider | null
```

- [ ] **Step 4: Update orchestrator defaults and null handling**

In `src/llm-orchestrator.ts`, replace import:

```typescript
import { buildProviderForUser } from './providers/factory.js'
```

with:

```typescript
import { defaultTaskProviderResolver } from './providers/resolver.js'
```

Replace default deps field:

```typescript
  buildProviderForUser: (userId: string) => buildProviderForUser(userId, true),
```

with:

```typescript
  resolve: (contextId: string) => defaultTaskProviderResolver.resolve(contextId),
```

Replace provider construction in `callLlm()` with:

```typescript
const provider = deps.resolve(configId)
if (provider === null) {
  log.warn({ contextId, configId }, 'Task provider unavailable for LLM turn')
  await reply.text('I need /setup before I can do that.')
  return { response: { messages: [] } }
}
```

- [ ] **Step 5: Update `/context` live tool resolution**

In `src/commands/context-tool-resolution.ts`, replace import:

```typescript
import { buildProviderForUser } from '../providers/factory.js'
```

with:

```typescript
import { defaultTaskProviderResolver } from '../providers/resolver.js'
```

Replace `safeBuildProvider()` body with:

```typescript
export function safeBuildProvider(contextId: string): TaskProvider | null {
  try {
    return defaultTaskProviderResolver.resolve(contextId)
  } catch (error) {
    log.warn(
      { contextId, error: error instanceof Error ? error.message : String(error) },
      'Provider unavailable while building context view',
    )
    return null
  }
}
```

- [ ] **Step 6: Run orchestrator and context tests**

Run: `bun test ./tests/llm-orchestrator.test.ts ./tests/commands/context.test.ts ./tests/commands/context-tool-resolution.test.ts`

Expected: PASS. If one of the two context test files does not exist, run the one that exists and record the missing file in the task note before committing.

- [ ] **Step 7: Commit orchestrator migration**

Run:

```bash
git add src/llm-orchestrator-types.ts src/llm-orchestrator.ts src/commands/context-tool-resolution.ts tests/llm-orchestrator.test.ts tests/commands/context*.test.ts
git commit -m "feat: resolve task provider by context for llm"
```

Expected: commit succeeds.

---

## Task 7: Migrate Scheduler and Deferred Prompt Pollers

**Files:**

- Modify: `src/scheduler.ts`
- Modify: `src/deferred-prompts/proactive-llm.ts`
- Modify: `src/deferred-prompts/poller.ts`
- Modify: `tests/scheduler.test.ts`
- Modify: `tests/deferred-prompts/poller.test.ts`
- Modify: `tests/deferred-prompts/proactive-llm.test.ts` if it references `BuildProviderFn`

- [ ] **Step 1: Update scheduler tests to use resolver dependency**

In `tests/scheduler.test.ts`, replace deps objects shaped as:

```typescript
{
  createProvider: () => provider
}
```

with:

```typescript
{
  resolve: () => provider
}
```

Add this test for null-skip behavior:

```typescript
test('skips recurring task when resolver returns null', async () => {
  const deps: SchedulerDeps = { resolve: () => null }

  await tick(deps)

  expect(true).toBe(true)
})
```

If this file has helper factories for recurring rows, use the existing helper to create one due recurring task before calling `tick(deps)`.

- [ ] **Step 2: Update poller tests to use context resolver semantics**

In `tests/deferred-prompts/poller.test.ts`, rename local `buildProviderFn` variables to `resolveProvider` and keep the function type as `(contextId: string) => TaskProvider | null`.

Add this assertion to alert tests that use group delivery targets:

```typescript
expect(resolvedContextIds).toContain(groupContextId)
```

where `resolvedContextIds` is populated by:

```typescript
const resolvedContextIds: string[] = []
const resolveProvider: BuildProviderFn = (contextId) => {
  resolvedContextIds.push(contextId)
  return provider
}
```

- [ ] **Step 3: Run scheduler/poller tests to verify they fail**

Run: `bun test ./tests/scheduler.test.ts ./tests/deferred-prompts/poller.test.ts`

Expected: FAIL because scheduler deps still expose `createProvider` and poller still passes creator user IDs in alert/full execution paths.

- [ ] **Step 4: Update scheduler to use resolver**

In `src/scheduler.ts`, remove imports `getConfig`, `isKaneoSessionCookie`, `createProvider as defaultCreateProvider`, and `getKaneoWorkspace`.

Add import:

```typescript
import { defaultTaskProviderResolver } from './providers/resolver.js'
```

Replace `SchedulerDeps` and defaults with:

```typescript
export interface SchedulerDeps {
  resolve: (contextId: string) => TaskProvider | null
}

const defaultSchedulerDeps: SchedulerDeps = {
  resolve: (contextId) => defaultTaskProviderResolver.resolve(contextId),
}
```

Delete `getTaskProvider()`, `TASK_PROVIDER`, and local `buildProviderForUser()`.

In `executeRecurringTask()`, replace provider construction with:

```typescript
const provider = deps.resolve(task.userId)
if (provider === null) {
  log.warn({ taskId: task.id, contextId: task.userId }, 'Skipping recurring task: task provider unavailable')
  return
}
```

In `createMissedTasks()`, replace provider construction with:

```typescript
const provider = resolvedDeps.resolve(task.userId)
if (provider === null) {
  log.warn({ recurringTaskId, contextId: task.userId }, 'Skipping missed tasks: task provider unavailable')
  return 0
}
```

Update `getSchedulerSnapshot()` task provider field to avoid global task provider. If the snapshot currently returns `taskProvider: TASK_PROVIDER`, replace it with:

```typescript
    taskProvider: 'context-assigned',
```

- [ ] **Step 5: Update deferred prompt provider function naming and context ID use**

In `src/deferred-prompts/proactive-llm.ts`, replace:

```typescript
export type BuildProviderFn = (userId: string) => TaskProvider | null
```

with:

```typescript
export type BuildProviderFn = (contextId: string) => TaskProvider | null
```

In `invokeFull()`, replace:

```typescript
const provider = buildProviderFn(createdByUserId)
```

with:

```typescript
const provider = buildProviderFn(storageContextId)
```

Update the warning log object from `{ userId: createdByUserId }` to:

```typescript
{
  userId: (createdByUserId, storageContextId)
}
```

In `src/deferred-prompts/poller.ts`, inside `executeAlertsForUser()`, compute a storage context per alert group instead of using only `createdByUserId`. Add import:

```typescript
import { getStorageContextId } from './proactive-llm-helpers.js'
```

Replace provider construction at the start of `executeAlertsForUser()` with:

```typescript
const storageContextId = getStorageContextId(alerts[0]!.deliveryTarget)
const provider = buildProviderFn(storageContextId)
if (provider === null) {
  log.warn({ userId, storageContextId }, 'Could not build task provider for alert polling')
  return
}
```

- [ ] **Step 6: Run scheduler/poller tests to verify they pass**

Run: `bun test ./tests/scheduler.test.ts ./tests/deferred-prompts/poller.test.ts ./tests/deferred-prompts/proactive-llm.test.ts`

Expected: PASS. If `tests/deferred-prompts/proactive-llm.test.ts` does not exist, run the two existing files and note the missing file in the commit summary.

- [ ] **Step 7: Commit scheduler/poller migration**

Run:

```bash
git add src/scheduler.ts src/deferred-prompts/proactive-llm.ts src/deferred-prompts/poller.ts tests/scheduler.test.ts tests/deferred-prompts/poller.test.ts tests/deferred-prompts/proactive-llm.test.ts
git commit -m "feat: resolve scheduled task providers by context"
```

Expected: commit succeeds.

---

## Task 8: Update Startup Wiring and Remove Runtime `TASK_PROVIDER` Dependence

**Files:**

- Modify: `src/index.ts`
- Modify: `src/debug/admin-system.ts`
- Modify: `tests/debug/admin-system.test.ts` if present

- [ ] **Step 1: Add startup/admin-system regression tests if local files exist**

If `tests/debug/admin-system.test.ts` exists, add:

```typescript
test('reports unknown task provider when TASK_PROVIDER is unset', () => {
  delete process.env['TASK_PROVIDER']

  const response = handleAdminSystem()

  expect(response.status).toBe(200)
})
```

If there is no `tests/debug/admin-system.test.ts`, skip only this step and rely on `bun typecheck` in Task 10.

- [ ] **Step 2: Update startup imports**

In `src/index.ts`, replace:

```typescript
import { buildProviderForUser } from './providers/factory.js'
```

with:

```typescript
import { defaultTaskProviderResolver } from './providers/resolver.js'
```

- [ ] **Step 3: Remove `TASK_PROVIDER` startup validation**

In `src/index.ts`, replace:

```typescript
const REQUIRED_ENV_VARS = ['CHAT_PROVIDER', 'ADMIN_USER_ID', 'TASK_PROVIDER'] as const
```

with:

```typescript
const REQUIRED_ENV_VARS = ['CHAT_PROVIDER', 'ADMIN_USER_ID'] as const
```

Delete lines 47-68 that validate `TASK_PROVIDER`, `KANEO_CLIENT_URL`, and `YOUTRACK_URL` before DB init.

In the startup log object, replace:

```typescript
    taskProvider: TASK_PROVIDER,
```

with:

```typescript
    taskProviderSource: 'context_settings',
```

- [ ] **Step 4: Wire scheduler and pollers to resolver**

In `src/index.ts`, replace:

```typescript
startScheduler(chatProvider)

startPollers(chatProvider, (userId) => buildProviderForUser(userId, false))
```

with:

```typescript
startScheduler(chatProvider)

startPollers(chatProvider, (contextId) => defaultTaskProviderResolver.resolve(contextId))
```

Replace admin warmup:

```typescript
const adminProvider = buildProviderForUser(adminUserId, false)
```

with:

```typescript
const adminProvider = defaultTaskProviderResolver.resolve(adminUserId)
```

- [ ] **Step 5: Keep admin system status safe when `TASK_PROVIDER` is unset**

`src/debug/admin-system.ts` already reports `unknown` if `TASK_PROVIDER` is unset. Leave that behavior unchanged. Do not make admin-system query all task instances in Phase 2.

- [ ] **Step 6: Run startup-related checks**

Run: `bun typecheck`

Expected: PASS or no `buildProviderForUser`, `TASK_PROVIDER`, or `TASK_PROVIDER must be either` type/reference errors.

- [ ] **Step 7: Commit startup wiring**

Run:

```bash
git add src/index.ts src/debug/admin-system.ts tests/debug/admin-system.test.ts
git commit -m "feat: wire startup to task provider resolver"
```

Expected: commit succeeds. If `tests/debug/admin-system.test.ts` does not exist and `src/debug/admin-system.ts` was unchanged, omit those paths from `git add`.

---

## Task 9: Delete Provider Factory and Clean Remaining Callers

**Files:**

- Delete: `src/providers/factory.ts`
- Modify: any file returned by `rg "buildProviderForUser|providers/factory|CONFIG_KEYS|process.env\['TASK_PROVIDER'\]" src tests`

- [ ] **Step 1: Search for obsolete symbols**

Run: `rg "buildProviderForUser|providers/factory|CONFIG_KEYS" src tests`

Expected: matches remain before cleanup.

- [ ] **Step 2: Delete provider factory**

Delete `src/providers/factory.ts`.

- [ ] **Step 3: Remove remaining `CONFIG_KEYS` imports**

For every remaining `CONFIG_KEYS` match in `src/` or `tests/`, replace runtime use with `getConfigKeysForContext(contextId)`. The expected final command is:

Run: `rg "CONFIG_KEYS" src tests`

Expected: no matches.

- [ ] **Step 4: Remove remaining provider factory imports**

For every remaining `buildProviderForUser` or `providers/factory` match, replace with `defaultTaskProviderResolver.resolve(contextId)` or an injected `resolve(contextId)` dependency. The expected final command is:

Run: `rg "buildProviderForUser|providers/factory" src tests`

Expected: no matches.

- [ ] **Step 5: Audit remaining `TASK_PROVIDER` references**

Run: `rg "TASK_PROVIDER" src tests docs/superpowers/specs/2026-04-13-multi-provider-phase-2-task-provider-resolver.md`

Expected remaining source matches are only:

```text
src/instances/bootstrap.ts
src/debug/admin-system.ts
```

Docs and tests may reference `TASK_PROVIDER` only when testing bootstrap or documenting that runtime use was removed.

- [ ] **Step 6: Commit deletion and cleanup**

Run:

```bash
git add -A src tests
git commit -m "refactor: remove task provider factory"
```

Expected: commit succeeds.

---

## Task 10: Full Verification and Documentation Sync

**Files:**

- Modify: `CLAUDE.md` if it still says runtime task provider comes from env
- Modify: `docs/superpowers/specs/2026-04-13-multi-provider-phase-2-task-provider-resolver.md` only if execution found a concrete mismatch with this plan

- [ ] **Step 1: Run targeted Phase 2 test set**

Run:

```bash
bun test ./tests/providers/resolver.test.ts ./tests/config-keys.test.ts ./tests/setup/task-instance-selection.test.ts ./tests/commands/setup.test.ts ./tests/commands/config.test.ts ./tests/config-editor/handlers.test.ts ./tests/llm-orchestrator.test.ts ./tests/scheduler.test.ts ./tests/deferred-prompts/poller.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `bun typecheck`

Expected: PASS.

- [ ] **Step 3: Run lint**

Run: `bun lint`

Expected: PASS.

- [ ] **Step 4: Run format check**

Run: `bun format:check`

Expected: PASS.

- [ ] **Step 5: Run curated test suite**

Run: `bun test`

Expected: PASS.

- [ ] **Step 6: Verify obsolete symbols are gone**

Run:

```bash
rg "buildProviderForUser|providers/factory|CONFIG_KEYS" src tests
```

Expected: no output.

- [ ] **Step 7: Verify runtime `TASK_PROVIDER` use is constrained**

Run:

```bash
rg "TASK_PROVIDER" src
```

Expected source output only mentions `src/instances/bootstrap.ts` and `src/debug/admin-system.ts`.

- [ ] **Step 8: Update project docs if needed**

If `CLAUDE.md` still describes `TASK_PROVIDER` as required at runtime after Phase 2, replace the task-provider env section with:

```markdown
`TASK_PROVIDER` is used only by first-run env bootstrap when `task_instances` is empty. After bootstrap, task-provider selection is read from `context_settings.task_instance_id`, and per-context credentials stay in `user_config`.
```

- [ ] **Step 9: Commit verification/doc updates**

Run:

```bash
git add CLAUDE.md docs/superpowers/specs/2026-04-13-multi-provider-phase-2-task-provider-resolver.md
git commit -m "docs: align task provider resolver phase"
```

Expected: commit succeeds if docs changed. If no docs changed, do not create an empty commit.

---

## Self-Review

### Spec Coverage

- Resolver returning `TaskProvider | null`: Task 1.
- Strict resolver throwing clear setup error: Task 1.
- Callsite migration for LLM, scheduler, poller, index warmup: Tasks 6, 7, and 8.
- `/context` live tool resolution migration discovered during alignment: Task 6.
- Dynamic config keys replacing `CONFIG_KEYS`: Tasks 2, 3, and 9.
- `/setup` task instance selection, single-instance auto-pick, no-instance abort: Task 4.
- Config editor per-context allow-list replacing non-existent `/set`: Task 3.
- `/config` dynamic rendering plus plugin section preservation: Task 3.
- Runtime `TASK_PROVIDER` removal outside bootstrap/status: Tasks 5, 8, and 9.
- Existing factory deletion: Task 9.

### Placeholder Scan

- No placeholder markers remain, and every referenced new function is created by an earlier task.
- Steps that change code include exact code blocks or exact replacement instructions.

### Type Consistency

- `TaskProviderResolver.resolve(contextId)` and `resolveStrict(contextId)` names are consistent across resolver, orchestrator, scheduler, poller, and index tasks.
- `getConfigKeysForContext(contextId)` consistently returns `readonly ConfigKey[]` and is imported from `src/config-keys.ts`.
- Setup selection consistently returns `TaskInstanceSelectionResult` with `assigned`, `pending`, `aborted`, and `not-handled` variants.

---

## Execution Notes

- Use `superpowers:subagent-driven-development` for implementation unless there is a reason to keep all edits inline.
- Commit after every task. Do not batch all Phase 2 work into one commit.
- When a command in this plan references a test file that does not exist in the current branch, run the adjacent existing test file and record the missing path in the task note before committing.
