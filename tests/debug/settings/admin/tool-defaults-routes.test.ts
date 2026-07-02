// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { handleAdminToolDefaultsRoutes } from '../../../../src/debug/settings/admin/tool-defaults-routes.js'
import { addAdmin } from '../../../../src/instances/admin-store.js'
import { contributionRegistry } from '../../../../src/plugins/contributions.js'
import { pluginRegistry } from '../../../../src/plugins/registry.js'
import { PLUGIN_API_VERSION, type DiscoveredPlugin } from '../../../../src/plugins/types.js'
import { adminToolDefaultsContextId, getAdminToolDefaults } from '../../../../src/tools/admin-tool-defaults.js'
import { detectActivePreset, getToolPrefs, hasStoredToolPrefs } from '../../../../src/tools/tool-preferences.js'
import { addUser } from '../../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from '../helpers.js'

const ToolsResponseSchema = z.object({
  contextId: z.string(),
  domains: z.array(z.unknown()),
  activePreset: z.string().nullable(),
  hasStoredDefaults: z.boolean(),
})

const CatalogDomainsSchema = z.object({
  domains: z.array(
    z.object({
      domain: z.string(),
      tools: z.array(z.object({ name: z.string(), group: z.string().optional() })),
    }),
  ),
})

const ADMIN_PLUGIN_ID = 'admin-catalog-plugin'
const ADMIN_PLUGIN_TOOL = 'plugin_admin_catalog_plugin__do_thing'

const adminCatalogPlugin: DiscoveredPlugin = {
  manifest: {
    id: ADMIN_PLUGIN_ID,
    name: 'Admin Catalog Plugin',
    version: '1.0.0',
    description: 'Plugin used in admin tool-defaults catalog tests',
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
  },
  pluginDir: `/tmp/${ADMIN_PLUGIN_ID}`,
  entryPoint: `/tmp/${ADMIN_PLUGIN_ID}/index.ts`,
  manifestHash: `hash-${ADMIN_PLUGIN_ID}`,
}

function registerAdminCatalogPlugin(): void {
  pluginRegistry.registerDiscovered(adminCatalogPlugin)
  pluginRegistry.markActive(ADMIN_PLUGIN_ID)
  contributionRegistry.register(
    ADMIN_PLUGIN_ID,
    {
      tools: [
        { name: 'do_thing', description: 'Do the thing', execute: (): Promise<unknown> => Promise.resolve('ok') },
      ],
      promptFragments: [],
      commands: [],
      jobs: [],
      attachmentTransformers: [],
    },
    adminCatalogPlugin.manifest,
  )
}

