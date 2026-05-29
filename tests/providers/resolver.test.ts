// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { setConfig, setConfigValue } from '../../src/config.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { deleteTaskInstance, insertTaskInstance } from '../../src/instances/task-store.js'
import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../../src/providers/registry.js'
import { TaskProviderResolver } from '../../src/providers/resolver.js'
import type { TaskProviderResolverDeps } from '../../src/providers/resolver.js'
import { setKaneoWorkspace } from '../../src/users.js'
import { createMockProvider } from '../tools/mock-provider.js'
import {
  mockLogger,
  seedCommonTestPlatformInstances,
  seedTestTaskInstance,
  setupTestDb,
} from '../utils/test-helpers.js'

/** Minimal kaneo contributed descriptor for resolver tests that need the kaneo config schema. */
const KANEO_PLUGIN_ID = 'task-provider-kaneo'

const registerKaneoContributed = (): void => {
  registerContributedTaskProviderType('kaneo', {
    pluginId: KANEO_PLUGIN_ID,
    factory: (config) => createMockProvider({ name: 'kaneo', ...config }),
    capabilities: new Set(),
    displayName: 'Kaneo',
    instanceConfigSchema: [
      { key: 'baseUrl', label: 'Kaneo URL', required: true, sensitive: false, scope: 'instance' },
      { key: 'internalUrl', label: 'Kaneo Internal URL', required: false, sensitive: false, scope: 'instance' },
    ],
    contextConfigSchema: [
      {
        key: 'credential',
        label: 'Kaneo API Key',
        required: true,
        sensitive: true,
        scope: 'context',
        storageKey: 'kaneo_apikey',
      },
      {
        key: 'workspaceId',
        label: 'Workspace ID',
        required: true,
        sensitive: false,
        scope: 'context',
        storageKey: 'kaneo_workspace_id',
      },
    ],
    traits: new Set(),
  })
}

