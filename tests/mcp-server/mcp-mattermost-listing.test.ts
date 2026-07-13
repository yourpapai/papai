// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { listPluginMcpTools } from '../../src/mcp-server/plugin-bridge.js'
import { discoverPlugins } from '../../src/plugins/discovery.js'
import { activatePlugins, deactivateAllPlugins } from '../../src/plugins/loader.js'
import { pluginRegistry, resetPluginRegistryForTesting } from '../../src/plugins/registry.js'
import type { DiscoveredPlugin } from '../../src/plugins/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const MATTERMOST_TOOL_NAMES = [
  'mattermost_get_post',
  'mattermost_get_thread',
  'mattermost_get_channel_posts',
  'mattermost_create_post',
  'mattermost_download_attachment',
]

function discoverMcpMattermost(): DiscoveredPlugin {
  const result = discoverPlugins(join(process.cwd(), 'plugins'))
  expect(result.errors).toEqual([])
  const plugin = result.plugins.find((candidate) => candidate.manifest.id === 'mcp-mattermost')
  if (plugin === undefined) throw new Error('expected mcp-mattermost to be discovered under plugins/')
  return plugin
}

// Proves mcp-mattermost's tools are reachable through the real end-to-end path an MCP client
// would use: filesystem discovery -> registry approval/compatibility -> plugin activation
// -> the mcp-server bridge's listPluginMcpTools(), which is what backs papai's
// /mcp/plugin/:pluginId listing endpoint.
describe('mcp-mattermost reachable through the mcp-server plugin bridge', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    resetPluginRegistryForTesting()
    await deactivateAllPlugins()
  })

  afterEach(async () => {
    await deactivateAllPlugins()
    resetPluginRegistryForTesting()
  })

  test('activation exposes all 5 mattermost tools with object input schemas via listPluginMcpTools', async () => {
    const plugin = discoverMcpMattermost()
    expect(plugin.manifest.mcpServer).toBe(true)
    expect(plugin.manifest.mcpResponseRedaction).toBe(true)

    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'admin-user', plugin.manifestHash)
    pluginRegistry.evaluateCompatibilityAcrossInstances([])
    await activatePlugins(pluginRegistry.getApprovedCompatiblePlugins())

    expect(pluginRegistry.getEntry('mcp-mattermost')?.state).toBe('active')

    const tools = await listPluginMcpTools('mcp-mattermost')

    expect(tools.map((tool) => tool.name).sort()).toEqual([...MATTERMOST_TOOL_NAMES].sort())
    for (const tool of tools) {
      expect(tool.inputSchema).toMatchObject({ type: 'object' })
      expect(tool.description.length).toBeGreaterThan(0)
    }
  })

  test('returns [] once the plugin is deactivated', async () => {
    const plugin = discoverMcpMattermost()

    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'admin-user', plugin.manifestHash)
    pluginRegistry.evaluateCompatibilityAcrossInstances([])
    await activatePlugins(pluginRegistry.getApprovedCompatiblePlugins())
    expect(await listPluginMcpTools('mcp-mattermost')).toHaveLength(5)

    await deactivateAllPlugins()

    expect(await listPluginMcpTools('mcp-mattermost')).toEqual([])
  })
})
