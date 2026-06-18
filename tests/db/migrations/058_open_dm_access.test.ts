// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { MIGRATIONS } from '../../../src/db/index.js'
import { runMigrations } from '../../../src/db/migrate.js'
import { migration058OpenDmAccess } from '../../../src/db/migrations/058_open_dm_access.js'

const cols = (db: Database, table: string): string[] =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((r) => r.name)

describe('migration 058', () => {
  test('has correct id', () => {
    expect(migration058OpenDmAccess.id).toBe('058_open_dm_access')
  })

  test('adds open_dm_access to platform_instances and blocked_at to users', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    expect(cols(db, 'platform_instances')).toContain('open_dm_access')
    expect(cols(db, 'users')).toContain('blocked_at')
  })

  test('up is idempotent (safe to re-run)', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    expect(() => migration058OpenDmAccess.up(db)).not.toThrow()
    expect(cols(db, 'platform_instances')).toContain('open_dm_access')
    expect(cols(db, 'users')).toContain('blocked_at')
  })

  test('open_dm_access defaults to 0', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    db.run(`INSERT INTO platform_instances (id, type, config, status) VALUES ('x', 'telegram', 'cfg', 'active')`)
    const row = db
      .query<{ open_dm_access: number }, []>(`SELECT open_dm_access FROM platform_instances WHERE id='x'`)
      .get()
    expect(row?.open_dm_access).toBe(0)
  })
})
