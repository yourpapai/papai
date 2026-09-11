// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { setCachedConfig } from '../src/cache.js'
import {
  getConfigFieldsForContext,
  getConfigKeysForContext,
  getRequiredProviderConfigKeysForContext,
  isSensitiveProviderStorageKey,
} from '../src/config-keys.js'
import { getAllConfig, setConfig } from '../src/config.testing.js'
import { taskInstances } from '../src/db/schema.js'
import { setContextSettings } from '../src/instances/context-store.js'
import { insertTaskInstance } from '../src/instances/task-store.js'
import { createLlmProvider, setAdminRoleBindings } from '../src/llm-providers/store.js'
import { clearLlmAdminCacheForTesting } from '../src/llm-providers/store.testing.js'
import { prewarmModelsDevSnapshot } from '../src/models-dev/client.js'
import { resetModelsDevSnapshotForTest } from '../src/models-dev/client.testing.js'
import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../src/providers/registry.js'
import { isFieldUnsettable, type ConfigField } from '../src/types/config.js'
import { createMockProvider } from './tools/mock-provider.js'
import {
  getTestDb,
  mockLogger,
  seedCommonTestPlatformInstances,
  seedTestTaskInstance,
  setupTestDb,
} from './utils/test-helpers.js'

const YOUTRACK_PLUGIN_ID = 'task-provider-youtrack'

