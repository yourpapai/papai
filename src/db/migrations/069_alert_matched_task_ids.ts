// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:069' })

const columnExists = (db: Database, table: string, column: string): boolean =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column)

const up = (db: Database): void => {
  if (!columnExists(db, 'alert_prompts', 'matched_task_ids')) {
    db.run(`ALTER TABLE alert_prompts ADD COLUMN matched_task_ids TEXT NOT NULL DEFAULT '[]'`)
    log.info('migration 069: matched_task_ids added to alert_prompts')
  }
}

export const migration069AlertMatchedTaskIds: Migration = { id: '069_alert_matched_task_ids', up }

export default migration069AlertMatchedTaskIds
