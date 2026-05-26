// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { ChatRouter } from '../../src/chat/router.js'
import type { CommandHandler } from '../../src/chat/types.js'
import { registerPluginCommand } from '../../src/commands/plugin.js'
import { clearRuntimeChatRouter, setRuntimeChatRouter } from '../../src/debug/chat-router-runtime.js'
import { addAdmin, SUPER_ADMIN_PLATFORM_ID } from '../../src/instances/admin-store.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import { pluginRegistry } from '../../src/plugins/registry.js'
import { getPluginAdminState, isPluginEnabledForContext, recordRuntimeEvent } from '../../src/plugins/store.js'
import type { DiscoveredPlugin } from '../../src/plugins/types.js'
import { PLUGIN_API_VERSION } from '../../src/plugins/types.js'
import {
  createAuth,
  createDmMessage,
  createGroupMessage,
  createMockChat,
  createMockChatWithCommandHandlers,
  createMockReply,
  mockLogger,
  setupTestDb,
} from '../utils/test-helpers.js'

function makePlugin(...args: [id: string] | [id: string, hash: string]): DiscoveredPlugin {
  const [id] = args
  const hash = args.length === 1 ? `hash-${id}` : args[1]
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

async function runPluginCommand(
  ...args: [commandMatch: string] | [commandMatch: string, userId: string]
): Promise<string> {
  const [commandMatch] = args
  const userId = args.length === 1 ? 'admin-user' : args[1]
  const handler = registerCommandForTest()
  const { reply, textCalls } = createMockReply()
  await handler(
    { ...createDmMessage(userId, `/plugin ${commandMatch}`), commandMatch },
    reply,
    createAuth(userId, { isBotAdmin: true }),
  )
  const firstText = textCalls[0]
  if (firstText === undefined) return ''
  return firstText
}

async function runPluginCommandFromPlatform(
  commandMatch: string,
  userId: string,
  platformInstanceId: string,
): Promise<string> {
  const handler = registerCommandForTest()
  const { reply, textCalls } = createMockReply()
  await handler(
    { ...createDmMessage(userId, `/plugin ${commandMatch}`), commandMatch, platformInstanceId },
    reply,
    createAuth(userId, { isBotAdmin: true }),
  )
  const firstText = textCalls[0]
  if (firstText === undefined) return ''
  return firstText
}

describe('registerPluginCommand', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  afterEach(() => {
    clearRuntimeChatRouter()
  })

  test('registers plugin management list command for bot admin', async () => {
    addAdmin('admin-user', 'test-instance')
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

    expect(textCalls[0]).toContain('Only an admin')
  })

  test('allows platform admin to list plugins without bot-admin auth flag', async () => {
    addAdmin('platform-admin', 'test-instance')
    const handler = registerCommandForTest()
    const { reply, textCalls } = createMockReply()

    await handler(
      { ...createDmMessage('platform-admin', '/plugin list'), commandMatch: 'list' },
      reply,
      createAuth('platform-admin', { isBotAdmin: false }),
    )

    expect(textCalls[0]).toContain('No plugins discovered')
  })

  test('denies user with bot-admin auth flag but no admin row', async () => {
    const handler = registerCommandForTest()
    const { reply, textCalls } = createMockReply()

    await handler(
      { ...createDmMessage('auth-only-admin', '/plugin list'), commandMatch: 'list' },
      reply,
      createAuth('auth-only-admin', { isBotAdmin: true }),
    )

    expect(textCalls[0]).toContain('Only an admin')
  })

  test('allows platform admin to inspect plugin info without bot-admin auth flag', async () => {
    addAdmin('platform-admin', 'test-instance')
    const plugin = makePlugin('platform-info-plugin')
    pluginRegistry.registerDiscovered(plugin)
    const handler = registerCommandForTest()
    const { reply, textCalls } = createMockReply()

    await handler(
      {
        ...createDmMessage('platform-admin', '/plugin info platform-info-plugin'),
        commandMatch: 'info platform-info-plugin',
      },
      reply,
      createAuth('platform-admin', { isBotAdmin: false }),
    )

    expect(textCalls[0]).toContain('platform-info-plugin')
  })

  test('plugin info reports source-context missing capabilities', async () => {
    const basePlugin = makePlugin('capability-info-plugin')
    const plugin: DiscoveredPlugin = {
      ...basePlugin,
      manifest: {
        ...basePlugin.manifest,
        defaultEnabled: true,
        requiredTaskCapabilities: ['workItems.list'],
        requiredChatCapabilities: ['messages.buttons'],
      },
    }
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'root-admin', plugin.manifestHash)
    pluginRegistry.markActive(plugin.manifest.id)
    insertTaskInstance({ id: 'kaneo-a', type: 'kaneo', config: { url: 'https://kaneo.invalid' }, status: 'active' })
    setContextSettings({ contextId: 'root-admin', taskInstanceId: 'kaneo-a', platformInstanceId: 'telegram-default' })
    const router = new ChatRouter(() => createMockChat({ capabilities: new Set() }))
    router.addInstance('telegram-default', 'telegram', { token: 'x' })
    setRuntimeChatRouter(router)
    addAdmin('root-admin', SUPER_ADMIN_PLATFORM_ID)
    const handler = registerCommandForTest()
    const { reply, textCalls } = createMockReply()

    await handler(
      {
        ...createDmMessage('root-admin', '/plugin info capability-info-plugin'),
        commandMatch: 'info capability-info-plugin',
        platformInstanceId: 'telegram-default',
      },
      reply,
      createAuth('root-admin'),
    )

    expect(textCalls[0]).toContain('Required task capabilities: workItems.list')
    expect(textCalls[0]).toContain('Required chat capabilities: messages.buttons')
    expect(textCalls[0]).toContain('Missing for this context: workItems.list, messages.buttons')
  })

  test('denies env admin id when auth is not bot admin', async () => {
    const handler = registerCommandForTest()
    const { reply, textCalls } = createMockReply()

    await handler(
      { ...createDmMessage('admin-user', '/plugin list'), commandMatch: 'list' },
      reply,
      createAuth('admin-user', { isBotAdmin: false }),
    )

    expect(textCalls[0]).toContain('Only an admin')
  })

  test('allows bot admin row even when user id differs from registered admin id', async () => {
    addAdmin('row-admin', 'test-instance')
    const handler = registerCommandForTest()
    const { reply, textCalls } = createMockReply()

    await handler(
      { ...createDmMessage('row-admin', '/plugin list'), commandMatch: 'list' },
      reply,
      createAuth('row-admin', { isBotAdmin: true }),
    )

    expect(textCalls[0]).toContain('No plugins discovered')
  })

  test('denies plugin management in groups', async () => {
    addAdmin('admin-user', 'test-instance')
    const handler = registerCommandForTest()
    const { reply, textCalls } = createMockReply()

    await handler(
      {
        ...createGroupMessage('admin-user', '/plugin list', true, 'group-1'),
        commandMatch: 'list',
      },
      reply,
      createAuth('admin-user', { isBotAdmin: true, isGroupAdmin: true }),
    )

    expect(textCalls[0]).toContain('direct messages')
  })

  test('approves a discovered plugin and reports restart requirement', async () => {
    addAdmin('admin-user', SUPER_ADMIN_PLATFORM_ID)
    const plugin = makePlugin('approve-plugin')
    pluginRegistry.registerDiscovered(plugin)

    const output = await runPluginCommand('approve approve-plugin')

    const state = getPluginAdminState('approve-plugin')
    expect(state).toBeDefined()
    expect(state!.state).toBe('approved')
    expect(output).toContain('approved')
    expect(output).toContain('next startup')
  })

  test('rejects a plugin and reports restart requirement', async () => {
    addAdmin('admin-user', SUPER_ADMIN_PLATFORM_ID)
    const plugin = makePlugin('reject-plugin')
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'admin-user', plugin.manifestHash)

    const output = await runPluginCommand('reject reject-plugin')

    const state = getPluginAdminState('reject-plugin')
    expect(state).toBeDefined()
    expect(state!.state).toBe('rejected')
    expect(output).toContain('rejected')
    expect(output).toContain('next startup')
  })

  test('denies approve for platform admin without super-admin row', async () => {
    addAdmin('platform-admin', 'test-instance')
    const plugin = makePlugin('platform-approve-plugin')
    pluginRegistry.registerDiscovered(plugin)

    const output = await runPluginCommand('approve platform-approve-plugin', 'platform-admin')

    const state = getPluginAdminState('platform-approve-plugin')
    expect(state).toBeDefined()
    expect(state!.state).toBe('discovered')
    expect(output).toContain('Only the super admin')
  })

  test('denies reject for platform admin without super-admin row', async () => {
    addAdmin('super-admin', SUPER_ADMIN_PLATFORM_ID)
    addAdmin('platform-admin', 'test-instance')
    const plugin = makePlugin('platform-reject-plugin')
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'super-admin', plugin.manifestHash)

    const output = await runPluginCommand('reject platform-reject-plugin', 'platform-admin')

    const state = getPluginAdminState('platform-reject-plugin')
    expect(state).toBeDefined()
    expect(state!.state).toBe('approved')
    expect(output).toContain('Only the super admin')
  })

  test('enables and disables an active plugin for a context', async () => {
    addAdmin('admin-user', 'test-instance')
    setContextSettings({ contextId: 'ctx-1', taskInstanceId: 'tasks-1', platformInstanceId: 'test-instance' })
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

  test('denies enable when target context belongs to another platform instance', async () => {
    addAdmin('platform-admin', 'test-instance')
    setContextSettings({ contextId: 'other-context', taskInstanceId: 'tasks-1', platformInstanceId: 'other-platform' })
    const plugin = makePlugin('target-platform-plugin')
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'super-admin', plugin.manifestHash)
    pluginRegistry.markActive(plugin.manifest.id)

    const output = await runPluginCommand('enable target-platform-plugin other-context', 'platform-admin')

    expect(isPluginEnabledForContext('target-platform-plugin', 'other-context')).toBe(false)
    expect(output).toContain('not authorized')
  })

  test('allows enable for target context platform admin', async () => {
    addAdmin('platform-admin', 'other-platform')
    setContextSettings({ contextId: 'other-context', taskInstanceId: 'tasks-1', platformInstanceId: 'other-platform' })
    const plugin = makePlugin('matching-platform-plugin')
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'super-admin', plugin.manifestHash)
    pluginRegistry.markActive(plugin.manifest.id)

    const output = await runPluginCommandFromPlatform(
      'enable matching-platform-plugin other-context',
      'platform-admin',
      'other-platform',
    )

    expect(isPluginEnabledForContext('matching-platform-plugin', 'other-context')).toBe(true)
    expect(output).toContain('enabled')
  })

  test('denies explicit target context when settings are missing', async () => {
    addAdmin('platform-admin', 'source-platform')
    const plugin = makePlugin('source-platform-plugin')
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'super-admin', plugin.manifestHash)
    pluginRegistry.markActive(plugin.manifest.id)

    const output = await runPluginCommandFromPlatform(
      'enable source-platform-plugin missing-context',
      'platform-admin',
      'source-platform',
    )

    expect(isPluginEnabledForContext('source-platform-plugin', 'missing-context')).toBe(false)
    expect(output).toContain('not configured')
  })

  test('denies explicit disable target context when settings are missing', async () => {
    addAdmin('platform-admin', 'source-platform')
    const plugin = makePlugin('missing-disable-plugin')
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'super-admin', plugin.manifestHash)
    pluginRegistry.markActive(plugin.manifest.id)

    const output = await runPluginCommandFromPlatform(
      'disable missing-disable-plugin missing-context',
      'platform-admin',
      'source-platform',
    )

    expect(output).toContain('not configured')
  })

  test('defaults omitted enable target to requester DM context', async () => {
    addAdmin('platform-admin', 'test-instance')
    const plugin = makePlugin('default-target-plugin')
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'super-admin', plugin.manifestHash)
    pluginRegistry.markActive(plugin.manifest.id)

    const output = await runPluginCommand('enable default-target-plugin', 'platform-admin')

    expect(isPluginEnabledForContext('default-target-plugin', 'platform-admin')).toBe(true)
    expect(output).toContain('enabled')
  })

  test('shows manifest-change reapproval diagnostics in plugin info', async () => {
    addAdmin('admin-user', 'test-instance')
    const plugin = makePlugin('changed-plugin', 'hash-old')
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'admin-user', plugin.manifestHash)
    pluginRegistry.registerDiscovered({ ...plugin, manifestHash: 'hash-new' })

    const output = await runPluginCommand('info changed-plugin')

    expect(output).toContain('Manifest changed')
    expect(output).toContain('re-approval required')
  })

  test('shows contribution details in plugin info', async () => {
    addAdmin('admin-user', 'test-instance')
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
    addAdmin('admin-user', 'test-instance')
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
    addAdmin('admin-user', 'test-instance')
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
