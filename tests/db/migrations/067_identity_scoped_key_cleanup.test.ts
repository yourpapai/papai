// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { MIGRATIONS } from '../../../src/db/index.js'
import { runMigrations } from '../../../src/db/migrate.js'
import { migration067IdentityScopedKeyCleanup } from '../../../src/db/migrations/067_identity_scoped_key_cleanup.js'

const insertMapping = (db: Database, contextId: string, providerUserId: string): void => {
  db.run(
    `INSERT INTO user_identity_mappings (context_id, provider_name, provider_user_id, matched_at) VALUES (?, 'kaneo', ?, '2026-07-18T00:00:00.000Z')`,
    [contextId, providerUserId],
  )
}

describe('migration 067', () => {
  test('has correct id', () => {
    expect(migration067IdentityScopedKeyCleanup.id).toBe('067_identity_scoped_key_cleanup')
  })

  test('removes orphaned scoped-key rows and keeps raw platform user id rows', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    insertMapping(db, 'alice-raw', 'kaneo-alice')
    insertMapping(db, 'ctx:alice', 'kaneo-unscoped')
    insertMapping(db, 'pi:dGVzdA:ctx:dGVzdA', 'kaneo-orphan')

    migration067IdentityScopedKeyCleanup.up(db)

    const remaining = db.query<{ context_id: string }, []>(`SELECT context_id FROM user_identity_mappings`).all()
    expect(remaining.map((row) => row.context_id)).toEqual(['alice-raw', 'ctx:alice'])
  })
})
