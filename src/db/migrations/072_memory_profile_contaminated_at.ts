// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:072' })

const up = (db: Database): void => {
  // Nullable, no backfill: NULL means "not contaminated", which is correct for
  // every profile that predates this column — none of them were ever purged.
  db.run(`
    ALTER TABLE memory_profiles
      ADD COLUMN contaminated_at TEXT
  `)
  log.info('migration 072: memory_profiles.contaminated_at column added')
}

export const migration072MemoryProfileContaminatedAt: Migration = {
  id: '072_memory_profile_contaminated_at',
  up,
}

export default migration072MemoryProfileContaminatedAt
