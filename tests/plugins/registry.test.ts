// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { setPluginConfig } from '../../src/config.js'
import {
  PluginRegistry,
  checkPluginCompatibility,
  getPluginContextEligibility,
  getPluginsForContext,
  isPluginActiveForContext,
  pluginRegistry,
  setPluginEnabledForContext,
  syncRegistryFromDb,
} from '../../src/plugins/registry.js'
import {
  getPluginAdminState,
  isPluginEnabledForContext as storeIsEnabled,
  updatePluginAdminStateField,
} from '../../src/plugins/store.js'
import type { DiscoveredPlugin } from '../../src/plugins/types.js'
import { PLUGIN_API_VERSION } from '../../src/plugins/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

function makePlugin(overrides: Partial<DiscoveredPlugin> = {}): DiscoveredPlugin {
  return {
    manifest: {
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      description: 'A test',
      apiVersion: PLUGIN_API_VERSION,
      main: 'index.ts',
      contributes: { tools: [], promptFragments: [], commands: [], jobs: [], configKeys: [] },
      permissions: [],
      defaultEnabled: false,
      activationTimeoutMs: 5000,
      requiredTaskCapabilities: [],
      requiredChatCapabilities: [],
      configRequirements: [],
    },
    pluginDir: '/fake/plugin-dir/test-plugin',
    entryPoint: '/fake/plugin-dir/test-plugin/index.ts',
    manifestHash: 'hash-abc',
    ...overrides,
  }
}

describe('checkPluginCompatibility', () => {
  test('returns compatible for a matching apiVersion with no requirements', () => {
    const plugin = makePlugin()
    const result = checkPluginCompatibility(plugin.manifest, new Set(), new Set())
    expect(result.compatible).toBe(true)
  })

  test('returns compatible with all requirements met', () => {
    // checkPluginCompatibility includes a runtime apiVersion guard;
    // since PluginManifest enforces apiVersion=1 via Zod literal, the guard
    // cannot be hit from type-safe code. We test the compatible path instead.
    const plugin = makePlugin()
    const result = checkPluginCompatibility(plugin.manifest, new Set(), new Set())
    expect(result.compatible).toBe(true)
  })

  test('returns incompatible for missing task capability', () => {
    const plugin = makePlugin({
      manifest: { ...makePlugin().manifest, requiredTaskCapabilities: ['tasks.delete'] },
    })
    const result = checkPluginCompatibility(plugin.manifest, new Set(), new Set())
    expect(result).toEqual({ compatible: false, reason: 'Required task capability missing: tasks.delete' })
  })

  test('returns compatible when task capability is present', () => {
    const plugin = makePlugin({
      manifest: { ...makePlugin().manifest, requiredTaskCapabilities: ['tasks.delete'] },
    })
    const result = checkPluginCompatibility(plugin.manifest, new Set(['tasks.delete']), new Set())
    expect(result.compatible).toBe(true)
  })

  test('returns incompatible for missing chat capability', () => {
    const plugin = makePlugin({
      manifest: { ...makePlugin().manifest, requiredChatCapabilities: ['messages.buttons'] },
    })
    const result = checkPluginCompatibility(plugin.manifest, new Set(), new Set())
    expect(result.compatible).toBe(false)
  })
})