const registerYouTrackContributed = (): void => {
  registerContributedTaskProviderType('youtrack', {
    pluginId: YOUTRACK_PLUGIN_ID,
    factory: () => createMockProvider({ name: 'youtrack' }),
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

describe('getConfigKeysForContext', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    process.env['INSTANCE_CONFIG_KEY'] = '5'.repeat(64)
  })

  afterEach(() => {
    unregisterContributedTaskProviderType(YOUTRACK_PLUGIN_ID)
    unregisterContributedTaskProviderType('demo-plugin')
  })

  test('returns preferences only for an unassigned context', () => {
    expect(getConfigKeysForContext('ctx-unassigned')).toEqual([
      'timezone',
      'mcp_endpoints',
      'language',
      'ai_tool_visibility',
      'ai_reasoning_visibility',
      'ai_output_detail_level',
      'ai_live_status',
    ])
  })

  test('returns preferences only for an active Kaneo assignment (kaneo is now plugin-contributed)', () => {
    // kaneo is no longer a builtin; its descriptor is only present when the plugin is registered.
    // Without the plugin registered, config-keys falls back to preference fields only.
    insertTaskInstance({
      id: 'kaneo-prod',
      type: 'kaneo',
      config: { baseUrl: 'https://kaneo.invalid' },
      status: 'active',
    })
    setContextSettings({ contextId: 'ctx-kaneo', taskInstanceId: 'kaneo-prod', platformInstanceId: 'telegram-default' })

    expect(getConfigKeysForContext('ctx-kaneo')).toEqual([
      'timezone',
      'mcp_endpoints',
      'language',
      'ai_tool_visibility',
      'ai_reasoning_visibility',
      'ai_output_detail_level',
      'ai_live_status',
    ])
  })

  test('returns plugin-namespaced token key for an active YouTrack assignment (contributed)', () => {
    // youtrack is now plugin-contributed; its token key is plugin-namespaced and returned by getConfigKeysForContext
    registerYouTrackContributed()
    insertTaskInstance({ id: 'yt-prod', type: 'youtrack', config: { baseUrl: 'https://yt.invalid' }, status: 'active' })
    setContextSettings({ contextId: 'ctx-yt', taskInstanceId: 'yt-prod', platformInstanceId: 'telegram-default' })

    expect(getConfigKeysForContext('ctx-yt')).toEqual([
      'plugin:task-provider-youtrack:provider:token',
      'timezone',
      'mcp_endpoints',
      'language',
      'ai_tool_visibility',
      'ai_reasoning_visibility',
      'ai_output_detail_level',
      'ai_live_status',
    ])
  })

  test('returns preferences only when deleted task instance cascades assignment removal', () => {
    seedTestTaskInstance({ id: 'missing' })
    setContextSettings({ contextId: 'ctx-missing', taskInstanceId: 'missing', platformInstanceId: 'telegram-default' })
    getTestDb().delete(taskInstances).where(eq(taskInstances.id, 'missing')).run()

    expect(getConfigKeysForContext('ctx-missing')).toEqual([
      'timezone',
      'mcp_endpoints',
      'language',
      'ai_tool_visibility',
      'ai_reasoning_visibility',
      'ai_output_detail_level',
      'ai_live_status',
    ])
  })

  test('returns preferences only when assigned instance is inactive', () => {
    insertTaskInstance({
      id: 'yt-stopped',
      type: 'youtrack',
      config: { baseUrl: 'https://yt.invalid' },
      status: 'stopped',
    })
    setContextSettings({
      contextId: 'ctx-stopped',
      taskInstanceId: 'yt-stopped',
      platformInstanceId: 'telegram-default',
    })

    expect(getConfigKeysForContext('ctx-stopped')).toEqual([
      'timezone',
      'mcp_endpoints',
      'language',
      'ai_tool_visibility',
      'ai_reasoning_visibility',
      'ai_output_detail_level',
      'ai_live_status',
    ])
  })

  test('returns dynamic provider keys for an active contributed assignment', () => {
    registerContributedTaskProviderType('demo-tracker', {
      pluginId: 'demo-plugin',
      factory: () => createMockProvider({ name: 'demo-tracker' }),
      capabilities: new Set(),
      displayName: 'Demo Tracker',
      contextConfigSchema: [{ key: 'token', label: 'Token', required: true, sensitive: true, scope: 'context' }],
    })
    insertTaskInstance({
      id: 'demo-prod',
      type: 'demo-tracker',
      config: { baseUrl: 'https://demo.invalid' },
      status: 'active',
    })
    setContextSettings({ contextId: 'ctx-demo', taskInstanceId: 'demo-prod', platformInstanceId: 'telegram-default' })

    expect(getConfigKeysForContext('ctx-demo')).toEqual([
      'plugin:demo-plugin:provider:token',
      'timezone',
      'mcp_endpoints',
      'language',
      'ai_tool_visibility',
      'ai_reasoning_visibility',
      'ai_output_detail_level',
      'ai_live_status',
    ])
  })

  test('getAllConfig only includes keys valid for the context (contributed youtrack)', () => {
    // youtrack is now plugin-contributed; token key is plugin-namespaced
    registerYouTrackContributed()
    insertTaskInstance({ id: 'yt-prod', type: 'youtrack', config: { baseUrl: 'https://yt.invalid' }, status: 'active' })
    setContextSettings({ contextId: 'ctx-yt', taskInstanceId: 'yt-prod', platformInstanceId: 'telegram-default' })
    // Simulate stale flat-key rows that may remain in cache from pre-migration data;
    // these are not ConfigKey members and should not appear in getAllConfig output.
    setCachedConfig('ctx-yt', 'kaneo_apikey', 'hidden-kaneo-key')
    setCachedConfig('ctx-yt', 'youtrack_token', 'perm:abc')
    setConfig('ctx-yt', 'timezone', 'UTC')

    // The contributed youtrack token uses plugin-namespaced key; legacy 'youtrack_token' is not visible
    expect(getAllConfig('ctx-yt')).toEqual({ timezone: 'UTC' })
  })
})

