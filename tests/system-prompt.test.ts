// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test, mock } from 'bun:test'

import { setPluginConfig } from '../src/config.js'
import { contributionRegistry } from '../src/plugins/contributions.js'
import { pluginRegistry } from '../src/plugins/registry.js'
import type { DiscoveredPlugin } from '../src/plugins/types.js'
import { PLUGIN_API_VERSION } from '../src/plugins/types.js'
import { buildSystemPrompt } from '../src/system-prompt.js'
import { createMockProvider } from './tools/mock-provider.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

function makePromptPlugin(pluginId: string): DiscoveredPlugin {
  return {
    manifest: {
      id: pluginId,
      name: 'Prompt Plugin',
      version: '1.0.0',
      description: 'Plugin prompt gating test',
      apiVersion: PLUGIN_API_VERSION,
      main: 'index.ts',
      contributes: { tools: [], promptFragments: ['guidance'], commands: [], jobs: [], configKeys: [] },
      permissions: [],
      defaultEnabled: true,
      activationTimeoutMs: 5000,
      requiredTaskCapabilities: [],
      requiredChatCapabilities: [],
      configRequirements: [{ key: 'api_token', label: 'API Token', required: true, sensitive: true }],
    },
    pluginDir: `/tmp/${pluginId}`,
    entryPoint: `/tmp/${pluginId}/index.ts`,
    manifestHash: `hash-${pluginId}`,
  }
}

function registerPromptPlugin(plugin: DiscoveredPlugin, content: string): void {
  pluginRegistry.registerDiscovered(plugin)
  pluginRegistry.approve(plugin.manifest.id, 'admin', plugin.manifestHash)
  pluginRegistry.markActive(plugin.manifest.id)
  contributionRegistry.register(
    plugin.manifest.id,
    { tools: [], promptFragments: [{ name: 'guidance', content }] },
    plugin.manifest,
  )
}

describe('buildSystemPrompt', () => {
  const provider = createMockProvider()

  beforeEach(async () => {
    mockLogger()
    mock.restore()
    await setupTestDb()
  })

  test('does not include current date and time in prompt (to preserve KV cache)', () => {
    const prompt = buildSystemPrompt(provider, 'user-1')
    expect(prompt).not.toContain('Current date and time:')
  })

  test('is static between calls (no dynamic content)', () => {
    const prompt1 = buildSystemPrompt(provider, 'user-1')
    // Small delay to ensure any dynamic content would differ
    const start = Date.now()
    while (Date.now() - start < 10) {
      // Busy wait for 10ms
    }
    const prompt2 = buildSystemPrompt(provider, 'user-1')
    expect(prompt1).toBe(prompt2)
  })

  test('includes web_fetch guidance for public URLs', () => {
    const prompt = buildSystemPrompt(provider, 'user-1')

    expect(prompt).toContain('web_fetch')
    expect(prompt).toContain('public URL')
    expect(prompt).toContain('memo')
    expect(prompt).toContain('task')
  })

  test('does not include plugin prompt fragments when required plugin config is missing', () => {
    const pluginId = 'prompt-missing-config-plugin'
    registerPromptPlugin(makePromptPlugin(pluginId), 'MISSING_CONFIG_PLUGIN_GUIDANCE')

    const prompt = buildSystemPrompt(provider, 'ctx-prompt-missing-config')

    expect(prompt).not.toContain('MISSING_CONFIG_PLUGIN_GUIDANCE')
    contributionRegistry.deregister(pluginId)
  })

  test('includes plugin prompt fragments when required plugin config is set', () => {
    const pluginId = 'prompt-configured-plugin'
    const contextId = 'ctx-prompt-configured'
    registerPromptPlugin(makePromptPlugin(pluginId), 'CONFIGURED_PLUGIN_GUIDANCE')
    setPluginConfig(contextId, pluginId, 'api_token', 'secret-token')

    const prompt = buildSystemPrompt(provider, contextId)

    expect(prompt).toContain('CONFIGURED_PLUGIN_GUIDANCE')
    contributionRegistry.deregister(pluginId)
  })
})
