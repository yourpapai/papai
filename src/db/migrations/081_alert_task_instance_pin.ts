// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:081' })

const columnExists = (db: Database, table: string, column: string): boolean =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column)

const up = (db: Database): void => {
  if (!columnExists(db, 'alert_prompts', 'task_instance_id')) {
    db.run(`ALTER TABLE alert_prompts ADD COLUMN task_instance_id TEXT REFERENCES task_instances(id) ON DELETE CASCADE`)
    log.info('migration 081: task_instance_id added to alert_prompts')
  }
}

export const migration081AlertTaskInstancePin: Migration = {
  id: '081_alert_task_instance_pin',
  up,
}

export default migration081AlertTaskInstancePin
