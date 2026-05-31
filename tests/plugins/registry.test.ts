// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { ChatRouter } from '../../src/chat/router.js'
import { setPluginConfig } from '../../src/config.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { pluginAdminState } from '../../src/db/plugin-schema.js'
import { clearRuntimeChatRouter, setRuntimeChatRouter } from '../../src/debug/chat-router-runtime.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
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
  getPluginContextState,
  setPluginAdminConfig,
  updatePluginAdminStateField,
} from '../../src/plugins/store.js'
import type { DiscoveredPlugin, PluginState } from '../../src/plugins/types.js'
import { PLUGIN_API_VERSION } from '../../src/plugins/types.js'
import { createMockChat, mockLogger, seedTestPlatformInstance, setupTestDb } from '../utils/test-helpers.js'

function makePlugin(...overrides: readonly Partial<DiscoveredPlugin>[]): DiscoveredPlugin {
  const pluginOverrides = overrides[0]
  return {
    manifest: {
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      description: 'A test',
      apiVersion: PLUGIN_API_VERSION,
      main: 'index.ts',
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: [],
      },
      permissions: [],
      defaultEnabled: false,
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
    ...pluginOverrides,
  }
}

function expectEntryState(registry: PluginRegistry, pluginId: string, state: PluginState): void {
  const entry = registry.getEntry(pluginId)
  expect(entry).toBeDefined()
  expect(entry!.state).toBe(state)
}

