// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { setPluginConfig } from '../../src/config.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import { getPluginContextEligibilityForEntry } from '../../src/plugins/registry-context-eligibility.js'
import { getPluginContextEligibility, pluginRegistry } from '../../src/plugins/registry.js'
import type { PluginRegistryEntry } from '../../src/plugins/registry.js'
import { setPluginAdminConfig } from '../../src/plugins/store.js'
import type { DiscoveredPlugin } from '../../src/plugins/types.js'
import { PLUGIN_API_VERSION } from '../../src/plugins/types.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../utils/test-helpers.js'

function makePlugin(overrides?: Partial<DiscoveredPlugin>): DiscoveredPlugin {
  return {
    manifest: {
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      description: 'A test',
      apiVersion: PLUGIN_API_VERSION,
      main: 'index.ts',
      contributes: { tools: [], promptFragments: [], commands: [], jobs: [], configKeys: [], taskProviderTypes: [] },
      permissions: [],
      defaultEnabled: true,
      activationTimeoutMs: 5000,
      requiredTaskCapabilities: [],
      requiredChatCapabilities: [],
      configRequirements: [],
      providerCapabilities: [],
      providerConfigSchema: [],
      providerAllowedHosts: [],
    },
    pluginDir: '/fake/plugin-dir/test-plugin',
    entryPoint: '/fake/plugin-dir/test-plugin/index.ts',
    manifestHash: 'hash-abc',
    ...overrides,
  }
}

function makeActiveEntry(plugin: DiscoveredPlugin): PluginRegistryEntry {
  return {
    discoveredPlugin: plugin,
    state: 'active',
    compatibilityReason: undefined,
  }
}

describe('admin-scoped config eligibility', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns config_missing when required admin config is not set', () => {
    const plugin = makePlugin({
      manifest: {
        ...makePlugin().manifest,
        configRequirements: [{ key: 'api_key', label: 'API Key', required: true, sensitive: true, scope: 'admin' }],
      },
    })

    const result = getPluginContextEligibilityForEntry(makeActiveEntry(plugin), 'test-plugin', 'ctx-1')
    expect(result).toEqual({ eligible: false, reason: 'config_missing', missingKeys: ['api_key'] })
  })

  test('returns eligible when required admin config is set', () => {
    const plugin = makePlugin({
      manifest: {
        ...makePlugin().manifest,
        configRequirements: [{ key: 'api_key', label: 'API Key', required: true, sensitive: true, scope: 'admin' }],
      },
    })
    setPluginAdminConfig('test-plugin', 'api_key', 'sk-test-123', 'admin')

    const result = getPluginContextEligibilityForEntry(makeActiveEntry(plugin), 'test-plugin', 'ctx-1')
    expect(result).toEqual({ eligible: true })
  })

  test('returns config_missing when admin config is set but empty', () => {
    const plugin = makePlugin({
      manifest: {
        ...makePlugin().manifest,
        configRequirements: [{ key: 'api_key', label: 'API Key', required: true, sensitive: true, scope: 'admin' }],
      },
    })
    setPluginAdminConfig('test-plugin', 'api_key', '  ', 'admin')

    const result = getPluginContextEligibilityForEntry(makeActiveEntry(plugin), 'test-plugin', 'ctx-1')
    expect(result).toEqual({ eligible: false, reason: 'config_missing', missingKeys: ['api_key'] })
  })

  test('context-scoped config still uses per-context store', () => {
    const plugin = makePlugin({
      manifest: {
        ...makePlugin().manifest,
        configRequirements: [{ key: 'token', label: 'Token', required: true, sensitive: true, scope: 'context' }],
      },
    })
    setPluginConfig('ctx-1', 'test-plugin', 'token', 'my-token')

    const result = getPluginContextEligibilityForEntry(makeActiveEntry(plugin), 'test-plugin', 'ctx-1')
    expect(result).toEqual({ eligible: true })
  })

  test('returns capability_missing instead of throwing when assigned task provider type is unknown', () => {
    const pluginId = 'unknown-provider-eligibility-plugin'
    const contextId = 'ctx-unknown-provider'
    const plugin = makePlugin({
      manifest: {
        ...makePlugin().manifest,
        id: pluginId,
        name: 'Unknown Provider Eligibility Plugin',
        defaultEnabled: true,
        requiredTaskCapabilities: ['workItems.list'],
      },
      manifestHash: 'hash-unknown-provider-eligibility',
    })
    insertTaskInstance({ id: 'ghost-task', type: 'ghost-provider', config: {}, status: 'active' })
    seedTestPlatformInstance({ id: 'telegram-a' })
    setContextSettings({ contextId, taskInstanceId: 'ghost-task', platformInstanceId: 'telegram-a' })

    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(pluginId, 'admin', 'hash-unknown-provider-eligibility')
    pluginRegistry.markActive(pluginId)

    expect(getPluginContextEligibility(pluginId, contextId)).toEqual({
      eligible: false,
      reason: 'capability_missing',
      missingCapabilities: ['workItems.list'],
    })
  })
})
