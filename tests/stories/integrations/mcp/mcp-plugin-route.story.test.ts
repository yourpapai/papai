// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { getConfigContextIdFromStorageContextId, toScopedContextId } from '../../../../src/chat/scoped-context.js'
import { mintPluginMcpToken } from '../../../../src/mcp-server/token.js'
import { discoverPlugins } from '../../../../src/plugins/discovery.js'
import { setPluginEnabledForContext } from '../../../../src/plugins/registry.js'
import { setPluginAdminConfig } from '../../../../src/plugins/store.js'
import type { DiscoveredPlugin } from '../../../../src/plugins/types.js'
import { scenario } from '../../harness/scenario.js'

const PLUGIN_ID = 'synthetic-web-search'
const API_URL = 'https://api.synthetic.new/v2/search'
const RESULT_MARKER = 'papaipluginroute4k'

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
  'SCN-http-mcp-plugin: a signed token calls a hosted plugin tool; bad tokens are rejected',
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
    given.mcpPluginServer(alice.platformInstanceId, PLUGIN_ID)

    await world.start()

    // Stub the plugin's upstream so tools/call returns a marker-bearing result. Step 0 confirmed
    // the plugin's httpFetch is `pluginProviderRuntimeDeps.fetch`, threaded from `world.http.fetch`
    // (world.ts ~438) through `buildManifestProviderRuntime`, so this egress is dispatcher-routed
    // and interceptable — the tools/call happy path applies (not the tools/list fallback).
    world.http.expect({ method: 'POST', url: API_URL }, () =>
      Response.json({ results: [{ title: 'r', url: 'https://x.invalid', text: RESULT_MARKER }] }),
    )

    const token = mintPluginMcpToken({ storageContextId, chatUserId: alice.id, pluginId: PLUGIN_ID })

    // Happy path: real signed token → real plugin tool result over the route.
    const ok = await jsonRpc(world, PLUGIN_ID, token, 'tools/call', { name: 'search', arguments: { query: 'hi' } })
    expect(ok.status).toBe(200)
    expect(JSON.stringify(await ok.json())).toContain(RESULT_MARKER)

    // Negatives (no upstream is hit — the gate rejects before dispatch).
    const noToken = await jsonRpc(world, PLUGIN_ID, '', 'tools/list', {})
    expect(noToken.status).toBe(401)
    const wrongPlugin = mintPluginMcpToken({ storageContextId, chatUserId: alice.id, pluginId: 'other-plugin' })
    const mismatch = await jsonRpc(world, PLUGIN_ID, wrongPlugin, 'tools/list', {})
    expect(mismatch.status).toBe(401)
  },
)
