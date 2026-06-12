// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:054' })

const columnExists = (db: Database, table: string, column: string): boolean => {
  const rows = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all()
  return rows.some((row) => row.name === column)
}

const up = (db: Database): void => {
  if (!columnExists(db, 'attachments', 'origin')) {
    db.run(`ALTER TABLE attachments ADD COLUMN origin TEXT`)
  }
  if (!columnExists(db, 'attachments', 'forwarded_from')) {
    db.run(`ALTER TABLE attachments ADD COLUMN forwarded_from TEXT`)
  }
  if (!columnExists(db, 'staged_files', 'origin')) {
    db.run(`ALTER TABLE staged_files ADD COLUMN origin TEXT`)
  }
  if (!columnExists(db, 'staged_files', 'forwarded_from')) {
    db.run(`ALTER TABLE staged_files ADD COLUMN forwarded_from TEXT`)
  }
  log.info('migration 054: attachment origin columns added')
}

export const migration054AttachmentOrigin: Migration = {
  id: '054_attachment_origin',
  up,
}

export default migration054AttachmentOrigin
