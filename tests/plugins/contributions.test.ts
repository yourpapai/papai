// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { namespacedCommandName, registerPluginCommands } from '../../src/plugins/command-contributions.js'
import {
  buildPluginToolSet,
  contributionRegistry,
  namespacedJobName,
  namespacedToolName,
  runPluginScheduledJob,
  sanitizePluginId,
  type PluginToolSetRuntime,
} from '../../src/plugins/contributions.js'
import {
  MAX_FRAGMENT_LENGTH_PER_PLUGIN,
  MAX_TOTAL_PLUGIN_PROMPT_LENGTH,
  buildPluginPromptSection,
} from '../../src/plugins/prompt-contributions.js'
import { setPluginEnabledForContext } from '../../src/plugins/registry.js'
import type { PluginContributions, PluginManifest } from '../../src/plugins/types.js'
import { scheduler } from '../../src/scheduler-instance.js'
import { createMockProvider } from '../tools/mock-provider.js'
import {
  createAuth,
  createDmMessage,
  createMockChatWithCommandHandlers,
  getToolExecutor,
  mockLogger,
  setupTestDb,
} from '../utils/test-helpers.js'

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
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
    ...overrides,
  }
}

function makeRuntime(overrides: Partial<PluginToolSetRuntime> = {}): PluginToolSetRuntime {
  return {
    provider: createMockProvider(),
    storageContextId: 'ctx-1',
    chatUserId: 'user-1',
    ...overrides,
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
    contributionRegistry.deregister('test-plugin')
    contributionRegistry.deregister('other-plugin')
  })

  afterEach(() => {
    contributionRegistry.deregister('test-plugin')
    contributionRegistry.deregister('other-plugin')
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
    expect(result?.tools).toHaveLength(1)
    expect(result?.promptFragments).toHaveLength(1)
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
    expect(result?.tools).toHaveLength(0)
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
    expect(result?.promptFragments).toHaveLength(0)
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
    const { provider, commandHandlers } = createMockChatWithCommandHandlers()

    registerPluginCommands(provider)
    await commandHandlers.get('plugin_test_plugin_sync')?.(
      createDmMessage('user-1'),
      {
        text: () => Promise.resolve(),
        formatted: () => Promise.resolve(),
        typing: () => undefined,
        buttons: () => Promise.resolve(),
      },
      createAuth('user-1'),
    )

    expect(commandHandlers.has('plugin_test_plugin_sync')).toBe(true)
    expect(executed).toBe(true)
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
    expect(scheduler.getTaskState('plugin:test-plugin:daily')?.running).toBe(true)
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

  test('skips tools that collide with existing tool names', () => {
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
    const tools = buildPluginToolSet(['test-plugin'], existing, makeRuntime())
    expect(Object.keys(tools)).toHaveLength(0)
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
