// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { handleAdminInstancesRoutes } from '../../../../src/debug/settings/admin/instances-routes.js'
import { addAdmin } from '../../../../src/instances/admin-store.js'
import { insertTaskInstance } from '../../../../src/instances/task-store.js'
import { addUser } from '../../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from '../helpers.js'

const InstanceListResponseSchema = z.object({
  instances: z.array(z.object({ config: z.record(z.string(), z.string()) })),
})

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
})
