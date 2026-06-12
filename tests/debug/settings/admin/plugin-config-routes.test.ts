// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { handleAdminPluginConfigRoutes } from '../../../../src/debug/settings/admin/plugin-config-routes.js'
import { addAdmin, SUPER_ADMIN_PLATFORM_ID } from '../../../../src/instances/admin-store.js'
import { pluginRegistry } from '../../../../src/plugins/registry.js'
import { getPluginAdminConfig } from '../../../../src/plugins/store.js'
import type { DiscoveredPlugin } from '../../../../src/plugins/types.js'
import { PLUGIN_API_VERSION } from '../../../../src/plugins/types.js'
import { addUser } from '../../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from '../helpers.js'

function makePlugin(overrides?: Partial<DiscoveredPlugin>): DiscoveredPlugin {
  return {
    manifest: {
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      description: 'A test plugin with admin config',
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
      configRequirements: [
        { key: 'api_key', label: 'API Key', required: true, sensitive: true, scope: 'admin' },
        { key: 'endpoint', label: 'Endpoint URL', required: false, sensitive: false, scope: 'admin' },
        { key: 'user_token', label: 'User Token', required: false, sensitive: false, scope: 'context' },
      ],
      providerCapabilities: [],
      providerConfigSchema: [],
      providerAllowedHosts: [],
    },
    pluginDir: '/fake/plugin-dir/test-plugin',
    entryPoint: '/fake/plugin-dir/test-plugin/index.ts',
    manifestHash: 'hash-abc',
    ...overrides,
  }
}

