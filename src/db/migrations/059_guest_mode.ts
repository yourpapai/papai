// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:059' })

const columnExists = (db: Database, table: string, column: string): boolean =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column)

const up = (db: Database): void => {
  if (!columnExists(db, 'authorized_groups', 'guest_mode')) {
    db.run(`ALTER TABLE authorized_groups ADD COLUMN guest_mode INTEGER NOT NULL DEFAULT 0`)
  }
  log.info('migration 059: guest_mode added to authorized_groups')
}

export const migration059GuestMode: Migration = { id: '059_guest_mode', up }

export default migration059GuestMode
