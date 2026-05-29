// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { setConfig, setConfigValue } from '../../src/config.js'
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
import { setKaneoWorkspace } from '../../src/users.js'
import { createMockProvider } from '../tools/mock-provider.js'
import {
  mockLogger,
  seedCommonTestPlatformInstances,
  seedTestTaskInstance,
  setupTestDb,
} from '../utils/test-helpers.js'

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
    insertTaskInstance({ id: 'yt-stopped', type: 'youtrack', config: { url: 'https://yt.invalid' }, status: 'stopped' })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'yt-stopped', platformInstanceId: 'telegram-default' })
    setConfig('ctx-1', 'youtrack_token', 'perm:abc')
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

  test('builds a YouTrack provider from instance URL and per-context token', async () => {
    insertTaskInstance({ id: 'yt-prod', type: 'youtrack', config: { url: 'https://yt.invalid' }, status: 'active' })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'yt-prod', platformInstanceId: 'telegram-default' })
    setConfig('ctx-1', 'youtrack_token', 'perm:abc')
    const resolver = makeResolver()

    const provider = await resolver.resolve('ctx-1')

    expect(provider?.name).toBe('youtrack')
    expect(created).toEqual([{ name: 'youtrack', config: { baseUrl: 'https://yt.invalid', token: 'perm:abc' } }])
  })

  test('builds a Kaneo provider from instance URL, API key, and workspace ID', async () => {
    insertTaskInstance({ id: 'kaneo-prod', type: 'kaneo', config: { url: 'https://kaneo.invalid' }, status: 'active' })
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'kaneo-prod', platformInstanceId: 'telegram-default' })
    setConfig('ctx-1', 'kaneo_apikey', 'kn-key')
    setKaneoWorkspace('ctx-1', 'workspace-1')
    const resolver = makeResolver()

    const provider = await resolver.resolve('ctx-1')

    expect(provider?.name).toBe('kaneo')
    expect(created).toEqual([
      { name: 'kaneo', config: { baseUrl: 'https://kaneo.invalid', credential: 'kn-key', workspaceId: 'workspace-1' } },
    ])
  })

  test('builds a Kaneo provider with session cookie credentials', async () => {
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
    insertTaskInstance({ id: 'yt-prod', type: 'youtrack', config: { url: 'https://yt.invalid' }, status: 'active' })
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
        configSchema: [],
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
        configSchema: [
          { key: 'baseUrl', label: 'URL', required: true, sensitive: false, scope: 'instance' as const },
          {
            key: 'apiToken',
            storageKey: 'metadata_token',
            label: 'API Token',
            required: true,
            sensitive: true,
            scope: 'context' as const,
          },
        ],
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
