// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import { SESSION_COOKIE_NAME } from '../../src/dashboard-auth/cookie.js'
import {
  authenticate,
  consumeClaim,
  getClaimTtlSeconds,
  getSessionTtlSeconds,
  issueClaim,
  mintSession,
  recordActivity,
  revokeSession,
  sweepExpired,
} from '../../src/dashboard-auth/index.js'
import { insertSession, setStoreDb } from '../../src/dashboard-auth/store.js'
import { migration046DashboardSessions } from '../../src/db/migrations/046_dashboard_sessions.js'
import { mockLogger } from '../utils/test-helpers.js'

const makeReq = (cookie?: string): Request =>
  new Request('http://localhost/', cookie === undefined ? {} : { headers: { Cookie: cookie } })

describe('dashboard-auth', () => {
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

  test('issueClaim returns a high-entropy nonce + records hashed copy', () => {
    const { nonce, expiresAt } = issueClaim('u1', 'p1')
    expect(nonce).toMatch(/^[0-9a-f]{32}$/u)
    expect(expiresAt).toBeGreaterThan(Date.now())
    expect(db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM dashboard_claims`).get()?.n).toBe(1)
  })

  test('consumeClaim mints a session for a valid nonce', () => {
    const { nonce } = issueClaim('u1', 'p1')
    const result = consumeClaim(nonce)
    expect(result?.adminUserId).toBe('u1')
  })

  test('consumeClaim returns null for unknown nonce', () => {
    expect(consumeClaim('deadbeef')).toBeNull()
  })

  test('consumeClaim returns null on replay', () => {
    const { nonce } = issueClaim('u1', 'p1')
    expect(consumeClaim(nonce)?.adminUserId).toBe('u1')
    expect(consumeClaim(nonce)).toBeNull()
  })

  test('mintSession returns cookie value + Set-Cookie header', () => {
    const { cookieValue, setCookie } = mintSession('u1', { secure: true })
    expect(cookieValue).toMatch(/^[0-9a-f]{64}$/u)
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=${cookieValue}`)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Strict')
    expect(setCookie).toContain('Secure')
  })

  test('authenticate returns adminUserId for a valid cookie', () => {
    const { cookieValue } = mintSession('u1', { secure: false })
    const res = authenticate(makeReq(`${SESSION_COOKIE_NAME}=${cookieValue}`))
    expect(res?.adminUserId).toBe('u1')
  })

  test('authenticate returns null when no cookie', () => {
    expect(authenticate(makeReq())).toBeNull()
  })

  test('authenticate returns null when cookie value unknown', () => {
    expect(authenticate(makeReq(`${SESSION_COOKIE_NAME}=ffff`))).toBeNull()
  })

  test('revokeSession invalidates the session', () => {
    const { cookieValue } = mintSession('u1', { secure: false })
    revokeSession(cookieValue)
    expect(authenticate(makeReq(`${SESSION_COOKIE_NAME}=${cookieValue}`))).toBeNull()
  })

  test('sweepExpired removes expired rows', () => {
    issueClaim('u1', 'p1')
    mintSession('u1', { secure: false })
    sweepExpired(Number.MAX_SAFE_INTEGER)
    expect(db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM dashboard_claims`).get()?.n).toBe(0)
    expect(db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM dashboard_sessions`).get()?.n).toBe(0)
  })

  test('TTLs come from env with sensible defaults', () => {
    expect(getSessionTtlSeconds()).toBe(28800)
    expect(getClaimTtlSeconds()).toBe(300)
    process.env['DASHBOARD_SESSION_TTL_SECONDS'] = '60'
    process.env['DASHBOARD_CLAIM_TTL_SECONDS'] = '30'
    expect(getSessionTtlSeconds()).toBe(60)
    expect(getClaimTtlSeconds()).toBe(30)
    delete process.env['DASHBOARD_SESSION_TTL_SECONDS']
    delete process.env['DASHBOARD_CLAIM_TTL_SECONDS']
  })

  test('rejects malformed TTL env vars and falls back to defaults', () => {
    process.env['DASHBOARD_SESSION_TTL_SECONDS'] = '10abc'
    expect(getSessionTtlSeconds()).toBe(28800)
    process.env['DASHBOARD_SESSION_TTL_SECONDS'] = '1.5e3'
    expect(getSessionTtlSeconds()).toBe(28800)
    process.env['DASHBOARD_SESSION_TTL_SECONDS'] = '3.14'
    expect(getSessionTtlSeconds()).toBe(28800)
    process.env['DASHBOARD_SESSION_TTL_SECONDS'] = '-5'
    expect(getSessionTtlSeconds()).toBe(28800)
    delete process.env['DASHBOARD_SESSION_TTL_SECONDS']
  })

  test('recordActivity records IP from X-Forwarded-For', () => {
    const { cookieValue } = mintSession('u1', { secure: false })
    const res = authenticate(makeReq(`${SESSION_COOKIE_NAME}=${cookieValue}`))
    expect(res).not.toBeNull()
    const req = new Request('http://localhost/', {
      headers: { 'X-Forwarded-For': '10.0.0.5, 192.168.1.1', 'User-Agent': 'agent/2' },
    })
    recordActivity(res!.sessionIdHash, req)
    const row = db
      .query<{ last_seen_ip: string | null; user_agent: string | null }, []>(
        `SELECT last_seen_ip, user_agent FROM dashboard_sessions LIMIT 1`,
      )
      .get()
    expect(row?.last_seen_ip).toBe('10.0.0.5')
    expect(row?.user_agent).toBe('agent/2')
  })

  test('recordActivity stores null IP when X-Forwarded-For is empty', () => {
    const { cookieValue } = mintSession('u1', { secure: false })
    const res = authenticate(makeReq(`${SESSION_COOKIE_NAME}=${cookieValue}`))
    expect(res).not.toBeNull()
    recordActivity(res!.sessionIdHash, new Request('http://localhost/', { headers: { 'X-Forwarded-For': '' } }))
    const row = db
      .query<{ last_seen_ip: string | null }, []>(`SELECT last_seen_ip FROM dashboard_sessions LIMIT 1`)
      .get()
    expect(row?.last_seen_ip).toBeNull()
  })

  test('authenticate returns null for an expired session', () => {
    const cookieValue = 'a'.repeat(64)
    const idHash = createHash('sha256').update(cookieValue).digest('hex')
    insertSession({ idHash, adminUserId: 'u1', issuedAt: 0, expiresAt: 1 })
    expect(authenticate(makeReq(`${SESSION_COOKIE_NAME}=${cookieValue}`))).toBeNull()
  })
})
