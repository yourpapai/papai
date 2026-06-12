// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:052' })

const up = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS byok_llm_credentials (
      context_id TEXT NOT NULL PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      encrypted_config TEXT,
      updated_at INTEGER NOT NULL,
      updated_by TEXT NOT NULL
    )
  `)
  db.run(`CREATE INDEX IF NOT EXISTS idx_byok_llm_credentials_updated_at ON byok_llm_credentials (updated_at)`)
  log.info('migration 052: BYOK LLM credentials table created')
}

export const migration052ByokLlmCredentials: Migration = {
  id: '052_byok_llm_credentials',
  up,
}

export default migration052ByokLlmCredentials
