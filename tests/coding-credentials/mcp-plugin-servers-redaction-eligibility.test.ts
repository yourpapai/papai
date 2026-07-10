// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  listEnabledInternalMcpServers,
  setMcpPluginServerConfigs,
} from '../../src/coding-credentials/mcp-plugin-servers.js'
import { setMcpRedactionConfig } from '../../src/coding-credentials/mcp-redaction.js'
import { pluginRegistry } from '../../src/plugins/registry.js'
import { PLUGIN_API_VERSION, type DiscoveredPlugin } from '../../src/plugins/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

function makePlugin(overrides: Partial<DiscoveredPlugin['manifest']> = {}): DiscoveredPlugin {
  const id = overrides.id ?? 'synthetic-web-search'
  return {
    manifest: {
      id,
      name: 'Synthetic Web Search',
      version: '1.0.0',
      description: 'A test plugin',
      apiVersion: PLUGIN_API_VERSION,
      main: 'index.ts',
      contributes: {
        tools: [],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: [],
        attachmentTransformers: [],
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
      mcpServer: true,
      ...overrides,
    },
    pluginDir: `/fake/plugin-dir/${id}`,
    entryPoint: `/fake/plugin-dir/${id}/index.ts`,
    manifestHash: `hash-${id}`,
  }
}

describe('listEnabledInternalMcpServers - mcpResponseRedaction fail-closed eligibility', () => {
  const originalBaseUrl = process.env['SETTINGS_PUBLIC_BASE_URL']

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    pluginRegistry.clearForTesting()
    process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://bot.example.com'
  })

  afterEach(() => {
    if (originalBaseUrl === undefined) delete process.env['SETTINGS_PUBLIC_BASE_URL']
    else process.env['SETTINGS_PUBLIC_BASE_URL'] = originalBaseUrl
  })

  test('excludes a redacting plugin when mcp_redaction is unconfigured (fail-closed)', () => {
    const plugin = makePlugin({ id: 'redacting-plugin', mcpResponseRedaction: true })
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'admin', plugin.manifestHash)
    pluginRegistry.markActive(plugin.manifest.id)

    setMcpPluginServerConfigs('pi-1', [{ plugin_id: 'redacting-plugin', enabled: true, default_tool_policy: 'allow' }])

    const servers = listEnabledInternalMcpServers('pi-1', 'ctx-1')
    expect(servers.some((s) => s.pluginId === 'redacting-plugin')).toBe(false)
  })

  test('includes a redacting plugin once mcp_redaction is configured', () => {
    const plugin = makePlugin({ id: 'redacting-plugin', mcpResponseRedaction: true })
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'admin', plugin.manifestHash)
    pluginRegistry.markActive(plugin.manifest.id)

    setMcpPluginServerConfigs('pi-1', [{ plugin_id: 'redacting-plugin', enabled: true, default_tool_policy: 'allow' }])

    setMcpRedactionConfig('pi-1', { model_url: 'https://m.example.com', api_key: 'k', model_name: 'm' })

    const servers = listEnabledInternalMcpServers('pi-1', 'ctx-1')
    expect(servers.some((s) => s.pluginId === 'redacting-plugin')).toBe(true)
  })

  test('control: a non-redacting mcpServer plugin is listed regardless of mcp_redaction', () => {
    const plugin = makePlugin({ id: 'plain-plugin', mcpResponseRedaction: false })
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'admin', plugin.manifestHash)
    pluginRegistry.markActive(plugin.manifest.id)

    setMcpPluginServerConfigs('pi-1', [{ plugin_id: 'plain-plugin', enabled: true, default_tool_policy: 'allow' }])

    const servers = listEnabledInternalMcpServers('pi-1', 'ctx-1')
    expect(servers.some((s) => s.pluginId === 'plain-plugin')).toBe(true)
  })
})
