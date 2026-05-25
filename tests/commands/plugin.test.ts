// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { CommandHandler } from '../../src/chat/types.js'
import { registerPluginCommand } from '../../src/commands/plugin.js'
import { pluginRegistry } from '../../src/plugins/registry.js'
import { getPluginAdminState, isPluginEnabledForContext, recordRuntimeEvent } from '../../src/plugins/store.js'
import type { DiscoveredPlugin } from '../../src/plugins/types.js'
import { PLUGIN_API_VERSION } from '../../src/plugins/types.js'
import {
  createAuth,
  createDmMessage,
  createGroupMessage,
  createMockChatWithCommandHandlers,
  createMockReply,
  mockLogger,
  setupTestDb,
} from '../utils/test-helpers.js'

function makePlugin(id: string, hash = `hash-${id}`): DiscoveredPlugin {
  return {
    manifest: {
      id,
      name: 'Command Test Plugin',
      version: '1.0.0',
      description: 'Plugin command test fixture',
      apiVersion: PLUGIN_API_VERSION,
      main: 'index.ts',
      contributes: {
        tools: ['sync_tool'],
        promptFragments: ['hint'],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: [],
      },
      permissions: ['tasks.read'],
      defaultEnabled: false,
      activationTimeoutMs: 5000,
      requiredTaskCapabilities: [],
      requiredChatCapabilities: [],
      configRequirements: [],
      providerCapabilities: [],
      providerConfigSchema: [],
      providerAllowedHosts: [],
    },
    pluginDir: `/tmp/${id}`,
    entryPoint: `/tmp/${id}/index.ts`,
    manifestHash: hash,
  }
}

function registerCommandForTest(): CommandHandler {
  const { provider, commandHandlers } = createMockChatWithCommandHandlers()
  registerPluginCommand(provider, 'admin-user')
  const handler = commandHandlers.get('plugin')
  if (handler === undefined) throw new Error('plugin command was not registered')
  return handler
}

async function runPluginCommand(commandMatch: string, userId = 'admin-user'): Promise<string> {
  const handler = registerCommandForTest()
  const { reply, textCalls } = createMockReply()
  await handler(
    { ...createDmMessage(userId, `/plugin ${commandMatch}`), commandMatch },
    reply,
    createAuth(userId, { isBotAdmin: true }),
  )
  return textCalls[0] ?? ''
}

describe('registerPluginCommand', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('registers plugin management list command for bot admin', async () => {
    const { provider, commandHandlers } = createMockChatWithCommandHandlers()
    registerPluginCommand(provider, 'admin-user')

    const handler = commandHandlers.get('plugin')
    expect(handler).toBeDefined()

    const { reply, textCalls } = createMockReply()
    await handler!(
      { ...createDmMessage('admin-user', '/plugin list'), commandMatch: 'list' },
      reply,
      createAuth('admin-user', { isBotAdmin: true }),
    )

    expect(textCalls[0]).toContain('No plugins discovered')
  })

  test('denies non-admin users', async () => {
    const handler = registerCommandForTest()
    const { reply, textCalls } = createMockReply()

    await handler(
      { ...createDmMessage('user-1', '/plugin list'), commandMatch: 'list' },
      reply,
      createAuth('user-1', { isBotAdmin: false }),
    )

    expect(textCalls[0]).toContain('Only the bot admin')
  })

  test('denies plugin management in groups', async () => {
    const handler = registerCommandForTest()
    const { reply, textCalls } = createMockReply()

    await handler(
      { ...createGroupMessage('admin-user', '/plugin list', true, 'group-1'), commandMatch: 'list' },
      reply,
      createAuth('admin-user', { isBotAdmin: true, isGroupAdmin: true }),
    )

    expect(textCalls[0]).toContain('direct messages')
  })

  test('approves a discovered plugin and reports restart requirement', async () => {
    const plugin = makePlugin('approve-plugin')
    pluginRegistry.registerDiscovered(plugin)

    const output = await runPluginCommand('approve approve-plugin')

    expect(getPluginAdminState('approve-plugin')?.state).toBe('approved')
    expect(output).toContain('approved')
    expect(output).toContain('next startup')
  })

  test('rejects a plugin and reports restart requirement', async () => {
    const plugin = makePlugin('reject-plugin')
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'admin-user', plugin.manifestHash)

    const output = await runPluginCommand('reject reject-plugin')

    expect(getPluginAdminState('reject-plugin')?.state).toBe('rejected')
    expect(output).toContain('rejected')
    expect(output).toContain('next startup')
  })

  test('enables and disables an active plugin for a context', async () => {
    const plugin = makePlugin('toggle-plugin')
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'admin-user', plugin.manifestHash)
    pluginRegistry.markActive(plugin.manifest.id)

    const enabledOutput = await runPluginCommand('enable toggle-plugin ctx-1')
    const disabledOutput = await runPluginCommand('disable toggle-plugin ctx-1')

    expect(enabledOutput).toContain('enabled')
    expect(disabledOutput).toContain('disabled')
    expect(isPluginEnabledForContext('toggle-plugin', 'ctx-1')).toBe(false)
  })

  test('shows manifest-change reapproval diagnostics in plugin info', async () => {
    const plugin = makePlugin('changed-plugin', 'hash-old')
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'admin-user', plugin.manifestHash)
    pluginRegistry.registerDiscovered({ ...plugin, manifestHash: 'hash-new' })

    const output = await runPluginCommand('info changed-plugin')

    expect(output).toContain('Manifest changed')
    expect(output).toContain('re-approval required')
  })

  test('shows contribution details in plugin info', async () => {
    const plugin = makePlugin('details-plugin')
    pluginRegistry.registerDiscovered({
      ...plugin,
      manifest: {
        ...plugin.manifest,
        contributes: {
          tools: ['sync_tool'],
          promptFragments: ['hint'],
          commands: ['sync'],
          jobs: ['daily'],
          configKeys: ['api_token'],
          taskProviderTypes: [],
        },
      },
    })

    const output = await runPluginCommand('info details-plugin')

    expect(output).toContain('Tools: sync_tool')
    expect(output).toContain('Prompt fragments: hint')
    expect(output).toContain('Commands: sync')
    expect(output).toContain('Jobs: daily')
    expect(output).toContain('Config keys: api_token')
  })

  test('shows incompatible diagnostics in plugin info', async () => {
    const plugin = makePlugin('incompatible-plugin')
    pluginRegistry.registerDiscovered({
      ...plugin,
      manifest: { ...plugin.manifest, requiredTaskCapabilities: ['tasks.delete'] },
    })
    pluginRegistry.approve(plugin.manifest.id, 'admin-user', plugin.manifestHash)
    pluginRegistry.evaluateCompatibility(plugin.manifest.id, new Set(), new Set())

    const output = await runPluginCommand('info incompatible-plugin')

    expect(output).toContain('incompatible')
    expect(output).toContain('Required task capability missing')
  })

  test('shows runtime error diagnostics in plugin info', async () => {
    const plugin = makePlugin('error-plugin')
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'admin-user', plugin.manifestHash)
    pluginRegistry.markError(plugin.manifest.id, 'Activation failed: boom')
    recordRuntimeEvent(plugin.manifest.id, 'error', 'Activation failed: boom')

    const output = await runPluginCommand('info error-plugin')

    expect(output).toContain('error')
    expect(output).toContain('Activation failed: boom')
    expect(output).toContain('Recent events')
  })
})
