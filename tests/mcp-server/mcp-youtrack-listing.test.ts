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

const YOUTRACK_TOOL_NAMES = [
  'youtrack_get_issue',
  'youtrack_get_state_activities',
  'youtrack_get_comments',
  'youtrack_get_issue_tags',
  'youtrack_get_field_options',
  'youtrack_get_attachments',
  'youtrack_read_attachment',
  'youtrack_add_comment',
  'youtrack_create_issue',
  'youtrack_update_fields',
  'youtrack_add_issue_tag',
  'youtrack_remove_issue_tag',
  'youtrack_set_tags',
  'youtrack_set_issue_link',
]

function discoverMcpYouTrack(): DiscoveredPlugin {
  const result = discoverPlugins(join(process.cwd(), 'plugins'))
  expect(result.errors).toEqual([])
  const plugin = result.plugins.find((candidate) => candidate.manifest.id === 'mcp-youtrack')
  if (plugin === undefined) throw new Error('expected mcp-youtrack to be discovered under plugins/')
  return plugin
}

// Proves mcp-youtrack's tools are reachable through the real end-to-end path an MCP client
// would use: filesystem discovery -> registry approval/compatibility -> plugin activation
// -> the mcp-server bridge's listPluginMcpTools(), which is what backs papai's
// /mcp/plugin/:pluginId listing endpoint.
describe('mcp-youtrack reachable through the mcp-server plugin bridge', () => {
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

  test('activation exposes all 14 youtrack tools with object input schemas via listPluginMcpTools', async () => {
    const plugin = discoverMcpYouTrack()
    expect(plugin.manifest.mcpServer).toBe(true)
    expect(plugin.manifest.mcpResponseRedaction).toBe(true)

    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'admin-user', plugin.manifestHash)
    pluginRegistry.evaluateCompatibilityAcrossInstances([])
    await activatePlugins(pluginRegistry.getApprovedCompatiblePlugins())

    expect(pluginRegistry.getEntry('mcp-youtrack')?.state).toBe('active')

    const tools = await listPluginMcpTools('mcp-youtrack')

    expect(tools.map((tool) => tool.name).sort()).toEqual([...YOUTRACK_TOOL_NAMES].sort())
    for (const tool of tools) {
      expect(tool.inputSchema).toMatchObject({ type: 'object' })
      expect(tool.description.length).toBeGreaterThan(0)
    }
  })

  test('returns [] once the plugin is deactivated', async () => {
    const plugin = discoverMcpYouTrack()

    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'admin-user', plugin.manifestHash)
    pluginRegistry.evaluateCompatibilityAcrossInstances([])
    await activatePlugins(pluginRegistry.getApprovedCompatiblePlugins())
    expect(await listPluginMcpTools('mcp-youtrack')).toHaveLength(14)

    await deactivateAllPlugins()

    expect(await listPluginMcpTools('mcp-youtrack')).toEqual([])
  })
})
