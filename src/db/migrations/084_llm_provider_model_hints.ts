// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:084' })

const columnExists = (db: Database, table: string, column: string): boolean =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column)

const up = (db: Database): void => {
  if (!columnExists(db, 'llm_providers', 'model_hints')) {
    db.run(`ALTER TABLE llm_providers ADD COLUMN model_hints TEXT`)
    log.info('migration 084: model_hints added to llm_providers')
  }
}

export const migration084LlmProviderModelHints: Migration = {
  id: '084_llm_provider_model_hints',
  up,
}

export default migration084LlmProviderModelHints
