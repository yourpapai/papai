// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { saveAttachment } from '../../src/attachments/store.js'
import { setPluginConfig } from '../../src/config.js'
import { setPluginAdminConfig } from '../../src/plugins/store.js'
import { buildPluginToolRuntimeContext, type PluginToolSetRuntime } from '../../src/plugins/tool-runtime.js'
import { pluginManifestSchema, type PluginManifest } from '../../src/plugins/types.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return pluginManifestSchema.parse({
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'Test',
    apiVersion: 1,
    main: 'index.ts',
    contributes: { tools: [], promptFragments: [], commands: [], jobs: [], configKeys: [], taskProviderTypes: [] },
    permissions: [],
    defaultEnabled: false,
    requiredTaskCapabilities: [],
    requiredChatCapabilities: [],
    configRequirements: [],
    providerCapabilities: [],
    providerConfigSchema: [],
    providerAllowedHosts: [],
    activationTimeoutMs: 5000,
    ...overrides,
  })
}

function makeRuntime(overrides: Partial<PluginToolSetRuntime> = {}): PluginToolSetRuntime {
  return {
    provider: createMockProvider(),
    storageContextId: 'ctx-1',
    chatUserId: 'user-1',
    ...overrides,
  }
}

function getTaskProvider(
  runtime: ReturnType<typeof buildPluginToolRuntimeContext>,
): NonNullable<ReturnType<typeof buildPluginToolRuntimeContext>['taskProvider']> {
  const taskProvider = runtime.taskProvider
  expect(taskProvider).toBeDefined()
  if (taskProvider === undefined) throw new Error('Expected taskProvider to be defined')
  return taskProvider
}

