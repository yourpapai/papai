// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { handlePluginInteraction } from '../../src/chat/plugin-interaction-handler.js'
import type { IncomingInteraction } from '../../src/chat/types.js'
import { setPluginConfig } from '../../src/config.js'
import { pluginRegistry } from '../../src/plugins/registry.js'
import { isPluginEnabledForContext } from '../../src/plugins/store.js'
import type { DiscoveredPlugin } from '../../src/plugins/types.js'
import { PLUGIN_API_VERSION } from '../../src/plugins/types.js'
import { createMockReply, mockLogger, setupTestDb } from '../utils/test-helpers.js'

function encodeContextId(contextId: string): string {
  return Buffer.from(contextId).toString('base64url')
}

function makePlugin(pluginId: string): DiscoveredPlugin {
  return {
    manifest: {
      id: pluginId,
      name: 'Interaction Plugin',
      version: '1.0.0',
      description: 'Plugin interaction test',
      apiVersion: PLUGIN_API_VERSION,
      main: 'index.ts',
      contributes: { tools: [], promptFragments: [], commands: [], jobs: [], configKeys: [], taskProviderTypes: [] },
      permissions: [],
      defaultEnabled: false,
      activationTimeoutMs: 5000,
      requiredTaskCapabilities: [],
      requiredChatCapabilities: [],
      configRequirements: [{ key: 'api_token', label: 'API Token', required: true, sensitive: true }],
      providerCapabilities: [],
      providerConfigSchema: [],
      providerAllowedHosts: [],
    },
    pluginDir: `/tmp/${pluginId}`,
    entryPoint: `/tmp/${pluginId}/index.ts`,
    manifestHash: `hash-${pluginId}`,
  }
}

function makeInteraction(callbackData: string, storageContextId: string): IncomingInteraction {
  return {
    kind: 'button',
    user: { id: storageContextId, username: 'alice', isAdmin: false },
    contextId: storageContextId,
    contextType: 'dm',
    storageContextId,
    callbackData,
  }
}

describe('handlePluginInteraction', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('does not enable a plugin when required config is missing for the target context', async () => {
    const pluginId = 'interaction-missing-config-plugin'
    const contextId = 'interaction-user-1'
    const plugin = makePlugin(pluginId)
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(pluginId, 'admin', plugin.manifestHash)
    pluginRegistry.markActive(pluginId)

    const { reply, textCalls } = createMockReply()
    const handled = await handlePluginInteraction(
      makeInteraction(`plg:enable:${pluginId}:${encodeContextId(contextId)}`, contextId),
      reply,
    )

    expect(handled).toBe(true)
    expect(isPluginEnabledForContext(pluginId, contextId)).toBe(false)
    expect(textCalls[0]).toContain('requires configuration')
    expect(textCalls[0]).toContain('API Token')
  })

  test('enables a plugin when required config is present for the target context', async () => {
    const pluginId = 'interaction-configured-plugin'
    const contextId = 'interaction-user-2'
    const plugin = makePlugin(pluginId)
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(pluginId, 'admin', plugin.manifestHash)
    pluginRegistry.markActive(pluginId)
    setPluginConfig(contextId, pluginId, 'api_token', 'secret-token')

    const { reply, textCalls } = createMockReply()
    const handled = await handlePluginInteraction(
      makeInteraction(`plg:enable:${pluginId}:${encodeContextId(contextId)}`, contextId),
      reply,
    )

    expect(handled).toBe(true)
    expect(isPluginEnabledForContext(pluginId, contextId)).toBe(true)
    expect(textCalls[0]).toContain('enabled')
  })

  test('rejects plugin actions for group targets the user cannot manage', async () => {
    const pluginId = 'interaction-group-target-plugin'
    const plugin = makePlugin(pluginId)
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(pluginId, 'admin', plugin.manifestHash)
    pluginRegistry.markActive(pluginId)

    const { reply, textCalls } = createMockReply()
    const handled = await handlePluginInteraction(
      makeInteraction(`plg:enable:${pluginId}:${encodeContextId('group-unknown')}`, 'interaction-user-3'),
      reply,
    )

    expect(handled).toBe(true)
    expect(isPluginEnabledForContext(pluginId, 'group-unknown')).toBe(false)
    expect(textCalls[0]).toContain('no longer recognized as an admin')
  })
})
