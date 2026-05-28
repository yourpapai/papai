// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  consumeClaimByHash,
  deleteExpired,
  insertClaim,
  insertSession,
  loadSessionByHash,
  revokeSessionByHash,
  setStoreDb,
  touchSession,
} from '../../src/dashboard-auth/store.js'
import { migration046DashboardSessions } from '../../src/db/migrations/046_dashboard_sessions.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('dashboard-auth/store', () => {
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

  test('insertClaim then consumeClaimByHash returns admin + marks consumed', () => {
    insertClaim({ nonceHash: 'hash-a', adminUserId: 'u1', platformInstanceId: 'p1', createdAt: 1000, expiresAt: 2000 })
    const result = consumeClaimByHash('hash-a', 1500)
    expect(result).toEqual({ adminUserId: 'u1' })
    // single-use: second call must return null
    expect(consumeClaimByHash('hash-a', 1500)).toBeNull()
  })

  test('consumeClaimByHash returns null for expired claim', () => {
    insertClaim({ nonceHash: 'hash-b', adminUserId: 'u1', platformInstanceId: 'p1', createdAt: 1000, expiresAt: 1100 })
    expect(consumeClaimByHash('hash-b', 1200)).toBeNull()
  })

  test('consumeClaimByHash returns null for unknown nonce', () => {
    expect(consumeClaimByHash('nope', 1000)).toBeNull()
  })

  test('insertSession + loadSessionByHash round-trips', () => {
    insertSession({ idHash: 'sid', adminUserId: 'u1', issuedAt: 100, expiresAt: 200 })
    const row = loadSessionByHash('sid', 150)
    expect(row?.adminUserId).toBe('u1')
  })

  test('loadSessionByHash returns null when expired', () => {
    insertSession({ idHash: 'sid2', adminUserId: 'u1', issuedAt: 100, expiresAt: 200 })
    expect(loadSessionByHash('sid2', 250)).toBeNull()
  })

  test('loadSessionByHash returns null when revoked', () => {
    insertSession({ idHash: 'sid3', adminUserId: 'u1', issuedAt: 100, expiresAt: 200 })
    revokeSessionByHash('sid3', 150)
    expect(loadSessionByHash('sid3', 175)).toBeNull()
  })

  test('touchSession updates last_seen_at + last_seen_ip', () => {
    insertSession({ idHash: 'sid4', adminUserId: 'u1', issuedAt: 100, expiresAt: 200 })
    touchSession('sid4', 150, '127.0.0.1', 'agent/1')
    const row = db
      .query<{ last_seen_at: number; last_seen_ip: string; user_agent: string }, []>(
        `SELECT last_seen_at, last_seen_ip, user_agent FROM dashboard_sessions WHERE id='sid4'`,
      )
      .get()
    expect(row?.last_seen_at).toBe(150)
    expect(row?.last_seen_ip).toBe('127.0.0.1')
    expect(row?.user_agent).toBe('agent/1')
  })

  test('deleteExpired removes expired claims and sessions', () => {
    insertClaim({ nonceHash: 'old', adminUserId: 'u1', platformInstanceId: 'p1', createdAt: 1, expiresAt: 2 })
    insertClaim({ nonceHash: 'new', adminUserId: 'u1', platformInstanceId: 'p1', createdAt: 1, expiresAt: 10_000 })
    insertSession({ idHash: 'sold', adminUserId: 'u1', issuedAt: 1, expiresAt: 2 })
    insertSession({ idHash: 'snew', adminUserId: 'u1', issuedAt: 1, expiresAt: 10_000 })
    deleteExpired(100)
    expect(db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM dashboard_claims`).get()).toEqual({ n: 1 })
    expect(db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM dashboard_sessions`).get()).toEqual({ n: 1 })
  })

  test('touchSession is a no-op on a revoked session', () => {
    insertSession({ idHash: 'sid5', adminUserId: 'u1', issuedAt: 100, expiresAt: 200 })
    revokeSessionByHash('sid5', 120)
    touchSession('sid5', 150, '127.0.0.1', 'agent/1')
    const row = db
      .query<{ last_seen_at: number | null }, []>(`SELECT last_seen_at FROM dashboard_sessions WHERE id='sid5'`)
      .get()
    expect(row?.last_seen_at).toBeNull()
  })

  test('deleteExpired removes revoked sessions even when not yet expired', () => {
    insertSession({ idHash: 'srev', adminUserId: 'u1', issuedAt: 1, expiresAt: 10_000 })
    revokeSessionByHash('srev', 50)
    deleteExpired(100)
    const row = db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM dashboard_sessions WHERE id='srev'`).get()
    expect(row?.n).toBe(0)
  })
})
