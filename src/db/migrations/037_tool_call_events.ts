// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:037' })

const up = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS tool_call_events (
      event_id           TEXT PRIMARY KEY,
      turn_id            TEXT NOT NULL,
      occurred_at        INTEGER NOT NULL,
      storage_context_id TEXT NOT NULL,
      context_type       TEXT NOT NULL,
      chat_user_id       TEXT NOT NULL,
      model              TEXT NOT NULL,
      model_role         TEXT NOT NULL,
      tool_name          TEXT NOT NULL,
      tool_call_id       TEXT NOT NULL,
      success            INTEGER NOT NULL,
      duration_ms        INTEGER,
      error_type         TEXT,
      error_code         TEXT,
      retryable          INTEGER,
      recovered          INTEGER,
      args_bytes         INTEGER,
      result_bytes       INTEGER,
      response_id        TEXT,
      forwarded_at       INTEGER,
      forward_attempts   INTEGER NOT NULL DEFAULT 0,
      forward_error      TEXT
    )
  `)
  db.run('CREATE INDEX IF NOT EXISTS idx_tool_call_subject ON tool_call_events(storage_context_id, occurred_at)')
  db.run('CREATE INDEX IF NOT EXISTS idx_tool_call_chat_user ON tool_call_events(chat_user_id, occurred_at)')
  db.run('CREATE INDEX IF NOT EXISTS idx_tool_call_turn ON tool_call_events(turn_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_tool_call_tool ON tool_call_events(tool_name, occurred_at)')
  db.run('CREATE INDEX IF NOT EXISTS idx_tool_call_outbox ON tool_call_events(occurred_at) WHERE forwarded_at IS NULL')
  log.info('migration 037: created tool_call_events table and indexes')
}

export const migration037ToolCallEvents: Migration = {
  id: '037_tool_call_events',
  up,
}

export default migration037ToolCallEvents
