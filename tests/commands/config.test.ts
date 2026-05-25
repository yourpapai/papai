// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { ChatCapability, CommandHandler } from '../../src/chat/types.js'
import { registerConfigCommand, renderConfigForTarget } from '../../src/commands/config.js'
import { setConfig, setPluginConfig } from '../../src/config.js'
import { pluginRegistry } from '../../src/plugins/registry.js'
import type { DiscoveredPlugin } from '../../src/plugins/types.js'
import { PLUGIN_API_VERSION } from '../../src/plugins/types.js'
import { clearUserCache } from '../utils/test-cache.js'
import {
  createAuth,
  createDmMessage,
  createMockChatWithCommandHandlers,
  createMockReply,
  mockLogger,
  setupTestDb,
} from '../utils/test-helpers.js'

const USER_ID = 'config-test-user'

function makePlugin(pluginId: string, overrides: Partial<DiscoveredPlugin['manifest']> = {}): DiscoveredPlugin {
  return {
    manifest: {
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
      providerConfigSchema: [],
      providerAllowedHosts: [],
      ...overrides,
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
      clearUserCache(USER_ID)

      const { provider: mockChat, commandHandlers } = createMockChatWithCommandHandlers()
      registerConfigCommand(mockChat, (_userId: string) => true)
      configHandler = commandHandlers.get('config') ?? null
    })

    test('shows all config keys with values and masked secrets', async () => {
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
      const { reply, buttonCalls } = createMockReply()
      await renderConfigForTarget(reply, USER_ID, true)
      assert(buttonCalls[0] !== undefined, 'expected buttonCalls[0] to be defined')
      const output = buttonCalls[0]
      expect(output.length).toBeGreaterThan(0)
      const lines = output.split('\n').filter((line) => line.trim().length > 0)
      expect(lines.length).toBeGreaterThan(0)
      expect(lines).toContain('🔐 Kaneo API Key: *(not set)*')
      expect(lines).toContain('🌍 Timezone: *(not set)*')
    })

    test('shows missing required plugin config under an unavailable plugin', async () => {
      const pluginId = 'config-render-missing-plugin'
      registerActivePlugin(
        makePlugin(pluginId, {
          name: 'Missing Config Plugin',
          configRequirements: [{ key: 'api_token', label: 'API Token', required: true, sensitive: true }],
        }),
      )

      const { reply, buttonCalls } = createMockReply()
      await renderConfigForTarget(reply, USER_ID, true)

      assert(buttonCalls[0] !== undefined, 'expected buttonCalls[0] to be defined')
      expect(buttonCalls[0]).toContain('Missing Config Plugin')
      expect(buttonCalls[0]).toContain('unavailable')
      expect(buttonCalls[0]).toContain('API Token')
      expect(buttonCalls[0]).toContain('required')
      expect(buttonCalls[0]).toContain('*(not set)*')
    })

    test('masks sensitive plugin config values in config output', async () => {
      const pluginId = 'config-render-sensitive-plugin'
      registerActivePlugin(
        makePlugin(pluginId, {
          name: 'Sensitive Config Plugin',
          configRequirements: [{ key: 'api_token', label: 'API Token', required: true, sensitive: true }],
        }),
      )
      setPluginConfig(USER_ID, pluginId, 'api_token', 'secret-token-1234')

      const { reply, buttonCalls } = createMockReply()
      await renderConfigForTarget(reply, USER_ID, true)

      assert(buttonCalls[0] !== undefined, 'expected buttonCalls[0] to be defined')
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
  })

  describe('without interactive button support', () => {
    beforeEach(async () => {
      mockLogger()
      await setupTestDb()
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
      configHandler = commandHandlers.get('config') ?? null
    })

    test('falls back to plain text with config output', async () => {
      setConfig(USER_ID, 'kaneo_apikey', 'sk-abc1234')
      const { reply, textCalls, buttonCalls } = createMockReply()
      await renderConfigForTarget(reply, USER_ID, false)
      expect(buttonCalls).toHaveLength(0)
      expect(textCalls).toHaveLength(1)
      assert(textCalls[0] !== undefined, 'expected textCalls[0] to be defined')
      const output = textCalls[0]
      expect(output).toContain('****1234')
    })

    test('includes note that interactive editing is unavailable', async () => {
      const { reply, textCalls } = createMockReply()
      await renderConfigForTarget(reply, USER_ID, false)
      assert(textCalls[0] !== undefined, 'expected textCalls[0] to be defined')
      const output = textCalls[0]
      expect(output).toContain('not available')
    })
  })
})
