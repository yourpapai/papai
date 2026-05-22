// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:038' })

const columnExists = (db: Database, table: string, column: string): boolean => {
  const rows = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all()
  return rows.some((row) => row.name === column)
}

const up = (db: Database): void => {
  if (!columnExists(db, 'llm_usage_events', 'forwarded_at')) {
    db.run('ALTER TABLE llm_usage_events ADD COLUMN forwarded_at INTEGER')
  }
  if (!columnExists(db, 'llm_usage_events', 'forward_attempts')) {
    db.run('ALTER TABLE llm_usage_events ADD COLUMN forward_attempts INTEGER NOT NULL DEFAULT 0')
  }
  if (!columnExists(db, 'llm_usage_events', 'forward_error')) {
    db.run('ALTER TABLE llm_usage_events ADD COLUMN forward_error TEXT')
  }
  db.run('CREATE INDEX IF NOT EXISTS idx_llm_usage_outbox ON llm_usage_events(occurred_at) WHERE forwarded_at IS NULL')
  log.info('migration 038: added outbox columns + index to llm_usage_events')
}

export const migration038LlmUsageEventsOutbox: Migration = {
  id: '038_llm_usage_events_outbox',
  up,
}

export default migration038LlmUsageEventsOutbox
