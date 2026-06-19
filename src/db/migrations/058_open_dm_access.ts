// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:058' })

const columnExists = (db: Database, table: string, column: string): boolean =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column)

const up = (db: Database): void => {
  if (!columnExists(db, 'platform_instances', 'open_dm_access')) {
    db.run(`ALTER TABLE platform_instances ADD COLUMN open_dm_access INTEGER NOT NULL DEFAULT 0`)
  }
  if (!columnExists(db, 'users', 'blocked_at')) {
    db.run(`ALTER TABLE users ADD COLUMN blocked_at TEXT`)
  }
  log.info('migration 058: open_dm_access + blocked_at added')
}

export const migration058OpenDmAccess: Migration = { id: '058_open_dm_access', up }

export default migration058OpenDmAccess
