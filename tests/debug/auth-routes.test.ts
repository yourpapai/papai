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
import {
  handleAuthClaim,
  handleAuthClaimConfirm,
  handleAuthLogout,
  handleAuthWhoami,
} from '../../src/debug/auth-routes.js'
import { mockLogger } from '../utils/test-helpers.js'

const claimConfirmRequest = (nonce: string, headers: Record<string, string> = {}): Request =>
  new Request('http://localhost/auth/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams({ n: nonce }).toString(),
  })

describe('auth route handlers', () => {
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

  describe('handleAuthClaim (GET interstitial)', () => {
    test('returns 401 for missing nonce', () => {
      const url = new URL('http://localhost/auth/claim')
      const res = handleAuthClaim(new Request('http://localhost/auth/claim'), url)
      expect(res.status).toBe(401)
    })

    test('renders an HTML confirmation form without consuming the claim', async () => {
      const { nonce } = issueClaim('u1', 'p1')
      const url = new URL(`http://localhost/auth/claim?n=${nonce}`)
      const res = handleAuthClaim(new Request(`http://localhost/auth/claim?n=${nonce}`), url)
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toContain('text/html')
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
      const html = await res.text()
      expect(html).toContain('method="post"')
      expect(html).toContain(`value="${nonce}"`)
      // The GET must NOT consume the claim — a subsequent POST still succeeds.
      const post = await handleAuthClaimConfirm(claimConfirmRequest(nonce))
      expect(post.status).toBe(302)
    })

    test('HTML-escapes the nonce to avoid injection', async () => {
      const url = new URL('http://localhost/auth/claim?n=%22%3E%3Cscript%3E')
      const res = handleAuthClaim(new Request(url.toString()), url)
      const html = await res.text()
      expect(html).not.toContain('<script>')
      expect(html).toContain('&lt;script&gt;')
    })
  })

  describe('handleAuthClaimConfirm (POST consume)', () => {
    test('returns 401 for missing nonce', async () => {
      const res = await handleAuthClaimConfirm(
        new Request('http://localhost/auth/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: '',
        }),
      )
      expect(res.status).toBe(401)
    })

    test('returns 401 for unknown nonce', async () => {
      const res = await handleAuthClaimConfirm(claimConfirmRequest('unknown'))
      expect(res.status).toBe(401)
    })

    test('returns 302 with Set-Cookie and Referrer-Policy for valid nonce', async () => {
      const { nonce } = issueClaim('u1', 'p1')
      const res = await handleAuthClaimConfirm(claimConfirmRequest(nonce))
      expect(res.status).toBe(302)
      expect(res.headers.get('Location')).toBe('/debug')
      expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
      expect(res.headers.get('Cache-Control')).toBe('no-store')
      const setCookie = res.headers.get('Set-Cookie')
      expect(setCookie).not.toBeNull()
      expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`)
    })

    test('rejects a replayed nonce with 401', async () => {
      const { nonce } = issueClaim('u1', 'p1')
      const first = await handleAuthClaimConfirm(claimConfirmRequest(nonce))
      expect(first.status).toBe(302)
      const second = await handleAuthClaimConfirm(claimConfirmRequest(nonce))
      expect(second.status).toBe(401)
    })

    test('returns 503 when mintSession fails', async () => {
      // Use a claims-only DB: dashboard_claims exists but dashboard_sessions does not,
      // so consumeClaim succeeds while insertSession (inside mintSession) throws.
      const claimsOnlyDb = new Database(':memory:')
      claimsOnlyDb.run(`
        CREATE TABLE IF NOT EXISTS dashboard_claims (
          nonce_hash TEXT PRIMARY KEY,
          admin_user_id TEXT NOT NULL,
          platform_instance_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          consumed_at INTEGER
        )
      `)
      setStoreDb(claimsOnlyDb)
      const { nonce } = issueClaim('u1', 'p1')
      const res = await handleAuthClaimConfirm(claimConfirmRequest(nonce))
      claimsOnlyDb.close()
      setStoreDb(db)
      expect(res.status).toBe(503)
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

    test('GET /auth/whoami updates last_seen_at on the session row', async () => {
      const { cookieValue } = mintSession('u1', { secure: false })
      const before = db
        .query<{ last_seen_at: number | null }, []>(`SELECT last_seen_at FROM dashboard_sessions LIMIT 1`)
        .get()
      expect(before?.last_seen_at).toBeNull()
      await handleAuthWhoami(
        new Request('http://localhost/auth/whoami', {
          headers: { Cookie: `${SESSION_COOKIE_NAME}=${cookieValue}`, 'X-Forwarded-For': '10.0.0.7' },
        }),
      )
      const after = db
        .query<{ last_seen_at: number | null; last_seen_ip: string | null }, []>(
          `SELECT last_seen_at, last_seen_ip FROM dashboard_sessions LIMIT 1`,
        )
        .get()
      expect(after?.last_seen_at).not.toBeNull()
      expect(after?.last_seen_ip).toBe('10.0.0.7')
    })
  })

  describe('isSecureRequest (via handleAuthClaimConfirm)', () => {
    test('detects https from multi-value X-Forwarded-Proto', async () => {
      const { nonce } = issueClaim('u1', 'p1')
      const res = await handleAuthClaimConfirm(claimConfirmRequest(nonce, { 'X-Forwarded-Proto': 'https, http' }))
      const setCookie = res.headers.get('Set-Cookie')
      expect(setCookie).not.toBeNull()
      expect(setCookie).toContain('Secure')
    })
  })
})
