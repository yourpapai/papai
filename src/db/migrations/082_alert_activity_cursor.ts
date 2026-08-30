// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:082' })

const columnExists = (db: Database, table: string, column: string): boolean =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column)

const up = (db: Database): void => {
  if (!columnExists(db, 'alert_prompts', 'last_activity_cursor')) {
    db.run(`ALTER TABLE alert_prompts ADD COLUMN last_activity_cursor TEXT`)
    log.info('migration 082: last_activity_cursor added to alert_prompts')
  }
}

export const migration082AlertActivityCursor: Migration = {
  id: '082_alert_activity_cursor',
  up,
}

export default migration082AlertActivityCursor
