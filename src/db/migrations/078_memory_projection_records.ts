// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:078' })

const up = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS memory_projection_records (
      projection_key        TEXT NOT NULL PRIMARY KEY,
      record_id             TEXT,
      event_id              TEXT NOT NULL,
      idempotency_identity  TEXT NOT NULL,
      content_identity      TEXT NOT NULL,
      scope_id              TEXT NOT NULL,
      scope_type            TEXT NOT NULL CHECK (scope_type IN ('personal', 'group')),
      thread_context_id     TEXT,
      kind                  TEXT NOT NULL,
      content               TEXT NOT NULL,
      summary                TEXT,
      tags                  TEXT NOT NULL DEFAULT '[]',
      confidence            REAL NOT NULL,
      source                TEXT NOT NULL,
      actor_ids             TEXT NOT NULL DEFAULT '[]',
      provenance            TEXT NOT NULL DEFAULT '{}',
      event_time            TEXT NOT NULL,
      last_observed_at      TEXT NOT NULL,
      valid_from            TEXT,
      valid_until           TEXT,
      expires_at            TEXT,
      schema_version        INTEGER NOT NULL,
      capture_version       TEXT NOT NULL,
      projected_at          TEXT NOT NULL
    )
  `)
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_memory_projection_records_scope
      ON memory_projection_records(scope_type, scope_id)
  `)
  log.info('migration 078: shadow projection table created')
}

export const migration078MemoryProjectionRecords: Migration = {
  id: '078_memory_projection_records',
  up,
}

export default migration078MemoryProjectionRecords
