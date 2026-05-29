// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { ChatRouter } from '../../src/chat/router.js'
import type { ChatCapability } from '../../src/chat/types.js'
import { clearRuntimeChatRouter, setRuntimeChatRouter } from '../../src/debug/chat-router-runtime.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { namespacedCommandName, registerPluginCommands } from '../../src/plugins/command-contributions.js'
import {
  buildPluginToolSet,
  contributionRegistry,
  namespacedJobName,
  namespacedToolName,
  runPluginScheduledJob,
  sanitizePluginId,
  type PluginScheduledJobDeps,
  type PluginToolSetRuntime,
} from '../../src/plugins/contributions.js'
import {
  MAX_FRAGMENT_LENGTH_PER_PLUGIN,
  MAX_TOTAL_PLUGIN_PROMPT_LENGTH,
  buildPluginPromptSection,
} from '../../src/plugins/prompt-contributions.js'
import {
  pluginRegistry,
  resetPluginRegistryForTesting,
  setPluginEnabledForContext,
} from '../../src/plugins/registry.js'
import { getRecentRuntimeEvents } from '../../src/plugins/store.js'
import type { DiscoveredPlugin, PluginContributions, PluginManifest } from '../../src/plugins/types.js'
import { scheduler } from '../../src/scheduler-instance.js'
import { createMockProvider } from '../tools/mock-provider.js'
import {
  createAuth,
  createDmMessage,
  createMockChatWithCommandHandlers,
  getToolExecutor,
  mockLogger,
  seedTestPlatformInstance,
  seedTestTaskInstance,
  setupTestDb,
} from '../utils/test-helpers.js'

type ManifestOverrides = Omit<Partial<PluginManifest>, 'contributes'> &
  Partial<Record<'contributes', Partial<PluginManifest['contributes']>>>

type MakeManifestArgs = readonly [] | readonly [overrides: ManifestOverrides]

type MakeRuntimeArgs = readonly [] | readonly [overrides: Partial<PluginToolSetRuntime>]

function getManifestOverrides(args: MakeManifestArgs): ManifestOverrides {
  if (args.length === 0) return {}
  return args[0]
}

function getRuntimeOverrides(args: MakeRuntimeArgs): Partial<PluginToolSetRuntime> {
  if (args.length === 0) return {}
  return args[0]
}

function makeManifest(...args: MakeManifestArgs): PluginManifest {
  const overrides = getManifestOverrides(args)
  const base: PluginManifest = {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A test plugin',
    apiVersion: 1,
    main: 'index.ts',
    contributes: {
      tools: ['my_tool'],
      promptFragments: ['hint'],
      commands: [],
      jobs: [],
      configKeys: [],
      taskProviderTypes: [],
    },
    permissions: [],
    defaultEnabled: false,
    activationTimeoutMs: 5000,
    requiredTaskCapabilities: [],
    requiredChatCapabilities: [],
    configRequirements: [],
    providerCapabilities: [],
    providerConfigSchema: [],
    providerAllowedHosts: [],
  }
  return { ...base, ...overrides, contributes: { ...base.contributes, ...overrides.contributes } }
}

function makeRuntime(...args: MakeRuntimeArgs): PluginToolSetRuntime {
  return {
    provider: createMockProvider(),
    storageContextId: 'ctx-1',
    chatUserId: 'user-1',
    ...getRuntimeOverrides(args),
  }
}

function makeDiscoveredPlugin(manifest: PluginManifest): DiscoveredPlugin {
  return {
    manifest,
    pluginDir: `/tmp/${manifest.id}`,
    entryPoint: `/tmp/${manifest.id}/index.ts`,
    manifestHash: `hash-${manifest.id}`,
  }
}

function markPluginActive(manifest: PluginManifest): void {
  const plugin = makeDiscoveredPlugin(manifest)
  pluginRegistry.registerDiscovered(plugin)
  pluginRegistry.markActive(manifest.id)
}

class ThrowingCapabilityRouter extends ChatRouter {
  constructor() {
    super(() => {
      throw new Error('unused test factory')
    })
  }

  override getPlatformInstanceCapabilities(platformInstanceId: string): ReadonlySet<ChatCapability> {
    if (platformInstanceId === 'platform-a') throw new Error('eligibility boom')
    return new Set(['messages.buttons'])
  }
}

