// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { MIGRATIONS } from '../../src/db/index.js'
import { runMigrations } from '../../src/db/migrate.js'

// Migrations up to and including 055 (exclude 056 and later)
const PRE_056_MIGRATIONS = MIGRATIONS.filter((m) => m.id < '056')

describe('migration 056 — FTS rebuild after table recreation', () => {
  test('FTS search finds rows that existed before migration 056 (non-contiguous rowids)', () => {
    const db = new Database(':memory:')

    // Step 1: apply migrations 001..055 only
    runMigrations(db, PRE_056_MIGRATIONS)

    const now = new Date().toISOString()

    // Step 2: insert 3 rows; the 053 AFTER INSERT trigger populates the FTS index
    db.run(
      `INSERT INTO memory_records
        (id, scope_id, scope_type, kind, content, tags, confidence, status, source, evidence, created_at, updated_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'row-1',
        'grp-1',
        'group',
        'fact',
        'fridaydeploys schedule notice row one',
        '[]',
        0.5,
        'active',
        'background',
        '{}',
        now,
        now,
        now,
      ],
    )
    db.run(
      `INSERT INTO memory_records
        (id, scope_id, scope_type, kind, content, tags, confidence, status, source, evidence, created_at, updated_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'row-2',
        'grp-1',
        'group',
        'fact',
        'fridaydeploys schedule notice row two',
        '[]',
        0.5,
        'active',
        'background',
        '{}',
        now,
        now,
        now,
      ],
    )
    db.run(
      `INSERT INTO memory_records
        (id, scope_id, scope_type, kind, content, tags, confidence, status, source, evidence, created_at, updated_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'row-3',
        'grp-1',
        'group',
        'fact',
        'unrelated content for third row',
        '[]',
        0.5,
        'active',
        'background',
        '{}',
        now,
        now,
        now,
      ],
    )

    // Step 3: delete the first row so surviving rows have non-contiguous rowids;
    // this forces rowid renumbering during the 056 table recreation and exposes the bug.
    db.run(`DELETE FROM memory_records WHERE id='row-1'`)

    // Step 4: run migration 056 (skips 001..055 as already applied)
    runMigrations(db, MIGRATIONS)

    // Step 5: query using the same rowid JOIN the store uses
    const rows = db
      .query<{ id: string }, []>(
        `SELECT m.id FROM memory_records m
         INNER JOIN memory_records_fts f ON m.rowid = f.rowid
         WHERE f.memory_records_fts MATCH 'fridaydeploys'`,
      )
      .all()

    const foundIds = rows.map((r) => r.id).sort()
    // row-1 was deleted; row-3 has no token; only row-2 should match
    expect(foundIds).toEqual(['row-2'])

    // Step 6: also confirm the CHECK was widened — insert a 'provisional' row and read it back
    db.run(
      `INSERT INTO memory_records
        (id, scope_id, scope_type, kind, content, tags, confidence, status, source, evidence, created_at, updated_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'row-prov',
        'grp-1',
        'group',
        'fact',
        'provisional row content',
        '[]',
        0.5,
        'provisional',
        'background',
        '{}',
        now,
        now,
        now,
      ],
    )
    const provisionalRow = db
      .query<{ status: string }, [string]>(`SELECT status FROM memory_records WHERE id = ?`)
      .get('row-prov')
    expect(provisionalRow?.status).toBe('provisional')
  })
})
