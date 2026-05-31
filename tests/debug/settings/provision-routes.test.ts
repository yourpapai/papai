// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { handleProvisionKaneo } from '../../../src/debug/settings/provision-routes.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

describe('settings kaneo provision route', () => {
  let session: SettingsSession
  const originalUrl = process.env['KANEO_CLIENT_URL']

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
    delete process.env['KANEO_CLIENT_URL']
  })

  afterEach(() => {
    process.env['KANEO_CLIENT_URL'] = originalUrl
  })

  test('non-POST returns 405', async () => {
    const res = await handleProvisionKaneo(new Request('https://x/settings/api/provision/kaneo', { method: 'GET' }))
    expect(res.status).toBe(405)
  })

  test('returns 422 when no Kaneo public URL is configured', async () => {
    const res = await handleProvisionKaneo(
      new Request('https://x/settings/api/provision/kaneo', {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(422)
  })

  test('POST without CSRF is 403', async () => {
    const res = await handleProvisionKaneo(
      new Request('https://x/settings/api/provision/kaneo', {
        method: 'POST',
        headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(403)
  })
})
