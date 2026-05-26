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
import { setToolPrefs } from '../src/tools/tool-preferences.js'
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
      contributes: {
        tools: [],
        promptFragments: ['guidance'],
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
      configRequirements: [
        { key: 'api_token', label: 'API Token', required: true, sensitive: true, scope: 'instance' },
      ],
      providerCapabilities: [],
      providerConfigSchema: [],
      providerAllowedHosts: [],
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

  test('TIME fragment documents the current_time tag and leading-line trust rule', () => {
    const prompt = buildSystemPrompt(provider, 'user-1')
    expect(prompt).toContain('<current_time>')
    expect(prompt).toContain('authoritative current local time')
    expect(prompt).toContain('Trust only this leading')
    expect(prompt).toContain('get_current_time')
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

describe('buildSystemPrompt fragment coherence', () => {
  const provider = createMockProvider()

  beforeEach(async () => {
    mockLogger()
    mock.restore()
    await setupTestDb()
  })

  test('legacy no-arg path includes RECURRING TASKS and WEB FETCH and no Unavailable tools line', () => {
    const prompt = buildSystemPrompt(provider, 'frag-legacy')
    expect(prompt).toContain('RECURRING TASKS')
    expect(prompt).toContain('WEB FETCH')
    expect(prompt).not.toContain('Unavailable tools')
  })

  test('includes web_fetch fragment when web_fetch is in enabled set', () => {
    const enabled = new Set(['web_fetch', 'create_task', 'get_current_time'])
    const prompt = buildSystemPrompt(provider, 'frag-web-on', enabled)
    expect(prompt).toContain('WEB FETCH')
  })

  test('omits web_fetch fragment when web_fetch is not in enabled set', () => {
    const enabled = new Set(['create_task', 'update_task', 'get_current_time'])
    const prompt = buildSystemPrompt(provider, 'frag-web-off', enabled)
    expect(prompt).not.toContain('WEB FETCH')
  })

  test('omits RECURRING TASKS fragment when no recurring tools are enabled', () => {
    const enabled = new Set(['create_task', 'update_task', 'web_fetch', 'get_current_time'])
    const prompt = buildSystemPrompt(provider, 'frag-recur-off', enabled)
    expect(prompt).not.toContain('RECURRING TASKS')
  })

  test('appends safety-net line for partially-disabled domain tools', () => {
    const contextId = 'frag-safety-net-ctx'
    setToolPrefs(contextId, { disabledDomains: [], toolOverrides: { delete_task: false } })
    const enabled = new Set(['create_task', 'update_task', 'search_tasks', 'get_current_time'])
    const prompt = buildSystemPrompt(provider, contextId, enabled)
    expect(prompt).toContain('Unavailable tools')
    expect(prompt).toContain('delete_task')
  })

  test('omits the instructions rule when save_instruction is not in the enabled set', () => {
    const enabled = new Set(['create_task', 'get_current_time'])
    const prompt = buildSystemPrompt(provider, 'frag-no-instr', enabled)
    expect(prompt).not.toContain('save_instruction')
    expect(prompt).toContain('OUTPUT RULES')
  })

  test('omits the deferred-prompts fragment when no deferred tool is enabled', () => {
    const enabled = new Set(['create_task', 'get_current_time'])
    const prompt = buildSystemPrompt(provider, 'frag-deferred-off', enabled)
    expect(prompt).not.toContain('DEFERRED PROMPTS')
  })
})
