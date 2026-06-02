// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { z } from 'zod'

import { ChatRouter } from '../../../../src/chat/router.js'
import type { DeferredDeliveryTarget } from '../../../../src/chat/types.js'
import { clearRuntimeChatRouter, setRuntimeChatRouter } from '../../../../src/debug/chat-router-runtime.js'
import { handleAdminRosterPluginsRoutes } from '../../../../src/debug/settings/admin/roster-plugins-routes.js'
import { addAdmin, listAdmins, SUPER_ADMIN_PLATFORM_ID } from '../../../../src/instances/admin-store.js'
import { activatePlugins, deactivateAllPlugins, getActivatedPluginIds } from '../../../../src/plugins/loader.js'
import { pluginRegistry } from '../../../../src/plugins/registry.js'
import type { DiscoveredPlugin } from '../../../../src/plugins/types.js'
import { PLUGIN_API_VERSION } from '../../../../src/plugins/types.js'
import { getTaskProviderDescriptor } from '../../../../src/providers/registry.js'
import { addUser } from '../../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from '../helpers.js'

function makePlugin(overrides?: Partial<DiscoveredPlugin>): DiscoveredPlugin {
  return {
    manifest: {
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
      description: 'A test plugin',
      apiVersion: PLUGIN_API_VERSION,
      main: 'index.ts',
      contributes: { tools: [], promptFragments: [], commands: [], jobs: [], configKeys: [], taskProviderTypes: [] },
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

const tempDirs: string[] = []

function writeTempPluginModule(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'papai-admin-plugin-approval-'))
  tempDirs.push(dir)
  const modulePath = join(dir, 'index.mjs')
  writeFileSync(modulePath, source)
  return modulePath
}

function makeRuntimeProviderPlugin(providerType: string): DiscoveredPlugin {
  const entryPoint = writeTempPluginModule(`
    export default function createPlugin() {
      return {
        activate(ctx) {
          ctx.registration.registerTaskProviderType('${providerType}', {
            factory: () => ({ name: '${providerType}' }),
          })
        },
      }
    }
  `)
  return makePlugin({
    entryPoint,
    pluginDir: dirname(entryPoint),
    manifest: {
      id: 'test-plugin',
      name: 'Test Provider Plugin',
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
        taskProviderTypes: [providerType],
      },
      permissions: ['provider.task'],
      defaultEnabled: true,
      activationTimeoutMs: 5000,
      requiredTaskCapabilities: [],
      requiredChatCapabilities: [],
      configRequirements: [],
      providerCapabilities: [],
      providerConfigSchema: [],
      providerContextConfigSchema: [],
      providerAllowedHosts: [],
      providerTraits: [],
    },
  })
}

class MockSendRouter extends ChatRouter {
  constructor() {
    super(() => {
      throw new Error('unused test factory')
    })
  }

  override sendMessage(
    _platformInstanceId: string,
    _target: DeferredDeliveryTarget,
    _markdown: string,
  ): Promise<boolean> {
    return Promise.resolve(true)
  }
}

