// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { ChatCapability, ChatProvider, CommandHandler } from '../../src/chat/types.js'
import { registerConfigCommand, renderConfigForTarget } from '../../src/commands/config.js'
import { setConfig, setPluginConfig } from '../../src/config.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import { pluginRegistry } from '../../src/plugins/registry.js'
import type { DiscoveredPlugin } from '../../src/plugins/types.js'
import { PLUGIN_API_VERSION } from '../../src/plugins/types.js'
import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../../src/providers/registry.js'
import { setToolPrefs } from '../../src/tools/tool-preferences.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { clearUserCache } from '../utils/test-cache.js'
import {
  createAuth,
  createDmMessage,
  createMockChatWithCommandHandlers,
  createMockReply,
  mockLogger,
  seedCommonTestPlatformInstances,
  setupTestDb,
} from '../utils/test-helpers.js'

const USER_ID = 'config-test-user'

function createRouterLikeChat(sourceProvider: ChatProvider): ChatProvider {
  const router = createMockChatWithCommandHandlers({
    capabilities: new Set<ChatCapability>([
      'interactions.callbacks',
      'messages.buttons',
      'messages.delete',
      'messages.files',
      'files.receive',
    ]),
  })
  return {
    ...router.provider,
    name: 'router',
    getInstance: (id: string) => (id === 'mattermost-no-buttons' ? { provider: sourceProvider } : null),
  } as ChatProvider
}

function assignKaneoContext(contextId: string): void {
  insertTaskInstance({
    id: `${contextId}-kaneo`,
    type: 'kaneo',
    config: { baseUrl: 'https://kaneo.invalid' },
    status: 'active',
  })
  setContextSettings({ contextId, taskInstanceId: `${contextId}-kaneo`, platformInstanceId: 'telegram-default' })
}

function makePlugin(pluginId: string, ...rest: [] | [Partial<DiscoveredPlugin['manifest']>]): DiscoveredPlugin {
  const overrides = rest.length === 0 ? {} : rest[0]
  const baseManifest: DiscoveredPlugin['manifest'] = {
    id: pluginId,
    name: 'Config Test Plugin',
    version: '1.0.0',
    description: 'Plugin config render test',
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
    defaultEnabled: true,
    activationTimeoutMs: 5000,
    requiredTaskCapabilities: [],
    requiredChatCapabilities: [],
    configRequirements: [],
    providerCapabilities: [],
    providerTraits: [],
    providerConfigSchema: [],
    providerContextConfigSchema: [],
    providerAllowedHosts: [],
  }
  return {
    manifest: {
      ...baseManifest,
      ...overrides,
      contributes: overrides.contributes ?? baseManifest.contributes,
      providerTraits: overrides.providerTraits ?? baseManifest.providerTraits,
      providerContextConfigSchema: overrides.providerContextConfigSchema ?? baseManifest.providerContextConfigSchema,
    },
    pluginDir: `/tmp/${pluginId}`,
    entryPoint: `/tmp/${pluginId}/index.ts`,
    manifestHash: `hash-${pluginId}`,
  }
}

function registerActivePlugin(plugin: DiscoveredPlugin): void {
  pluginRegistry.registerDiscovered(plugin)
  pluginRegistry.approve(plugin.manifest.id, 'admin', plugin.manifestHash)
  pluginRegistry.markActive(plugin.manifest.id)
}

