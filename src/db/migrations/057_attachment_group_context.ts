// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:057' })

const columnExists = (db: Database, table: string, column: string): boolean =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column)

const up = (db: Database): void => {
  if (!columnExists(db, 'attachments', 'group_context_id')) {
    db.run(`ALTER TABLE attachments ADD COLUMN group_context_id TEXT`)
  }
  if (!columnExists(db, 'staged_files', 'group_context_id')) {
    db.run(`ALTER TABLE staged_files ADD COLUMN group_context_id TEXT`)
  }
  db.run(`CREATE INDEX IF NOT EXISTS idx_attachments_group ON attachments(group_context_id, is_active)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_staged_group ON staged_files(group_context_id, status)`)
  log.info('migration 057: attachment/staged group_context_id added')
}

export const migration057AttachmentGroupContext: Migration = { id: '057_attachment_group_context', up }

export default migration057AttachmentGroupContext
