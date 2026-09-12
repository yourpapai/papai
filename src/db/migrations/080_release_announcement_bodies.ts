// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:080' })

const columnExists = (db: Database, table: string, column: string): boolean =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column)

const up = (db: Database): void => {
  let changed = false

  if (!columnExists(db, 'version_announcements', 'humanized_bodies')) {
    db.run(`ALTER TABLE version_announcements ADD COLUMN humanized_bodies TEXT`)
    changed = true
  }

  if (changed) {
    log.info('migration 080: humanized_bodies added to version_announcements')
  }
}

export const migration080ReleaseAnnouncementBodies: Migration = {
  id: '080_release_announcement_bodies',
  up,
}

export default migration080ReleaseAnnouncementBodies
