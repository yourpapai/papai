// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { buildPluginContext } from '../../src/plugins/context.js'
import { setPluginAdminConfig } from '../../src/plugins/store.js'
import type { PluginManifest } from '../../src/plugins/types.js'
import { PLUGIN_API_VERSION, pluginManifestSchema } from '../../src/plugins/types.js'
import {
  getContributedTaskProviderType,
  getTaskProviderConfigValidator,
  getTaskProviderDescriptor,
  unregisterContributedTaskProviderType,
} from '../../src/providers/registry.js'
import type { TaskProvider } from '../../src/providers/types.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const stubProviderFactory = (): TaskProvider => createMockProvider()

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
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
    beforeEach(() => {
      unregisterContributedTaskProviderType('test-plugin')
    })

    afterEach(() => {
      unregisterContributedTaskProviderType('test-plugin')
      unregisterContributedTaskProviderType('provider-metadata-plugin')
    })

    test('registers a declared type when provider.task is held', () => {
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
      const { ctx } = buildPluginContext(manifest, 'ctx-1')
      ctx.registration.registerTaskProviderType('custom-tracker', { factory: stubProviderFactory })
      expect(getContributedTaskProviderType('custom-tracker')?.pluginId).toBe('test-plugin')
    })

    test('registers provider context config schema from manifest', () => {
      const manifest = pluginManifestSchema.parse({
        id: 'test-plugin',
        name: 'Test Plugin',
        version: '1.0.0',
        description: 'A test plugin',
        apiVersion: PLUGIN_API_VERSION,
        permissions: ['provider.task'],
        contributes: { taskProviderTypes: ['custom-tracker'] },
        providerConfigSchema: [{ key: 'base_url', label: 'Base URL', required: true }],
        providerContextConfigSchema: [{ key: 'token', label: 'Token', required: true, sensitive: true }],
      })
      const { ctx } = buildPluginContext(manifest, 'ctx-1')

      ctx.registration.registerTaskProviderType('custom-tracker', { factory: stubProviderFactory })

      const contributed = getContributedTaskProviderType('custom-tracker')
      expect(contributed?.instanceConfigSchema?.map((field) => field.key)).toEqual(['base_url'])
      expect(contributed?.contextConfigSchema?.map((field) => field.key)).toEqual(['token'])
    })

    test('registers provider storage keys and traits from manifest metadata', () => {
      const manifest = pluginManifestSchema.parse({
        id: 'provider-metadata-plugin',
        name: 'Provider Metadata Plugin',
        version: '1.0.0',
        description: 'A provider metadata plugin',
        apiVersion: PLUGIN_API_VERSION,
        permissions: ['provider.task'],
        contributes: {
          tools: [],
          promptFragments: [],
          commands: [],
          jobs: [],
          configKeys: [],
          taskProviderTypes: ['metadata-tracker'],
        },
        providerCapabilities: ['tasks.commands'],
        providerTraits: ['supports-command-language'],
        providerConfigSchema: [
          { key: 'baseUrl', label: 'Base URL', required: true, sensitive: false, scope: 'instance' },
        ],
        providerContextConfigSchema: [
          {
            key: 'apiToken',
            storageKey: 'metadata_token',
            label: 'API Token',
            required: true,
            sensitive: true,
            scope: 'context',
          },
        ],
      })
      const { ctx } = buildPluginContext(manifest, '__system__')

      ctx.registration.registerTaskProviderType('metadata-tracker', {
        factory: () => createMockProvider({ name: 'metadata-tracker' }),
      })

      const descriptor = getTaskProviderDescriptor('metadata-tracker')
      expect(descriptor?.traits.has('supports-command-language')).toBe(true)
      expect(descriptor?.contextConfigSchema.find((field) => field.key === 'apiToken')?.storageKey).toBe(
        'metadata_token',
      )
    })

    test('wraps malformed direct provider validators as rejected validation results', async () => {
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
      const validateConfig = (): Promise<{ ok: false; reason: string }> => Promise.resolve({ ok: false, reason: '' })

      ctx.registration.registerTaskProviderType('custom-tracker', {
        factory: stubProviderFactory,
        validateConfig,
      })

      await expect(
        getTaskProviderConfigValidator('custom-tracker')?.({ baseUrl: 'https://bad.invalid' }),
      ).resolves.toEqual({
        ok: false,
        reason: 'Contributed task provider validator returned an invalid result',
      })
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
      expect(() => ctx.registration.registerTaskProviderType('kaneo', { factory: stubProviderFactory })).toThrow(
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
      expect(() => ctx.registration.registerTaskProviderType('youtrack', { factory: stubProviderFactory })).toThrow(
        'is not declared in plugin manifest contributes.taskProviderTypes',
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
