// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { SESSION_COOKIE_NAME } from '../../src/dashboard-auth/cookie.js'
import { mintSession } from '../../src/dashboard-auth/index.js'
import { setStoreDb } from '../../src/dashboard-auth/store.js'
import { migration047DashboardSessions } from '../../src/db/migrations/047_dashboard_sessions.js'
import { routeRequestForTest } from '../../src/debug/server.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('write routes accept the session cookie (no DEBUG_TOKEN)', () => {
  let db: Database
  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
    migration047DashboardSessions.up(db)
    setStoreDb(db)
    delete process.env['DEBUG_TOKEN']
  })
  afterEach(() => {
    db.close()
    setStoreDb(null)
  })

  test('POST /admin/llm with valid cookie is not blocked by missing DEBUG_TOKEN', async () => {
    const { cookieValue } = mintSession('u1', { secure: false })
    const res = await routeRequestForTest(
      new Request('http://localhost/admin/llm', {
        method: 'POST',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${cookieValue}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    // Whatever the body validation says, it must NOT be 401 with a "DEBUG_TOKEN" message.
    expect(res.status).not.toBe(401)
  })

  test('POST /admin/plugin-config with valid cookie is not 401', async () => {
    const { cookieValue } = mintSession('u1', { secure: false })
    const res = await routeRequestForTest(
      new Request('http://localhost/admin/plugin-config', {
        method: 'POST',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${cookieValue}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).not.toBe(401)
  })

  test('POST /api/platform-instances rejects without cookie', async () => {
    const res = await routeRequestForTest(new Request('http://localhost/api/platform-instances', { method: 'POST' }))
    expect(res.status).toBe(401)
  })
})
