// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:061' })

const up = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS coding_session_credentials (
      context_id TEXT NOT NULL,
      namespace TEXT NOT NULL,
      encrypted_config TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      updated_by TEXT NOT NULL,
      PRIMARY KEY (context_id, namespace)
    )
  `)
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_coding_session_credentials_updated_at ON coding_session_credentials (updated_at)`,
  )
  log.info('migration 061: coding_session_credentials table created')
}

export const migration061CodingSessionCredentials: Migration = {
  id: '061_coding_session_credentials',
  up,
}

export default migration061CodingSessionCredentials
