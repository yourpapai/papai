// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { getConfigValue } from '../../../src/config.js'
import { handleConfigRoutes } from '../../../src/debug/settings/config-routes.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const GetResponseSchema = z.object({ fields: z.array(z.object({ key: z.string(), sensitive: z.boolean() })) })
const PatchResponseSchema = z.object({ contextId: z.string() })

describe('settings config routes', () => {
  let session: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
  })

  test('GET returns field descriptors with masked values', async () => {
    const res = await handleConfigRoutes(
      new Request('https://x/settings/api/config', { headers: authHeaders(session) }),
      new URL('https://x/settings/api/config'),
    )
    expect(res.status).toBe(200)
    const body = GetResponseSchema.parse(await res.json())
    expect(body.fields.some((f) => f.key === 'timezone')).toBe(true)
  })

  test('PATCH validates and persists a field', async () => {
    const req = new Request('https://x/settings/api/config', {
      method: 'PATCH',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'timezone', value: 'America/New_York' }),
    })
    const res = await handleConfigRoutes(req, new URL('https://x/settings/api/config'))
    expect(res.status).toBe(200)
    // Personal scope resolves to the principal's personalConfigContextId; assert via read-back.
    const body = PatchResponseSchema.parse(await res.json())
    expect(getConfigValue(body.contextId, 'timezone')).toBe('America/New_York')
  })

  test('PATCH rejects an invalid value with 422', async () => {
    const req = new Request('https://x/settings/api/config', {
      method: 'PATCH',
      headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'timezone', value: 'Not/AZone' }),
    })
    const res = await handleConfigRoutes(req, new URL('https://x/settings/api/config'))
    expect(res.status).toBe(422)
  })

  test('PATCH without CSRF is 403', async () => {
    const req = new Request('https://x/settings/api/config', {
      method: 'PATCH',
      headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'timezone', value: 'UTC' }),
    })
    const res = await handleConfigRoutes(req, new URL('https://x/settings/api/config'))
    expect(res.status).toBe(403)
  })
})