describe('/config Command', () => {
  let configHandler: CommandHandler | null

  describe('with interactive button support', () => {
    beforeEach(async () => {
      mockLogger()
      await setupTestDb()
      seedCommonTestPlatformInstances()
      clearUserCache(USER_ID)

      const { provider: mockChat, commandHandlers } = createMockChatWithCommandHandlers()
      registerConfigCommand(mockChat, (_userId: string) => true)
      const handler = commandHandlers.get('config')
      configHandler = null
      if (handler !== undefined) configHandler = handler
    })

    test('shows all config keys with values and masked secrets', async () => {
      assignKaneoContext(USER_ID)
      setConfig(USER_ID, 'kaneo_apikey', 'sk-abc1234')
      const { reply, buttonCalls } = createMockReply()
      await renderConfigForTarget(reply, USER_ID, true)
      expect(buttonCalls[0]).toContain('****1234')
      expect(buttonCalls[0]).toContain('*(not set)*')
    })

    test('includes AI output section and controls', async () => {
      const buttonTexts: string[] = []
      const { reply, buttonCalls } = createMockReply()
      await renderConfigForTarget(
        {
          ...reply,
          buttons: (content, options): Promise<void> => {
            buttonCalls.push(content)
            assert.ok(options.buttons !== undefined, 'expected options.buttons to be defined')
            buttonTexts.push(...options.buttons.map((button) => button.text))
            return Promise.resolve()
          },
        },
        USER_ID,
        true,
      )

      expect(buttonCalls[0]).toContain('AI Output')
      expect(buttonCalls[0]).toContain('Tool calls: off')
      expect(buttonCalls[0]).toContain('Reasoning: off')
      expect(buttonCalls[0]).toContain('Detail level: sanitized')
      expect(buttonTexts).toContain('Show tool calls')
      expect(buttonTexts).toContain('Show reasoning')
      expect(buttonTexts).toContain('Use raw detail')
    })

    test('shows unset placeholder for unconfigured keys', async () => {
      assignKaneoContext(USER_ID)
      const { reply, buttonCalls } = createMockReply()
      await renderConfigForTarget(reply, USER_ID, true)
      assert.ok(buttonCalls[0] !== undefined, 'expected buttonCalls[0] to be defined')
      const output = buttonCalls[0]
      expect(output.length).toBeGreaterThan(0)
      const lines = output.split('\n').filter((line) => line.trim().length > 0)
      expect(lines.length).toBeGreaterThan(0)
      expect(lines).toContain('🔐 Kaneo API Key: *(not set)*')
      expect(lines).toContain('🌍 Timezone: *(not set)*')
    })

    test('renders only config keys for the assigned task instance', async () => {
      insertTaskInstance({
        id: 'yt-prod',
        type: 'youtrack',
        config: { baseUrl: 'https://yt.invalid' },
        status: 'active',
      })
      setContextSettings({ contextId: USER_ID, taskInstanceId: 'yt-prod', platformInstanceId: 'telegram-default' })
      setConfig(USER_ID, 'youtrack_token', 'perm:abc1234')

      const { reply, buttonCalls } = createMockReply()
      await renderConfigForTarget(reply, USER_ID, true)

      assert.ok(buttonCalls[0] !== undefined, 'expected buttonCalls[0] to be defined')
      expect(buttonCalls[0]).toContain('YouTrack Token')
      expect(buttonCalls[0]).toContain('Timezone')
      expect(buttonCalls[0]).not.toContain('Kaneo API Key')
    })

    test('renders compact callback payloads for long plugin provider context keys', async () => {
      const contextId = 'managed-group-context-with-a-very-long-stable-storage-id'
      const callbackData: string[] = []
      registerActivePlugin(makePlugin('config-long-callback-plugin', { name: 'Long Callback Plugin' }))
      registerContributedTaskProviderType('very-long-plugin-provider-name', {
        pluginId: 'very-long-plugin-provider-name',
        factory: () => createMockProvider({ name: 'very-long-plugin-provider-name' }),
        capabilities: new Set(),
        displayName: 'Long Plugin Provider',
        contextConfigSchema: [
          {
            key: 'very-long-context-token-field',
            label: 'Plugin Token',
            required: true,
            sensitive: true,
            scope: 'context',
          },
        ],
      })
      try {
        insertTaskInstance({
          id: 'long-plugin-prod',
          type: 'very-long-plugin-provider-name',
          config: { baseUrl: 'https://plugin.invalid' },
          status: 'active',
        })
        setContextSettings({
          contextId,
          taskInstanceId: 'long-plugin-prod',
          platformInstanceId: 'telegram-default',
        })
        const { reply } = createMockReply()

        await renderConfigForTarget(
          {
            ...reply,
            buttons: (_content, options): Promise<void> => {
              assert.ok(options.buttons !== undefined, 'expected options.buttons to be defined')
              callbackData.push(...options.buttons.map((button) => button.callbackData))
              return Promise.resolve()
            },
          },
          contextId,
          true,
        )
      } finally {
        unregisterContributedTaskProviderType('very-long-plugin-provider-name')
      }

      expect(callbackData.some((data) => data.length > 0)).toBe(true)
      expect(callbackData.every((data) => Buffer.byteLength(data, 'utf8') <= 64)).toBe(true)
      expect(callbackData.some((data) => data.startsWith('tgl:'))).toBe(false)
      expect(callbackData.some((data) => data.startsWith('plg:'))).toBe(false)
    })

    test('shows a fallback notice when plugin controls exceed callback limits', async () => {
      const contextId = 'managed-group-context-with-a-very-long-stable-storage-id'
      registerActivePlugin(makePlugin('config-long-callback-plugin', { name: 'Long Callback Plugin' }))
      const { reply, buttonCalls } = createMockReply()

      await renderConfigForTarget(reply, contextId, true)

      assert.ok(buttonCalls[0] !== undefined, 'expected button output')
      expect(buttonCalls[0]).toContain('Long Callback Plugin')
      expect(buttonCalls[0]).toContain('controls unavailable')
    })

    test('shows missing required plugin config under an unavailable plugin', async () => {
      const pluginId = 'config-render-missing-plugin'
      registerActivePlugin(
        makePlugin(pluginId, {
          name: 'Missing Config Plugin',
          configRequirements: [
            { key: 'api_token', label: 'API Token', required: true, sensitive: true, scope: 'context' },
          ],
        }),
      )

      const { reply, buttonCalls } = createMockReply()
      await renderConfigForTarget(reply, USER_ID, true)

      assert.ok(buttonCalls[0] !== undefined, 'expected buttonCalls[0] to be defined')
      expect(buttonCalls[0]).toContain('Missing Config Plugin')
      expect(buttonCalls[0]).toContain('unavailable')
      expect(buttonCalls[0]).toContain('API Token')
      expect(buttonCalls[0]).toContain('required')
      expect(buttonCalls[0]).toContain('*(not set)*')
    })

    test('plugin rows show missing capability status for selected context', async () => {
      const plugin = makePlugin('config-capability-plugin', {
        defaultEnabled: true,
        requiredTaskCapabilities: ['workItems.list'],
      })
      pluginRegistry.registerDiscovered(plugin)
      pluginRegistry.approve(plugin.manifest.id, 'admin', plugin.manifestHash)
      pluginRegistry.markActive(plugin.manifest.id)
      insertTaskInstance({
        id: `${USER_ID}-missing-capability`,
        type: 'kaneo',
        config: { baseUrl: 'https://kaneo.invalid' },
        status: 'active',
      })
      setContextSettings({
        contextId: USER_ID,
        taskInstanceId: `${USER_ID}-missing-capability`,
        platformInstanceId: 'telegram-default',
      })

      const { reply, buttonCalls } = createMockReply()
      await renderConfigForTarget(reply, USER_ID, true)

      assert.ok(buttonCalls[0] !== undefined, 'expected buttonCalls[0] to be defined')
      expect(buttonCalls[0]).toContain('unavailable (missing capability: workItems.list)')
    })

    test('masks sensitive plugin config values in config output', async () => {
      const pluginId = 'config-render-sensitive-plugin'
      registerActivePlugin(
        makePlugin(pluginId, {
          name: 'Sensitive Config Plugin',
          configRequirements: [
            { key: 'api_token', label: 'API Token', required: true, sensitive: true, scope: 'context' },
          ],
        }),
      )
      setPluginConfig(USER_ID, pluginId, 'api_token', 'secret-token-1234')

      const { reply, buttonCalls } = createMockReply()
      await renderConfigForTarget(reply, USER_ID, true)

      assert.ok(buttonCalls[0] !== undefined, 'expected buttonCalls[0] to be defined')
      expect(buttonCalls[0]).toContain('API Token')
      expect(buttonCalls[0]).toContain('****1234')
      expect(buttonCalls[0]).not.toContain('secret-token-1234')
    })

    test('starts with a personal/group selector in DM', async () => {
      expect(configHandler).not.toBeNull()
      const { reply, buttonCalls } = createMockReply()

      await configHandler!(createDmMessage(USER_ID), reply, createAuth(USER_ID))

      expect(buttonCalls[0]).toContain('What do you want to configure?')
    })

    test('rejects unauthorized user silently', async () => {
      expect(configHandler).not.toBeNull()
      const { reply, buttonCalls } = createMockReply()
      await configHandler!(
        createDmMessage('unauthorized-user'),
        reply,
        createAuth('unauthorized-user', { allowed: false }),
      )
      expect(buttonCalls).toHaveLength(0)
    })

    test('Tools summary line shows blocked and ask counts', async () => {
      setToolPrefs('ctx-cfg-summary', {
        domainDefaults: {},
        toolOverrides: { delete_task: 'deny', remove_attachment: 'ask' },
      })
      const { reply, buttonCalls } = createMockReply()
      await renderConfigForTarget(reply, 'ctx-cfg-summary', true)
      assert.ok(buttonCalls[0] !== undefined, 'expected buttonCalls[0] to be defined')
      expect(buttonCalls[0]).toContain('1 blocked')
      expect(buttonCalls[0]).toContain('1 ask')
    })

    test('uses source instance button capabilities instead of router aggregate capabilities', async () => {
      const sourceProvider = createMockChatWithCommandHandlers({ capabilities: new Set<ChatCapability>() }).provider
      const routerChat = createRouterLikeChat(sourceProvider)
      const commandHandlers = new Map<string, CommandHandler>()
      const chat = {
        ...routerChat,
        registerCommand: (name: string, handler: CommandHandler): void => {
          commandHandlers.set(name, handler)
        },
      } as ChatProvider
      registerConfigCommand(chat, (_userId: string) => true)
      const handler = commandHandlers.get('config')
      assert.ok(handler !== undefined, 'expected config handler to be registered')
      const msg = { ...createDmMessage(USER_ID), platformInstanceId: 'mattermost-no-buttons' }
      const { reply, textCalls, buttonCalls } = createMockReply()

      await handler(msg, reply, createAuth(USER_ID))

      expect(buttonCalls).toHaveLength(0)
      expect(textCalls.some((text) => text.includes('What do you want to configure?'))).toBe(true)
    })
  })

  describe('without interactive button support', () => {
    beforeEach(async () => {
      mockLogger()
      await setupTestDb()
      seedCommonTestPlatformInstances()
      clearUserCache(USER_ID)

      const capabilities = new Set<ChatCapability>([
        'commands.menu',
        'messages.files',
        'messages.redact',
        'files.receive',
        'messages.reply-context',
        'users.resolve',
        // messages.buttons and interactions.callbacks intentionally omitted
      ])
      const { provider: mockChat, commandHandlers } = createMockChatWithCommandHandlers({
        capabilities,
      })
      registerConfigCommand(mockChat, (_userId: string) => true)
      const handler = commandHandlers.get('config')
      configHandler = null
      if (handler !== undefined) configHandler = handler
    })

    test('falls back to plain text with config output', async () => {
      assignKaneoContext(USER_ID)
      setConfig(USER_ID, 'kaneo_apikey', 'sk-abc1234')
      const { reply, textCalls, buttonCalls } = createMockReply()
      await renderConfigForTarget(reply, USER_ID, false)
      expect(buttonCalls).toHaveLength(0)
      expect(textCalls).toHaveLength(1)
      assert.ok(textCalls[0] !== undefined, 'expected textCalls[0] to be defined')
      const output = textCalls[0]
      expect(output).toContain('****1234')
    })

    test('includes note that interactive editing is unavailable', async () => {
      const { reply, textCalls } = createMockReply()
      await renderConfigForTarget(reply, USER_ID, false)
      assert.ok(textCalls[0] !== undefined, 'expected textCalls[0] to be defined')
      const output = textCalls[0]
      expect(output).toContain('not available')
    })
  })
})
