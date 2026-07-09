// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  listEnabledInternalMcpServers,
  mcpPluginServerConfigsSchema,
  setMcpPluginServerConfigs,
} from '../../src/coding-credentials/mcp-plugin-servers.js'
import { pluginRegistry } from '../../src/plugins/registry.js'
import { PLUGIN_API_VERSION, type DiscoveredPlugin } from '../../src/plugins/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

function makePlugin(overrides: Partial<DiscoveredPlugin['manifest']> = {}): DiscoveredPlugin {
  return {
    manifest: {
      id: 'synthetic-web-search',
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
    pluginDir: '/fake/plugin-dir/synthetic-web-search',
    entryPoint: '/fake/plugin-dir/synthetic-web-search/index.ts',
    manifestHash: 'hash-synthetic-web-search',
  }
}

describe('mcpPluginServerConfigsSchema', () => {
  test('accepts a valid config array', () => {
    const parsed = mcpPluginServerConfigsSchema.safeParse([
      { plugin_id: 'synthetic-web-search', enabled: true, default_tool_policy: 'allow' },
    ])
    expect(parsed.success).toBe(true)
  })

  test('requires default_tool_policy', () => {
    const parsed = mcpPluginServerConfigsSchema.safeParse([{ plugin_id: 'x', enabled: true }])
    expect(parsed.success).toBe(false)
  })

  test('rejects an unknown tool policy value', () => {
    const parsed = mcpPluginServerConfigsSchema.safeParse([
      { plugin_id: 'x', enabled: true, default_tool_policy: 'maybe' },
    ])
    expect(parsed.success).toBe(false)
  })
})

describe('listEnabledInternalMcpServers', () => {
  const originalBaseUrl = process.env['SETTINGS_PUBLIC_BASE_URL']

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    pluginRegistry.clearForTesting()
  })

  afterEach(() => {
    if (originalBaseUrl === undefined) delete process.env['SETTINGS_PUBLIC_BASE_URL']
    else process.env['SETTINGS_PUBLIC_BASE_URL'] = originalBaseUrl
  })

  test('derives an effective entry for an operator-enabled, active+eligible mcpServer plugin', () => {
    process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://bot.example.com/'

    const plugin = makePlugin()
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'admin', plugin.manifestHash)
    pluginRegistry.markActive(plugin.manifest.id)

    setMcpPluginServerConfigs('pi-1', [
      { plugin_id: 'synthetic-web-search', enabled: true, default_tool_policy: 'allow' },
    ])

    const servers = listEnabledInternalMcpServers('pi-1', 'ctx-1')
    expect(servers).toEqual([
      {
        name: 'plugin:synthetic-web-search',
        pluginId: 'synthetic-web-search',
        label: 'Synthetic Web Search',
        upstreamUrl: 'https://bot.example.com/mcp/plugin/synthetic-web-search',
        header: 'Authorization',
        toolPolicy: { default: 'allow', tools: undefined },
      },
    ])
  })

  test('returns empty when SETTINGS_PUBLIC_BASE_URL is unset (fail-closed)', () => {
    delete process.env['SETTINGS_PUBLIC_BASE_URL']

    const plugin = makePlugin()
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'admin', plugin.manifestHash)
    pluginRegistry.markActive(plugin.manifest.id)

    setMcpPluginServerConfigs('pi-2', [
      { plugin_id: 'synthetic-web-search', enabled: true, default_tool_policy: 'allow' },
    ])

    expect(listEnabledInternalMcpServers('pi-2', 'ctx-2')).toEqual([])
  })

  test('excludes a plugin the operator has not enabled', () => {
    process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://bot.example.com'

    const plugin = makePlugin()
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'admin', plugin.manifestHash)
    pluginRegistry.markActive(plugin.manifest.id)

    expect(listEnabledInternalMcpServers('pi-3', 'ctx-3')).toEqual([])
  })

  test('excludes a plugin that does not declare mcpServer', () => {
    process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://bot.example.com'

    const plugin = makePlugin({ mcpServer: false })
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'admin', plugin.manifestHash)
    pluginRegistry.markActive(plugin.manifest.id)

    setMcpPluginServerConfigs('pi-4', [
      { plugin_id: 'synthetic-web-search', enabled: true, default_tool_policy: 'allow' },
    ])

    expect(listEnabledInternalMcpServers('pi-4', 'ctx-4')).toEqual([])
  })
})
