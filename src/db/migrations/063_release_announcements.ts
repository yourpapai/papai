// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:063' })

const columnExists = (db: Database, table: string, column: string): boolean =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column)

const tableExists = (db: Database, table: string): boolean =>
  db.query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table) !==
  null

const up = (db: Database): void => {
  let changed = false

  if (!columnExists(db, 'users', 'announce_subscribed')) {
    db.run(`ALTER TABLE users ADD COLUMN announce_subscribed INTEGER NOT NULL DEFAULT 0`)
    changed = true
  }
  if (!columnExists(db, 'authorized_groups', 'announce_subscribed')) {
    db.run(`ALTER TABLE authorized_groups ADD COLUMN announce_subscribed INTEGER NOT NULL DEFAULT 0`)
    changed = true
  }
  if (!columnExists(db, 'version_announcements', 'raw_body')) {
    db.run(`ALTER TABLE version_announcements ADD COLUMN raw_body TEXT`)
    changed = true
  }
  if (!columnExists(db, 'version_announcements', 'humanized_body')) {
    db.run(`ALTER TABLE version_announcements ADD COLUMN humanized_body TEXT`)
    changed = true
  }
  if (!columnExists(db, 'version_announcements', 'broadcast_at')) {
    db.run(`ALTER TABLE version_announcements ADD COLUMN broadcast_at TEXT`)
    changed = true
  }
  if (!tableExists(db, 'announcement_deliveries')) {
    db.run(`
      CREATE TABLE announcement_deliveries (
        version TEXT NOT NULL REFERENCES version_announcements(version),
        context_id TEXT NOT NULL,
        context_type TEXT NOT NULL,
        status TEXT NOT NULL,
        delivered_at TEXT NOT NULL,
        PRIMARY KEY (version, context_id)
      )
    `)
    changed = true
  }
  if (changed) {
    log.info('migration 063: release announcement subscription columns + deliveries table added')
  }
}

export const migration063ReleaseAnnouncements: Migration = { id: '063_release_announcements', up }

export default migration063ReleaseAnnouncements