describe('TaskProviderResolver', () => {
  const created: Array<{ name: string; config: Record<string, string> }> = []
  const resolverPluginId = 'resolver-provider-plugin'
  const resolverProviderType = 'resolver-plugin-tracker'

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
    seedCommonTestPlatformInstances()
    process.env['INSTANCE_CONFIG_KEY'] = '4'.repeat(64)
    created.length = 0
    unregisterContributedTaskProviderType(resolverPluginId)
  })

  afterEach(() => {
    unregisterContributedTaskProviderType(KANEO_PLUGIN_ID)
  })

  test('returns null when context has no assignment', () => {
    const resolver = makeResolver()

    expect(resolver.resolve('ctx-missing')).toBeNull()
    expect(created).toEqual([])
  })

  test('returns null when assigned task instance was removed', () => {
    seedTestTaskInstance({ id: 'deleted-task' })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'deleted-task', platformInstanceId: 'telegram-default' })
    deleteTaskInstance('deleted-task')
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

  test('returns null when assigned task instance type is not registered', () => {
    insertTaskInstance({ id: 'missing-provider', type: 'ghost-provider', config: {}, status: 'active' })
    setContextSettings({
      contextId: 'ctx-plugin-gone',
      taskInstanceId: 'missing-provider',
      platformInstanceId: 'telegram-default',
    })

    const resolver = new TaskProviderResolver()

    expect(resolver.resolve('ctx-plugin-gone')).toBeNull()
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
    // kaneo is plugin-contributed; credential is stored under the plugin-namespaced key
    registerKaneoContributed()
    insertTaskInstance({ id: 'kaneo-prod', type: 'kaneo', config: { url: 'https://kaneo.invalid' }, status: 'active' })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'kaneo-prod', platformInstanceId: 'telegram-default' })
    setConfigValue('ctx-1', 'plugin:task-provider-kaneo:provider:credential', 'kn-key')
    setKaneoWorkspace('ctx-1', 'workspace-1')
    const resolver = makeResolver()

    const provider = resolver.resolve('ctx-1')

    expect(provider?.name).toBe('kaneo')
    expect(created).toEqual([
      { name: 'kaneo', config: { baseUrl: 'https://kaneo.invalid', credential: 'kn-key', workspaceId: 'workspace-1' } },
    ])
  })

  test('builds a Kaneo provider with session cookie credentials', () => {
    // kaneo is plugin-contributed; credential is stored under the plugin-namespaced key
    registerKaneoContributed()
    insertTaskInstance({
      id: 'kaneo-prod',
      type: 'kaneo',
      config: { baseUrl: 'https://kaneo.invalid' },
      status: 'active',
    })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'kaneo-prod', platformInstanceId: 'telegram-default' })
    setConfigValue('ctx-1', 'plugin:task-provider-kaneo:provider:credential', 'better-auth.session_token=abc')
    setKaneoWorkspace('ctx-1', 'workspace-1')
    const resolver = makeResolver()

    const provider = resolver.resolve('ctx-1')

    expect(provider?.name).toBe('kaneo')
    expect(created).toEqual([
      {
        name: 'kaneo',
        config: {
          baseUrl: 'https://kaneo.invalid',
          credential: 'better-auth.session_token=abc',
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

  test('resolves a contributed provider type by passing instance config through unchanged', () => {
    insertTaskInstance({
      id: 'demo-1',
      type: 'demo-tracker',
      config: { baseUrl: 'https://demo.invalid', region: 'eu' },
      status: 'active',
    })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'demo-1', platformInstanceId: 'telegram-default' })
    const resolver = makeResolver()

    const provider = resolver.resolve('ctx-1')

    expect(provider).not.toBeNull()
    expect(created).toEqual([{ name: 'demo-tracker', config: { baseUrl: 'https://demo.invalid', region: 'eu' } }])
  })

  test('sources a contributed type context field via plugin provider storage key', () => {
    insertTaskInstance({
      id: 'custom-1',
      type: 'custom-tracker',
      config: { baseUrl: 'https://custom.invalid' },
      status: 'active',
    })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'custom-1', platformInstanceId: 'telegram-default' })

    const getConfig = mock((_ctx: string, _key: string) => 'tok-123')
    const deps: Partial<TaskProviderResolverDeps> = {
      getTaskProviderDescriptor: (_type: string) => ({
        type: 'custom-tracker',
        displayName: 'Custom Tracker',
        source: { plugin: 'test-plugin' } as const,
        instanceConfigSchema: [
          { key: 'baseUrl', label: 'URL', required: true, sensitive: false, scope: 'instance' as const },
        ],
        contextConfigSchema: [
          { key: 'apiToken', label: 'API Token', required: true, sensitive: true, scope: 'context' as const },
        ],
        capabilities: new Set(),
        traits: new Set(),
        configSchema: [
          { key: 'baseUrl', label: 'URL', required: true, sensitive: false, scope: 'instance' as const },
          { key: 'apiToken', label: 'API Token', required: true, sensitive: true, scope: 'context' as const },
        ],
      }),
      getConfig: getConfig as TaskProviderResolverDeps['getConfig'],
      createProvider: (name, config) => {
        created.push({ name, config })
        return createMockProvider({ name })
      },
    }
    const resolver = new TaskProviderResolver(deps)

    const provider = resolver.resolve('ctx-1')

    expect(provider).not.toBeNull()
    expect(getConfig).toHaveBeenCalledWith('ctx-1', 'plugin:test-plugin:provider:apiToken')
    expect(created).toEqual([
      { name: 'custom-tracker', config: { baseUrl: 'https://custom.invalid', apiToken: 'tok-123' } },
    ])
  })

  // Task 3.7 will remove the kaneo special-case branch in resolver.ts and route workspaceId
  // through getConfig(contextId, 'kaneo_workspace_id') like every other context-scoped field.
  // Until then, the resolver's getKaneoWorkspace dep is what supplies workspaceId; this test
  // documents that the special-case branch is what resolves workspaceId and that the dep is
  // consulted — not getConfig — for the kaneo workspaceId field specifically.
  // Kaneo is now plugin-contributed; the special-case branch fires on descriptor.type === 'kaneo'.
  test('resolves kaneo workspaceId via getKaneoWorkspace dep (Task 3.7 will route via getConfig)', () => {
    registerKaneoContributed()
    // getConfig always returns 'k-abc' so the credential field resolves; workspaceId is
    // short-circuited by the special-case branch before getConfig is reached.
    const getConfig = mock((_contextId: string, _key: string): string | null => 'k-abc')
    const getKaneoWorkspace = mock((_contextId: string): string | null => 'ws-from-dep')
    const capturedProviderConfigs: Array<Record<string, string>> = []
    const resolver = new TaskProviderResolver({
      getContextSettings: (): ReturnType<TaskProviderResolverDeps['getContextSettings']> => ({
        contextId: 'ctx-1',
        taskInstanceId: 'kaneo-1',
        platformInstanceId: 'telegram-default',
      }),
      getTaskInstance: (): ReturnType<TaskProviderResolverDeps['getTaskInstance']> => ({
        id: 'kaneo-1',
        type: 'kaneo',
        config: { baseUrl: 'https://kaneo.invalid' },
        status: 'active',
        createdAt: '2026-05-28T00:00:00.000Z',
      }),
      getKaneoWorkspace: getKaneoWorkspace as TaskProviderResolverDeps['getKaneoWorkspace'],
      getConfig: getConfig as TaskProviderResolverDeps['getConfig'],
      createProvider: (
        type: string,
        config: Record<string, string>,
      ): ReturnType<TaskProviderResolverDeps['createProvider']> => {
        capturedProviderConfigs.push(config)
        return createMockProvider({ name: type })
      },
    })

    const provider = resolver.resolve('ctx-1')

    // Resolution succeeds
    expect(provider).not.toBeNull()
    // The getKaneoWorkspace dep was consulted for workspaceId (special-case branch in resolver.ts:48)
    expect(getKaneoWorkspace).toHaveBeenCalledWith('ctx-1')
    // getConfig is consulted for the credential field using the plugin-contributed storage key path
    // (kaneo is no longer builtin; Task 3.7 will route workspaceId through getConfig as well)
    expect(getConfig).toHaveBeenCalledWith('ctx-1', 'plugin:task-provider-kaneo:provider:credential')
    // Provider was created with workspaceId sourced from getKaneoWorkspace (not getConfig)
    expect(capturedProviderConfigs[0]).toEqual({
      baseUrl: 'https://kaneo.invalid',
      credential: 'k-abc',
      workspaceId: 'ws-from-dep',
    })
  })

  test('requires plugin provider context credentials before invoking factory', () => {
    const factory = mock(() => createMockProvider({ name: resolverProviderType }))
    registerContributedTaskProviderType(resolverProviderType, {
      pluginId: resolverPluginId,
      factory,
      capabilities: new Set(),
      displayName: 'Plugin Tracker',
      instanceConfigSchema: [
        { key: 'baseUrl', label: 'Base URL', required: true, sensitive: false, scope: 'instance' },
      ],
      contextConfigSchema: [{ key: 'token', label: 'Token', required: true, sensitive: true, scope: 'context' }],
      traits: new Set(),
    })
    try {
      insertTaskInstance({
        id: 'resolver-plugin-1',
        type: resolverProviderType,
        config: { baseUrl: 'https://tracker.invalid' },
        status: 'active',
      })
      setContextSettings({
        contextId: 'ctx-resolver-plugin',
        taskInstanceId: 'resolver-plugin-1',
        platformInstanceId: 'telegram-default',
      })
      const resolver = new TaskProviderResolver()

      let provider = resolver.resolve('ctx-resolver-plugin')

      expect(factory).not.toHaveBeenCalled()
      expect(provider).toBeNull()

      setConfigValue('ctx-resolver-plugin', `plugin:${resolverPluginId}:provider:token`, 'secret-token')
      provider = resolver.resolve('ctx-resolver-plugin')

      expect(provider?.name).toBe(resolverProviderType)
      expect(factory).toHaveBeenCalledWith({ baseUrl: 'https://tracker.invalid', token: 'secret-token' })
    } finally {
      unregisterContributedTaskProviderType(resolverPluginId)
    }
  })
})
