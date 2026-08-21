// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { MIGRATIONS } from '../../../src/db/index.js'
import { runMigrations } from '../../../src/db/migrate.js'
import { migration080LocalizedAnnouncementBodies } from '../../../src/db/migrations/080_localized_announcement_bodies.js'

const cols = (db: Database, table: string): string[] =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((r) => r.name)

describe('migration 080 localized announcement bodies', () => {
  test('has correct id', () => {
    expect(migration080LocalizedAnnouncementBodies.id).toBe('080_localized_announcement_bodies')
  })

  test('is registered last in MIGRATIONS', () => {
    expect(MIGRATIONS[MIGRATIONS.length - 1]).toBe(migration080LocalizedAnnouncementBodies)
  })

  test('adds version_announcements.localized_bodies TEXT column', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    expect(cols(db, 'version_announcements')).toContain('localized_bodies')
  })

  test('up is idempotent (safe to re-run)', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    expect(() => migration080LocalizedAnnouncementBodies.up(db)).not.toThrow()
  })
})