describe('settings admin plugin-config routes', () => {
  let botAdminSession: SettingsSession
  let plainSession: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    pluginRegistry.clearForTesting()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'sa-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    addUser({ userId: 'ba-1', platformInstanceId: 'pi-1', addedBy: 'sa-1', username: undefined })
    addUser({ userId: 'plain-1', platformInstanceId: 'pi-1', addedBy: 'sa-1', username: undefined })
    addAdmin('sa-1', SUPER_ADMIN_PLATFORM_ID)
    addAdmin('ba-1', 'pi-1')
    botAdminSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'ba-1' })
    plainSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'plain-1' })
  })

  afterEach(() => {
    pluginRegistry.clearForTesting()
  })

  // --- GET ---

  test('GET as bot admin returns snapshot with admin keys only', async () => {
    pluginRegistry.registerDiscovered(makePlugin())
    const url = new URL('https://x/settings/api/admin/plugin-config')
    const res = await handleAdminPluginConfigRoutes(
      new Request(url, { method: 'GET', headers: authHeaders(botAdminSession) }),
      url,
      '/settings/api/admin/plugin-config',
    )
    expect(res.status).toBe(200)
    const body = z
      .object({
        plugins: z.array(
          z.object({
            pluginId: z.string(),
            keys: z.array(
              z.object({
                key: z.string(),
                label: z.string(),
                value: z.null(),
                sensitive: z.boolean(),
                required: z.boolean(),
              }),
            ),
          }),
        ),
      })
      .parse(await res.json())
    expect(body.plugins).toHaveLength(1)
    expect(body.plugins[0]!.pluginId).toBe('test-plugin')
    // Only admin-scoped keys (api_key and endpoint); user_token is context-scoped and excluded
    expect(body.plugins[0]!.keys).toHaveLength(2)
    const keyNames = body.plugins[0]!.keys.map((k) => k.key)
    expect(keyNames).toContain('api_key')
    expect(keyNames).toContain('endpoint')
    expect(keyNames).not.toContain('user_token')
  })

  test('GET as bot admin masks sensitive values when set', async () => {
    pluginRegistry.registerDiscovered(makePlugin())
    // Pre-populate a value so the masking logic triggers
    const url = new URL('https://x/settings/api/admin/plugin-config')
    const patchRes = await handleAdminPluginConfigRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(botAdminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: 'test-plugin', key: 'api_key', value: 'super-secret-token' }),
      }),
      url,
      '/settings/api/admin/plugin-config',
    )
    expect(patchRes.status).toBe(200)

    const getRes = await handleAdminPluginConfigRoutes(
      new Request(url, { method: 'GET', headers: authHeaders(botAdminSession) }),
      url,
      '/settings/api/admin/plugin-config',
    )
    expect(getRes.status).toBe(200)
    const body = z
      .object({
        plugins: z.array(z.object({ keys: z.array(z.object({ key: z.string(), value: z.string().nullable() })) })),
      })
      .parse(await getRes.json())
    const apikeyRow = body.plugins[0]!.keys.find((k) => k.key === 'api_key')
    expect(apikeyRow).toBeDefined()
    // sensitive: value is masked, not the raw secret
    expect(apikeyRow!.value).toBe('****oken')
  })

  test('GET without session returns 401', async () => {
    const url = new URL('https://x/settings/api/admin/plugin-config')
    const res = await handleAdminPluginConfigRoutes(
      new Request(url, { method: 'GET' }),
      url,
      '/settings/api/admin/plugin-config',
    )
    expect(res.status).toBe(401)
  })

  test('GET as non-admin returns 403', async () => {
    pluginRegistry.registerDiscovered(makePlugin())
    const url = new URL('https://x/settings/api/admin/plugin-config')
    const res = await handleAdminPluginConfigRoutes(
      new Request(url, { method: 'GET', headers: authHeaders(plainSession) }),
      url,
      '/settings/api/admin/plugin-config',
    )
    expect(res.status).toBe(403)
  })

  test('GET returns empty plugins list when no plugins have admin keys', async () => {
    // Plugin with no configRequirements
    pluginRegistry.registerDiscovered(
      makePlugin({
        manifest: {
          ...makePlugin().manifest,
          id: 'no-config-plugin',
          configRequirements: [],
        },
      }),
    )
    const url = new URL('https://x/settings/api/admin/plugin-config')
    const res = await handleAdminPluginConfigRoutes(
      new Request(url, { method: 'GET', headers: authHeaders(botAdminSession) }),
      url,
      '/settings/api/admin/plugin-config',
    )
    expect(res.status).toBe(200)
    const body = z.object({ plugins: z.array(z.unknown()) }).parse(await res.json())
    expect(body.plugins).toHaveLength(0)
  })

  // --- PATCH ---

  test('PATCH as bot admin with valid payload persists the value', async () => {
    pluginRegistry.registerDiscovered(makePlugin())
    const url = new URL('https://x/settings/api/admin/plugin-config')
    const res = await handleAdminPluginConfigRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(botAdminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: 'test-plugin', key: 'endpoint', value: 'https://api.example.com' }),
      }),
      url,
      '/settings/api/admin/plugin-config',
    )
    expect(res.status).toBe(200)
    const body = z
      .object({ ok: z.literal(true), pluginId: z.string(), key: z.string(), updatedAt: z.number() })
      .parse(await res.json())
    expect(body.pluginId).toBe('test-plugin')
    expect(body.key).toBe('endpoint')
    // Read back via store to confirm persistence
    const stored = getPluginAdminConfig('test-plugin', 'endpoint')
    expect(stored).toBe('https://api.example.com')
  })

  test('PATCH unknown plugin returns 422', async () => {
    const url = new URL('https://x/settings/api/admin/plugin-config')
    const res = await handleAdminPluginConfigRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(botAdminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: 'no-such-plugin', key: 'api_key', value: 'val' }),
      }),
      url,
      '/settings/api/admin/plugin-config',
    )
    expect(res.status).toBe(422)
    const body = z.object({ error: z.string() }).parse(await res.json())
    expect(body.error).toContain('no-such-plugin')
  })

  test('PATCH undeclared/non-admin key returns 422', async () => {
    pluginRegistry.registerDiscovered(makePlugin())
    const url = new URL('https://x/settings/api/admin/plugin-config')
    // user_token is scope: 'context', not 'admin'
    const res = await handleAdminPluginConfigRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(botAdminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: 'test-plugin', key: 'user_token', value: 'val' }),
      }),
      url,
      '/settings/api/admin/plugin-config',
    )
    expect(res.status).toBe(422)
    const body = z.object({ error: z.string() }).parse(await res.json())
    expect(body.error).toContain('user_token')
  })

  test('PATCH empty value returns 422', async () => {
    pluginRegistry.registerDiscovered(makePlugin())
    const url = new URL('https://x/settings/api/admin/plugin-config')
    const res = await handleAdminPluginConfigRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(botAdminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: 'test-plugin', key: 'api_key', value: '   ' }),
      }),
      url,
      '/settings/api/admin/plugin-config',
    )
    expect(res.status).toBe(422)
  })

  test('PATCH without CSRF header returns 403', async () => {
    pluginRegistry.registerDiscovered(makePlugin())
    const url = new URL('https://x/settings/api/admin/plugin-config')
    const res = await handleAdminPluginConfigRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(botAdminSession, false), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: 'test-plugin', key: 'api_key', value: 'val' }),
      }),
      url,
      '/settings/api/admin/plugin-config',
    )
    expect(res.status).toBe(403)
  })

  test('PATCH as non-admin returns 403', async () => {
    pluginRegistry.registerDiscovered(makePlugin())
    const url = new URL('https://x/settings/api/admin/plugin-config')
    const res = await handleAdminPluginConfigRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(plainSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: 'test-plugin', key: 'api_key', value: 'val' }),
      }),
      url,
      '/settings/api/admin/plugin-config',
    )
    expect(res.status).toBe(403)
  })

  test('PATCH without session returns 401', async () => {
    const url = new URL('https://x/settings/api/admin/plugin-config')
    const res = await handleAdminPluginConfigRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: 'test-plugin', key: 'api_key', value: 'val' }),
      }),
      url,
      '/settings/api/admin/plugin-config',
    )
    expect(res.status).toBe(401)
  })

  test('other HTTP methods return 405', async () => {
    const url = new URL('https://x/settings/api/admin/plugin-config')
    const res = await handleAdminPluginConfigRoutes(
      new Request(url, { method: 'DELETE', headers: authHeaders(botAdminSession) }),
      url,
      '/settings/api/admin/plugin-config',
    )
    expect(res.status).toBe(405)
  })
})
