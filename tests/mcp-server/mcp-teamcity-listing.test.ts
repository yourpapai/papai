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

const TEAMCITY_TOOL_NAMES = [
  'teamcity_get_projects',
  'teamcity_get_project_config',
  'teamcity_get_project_pipelines',
  'teamcity_get_pipeline_config',
]

function discoverMcpTeamcity(): DiscoveredPlugin {
  const result = discoverPlugins(join(process.cwd(), 'plugins'))
  expect(result.errors).toEqual([])
  const plugin = result.plugins.find((candidate) => candidate.manifest.id === 'mcp-teamcity')
  if (plugin === undefined) throw new Error('expected mcp-teamcity to be discovered under plugins/')
  return plugin
}

// Proves mcp-teamcity's tools are reachable through the real end-to-end path an MCP client
// would use: filesystem discovery -> registry approval/compatibility -> plugin activation
// -> the mcp-server bridge's listPluginMcpTools(), which is what backs papai's
// /mcp/plugin/:pluginId listing endpoint.
describe('mcp-teamcity reachable through the mcp-server plugin bridge', () => {
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

  test('activation exposes all 4 teamcity tools with object input schemas via listPluginMcpTools', async () => {
    const plugin = discoverMcpTeamcity()
    expect(plugin.manifest.mcpServer).toBe(true)

    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'admin-user', plugin.manifestHash)
    pluginRegistry.evaluateCompatibilityAcrossInstances([])
    await activatePlugins(pluginRegistry.getApprovedCompatiblePlugins())

    expect(pluginRegistry.getEntry('mcp-teamcity')?.state).toBe('active')

    const tools = await listPluginMcpTools('mcp-teamcity')

    expect(tools.map((tool) => tool.name).sort()).toEqual([...TEAMCITY_TOOL_NAMES].sort())
    for (const tool of tools) {
      expect(tool.inputSchema).toMatchObject({ type: 'object' })
      expect(tool.description.length).toBeGreaterThan(0)
    }
  })

  test('returns [] once the plugin is deactivated', async () => {
    const plugin = discoverMcpTeamcity()

    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'admin-user', plugin.manifestHash)
    pluginRegistry.evaluateCompatibilityAcrossInstances([])
    await activatePlugins(pluginRegistry.getApprovedCompatiblePlugins())
    expect(await listPluginMcpTools('mcp-teamcity')).toHaveLength(4)

    await deactivateAllPlugins()

    expect(await listPluginMcpTools('mcp-teamcity')).toEqual([])
  })
})
