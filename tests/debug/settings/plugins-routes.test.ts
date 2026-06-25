// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { z } from 'zod'

import { getPluginConfig, maskSensitiveValue, setPluginConfig } from '../../../src/config.js'
import { handlePluginsRoutes } from '../../../src/debug/settings/plugins-routes.js'
import { pluginRegistry } from '../../../src/plugins/registry.js'
import type { DiscoveredPlugin } from '../../../src/plugins/types.js'
import { PLUGIN_API_VERSION } from '../../../src/plugins/types.js'
import { resolveSettingsPrincipal } from '../../../src/settings/principal.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

function makePlugin(overrides?: Partial<DiscoveredPlugin>): DiscoveredPlugin {
  return {
    manifest: {
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      description: 'A test',
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
      providerConfigSchema: [],
      providerAllowedHosts: [],
    },
    pluginDir: '/fake/plugin-dir/test-plugin',
    entryPoint: '/fake/plugin-dir/test-plugin/index.ts',
    manifestHash: 'hash-abc',
    ...overrides,
  }
}

describe('settings plugins routes', () => {
  let session: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    pluginRegistry.clearForTesting()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
  })

  afterEach(() => {
    pluginRegistry.clearForTesting()
  })

  test('GET returns a plugins array (empty when none discovered)', async () => {
    const url = new URL('https://x/settings/api/plugins')
    const res = await handlePluginsRoutes(
      new Request(url, { headers: authHeaders(session) }),
      url,
      '/settings/api/plugins',
    )
    expect(res.status).toBe(200)
    const body = z.object({ plugins: z.array(z.unknown()) }).parse(await res.json())
    expect(Array.isArray(body.plugins)).toBe(true)
  })

  test('toggle of an unknown plugin returns 422', async () => {
    const url = new URL('https://x/settings/api/plugins/toggle')
    const res = await handlePluginsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: 'ghost', enabled: true }),
      }),
      url,
      '/settings/api/plugins/toggle',
    )
    expect(res.status).toBe(422)
  })

  test('toggle enable of a non-active plugin returns 422 plugin not active', async () => {
    pluginRegistry.registerDiscovered(makePlugin())
    // state is 'discovered' after registerDiscovered (no prior DB approval)

    const url = new URL('https://x/settings/api/plugins/toggle')
    const res = await handlePluginsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: 'test-plugin', enabled: true }),
      }),
      url,
      '/settings/api/plugins/toggle',
    )
    expect(res.status).toBe(422)
    const body = z.object({ error: z.string() }).parse(await res.json())
    expect(body.error).toBe('plugin not active')
  })

  test('toggle enable of an active plugin with a missing required context config key returns 422 with missingKeys', async () => {
    const plugin = makePlugin({
      manifest: {
        ...makePlugin().manifest,
        configRequirements: [{ key: 'token', label: 'Token', required: true, sensitive: true, scope: 'context' }],
      },
    })
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve('test-plugin', 'admin', 'hash-abc')
    pluginRegistry.markActive('test-plugin')
    // no config set for 'token' → config_missing

    const url = new URL('https://x/settings/api/plugins/toggle')
    const res = await handlePluginsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: 'test-plugin', enabled: true }),
      }),
      url,
      '/settings/api/plugins/toggle',
    )
    expect(res.status).toBe(422)
    const body = z.object({ error: z.string(), missingKeys: z.array(z.string()) }).parse(await res.json())
    expect(body.error).toBe('plugin config missing')
    expect(body.missingKeys).toEqual(['token'])
  })

  test('config PATCH with an unknown key for a known plugin returns 422', async () => {
    pluginRegistry.registerDiscovered(makePlugin())

    const url = new URL('https://x/settings/api/plugins/config')
    const res = await handlePluginsRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: 'test-plugin', key: 'no-such-key', value: 'val' }),
      }),
      url,
      '/settings/api/plugins/config',
    )
    expect(res.status).toBe(422)
    const body = z.object({ error: z.string() }).parse(await res.json())
    expect(body.error).toBe('unknown plugin config key')
  })

  test('config PATCH of a sensitive context-scoped key with empty value returns 200 unchanged', async () => {
    const plugin = makePlugin({
      manifest: {
        ...makePlugin().manifest,
        configRequirements: [{ key: 'api_key', label: 'API Key', required: true, sensitive: true, scope: 'context' }],
      },
    })
    pluginRegistry.registerDiscovered(plugin)

    const url = new URL('https://x/settings/api/plugins/config')
    const res = await handlePluginsRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: 'test-plugin', key: 'api_key', value: '' }),
      }),
      url,
      '/settings/api/plugins/config',
    )
    expect(res.status).toBe(200)
    const body = z.object({ ok: z.boolean(), unchanged: z.boolean() }).parse(await res.json())
    expect(body.unchanged).toBe(true)
  })

  test('config PATCH of a sensitive key with masked value echoed back returns unchanged=true without overwriting the stored secret', async () => {
    const plugin = makePlugin({
      manifest: {
        ...makePlugin().manifest,
        configRequirements: [{ key: 'token', label: 'Token', required: true, sensitive: true, scope: 'context' }],
      },
    })
    pluginRegistry.registerDiscovered(plugin)

    // Arrange: seed the plugin config with a known plaintext value.
    const { personalConfigContextId } = resolveSettingsPrincipal('pi-1', 'u-1')
    const plaintext = 'secret-plugin-token-xyz'
    setPluginConfig(personalConfigContextId, 'test-plugin', 'token', plaintext)

    // Compute the masked form that a GET response would return.
    const masked = maskSensitiveValue(plaintext)

    // Act: PATCH with the masked value (simulating SPA echoing back what it received).
    const url = new URL('https://x/settings/api/plugins/config')
    const res = await handlePluginsRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: 'test-plugin', key: 'token', value: masked }),
      }),
      url,
      '/settings/api/plugins/config',
    )

    // Assert: 200 with unchanged flag — stored value must not have been overwritten.
    expect(res.status).toBe(200)
    const body = z.object({ ok: z.literal(true), unchanged: z.literal(true) }).parse(await res.json())
    expect(body.unchanged).toBe(true)
    assert(
      getPluginConfig(personalConfigContextId, 'test-plugin', 'token') === plaintext,
      'stored plugin secret must not be overwritten with the masked sentinel value',
    )
  })

  test('config PATCH action:unset clears a plugin context config value', async () => {
    const plugin = makePlugin({
      manifest: {
        ...makePlugin().manifest,
        configRequirements: [{ key: 'api_key', label: 'API Key', required: false, sensitive: false, scope: 'context' }],
      },
    })
    pluginRegistry.registerDiscovered(plugin)

    const { personalConfigContextId } = resolveSettingsPrincipal('pi-1', 'u-1')
    setPluginConfig(personalConfigContextId, 'test-plugin', 'api_key', 'my-secret')
    expect(getPluginConfig(personalConfigContextId, 'test-plugin', 'api_key')).toBe('my-secret')

    const url = new URL('https://x/settings/api/plugins/config')
    const res = await handlePluginsRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unset', pluginId: 'test-plugin', key: 'api_key' }),
      }),
      url,
      '/settings/api/plugins/config',
    )

    expect(res.status).toBe(200)
    const body = z.object({ ok: z.literal(true) }).parse(await res.json())
    expect(body.ok).toBe(true)
    expect(getPluginConfig(personalConfigContextId, 'test-plugin', 'api_key')).toBeNull()
  })

  test('config PATCH action:unset for unknown plugin returns 422', async () => {
    const url = new URL('https://x/settings/api/plugins/config')
    const res = await handlePluginsRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unset', pluginId: 'no-such-plugin', key: 'api_key' }),
      }),
      url,
      '/settings/api/plugins/config',
    )
    expect(res.status).toBe(422)
  })

  test('config PATCH action:unset for unknown key returns 422', async () => {
    pluginRegistry.registerDiscovered(makePlugin())
    const url = new URL('https://x/settings/api/plugins/config')
    const res = await handlePluginsRoutes(
      new Request(url, {
        method: 'PATCH',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unset', pluginId: 'test-plugin', key: 'not-declared' }),
      }),
      url,
      '/settings/api/plugins/config',
    )
    expect(res.status).toBe(422)
  })
})
