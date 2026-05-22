// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:035' })

const up = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS llm_usage_events (
      event_id           TEXT PRIMARY KEY,
      occurred_at        INTEGER NOT NULL,
      turn_id            TEXT,
      storage_context_id TEXT NOT NULL,
      context_type       TEXT NOT NULL,
      chat_user_id       TEXT NOT NULL,
      model              TEXT NOT NULL,
      model_role         TEXT NOT NULL,
      input_tokens       INTEGER,
      output_tokens      INTEGER,
      step_count         INTEGER NOT NULL DEFAULT 0,
      tool_call_count    INTEGER NOT NULL DEFAULT 0,
      message_count      INTEGER NOT NULL DEFAULT 0,
      finish_reason      TEXT,
      duration_ms        INTEGER NOT NULL,
      response_id        TEXT,
      error              TEXT
    )
  `)
  db.run('CREATE INDEX IF NOT EXISTS idx_llm_usage_subject ON llm_usage_events(storage_context_id, occurred_at)')
  db.run('CREATE INDEX IF NOT EXISTS idx_llm_usage_chat_user ON llm_usage_events(chat_user_id, occurred_at)')
  db.run('CREATE INDEX IF NOT EXISTS idx_llm_usage_turn ON llm_usage_events(turn_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_llm_usage_occurred ON llm_usage_events(occurred_at)')
  log.info('migration 035: created llm_usage_events table and indexes')
}

export const migration035LlmUsageEvents: Migration = {
  id: '035_llm_usage_events',
  up,
}

export default migration035LlmUsageEvents
