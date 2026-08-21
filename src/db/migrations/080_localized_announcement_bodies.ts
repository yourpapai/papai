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
  if (!columnExists(db, 'version_announcements', 'localized_bodies')) {
    db.run(`ALTER TABLE version_announcements ADD COLUMN localized_bodies TEXT`)
    log.info('migration 080: version_announcements.localized_bodies column added')
  }
}

export const migration080LocalizedAnnouncementBodies: Migration = {
  id: '080_localized_announcement_bodies',
  up,
}

export default migration080LocalizedAnnouncementBodies
