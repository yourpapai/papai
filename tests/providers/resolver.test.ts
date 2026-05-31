// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { setConfigValue } from '../../src/config.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { deleteTaskInstance, insertTaskInstance } from '../../src/instances/task-store.js'
import {
  validateTaskInstanceConfigResult,
  type TaskInstanceConfigValidationDeps,
} from '../../src/providers/config-validation.js'
import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../../src/providers/registry.js'
import { TaskProviderResolver } from '../../src/providers/resolver.js'
import type { TaskProviderResolverDeps } from '../../src/providers/resolver.js'
import { createMockProvider } from '../tools/mock-provider.js'
import {
  mockLogger,
  seedCommonTestPlatformInstances,
  seedTestTaskInstance,
  setupTestDb,
} from '../utils/test-helpers.js'

/** Minimal kaneo contributed descriptor for resolver tests that need the kaneo config schema. */
const KANEO_PLUGIN_ID = 'task-provider-kaneo'
const YOUTRACK_PLUGIN_ID = 'task-provider-youtrack'

const registerYouTrackContributed = (): void => {
  registerContributedTaskProviderType('youtrack', {
    pluginId: YOUTRACK_PLUGIN_ID,
    factory: (config) => createMockProvider({ name: 'youtrack', ...config }),
    capabilities: new Set(),
    displayName: 'YouTrack',
    instanceConfigSchema: [
      { key: 'baseUrl', label: 'YouTrack URL', required: true, sensitive: false, scope: 'instance' },
    ],
    contextConfigSchema: [
      {
        key: 'token',
        label: 'YouTrack Permanent Token',
        required: true,
        sensitive: true,
        scope: 'context',
      },
    ],
    traits: new Set(),
  })
}

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
      },
      {
        key: 'workspaceId',
        label: 'Workspace ID',
        required: true,
        sensitive: false,
        scope: 'context',
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
    unregisterContributedTaskProviderType(YOUTRACK_PLUGIN_ID)
  })

  test('returns null when context has no assignment', async () => {
    const resolver = makeResolver()

    expect(await resolver.resolve('ctx-missing')).toBeNull()
    expect(created).toEqual([])
  })

  test('returns null when assigned task instance was removed', async () => {
    seedTestTaskInstance({ id: 'deleted-task' })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'deleted-task', platformInstanceId: 'telegram-default' })
    deleteTaskInstance('deleted-task')
    const resolver = makeResolver()

    expect(await resolver.resolve('ctx-1')).toBeNull()
    expect(created).toEqual([])
  })

  test('returns null when assigned task instance is not active', async () => {
    insertTaskInstance({
      id: 'yt-stopped',
      type: 'youtrack',
      config: { baseUrl: 'https://yt.invalid' },
      status: 'stopped',
    })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'yt-stopped', platformInstanceId: 'telegram-default' })
    // Provider token is now plugin-namespaced
    setConfigValue('ctx-1', 'plugin:task-provider-youtrack:provider:token', 'perm:abc')
    const resolver = makeResolver()

    expect(await resolver.resolve('ctx-1')).toBeNull()
    expect(created).toEqual([])
  })

  test('returns null when assigned task instance type is not registered', async () => {
    insertTaskInstance({ id: 'missing-provider', type: 'ghost-provider', config: {}, status: 'active' })
    setContextSettings({
      contextId: 'ctx-plugin-gone',
      taskInstanceId: 'missing-provider',
      platformInstanceId: 'telegram-default',
    })

    const resolver = new TaskProviderResolver()

    expect(await resolver.resolve('ctx-plugin-gone')).toBeNull()
  })

  test('resolve returns null without calling createProvider when the descriptor is unknown', async () => {
    const createProvider = mock((): ReturnType<TaskProviderResolverDeps['createProvider']> => {
      throw new Error('createProvider must not be called for unknown descriptor')
    })
    const resolver = new TaskProviderResolver({
      getContextSettings: (): ReturnType<TaskProviderResolverDeps['getContextSettings']> => ({
        contextId: 'c',
        taskInstanceId: 't',
        platformInstanceId: 'p',
      }),
      getTaskInstance: (): ReturnType<TaskProviderResolverDeps['getTaskInstance']> => ({
        id: 't',
        type: 'ghost',
        config: { baseUrl: 'https://x' },
        status: 'active',
        createdAt: '2026-05-31T00:00:00.000Z',
      }),
      getTaskProviderDescriptor: (): ReturnType<TaskProviderResolverDeps['getTaskProviderDescriptor']> => undefined,
      getTaskProviderConfigValidator: (): ReturnType<TaskProviderResolverDeps['getTaskProviderConfigValidator']> =>
        undefined,
      getConfig: (): ReturnType<TaskProviderResolverDeps['getConfig']> => null,
      createProvider,
    })
    expect(await resolver.resolve('c')).toBeNull()
    expect(createProvider).not.toHaveBeenCalled()
  })

  test('builds a YouTrack provider from instance baseUrl and per-context token', async () => {
    // youtrack is now plugin-contributed; register it so the resolver knows its config schema
    registerYouTrackContributed()
    insertTaskInstance({ id: 'yt-prod', type: 'youtrack', config: { baseUrl: 'https://yt.invalid' }, status: 'active' })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'yt-prod', platformInstanceId: 'telegram-default' })
    // youtrack token is sourced via plugin-namespaced key (contributed provider path)
    setConfigValue('ctx-1', 'plugin:task-provider-youtrack:provider:token', 'perm:abc')
    const resolver = makeResolver()

    const provider = await resolver.resolve('ctx-1')

    expect(provider?.name).toBe('youtrack')
    expect(created).toEqual([{ name: 'youtrack', config: { baseUrl: 'https://yt.invalid', token: 'perm:abc' } }])
  })

  test('builds a Kaneo provider from instance baseUrl, API key, and workspace ID', async () => {
    // kaneo is plugin-contributed; credential and workspaceId are stored under plugin-namespaced keys
    registerKaneoContributed()
    insertTaskInstance({
      id: 'kaneo-prod',
      type: 'kaneo',
      config: { baseUrl: 'https://kaneo.invalid' },
      status: 'active',
    })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'kaneo-prod', platformInstanceId: 'telegram-default' })
    setConfigValue('ctx-1', 'plugin:task-provider-kaneo:provider:credential', 'kn-key')
    setConfigValue('ctx-1', 'plugin:task-provider-kaneo:provider:workspaceId', 'workspace-1')
    const resolver = makeResolver()

    const provider = await resolver.resolve('ctx-1')

    expect(provider?.name).toBe('kaneo')
    expect(created).toEqual([
      { name: 'kaneo', config: { baseUrl: 'https://kaneo.invalid', credential: 'kn-key', workspaceId: 'workspace-1' } },
    ])
  })

  test('builds a Kaneo provider with session cookie credentials', async () => {
    // kaneo is plugin-contributed; credential and workspaceId are stored under plugin-namespaced keys
    registerKaneoContributed()
    insertTaskInstance({
      id: 'kaneo-prod',
      type: 'kaneo',
      config: { baseUrl: 'https://kaneo.invalid' },
      status: 'active',
    })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'kaneo-prod', platformInstanceId: 'telegram-default' })
    setConfigValue('ctx-1', 'plugin:task-provider-kaneo:provider:credential', 'better-auth.session_token=abc')
    setConfigValue('ctx-1', 'plugin:task-provider-kaneo:provider:workspaceId', 'workspace-1')
    const resolver = makeResolver()

    const provider = await resolver.resolve('ctx-1')

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

  test('returns null when provider credentials are missing', async () => {
    // youtrack is now plugin-contributed; register it so the resolver knows token is required
    registerYouTrackContributed()
    insertTaskInstance({ id: 'yt-prod', type: 'youtrack', config: { baseUrl: 'https://yt.invalid' }, status: 'active' })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'yt-prod', platformInstanceId: 'telegram-default' })
    const resolver = makeResolver()

    expect(await resolver.resolve('ctx-1')).toBeNull()
    expect(created).toEqual([])
  })

  test('resolveStrict throws clear setup guidance when resolution fails', async () => {
    const resolver = makeResolver()

    await expect(resolver.resolveStrict('ctx-missing')).rejects.toThrow('Context ctx-missing needs /setup')
  })

  test('resolves a contributed provider type by passing instance config through unchanged', async () => {
    registerContributedTaskProviderType('demo-tracker', {
      pluginId: 'demo-plugin',
      factory: () => createMockProvider({ name: 'demo-tracker' }),
      capabilities: new Set(),
      displayName: 'Demo Tracker',
      instanceConfigSchema: [
        { key: 'baseUrl', label: 'Base URL', required: true, sensitive: false, scope: 'instance' },
        { key: 'region', label: 'Region', required: false, sensitive: false, scope: 'instance' },
      ],
      contextConfigSchema: [],
      traits: new Set(),
    })
    try {
      insertTaskInstance({
        id: 'demo-1',
        type: 'demo-tracker',
        config: { baseUrl: 'https://demo.invalid', region: 'eu' },
        status: 'active',
      })
      setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'demo-1', platformInstanceId: 'telegram-default' })
      const resolver = makeResolver()

      const provider = await resolver.resolve('ctx-1')

      expect(provider).not.toBeNull()
      expect(created).toEqual([{ name: 'demo-tracker', config: { baseUrl: 'https://demo.invalid', region: 'eu' } }])
    } finally {
      unregisterContributedTaskProviderType('demo-plugin')
    }
  })

  test('validates contributed instance config using storageKey and passes logical key to validator', async () => {
    const validateConfig = mock((_config: Record<string, string>) => Promise.resolve({ ok: true as const }))
    const deps: TaskInstanceConfigValidationDeps = {
      getTaskProviderConfigValidator: () => validateConfig,
      getTaskProviderDescriptor: () => ({
        type: 'storage-tracker',
        displayName: 'Storage Tracker',
        source: { plugin: 'storage-plugin' } as const,
        instanceConfigSchema: [
          {
            key: 'baseUrl',
            storageKey: 'tracker_url',
            label: 'Tracker URL',
            required: true,
            sensitive: false,
            scope: 'instance' as const,
          },
        ],
        contextConfigSchema: [],
        capabilities: new Set(),
        traits: new Set(),
      }),
    }

    await expect(
      validateTaskInstanceConfigResult('storage-tracker', { tracker_url: 'https://tracker.invalid' }, deps),
    ).resolves.toBeNull()
    expect(validateConfig).toHaveBeenCalledWith({ baseUrl: 'https://tracker.invalid' })

    await expect(
      validateTaskInstanceConfigResult('storage-tracker', { baseUrl: 'https://tracker.invalid' }, deps),
    ).resolves.toEqual({
      kind: 'invalid_task_instance_config',
      type: 'storage-tracker',
      missing: ['baseUrl'],
      invalidUrls: [],
    })
  })

  test('admin-style task config validation does not require context-scoped fields', async () => {
    registerYouTrackContributed()
    const failure = await validateTaskInstanceConfigResult('youtrack', { baseUrl: 'https://yt.invalid' })

    expect(failure).toBeNull()
  })

  test('effective task config validation requires context-scoped fields', async () => {
    registerYouTrackContributed()
    const { validateEffectiveTaskProviderConfigResult } = await import('../../src/providers/config-validation.js')

    const failure = await validateEffectiveTaskProviderConfigResult('youtrack', { baseUrl: 'https://yt.invalid' })

    expect(failure).toEqual({
      kind: 'invalid_task_instance_config',
      type: 'youtrack',
      missing: ['token'],
      invalidUrls: [],
    })
  })

  test('resolves contributed instance config from storageKey and passes logical key to factory and validator', async () => {
    const factory = mock(() => createMockProvider({ name: 'storage-tracker' }))
    const validateConfig = mock((_config: Record<string, string>) => Promise.resolve({ ok: true as const }))
    registerContributedTaskProviderType('storage-tracker', {
      pluginId: 'storage-plugin',
      factory,
      validateConfig,
      capabilities: new Set(),
      displayName: 'Storage Tracker',
      instanceConfigSchema: [
        {
          key: 'baseUrl',
          storageKey: 'tracker_url',
          label: 'Tracker URL',
          required: true,
          sensitive: false,
          scope: 'instance',
        },
      ],
      contextConfigSchema: [],
      traits: new Set(),
    })
    try {
      insertTaskInstance({
        id: 'storage-1',
        type: 'storage-tracker',
        config: { tracker_url: 'https://tracker.invalid' },
        status: 'active',
      })
      setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'storage-1', platformInstanceId: 'telegram-default' })

      const provider = await new TaskProviderResolver().resolve('ctx-1')

      expect(provider?.name).toBe('storage-tracker')
      expect(validateConfig).toHaveBeenCalledWith({ baseUrl: 'https://tracker.invalid' })
      expect(factory).toHaveBeenCalledWith({ baseUrl: 'https://tracker.invalid' })
    } finally {
      unregisterContributedTaskProviderType('storage-plugin')
    }
  })

  test('sources a contributed type context field via plugin provider storage key', async () => {
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
          {
            key: 'apiToken',
            storageKey: 'metadata_token',
            label: 'API Token',
            required: true,
            sensitive: true,
            scope: 'context' as const,
          },
        ],
        capabilities: new Set(),
        traits: new Set(),
      }),
      getConfig: getConfig as TaskProviderResolverDeps['getConfig'],
      createProvider: (name, config) => {
        created.push({ name, config })
        return createMockProvider({ name })
      },
    }
    const resolver = new TaskProviderResolver(deps)

    const provider = await resolver.resolve('ctx-1')

    expect(provider).not.toBeNull()
    expect(getConfig).toHaveBeenCalledWith('ctx-1', 'plugin:test-plugin:provider:metadata_token')
    expect(getConfig).not.toHaveBeenCalledWith('ctx-1', 'plugin:test-plugin:provider:apiToken')
    expect(created).toEqual([
      { name: 'custom-tracker', config: { baseUrl: 'https://custom.invalid', apiToken: 'tok-123' } },
    ])
  })

  // Task 3.7: kaneo workspaceId now routes through getConfig via the generic plugin-namespaced path.
  // The getKaneoWorkspace special-case branch has been removed from the resolver.
  test('resolves kaneo workspaceId via plugin-namespaced getConfig key (not getKaneoWorkspace)', async () => {
    registerKaneoContributed()
    // contextConfigSchema lists credential first, then workspaceId — use mockReturnValueOnce in that order
    const getConfig = mock((_contextId: string, _key: string): string | null => null)
    // first call: credential
    getConfig.mockReturnValueOnce('k-abc')
    // second call: workspaceId
    getConfig.mockReturnValueOnce('ws-from-config')
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
      getConfig: getConfig as TaskProviderResolverDeps['getConfig'],
      createProvider: (
        type: string,
        config: Record<string, string>,
      ): ReturnType<TaskProviderResolverDeps['createProvider']> => {
        capturedProviderConfigs.push(config)
        return createMockProvider({ name: type })
      },
    })

    const provider = await resolver.resolve('ctx-1')

    // Resolution succeeds
    expect(provider).not.toBeNull()
    // getConfig is consulted for the credential field using the plugin-contributed storage key path
    expect(getConfig).toHaveBeenCalledWith('ctx-1', 'plugin:task-provider-kaneo:provider:credential')
    // getConfig is also consulted for workspaceId via the plugin-namespaced key (no special-case branch)
    expect(getConfig).toHaveBeenCalledWith('ctx-1', 'plugin:task-provider-kaneo:provider:workspaceId')
    // Provider was created with workspaceId sourced from getConfig (not getKaneoWorkspace)
    expect(capturedProviderConfigs[0]).toEqual({
      baseUrl: 'https://kaneo.invalid',
      credential: 'k-abc',
      workspaceId: 'ws-from-config',
    })
  })

  test('requires plugin provider context credentials before invoking factory', async () => {
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

      let provider = await resolver.resolve('ctx-resolver-plugin')

      expect(factory).not.toHaveBeenCalled()
      expect(provider).toBeNull()

      setConfigValue('ctx-resolver-plugin', `plugin:${resolverPluginId}:provider:token`, 'secret-token')
      provider = await resolver.resolve('ctx-resolver-plugin')

      expect(provider?.name).toBe(resolverProviderType)
      expect(factory).toHaveBeenCalledWith({ baseUrl: 'https://tracker.invalid', token: 'secret-token' })
    } finally {
      unregisterContributedTaskProviderType(resolverPluginId)
    }
  })

  test('does not resolve a required baseUrl from a legacy url key', async () => {
    insertTaskInstance({
      id: 'yt-legacy-url',
      type: 'youtrack',
      config: { url: 'https://yt.invalid' },
      status: 'active',
    })
    setContextSettings({
      contextId: 'ctx-legacy-url',
      taskInstanceId: 'yt-legacy-url',
      platformInstanceId: 'telegram-default',
    })
    // Provider token is now plugin-namespaced
    setConfigValue('ctx-legacy-url', 'plugin:task-provider-youtrack:provider:token', 'perm:abc')
    const resolver = makeResolver()

    expect(await resolver.resolve('ctx-legacy-url')).toBeNull()
    expect(created).toEqual([])
  })

  test('returns null when contributed provider validator rejects resolved config', async () => {
    const factory = mock(() => createMockProvider({ name: resolverProviderType }))
    const validateConfig = mock((_config: Record<string, string>) =>
      Promise.resolve({
        ok: false as const,
        reason: 'invalid token',
      }),
    )
    registerContributedTaskProviderType(resolverProviderType, {
      pluginId: resolverPluginId,
      factory,
      validateConfig,
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
        id: 'resolver-plugin-validated',
        type: resolverProviderType,
        config: { baseUrl: 'https://tracker.invalid' },
        status: 'active',
      })
      setContextSettings({
        contextId: 'ctx-resolver-plugin',
        taskInstanceId: 'resolver-plugin-validated',
        platformInstanceId: 'telegram-default',
      })
      setConfigValue('ctx-resolver-plugin', `plugin:${resolverPluginId}:provider:token`, 'bad-token')

      const provider = await new TaskProviderResolver().resolve('ctx-resolver-plugin')

      expect(provider).toBeNull()
      expect(validateConfig).toHaveBeenCalledWith({ baseUrl: 'https://tracker.invalid', token: 'bad-token' })
      expect(factory).not.toHaveBeenCalled()
    } finally {
      unregisterContributedTaskProviderType(resolverPluginId)
    }
  })

  test('returns null when contributed provider validator throws', async () => {
    const factory = mock(() => createMockProvider({ name: resolverProviderType }))
    const validateConfig = mock((_config: Record<string, string>) => {
      throw new Error('validator exploded')
    })
    registerContributedTaskProviderType(resolverProviderType, {
      pluginId: resolverPluginId,
      factory,
      validateConfig,
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
        id: 'resolver-plugin-throws',
        type: resolverProviderType,
        config: { baseUrl: 'https://tracker.invalid' },
        status: 'active',
      })
      setContextSettings({
        contextId: 'ctx-resolver-plugin',
        taskInstanceId: 'resolver-plugin-throws',
        platformInstanceId: 'telegram-default',
      })
      setConfigValue('ctx-resolver-plugin', `plugin:${resolverPluginId}:provider:token`, 'secret-token')

      const provider = await new TaskProviderResolver().resolve('ctx-resolver-plugin')

      expect(provider).toBeNull()
      expect(validateConfig).toHaveBeenCalledWith({ baseUrl: 'https://tracker.invalid', token: 'secret-token' })
      expect(factory).not.toHaveBeenCalled()
    } finally {
      unregisterContributedTaskProviderType(resolverPluginId)
    }
  })

  test('returns null when contributed provider validator rejects', async () => {
    const factory = mock(() => createMockProvider({ name: resolverProviderType }))
    const validateConfig = mock((_config: Record<string, string>) => Promise.reject(new Error('validator rejected')))
    registerContributedTaskProviderType(resolverProviderType, {
      pluginId: resolverPluginId,
      factory,
      validateConfig,
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
        id: 'resolver-plugin-rejects',
        type: resolverProviderType,
        config: { baseUrl: 'https://tracker.invalid' },
        status: 'active',
      })
      setContextSettings({
        contextId: 'ctx-resolver-plugin',
        taskInstanceId: 'resolver-plugin-rejects',
        platformInstanceId: 'telegram-default',
      })
      setConfigValue('ctx-resolver-plugin', `plugin:${resolverPluginId}:provider:token`, 'secret-token')

      const provider = await new TaskProviderResolver().resolve('ctx-resolver-plugin')

      expect(provider).toBeNull()
      expect(validateConfig).toHaveBeenCalledWith({ baseUrl: 'https://tracker.invalid', token: 'secret-token' })
      expect(factory).not.toHaveBeenCalled()
    } finally {
      unregisterContributedTaskProviderType(resolverPluginId)
    }
  })
})