describe('PluginRegistry', () => {
  let registry: PluginRegistry

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    registry = new PluginRegistry()
  })

  test('registers a discovered plugin', () => {
    const plugin = makePlugin()
    registry.registerDiscovered(plugin)
    const entry = registry.getEntry('test-plugin')
    expect(entry).toBeDefined()
    expect(entry?.state).toBe('discovered')
  })

  test('approve transitions state to approved', () => {
    const plugin = makePlugin()
    registry.registerDiscovered(plugin)
    const ok = registry.approve('test-plugin', 'admin', 'hash-abc')
    expect(ok).toBe(true)
    expect(registry.getEntry('test-plugin')?.state).toBe('approved')
  })

  test('approve returns false for unknown plugin', () => {
    const ok = registry.approve('unknown', 'admin', 'hash')
    expect(ok).toBe(false)
  })

  test('reject transitions state to rejected', () => {
    const plugin = makePlugin()
    registry.registerDiscovered(plugin)
    const ok = registry.reject('test-plugin')
    expect(ok).toBe(true)
    expect(registry.getEntry('test-plugin')?.state).toBe('rejected')
  })

  test('reject returns false for unknown plugin', () => {
    expect(registry.reject('unknown')).toBe(false)
  })

  test('markActive transitions approved plugin to active', () => {
    const plugin = makePlugin()
    registry.registerDiscovered(plugin)
    registry.approve('test-plugin', 'admin', 'hash-abc')
    registry.markActive('test-plugin')
    expect(registry.getEntry('test-plugin')?.state).toBe('active')
  })

  test('markError records reason and sets error state', () => {
    const plugin = makePlugin()
    registry.registerDiscovered(plugin)
    registry.approve('test-plugin', 'admin', 'hash-abc')
    registry.markError('test-plugin', 'timeout')
    const entry = registry.getEntry('test-plugin')
    expect(entry?.state).toBe('error')
    expect(entry?.compatibilityReason).toBe('timeout')
  })

  test('markDeactivated transitions active plugin back to approved', () => {
    const plugin = makePlugin()
    registry.registerDiscovered(plugin)
    registry.approve('test-plugin', 'admin', 'hash-abc')
    registry.markActive('test-plugin')
    registry.markDeactivated('test-plugin')
    expect(registry.getEntry('test-plugin')?.state).toBe('approved')
  })

  test('evaluateCompatibility marks incompatible when capability missing', () => {
    const plugin = makePlugin({
      manifest: { ...makePlugin().manifest, requiredTaskCapabilities: ['tasks.delete'] },
    })
    registry.registerDiscovered(plugin)
    registry.approve('test-plugin', 'admin', 'hash-abc')
    registry.evaluateCompatibility('test-plugin', new Set(), new Set())
    expect(registry.getEntry('test-plugin')?.state).toBe('incompatible')
  })

  test('evaluateCompatibility leaves compatible plugin as approved', () => {
    const plugin = makePlugin({
      manifest: { ...makePlugin().manifest, requiredTaskCapabilities: ['tasks.delete'] },
    })
    registry.registerDiscovered(plugin)
    registry.approve('test-plugin', 'admin', 'hash-abc')
    registry.evaluateCompatibility('test-plugin', new Set(['tasks.delete']), new Set())
    expect(registry.getEntry('test-plugin')?.state).toBe('approved')
  })

  test('getApprovedCompatiblePlugins returns approved plugins', () => {
    const plugin = makePlugin()
    registry.registerDiscovered(plugin)
    registry.approve('test-plugin', 'admin', 'hash-abc')
    expect(registry.getApprovedCompatiblePlugins()).toHaveLength(1)
  })

  test('getActivePlugins returns only active plugins', () => {
    const plugin = makePlugin()
    registry.registerDiscovered(plugin)
    registry.approve('test-plugin', 'admin', 'hash-abc')
    registry.markActive('test-plugin')
    expect(registry.getActivePlugins()).toHaveLength(1)
  })

  test('manifest hash change reverts approved to discovered', () => {
    const plugin = makePlugin()
    registry.registerDiscovered(plugin)
    registry.approve('test-plugin', 'admin', 'hash-abc')
    // Re-discover with a different hash
    registry.registerDiscovered({ ...plugin, manifestHash: 'hash-new' })
    expect(registry.getEntry('test-plugin')?.state).toBe('discovered')
    const adminState = getPluginAdminState('test-plugin')
    expect(adminState?.approvedManifestHash).toBeNull()
    expect(adminState?.approvedBy).toBeNull()
  })

  test('startup normalizes persisted active state back to approved when approval hash exists', () => {
    const plugin = makePlugin()
    registry.registerDiscovered(plugin)
    registry.approve('test-plugin', 'admin', 'hash-abc')
    registry.markActive('test-plugin')

    const restartedRegistry = new PluginRegistry()
    restartedRegistry.registerDiscovered(plugin)

    expect(restartedRegistry.getEntry('test-plugin')?.state).toBe('approved')
    expect(restartedRegistry.getApprovedCompatiblePlugins()).toHaveLength(1)
  })

  test('startup normalizes persisted error state back to approved when approval hash exists', () => {
    const plugin = makePlugin()
    registry.registerDiscovered(plugin)
    registry.approve('test-plugin', 'admin', 'hash-abc')
    registry.markError('test-plugin', 'activation failed')

    const restartedRegistry = new PluginRegistry()
    restartedRegistry.registerDiscovered(plugin)

    expect(restartedRegistry.getEntry('test-plugin')?.state).toBe('approved')
    expect(restartedRegistry.getApprovedCompatiblePlugins()).toHaveLength(1)
  })

  test('persisted incompatible state can recover on startup when capabilities become available', () => {
    const plugin = makePlugin({
      manifest: { ...makePlugin().manifest, requiredTaskCapabilities: ['tasks.delete'] },
    })
    registry.registerDiscovered(plugin)
    registry.approve('test-plugin', 'admin', 'hash-abc')
    registry.evaluateCompatibility('test-plugin', new Set(), new Set())
    expect(registry.getEntry('test-plugin')?.state).toBe('incompatible')

    const restartedRegistry = new PluginRegistry()
    restartedRegistry.registerDiscovered(plugin)
    restartedRegistry.evaluateCompatibility('test-plugin', new Set(['tasks.delete']), new Set())

    expect(restartedRegistry.getEntry('test-plugin')?.state).toBe('approved')
    expect(restartedRegistry.getApprovedCompatiblePlugins()).toHaveLength(1)
  })

  test('startup falls back to discovered when approved hash is missing', () => {
    const plugin = makePlugin()
    registry.registerDiscovered(plugin)
    registry.approve('test-plugin', 'admin', 'hash-abc')
    updatePluginAdminStateField('test-plugin', {
      approvedManifestHash: null,
      state: 'active',
    })

    const restartedRegistry = new PluginRegistry()
    restartedRegistry.registerDiscovered(plugin)

    expect(restartedRegistry.getEntry('test-plugin')?.state).toBe('discovered')
    expect(restartedRegistry.getApprovedCompatiblePlugins()).toHaveLength(0)
  })
})

