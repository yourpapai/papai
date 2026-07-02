// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { handleToolsRoutes } from '../../../src/debug/settings/tools-routes.js'
import { contributionRegistry } from '../../../src/plugins/contributions.js'
import { pluginRegistry, setPluginEnabledForContext } from '../../../src/plugins/registry.js'
import { PLUGIN_API_VERSION, type DiscoveredPlugin } from '../../../src/plugins/types.js'
import { getToolPrefs } from '../../../src/tools/tool-preferences.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const PLATFORM_INSTANCE_ID = 'pi-1'
const USER_ID = 'u-1'
const PLUGIN_ID = 'settings-perm-plugin'
const NAMESPACED_ECHO = 'plugin_settings_perm_plugin__echo_ctx'
const NAMESPACED_PING = 'plugin_settings_perm_plugin__ping'

const ToolEntrySchema = z.object({
  name: z.string(),
  permission: z.enum(['allow', 'ask', 'deny']),
  risk: z.enum(['read', 'write', 'destructive', 'open-world']),
  group: z.string().optional(),
})
const DomainsResponseSchema = z.object({
  contextId: z.string(),
  domains: z.array(
    z.object({
      domain: z.string(),
      summary: z.enum(['allow', 'ask', 'deny', 'partial']),
      tools: z.array(ToolEntrySchema),
    }),
  ),
})

const discoveredPlugin: DiscoveredPlugin = {
  manifest: {
    id: PLUGIN_ID,
    name: 'Settings Perm Plugin',
    version: '1.0.0',
    description: 'Providerless-safe plugin used in settings tools route tests',
    apiVersion: PLUGIN_API_VERSION,
    main: 'index.ts',
    contributes: {
      tools: ['echo_ctx', 'ping'],
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
  },
  pluginDir: `/tmp/${PLUGIN_ID}`,
  entryPoint: `/tmp/${PLUGIN_ID}/index.ts`,
  manifestHash: `hash-${PLUGIN_ID}`,
}

describe('settings tools routes — plugin tools', () => {
  let session: SettingsSession
  let personalContextId: string

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    pluginRegistry.clearForTesting()
    contributionRegistry.deregister(PLUGIN_ID)
    seedTestPlatformInstance({ id: PLATFORM_INSTANCE_ID })
    addUser({ userId: USER_ID, platformInstanceId: PLATFORM_INSTANCE_ID, addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: PLATFORM_INSTANCE_ID, platformUserId: USER_ID })
    personalContextId = toScopedContextId({ platformInstanceId: PLATFORM_INSTANCE_ID, nativeContextId: USER_ID })

    pluginRegistry.registerDiscovered(discoveredPlugin)
    pluginRegistry.approve(PLUGIN_ID, 'admin', discoveredPlugin.manifestHash)
    pluginRegistry.markActive(PLUGIN_ID)
    setPluginEnabledForContext(PLUGIN_ID, personalContextId, true)
    contributionRegistry.register(
      PLUGIN_ID,
      {
        tools: [
          {
            name: 'echo_ctx',
            description: 'Echo the runtime context',
            execute: (): Promise<unknown> => Promise.resolve('ok'),
          },
          {
            name: 'ping',
            description: 'Ping',
            execute: (): Promise<unknown> => Promise.resolve('pong'),
          },
        ],
        promptFragments: [],
        commands: [],
        jobs: [],
        attachmentTransformers: [],
      },
      discoveredPlugin.manifest,
    )
  })

  afterEach(() => {
    pluginRegistry.clearForTesting()
    contributionRegistry.deregister(PLUGIN_ID)
  })

  async function getDomains(): Promise<z.infer<typeof DomainsResponseSchema>> {
    const url = new URL('https://x/settings/api/tools')
    const res = await handleToolsRoutes(new Request(url, { headers: authHeaders(session) }), url, '/settings/api/tools')
    expect(res.status).toBe(200)
    return DomainsResponseSchema.parse(await res.json())
  }

  test('GET lists plugin tools under the plugin domain with the plugin id as group', async () => {
    const body = await getDomains()
    const pluginDomain = body.domains.find((d) => d.domain === 'plugin')
    expect(pluginDomain).toBeDefined()
    const names = pluginDomain!.tools.map((t) => t.name)
    expect(names).toContain(NAMESPACED_ECHO)
    expect(names).toContain(NAMESPACED_PING)
    for (const tool of pluginDomain!.tools) {
      expect(tool.group).toBe(PLUGIN_ID)
      expect(tool.risk).toBe('open-world')
    }
  })

  test('builtin tools carry no group field', async () => {
    const body = await getDomains()
    const timeDomain = body.domains.find((d) => d.domain === 'time')
    expect(timeDomain).toBeDefined()
    for (const tool of timeDomain!.tools) {
      expect(tool.group).toBeUndefined()
    }
  })

  test('toggle kind:tool on a plugin tool persists an override (no longer 422)', async () => {
    const url = new URL('https://x/settings/api/tools/toggle')
    const res = await handleToolsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'tool', tool: NAMESPACED_ECHO, permission: 'deny' }),
      }),
      url,
      '/settings/api/tools/toggle',
    )
    expect(res.status).toBe(200)
    const prefs = getToolPrefs(personalContextId)
    expect(prefs.toolOverrides[NAMESPACED_ECHO]).toBe('deny')
  })

  test('toggle kind:tool on a plugin tool from a disabled plugin is 422', async () => {
    setPluginEnabledForContext(PLUGIN_ID, personalContextId, false)
    const url = new URL('https://x/settings/api/tools/toggle')
    const res = await handleToolsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'tool', tool: NAMESPACED_ECHO, permission: 'deny' }),
      }),
      url,
      '/settings/api/tools/toggle',
    )
    expect(res.status).toBe(422)
  })

  test('toggle kind:group sets overrides for every tool of the plugin', async () => {
    const url = new URL('https://x/settings/api/tools/toggle')
    const res = await handleToolsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'group', domain: 'plugin', group: PLUGIN_ID, permission: 'ask' }),
      }),
      url,
      '/settings/api/tools/toggle',
    )
    expect(res.status).toBe(200)
    const prefs = getToolPrefs(personalContextId)
    expect(prefs.toolOverrides[NAMESPACED_ECHO]).toBe('ask')
    expect(prefs.toolOverrides[NAMESPACED_PING]).toBe('ask')
  })

  test('toggle kind:group with an unknown group is 422', async () => {
    const url = new URL('https://x/settings/api/tools/toggle')
    const res = await handleToolsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'group', domain: 'plugin', group: 'no-such-plugin', permission: 'ask' }),
      }),
      url,
      '/settings/api/tools/toggle',
    )
    expect(res.status).toBe(422)
    expect(z.object({ error: z.string() }).parse(await res.json()).error).toBe('unknown tool group')
  })

  test('toggle kind:group with an unknown domain is 422', async () => {
    const url = new URL('https://x/settings/api/tools/toggle')
    const res = await handleToolsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'group', domain: 'not-a-domain', group: PLUGIN_ID, permission: 'ask' }),
      }),
      url,
      '/settings/api/tools/toggle',
    )
    expect(res.status).toBe(422)
    expect(z.object({ error: z.string() }).parse(await res.json()).error).toBe('unknown tool domain')
  })
})
