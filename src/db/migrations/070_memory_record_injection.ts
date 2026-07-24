// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:070' })

const up = (db: Database): void => {
  db.run(`
    ALTER TABLE memory_profiles
      ADD COLUMN inject_records INTEGER NOT NULL DEFAULT 0
  `)
  log.info('migration 070: memory_profiles.inject_records column added')
}

export const migration070MemoryRecordInjection: Migration = {
  id: '070_memory_record_injection',
  up,
}

export default migration070MemoryRecordInjection
