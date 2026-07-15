// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:067' })

const columnExists = (db: Database, table: string, column: string): boolean =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column)

const up = (db: Database): void => {
  if (!columnExists(db, 'platform_instances', 'mattermost_last_event_at')) {
    db.run(`ALTER TABLE platform_instances ADD COLUMN mattermost_last_event_at INTEGER`)
  }
  log.info('migration 067: platform_instances.mattermost_last_event_at column added')
}

export const migration067MattermostCatchupCursor: Migration = {
  id: '067_mattermost_catchup_cursor',
  up,
}

export default migration067MattermostCatchupCursor
