// SPDX-License-Identifier: BUSL-1.1
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { handleSupervisedProjectsRoutes } from '../../../src/debug/settings/supervised-projects-routes.js'
import { addAdmin } from '../../../src/instances/admin-store.js'
import { setPluginAdminConfig } from '../../../src/plugins/store.js'
import { addUser } from '../../../src/users.js'
import {
  mockLogger,
  restoreFetch,
  seedTestPlatformInstance,
  setMockFetch,
  setupTestDb,
} from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const PATH = 'https://x/settings/api/supervised-projects'

describe('settings supervised-projects routes', () => {
  let adminSession: SettingsSession

  beforeEach(async () => {
    mockLogger()
    process.env['INSTANCE_CONFIG_KEY'] = 'e'.repeat(64)
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'admin-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    addAdmin('admin-1', 'pi-1')
    adminSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'admin-1' })
  })
  afterEach(() => restoreFetch())

  test('unauthenticated request returns 401', async () => {
    const url = new URL(PATH)
    const res = await handleSupervisedProjectsRoutes(new Request(url), url)
    expect(res.status).toBe(401)
  })

  test('GET returns 422 nerv_not_configured when admin config is unset', async () => {
    const url = new URL(PATH)
    const res = await handleSupervisedProjectsRoutes(new Request(url, { headers: authHeaders(adminSession) }), url)
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'nerv_not_configured' })
  })

  test('GET proxies to nerv and forwards status+data', async () => {
    setPluginAdminConfig('nerv', 'nerv_base_url', 'http://nerv:8080', 'admin-1')
    setPluginAdminConfig('nerv', 'nerv_token', 'tok', 'admin-1')
    const captured: string[] = []
    setMockFetch((fetchUrl) => {
      captured.push(fetchUrl)
      return Promise.resolve(new Response(JSON.stringify({ project: null }), { status: 200 }))
    })
    const url = new URL(PATH)
    const res = await handleSupervisedProjectsRoutes(new Request(url, { headers: authHeaders(adminSession) }), url)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ project: null })
    expect(captured[0]).toContain('/projects/self?contextId=')
  })

  test('PUT forwards a 409 conflict from nerv', async () => {
    setPluginAdminConfig('nerv', 'nerv_base_url', 'http://nerv:8080', 'admin-1')
    setPluginAdminConfig('nerv', 'nerv_token', 'tok', 'admin-1')
    setMockFetch(() =>
      Promise.resolve(new Response(JSON.stringify({ error: 'conflict', projectPath: 's/r' }), { status: 409 })),
    )
    const url = new URL(PATH)
    const res = await handleSupervisedProjectsRoutes(
      new Request(url, {
        method: 'PUT',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ repositories: [{ projectPath: 's/r', repoUrl: 'http://f/s/r.git' }] }),
      }),
      url,
    )
    expect(res.status).toBe(409)
  })

  test('PUT returns 502 when nerv is unreachable', async () => {
    setPluginAdminConfig('nerv', 'nerv_base_url', 'http://nerv:8080', 'admin-1')
    setPluginAdminConfig('nerv', 'nerv_token', 'tok', 'admin-1')
    setMockFetch(() => Promise.reject(new Error('down')))
    const url = new URL(PATH)
    const res = await handleSupervisedProjectsRoutes(
      new Request(url, {
        method: 'PUT',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ repositories: [{ projectPath: 'g/r', repoUrl: 'http://f/g/r.git' }] }),
      }),
      url,
    )
    expect(res.status).toBe(502)
  })
})
