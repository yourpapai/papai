// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { MIGRATIONS } from '../../../src/db/index.js'
import { runMigrations } from '../../../src/db/migrate.js'
import { migration059GuestMode } from '../../../src/db/migrations/059_guest_mode.js'

const cols = (db: Database, table: string): string[] =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((r) => r.name)

describe('migration 059', () => {
  test('has correct id', () => {
    expect(migration059GuestMode.id).toBe('059_guest_mode')
  })

  test('adds guest_mode to authorized_groups', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    expect(cols(db, 'authorized_groups')).toContain('guest_mode')
  })

  test('up is idempotent (safe to re-run)', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    expect(() => migration059GuestMode.up(db)).not.toThrow()
    expect(cols(db, 'authorized_groups')).toContain('guest_mode')
  })

  test('guest_mode defaults to 0', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    db.run(`INSERT INTO authorized_groups (group_id, added_by) VALUES ('g1', 'admin')`)
    const row = db
      .query<{ guest_mode: number }, []>(`SELECT guest_mode FROM authorized_groups WHERE group_id='g1'`)
      .get()
    expect(row?.guest_mode).toBe(0)
  })
})
