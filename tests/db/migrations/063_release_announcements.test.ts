// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { MIGRATIONS } from '../../../src/db/index.js'
import { runMigrations } from '../../../src/db/migrate.js'
import { migration063ReleaseAnnouncements } from '../../../src/db/migrations/063_release_announcements.js'

const cols = (db: Database, table: string): string[] =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((r) => r.name)

const tableExists = (db: Database, table: string): boolean =>
  db.query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table) !==
  null

describe('migration 063 release announcements', () => {
  test('has correct id', () => {
    expect(migration063ReleaseAnnouncements.id).toBe('063_release_announcements')
  })

  test('adds announce_subscribed columns + announcement_deliveries table', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    expect(cols(db, 'users')).toContain('announce_subscribed')
    expect(cols(db, 'authorized_groups')).toContain('announce_subscribed')
    const versionAnnouncementCols = cols(db, 'version_announcements')
    expect(versionAnnouncementCols).toContain('raw_body')
    expect(versionAnnouncementCols).toContain('humanized_body')
    expect(versionAnnouncementCols).toContain('broadcast_at')
    expect(tableExists(db, 'announcement_deliveries')).toBe(true)
    const deliveryCols = cols(db, 'announcement_deliveries')
    expect(deliveryCols).toContain('version')
    expect(deliveryCols).toContain('context_id')
    expect(deliveryCols).toContain('context_type')
    expect(deliveryCols).toContain('status')
    expect(deliveryCols).toContain('delivered_at')
  })

  test('up is idempotent (safe to re-run)', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    expect(() => migration063ReleaseAnnouncements.up(db)).not.toThrow()
  })
})