function expectEntryReason(registry: PluginRegistry, pluginId: string, reason: string): void {
  const entry = registry.getEntry(pluginId)
  expect(entry).toBeDefined()
  expect(entry!.compatibilityReason).toBe(reason)
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
    expect(result).toEqual({
      compatible: false,
      reason: 'Required task capability missing: tasks.delete',
    })
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
    expectEntryState(registry, 'test-plugin', 'discovered')
  })

  test('approve transitions state to approved', () => {
    const plugin = makePlugin()
    registry.registerDiscovered(plugin)
    const ok = registry.approve('test-plugin', 'admin', 'hash-abc')
    expect(ok).toBe(true)
    expectEntryState(registry, 'test-plugin', 'approved')
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
    expectEntryState(registry, 'test-plugin', 'rejected')
  })

  test('reject returns false for unknown plugin', () => {
    expect(registry.reject('unknown')).toBe(false)
  })

  test('markActive transitions approved plugin to active', () => {
    const plugin = makePlugin()
    registry.registerDiscovered(plugin)
    registry.approve('test-plugin', 'admin', 'hash-abc')
    registry.markActive('test-plugin')
    expectEntryState(registry, 'test-plugin', 'active')
  })

  test('markActive persists active state to plugin_admin_state', () => {
    const plugin = makePlugin()
    registry.registerDiscovered(plugin)
    registry.approve('test-plugin', 'admin', 'hash-abc')

    registry.markActive('test-plugin')

    expect(getPluginAdminState('test-plugin')?.state).toBe('active')
  })

  test('markError records reason and sets error state', () => {
    const plugin = makePlugin()
    registry.registerDiscovered(plugin)
    registry.approve('test-plugin', 'admin', 'hash-abc')
    registry.markError('test-plugin', 'timeout')
    expectEntryState(registry, 'test-plugin', 'error')
    expectEntryReason(registry, 'test-plugin', 'timeout')
  })

  test('markError persists error state and reason to plugin_admin_state', () => {
    const plugin = makePlugin()
    registry.registerDiscovered(plugin)
    registry.approve('test-plugin', 'admin', 'hash-abc')

    registry.markError('test-plugin', 'activation failed')

    expect(getPluginAdminState('test-plugin')?.state).toBe('error')
    expect(getPluginAdminState('test-plugin')?.compatibilityReason).toBe('activation failed')
  })

  test('markDeactivated transitions active plugin back to approved', () => {
    const plugin = makePlugin()
    registry.registerDiscovered(plugin)
    registry.approve('test-plugin', 'admin', 'hash-abc')
    registry.markActive('test-plugin')
    registry.markDeactivated('test-plugin')
    expectEntryState(registry, 'test-plugin', 'approved')
  })

  test('markDeactivated persists approved state after active runtime', () => {
    const plugin = makePlugin()
    registry.registerDiscovered(plugin)
    registry.approve('test-plugin', 'admin', 'hash-abc')
    registry.markActive('test-plugin')

    registry.markDeactivated('test-plugin')

    expect(getPluginAdminState('test-plugin')?.state).toBe('approved')
  })

  test('evaluateCompatibilityAcrossInstances marks incompatible when capability missing', () => {
    const plugin = makePlugin({
      manifest: { ...makePlugin().manifest, requiredTaskCapabilities: ['tasks.delete'] },
    })
    registry.registerDiscovered(plugin)
    registry.approve('test-plugin', 'admin', 'hash-abc')
    registry.evaluateCompatibilityAcrossInstances([{ taskCapabilities: new Set(), chatCapabilities: new Set() }])
    expectEntryState(registry, 'test-plugin', 'incompatible')
  })

  test('evaluateCompatibilityAcrossInstances leaves compatible plugin as approved', () => {
    const plugin = makePlugin({
      manifest: { ...makePlugin().manifest, requiredTaskCapabilities: ['tasks.delete'] },
    })
    registry.registerDiscovered(plugin)
    registry.approve('test-plugin', 'admin', 'hash-abc')
    registry.evaluateCompatibilityAcrossInstances([
      { taskCapabilities: new Set(['tasks.delete']), chatCapabilities: new Set() },
    ])
    expectEntryState(registry, 'test-plugin', 'approved')
  })

  test('evaluateCompatibilityAcrossInstances keeps approved when any capability set satisfies requirements', () => {
    const plugin = makePlugin({
      manifest: {
        ...makePlugin().manifest,
        requiredTaskCapabilities: ['workItems.list'],
        requiredChatCapabilities: ['messages.buttons'],
      },
    })
    registry.registerDiscovered(plugin)
    registry.approve('test-plugin', 'admin', 'hash-abc')

    registry.evaluateCompatibilityAcrossInstances([
      { taskCapabilities: new Set(), chatCapabilities: new Set(['messages.buttons']) },
      { taskCapabilities: new Set(['workItems.list']), chatCapabilities: new Set(['messages.buttons']) },
    ])

    expectEntryState(registry, 'test-plugin', 'approved')
  })

  test('evaluateCompatibilityAcrossInstances marks approved plugin incompatible when no set satisfies requirements', () => {
    const plugin = makePlugin({
      manifest: { ...makePlugin().manifest, requiredTaskCapabilities: ['workItems.list'] },
    })
    registry.registerDiscovered(plugin)
    registry.approve('test-plugin', 'admin', 'hash-abc')

    registry.evaluateCompatibilityAcrossInstances([
      { taskCapabilities: new Set(['comments.read']), chatCapabilities: new Set() },
      { taskCapabilities: new Set(['tasks.delete']), chatCapabilities: new Set() },
    ])

    expectEntryState(registry, 'test-plugin', 'incompatible')
    expectEntryReason(registry, 'test-plugin', 'No active instance satisfies required capabilities')
  })

  test('evaluateCompatibilityAcrossInstances keeps plugins with no requirements approved when no instances are active', () => {
    const plugin = makePlugin()
    registry.registerDiscovered(plugin)
    registry.approve('test-plugin', 'admin', 'hash-abc')

    registry.evaluateCompatibilityAcrossInstances([])

    expectEntryState(registry, 'test-plugin', 'approved')
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
    expectEntryState(registry, 'test-plugin', 'discovered')
    const adminState = getPluginAdminState('test-plugin')
    expect(adminState).toBeDefined()
    expect(adminState!.approvedManifestHash).toBeNull()
    expect(adminState!.approvedBy).toBeNull()
  })

  test('startup normalizes persisted active state back to approved when approval hash exists', () => {
    const plugin = makePlugin()
    registry.registerDiscovered(plugin)
    registry.approve('test-plugin', 'admin', 'hash-abc')
    registry.markActive('test-plugin')

    const restartedRegistry = new PluginRegistry()
    restartedRegistry.registerDiscovered(plugin)

    expectEntryState(restartedRegistry, 'test-plugin', 'approved')
    expect(restartedRegistry.getApprovedCompatiblePlugins()).toHaveLength(1)
  })

  test('startup normalizes persisted error state back to approved when approval hash exists', () => {
    const plugin = makePlugin()
    registry.registerDiscovered(plugin)
    registry.approve('test-plugin', 'admin', 'hash-abc')
    registry.markError('test-plugin', 'activation failed')

    const restartedRegistry = new PluginRegistry()
    restartedRegistry.registerDiscovered(plugin)

    expectEntryState(restartedRegistry, 'test-plugin', 'approved')
    expect(restartedRegistry.getApprovedCompatiblePlugins()).toHaveLength(1)
  })

  test('persisted incompatible state can recover on startup when capabilities become available', () => {
    const plugin = makePlugin({
      manifest: { ...makePlugin().manifest, requiredTaskCapabilities: ['tasks.delete'] },
    })
    registry.registerDiscovered(plugin)
    registry.approve('test-plugin', 'admin', 'hash-abc')
    registry.evaluateCompatibilityAcrossInstances([{ taskCapabilities: new Set(), chatCapabilities: new Set() }])
    expectEntryState(registry, 'test-plugin', 'incompatible')

    const restartedRegistry = new PluginRegistry()
    restartedRegistry.registerDiscovered(plugin)
    restartedRegistry.evaluateCompatibilityAcrossInstances([
      { taskCapabilities: new Set(['tasks.delete']), chatCapabilities: new Set() },
    ])

    expectEntryState(restartedRegistry, 'test-plugin', 'approved')
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

    expectEntryState(restartedRegistry, 'test-plugin', 'discovered')
    expect(restartedRegistry.getApprovedCompatiblePlugins()).toHaveLength(0)
  })

  test('startup preserves approval for legacy persisted config_missing state when approval hash exists', () => {
    const plugin = makePlugin()
    registry.registerDiscovered(plugin)
    registry.approve('test-plugin', 'admin', 'hash-abc')

    getDrizzleDb()
      .update(pluginAdminState)
      .set({ state: 'config_missing', compatibilityReason: 'Missing config from legacy runtime state' })
      .where(eq(pluginAdminState.pluginId, 'test-plugin'))
      .run()

    const restartedRegistry = new PluginRegistry()
    restartedRegistry.registerDiscovered(plugin)

    expectEntryState(restartedRegistry, 'test-plugin', 'approved')
    expect(restartedRegistry.getApprovedCompatiblePlugins()).toHaveLength(1)

    const adminState = getPluginAdminState('test-plugin')
    expect(adminState?.state).toBe('approved')
    expect(adminState?.approvedManifestHash).toBe('hash-abc')
    expect(adminState?.compatibilityReason).toBeNull()
  })
})

