// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { addAuthorizedGroup } from '../../src/authorized-groups.js'
import { SESSION_COOKIE_NAME } from '../../src/dashboard-auth/cookie.js'
import { mintSession } from '../../src/dashboard-auth/index.js'
import { setStoreDb } from '../../src/dashboard-auth/store.js'
import { migration047DashboardSessions } from '../../src/db/migrations/047_dashboard_sessions.js'
import { routeRequestForTest } from '../../src/debug/server.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const RevokeResponseSchema = z.object({ removed: z.boolean() })

describe('DELETE /auth/groups/:id', () => {
  let sessionDb: Database

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    sessionDb = new Database(':memory:')
    migration047DashboardSessions.up(sessionDb)
    setStoreDb(sessionDb)
  })

  afterEach(() => {
    sessionDb.close()
    setStoreDb(null)
  })

  test('returns 401 without a session cookie', async () => {
    const res = await routeRequestForTest(new Request('http://localhost/auth/groups/some-group', { method: 'DELETE' }))
    expect(res.status).toBe(401)
  })

  test('removes an existing group and returns 200', async () => {
    addAuthorizedGroup('group-alpha', 'admin-1')
    const { cookieValue } = mintSession('admin-1', { secure: false })

    const res = await routeRequestForTest(
      new Request('http://localhost/auth/groups/group-alpha', {
        method: 'DELETE',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
      }),
    )

    expect(res.status).toBe(200)
    const body = RevokeResponseSchema.parse(await res.json())
    expect(body).toEqual({ removed: true })
  })

  test('returns 200 with removed:false when group does not exist', async () => {
    const { cookieValue } = mintSession('admin-1', { secure: false })

    const res = await routeRequestForTest(
      new Request('http://localhost/auth/groups/nonexistent-group', {
        method: 'DELETE',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
      }),
    )

    expect(res.status).toBe(200)
    const body = RevokeResponseSchema.parse(await res.json())
    expect(body).toEqual({ removed: false })
  })

  test('decodes URL-encoded group ids correctly', async () => {
    addAuthorizedGroup('group:encoded/id', 'admin-1')
    const { cookieValue } = mintSession('admin-1', { secure: false })

    const res = await routeRequestForTest(
      new Request(`http://localhost/auth/groups/${encodeURIComponent('group:encoded/id')}`, {
        method: 'DELETE',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
      }),
    )

    expect(res.status).toBe(200)
    const body = RevokeResponseSchema.parse(await res.json())
    expect(body).toEqual({ removed: true })
  })

  test('GET /auth/groups still returns 405 when method is not GET or DELETE', async () => {
    const { cookieValue } = mintSession('admin-1', { secure: false })

    const res = await routeRequestForTest(
      new Request('http://localhost/auth/groups/some-group', {
        method: 'POST',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
      }),
    )

    expect(res.status).toBe(405)
  })
})