describe('sanitizePluginId', () => {
  test('replaces hyphens with underscores', () => {
    expect(sanitizePluginId('my-plugin')).toBe('my_plugin')
    expect(sanitizePluginId('a-b-c')).toBe('a_b_c')
  })

  test('leaves non-hyphen characters unchanged', () => {
    expect(sanitizePluginId('myplugin')).toBe('myplugin')
    expect(sanitizePluginId('plugin123')).toBe('plugin123')
  })
})

describe('namespacedToolName', () => {
  test('namespaces correctly', () => {
    expect(namespacedToolName('my-plugin', 'my_tool')).toBe('plugin_my_plugin__my_tool')
  })

  test('handles no-hyphen plugin IDs', () => {
    expect(namespacedToolName('myplugin', 'search')).toBe('plugin_myplugin__search')
  })
})

describe('plugin command and job naming', () => {
  test('namespaces commands under a safe plugin command name', () => {
    expect(namespacedCommandName('my-plugin', 'sync')).toBe('plugin_my_plugin_sync')
  })

  test('namespaces scheduled jobs under a stable plugin owner', () => {
    expect(namespacedJobName('my-plugin', 'daily')).toBe('plugin:my-plugin:daily')
  })
})

describe('PluginContributionRegistry', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    resetPluginRegistryForTesting()
    contributionRegistry.deregister('test-plugin')
    contributionRegistry.deregister('other-plugin')
  })

  afterEach(() => {
    contributionRegistry.deregister('test-plugin')
    contributionRegistry.deregister('other-plugin')
    resetPluginRegistryForTesting()
    clearRuntimeChatRouter()
  })

  test('registers and retrieves contributions', () => {
    const manifest = makeManifest()
    const contributions: PluginContributions = {
      tools: [
        {
          name: 'my_tool',
          description: 'A test tool',
          execute: () => Promise.resolve<unknown>('ok'),
        },
      ],
      promptFragments: [{ name: 'hint', content: 'Use this hint' }],
    }
    contributionRegistry.register('test-plugin', contributions, manifest)
    const result = contributionRegistry.getContributions('test-plugin')
    expect(result).toBeDefined()
    expect(result!.tools).toHaveLength(1)
    expect(result!.promptFragments).toHaveLength(1)
  })

  test('filters out undeclared tools', () => {
    const manifest = makeManifest({
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: [],
      },
    })
    const contributions: PluginContributions = {
      tools: [
        {
          name: 'undeclared_tool',
          description: 'Not in manifest',
          execute: () => Promise.resolve<unknown>(''),
        },
      ],
      promptFragments: [],
    }
    contributionRegistry.register('test-plugin', contributions, manifest)
    const result = contributionRegistry.getContributions('test-plugin')
    expect(result!.tools).toHaveLength(0)
  })

  test('filters out undeclared prompt fragments', () => {
    const manifest = makeManifest({
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: [],
      },
    })
    const contributions: PluginContributions = {
      tools: [],
      promptFragments: [{ name: 'undeclared', content: 'nope' }],
    }
    contributionRegistry.register('test-plugin', contributions, manifest)
    const result = contributionRegistry.getContributions('test-plugin')
    expect(result!.promptFragments).toHaveLength(0)
  })

  test('deregister removes contributions', () => {
    const manifest = makeManifest()
    contributionRegistry.register('test-plugin', { tools: [], promptFragments: [] }, manifest)
    contributionRegistry.deregister('test-plugin')
    expect(contributionRegistry.getContributions('test-plugin')).toBeUndefined()
  })

  test('registers declared plugin commands with namespaced chat commands', async () => {
    let executed = false
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
    setPluginEnabledForContext('test-plugin', 'user-1', true)
    const { provider, commandHandlers } = createMockChatWithCommandHandlers()

    registerPluginCommands(provider)
    const handler = commandHandlers.get('plugin_test_plugin_sync')
    expect(handler).toBeDefined()
    await handler!(
      createDmMessage('user-1'),
      {
        text: () => Promise.resolve(),
        formatted: () => Promise.resolve(),
        typing: () => {},
        buttons: () => Promise.resolve(),
      },
      createAuth('user-1'),
    )

    expect(commandHandlers.has('plugin_test_plugin_sync')).toBe(true)
    expect(executed).toBe(true)
  })

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

  test('runs scheduled jobs only for explicitly enabled plugin contexts', async () => {
    const seenContexts: string[] = []
    const manifest = makeManifest({
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
    setPluginEnabledForContext('test-plugin', 'ctx-enabled', true)
    setPluginEnabledForContext('test-plugin', 'ctx-disabled', false)

    await runPluginScheduledJob('test-plugin', 'daily')

    expect(seenContexts).toEqual(['ctx-enabled'])
    expect(scheduler.hasTask('plugin:test-plugin:daily')).toBe(true)
    const taskState = scheduler.getTaskState('plugin:test-plugin:daily')
    expect(taskState).toBeDefined()
    expect(taskState!.running).toBe(true)
  })

  test('scheduled jobs include configured and explicit contexts once when plugin is default enabled', async () => {
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
    setPluginEnabledForContext('test-plugin', 'ctx-default-a', true)
    setPluginEnabledForContext('test-plugin', 'ctx-default-b', false)
    setPluginEnabledForContext('test-plugin', 'ctx-explicit', true)
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

    expect(seenContexts).toHaveLength(2)
    expect(new Set(seenContexts)).toEqual(new Set(['ctx-default-a', 'ctx-explicit']))
  })

  test('scheduled jobs skip contexts that are not plugin eligible', async () => {
    const seenContexts: string[] = []
    const manifest = makeManifest({
      contributes: { tools: [], promptFragments: [], commands: [], jobs: ['daily'], configKeys: [] },
      configRequirements: [{ key: 'api_token', label: 'API Token', required: true, sensitive: true, scope: 'context' }],
    })
    markPluginActive(manifest)
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
    markPluginActive(manifest)
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

  test('scheduled jobs continue after one context task resolver throws', async () => {
    const seenContexts: string[] = []
    const resolverByContext = new Map([
      [
        'ctx-a',
        (): ReturnType<PluginScheduledJobDeps['resolveTaskProvider']> => {
          throw new Error('resolver boom')
        },
      ],
      ['ctx-b', (): ReturnType<PluginScheduledJobDeps['resolveTaskProvider']> => createMockProvider()],
    ])
    const manifest = makeManifest({
      permissions: ['tasks.read'],
      contributes: { tools: [], promptFragments: [], commands: [], jobs: ['daily'], configKeys: [] },
    })
    markPluginActive(manifest)
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
    setPluginEnabledForContext('test-plugin', 'ctx-a', true)
    setPluginEnabledForContext('test-plugin', 'ctx-b', true)

    await runPluginScheduledJob('test-plugin', 'daily', {
      resolveTaskProvider: (contextId) => {
        const resolver = resolverByContext.get(contextId)
        expect(resolver).toBeDefined()
        return resolver!()
      },
    })

    expect(seenContexts).toEqual(['ctx-b'])
  })

  test('scheduled jobs continue after one context eligibility check throws', async () => {
    const seenContexts: string[] = []
    const manifest = makeManifest({
      requiredChatCapabilities: ['messages.buttons'],
      contributes: { tools: [], promptFragments: [], commands: [], jobs: ['daily'], configKeys: [] },
    })
    markPluginActive(manifest)
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
    setRuntimeChatRouter(new ThrowingCapabilityRouter())
    seedTestPlatformInstance({ id: 'platform-a' })
    seedTestPlatformInstance({ id: 'platform-b' })
    seedTestTaskInstance({ id: 'task-a' })
    seedTestTaskInstance({ id: 'task-b' })
    setContextSettings({ contextId: 'ctx-a', taskInstanceId: 'task-a', platformInstanceId: 'platform-a' })
    setContextSettings({ contextId: 'ctx-b', taskInstanceId: 'task-b', platformInstanceId: 'platform-b' })
    setPluginEnabledForContext('test-plugin', 'ctx-a', true)
    setPluginEnabledForContext('test-plugin', 'ctx-b', true)

    await runPluginScheduledJob('test-plugin', 'daily')

    expect(seenContexts).toEqual(['ctx-b'])
  })

  test('scheduled jobs require resolver for tasks.write plugins', async () => {
    const seenContexts: string[] = []
    const resolvedContexts: string[] = []
    const manifest = makeManifest({
      permissions: ['tasks.write'],
      contributes: { tools: [], promptFragments: [], commands: [], jobs: ['daily'], configKeys: [] },
    })
    markPluginActive(manifest)
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

  test('scheduled jobs require resolver for required task capabilities', async () => {
    const seenContexts: string[] = []
    const resolvedContexts: string[] = []
    const manifest = makeManifest({
      requiredTaskCapabilities: ['workItems.list'],
      contributes: { tools: [], promptFragments: [], commands: [], jobs: ['daily'], configKeys: [] },
    })
    markPluginActive(manifest)
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
    const executions = new Map<string, () => void>([
      [
        'ctx-a',
        (): void => {
          throw new Error('boom')
        },
      ],
      [
        'ctx-b',
        (): void => {
          seenContexts.push('ctx-b')
        },
      ],
    ])
    const manifest = makeManifest({
      contributes: { tools: [], promptFragments: [], commands: [], jobs: ['daily'], configKeys: [] },
    })
    markPluginActive(manifest)
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
              const execution = executions.get(contextId)
              expect(execution).toBeDefined()
              execution!()
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

  test('deregister removes scheduled jobs owned by the plugin', () => {
    const manifest = makeManifest({
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: ['daily'],
        configKeys: [],
        taskProviderTypes: [],
      },
    })
    contributionRegistry.register(
      'test-plugin',
      {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [{ name: 'daily', intervalMs: 60_000, execute: (): undefined => undefined }],
      },
      manifest,
    )

    contributionRegistry.deregister('test-plugin')

    expect(scheduler.hasTask('plugin:test-plugin:daily')).toBe(false)
  })
})

describe('buildPluginToolSet', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    contributionRegistry.deregister('test-plugin')
  })

  afterEach(() => {
    contributionRegistry.deregister('test-plugin')
  })

  test('returns empty ToolSet when no plugins active', () => {
    const tools = buildPluginToolSet([], new Set(), makeRuntime())
    expect(Object.keys(tools)).toHaveLength(0)
  })

  test('wraps and namespaces plugin tools', () => {
    const manifest = makeManifest()
    contributionRegistry.register(
      'test-plugin',
      {
        tools: [
          {
            name: 'my_tool',
            description: 'A test tool',
            execute: (): Promise<unknown> => Promise.resolve('ok'),
          },
        ],
        promptFragments: [],
      },
      manifest,
    )
    const tools = buildPluginToolSet(['test-plugin'], new Set(), makeRuntime())
    expect(Object.keys(tools)).toContain('plugin_test_plugin__my_tool')
  })

  test('passes active runtime context to plugin tool executions', async () => {
    const manifest = makeManifest({ permissions: ['storage', 'tasks.read'] })
    contributionRegistry.register(
      'test-plugin',
      {
        tools: [
          {
            name: 'my_tool',
            description: 'A test tool',
            execute: (_input, runtimeContext): Promise<unknown> =>
              Promise.resolve({
                storageContextId: runtimeContext.storageContextId,
                chatUserId: runtimeContext.chatUserId,
                kvValue: runtimeContext.kv.get('runtime-key'),
              }),
          },
        ],
        promptFragments: [],
      },
      manifest,
    )
    const tools = buildPluginToolSet(['test-plugin'], new Set(), {
      provider: createMockProvider(),
      storageContextId: 'ctx-1',
      chatUserId: 'user-1',
    })
    const execute = getToolExecutor(tools['plugin_test_plugin__my_tool'])

    const result = await execute({}, { toolCallId: 'call-1' })

    expect(result).toEqual({ storageContextId: 'ctx-1', chatUserId: 'user-1', kvValue: undefined })
  })

  test('exposes read facade when tasks.read permission is declared', async () => {
    const manifest = makeManifest({ permissions: ['tasks.read'] })
    const getTaskResult = { id: 'task-1', title: 'Task 1', url: 'https://example.test/task-1' }
    const provider = createMockProvider({
      getTask: () => Promise.resolve(getTaskResult),
    })
    contributionRegistry.register(
      'test-plugin',
      {
        tools: [
          {
            name: 'my_tool',
            description: 'A test tool',
            execute: (_input, runtimeContext): Promise<unknown> => runtimeContext.taskProvider.getTask('task-1'),
          },
        ],
        promptFragments: [],
      },
      manifest,
    )

    const tools = buildPluginToolSet(['test-plugin'], new Set(), {
      provider,
      storageContextId: 'ctx-1',
      chatUserId: 'user-1',
    })
    const execute = getToolExecutor(tools['plugin_test_plugin__my_tool'])

    await expect(execute({}, { toolCallId: 'call-1' })).resolves.toEqual(getTaskResult)
  })

  test('fails closed when tasks.read permission is missing', async () => {
    const manifest = makeManifest({ permissions: [] })
    contributionRegistry.register(
      'test-plugin',
      {
        tools: [
          {
            name: 'my_tool',
            description: 'A test tool',
            execute: (_input, runtimeContext): Promise<unknown> => runtimeContext.taskProvider.getTask('task-1'),
          },
        ],
        promptFragments: [],
      },
      manifest,
    )
    const tools = buildPluginToolSet(['test-plugin'], new Set(), {
      provider: createMockProvider(),
      storageContextId: 'ctx-1',
      chatUserId: 'user-1',
    })
    const execute = getToolExecutor(tools['plugin_test_plugin__my_tool'])

    const result = await execute({}, { toolCallId: 'call-1' })

    expect(result).toMatchObject({
      success: false,
      toolName: 'plugin_test_plugin__my_tool',
      errorType: 'tool-execution',
    })
    expect(result).toHaveProperty(
      'error',
      expect.stringContaining("Plugin test-plugin does not have 'tasks.read' permission"),
    )
  })

  test('fails closed when tasks.write permission is missing', async () => {
    const manifest = makeManifest({ permissions: [] })
    contributionRegistry.register(
      'test-plugin',
      {
        tools: [
          {
            name: 'my_tool',
            description: 'A test tool',
            execute: (_input, runtimeContext): Promise<unknown> =>
              runtimeContext.taskProvider.createTask({ projectId: 'project-1', title: 'New task' }),
          },
        ],
        promptFragments: [],
      },
      manifest,
    )
    const tools = buildPluginToolSet(['test-plugin'], new Set(), {
      provider: createMockProvider(),
      storageContextId: 'ctx-1',
      chatUserId: 'user-1',
    })
    const execute = getToolExecutor(tools['plugin_test_plugin__my_tool'])

    const result = await execute({}, { toolCallId: 'call-1' })

    expect(result).toMatchObject({
      success: false,
      toolName: 'plugin_test_plugin__my_tool',
      errorType: 'tool-execution',
    })
    expect(result).toHaveProperty(
      'error',
      expect.stringContaining("Plugin test-plugin does not have 'tasks.write' permission"),
    )
  })

  test('skips tools that collide with existing tool names and records a runtime event', () => {
    const manifest = makeManifest()
    contributionRegistry.register(
      'test-plugin',
      {
        tools: [
          {
            name: 'my_tool',
            description: 'A test tool',
            execute: (): Promise<unknown> => Promise.resolve('ok'),
          },
        ],
        promptFragments: [],
      },
      manifest,
    )
    const existing = new Set(['plugin_test_plugin__my_tool'])

    const firstTools = buildPluginToolSet(['test-plugin'], existing, makeRuntime())
    const secondTools = buildPluginToolSet(['test-plugin'], existing, makeRuntime())
    const events = getRecentRuntimeEvents('test-plugin', 5)

    expect(Object.keys(firstTools)).toHaveLength(0)
    expect(Object.keys(secondTools)).toHaveLength(0)
    expect(events).toHaveLength(1)
    expect(events[0]?.eventType).toBe('skipped')
    expect(events[0]?.message).toBe(
      "Tool contribution 'plugin_test_plugin__my_tool' skipped because the name already exists",
    )
  })
})

describe('buildPluginPromptSection', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    contributionRegistry.deregister('test-plugin')
  })

  afterEach(() => {
    contributionRegistry.deregister('test-plugin')
  })

  test('returns empty string when no active plugins', () => {
    expect(buildPluginPromptSection([])).toBe('')
  })

  test('wraps fragment in plugin delimiters', () => {
    const manifest = makeManifest()
    contributionRegistry.register(
      'test-plugin',
      { tools: [], promptFragments: [{ name: 'hint', content: 'Hello from plugin!' }] },
      manifest,
    )
    const section = buildPluginPromptSection(['test-plugin'])
    expect(section).toContain('<!-- plugin:test-plugin:hint -->')
    expect(section).toContain('Hello from plugin!')
    expect(section).toContain('<!-- /plugin:test-plugin:hint -->')
  })

  test('calls function-based content at render time', () => {
    const manifest = makeManifest()
    let called = false
    contributionRegistry.register(
      'test-plugin',
      {
        tools: [],
        promptFragments: [
          {
            name: 'hint',
            content: (): string => {
              called = true
              return 'dynamic!'
            },
          },
        ],
      },
      manifest,
    )
    buildPluginPromptSection(['test-plugin'])
    expect(called).toBe(true)
  })

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

  test('truncates fragment exceeding per-plugin limit', () => {
    const manifest = makeManifest()
    const longContent = 'x'.repeat(MAX_FRAGMENT_LENGTH_PER_PLUGIN + 100)
    contributionRegistry.register(
      'test-plugin',
      { tools: [], promptFragments: [{ name: 'hint', content: longContent }] },
      manifest,
    )
    const section = buildPluginPromptSection(['test-plugin'])
    expect(section.length).toBeLessThan(MAX_TOTAL_PLUGIN_PROMPT_LENGTH)
  })
})
