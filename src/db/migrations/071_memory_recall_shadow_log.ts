// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:071' })

const up = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS memory_recall_shadow_log (
      id                      TEXT NOT NULL PRIMARY KEY,
      created_at              INTEGER NOT NULL,
      scope_hash               TEXT NOT NULL,
      context_hash             TEXT NOT NULL,
      turn_ref                 TEXT NOT NULL,
      reader_model_id          TEXT NOT NULL,
      active_record_count      INTEGER NOT NULL,
      shadow_query_hash        TEXT NOT NULL,
      shadow_query_len_bucket  TEXT NOT NULL CHECK (shadow_query_len_bucket IN ('short', 'medium', 'long')),
      shadow_hit_count         INTEGER NOT NULL,
      shadow_top_score         REAL,
      shadow_top_provenance    TEXT CHECK (
        shadow_top_provenance IS NULL
        OR shadow_top_provenance IN ('current', 'group', 'other-thread')
      ),
      shadow_top_record_hash   TEXT,
      model_pulled             INTEGER NOT NULL,
      pull_count               INTEGER NOT NULL,
      pull_query_hash          TEXT,
      pull_result_count        INTEGER NOT NULL,
      shadow_pull_overlap      INTEGER NOT NULL,
      skipped_reason           TEXT CHECK (
        skipped_reason IS NULL
        OR skipped_reason IN ('no-active-records')
      )
    )
  `)
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_memory_recall_shadow_log_reader_model_created
      ON memory_recall_shadow_log(reader_model_id, created_at)
  `)
  log.info('migration 071: memory_recall_shadow_log table created')
}

export const migration071MemoryRecallShadowLog: Migration = {
  id: '071_memory_recall_shadow_log',
  up,
}

export default migration071MemoryRecallShadowLog
