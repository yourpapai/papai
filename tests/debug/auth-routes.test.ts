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
import { migration046DashboardSessions } from '../../src/db/migrations/046_dashboard_sessions.js'
import { handleAuthClaim, handleAuthLogout, handleAuthWhoami } from '../../src/debug/auth-routes.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('auth route handlers', () => {
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

  describe('handleAuthClaim', () => {
    test('returns 401 for missing nonce', () => {
      const url = new URL('http://localhost/auth/claim')
      const res = handleAuthClaim(new Request('http://localhost/auth/claim'), url)
      expect(res.status).toBe(401)
    })

    test('returns 401 for unknown nonce', () => {
      const url = new URL('http://localhost/auth/claim?n=unknown')
      const res = handleAuthClaim(new Request('http://localhost/auth/claim?n=unknown'), url)
      expect(res.status).toBe(401)
    })

    test('returns 302 with Set-Cookie and Referrer-Policy for valid nonce', () => {
      const { nonce } = issueClaim('u1', 'p1')
      const url = new URL(`http://localhost/auth/claim?n=${nonce}`)
      const res = handleAuthClaim(new Request(`http://localhost/auth/claim?n=${nonce}`), url)
      expect(res.status).toBe(302)
      expect(res.headers.get('Location')).toBe('/admin')
      expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
      const setCookie = res.headers.get('Set-Cookie')
      expect(setCookie).not.toBeNull()
      expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`)
    })
  })

  describe('handleAuthLogout', () => {
    test('returns 200 with Max-Age=0 cookie', () => {
      const { cookieValue } = mintSession('u1', { secure: false })
      const req = new Request('http://localhost/auth/logout', {
        method: 'POST',
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
      })
      const res = handleAuthLogout(req)
      expect(res.status).toBe(200)
      const logoutCookie = res.headers.get('Set-Cookie')
      expect(logoutCookie).not.toBeNull()
      expect(logoutCookie).toContain('Max-Age=0')
    })

    test('returns 200 even without a cookie', () => {
      const res = handleAuthLogout(new Request('http://localhost/auth/logout', { method: 'POST' }))
      expect(res.status).toBe(200)
    })
  })

  describe('handleAuthWhoami', () => {
    test('returns 401 without a session cookie', () => {
      const res = handleAuthWhoami(new Request('http://localhost/auth/whoami'))
      expect(res.status).toBe(401)
    })

    test('returns 200 with adminUserId for a valid session', async () => {
      const { cookieValue } = mintSession('u1', { secure: false })
      const res = handleAuthWhoami(
        new Request('http://localhost/auth/whoami', {
          headers: { Cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
        }),
      )
      expect(res.status).toBe(200)
      const body = z.object({ adminUserId: z.string() }).parse(await res.json())
      expect(body.adminUserId).toBe('u1')
    })
  })
})
