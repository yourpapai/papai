// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration047DashboardSessions } from '../../../src/db/migrations/047_dashboard_sessions.js'
import { mockLogger } from '../../utils/test-helpers.js'

interface ColumnRow {
  name: string
  type: string
  notnull: number
  pk: number
}

describe('migration047DashboardSessions', () => {
  let db: Database
  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
    db.run('PRAGMA foreign_keys=ON')
  })
  afterEach(() => {
    db.close()
  })

  test('creates dashboard_claims with expected columns', () => {
    migration047DashboardSessions.up(db)
    const cols = db.query<ColumnRow, []>(`PRAGMA table_info('dashboard_claims')`).all()
    const names = cols.map((c) => c.name).sort()
    expect(names).toEqual([
      'admin_user_id',
      'consumed_at',
      'created_at',
      'expires_at',
      'nonce_hash',
      'platform_instance_id',
    ])
    expect(cols.find((c) => c.name === 'nonce_hash')?.pk).toBe(1)
    expect(cols.find((c) => c.name === 'admin_user_id')?.notnull).toBe(1)
    expect(cols.find((c) => c.name === 'platform_instance_id')?.notnull).toBe(1)
    expect(cols.find((c) => c.name === 'created_at')?.notnull).toBe(1)
    expect(cols.find((c) => c.name === 'expires_at')?.notnull).toBe(1)
  })

  test('creates dashboard_sessions with expected columns', () => {
    migration047DashboardSessions.up(db)
    const cols = db.query<ColumnRow, []>(`PRAGMA table_info('dashboard_sessions')`).all()
    const names = cols.map((c) => c.name).sort()
    expect(names).toEqual([
      'admin_user_id',
      'expires_at',
      'id',
      'issued_at',
      'last_seen_at',
      'last_seen_ip',
      'revoked_at',
      'user_agent',
    ])
    expect(cols.find((c) => c.name === 'id')?.pk).toBe(1)
    expect(cols.find((c) => c.name === 'admin_user_id')?.notnull).toBe(1)
    expect(cols.find((c) => c.name === 'issued_at')?.notnull).toBe(1)
    expect(cols.find((c) => c.name === 'expires_at')?.notnull).toBe(1)
  })

  test('creates dashboard_sessions admin lookup index', () => {
    migration047DashboardSessions.up(db)
    const idx = db
      .query<{ name: string }, []>(
        `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='dashboard_sessions'`,
      )
      .all()
    expect(idx.map((r) => r.name)).toContain('idx_dashboard_sessions_admin')
  })

  test('is idempotent', () => {
    migration047DashboardSessions.up(db)
    expect(() => migration047DashboardSessions.up(db)).not.toThrow()
  })

  test('exports the expected migration id', () => {
    expect(migration047DashboardSessions.id).toBe('047_dashboard_sessions')
  })
})
