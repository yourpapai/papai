// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:062' })

const taskInstanceIsNullable = (db: Database): boolean => {
  const column = db
    .query<{ name: string; notnull: number }, []>(`PRAGMA table_info(context_settings)`)
    .all()
    .find((row) => row.name === 'task_instance_id')
  return column !== undefined && column.notnull === 0
}

// SQLite cannot drop NOT NULL via ALTER, so rebuild the table. context_settings is a
// leaf (nothing references it), so the drop/rename is safe with foreign_keys on.
const up = (db: Database): void => {
  if (taskInstanceIsNullable(db)) {
    log.info('migration 062: task_instance_id already nullable, skipping')
    return
  }

  db.run(`DROP TABLE IF EXISTS context_settings_new`)
  db.run(`
    CREATE TABLE context_settings_new (
      context_id TEXT PRIMARY KEY,
      task_instance_id TEXT REFERENCES task_instances(id) ON DELETE CASCADE,
      platform_instance_id TEXT NOT NULL REFERENCES platform_instances(id) ON DELETE CASCADE
    )
  `)
  db.run(`
    INSERT INTO context_settings_new (context_id, task_instance_id, platform_instance_id)
    SELECT context_id, task_instance_id, platform_instance_id FROM context_settings
  `)
  db.run(`DROP TABLE context_settings`)
  db.run(`ALTER TABLE context_settings_new RENAME TO context_settings`)
  db.run(`CREATE INDEX idx_context_settings_task_instance ON context_settings (task_instance_id)`)
  db.run(`CREATE INDEX idx_context_settings_platform_instance ON context_settings (platform_instance_id)`)

  log.info('migration 062: context_settings.task_instance_id made nullable')
}

export const migration062NullableContextTaskInstance: Migration = {
  id: '062_nullable_context_task_instance',
  up,
}

export default migration062NullableContextTaskInstance
