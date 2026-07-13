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
import { contributionRegistry } from '../../../../src/plugins/contributions.js'
import {
  activatePlugins,
  deactivateAllPlugins,
  deactivatePluginById,
  getActivatedPluginIds,
} from '../../../../src/plugins/loader.js'
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

const tempDirs: string[] = []

function writeTempPluginModule(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'papai-admin-plugin-approval-'))
  tempDirs.push(dir)
  const modulePath = join(dir, 'index.mjs')
  writeFileSync(modulePath, source)
  return modulePath
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
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
        attachmentTransformers: [],
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

function makeHttpLifecyclePlugin(id: string, owner: string): DiscoveredPlugin {
  const entryPoint = writeTempPluginModule(`
    export default function createPlugin() {
      return {
        activate(ctx) {
          ctx.registration.registerPromptFragment({ name: 'owner', content: '${owner}' })
          return ctx.providerRuntime.httpFetch('https://api.example.com/${owner}/activate')
        },
        deactivate(ctx) {
          return ctx.providerRuntime.httpFetch('https://api.example.com/${owner}/deactivate')
        },
      }
    }
  `)
  const base = makePlugin()
  return makePlugin({
    entryPoint,
    pluginDir: dirname(entryPoint),
    manifest: {
      ...base.manifest,
      id,
      permissions: ['http'],
      providerAllowedHosts: ['api.example.com'],
      contributes: { ...base.manifest.contributes, promptFragments: ['owner'] },
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

  test('plugin approval owns the request-scoped HTTP dependencies through deactivation', async () => {
    const entryPoint = writeTempPluginModule(`
      export default function createPlugin() {
        return {
          activate(ctx) { return ctx.providerRuntime.httpFetch('https://api.example.com/activate') },
          deactivate(ctx) { return ctx.providerRuntime.httpFetch('https://api.example.com/deactivate') },
        }
      }
    `)
    const plugin = makePlugin({
      entryPoint,
      pluginDir: dirname(entryPoint),
      manifest: {
        ...makePlugin().manifest,
        permissions: ['http'],
        providerAllowedHosts: ['api.example.com'],
      },
    })
    pluginRegistry.registerDiscovered(plugin)
    const urls: string[] = []
    const options = {
      pluginProviderRuntimeDeps: {
        fetch: (url: string): Promise<Response> => {
          urls.push(url)
          return Promise.resolve(new Response('owned'))
        },
        assertPublicUrl: (): Promise<void> => Promise.resolve(),
      },
    }
    const url = new URL('https://x/settings/api/admin/plugin-approval')
    const request = (action: 'approve' | 'reject'): Request =>
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(superSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: plugin.manifest.id, action }),
      })

    const approved = await handleAdminRosterPluginsRoutes(
      request('approve'),
      url,
      '/settings/api/admin/plugin-approval',
      options,
    )
    const rejected = await handleAdminRosterPluginsRoutes(
      request('reject'),
      url,
      '/settings/api/admin/plugin-approval',
      options,
    )

    expect(approved.status).toBe(200)
    expect(rejected.status).toBe(200)
    expect(urls).toEqual(['https://api.example.com/activate', 'https://api.example.com/deactivate'])
  })

  test('concurrent plugin reject waits for approval activation and leaves the plugin rejected', async () => {
    const entryPoint = writeTempPluginModule(`
      export default function createPlugin() {
        return {
          activate(ctx) { return ctx.providerRuntime.httpFetch('https://api.example.com/activate') },
          deactivate(ctx) { return ctx.providerRuntime.httpFetch('https://api.example.com/deactivate') },
        }
      }
    `)
    const plugin = makePlugin({
      entryPoint,
      pluginDir: dirname(entryPoint),
      manifest: {
        ...makePlugin().manifest,
        permissions: ['http'],
        providerAllowedHosts: ['api.example.com'],
      },
    })
    pluginRegistry.registerDiscovered(plugin)
    const activationStarted = deferred<true>()
    const activationResponse = deferred<Response>()
    const urls: string[] = []
    const responses = [activationResponse.promise, Promise.resolve(new Response('deactivated'))]
    const options = {
      pluginProviderRuntimeDeps: {
        fetch: (url: string): Promise<Response> => {
          urls.push(url)
          activationStarted.resolve(true)
          const response = responses.shift()
          assert(response !== undefined, 'unexpected plugin lifecycle request')
          return response
        },
        assertPublicUrl: (): Promise<void> => Promise.resolve(),
      },
    }
    const url = new URL('https://x/settings/api/admin/plugin-approval')
    const request = (action: 'approve' | 'reject'): Request =>
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(superSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: plugin.manifest.id, action }),
      })

    const approval = handleAdminRosterPluginsRoutes(
      request('approve'),
      url,
      '/settings/api/admin/plugin-approval',
      options,
    )
    await activationStarted.promise
    const rejection = handleAdminRosterPluginsRoutes(
      request('reject'),
      url,
      '/settings/api/admin/plugin-approval',
      options,
    )
    activationResponse.resolve(new Response('activated'))
    const [approvedResponse, rejectedResponse] = await Promise.all([approval, rejection])

    expect(approvedResponse.status).toBe(200)
    expect(rejectedResponse.status).toBe(200)
    expect(urls).toEqual(['https://api.example.com/activate', 'https://api.example.com/deactivate'])
    expect(pluginRegistry.getEntry(plugin.manifest.id)?.state).toBe('rejected')
    expect(getActivatedPluginIds()).not.toContain(plugin.manifest.id)
  })

  test('queued teardown removes the old owner before concurrent approval activates its replacement', async () => {
    const oldPlugin = makeHttpLifecyclePlugin('test-plugin', 'old-owner')
    pluginRegistry.registerDiscovered(oldPlugin)
    pluginRegistry.approve(oldPlugin.manifest.id, 'admin', oldPlugin.manifestHash)
    const sequence: string[] = []
    const oldUrls: string[] = []
    const oldEvents = ['old-activate', 'old-deactivate']
    await activatePlugins([oldPlugin], {
      providerRuntimeDeps: {
        fetch: (url: string): Promise<Response> => {
          oldUrls.push(url)
          const event = oldEvents.shift()
          assert(event !== undefined, 'unexpected old owner lifecycle request')
          sequence.push(event)
          return Promise.resolve(new Response('old'))
        },
        assertPublicUrl: (): Promise<void> => Promise.resolve(),
      },
    })
    const blocker = makeHttpLifecyclePlugin('queue-blocker', 'blocker')
    pluginRegistry.registerDiscovered(blocker)
    pluginRegistry.approve(blocker.manifest.id, 'admin', blocker.manifestHash)
    const blockerStarted = deferred<true>()
    const blockerResponse = deferred<Response>()
    const blockerResponses = [blockerResponse.promise, Promise.resolve(new Response('blocker-deactivated'))]
    const blockerActivation = activatePlugins([blocker], {
      providerRuntimeDeps: {
        fetch: (): Promise<Response> => {
          blockerStarted.resolve(true)
          const response = blockerResponses.shift()
          assert(response !== undefined, 'unexpected blocker lifecycle request')
          return response
        },
        assertPublicUrl: (): Promise<void> => Promise.resolve(),
      },
    })
    await blockerStarted.promise

    const replacement = makeHttpLifecyclePlugin('test-plugin', 'new-owner')
    pluginRegistry.registerDiscovered(replacement)
    const teardown = deactivateAllPlugins()
    const newUrls: string[] = []
    const newEvents = ['new-activate', 'new-deactivate']
    const url = new URL('https://x/settings/api/admin/plugin-approval')
    const approval = handleAdminRosterPluginsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(superSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: replacement.manifest.id, action: 'approve' }),
      }),
      url,
      '/settings/api/admin/plugin-approval',
      {
        pluginProviderRuntimeDeps: {
          fetch: (requestUrl: string): Promise<Response> => {
            newUrls.push(requestUrl)
            const event = newEvents.shift()
            assert(event !== undefined, 'unexpected new owner lifecycle request')
            sequence.push(event)
            return Promise.resolve(new Response('new'))
          },
          assertPublicUrl: (): Promise<void> => Promise.resolve(),
        },
      },
    )
    blockerResponse.resolve(new Response('blocker-activated'))
    const [, , approvalResponse] = await Promise.all([blockerActivation, teardown, approval])

    expect(approvalResponse.status).toBe(200)
    expect(sequence).toEqual(['old-activate', 'old-deactivate', 'new-activate'])
    expect(oldUrls).toEqual([
      'https://api.example.com/old-owner/activate',
      'https://api.example.com/old-owner/deactivate',
    ])
    expect(getActivatedPluginIds()).toEqual([replacement.manifest.id])
    expect(contributionRegistry.getContributions(replacement.manifest.id)?.promptFragments).toEqual([
      { name: 'owner', content: 'new-owner' },
    ])
    await deactivateAllPlugins()
    expect(newUrls).toEqual([
      'https://api.example.com/new-owner/activate',
      'https://api.example.com/new-owner/deactivate',
    ])
  })

  test('reject then approve race deactivates the old owner once and leaves one active replacement', async () => {
    const oldPlugin = makeHttpLifecyclePlugin('test-plugin', 'reverse-old')
    pluginRegistry.registerDiscovered(oldPlugin)
    pluginRegistry.approve(oldPlugin.manifest.id, 'admin', oldPlugin.manifestHash)
    const oldUrls: string[] = []
    await activatePlugins([oldPlugin], {
      providerRuntimeDeps: {
        fetch: (url: string): Promise<Response> => {
          oldUrls.push(url)
          return Promise.resolve(new Response('old'))
        },
        assertPublicUrl: (): Promise<void> => Promise.resolve(),
      },
    })
    const blocker = makeHttpLifecyclePlugin('reverse-blocker', 'reverse-blocker')
    pluginRegistry.registerDiscovered(blocker)
    pluginRegistry.approve(blocker.manifest.id, 'admin', blocker.manifestHash)
    const blockerStarted = deferred<true>()
    const blockerResponse = deferred<Response>()
    const blockerActivation = activatePlugins([blocker], {
      providerRuntimeDeps: {
        fetch: (): Promise<Response> => {
          blockerStarted.resolve(true)
          return blockerResponse.promise
        },
        assertPublicUrl: (): Promise<void> => Promise.resolve(),
      },
    })
    await blockerStarted.promise

    const replacement = makeHttpLifecyclePlugin('test-plugin', 'reverse-new')
    pluginRegistry.registerDiscovered(replacement)
    const rejection = deactivatePluginById(oldPlugin.manifest.id).then(() => {
      pluginRegistry.reject(oldPlugin.manifest.id)
    })
    const newUrls: string[] = []
    const url = new URL('https://x/settings/api/admin/plugin-approval')
    const approval = handleAdminRosterPluginsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(superSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: replacement.manifest.id, action: 'approve' }),
      }),
      url,
      '/settings/api/admin/plugin-approval',
      {
        pluginProviderRuntimeDeps: {
          fetch: (requestUrl: string): Promise<Response> => {
            newUrls.push(requestUrl)
            return Promise.resolve(new Response('new'))
          },
          assertPublicUrl: (): Promise<void> => Promise.resolve(),
        },
      },
    )
    blockerResponse.resolve(new Response('blocker-activated'))
    await Promise.all([blockerActivation, rejection, approval])

    expect(oldUrls).toEqual([
      'https://api.example.com/reverse-old/activate',
      'https://api.example.com/reverse-old/deactivate',
    ])
    expect(newUrls).toEqual(['https://api.example.com/reverse-new/activate'])
    expect(getActivatedPluginIds().filter((id) => id === replacement.manifest.id)).toEqual([replacement.manifest.id])
    expect(contributionRegistry.getContributions(replacement.manifest.id)?.promptFragments).toEqual([
      { name: 'owner', content: 'reverse-new' },
    ])
    await deactivateAllPlugins()
    expect(oldUrls).toHaveLength(2)
    expect(newUrls).toEqual([
      'https://api.example.com/reverse-new/activate',
      'https://api.example.com/reverse-new/deactivate',
    ])
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
