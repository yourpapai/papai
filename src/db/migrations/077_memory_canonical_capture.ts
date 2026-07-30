// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:077' })

const createCanonicalEvents = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS memory_canonical_events (
      event_id              TEXT NOT NULL PRIMARY KEY,
      idempotency_identity  TEXT NOT NULL UNIQUE,
      content_identity      TEXT NOT NULL,
      scope_id              TEXT NOT NULL,
      scope_type            TEXT NOT NULL CHECK (scope_type IN ('personal', 'group')),
      thread_context_id     TEXT,
      kind                  TEXT NOT NULL,
      content               TEXT NOT NULL,
      summary                TEXT,
      tags                  TEXT NOT NULL DEFAULT '[]',
      confidence            REAL NOT NULL,
      source                TEXT NOT NULL,
      actor_ids             TEXT NOT NULL DEFAULT '[]',
      provenance            TEXT NOT NULL DEFAULT '{}',
      event_time            TEXT NOT NULL,
      ingest_time            TEXT NOT NULL,
      last_observed_at      TEXT NOT NULL,
      valid_from            TEXT,
      valid_until           TEXT,
      expires_at            TEXT,
      supersedes            TEXT,
      record_id             TEXT,
      schema_version        INTEGER NOT NULL,
      capture_version       TEXT NOT NULL
    )
  `)
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_memory_canonical_events_scope_time
      ON memory_canonical_events(scope_type, scope_id, event_time)
  `)
}

const createProjectionOutbox = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS memory_projection_outbox (
      position         INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id         TEXT NOT NULL,
      op               TEXT NOT NULL CHECK (op IN ('capture', 'observe')),
      state            TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'complete', 'failed')),
      attempt_count    INTEGER NOT NULL DEFAULT 0,
      enqueued_at      TEXT NOT NULL,
      last_attempt_at  TEXT,
      last_error       TEXT
    )
  `)
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_memory_projection_outbox_state_position
      ON memory_projection_outbox(state, position)
  `)
}

const createCaptureAttempts = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS memory_canonical_capture_attempts (
      position              INTEGER PRIMARY KEY AUTOINCREMENT,
      idempotency_identity  TEXT NOT NULL,
      content_identity      TEXT NOT NULL,
      scope_id              TEXT NOT NULL,
      scope_type            TEXT NOT NULL CHECK (scope_type IN ('personal', 'group')),
      outcome               TEXT NOT NULL CHECK (
        outcome IN ('captured', 'suppressed-duplicate', 'suppressed-tombstoned', 'failed')
      ),
      event_id              TEXT,
      event_time            TEXT NOT NULL,
      ingest_time            TEXT NOT NULL,
      capture_version       TEXT NOT NULL
    )
  `)
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_memory_canonical_capture_attempts_identity
      ON memory_canonical_capture_attempts(idempotency_identity)
  `)
}

const createCanonicalState = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS memory_canonical_state (
      id          TEXT NOT NULL PRIMARY KEY CHECK (id = 'singleton'),
      cutover_at  TEXT NOT NULL
    )
  `)
  // The cutover marker, not a backfill: canonical history begins here, and nothing earlier is
  // fabricated to look as though it went through this path.
  db.run(`
    INSERT OR IGNORE INTO memory_canonical_state (id, cutover_at)
    VALUES ('singleton', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  `)
}

const up = (db: Database): void => {
  createCanonicalEvents(db)
  createProjectionOutbox(db)
  createCaptureAttempts(db)
  createCanonicalState(db)
  log.info('migration 077: canonical capture tables created; cutover marker recorded')
}

export const migration077MemoryCanonicalCapture: Migration = {
  id: '077_memory_canonical_capture',
  up,
}

export default migration077MemoryCanonicalCapture
