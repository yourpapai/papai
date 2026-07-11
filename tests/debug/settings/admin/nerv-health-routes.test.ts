// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import {
  handleAdminNervHealthRoutes,
  probeNervHealth,
} from '../../../../src/debug/settings/admin/nerv-health-routes.js'
import { addAdmin } from '../../../../src/instances/admin-store.js'
import { setPluginAdminConfig } from '../../../../src/plugins/store.js'
import { addUser } from '../../../../src/users.js'
import {
  mockLogger,
  restoreFetch,
  seedTestPlatformInstance,
  setMockFetch,
  setupTestDb,
} from '../../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from '../helpers.js'

const NervHealthResponseSchema = z.object({ status: z.enum(['connected', 'misconfigured', 'unreachable']) })

describe('settings admin nerv-health routes', () => {
  let adminSession: SettingsSession
  let userSession: SettingsSession

  beforeEach(async () => {
    mockLogger()
    process.env['INSTANCE_CONFIG_KEY'] = 'e'.repeat(64)
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'admin-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    addUser({ userId: 'user-1', platformInstanceId: 'pi-1', addedBy: 'admin-1', username: undefined })
    addAdmin('admin-1', 'pi-1')
    adminSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'admin-1' })
    userSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'user-1' })
  })

  afterEach(() => {
    restoreFetch()
  })

  test('non-admin cannot read nerv health', async () => {
    const url = new URL('https://x/settings/api/admin/nerv-health')
    const res = await handleAdminNervHealthRoutes(
      new Request(url, { headers: authHeaders(userSession) }),
      url,
      url.pathname,
    )
    expect(res.status).toBe(403)
  })

  test('unauthenticated request returns 401', async () => {
    const url = new URL('https://x/settings/api/admin/nerv-health')
    const res = await handleAdminNervHealthRoutes(new Request(url), url, url.pathname)
    expect(res.status).toBe(401)
  })

  test('unsupported method returns 405', async () => {
    const url = new URL('https://x/settings/api/admin/nerv-health')
    const res = await handleAdminNervHealthRoutes(
      new Request(url, { method: 'POST', headers: authHeaders(adminSession) }),
      url,
      url.pathname,
    )
    expect(res.status).toBe(405)
  })

  test('returns misconfigured when nerv admin config is unset', async () => {
    const url = new URL('https://x/settings/api/admin/nerv-health')
    const res = await handleAdminNervHealthRoutes(
      new Request(url, { headers: authHeaders(adminSession) }),
      url,
      url.pathname,
    )
    expect(res.status).toBe(200)
    const body = NervHealthResponseSchema.parse(await res.json())
    expect(body.status).toBe('misconfigured')
  })

  test('returns connected when nerv responds 200 to /health', async () => {
    setPluginAdminConfig('nerv', 'nerv_base_url', 'http://nerv:9000', 'admin-1')
    setPluginAdminConfig('nerv', 'nerv_token', 'tok', 'admin-1')
    setMockFetch(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })))
    const url = new URL('https://x/settings/api/admin/nerv-health')
    const res = await handleAdminNervHealthRoutes(
      new Request(url, { headers: authHeaders(adminSession) }),
      url,
      url.pathname,
    )
    expect(res.status).toBe(200)
    const body = NervHealthResponseSchema.parse(await res.json())
    expect(body.status).toBe('connected')
  })

  test('returns unreachable when nerv responds non-2xx', async () => {
    setPluginAdminConfig('nerv', 'nerv_base_url', 'http://nerv:9000', 'admin-1')
    setPluginAdminConfig('nerv', 'nerv_token', 'tok', 'admin-1')
    setMockFetch(() => Promise.resolve(new Response('', { status: 503 })))
    const url = new URL('https://x/settings/api/admin/nerv-health')
    const res = await handleAdminNervHealthRoutes(
      new Request(url, { headers: authHeaders(adminSession) }),
      url,
      url.pathname,
    )
    const body = NervHealthResponseSchema.parse(await res.json())
    expect(body.status).toBe('unreachable')
  })

  test('returns unreachable when the fetch throws', async () => {
    setPluginAdminConfig('nerv', 'nerv_base_url', 'http://nerv:9000', 'admin-1')
    setPluginAdminConfig('nerv', 'nerv_token', 'tok', 'admin-1')
    setMockFetch(() => Promise.reject(new Error('network down')))
    const url = new URL('https://x/settings/api/admin/nerv-health')
    const res = await handleAdminNervHealthRoutes(
      new Request(url, { headers: authHeaders(adminSession) }),
      url,
      url.pathname,
    )
    const body = NervHealthResponseSchema.parse(await res.json())
    expect(body.status).toBe('unreachable')
  })

  test('probes nerv at {baseUrl}/health with a bearer header, trailing slash stripped', async () => {
    setPluginAdminConfig('nerv', 'nerv_base_url', 'https://nerv.example/', 'admin-1')
    setPluginAdminConfig('nerv', 'nerv_token', 'secret-tok', 'admin-1')
    const captured: { url: string; init: RequestInit }[] = []
    setMockFetch((fetchUrl, init) => {
      captured.push({ url: fetchUrl, init })
      return Promise.resolve(new Response('', { status: 200 }))
    })
    const status = await probeNervHealth()
    expect(status).toBe('connected')
    expect(captured).toHaveLength(1)
    expect(captured[0]?.url).toBe('https://nerv.example/health')
    const headers = new Headers(captured[0]?.init.headers)
    expect(headers.get('Authorization')).toBe('Bearer secret-tok')
  })
})