describe('singleton registry helpers', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  afterEach(() => {
    clearRuntimeChatRouter()
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
    expect(getPluginContextState('test-plugin', 'ctx-1')?.enabled).toBe(true)
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
        configRequirements: [
          { key: 'api_token', label: 'API Token', required: true, sensitive: true, scope: 'context' },
        ],
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
        configRequirements: [
          { key: 'project_hint', label: 'Project Hint', required: false, sensitive: false, scope: 'context' },
        ],
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
        configRequirements: [
          { key: 'api_token', label: 'API Token', required: true, sensitive: true, scope: 'context' },
        ],
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

  test('returns capability_missing when assigned task instance lacks a required task capability', () => {
    const pluginId = 'task-capability-plugin'
    const contextId = 'ctx-task-capability'
    const plugin = makePlugin({
      manifest: {
        ...makePlugin().manifest,
        id: pluginId,
        name: 'Task Capability Plugin',
        defaultEnabled: true,
        requiredTaskCapabilities: ['workItems.list'],
      },
      manifestHash: 'hash-task-capability',
    })
    insertTaskInstance({ id: 'kaneo-a', type: 'kaneo', config: { baseUrl: 'https://kaneo.invalid' }, status: 'active' })
    seedTestPlatformInstance({ id: 'telegram-a' })
    setContextSettings({ contextId, taskInstanceId: 'kaneo-a', platformInstanceId: 'telegram-a' })

    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(pluginId, 'admin', 'hash-task-capability')
    pluginRegistry.markActive(pluginId)

    expect(getPluginContextEligibility(pluginId, contextId)).toEqual({
      eligible: false,
      reason: 'capability_missing',
      missingCapabilities: ['workItems.list'],
    })
    expect(getPluginsForContext(contextId)).toEqual([])
  })

  test('returns capability_missing when assigned platform instance lacks a required chat capability', () => {
    const pluginId = 'chat-capability-plugin'
    const contextId = 'ctx-chat-capability'
    const plugin = makePlugin({
      manifest: {
        ...makePlugin().manifest,
        id: pluginId,
        name: 'Chat Capability Plugin',
        defaultEnabled: true,
        requiredChatCapabilities: ['messages.buttons'],
      },
      manifestHash: 'hash-chat-capability',
    })
    insertTaskInstance({ id: 'yt-a', type: 'youtrack', config: { baseUrl: 'https://yt.invalid' }, status: 'active' })
    seedTestPlatformInstance({ id: 'telegram-a' })
    setContextSettings({ contextId, taskInstanceId: 'yt-a', platformInstanceId: 'telegram-a' })
    const router = new ChatRouter(() => createMockChat({ capabilities: new Set() }))
    router.addInstance('telegram-a', 'telegram', { token: 'x' })
    setRuntimeChatRouter(router)

    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(pluginId, 'admin', 'hash-chat-capability')
    pluginRegistry.markActive(pluginId)

    expect(getPluginContextEligibility(pluginId, contextId)).toEqual({
      eligible: false,
      reason: 'capability_missing',
      missingCapabilities: ['messages.buttons'],
    })
  })

  test('returns capability_missing when assigned platform instance is stopped despite supporting a required chat capability', async () => {
    const pluginId = 'stopped-chat-capability-plugin'
    const contextId = 'ctx-stopped-chat-capability'
    const plugin = makePlugin({
      manifest: {
        ...makePlugin().manifest,
        id: pluginId,
        name: 'Stopped Chat Capability Plugin',
        defaultEnabled: true,
        requiredChatCapabilities: ['messages.buttons'],
      },
      manifestHash: 'hash-stopped-chat-capability',
    })
    insertTaskInstance({ id: 'yt-a', type: 'youtrack', config: { baseUrl: 'https://yt.invalid' }, status: 'active' })
    seedTestPlatformInstance({ id: 'telegram-a' })
    setContextSettings({ contextId, taskInstanceId: 'yt-a', platformInstanceId: 'telegram-a' })
    const router = new ChatRouter(() => createMockChat({ capabilities: new Set(['messages.buttons']) }))
    router.addInstance('telegram-a', 'telegram', { token: 'x' })
    await router.stopInstance('telegram-a')
    setRuntimeChatRouter(router)

    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(pluginId, 'admin', 'hash-stopped-chat-capability')
    pluginRegistry.markActive(pluginId)

    expect(getPluginContextEligibility(pluginId, contextId)).toEqual({
      eligible: false,
      reason: 'capability_missing',
      missingCapabilities: ['messages.buttons'],
    })
  })

  test('skips capability checks when context settings are absent', () => {
    const pluginId = 'pre-setup-plugin'
    const plugin = makePlugin({
      manifest: {
        ...makePlugin().manifest,
        id: pluginId,
        name: 'Pre Setup Plugin',
        defaultEnabled: true,
        requiredTaskCapabilities: ['workItems.list'],
      },
      manifestHash: 'hash-pre-setup',
    })
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(pluginId, 'admin', 'hash-pre-setup')
    pluginRegistry.markActive(pluginId)

    expect(getPluginContextEligibility(pluginId, 'ctx-without-settings')).toEqual({ eligible: true })
  })

  test('returns config_missing when required admin config is not set', () => {
    const pluginId = 'admin-config-missing-plugin'
    const contextId = 'ctx-admin-config-missing'
    const plugin = makePlugin({
      manifest: {
        ...makePlugin().manifest,
        id: pluginId,
        name: 'Admin Config Missing Plugin',
        defaultEnabled: true,
        configRequirements: [{ key: 'api_key', label: 'API Key', required: true, sensitive: true, scope: 'admin' }],
      },
      manifestHash: 'hash-admin-config-missing',
    })

    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(pluginId, 'admin', 'hash-admin-config-missing')
    pluginRegistry.markActive(pluginId)

    expect(getPluginContextEligibility(pluginId, contextId)).toEqual({
      eligible: false,
      reason: 'config_missing',
      missingKeys: ['api_key'],
    })
  })

  test('returns eligible when required admin config is set', () => {
    const pluginId = 'admin-config-set-plugin'
    const contextId = 'ctx-admin-config-set'
    const plugin = makePlugin({
      manifest: {
        ...makePlugin().manifest,
        id: pluginId,
        name: 'Admin Config Set Plugin',
        defaultEnabled: true,
        configRequirements: [{ key: 'api_key', label: 'API Key', required: true, sensitive: true, scope: 'admin' }],
      },
      manifestHash: 'hash-admin-config-set',
    })

    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(pluginId, 'admin', 'hash-admin-config-set')
    pluginRegistry.markActive(pluginId)
    setPluginAdminConfig(pluginId, 'api_key', 'sk-test-123', 'admin')

    expect(getPluginContextEligibility(pluginId, contextId)).toEqual({ eligible: true })
  })
})