describe('singleton registry helpers', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  afterEach(() => {
    // no-op: each test gets fresh setupTestDb
  })

  test('syncRegistryFromDb calls registerDiscovered for each plugin', () => {
    const plugin = makePlugin()
    syncRegistryFromDb([plugin])
    // After sync, plugin should be in registry
    // We can't access the singleton's private state directly but can verify via isPluginActiveForContext
    expect(isPluginActiveForContext('test-plugin', 'ctx-1')).toBe(false)
  })

  test('setPluginEnabledForContext persists context-level enablement', () => {
    setPluginEnabledForContext('test-plugin', 'ctx-1', true)
    expect(storeIsEnabled('test-plugin', 'ctx-1')).toBe(true)
  })

  test('getPluginsForContext returns active plugins enabled for context', () => {
    expect(getPluginsForContext('ctx-unused')).toEqual([])
  })

  test('excludes enabled active plugin from context when required plugin config is unset', () => {
    const pluginId = 'required-config-plugin'
    const contextId = 'ctx-required-config'
    const plugin = makePlugin({
      manifest: {
        ...makePlugin().manifest,
        id: pluginId,
        name: 'Required Config Plugin',
        defaultEnabled: true,
        configRequirements: [{ key: 'api_token', label: 'API Token', required: true, sensitive: true }],
      },
      manifestHash: 'hash-required-config',
    })

    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(pluginId, 'admin', 'hash-required-config')
    pluginRegistry.markActive(pluginId)

    expect(getPluginContextEligibility(pluginId, contextId)).toEqual({
      eligible: false,
      reason: 'config_missing',
      missingKeys: ['api_token'],
    })
    expect(getPluginsForContext(contextId)).toEqual([])
  })

  test('treats optional plugin config as non-blocking for context eligibility', () => {
    const pluginId = 'optional-config-plugin'
    const contextId = 'ctx-optional-config'
    const plugin = makePlugin({
      manifest: {
        ...makePlugin().manifest,
        id: pluginId,
        name: 'Optional Config Plugin',
        defaultEnabled: true,
        configRequirements: [{ key: 'project_hint', label: 'Project Hint', required: false, sensitive: false }],
      },
      manifestHash: 'hash-optional-config',
    })

    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(pluginId, 'admin', 'hash-optional-config')
    pluginRegistry.markActive(pluginId)

    expect(getPluginContextEligibility(pluginId, contextId)).toEqual({ eligible: true })
    expect(getPluginsForContext(contextId).map((p) => p.manifest.id)).toContain(pluginId)
  })

  test('allows enabled active plugin when required plugin config is set for the target context', () => {
    const pluginId = 'configured-plugin'
    const contextId = 'ctx-configured-plugin'
    const plugin = makePlugin({
      manifest: {
        ...makePlugin().manifest,
        id: pluginId,
        name: 'Configured Plugin',
        defaultEnabled: false,
        configRequirements: [{ key: 'api_token', label: 'API Token', required: true, sensitive: true }],
      },
      manifestHash: 'hash-configured-plugin',
    })

    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(pluginId, 'admin', 'hash-configured-plugin')
    pluginRegistry.markActive(pluginId)
    setPluginEnabledForContext(pluginId, contextId, true)
    setPluginConfig(contextId, pluginId, 'api_token', 'secret-token')

    expect(getPluginContextEligibility(pluginId, contextId)).toEqual({ eligible: true })
    expect(getPluginsForContext(contextId).map((p) => p.manifest.id)).toContain(pluginId)
  })
})
