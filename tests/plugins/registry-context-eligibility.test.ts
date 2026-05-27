// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { setPluginConfig } from '../../src/config.js'
import { getPluginContextEligibilityForEntry } from '../../src/plugins/registry-context-eligibility.js'
import type { PluginRegistryEntry } from '../../src/plugins/registry.js'
import { setPluginAdminConfig } from '../../src/plugins/store.js'
import type { DiscoveredPlugin } from '../../src/plugins/types.js'
import { PLUGIN_API_VERSION } from '../../src/plugins/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

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
})