describe('buildPluginToolRuntimeContext', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  describe('rateLimit', () => {
    test('provides rateLimit on the runtime context', () => {
      const ctx = buildPluginToolRuntimeContext('test-plugin', makeManifest(), makeRuntime())
      expect(ctx.rateLimit).toBeDefined()
      expect(typeof ctx.rateLimit.check).toBe('function')
    })

    test('allows requests within the rate limit', () => {
      const ctx = buildPluginToolRuntimeContext('test-plugin', makeManifest(), makeRuntime())
      const result = ctx.rateLimit.check('actor-1')
      expect(result.allowed).toBe(true)
    })

    test('denies requests when rate limit is exceeded', () => {
      const ctx = buildPluginToolRuntimeContext('test-plugin', makeManifest(), makeRuntime())
      let lastResult: { allowed: boolean; retryAfterSec?: number } = { allowed: true }
      for (let i = 0; i < 21; i++) {
        lastResult = ctx.rateLimit.check('actor-1')
      }
      expect(lastResult.allowed).toBe(false)
      expect(lastResult.retryAfterSec).toBeDefined()
      expect(lastResult.retryAfterSec!).toBeGreaterThan(0)
    })
  })

  describe('attachments facade', () => {
    test('provides attachments on the runtime context', () => {
      const ctx = buildPluginToolRuntimeContext(
        'test-plugin',
        makeManifest({ permissions: ['attachments.read'] }),
        makeRuntime(),
      )
      expect(ctx.attachments).toBeDefined()
      expect(typeof ctx.attachments.read).toBe('function')
    })

    test('throws when plugin lacks attachments.read permission', async () => {
      const ctx = buildPluginToolRuntimeContext('test-plugin', makeManifest({ permissions: [] }), makeRuntime())
      await expect(ctx.attachments.read('att_anything')).rejects.toThrow(/attachments\.read/u)
    })

    test('returns record metadata and bytes for an attachment in the current context', async () => {
      const saved = await saveAttachment({
        contextId: 'ctx-1',
        sourceProvider: 'telegram',
        filename: 'voice.ogg',
        status: 'available',
        content: Buffer.from('audio-bytes'),
        mimeType: 'audio/ogg',
        size: 11,
      })

      const ctx = buildPluginToolRuntimeContext(
        'test-plugin',
        makeManifest({ permissions: ['attachments.read'] }),
        makeRuntime({ storageContextId: 'ctx-1' }),
      )

      const result = await ctx.attachments.read(saved.attachmentId)
      expect(result.record.filename).toBe('voice.ogg')
      expect(result.record.mimeType).toBe('audio/ogg')
      expect(result.record.size).toBe(11)
      expect(result.bytes.toString()).toBe('audio-bytes')
    })

    test('throws attachment_not_found for unknown ids', async () => {
      const ctx = buildPluginToolRuntimeContext(
        'test-plugin',
        makeManifest({ permissions: ['attachments.read'] }),
        makeRuntime({ storageContextId: 'ctx-1' }),
      )
      await expect(ctx.attachments.read('att_does_not_exist')).rejects.toThrow(/attachment_not_found/u)
    })

    test('cannot access an attachment from a different storage context', async () => {
      const saved = await saveAttachment({
        contextId: 'ctx-A',
        sourceProvider: 'telegram',
        filename: 'secret.ogg',
        status: 'available',
        content: Buffer.from('secret-bytes'),
        mimeType: 'audio/ogg',
        size: 12,
      })

      const ctx = buildPluginToolRuntimeContext(
        'test-plugin',
        makeManifest({ permissions: ['attachments.read'] }),
        makeRuntime({ storageContextId: 'ctx-B' }),
      )

      await expect(ctx.attachments.read(saved.attachmentId)).rejects.toThrow(/attachment_not_found/u)
    })

    test('attachments.read surfaces origin and forwardedFrom on the record', async () => {
      const saved = await saveAttachment({
        contextId: 'ctx-1',
        sourceProvider: 'telegram',
        filename: 'voice.ogg',
        status: 'available',
        content: Buffer.from('audio'),
        mimeType: 'audio/ogg',
        origin: 'voice',
        forwardedFrom: 'Alice',
      })
      const ctx = buildPluginToolRuntimeContext(
        'test-plugin',
        makeManifest({ permissions: ['attachments.read'] }),
        makeRuntime({ storageContextId: 'ctx-1' }),
      )
      const { record } = await ctx.attachments.read(saved.attachmentId)
      expect(record.origin).toBe('voice')
      expect(record.forwardedFrom).toBe('Alice')
    })
  })

  describe('contextConfig facade', () => {
    test('resolves declared context-scoped keys and hides others', () => {
      setPluginConfig('ctx-1', 'test-plugin', 'api_key', 'ctx-key-1')
      const ctx = buildPluginToolRuntimeContext(
        'test-plugin',
        makeManifest({
          configRequirements: [
            { key: 'api_key', label: 'API Key', required: false, sensitive: true, scope: 'context' },
          ],
        }),
        makeRuntime({ storageContextId: 'ctx-1' }),
      )
      expect(ctx.contextConfig.get('api_key')).toBe('ctx-key-1')
      expect(ctx.contextConfig.get('undeclared')).toBeUndefined()
    })

    test('returns undefined for a declared key with no stored value', () => {
      const ctx = buildPluginToolRuntimeContext(
        'test-plugin',
        makeManifest({
          configRequirements: [
            { key: 'api_key', label: 'API Key', required: false, sensitive: true, scope: 'context' },
          ],
        }),
        makeRuntime({ storageContextId: 'ctx-1' }),
      )
      expect(ctx.contextConfig.get('api_key')).toBeUndefined()
    })

    test('does not expose admin-scoped keys through contextConfig', () => {
      const ctx = buildPluginToolRuntimeContext(
        'test-plugin',
        makeManifest({
          configRequirements: [{ key: 'api_key', label: 'API Key', required: false, sensitive: true, scope: 'admin' }],
        }),
        makeRuntime({ storageContextId: 'ctx-1' }),
      )
      expect(ctx.contextConfig.get('api_key')).toBeUndefined()
    })

    test("cannot read another plugin's config for the same key and context", () => {
      setPluginConfig('ctx-1', 'other-plugin', 'api_key', 'other-plugin-secret')
      const ctx = buildPluginToolRuntimeContext(
        'test-plugin',
        makeManifest({
          configRequirements: [
            { key: 'api_key', label: 'API Key', required: false, sensitive: true, scope: 'context' },
          ],
        }),
        makeRuntime({ storageContextId: 'ctx-1' }),
      )
      expect(ctx.contextConfig.get('api_key')).toBeUndefined()
    })
  })

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
          attachmentTransformers: [],
        },
      },
      { provider: createMockProvider(), storageContextId: 'ctx-1', chatUserId: 'chat-user-1' },
    )

    expect(runtime.identity).toBeDefined()
    expect(runtime).toHaveProperty('identity')
    expect(runtime.identity?.lookupForChatUser('chat-user-1')).toBeNull()
  })

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
          attachmentTransformers: [],
        },
      },
      { provider: createMockProvider(), storageContextId: 'ctx-1', chatUserId: 'chat-user-1' },
    )

    expect(runtime.identity).toBeUndefined()
    expect(runtime).not.toHaveProperty('identity')
  })

  test('tool runtime omits identity facade when plugin contributes no provider types', () => {
    const runtime = buildPluginToolRuntimeContext(
      'no-provider-plugin',
      {
        ...makeManifest(),
        permissions: ['identity'],
        contributes: {
          tools: [],
          promptFragments: [],
          commands: [],
          jobs: [],
          configKeys: [],
          taskProviderTypes: [],
          attachmentTransformers: [],
        },
      },
      { provider: createMockProvider(), storageContextId: 'ctx-1', chatUserId: 'chat-user-1' },
    )

    expect(runtime.identity).toBeUndefined()
    expect(runtime).not.toHaveProperty('identity')
  })

  test('tool runtime omits identity facade when plugin contributes multiple provider types', () => {
    const runtime = buildPluginToolRuntimeContext(
      'multi-provider-plugin',
      {
        ...makeManifest(),
        permissions: ['identity'],
        contributes: {
          tools: [],
          promptFragments: [],
          commands: [],
          jobs: [],
          configKeys: [],
          taskProviderTypes: ['identity-provider-a', 'identity-provider-b'],
          attachmentTransformers: [],
        },
      } as PluginManifest,
      { provider: createMockProvider(), storageContextId: 'ctx-1', chatUserId: 'chat-user-1' },
    )

    expect(runtime.identity).toBeUndefined()
    expect(runtime).not.toHaveProperty('identity')
  })

  test('tool runtime exposes admin config for declared admin-scoped keys', () => {
    setPluginAdminConfig('test-plugin', 'api_key', 'runtime-api-key', 'admin-user')
    setPluginAdminConfig('test-plugin', 'ignored_key', 'should-not-be-exposed', 'admin-user')

    const runtime = buildPluginToolRuntimeContext(
      'test-plugin',
      makeManifest({
        configRequirements: [
          {
            key: 'api_key',
            label: 'API Key',
            required: true,
            sensitive: true,
            scope: 'admin',
          },
        ],
      }),
      makeRuntime(),
    )

    expect(runtime.adminConfig.get('api_key')).toBe('runtime-api-key')
    expect(runtime.adminConfig.get('ignored_key')).toBeUndefined()
  })

  test('tool runtime kv throws without storage permission', () => {
    const runtime = buildPluginToolRuntimeContext('test-plugin', makeManifest(), makeRuntime())

    expect(() => runtime.kv.get('missing')).toThrow("Plugin test-plugin does not have 'storage' permission")
    expect(() => runtime.kv.set('key', 'value')).toThrow("Plugin test-plugin does not have 'storage' permission")
    expect(() => runtime.kv.delete('key')).toThrow("Plugin test-plugin does not have 'storage' permission")
    expect(() => runtime.kv.list()).toThrow("Plugin test-plugin does not have 'storage' permission")
  })

  test('tool runtime read methods throw without tasks.read permission', () => {
    const getTask = mock(() =>
      Promise.resolve({ id: 'task-1', title: 'ignored', status: 'todo', url: 'https://test.com/1' }),
    )
    const listTasks = mock(() => Promise.resolve([]))
    const searchTasks = mock(() => Promise.resolve([]))
    const provider = createMockProvider({
      getTask,
      listTasks,
      searchTasks,
    })
    const runtime = buildPluginToolRuntimeContext('test-plugin', makeManifest(), makeRuntime({ provider }))
    const taskProvider = getTaskProvider(runtime)

    expect(() => taskProvider.getTask('task-1')).toThrow("Plugin test-plugin does not have 'tasks.read' permission")
    expect(() => taskProvider.listTasks('project-1')).toThrow(
      "Plugin test-plugin does not have 'tasks.read' permission",
    )
    expect(() => taskProvider.searchTasks({ query: 'test' })).toThrow(
      "Plugin test-plugin does not have 'tasks.read' permission",
    )
    expect(getTask).not.toHaveBeenCalled()
    expect(listTasks).not.toHaveBeenCalled()
    expect(searchTasks).not.toHaveBeenCalled()
  })

  test('tool runtime write methods throw without tasks.write permission', () => {
    const createTask = mock(() =>
      Promise.resolve({ id: 'task-1', title: 'ignored', status: 'todo', url: 'https://test.com/1' }),
    )
    const updateTask = mock(() =>
      Promise.resolve({ id: 'task-1', title: 'ignored', status: 'todo', url: 'https://test.com/1' }),
    )
    const provider = createMockProvider({
      createTask,
      updateTask,
    })
    const runtime = buildPluginToolRuntimeContext(
      'test-plugin',
      makeManifest({ permissions: ['tasks.read'] }),
      makeRuntime({ provider }),
    )
    const taskProvider = getTaskProvider(runtime)

    expect(() => taskProvider.createTask({ projectId: 'project-1', title: 'test' })).toThrow(
      "Plugin test-plugin does not have 'tasks.write' permission",
    )
    expect(() => taskProvider.updateTask('task-1', { title: 'updated' })).toThrow(
      "Plugin test-plugin does not have 'tasks.write' permission",
    )
    expect(createTask).not.toHaveBeenCalled()
    expect(updateTask).not.toHaveBeenCalled()
  })
})
