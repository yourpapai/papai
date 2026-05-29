// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { buildPluginContext } from '../../src/plugins/context.js'
import { setPluginAdminConfig } from '../../src/plugins/store.js'
import type { PluginManifest } from '../../src/plugins/types.js'
import { PLUGIN_API_VERSION, pluginManifestSchema } from '../../src/plugins/types.js'
import type { TaskProvider } from '../../src/providers/types.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const stubProviderFactory = (): TaskProvider => createMockProvider()

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`${label} was unexpectedly undefined`)
  return value
}

function makeManifest(...args: readonly [] | readonly [overrides: Partial<PluginManifest>]): PluginManifest {
  const overrides = args.length === 1 ? args[0] : {}
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'A test plugin',
    apiVersion: PLUGIN_API_VERSION,
    main: 'index.ts',
    contributes: {
      tools: ['allowed_tool'],
      promptFragments: ['allowed_fragment'],
      commands: ['allowed_command'],
      jobs: ['allowed_job'],
      configKeys: [],
      taskProviderTypes: [],
    },
    permissions: ['storage'],
    defaultEnabled: false,
    activationTimeoutMs: 5000,
    requiredTaskCapabilities: [],
    requiredChatCapabilities: [],
    configRequirements: [],
    providerCapabilities: [],
    providerConfigSchema: [],
    providerContextConfigSchema: [],
    providerAllowedHosts: [],
    ...overrides,
  }
}