describe('getConfigFieldsForContext', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    process.env['INSTANCE_CONFIG_KEY'] = '5'.repeat(64)
  })

  afterEach(() => {
    unregisterContributedTaskProviderType('plugin-tracker')
  })

  test('includes plugin provider context credentials for the assigned context', () => {
    registerContributedTaskProviderType('plugin-tracker', {
      pluginId: 'plugin-tracker',
      factory: () => createMockProvider({ name: 'plugin-tracker' }),
      capabilities: new Set(),
      displayName: 'Plugin Tracker',
      instanceConfigSchema: [],
      contextConfigSchema: [{ key: 'token', label: 'Plugin Token', required: true, sensitive: true, scope: 'context' }],
    })
    insertTaskInstance({
      id: 'plugin-prod',
      type: 'plugin-tracker',
      config: { baseUrl: 'https://plugin.invalid' },
      status: 'active',
    })
    setContextSettings({
      contextId: 'ctx-plugin',
      taskInstanceId: 'plugin-prod',
      platformInstanceId: 'telegram-default',
    })

    const fields = getConfigFieldsForContext('ctx-plugin')

    expect(fields.map((field) => field.storageKey)).toContain('plugin:plugin-tracker:provider:token')
  })

  test('uses plugin provider context storageKey inside namespaced dynamic key', () => {
    registerContributedTaskProviderType('plugin-tracker', {
      pluginId: 'plugin-tracker',
      factory: () => createMockProvider({ name: 'plugin-tracker' }),
      capabilities: new Set(),
      displayName: 'Plugin Tracker',
      instanceConfigSchema: [],
      contextConfigSchema: [
        {
          key: 'token',
          storageKey: 'custom_token',
          label: 'Plugin Token',
          required: true,
          sensitive: true,
          scope: 'context',
        },
      ],
    })
    insertTaskInstance({
      id: 'plugin-prod',
      type: 'plugin-tracker',
      config: { baseUrl: 'https://plugin.invalid' },
      status: 'active',
    })
    setContextSettings({
      contextId: 'ctx-plugin',
      taskInstanceId: 'plugin-prod',
      platformInstanceId: 'telegram-default',
    })

    const fields = getConfigFieldsForContext('ctx-plugin')

    expect(fields.map((field) => field.storageKey)).toContain('plugin:plugin-tracker:provider:custom_token')
    expect(fields.map((field) => field.storageKey)).not.toContain('plugin:plugin-tracker:provider:token')
    expect(fields.map((field) => field.storageKey)).not.toContain('custom_token')
  })

  test('includes the AI-output fields as enum controls in any context', () => {
    const fields = getConfigFieldsForContext('ctx-any')
    const byKey = new Map(fields.map((field) => [field.storageKey, field]))

    const tool = byKey.get('ai_tool_visibility')
    expect(tool?.kind).toBe('ai-output')
    expect(tool?.required).toBe(false)
    expect(tool?.control).toBe('toggle')
    expect(tool?.options).toEqual([
      { value: 'off', label: 'Off' },
      { value: 'on', label: 'On' },
    ])

    expect(byKey.get('ai_reasoning_visibility')?.control).toBe('toggle')

    const detail = byKey.get('ai_output_detail_level')
    expect(detail?.control).toBe('select')
    expect(detail?.options).toEqual([
      { value: 'sanitized', label: 'Sanitized' },
      { value: 'raw', label: 'Raw' },
    ])

    const liveStatus = byKey.get('ai_live_status')
    expect(liveStatus?.kind).toBe('ai-output')
    expect(liveStatus?.required).toBe(false)
    expect(liveStatus?.control).toBe('toggle')
    expect(liveStatus?.options).toEqual([
      { value: 'off', label: 'Off' },
      { value: 'on', label: 'On' },
    ])
  })

  test('provider context field label comes from the descriptor field, not a hardcoded map', () => {
    registerContributedTaskProviderType('plugin-tracker', {
      pluginId: 'plugin-tracker',
      factory: () => createMockProvider({ name: 'plugin-tracker' }),
      capabilities: new Set(),
      displayName: 'Plugin Tracker',
      instanceConfigSchema: [],
      contextConfigSchema: [
        {
          key: 'token',
          label: 'My Distinct Token Label',
          required: true,
          sensitive: true,
          scope: 'context',
        },
      ],
    })
    insertTaskInstance({
      id: 'plugin-prod',
      type: 'plugin-tracker',
      config: { baseUrl: 'https://plugin.invalid' },
      status: 'active',
    })
    setContextSettings({
      contextId: 'ctx-plugin',
      taskInstanceId: 'plugin-prod',
      platformInstanceId: 'telegram-default',
    })

    const fields = getConfigFieldsForContext('ctx-plugin')
    const tokenField = fields.find((f) => f.storageKey.endsWith(':provider:token'))

    expect(tokenField?.label).toBe('My Distinct Token Label')
  })
})

