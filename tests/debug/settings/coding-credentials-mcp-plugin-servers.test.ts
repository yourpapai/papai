// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { setMcpCatalog } from '../../../src/modules/coding/credentials/mcp-catalog.js'
import { setMcpPluginServerConfigs } from '../../../src/modules/coding/credentials/mcp-plugin-servers.js'
import { handleCodingCredentialsRoutes } from '../../../src/debug/settings/coding-credentials-routes.js'
import { pluginRegistry } from '../../../src/plugins/registry.js'
import { PLUGIN_API_VERSION, type DiscoveredPlugin } from '../../../src/plugins/types.js'
import { resolveSettingsPrincipal } from '../../../src/settings/principal.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const PLATFORM_INSTANCE_ID = 'pi-coding-mcp-plugins'
const USER_ID = 'u-coding-mcp-plugins-1'

const GetResponseSchema = z.object({
  namespace: z.string(),
  fields: z.array(z.object({ key: z.string() })),
  catalog: z.array(z.unknown()).optional(),
  pluginServers: z.array(z.object({ name: z.string(), label: z.string() })).optional(),
})

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

function get(path: string, session: SettingsSession): Request {
  return new Request(`https://x${path}`, { headers: authHeaders(session) })
}

describe('coding-credentials routes: mcp namespace pluginServers', () => {
  let session: SettingsSession
  let personalConfigContextId: string
  const originalBaseUrl = process.env['SETTINGS_PUBLIC_BASE_URL']

  beforeEach(async () => {
    mockLogger()
    process.env['INSTANCE_CONFIG_KEY'] = 'e'.repeat(64)
    await setupTestDb()
    pluginRegistry.clearForTesting()
    seedTestPlatformInstance({ id: PLATFORM_INSTANCE_ID })
    addUser({
      userId: USER_ID,
      platformInstanceId: PLATFORM_INSTANCE_ID,
      addedBy: 'admin',
      username: undefined,
    })
    session = await establishSession({
      platformInstanceId: PLATFORM_INSTANCE_ID,
      platformUserId: USER_ID,
    })
    personalConfigContextId = resolveSettingsPrincipal(PLATFORM_INSTANCE_ID, USER_ID).personalConfigContextId
  })

  afterEach(() => {
    if (originalBaseUrl === undefined) delete process.env['SETTINGS_PUBLIC_BASE_URL']
    else process.env['SETTINGS_PUBLIC_BASE_URL'] = originalBaseUrl
  })

  test('GET ?namespace=mcp includes enabled internal plugin servers alongside the catalog', async () => {
    process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://bot.example.com'

    const plugin = makePlugin()
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'admin', plugin.manifestHash)
    pluginRegistry.markActive(plugin.manifest.id)

    setMcpPluginServerConfigs(PLATFORM_INSTANCE_ID, [
      { plugin_id: 'synthetic-web-search', enabled: true, default_tool_policy: 'allow' },
    ])

    const catalog = [
      { name: 'github', upstream_url: 'https://mcp.example.com/github', default_tool_policy: 'allow' as const },
    ]
    setMcpCatalog(PLATFORM_INSTANCE_ID, catalog)

    const url = new URL(`https://x/settings/api/coding-credentials?contextId=${personalConfigContextId}&namespace=mcp`)
    const res = await handleCodingCredentialsRoutes(
      get(`/settings/api/coding-credentials?contextId=${personalConfigContextId}&namespace=mcp`, session),
      url,
    )
    expect(res.status).toBe(200)
    const body = GetResponseSchema.parse(await res.json())

    expect(body.catalog).toEqual(catalog)
    expect(body.pluginServers).toEqual([{ name: 'plugin:synthetic-web-search', label: 'Synthetic Web Search' }])

    const text = JSON.stringify(body.pluginServers)
    expect(text).not.toContain('upstreamUrl')
    expect(text).not.toContain('bot.example.com')
    expect(text).not.toContain('toolPolicy')
  })

  test('GET ?namespace=mcp returns an empty pluginServers list when none are enabled', async () => {
    process.env['SETTINGS_PUBLIC_BASE_URL'] = 'https://bot.example.com'

    const url = new URL(`https://x/settings/api/coding-credentials?contextId=${personalConfigContextId}&namespace=mcp`)
    const res = await handleCodingCredentialsRoutes(
      get(`/settings/api/coding-credentials?contextId=${personalConfigContextId}&namespace=mcp`, session),
      url,
    )
    expect(res.status).toBe(200)
    const body = GetResponseSchema.parse(await res.json())
    expect(body.pluginServers).toEqual([])
  })

  test('GET ?namespace=agent-provider does not include pluginServers', async () => {
    const url = new URL(`https://x/settings/api/coding-credentials?contextId=${personalConfigContextId}`)
    const res = await handleCodingCredentialsRoutes(
      get(`/settings/api/coding-credentials?contextId=${personalConfigContextId}`, session),
      url,
    )
    expect(res.status).toBe(200)
    const body = GetResponseSchema.parse(await res.json())
    expect(body.pluginServers).toBeUndefined()
  })
})
