// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { SESSION_COOKIE_NAME } from '../../src/dashboard-auth/cookie.js'
import { mintSession } from '../../src/dashboard-auth/index.js'
import { setStoreDb } from '../../src/dashboard-auth/store.js'
import { migration046DashboardSessions } from '../../src/db/migrations/046_dashboard_sessions.js'
import { __routeRequestForTest } from '../../src/debug/server.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('debug server auth (session-only)', () => {
  let db: Database
  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
    migration046DashboardSessions.up(db)
    setStoreDb(db)
  })
  afterEach(() => {
    db.close()
    setStoreDb(null)
  })

  test('returns 401 with no cookie', async () => {
    const res = await __routeRequestForTest(new Request('http://localhost/events'))
    expect(res.status).toBe(401)
  })

  test('returns 401 with an unknown cookie value', async () => {
    const res = await __routeRequestForTest(
      new Request('http://localhost/events', { headers: { Cookie: `${SESSION_COOKIE_NAME}=ffff` } }),
    )
    expect(res.status).toBe(401)
  })

  test('accepts a minted session cookie', async () => {
    const { cookieValue } = mintSession('admin-1', { secure: false })
    const res = await __routeRequestForTest(
      new Request('http://localhost/logs/stats', { headers: { Cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` } }),
    )
    expect(res.status).toBe(200)
  })

  test('rejects bearer header (DEBUG_TOKEN no longer accepted)', async () => {
    process.env['DEBUG_TOKEN'] = 'legacy'
    const res = await __routeRequestForTest(
      new Request('http://localhost/logs/stats', { headers: { Authorization: 'Bearer legacy' } }),
    )
    expect(res.status).toBe(401)
    delete process.env['DEBUG_TOKEN']
  })
})
