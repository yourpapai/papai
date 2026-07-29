// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:072' })

const COLUMNS: readonly (readonly [string, string])[] = [
  ['embedding_model', 'TEXT'],
  ['embedding_dimension', 'INTEGER'],
  ['embedding_version', 'TEXT'],
  ['embedded_at', 'TEXT'],
]

const columnExists = (db: Database, table: string, column: string): boolean =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column)

const up = (db: Database): void => {
  for (const [name, type] of COLUMNS) {
    if (!columnExists(db, 'memory_records', name)) {
      db.run(`ALTER TABLE memory_records ADD COLUMN ${name} ${type}`)
    }
  }

  // Rows embedded before this migration have an unidentifiable vector. Mark them
  // so the backfill can find them and the dense channel can exclude them.
  db.run(`
    UPDATE memory_records
       SET embedding_version = 'unknown'
     WHERE embedding IS NOT NULL
       AND embedding_version IS NULL
  `)

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_memory_records_embedding_backfill
      ON memory_records(scope_type, scope_id)
      WHERE embedding IS NULL OR embedding_version = 'unknown'
  `)

  log.info('migration 072: embedding identity columns added to memory_records')
}

export const migration072MemoryEmbeddingIdentity: Migration = {
  id: '072_memory_embedding_identity',
  up,
}

export default migration072MemoryEmbeddingIdentity
