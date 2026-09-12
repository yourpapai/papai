// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:083' })

const columnExists = (db: Database, table: string, column: string): boolean =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column)

const up = (db: Database): void => {
  if (!columnExists(db, 'llm_providers', 'base_provider')) {
    db.run(`ALTER TABLE llm_providers ADD COLUMN base_provider TEXT`)
    log.info('migration 083: base_provider added to llm_providers')
  }
  if (!columnExists(db, 'llm_providers', 'base_model')) {
    db.run(`ALTER TABLE llm_providers ADD COLUMN base_model TEXT`)
    log.info('migration 083: base_model added to llm_providers')
  }
}

export const migration083LlmProviderBaseRefs: Migration = {
  id: '083_llm_provider_base_refs',
  up,
}

export default migration083LlmProviderBaseRefs