describe('getConfigFieldsForContext reasoning effort options', () => {
  const effortFieldFor = (contextId: string): ConfigField | undefined =>
    getConfigFieldsForContext(contextId).find((field) => field.storageKey === 'ai_reasoning_effort')

  const defaultOption = { value: '', label: 'Provider default' }

  const unionOptions = [
    defaultOption,
    { value: 'none', label: 'none' },
    { value: 'minimal', label: 'minimal' },
    { value: 'low', label: 'low' },
    { value: 'medium', label: 'medium' },
    { value: 'high', label: 'high' },
    { value: 'xhigh', label: 'xhigh' },
    { value: 'max', label: 'max' },
  ]

  const prewarmCatalogue = async (providers: Record<string, { models: Record<string, unknown> }>): Promise<void> => {
    await prewarmModelsDevSnapshot({
      fetchImpl: () => Promise.resolve(JSON.stringify(providers)),
      cachePath: `/tmp/opencode/config-keys-${crypto.randomUUID()}/models.json`,
      now: () => 1_700_000_000_000,
    })
  }

  const seedMainModel = (model: string): void => {
    const provider = createLlmProvider(
      { label: 'admin-openai', providerType: 'openai', baseUrl: 'https://admin/v1', apiKey: 'sk-admin' },
      'admin',
    )
    setAdminRoleBindings({ main: { providerId: provider.id, model }, small: null, embedding: null }, 'admin')
  }

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    process.env['INSTANCE_CONFIG_KEY'] = '5'.repeat(64)
    clearLlmAdminCacheForTesting()
  })

  afterEach(() => {
    resetModelsDevSnapshotForTest()
  })

  test('derives the reasoning effort options from the active model catalogue entry', async () => {
    await prewarmCatalogue({
      openai: {
        models: {
          'o4-reasoning': {
            limit: { context: 200_000, output: 100_000 },
            reasoning: true,
            reasoning_options: [{ kind: 'effort', values: ['low', 'high'] }],
          },
        },
      },
    })
    seedMainModel('o4-reasoning')

    const field = effortFieldFor('ctx-effort-catalogue')

    expect(field?.kind).toBe('ai-output')
    expect(field?.required).toBe(false)
    expect(field?.control).toBe('select')
    expect(field?.options).toEqual([defaultOption, { value: 'low', label: 'low' }, { value: 'high', label: 'high' }])
  })

  test('falls back to the full union for a model the catalogue does not know', async () => {
    await prewarmCatalogue({ openai: { models: { 'other-model': { limit: { context: 1000 } } } } })
    seedMainModel('mystery-model')

    expect(effortFieldFor('ctx-effort-unknown')?.options).toEqual(unionOptions)
  })

  test('falls back to the full union when no provider is configured', async () => {
    await prewarmCatalogue({
      openai: {
        models: {
          'o4-reasoning': { reasoning: true, reasoning_options: [{ kind: 'effort', values: ['low'] }] },
        },
      },
    })

    expect(effortFieldFor('ctx-effort-unconfigured')?.options).toEqual(unionOptions)
  })

  test('offers the provider default only for a catalogue non-reasoning model', async () => {
    await prewarmCatalogue({
      openai: {
        models: { 'gpt-4o-mini': { limit: { context: 128_000 }, reasoning: false } },
      },
    })
    seedMainModel('gpt-4o-mini')

    expect(effortFieldFor('ctx-effort-non-reasoning')?.options).toEqual([defaultOption])
  })

  test('derives effort options per context while returning the other AI-output fields unchanged', async () => {
    await prewarmCatalogue({
      openai: {
        models: {
          'model-a': { reasoning: true, reasoning_options: [{ kind: 'effort', values: ['low', 'high'] }] },
          'model-b': { reasoning: true, reasoning_options: [{ kind: 'effort', values: ['minimal'] }] },
        },
      },
    })
    const providerA = createLlmProvider(
      { label: 'admin-a', providerType: 'openai', baseUrl: 'https://admin-a/v1', apiKey: 'sk-a' },
      'admin',
    )
    const providerB = createLlmProvider(
      { label: 'admin-b', providerType: 'openai', baseUrl: 'https://admin-b/v1', apiKey: 'sk-b' },
      'admin',
    )

    setAdminRoleBindings(
      { main: { providerId: providerA.id, model: 'model-a' }, small: null, embedding: null },
      'admin',
    )
    const fieldsA = getConfigFieldsForContext('ctx-effort-a')
    setAdminRoleBindings(
      { main: { providerId: providerB.id, model: 'model-b' }, small: null, embedding: null },
      'admin',
    )
    const fieldsB = getConfigFieldsForContext('ctx-effort-b')

    const byKeyA = new Map(fieldsA.map((field) => [field.storageKey, field]))
    const byKeyB = new Map(fieldsB.map((field) => [field.storageKey, field]))

    expect(byKeyA.get('ai_reasoning_effort')?.options).toEqual([
      defaultOption,
      { value: 'low', label: 'low' },
      { value: 'high', label: 'high' },
    ])
    expect(byKeyB.get('ai_reasoning_effort')?.options).toEqual([defaultOption, { value: 'minimal', label: 'minimal' }])

    for (const key of ['ai_tool_visibility', 'ai_reasoning_visibility', 'ai_output_detail_level', 'ai_live_status']) {
      expect(byKeyA.get(key)).toBe(byKeyB.get(key))
    }
    expect(byKeyA.get('ai_output_detail_level')?.options).toEqual([
      { value: 'sanitized', label: 'Sanitized' },
      { value: 'raw', label: 'Raw' },
    ])
  })
})

