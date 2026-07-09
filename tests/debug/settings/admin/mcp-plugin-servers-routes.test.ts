// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { handleAdminMcpPluginServersRoutes } from '../../../../src/debug/settings/admin/mcp-plugin-servers-routes.js'
import { addAdmin } from '../../../../src/instances/admin-store.js'
import { contributionRegistry } from '../../../../src/plugins/contributions.js'
import { pluginRegistry } from '../../../../src/plugins/registry.js'
import { PLUGIN_API_VERSION, type DiscoveredPlugin } from '../../../../src/plugins/types.js'
import { addUser } from '../../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from '../helpers.js'

const PLUGIN_ID = 'admin-mcp-server-plugin'

const mcpServerPlugin: DiscoveredPlugin = {
  manifest: {
    id: PLUGIN_ID,
    name: 'Admin MCP Server Plugin',
    version: '1.0.0',
    description: 'Plugin used in admin mcp-plugin-servers route tests',
    apiVersion: PLUGIN_API_VERSION,
    main: 'index.ts',
    contributes: {
      tools: ['do_thing'],
      promptFragments: [],
      commands: [],
      jobs: [],
      configKeys: [],
      taskProviderTypes: [],
      attachmentTransformers: [],
    },
    permissions: [],
    defaultEnabled: false,
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
  },
  pluginDir: `/tmp/${PLUGIN_ID}`,
  entryPoint: `/tmp/${PLUGIN_ID}/index.ts`,
  manifestHash: `hash-${PLUGIN_ID}`,
}

function registerMcpServerPlugin(): void {
  pluginRegistry.registerDiscovered(mcpServerPlugin)
  pluginRegistry.approve(PLUGIN_ID, 'admin', mcpServerPlugin.manifestHash)
  pluginRegistry.markActive(PLUGIN_ID)
  contributionRegistry.register(
    PLUGIN_ID,
    {
      tools: [
        { name: 'do_thing', description: 'Do the thing', execute: (): Promise<unknown> => Promise.resolve('ok') },
      ],
      promptFragments: [],
      commands: [],
      jobs: [],
      attachmentTransformers: [],
    },
    mcpServerPlugin.manifest,
  )
}

const ResponseSchema = z.object({
  available: z.array(
    z.object({
      pluginId: z.string(),
      name: z.string(),
      description: z.string(),
      tools: z.array(z.string()),
    }),
  ),
  configs: z.array(
    z.object({
      plugin_id: z.string(),
      enabled: z.boolean(),
      default_tool_policy: z.enum(['allow', 'ask', 'deny']),
      tool_policy: z.record(z.string(), z.enum(['allow', 'ask', 'deny'])).optional(),
    }),
  ),
})

describe('settings admin mcp-plugin-servers routes', () => {
  let adminSession: SettingsSession
  let userSession: SettingsSession

  beforeEach(async () => {
    mockLogger()
    process.env['INSTANCE_CONFIG_KEY'] = 'e'.repeat(64)
    await setupTestDb()
    pluginRegistry.clearForTesting()
    contributionRegistry.deregister(PLUGIN_ID)
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'admin-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    addUser({ userId: 'user-1', platformInstanceId: 'pi-1', addedBy: 'admin-1', username: undefined })
    addAdmin('admin-1', 'pi-1')
    adminSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'admin-1' })
    userSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'user-1' })
  })

  test('GET returns available mcpServer plugins and an empty configs array by default', async () => {
    registerMcpServerPlugin()
    const url = new URL('https://x/settings/api/admin/mcp-plugin-servers')
    const res = await handleAdminMcpPluginServersRoutes(
      new Request(url, { headers: authHeaders(adminSession) }),
      url,
      url.pathname,
    )
    expect(res.status).toBe(200)
    const body = ResponseSchema.parse(await res.json())
    expect(body.configs).toEqual([])
    expect(body.available).toHaveLength(1)
    expect(body.available[0]).toEqual({
      pluginId: PLUGIN_ID,
      name: 'Admin MCP Server Plugin',
      description: 'Plugin used in admin mcp-plugin-servers route tests',
      tools: ['do_thing'],
    })
  })

  test('non-admin cannot read', async () => {
    const url = new URL('https://x/settings/api/admin/mcp-plugin-servers')
    const res = await handleAdminMcpPluginServersRoutes(
      new Request(url, { headers: authHeaders(userSession) }),
      url,
      url.pathname,
    )
    expect(res.status).toBe(403)
  })

  test('POST kind:plugin-servers persists configs and echoes them; GET reflects them', async () => {
    registerMcpServerPlugin()
    const url = new URL('https://x/settings/api/admin/mcp-plugin-servers')
    const req = new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'plugin-servers',
        configs: [{ plugin_id: PLUGIN_ID, enabled: true, default_tool_policy: 'allow' }],
      }),
    })
    const res = await handleAdminMcpPluginServersRoutes(req, url, url.pathname)
    expect(res.status).toBe(200)
    const body = ResponseSchema.parse(await res.json())
    expect(body.configs).toHaveLength(1)
    expect(body.configs[0]).toMatchObject({
      plugin_id: PLUGIN_ID,
      enabled: true,
      default_tool_policy: 'allow',
    })

    const getRes = await handleAdminMcpPluginServersRoutes(
      new Request(url, { headers: authHeaders(adminSession) }),
      url,
      url.pathname,
    )
    const getBody = ResponseSchema.parse(await getRes.json())
    expect(getBody.configs).toHaveLength(1)
    expect(getBody.configs[0]?.plugin_id).toBe(PLUGIN_ID)
  })

  test('POST rejects an unknown default_tool_policy with 422', async () => {
    const url = new URL('https://x/settings/api/admin/mcp-plugin-servers')
    const req = new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'plugin-servers',
        configs: [{ plugin_id: PLUGIN_ID, enabled: true, default_tool_policy: 'maybe' }],
      }),
    })
    const res = await handleAdminMcpPluginServersRoutes(req, url, url.pathname)
    expect(res.status).toBe(422)
  })

  test('POST without CSRF returns 403', async () => {
    const url = new URL('https://x/settings/api/admin/mcp-plugin-servers')
    const req = new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(adminSession, false), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'plugin-servers', configs: [] }),
    })
    const res = await handleAdminMcpPluginServersRoutes(req, url, url.pathname)
    expect(res.status).toBe(403)
  })

  test('non-admin POST is rejected with 403', async () => {
    const url = new URL('https://x/settings/api/admin/mcp-plugin-servers')
    const req = new Request(url, {
      method: 'POST',
      headers: { ...authHeaders(userSession, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'plugin-servers', configs: [] }),
    })
    const res = await handleAdminMcpPluginServersRoutes(req, url, url.pathname)
    expect(res.status).toBe(403)
  })

  test('unsupported method returns 405', async () => {
    const url = new URL('https://x/settings/api/admin/mcp-plugin-servers')
    const res = await handleAdminMcpPluginServersRoutes(
      new Request(url, { method: 'DELETE', headers: authHeaders(adminSession) }),
      url,
      url.pathname,
    )
    expect(res.status).toBe(405)
  })

  test('unauthenticated request returns 401', async () => {
    const url = new URL('https://x/settings/api/admin/mcp-plugin-servers')
    const res = await handleAdminMcpPluginServersRoutes(new Request(url), url, url.pathname)
    expect(res.status).toBe(401)
  })
})
