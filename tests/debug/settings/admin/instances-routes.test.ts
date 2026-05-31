// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { z } from 'zod'

import { handleAdminInstancesRoutes } from '../../../../src/debug/settings/admin/instances-routes.js'
import { addAdmin } from '../../../../src/instances/admin-store.js'
import { getTaskInstance, insertTaskInstance } from '../../../../src/instances/task-store.js'
import { addUser } from '../../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from '../helpers.js'

const InstanceListResponseSchema = z.object({
  instances: z.array(z.object({ config: z.record(z.string(), z.string()) })),
})

const ProviderTypesResponseSchema = z.object({
  providerTypes: z.array(z.unknown()),
})

const CreatedResponseSchema = z.object({ ok: z.literal(true), id: z.string() })

describe('settings admin instances routes', () => {
  let adminSession: SettingsSession
  let userSession: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'admin-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    addUser({ userId: 'user-1', platformInstanceId: 'pi-1', addedBy: 'admin-1', username: undefined })
    addAdmin('admin-1', 'pi-1')
    insertTaskInstance({ id: 'ti-1', type: 'kaneo', config: { kaneo_apikey: 'secret-value' }, status: 'active' })
    adminSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'admin-1' })
    userSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'user-1' })
  })

  test('non-admin gets 403', async () => {
    const url = new URL('https://x/settings/api/admin/task-instances')
    const res = await handleAdminInstancesRoutes(
      new Request(url, { headers: authHeaders(userSession) }),
      url,
      '/settings/api/admin/task-instances',
    )
    expect(res.status).toBe(403)
  })

  test('admin lists task instances with masked config', async () => {
    const url = new URL('https://x/settings/api/admin/task-instances')
    const res = await handleAdminInstancesRoutes(
      new Request(url, { headers: authHeaders(adminSession) }),
      url,
      '/settings/api/admin/task-instances',
    )
    expect(res.status).toBe(200)
    const body = InstanceListResponseSchema.parse(await res.json())
    expect(body.instances[0]?.config['kaneo_apikey']).not.toBe('secret-value')
  })

  test('non-admin POST task-instances gets 403', async () => {
    const url = new URL('https://x/settings/api/admin/task-instances')
    const res = await handleAdminInstancesRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(userSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'ti-x', type: 'kaneo', config: {}, status: 'active' }),
      }),
      url,
      '/settings/api/admin/task-instances',
    )
    expect(res.status).toBe(403)
  })

  test('admin POST task-instances without CSRF gets 403', async () => {
    const url = new URL('https://x/settings/api/admin/task-instances')
    const res = await handleAdminInstancesRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, false), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'ti-new', type: 'kaneo', config: {}, status: 'active' }),
      }),
      url,
      '/settings/api/admin/task-instances',
    )
    expect(res.status).toBe(403)
  })

  test('admin POST task-instances with CSRF creates instance', async () => {
    const url = new URL('https://x/settings/api/admin/task-instances')
    const res = await handleAdminInstancesRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'ti-new', type: 'kaneo', config: {}, status: 'active' }),
      }),
      url,
      '/settings/api/admin/task-instances',
    )
    expect(res.status).toBe(201)
    const body = CreatedResponseSchema.parse(await res.json())
    expect(body.id).toBe('ti-new')
    const stored = getTaskInstance('ti-new')
    assert(stored !== null, 'task instance should be persisted')
    expect(stored.type).toBe('kaneo')
  })

  test('admin GET task-provider-types returns 200 with providerTypes array', async () => {
    const url = new URL('https://x/settings/api/admin/task-provider-types')
    const res = await handleAdminInstancesRoutes(
      new Request(url, { headers: authHeaders(adminSession) }),
      url,
      '/settings/api/admin/task-provider-types',
    )
    expect(res.status).toBe(200)
    const body = ProviderTypesResponseSchema.parse(await res.json())
    expect(Array.isArray(body.providerTypes)).toBe(true)
  })

  test('non-admin GET task-provider-types gets 403', async () => {
    const url = new URL('https://x/settings/api/admin/task-provider-types')
    const res = await handleAdminInstancesRoutes(
      new Request(url, { headers: authHeaders(userSession) }),
      url,
      '/settings/api/admin/task-provider-types',
    )
    expect(res.status).toBe(403)
  })

  test('admin POST task-provider-types gets 405', async () => {
    const url = new URL('https://x/settings/api/admin/task-provider-types')
    const res = await handleAdminInstancesRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      url,
      '/settings/api/admin/task-provider-types',
    )
    expect(res.status).toBe(405)
  })
})