describe('buildPluginContext', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('accepts declared tool and prompt fragment registrations', () => {
    const { ctx, collected } = buildPluginContext(makeManifest(), 'ctx-1')

    ctx.registration.registerTool({
      name: 'allowed_tool',
      description: 'Allowed tool',
      execute: () => Promise.resolve<unknown>('ok'),
    })
    ctx.registration.registerPromptFragment({
      name: 'allowed_fragment',
      content: 'Allowed fragment',
    })

    expect(collected.tools).toHaveLength(1)
    expect(collected.promptFragments).toHaveLength(1)
  })

  test('accepts declared command and scheduled job registrations', () => {
    const { ctx, collected } = buildPluginContext(makeManifest(), 'ctx-1')

    ctx.registration.registerCommand({
      name: 'allowed_command',
      description: 'Allowed command',
      execute: () => Promise.resolve(),
    })
    ctx.registration.registerScheduledJob({
      name: 'allowed_job',
      intervalMs: 60_000,
      execute: () => Promise.resolve(),
    })

    expect(collected.commands).toHaveLength(1)
    expect(collected.jobs).toHaveLength(1)
  })

  test('throws on undeclared tool registration', () => {
    const { ctx } = buildPluginContext(makeManifest(), 'ctx-1')

    expect(() =>
      ctx.registration.registerTool({
        name: 'not_declared',
        description: 'Rejected tool',
        execute: () => Promise.resolve<unknown>('x'),
      }),
    ).toThrow("Tool 'not_declared' is not declared in plugin manifest contributes.tools")
  })

  test('throws on undeclared prompt fragment registration', () => {
    const { ctx } = buildPluginContext(makeManifest(), 'ctx-1')

    expect(() =>
      ctx.registration.registerPromptFragment({
        name: 'not_declared',
        content: 'Rejected fragment',
      }),
    ).toThrow("Prompt fragment 'not_declared' is not declared in plugin manifest contributes.promptFragments")
  })

  test('throws on undeclared command registration', () => {
    const { ctx } = buildPluginContext(makeManifest(), 'ctx-1')

    expect(() =>
      ctx.registration.registerCommand({
        name: 'not_declared',
        description: 'Rejected command',
        execute: () => Promise.resolve(),
      }),
    ).toThrow("Command 'not_declared' is not declared in plugin manifest contributes.commands")
  })

  test('throws on undeclared scheduled job registration', () => {
    const { ctx } = buildPluginContext(makeManifest(), 'ctx-1')

    expect(() =>
      ctx.registration.registerScheduledJob({
        name: 'not_declared',
        intervalMs: 60_000,
        execute: () => Promise.resolve(),
      }),
    ).toThrow("Scheduled job 'not_declared' is not declared in plugin manifest contributes.jobs")
  })

  test('freezes context and nested service surfaces', () => {
    const { ctx } = buildPluginContext(makeManifest(), 'ctx-1')

    expect(Object.isFrozen(ctx)).toBe(true)
    expect(Object.isFrozen(ctx.registration)).toBe(true)
    expect(Object.isFrozen(ctx.kv)).toBe(true)
    expect(Object.isFrozen(ctx.log)).toBe(true)
    expect(Object.isFrozen(ctx.adminConfig)).toBe(true)
  })

  test('exposes permissions as an immutable set', () => {
    const { ctx } = buildPluginContext(makeManifest({ permissions: ['storage', 'http'] }), 'ctx-1')

    expect(ctx.permissions.has('storage')).toBe(true)
    expect('add' in ctx.permissions).toBe(false)
  })

  test('denies kv operations when storage permission is missing', () => {
    const { ctx } = buildPluginContext(makeManifest({ permissions: [] }), 'ctx-1')

    expect(() => ctx.kv.get('k')).toThrow("Plugin test-plugin does not have 'storage' permission")
    expect(() => ctx.kv.set('k', 'v')).toThrow("Plugin test-plugin does not have 'storage' permission")
    expect(() => ctx.kv.delete('k')).toThrow("Plugin test-plugin does not have 'storage' permission")
    expect(() => ctx.kv.list()).toThrow("Plugin test-plugin does not have 'storage' permission")
  })

  describe('providerRuntime gating', () => {
    test('present when provider.task is held', () => {
      const { ctx } = buildPluginContext(makeManifest({ permissions: ['provider.task'] }), 'ctx-1')
      expect(ctx.providerRuntime).toBeDefined()
    })

    test('absent without provider.task or http', () => {
      const { ctx } = buildPluginContext(makeManifest({ permissions: ['storage'] }), 'ctx-1')
      expect(ctx.providerRuntime).toBeUndefined()
    })
  })

  describe('http permission', () => {
    test('provides providerRuntime when http permission is declared', () => {
      const { ctx } = buildPluginContext(
        makeManifest({ permissions: ['http'], providerAllowedHosts: ['api.example.com'] }),
        'ctx-1',
      )
      expect(ctx.providerRuntime).toBeDefined()
      expect(ctx.providerRuntime!.allowedHosts.has('api.example.com')).toBe(true)
    })

    test('does not provide providerRuntime without http or provider.task permission', () => {
      const { ctx } = buildPluginContext(makeManifest({ permissions: [] }), 'ctx-1')
      expect(ctx.providerRuntime).toBeUndefined()
    })
  })

  describe('registerTaskProviderType', () => {
    test('stages a declared type when provider.task is held', () => {
      const manifest = makeManifest({
        permissions: ['provider.task'],
        contributes: {
          tools: [],
          promptFragments: [],
          commands: [],
          jobs: [],
          configKeys: [],
          taskProviderTypes: ['custom-tracker'],
        },
        providerCapabilities: ['labels.list'],
      })
      const { ctx, collected } = buildPluginContext(manifest, 'ctx-1')

      ctx.registration.registerTaskProviderType('custom-tracker', stubProviderFactory)

      expect(collected.taskProviderRegistration).toEqual({
        type: 'custom-tracker',
        factory: stubProviderFactory,
        capabilities: new Set(['labels.list']),
        displayName: 'Test Plugin',
        instanceConfigSchema: [],
        contextConfigSchema: [],
        traits: new Set(),
      })
    })

    test('stages provider config schema from manifest', () => {
      const manifest = pluginManifestSchema.parse({
        id: 'test-plugin',
        name: 'Test Plugin',
        version: '1.0.0',
        description: 'A test plugin',
        apiVersion: PLUGIN_API_VERSION,
        main: 'index.ts',
        permissions: ['provider.task'],
        contributes: { taskProviderTypes: ['custom-tracker'] },
        providerConfigSchema: [{ key: 'base_url', label: 'Base URL', required: true }],
        providerContextConfigSchema: [{ key: 'token', label: 'Token', required: true, sensitive: true }],
      })
      const { ctx, collected } = buildPluginContext(manifest, 'ctx-1')

      ctx.registration.registerTaskProviderType('custom-tracker', stubProviderFactory)

      const registration = requireValue(collected.taskProviderRegistration, 'custom tracker registration')
      expect(registration.instanceConfigSchema.map((field) => field.key)).toEqual(['base_url'])
      expect(registration.contextConfigSchema.map((field) => field.key)).toEqual(['token'])
    })

    test('throws without provider.task permission', () => {
      const manifest = makeManifest({
        permissions: [],
        contributes: {
          tools: [],
          promptFragments: [],
          commands: [],
          jobs: [],
          configKeys: [],
          taskProviderTypes: ['kaneo'],
        },
      })
      const { ctx } = buildPluginContext(manifest, 'ctx-1')
      expect(() => ctx.registration.registerTaskProviderType('kaneo', stubProviderFactory)).toThrow(
        "cannot register a task provider type without 'provider.task'",
      )
    })

    test('throws when type is not the declared one', () => {
      const manifest = makeManifest({
        permissions: ['provider.task'],
        contributes: {
          tools: [],
          promptFragments: [],
          commands: [],
          jobs: [],
          configKeys: [],
          taskProviderTypes: ['kaneo'],
        },
      })
      const { ctx } = buildPluginContext(manifest, 'ctx-1')
      expect(() => ctx.registration.registerTaskProviderType('youtrack', stubProviderFactory)).toThrow(
        'is not declared in plugin manifest contributes.taskProviderTypes',
      )
    })

    test('throws on duplicate task provider registration', () => {
      const manifest = makeManifest({
        permissions: ['provider.task'],
        contributes: {
          tools: [],
          promptFragments: [],
          commands: [],
          jobs: [],
          configKeys: [],
          taskProviderTypes: ['custom-tracker'],
        },
      })
      const { ctx } = buildPluginContext(manifest, 'ctx-1')

      ctx.registration.registerTaskProviderType('custom-tracker', stubProviderFactory)

      expect(() => ctx.registration.registerTaskProviderType('custom-tracker', stubProviderFactory)).toThrow(
        "Task provider type 'custom-tracker' was registered more than once",
      )
    })
  })

  describe('duplicate registration rejection', () => {
    test('throws on duplicate tool registration', () => {
      const { ctx } = buildPluginContext(makeManifest(), 'ctx-1')
      const tool = {
        name: 'allowed_tool',
        description: 'Allowed tool',
        execute: (): Promise<unknown> => Promise.resolve<unknown>('ok'),
      }

      ctx.registration.registerTool(tool)

      expect(() => ctx.registration.registerTool(tool)).toThrow("Tool 'allowed_tool' was registered more than once")
    })

    test('throws on duplicate prompt fragment registration', () => {
      const { ctx } = buildPluginContext(makeManifest(), 'ctx-1')
      const fragment = {
        name: 'allowed_fragment',
        content: 'Allowed fragment',
      }

      ctx.registration.registerPromptFragment(fragment)

      expect(() => ctx.registration.registerPromptFragment(fragment)).toThrow(
        "Prompt fragment 'allowed_fragment' was registered more than once",
      )
    })

    test('throws on duplicate command registration', () => {
      const { ctx } = buildPluginContext(makeManifest(), 'ctx-1')
      const command = {
        name: 'allowed_command',
        description: 'Allowed command',
        execute: (): Promise<void> => Promise.resolve(),
      }

      ctx.registration.registerCommand(command)

      expect(() => ctx.registration.registerCommand(command)).toThrow(
        "Command 'allowed_command' was registered more than once",
      )
    })

    test('throws on duplicate scheduled job registration', () => {
      const { ctx } = buildPluginContext(makeManifest(), 'ctx-1')
      const job = {
        name: 'allowed_job',
        intervalMs: 60_000,
        execute: (): Promise<void> => Promise.resolve(),
      }

      ctx.registration.registerScheduledJob(job)

      expect(() => ctx.registration.registerScheduledJob(job)).toThrow(
        "Scheduled job 'allowed_job' was registered more than once",
      )
    })
  })

  describe('identity gating', () => {
    test('present with identity permission and a declared task provider type', () => {
      const manifest = makeManifest({
        permissions: ['identity', 'provider.task'],
        contributes: {
          tools: [],
          promptFragments: [],
          commands: [],
          jobs: [],
          configKeys: [],
          taskProviderTypes: ['kaneo'],
        },
      })
      const { ctx } = buildPluginContext(manifest, 'ctx-1')
      expect(ctx.identity).toBeDefined()
    })

    test('absent without identity permission', () => {
      const { ctx } = buildPluginContext(makeManifest({ permissions: ['storage'] }), 'ctx-1')
      expect(ctx.identity).toBeUndefined()
    })

    test('absent when identity is held but no task provider type is declared', () => {
      const { ctx } = buildPluginContext(makeManifest({ permissions: ['identity'] }), 'ctx-1')
      expect(ctx.identity).toBeUndefined()
    })
  })

  describe('adminConfig', () => {
    test('provides adminConfig when plugin declares admin-scoped config requirements', () => {
      setPluginAdminConfig('test-plugin', 'api_key', 'sk-test-123', 'admin')
      const { ctx } = buildPluginContext(
        makeManifest({
          configRequirements: [{ key: 'api_key', label: 'API Key', required: true, sensitive: true, scope: 'admin' }],
        }),
        'ctx-1',
      )
      expect(ctx.adminConfig).toBeDefined()
      expect(ctx.adminConfig.get('api_key')).toBe('sk-test-123')
    })

    test('returns undefined for undeclared admin config keys', () => {
      const { ctx } = buildPluginContext(
        makeManifest({
          configRequirements: [{ key: 'api_key', label: 'API Key', required: true, sensitive: true, scope: 'admin' }],
        }),
        'ctx-1',
      )
      expect(ctx.adminConfig.get('other_key')).toBeUndefined()
    })

    test('does not expose context-scoped keys via adminConfig', () => {
      const { ctx } = buildPluginContext(
        makeManifest({
          configRequirements: [
            { key: 'api_key', label: 'API Key', required: true, sensitive: true, scope: 'admin' },
            { key: 'timezone', label: 'Timezone', required: false, sensitive: false, scope: 'context' },
          ],
        }),
        'ctx-1',
      )
      expect(ctx.adminConfig.get('timezone')).toBeUndefined()
    })
  })
})