describe('settings admin roster/plugins routes', () => {
  let superSession: SettingsSession
  let botAdminSession: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    await deactivateAllPlugins()
    pluginRegistry.clearForTesting()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'sa-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    addUser({ userId: 'ba-1', platformInstanceId: 'pi-1', addedBy: 'sa-1', username: undefined })
    addAdmin('sa-1', SUPER_ADMIN_PLATFORM_ID)
    addAdmin('ba-1', 'pi-1')
    superSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'sa-1' })
    botAdminSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'ba-1' })
  })

  afterEach(async () => {
    await deactivateAllPlugins()
    pluginRegistry.clearForTesting()
    clearRuntimeChatRouter()
    tempDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
  })

  test('bot-admin (non-SA) cannot add to the roster (403)', async () => {
    const url = new URL('https://x/settings/api/admin/admins')
    const res = await handleAdminRosterPluginsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(botAdminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'x', platformInstanceId: 'pi-1' }),
      }),
      url,
      '/settings/api/admin/admins',
    )
    expect(res.status).toBe(403)
  })

  test('super-admin adds to the roster', async () => {
    const url = new URL('https://x/settings/api/admin/admins')
    const res = await handleAdminRosterPluginsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(superSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'newadmin', platformInstanceId: 'pi-1' }),
      }),
      url,
      '/settings/api/admin/admins',
    )
    expect(res.status).toBe(200)
    expect(listAdmins().some((a) => a.userId === 'newadmin')).toBe(true)
  })

  test('super-admin deletes from the roster (200) and admin is removed', async () => {
    const url = new URL('https://x/settings/api/admin/admins')
    const before = listAdmins().some((a) => a.userId === 'ba-1')
    assert(before, 'ba-1 should be an admin before delete')
    const res = await handleAdminRosterPluginsRoutes(
      new Request(url, {
        method: 'DELETE',
        headers: { ...authHeaders(superSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'ba-1', platformInstanceId: 'pi-1' }),
      }),
      url,
      '/settings/api/admin/admins',
    )
    expect(res.status).toBe(200)
    expect(listAdmins().some((a) => a.userId === 'ba-1')).toBe(false)
  })

  test('roster POST without CSRF token returns 403', async () => {
    const url = new URL('https://x/settings/api/admin/admins')
    const res = await handleAdminRosterPluginsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(superSession, false), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'newadmin', platformInstanceId: 'pi-1' }),
      }),
      url,
      '/settings/api/admin/admins',
    )
    expect(res.status).toBe(403)
  })

  test('plugin approval as SA activates a discovered provider plugin immediately', async () => {
    const plugin = makeRuntimeProviderPlugin('runtime-provider')
    pluginRegistry.registerDiscovered(plugin)
    const url = new URL('https://x/settings/api/admin/plugin-approval')
    const res = await handleAdminRosterPluginsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(superSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: 'test-plugin', action: 'approve' }),
      }),
      url,
      '/settings/api/admin/plugin-approval',
    )
    expect(res.status).toBe(200)
    const body = z.object({ ok: z.boolean(), state: z.string() }).parse(await res.json())
    expect(body.state).toBe('active')
    expect(pluginRegistry.getEntry('test-plugin')?.state).toBe('active')
    expect(getTaskProviderDescriptor('runtime-provider')).toBeDefined()
    expect(getActivatedPluginIds()).toContain('test-plugin')
  })

  test('plugin reject as SA deactivates an active provider plugin immediately', async () => {
    const plugin = makeRuntimeProviderPlugin('runtime-provider')
    pluginRegistry.registerDiscovered(plugin)
    pluginRegistry.approve(plugin.manifest.id, 'admin', plugin.manifestHash)
    await activatePlugins([plugin])
    expect(pluginRegistry.getEntry('test-plugin')?.state).toBe('active')
    expect(getTaskProviderDescriptor('runtime-provider')).toBeDefined()

    const url = new URL('https://x/settings/api/admin/plugin-approval')
    const res = await handleAdminRosterPluginsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(superSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: 'test-plugin', action: 'reject' }),
      }),
      url,
      '/settings/api/admin/plugin-approval',
    )

    expect(res.status).toBe(200)
    const body = z.object({ ok: z.boolean(), state: z.string() }).parse(await res.json())
    expect(body.state).toBe('rejected')
    expect(pluginRegistry.getEntry('test-plugin')?.state).toBe('rejected')
    expect(getTaskProviderDescriptor('runtime-provider')).toBeUndefined()
    expect(getActivatedPluginIds()).not.toContain('test-plugin')
  })

  test('plugin approval as non-SA bot-admin returns 403', async () => {
    pluginRegistry.registerDiscovered(makePlugin())
    const url = new URL('https://x/settings/api/admin/plugin-approval')
    const res = await handleAdminRosterPluginsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(botAdminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: 'test-plugin', action: 'approve' }),
      }),
      url,
      '/settings/api/admin/plugin-approval',
    )
    expect(res.status).toBe(403)
  })

  test('plugin approval for unknown plugin returns 422', async () => {
    const url = new URL('https://x/settings/api/admin/plugin-approval')
    const res = await handleAdminRosterPluginsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(superSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: 'no-such-plugin', action: 'approve' }),
      }),
      url,
      '/settings/api/admin/plugin-approval',
    )
    expect(res.status).toBe(422)
    const body = z.object({ error: z.string() }).parse(await res.json())
    expect(body.error).toBe('unknown plugin')
  })

  test('announce as bot-admin with mock router returns 200 with broadcast counts', async () => {
    addUser({ userId: 'u-extra-1', platformInstanceId: 'pi-1', addedBy: 'sa-1', username: undefined })
    setRuntimeChatRouter(new MockSendRouter())
    const url = new URL('https://x/settings/api/admin/announce')
    const res = await handleAdminRosterPluginsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(botAdminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello everyone' }),
      }),
      url,
      '/settings/api/admin/announce',
    )
    expect(res.status).toBe(200)
    const body = z
      .object({ totalUsers: z.number(), successCount: z.number(), failCount: z.number() })
      .parse(await res.json())
    expect(body.totalUsers).toBeGreaterThanOrEqual(3)
    expect(body.successCount).toBe(body.totalUsers)
    expect(body.failCount).toBe(0)
  })

  test('announce when getRuntimeChatRouter is null returns 422', async () => {
    clearRuntimeChatRouter()
    const url = new URL('https://x/settings/api/admin/announce')
    const res = await handleAdminRosterPluginsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(botAdminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      }),
      url,
      '/settings/api/admin/announce',
    )
    expect(res.status).toBe(422)
    const body = z.object({ error: z.string() }).parse(await res.json())
    expect(body.error).toBe('chat router not running')
  })

  test('announce as non-admin returns 403', async () => {
    addUser({ userId: 'plain-user', platformInstanceId: 'pi-1', addedBy: 'sa-1', username: undefined })
    const plainSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'plain-user' })
    setRuntimeChatRouter(new MockSendRouter())
    const url = new URL('https://x/settings/api/admin/announce')
    const res = await handleAdminRosterPluginsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(plainSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hello' }),
      }),
      url,
      '/settings/api/admin/announce',
    )
    expect(res.status).toBe(403)
  })
})