describe('settings admin tool-defaults routes', () => {
  let adminSession: SettingsSession
  let userSession: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    pluginRegistry.clearForTesting()
    contributionRegistry.deregister(ADMIN_PLUGIN_ID)
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'admin-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    addUser({ userId: 'user-1', platformInstanceId: 'pi-1', addedBy: 'admin-1', username: undefined })
    addAdmin('admin-1', 'pi-1')
    adminSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'admin-1' })
    userSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'user-1' })
  })

  afterEach(() => {
    pluginRegistry.clearForTesting()
    contributionRegistry.deregister(ADMIN_PLUGIN_ID)
  })

  test('GET returns 200 with contextId, domains, and activePreset null by default', async () => {
    const url = new URL('https://x/settings/api/admin/tool-defaults')
    const res = await handleAdminToolDefaultsRoutes(
      new Request(url, { headers: authHeaders(adminSession) }),
      url,
      '/settings/api/admin/tool-defaults',
    )
    expect(res.status).toBe(200)
    const body = ToolsResponseSchema.parse(await res.json())
    expect(body.contextId).toBe(adminToolDefaultsContextId('pi-1'))
    expect(Array.isArray(body.domains)).toBe(true)
    expect(body.activePreset).toBeNull()
    expect(body.hasStoredDefaults).toBe(false)
  })

  test('POST preset read-only → 200, getAdminToolDefaults non-null, detectActivePreset === read-only', async () => {
    const url = new URL('https://x/settings/api/admin/tool-defaults')
    const res = await handleAdminToolDefaultsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'preset', preset: 'read-only' }),
      }),
      url,
      '/settings/api/admin/tool-defaults',
    )
    expect(res.status).toBe(200)
    const body = ToolsResponseSchema.parse(await res.json())
    expect(body.activePreset).toBe('read-only')
    expect(body.hasStoredDefaults).toBe(true)
    const defaults = getAdminToolDefaults('pi-1')
    expect(defaults).not.toBeNull()
    const prefs = getToolPrefs(adminToolDefaultsContextId('pi-1'))
    expect(detectActivePreset(prefs)).toBe('read-only')
  })

  test('POST domain deny → hasStoredDefaults: true even when activePreset is null (custom override)', async () => {
    const url = new URL('https://x/settings/api/admin/tool-defaults')
    const res = await handleAdminToolDefaultsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'domain', domain: 'web', permission: 'deny' }),
      }),
      url,
      '/settings/api/admin/tool-defaults',
    )
    expect(res.status).toBe(200)
    const body = ToolsResponseSchema.parse(await res.json())
    // activePreset is null (custom, non-named preset state), but storage was written
    expect(body.activePreset).toBeNull()
    expect(body.hasStoredDefaults).toBe(true)
  })

  test('POST domain deny → 200, admin prefs reflect it', async () => {
    const url = new URL('https://x/settings/api/admin/tool-defaults')
    const res = await handleAdminToolDefaultsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'domain', domain: 'web', permission: 'deny' }),
      }),
      url,
      '/settings/api/admin/tool-defaults',
    )
    expect(res.status).toBe(200)
    const body = ToolsResponseSchema.parse(await res.json())
    const DomainSchema = z.object({ domain: z.string(), summary: z.string() })
    const domains = z.array(DomainSchema).parse(body.domains)
    const webDomain = domains.find((d) => d.domain === 'web')
    expect(webDomain?.summary).toBe('deny')
  })

  test('POST tool ask → 200, web_fetch permission is ask', async () => {
    const url = new URL('https://x/settings/api/admin/tool-defaults')
    const res = await handleAdminToolDefaultsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'tool', tool: 'web_fetch', permission: 'ask' }),
      }),
      url,
      '/settings/api/admin/tool-defaults',
    )
    expect(res.status).toBe(200)
    const body = ToolsResponseSchema.parse(await res.json())
    const DomainToolSchema = z.object({
      domain: z.string(),
      tools: z.array(z.object({ name: z.string(), permission: z.string() })),
    })
    const domains = z.array(DomainToolSchema).parse(body.domains)
    const webDomain = domains.find((d) => d.domain === 'web')
    const webFetch = webDomain?.tools.find((t) => t.name === 'web_fetch')
    expect(webFetch?.permission).toBe('ask')
  })

  test('POST unknown domain → 422', async () => {
    const url = new URL('https://x/settings/api/admin/tool-defaults')
    const res = await handleAdminToolDefaultsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'domain', domain: 'nonexistent-domain-xyz', permission: 'deny' }),
      }),
      url,
      '/settings/api/admin/tool-defaults',
    )
    expect(res.status).toBe(422)
    const body = z.object({ error: z.string() }).parse(await res.json())
    expect(body.error).toBe('unknown tool domain')
  })

  test('POST unknown tool → 422', async () => {
    const url = new URL('https://x/settings/api/admin/tool-defaults')
    const res = await handleAdminToolDefaultsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'tool', tool: 'does_not_exist_tool_xyz', permission: 'ask' }),
      }),
      url,
      '/settings/api/admin/tool-defaults',
    )
    expect(res.status).toBe(422)
    const body = z.object({ error: z.string() }).parse(await res.json())
    expect(body.error).toBe('unknown tool')
  })

  test('POST kind:unset clears admin tool defaults and returns 200 with activePreset null', async () => {
    const ctx = adminToolDefaultsContextId('pi-1')
    const url = new URL('https://x/settings/api/admin/tool-defaults')

    // First, set a preset so there are stored prefs
    await handleAdminToolDefaultsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'preset', preset: 'read-only' }),
      }),
      url,
      '/settings/api/admin/tool-defaults',
    )
    expect(hasStoredToolPrefs(ctx)).toBe(true)

    // Now unset
    const res = await handleAdminToolDefaultsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'unset' }),
      }),
      url,
      '/settings/api/admin/tool-defaults',
    )

    expect(res.status).toBe(200)
    const body = ToolsResponseSchema.parse(await res.json())
    expect(body.contextId).toBe(ctx)
    expect(body.activePreset).toBeNull()
    expect(body.hasStoredDefaults).toBe(false)
    expect(hasStoredToolPrefs(ctx)).toBe(false)
  })

  test('non-admin GET → 403', async () => {
    const url = new URL('https://x/settings/api/admin/tool-defaults')
    const res = await handleAdminToolDefaultsRoutes(
      new Request(url, { headers: authHeaders(userSession) }),
      url,
      '/settings/api/admin/tool-defaults',
    )
    expect(res.status).toBe(403)
  })

  test('non-admin POST → 403', async () => {
    const url = new URL('https://x/settings/api/admin/tool-defaults')
    const res = await handleAdminToolDefaultsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(userSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'preset', preset: 'read-only' }),
      }),
      url,
      '/settings/api/admin/tool-defaults',
    )
    expect(res.status).toBe(403)
  })

  test('admin POST without CSRF → 403', async () => {
    const url = new URL('https://x/settings/api/admin/tool-defaults')
    const res = await handleAdminToolDefaultsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, false), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'preset', preset: 'read-only' }),
      }),
      url,
      '/settings/api/admin/tool-defaults',
    )
    expect(res.status).toBe(403)
  })

  test('GET catalog includes native tool names of active plugins', async () => {
    registerAdminCatalogPlugin()
    const url = new URL('https://x/settings/api/admin/tool-defaults')
    const res = await handleAdminToolDefaultsRoutes(
      new Request(url, { headers: authHeaders(adminSession) }),
      url,
      '/settings/api/admin/tool-defaults',
    )
    expect(res.status).toBe(200)
    const body = CatalogDomainsSchema.parse(await res.json())
    const pluginDomain = body.domains.find((d) => d.domain === 'plugin')
    expect(pluginDomain).toBeDefined()
    expect(pluginDomain!.tools.map((t) => t.name)).toContain(ADMIN_PLUGIN_TOOL)
    expect(pluginDomain!.tools[0]!.group).toBe(ADMIN_PLUGIN_ID)
  })

  test('POST kind:group sets overrides for the plugin group in the admin defaults context', async () => {
    registerAdminCatalogPlugin()
    const url = new URL('https://x/settings/api/admin/tool-defaults')
    const res = await handleAdminToolDefaultsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'group', domain: 'plugin', group: ADMIN_PLUGIN_ID, permission: 'ask' }),
      }),
      url,
      '/settings/api/admin/tool-defaults',
    )
    expect(res.status).toBe(200)
    const prefs = getToolPrefs(adminToolDefaultsContextId('pi-1'))
    expect(prefs.toolOverrides[ADMIN_PLUGIN_TOOL]).toBe('ask')
  })

  test('POST kind:group with an unknown group is 422', async () => {
    const url = new URL('https://x/settings/api/admin/tool-defaults')
    const res = await handleAdminToolDefaultsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'group', domain: 'plugin', group: 'no-such-plugin', permission: 'ask' }),
      }),
      url,
      '/settings/api/admin/tool-defaults',
    )
    expect(res.status).toBe(422)
  })
})
