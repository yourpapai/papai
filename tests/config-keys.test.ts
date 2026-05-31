// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import {
  getConfigFieldsForContext,
  getConfigKeysForContext,
  getRequiredProviderConfigKeysForContext,
} from '../src/config-keys.js'
import { setConfig, getAllConfig } from '../src/config.js'
import { taskInstances } from '../src/db/schema.js'
import { setContextSettings } from '../src/instances/context-store.js'
import { insertTaskInstance } from '../src/instances/task-store.js'
import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../src/providers/registry.js'
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
    expect(getConfigKeysForContext('ctx-unassigned')).toEqual(['timezone', 'mcp_endpoints'])
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

    expect(getConfigKeysForContext('ctx-kaneo')).toEqual(['timezone', 'mcp_endpoints'])
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
    ])
  })

  test('returns preferences only when deleted task instance cascades assignment removal', () => {
    seedTestTaskInstance({ id: 'missing' })
    setContextSettings({ contextId: 'ctx-missing', taskInstanceId: 'missing', platformInstanceId: 'telegram-default' })
    getTestDb().delete(taskInstances).where(eq(taskInstances.id, 'missing')).run()

    expect(getConfigKeysForContext('ctx-missing')).toEqual(['timezone', 'mcp_endpoints'])
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

    expect(getConfigKeysForContext('ctx-stopped')).toEqual(['timezone', 'mcp_endpoints'])
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
    ])
  })

  test('getAllConfig only includes keys valid for the context (contributed youtrack)', () => {
    // youtrack is now plugin-contributed; token key is plugin-namespaced
    registerYouTrackContributed()
    insertTaskInstance({ id: 'yt-prod', type: 'youtrack', config: { baseUrl: 'https://yt.invalid' }, status: 'active' })
    setContextSettings({ contextId: 'ctx-yt', taskInstanceId: 'yt-prod', platformInstanceId: 'telegram-default' })
    setConfig('ctx-yt', 'kaneo_apikey', 'hidden-kaneo-key')
    setConfig('ctx-yt', 'youtrack_token', 'perm:abc')
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
