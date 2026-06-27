// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { MIGRATIONS } from '../../../src/db/index.js'
import { runMigrations } from '../../../src/db/migrate.js'
import { migration065CodingIdentity } from '../../../src/db/migrations/065_coding_identity.js'

const cols = (db: Database, table: string): string[] =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((r) => r.name)

describe('migration 065', () => {
  test('has correct id', () => {
    expect(migration065CodingIdentity.id).toBe('065_coding_identity')
  })

  test('adds coding_identity to authorized_groups', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    expect(cols(db, 'authorized_groups')).toContain('coding_identity')
  })

  test('up is idempotent (safe to re-run)', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    expect(() => migration065CodingIdentity.up(db)).not.toThrow()
    expect(cols(db, 'authorized_groups')).toContain('coding_identity')
  })

  test("coding_identity defaults to 'initiator'", () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    db.run(`INSERT INTO authorized_groups (group_id, added_by) VALUES ('g1', 'admin')`)
    const row = db
      .query<{ coding_identity: string }, []>(`SELECT coding_identity FROM authorized_groups WHERE group_id='g1'`)
      .get()
    expect(row?.coding_identity).toBe('initiator')
  })
})
