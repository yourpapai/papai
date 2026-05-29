// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ChatRouter } from '../../src/chat/router.js'
import { setConfig, setPluginConfig } from '../../src/config.js'
import { clearRuntimeChatRouter, setRuntimeChatRouter } from '../../src/debug/chat-router-runtime.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import { discoverPlugins } from '../../src/plugins/discovery.js'
import { activatePlugins, deactivateAllPlugins } from '../../src/plugins/loader.js'
import { pluginRegistry, setPluginEnabledForContext } from '../../src/plugins/registry.js'
import type { DiscoveredPlugin } from '../../src/plugins/types.js'
import { defaultTaskProviderResolver } from '../../src/providers/resolver.js'
import { buildSystemPrompt } from '../../src/system-prompt.js'
import { makeTools } from '../../src/tools/index.js'
import { setKaneoWorkspace } from '../../src/users.js'
import { createMockProvider } from '../tools/mock-provider.js'
import {
  createMockChat,
  getToolExecutor,
  mockLogger,
  seedCommonTestPlatformInstances,
  setupTestDb,
} from '../utils/test-helpers.js'

type TempPluginOptions = {
  readonly pluginId: string
  readonly source: string
  readonly manifestPatch: Record<string, unknown>
}

const tempDirs: string[] = []

function createTempPlugin({ pluginId, source, manifestPatch }: TempPluginOptions): string {
  const rootDir = mkdtempSync(join(tmpdir(), 'papai-plugin-integration-'))
  tempDirs.push(rootDir)
  const pluginDir = join(rootDir, pluginId)
  const manifest = {
    id: pluginId,
    name: 'Integration Plugin',
    version: '1.0.0',
    description: 'Plugin integration fixture',
    apiVersion: 1,
    main: 'index.js',
    contributes: {
      tools: ['echo_context'],
      promptFragments: ['guidance'],
      commands: [],
      jobs: [],
      configKeys: [],
    },
    permissions: ['tasks.read'],
    defaultEnabled: false,
    activationTimeoutMs: 5000,
    requiredTaskCapabilities: [],
    requiredChatCapabilities: [],
    configRequirements: [],
    ...manifestPatch,
  }

  mkdirSync(pluginDir)
  writeFileSync(join(pluginDir, 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(join(pluginDir, 'index.js'), source)
  return rootDir
}

function discoverSinglePlugin(rootDir: string): DiscoveredPlugin {
  const result = discoverPlugins(rootDir)
  expect(result.errors).toEqual([])
  expect(result.plugins).toHaveLength(1)
  const plugin = result.plugins[0]
  if (plugin === undefined) throw new Error('expected discovered plugin')
  return plugin
}

const workingPluginSource = `
  export default function createPlugin() {
    return {
      activate(ctx) {
        ctx.registration.registerTool({
          name: 'echo_context',
          description: 'Echo active context',
          execute: async (_input, runtimeContext) => ({
            pluginId: runtimeContext.pluginId,
            storageContextId: runtimeContext.storageContextId,
            chatUserId: runtimeContext.chatUserId,
          }),
        })
        ctx.registration.registerPromptFragment({
          name: 'guidance',
          content: 'INTEGRATION_PLUGIN_GUIDANCE',
        })
      },
    }
  }
`

describe('plugin lifecycle integration', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    await deactivateAllPlugins()
  })

  afterEach(async () => {
    clearRuntimeChatRouter()
    await deactivateAllPlugins()
    tempDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  })

  test('discovers, approves, activates, opts in, exposes tools/prompts, then deactivates', async () => {
    const provider = createMockProvider()
    const rootDir = createTempPlugin({ pluginId: 'lifecycle-plugin', source: workingPluginSource, manifestPatch: {} })
    const plugin = discoverSinglePlugin(rootDir)

    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'admin-user', plugin.manifestHash)
    pluginRegistry.evaluateCompatibilityAcrossInstances([
      { taskCapabilities: provider.capabilities, chatCapabilities: new Set() },
    ])
    await activatePlugins(pluginRegistry.getApprovedCompatiblePlugins())
    setPluginEnabledForContext(plugin.manifest.id, 'ctx-enabled', true)

    const disabledTools = await makeTools(provider, {
      storageContextId: 'ctx-disabled',
      chatUserId: 'user-1',
      contextType: 'dm',
    })
    const enabledTools = await makeTools(provider, {
      storageContextId: 'ctx-enabled',
      chatUserId: 'user-1',
      contextType: 'dm',
    })

    expect(disabledTools).not.toHaveProperty('plugin_lifecycle_plugin__echo_context')
    expect(enabledTools).toHaveProperty('plugin_lifecycle_plugin__echo_context')
    await expect(
      getToolExecutor(enabledTools['plugin_lifecycle_plugin__echo_context'])({}, { toolCallId: 'call-1' }),
    ).resolves.toEqual({
      pluginId: 'lifecycle-plugin',
      storageContextId: 'ctx-enabled',
      chatUserId: 'user-1',
    })
    expect(buildSystemPrompt(provider, 'ctx-disabled')).not.toContain('INTEGRATION_PLUGIN_GUIDANCE')
    expect(buildSystemPrompt(provider, 'ctx-enabled')).toContain('INTEGRATION_PLUGIN_GUIDANCE')

    await deactivateAllPlugins()

    const toolsAfterDeactivate = await makeTools(provider, {
      storageContextId: 'ctx-enabled',
      chatUserId: 'user-1',
      contextType: 'dm',
    })
    expect(toolsAfterDeactivate).not.toHaveProperty('plugin_lifecycle_plugin__echo_context')
    expect(buildSystemPrompt(provider, 'ctx-enabled')).not.toContain('INTEGRATION_PLUGIN_GUIDANCE')
  })

  test('requires reapproval when a discovered manifest hash changes', () => {
    const rootDir = createTempPlugin({ pluginId: 'changed-plugin', source: workingPluginSource, manifestPatch: {} })
    const plugin = discoverSinglePlugin(rootDir)
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'admin-user', plugin.manifestHash)

    const changed = { ...plugin, manifestHash: 'changed-hash' }
    pluginRegistry.registerDiscovered(changed)

    const entry = pluginRegistry.getEntry(plugin.manifest.id)
    expect(entry).toBeDefined()
    expect(entry!.state).toBe('discovered')
    expect(entry!.compatibilityReason).toContain('Manifest changed')
  })

  test('does not activate plugins missing required provider capabilities', async () => {
    const provider = createMockProvider({ capabilities: new Set() })
    const rootDir = createTempPlugin({
      pluginId: 'capability-plugin',
      source: workingPluginSource,
      manifestPatch: { requiredTaskCapabilities: ['tasks.delete'] },
    })
    const plugin = discoverSinglePlugin(rootDir)
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'admin-user', plugin.manifestHash)
    pluginRegistry.evaluateCompatibilityAcrossInstances([
      { taskCapabilities: provider.capabilities, chatCapabilities: new Set() },
    ])

    await activatePlugins(pluginRegistry.getApprovedCompatiblePlugins())

    expect(pluginRegistry.getEntry(plugin.manifest.id)!.state).toBe('incompatible')
  })

  test('does not expose active contributions when required context config is missing', async () => {
    const provider = createMockProvider()
    const rootDir = createTempPlugin({
      pluginId: 'config-plugin',
      source: workingPluginSource,
      manifestPatch: {
        defaultEnabled: true,
        configRequirements: [{ key: 'api_token', label: 'API Token', required: true, sensitive: true }],
      },
    })
    const plugin = discoverSinglePlugin(rootDir)
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'admin-user', plugin.manifestHash)
    await activatePlugins(pluginRegistry.getApprovedCompatiblePlugins())

    const toolsWithoutConfig = await makeTools(provider, {
      storageContextId: 'ctx-config',
      chatUserId: 'user-1',
      contextType: 'dm',
    })
    setPluginConfig('ctx-config', plugin.manifest.id, 'api_token', 'secret')
    const toolsWithConfig = await makeTools(provider, {
      storageContextId: 'ctx-config',
      chatUserId: 'user-1',
      contextType: 'dm',
    })

    expect(toolsWithoutConfig).not.toHaveProperty('plugin_config_plugin__echo_context')
    expect(toolsWithConfig).toHaveProperty('plugin_config_plugin__echo_context')
  })

  test('cleans contributions after activation failure', async () => {
    const rootDir = createTempPlugin({
      pluginId: 'failing-plugin',
      source: `
        export default function createPlugin() {
          return { activate() { throw new Error('activation failed') } }
        }
      `,
      manifestPatch: {},
    })
    const plugin = discoverSinglePlugin(rootDir)
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'admin-user', plugin.manifestHash)

    await activatePlugins(pluginRegistry.getApprovedCompatiblePlugins())

    expect(pluginRegistry.getEntry(plugin.manifest.id)!.state).toBe('error')
    expect(
      await makeTools(createMockProvider(), {
        storageContextId: 'ctx-enabled',
        chatUserId: 'user-1',
        contextType: 'dm',
      }),
    ).not.toHaveProperty('plugin_failing_plugin__echo_context')
  })

  test('context opt-out hides default-enabled active contributions', async () => {
    const provider = createMockProvider()
    const rootDir = createTempPlugin({
      pluginId: 'opt-out-plugin',
      source: workingPluginSource,
      manifestPatch: { defaultEnabled: true },
    })
    const plugin = discoverSinglePlugin(rootDir)
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'admin-user', plugin.manifestHash)
    await activatePlugins(pluginRegistry.getApprovedCompatiblePlugins())
    setPluginEnabledForContext(plugin.manifest.id, 'ctx-opt-out', false)

    const tools = await makeTools(provider, {
      storageContextId: 'ctx-opt-out',
      chatUserId: 'user-1',
      contextType: 'dm',
    })
    expect(tools).not.toHaveProperty('plugin_opt_out_plugin__echo_context')
    expect(buildSystemPrompt(provider, 'ctx-opt-out')).not.toContain('INTEGRATION_PLUGIN_GUIDANCE')
  })

  test('exposes plugin tools only for contexts whose resolved provider has required capabilities', async () => {
    const rootDir = createTempPlugin({
      pluginId: 'provider-capability-plugin',
      source: workingPluginSource,
      manifestPatch: { defaultEnabled: true, requiredTaskCapabilities: ['workItems.list'] },
    })
    const plugin = discoverSinglePlugin(rootDir)
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'admin-user', plugin.manifestHash)
    pluginRegistry.evaluateCompatibilityAcrossInstances([
      { taskCapabilities: new Set(['workItems.list']), chatCapabilities: new Set() },
    ])
    await activatePlugins(pluginRegistry.getApprovedCompatiblePlugins())

    insertTaskInstance({ id: 'kaneo-a', type: 'kaneo', config: { url: 'https://kaneo.invalid' }, status: 'active' })
    insertTaskInstance({ id: 'youtrack-a', type: 'youtrack', config: { url: 'https://yt.invalid' }, status: 'active' })
    setContextSettings({ contextId: 'ctx-kaneo', taskInstanceId: 'kaneo-a', platformInstanceId: 'telegram-default' })
    setContextSettings({
      contextId: 'ctx-youtrack',
      taskInstanceId: 'youtrack-a',
      platformInstanceId: 'telegram-default',
    })
    setConfig('ctx-kaneo', 'kaneo_apikey', 'kn-key')
    setKaneoWorkspace('ctx-kaneo', 'workspace-1')
    setConfig('ctx-youtrack', 'youtrack_token', 'perm:abc')
    const router = new ChatRouter(() => createMockChat())
    router.addInstance('telegram-default', 'telegram', { token: 'x' })
    setRuntimeChatRouter(router)

    const kaneoProvider = await defaultTaskProviderResolver.resolve('ctx-kaneo')
    const youtrackProvider = await defaultTaskProviderResolver.resolve('ctx-youtrack')
    expect(kaneoProvider).not.toBeNull()
    expect(youtrackProvider).not.toBeNull()

    const kaneoTools = await makeTools(kaneoProvider!, {
      storageContextId: 'ctx-kaneo',
      chatUserId: 'user-1',
      contextType: 'dm',
    })
    const youtrackTools = await makeTools(youtrackProvider!, {
      storageContextId: 'ctx-youtrack',
      chatUserId: 'user-1',
      contextType: 'dm',
    })

    expect(kaneoTools).not.toHaveProperty('plugin_provider_capability_plugin__echo_context')
    expect(youtrackTools).toHaveProperty('plugin_provider_capability_plugin__echo_context')
  })
})
