// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { SESSION_COOKIE_NAME } from '../../src/dashboard-auth/cookie.js'
import { issueClaim, mintSession } from '../../src/dashboard-auth/index.js'
import { setStoreDb } from '../../src/dashboard-auth/store.js'
import { migration047DashboardSessions } from '../../src/db/migrations/047_dashboard_sessions.js'
import { routeRequestForTest } from '../../src/debug/server.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('/auth/* routes', () => {
  let db: Database
  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
    migration047DashboardSessions.up(db)
    setStoreDb(db)
  })
  afterEach(() => {
    db.close()
    setStoreDb(null)
  })

  const claimConfirm = (nonce: string): Request =>
    new Request('http://localhost/auth/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ n: nonce }).toString(),
    })

  test('GET /auth/claim renders an HTML form without consuming the nonce', async () => {
    const { nonce } = issueClaim('u1', 'p1')
    const res = await routeRequestForTest(new Request(`http://localhost/auth/claim?n=${nonce}`))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/html')
    // Claim survives the GET: the POST still succeeds.
    const confirm = await routeRequestForTest(claimConfirm(nonce))
    expect(confirm.status).toBe(302)
  })

  test('POST /auth/claim consumes a nonce, sets cookie, redirects to /debug', async () => {
    const { nonce } = issueClaim('u1', 'p1')
    const res = await routeRequestForTest(claimConfirm(nonce))
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/debug')
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
    const setCookie = res.headers.get('Set-Cookie')
    expect(setCookie).not.toBeNull()
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Strict')
  })

  test('POST /auth/claim rejects unknown nonce with 401', async () => {
    const res = await routeRequestForTest(claimConfirm('deadbeef'))
    expect(res.status).toBe(401)
  })

  test('POST /auth/claim rejects a replayed nonce', async () => {
    const { nonce } = issueClaim('u1', 'p1')
    await routeRequestForTest(claimConfirm(nonce))
    const res = await routeRequestForTest(claimConfirm(nonce))
    expect(res.status).toBe(401)
  })

  test('POST /auth/logout revokes and clears cookie', async () => {
    const { cookieValue } = mintSession('u1', { secure: false })
    const res = await routeRequestForTest(
      new Request('http://localhost/auth/logout', {
        method: 'POST',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
      }),
    )
    expect(res.status).toBe(200)
    const logoutCookie = res.headers.get('Set-Cookie')
    expect(logoutCookie).not.toBeNull()
    expect(logoutCookie).toContain('Max-Age=0')
    const after = await routeRequestForTest(
      new Request('http://localhost/logs/stats', {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
      }),
    )
    expect(after.status).toBe(401)
  })

  test('GET /auth/whoami returns 401 without cookie', async () => {
    const res = await routeRequestForTest(new Request('http://localhost/auth/whoami'))
    expect(res.status).toBe(401)
  })

  test('GET /auth/whoami returns adminUserId for a valid cookie', async () => {
    const { cookieValue } = mintSession('u1', { secure: false })
    const res = await routeRequestForTest(
      new Request('http://localhost/auth/whoami', {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
      }),
    )
    expect(res.status).toBe(200)
    const body = z.object({ adminUserId: z.string() }).parse(await res.json())
    expect(body.adminUserId).toBe('u1')
  })
})
