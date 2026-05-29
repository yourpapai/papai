// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { handlePluginsRoutes } from '../../../src/debug/settings/plugins-routes.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

describe('settings plugins routes', () => {
  let session: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
  })

  test('GET returns a plugins array (empty when none discovered)', async () => {
    const url = new URL('https://x/settings/api/plugins')
    const res = await handlePluginsRoutes(
      new Request(url, { headers: authHeaders(session) }),
      url,
      '/settings/api/plugins',
    )
    expect(res.status).toBe(200)
    const body = z.object({ plugins: z.array(z.unknown()) }).parse(await res.json())
    expect(Array.isArray(body.plugins)).toBe(true)
  })

  test('toggle of an unknown plugin returns 422', async () => {
    const url = new URL('https://x/settings/api/plugins/toggle')
    const res = await handlePluginsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: 'ghost', enabled: true }),
      }),
      url,
      '/settings/api/plugins/toggle',
    )
    expect(res.status).toBe(422)
  })
})
