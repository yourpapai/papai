// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { handleAdminRosterPluginsRoutes } from '../../../../src/debug/settings/admin/roster-plugins-routes.js'
import { addAdmin, listAdmins, SUPER_ADMIN_PLATFORM_ID } from '../../../../src/instances/admin-store.js'
import { addUser } from '../../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from '../helpers.js'

describe('settings admin roster/plugins routes', () => {
  let superSession: SettingsSession
  let botAdminSession: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'sa-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    addUser({ userId: 'ba-1', platformInstanceId: 'pi-1', addedBy: 'sa-1', username: undefined })
    addAdmin('sa-1', SUPER_ADMIN_PLATFORM_ID)
    addAdmin('ba-1', 'pi-1')
    superSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'sa-1' })
    botAdminSession = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'ba-1' })
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
})
