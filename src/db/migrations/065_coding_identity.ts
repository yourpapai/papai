// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:065' })

const columnExists = (db: Database, table: string, column: string): boolean =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column)

const up = (db: Database): void => {
  if (!columnExists(db, 'authorized_groups', 'coding_identity')) {
    db.run(`ALTER TABLE authorized_groups ADD COLUMN coding_identity TEXT NOT NULL DEFAULT 'initiator'`)
  }
  log.info('migration 065: coding_identity added to authorized_groups')
}

export const migration065CodingIdentity: Migration = { id: '065_coding_identity', up }

export default migration065CodingIdentity