describe('getRequiredProviderConfigKeysForContext', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    process.env['INSTANCE_CONFIG_KEY'] = '5'.repeat(64)
  })

  afterEach(() => {
    unregisterContributedTaskProviderType('plugin-tracker')
  })

  test('returns the namespaced required provider context keys, excluding preferences and workspace', () => {
    registerContributedTaskProviderType('plugin-tracker', {
      pluginId: 'plugin-tracker',
      factory: () => createMockProvider({ name: 'plugin-tracker' }),
      capabilities: new Set(),
      displayName: 'Plugin Tracker',
      instanceConfigSchema: [],
      contextConfigSchema: [
        { key: 'credential', label: 'Plugin Credential', required: true, sensitive: true, scope: 'context' },
      ],
    })
    insertTaskInstance({
      id: 'plugin-prod',
      type: 'plugin-tracker',
      config: { baseUrl: 'https://plugin.invalid' },
      status: 'active',
    })
    setContextSettings({
      contextId: 'ctx-plugin',
      taskInstanceId: 'plugin-prod',
      platformInstanceId: 'telegram-default',
    })

    const keys = getRequiredProviderConfigKeysForContext('ctx-plugin')

    expect(keys).toContain('plugin:plugin-tracker:provider:credential')
    expect(keys).not.toContain('timezone')
    expect(keys).not.toContain('mcp_endpoints')
  })

  test('returns no provider keys when the context has no active task assignment', () => {
    const keys = getRequiredProviderConfigKeysForContext('unassigned-context')

    expect(keys.filter((k) => k.startsWith('plugin:'))).toHaveLength(0)
  })
})

describe('isSensitiveProviderStorageKey', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    process.env['INSTANCE_CONFIG_KEY'] = '5'.repeat(64)
    registerContributedTaskProviderType('plugin-tracker', {
      pluginId: 'plugin-tracker',
      factory: () => createMockProvider({ name: 'plugin-tracker' }),
      capabilities: new Set(),
      displayName: 'Plugin Tracker',
      instanceConfigSchema: [],
      contextConfigSchema: [
        { key: 'credential', label: 'Plugin Credential', required: true, sensitive: true, scope: 'context' },
        { key: 'workspaceId', label: 'Workspace ID', required: false, sensitive: false, scope: 'context' },
      ],
    })
  })

  afterEach(() => {
    unregisterContributedTaskProviderType('plugin-tracker')
  })

  test('true for a sensitive namespaced provider credential key', () => {
    expect(isSensitiveProviderStorageKey('plugin:plugin-tracker:provider:credential')).toBe(true)
  })

  test('false for a non-sensitive provider field and for unknown/static keys', () => {
    expect(isSensitiveProviderStorageKey('plugin:plugin-tracker:provider:workspaceId')).toBe(false)
    expect(isSensitiveProviderStorageKey('timezone')).toBe(false)
  })
})

describe('isFieldUnsettable', () => {
  const base: ConfigField = {
    key: 'timezone',
    storageKey: 'timezone',
    label: 'Timezone',
    required: false,
    sensitive: false,
    kind: 'preference',
    control: 'text',
  }

  test('declared fields are unsettable by default', () => {
    expect(isFieldUnsettable(base)).toBe(true)
  })

  test('an explicit unsettable:false opts out', () => {
    expect(isFieldUnsettable({ ...base, unsettable: false })).toBe(false)
  })
})
