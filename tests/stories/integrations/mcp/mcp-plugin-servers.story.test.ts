// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { getConfigContextIdFromStorageContextId, toScopedContextId } from '../../../../src/chat/scoped-context.js'
import { setMcpPluginServerConfigs } from '../../../../src/coding-credentials/mcp-plugin-servers.js'
import { mintPluginMcpToken } from '../../../../src/mcp-server/token.js'
import { discoverPlugins } from '../../../../src/plugins/discovery.js'
import { setPluginEnabledForContext } from '../../../../src/plugins/registry.js'
import { setPluginAdminConfig } from '../../../../src/plugins/store.js'
import type { DiscoveredPlugin } from '../../../../src/plugins/types.js'
import { scenario } from '../../harness/scenario.js'

const PLUGIN_ID = 'synthetic-web-search'

function discovered(pluginId: string): DiscoveredPlugin {
  const p = discoverPlugins('plugins').plugins.find(({ manifest }) => manifest.id === pluginId)
  if (p === undefined) throw new Error(`Expected discovered plugin ${pluginId}`)
  return p
}

function jsonRpc(
  world: { runtime: { request(r: Request): Promise<Response> } },
  pluginId: string,
  token: string,
  method: string,
  params: unknown,
): Promise<Response> {
  const req = new Request(new URL(`https://bot.invalid/mcp/plugin/${pluginId}`), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return world.runtime.request(req)
}

scenario(
  'SCN-settings-admin-mcp-plugin-servers: operator config governs the hosted plugin-MCP route',
  async ({ given, world }) => {
    const alice = given.user('alice')
    given.dm(alice)
    const storageContextId = toScopedContextId({
      platformInstanceId: alice.platformInstanceId,
      nativeContextId: alice.id,
    })
    const configContextId = getConfigContextIdFromStorageContextId(storageContextId)

    given.plugin(discovered(PLUGIN_ID))
    setPluginAdminConfig(PLUGIN_ID, 'api_key', 'scenario-key', 'scenario-admin')
    setPluginEnabledForContext(PLUGIN_ID, configContextId, true)
    given.publicBaseUrl('https://bot.invalid')

    // Operator-enable the internal MCP server for this platform instance.
    given.mcpPluginServer(alice.platformInstanceId, PLUGIN_ID)

    await world.start()

    const token = mintPluginMcpToken({ storageContextId, chatUserId: alice.id, pluginId: PLUGIN_ID })

    // Enabled -> the route serves tools/list (the real search descriptor). No upstream egress:
    // tools/list stays fully hermetic regardless of the plugin's own egress behavior.
    const enabled = await jsonRpc(world, PLUGIN_ID, token, 'tools/list', {})
    expect(enabled.status).toBe(200)
    expect(JSON.stringify(await enabled.json())).toContain('search')

    // The operator disables the internal server. Same token, same request -> the exposure gate
    // now fail-closes with 401. `setCachedConfig` writes take effect immediately (no restart), so
    // the flip is observable within this single scenario.
    setMcpPluginServerConfigs(alice.platformInstanceId, [
      { plugin_id: PLUGIN_ID, enabled: false, default_tool_policy: 'allow' },
    ])
    const disabled = await jsonRpc(world, PLUGIN_ID, token, 'tools/list', {})
    expect(disabled.status).toBe(401)
  },
)
