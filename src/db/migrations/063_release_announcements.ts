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

const up = (db: Database): void => {
  if (!columnExists(db, 'users', 'announce_subscribed')) {
    db.run(`ALTER TABLE users ADD COLUMN announce_subscribed INTEGER NOT NULL DEFAULT 0`)
  }
  if (!columnExists(db, 'authorized_groups', 'announce_subscribed')) {
    db.run(`ALTER TABLE authorized_groups ADD COLUMN announce_subscribed INTEGER NOT NULL DEFAULT 0`)
  }
  if (!columnExists(db, 'version_announcements', 'raw_body')) {
    db.run(`ALTER TABLE version_announcements ADD COLUMN raw_body TEXT`)
  }
  if (!columnExists(db, 'version_announcements', 'humanized_body')) {
    db.run(`ALTER TABLE version_announcements ADD COLUMN humanized_body TEXT`)
  }
  if (!columnExists(db, 'version_announcements', 'broadcast_at')) {
    db.run(`ALTER TABLE version_announcements ADD COLUMN broadcast_at TEXT`)
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS announcement_deliveries (
      version TEXT NOT NULL,
      context_id TEXT NOT NULL,
      context_type TEXT NOT NULL,
      status TEXT NOT NULL,
      delivered_at TEXT NOT NULL,
      PRIMARY KEY (version, context_id)
    )
  `)
  log.info('migration 063: release announcement subscription columns + deliveries table added')
}

export const migration063ReleaseAnnouncements: Migration = { id: '063_release_announcements', up }

export default migration063ReleaseAnnouncements
