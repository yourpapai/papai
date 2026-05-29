// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { handleAdminSystemAccessRoutes } from '../../../../src/debug/settings/admin/system-access-routes.js'
import { addAdmin } from '../../../../src/instances/admin-store.js'
import { addUser, listUsers } from '../../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from '../helpers.js'

describe('settings admin system/access routes', () => {
  let adminSession: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'admin-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    addAdmin('admin-1', 'pi-1')
    adminSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'admin-1' })
  })

  test('GET system returns an LLM snapshot with masked api key', async () => {
    const url = new URL('https://x/settings/api/admin/system')
    const res = await handleAdminSystemAccessRoutes(
      new Request(url, { headers: authHeaders(adminSession) }),
      url,
      '/settings/api/admin/system',
    )
    expect(res.status).toBe(200)
    const body = z.object({ config: z.record(z.string(), z.unknown()) }).parse(await res.json())
    expect(body.config).toBeDefined()
  })

  test('POST users adds an authorized user', async () => {
    const url = new URL('https://x/settings/api/admin/users')
    const res = await handleAdminSystemAccessRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(adminSession, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'newbie' }),
      }),
      url,
      '/settings/api/admin/users',
    )
    expect(res.status).toBe(200)
    expect(listUsers('pi-1').some((u) => u.platform_user_id === 'newbie')).toBe(true)
  })
})
