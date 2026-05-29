// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { handleToolsRoutes } from '../../../src/debug/settings/tools-routes.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const DomainsResponseSchema = z.object({ domains: z.array(z.unknown()) })

describe('settings tools routes', () => {
  let session: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
  })

  test('GET returns domains array (empty when no provider configured)', async () => {
    const url = new URL('https://x/settings/api/tools')
    const res = await handleToolsRoutes(new Request(url, { headers: authHeaders(session) }), url, '/settings/api/tools')
    expect(res.status).toBe(200)
    const body = DomainsResponseSchema.parse(await res.json())
    expect(Array.isArray(body.domains)).toBe(true)
  })

  test('toggle without CSRF is 403', async () => {
    const url = new URL('https://x/settings/api/tools/toggle')
    const res = await handleToolsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'domain', domain: 'task' }),
      }),
      url,
      '/settings/api/tools/toggle',
    )
    expect(res.status).toBe(403)
  })

  test('toggle rejects an unknown domain with 422', async () => {
    const url = new URL('https://x/settings/api/tools/toggle')
    const res = await handleToolsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'domain', domain: 'not-a-domain' }),
      }),
      url,
      '/settings/api/tools/toggle',
    )
    expect(res.status).toBe(422)
  })
})
