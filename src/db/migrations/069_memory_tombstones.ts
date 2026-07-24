// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:069' })

const up = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS memory_tombstones (
      scope_id     TEXT NOT NULL,
      scope_type   TEXT NOT NULL CHECK (scope_type IN ('personal', 'group')),
      content_hash TEXT NOT NULL,
      forgotten_at TEXT NOT NULL,
      PRIMARY KEY (scope_type, scope_id, content_hash)
    )
  `)
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_memory_tombstones_scope
      ON memory_tombstones(scope_type, scope_id)
  `)
  log.info('migration 069: memory_tombstones table created')
}

export const migration069MemoryTombstones: Migration = {
  id: '069_memory_tombstones',
  up,
}

export default migration069MemoryTombstones
