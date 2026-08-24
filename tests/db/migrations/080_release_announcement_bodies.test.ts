// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { MIGRATIONS } from '../../../src/db/index.js'
import { runMigrations } from '../../../src/db/migrate.js'
import { migration080ReleaseAnnouncementBodies } from '../../../src/db/migrations/080_release_announcement_bodies.js'

const cols = (db: Database, table: string): string[] =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((r) => r.name)

describe('migration 080 release announcement bodies', () => {
  test('has correct id', () => {
    expect(migration080ReleaseAnnouncementBodies.id).toBe('080_release_announcement_bodies')
  })

  test('adds humanized_bodies column to version_announcements', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    expect(cols(db, 'version_announcements')).toContain('humanized_bodies')
  })

  test('up is idempotent (safe to re-run)', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    expect(() => migration080ReleaseAnnouncementBodies.up(db)).not.toThrow()
  })

  test('does not backfill humanized_bodies on historical rows', () => {
    const db = new Database(':memory:')
    runMigrations(
      db,
      MIGRATIONS.filter((m) => m.id !== '080_release_announcement_bodies'),
    )
    db.run(
      `INSERT INTO version_announcements (version, announced_at, raw_body, humanized_body)
       VALUES ('v1.2.3', '2026-06-26T00:00:00.000Z', '## What is new', 'Some new features')`,
    )

    migration080ReleaseAnnouncementBodies.up(db)

    const row = db
      .query<{ humanized_body: string | null; humanized_bodies: string | null }, []>(
        'SELECT humanized_body, humanized_bodies FROM version_announcements',
      )
      .get()
    expect(row).toEqual({ humanized_body: 'Some new features', humanized_bodies: null })
  })
})
