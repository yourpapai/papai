// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { handleIdentityRoutes } from '../../../src/debug/settings/identity-routes.js'
import { setContextSettings } from '../../../src/instances/context-store.js'
import { insertTaskInstance } from '../../../src/instances/task-store.js'
import { resolveSettingsPrincipal } from '../../../src/settings/principal.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

describe('settings identity routes', () => {
  let session: SettingsSession
  let contextId: string

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    insertTaskInstance({ id: 'ti-1', type: 'kaneo', config: {}, status: 'active' })
    contextId = resolveSettingsPrincipal('pi-1', 'u-1').personalConfigContextId
    setContextSettings({ contextId, taskInstanceId: 'ti-1', platformInstanceId: 'pi-1' })
    session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
  })

  test('PUT then GET reflects the manual mapping', async () => {
    const put = await handleIdentityRoutes(
      new Request('https://x/settings/api/identity', {
        method: 'PUT',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerUserId: 'kaneo-42', providerUserLogin: 'me', displayName: 'Me' }),
      }),
      new URL('https://x/settings/api/identity'),
    )
    expect(put.status).toBe(200)

    const get = await handleIdentityRoutes(
      new Request('https://x/settings/api/identity', { headers: authHeaders(session) }),
      new URL('https://x/settings/api/identity'),
    )
    const body = z
      .object({ mapping: z.object({ providerUserId: z.string().nullable() }).nullable() })
      .parse(await get.json())
    expect(body.mapping?.providerUserId).toBe('kaneo-42')
  })

  test('PUT authenticates before parsing the body (no session + bad body → 401)', async () => {
    const res = await handleIdentityRoutes(
      new Request('https://x/settings/api/identity', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      }),
      new URL('https://x/settings/api/identity'),
    )
    expect(res.status).toBe(401)
  })

  test('DELETE clears the mapping', async () => {
    const res = await handleIdentityRoutes(
      new Request('https://x/settings/api/identity', { method: 'DELETE', headers: authHeaders(session, true) }),
      new URL('https://x/settings/api/identity'),
    )
    expect(res.status).toBe(200)
  })
})
