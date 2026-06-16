// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:056' })

const columnExists = (db: Database, table: string, column: string): boolean => {
  const rows = db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all()
  return rows.some((row) => row.name === column)
}

const createNewMemoryRecords = (db: Database): void => {
  db.run(`
    CREATE TABLE memory_records (
      id                TEXT PRIMARY KEY,
      scope_id          TEXT NOT NULL,
      scope_type        TEXT NOT NULL CHECK (scope_type IN ('personal', 'group')),
      kind              TEXT NOT NULL CHECK (kind IN ('preference', 'fact', 'decision', 'project_context', 'person_context', 'procedure', 'episode', 'reference')),
      content           TEXT NOT NULL,
      summary           TEXT,
      tags              TEXT NOT NULL DEFAULT '[]',
      confidence        REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      status            TEXT NOT NULL CHECK (status IN ('active', 'stale', 'archived', 'contradicted', 'provisional')),
      source            TEXT NOT NULL CHECK (source IN ('background', 'explicit', 'tool_result', 'admin_edit')),
      evidence          TEXT NOT NULL DEFAULT '{}',
      thread_context_id TEXT,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL,
      last_seen_at      TEXT NOT NULL,
      valid_from        TEXT,
      valid_until       TEXT,
      expires_at        TEXT,
      embedding         BLOB
    )
  `)
  db.run(`
    INSERT INTO memory_records
      (id, scope_id, scope_type, kind, content, summary, tags, confidence, status,
       source, evidence, thread_context_id, created_at, updated_at, last_seen_at,
       valid_from, valid_until, expires_at, embedding)
    SELECT
      id, scope_id, scope_type, kind, content, summary, tags, confidence, status,
      source, evidence, NULL, created_at, updated_at, last_seen_at,
      valid_from, valid_until, expires_at, embedding
    FROM memory_records_old
  `)
  db.run(`DROP TABLE memory_records_old`)
}

const recreateIndexes = (db: Database): void => {
  db.run(`CREATE INDEX IF NOT EXISTS idx_memory_records_scope_status_seen
    ON memory_records(scope_id, status, last_seen_at DESC)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_memory_records_scope_kind_status
    ON memory_records(scope_id, kind, status)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_memory_records_thread
    ON memory_records(scope_id, thread_context_id, status)`)
}

const recreateFtsTriggers = (db: Database): void => {
  db.run(`DROP TRIGGER IF EXISTS memory_records_ai`)
  db.run(`DROP TRIGGER IF EXISTS memory_records_au`)
  db.run(`DROP TRIGGER IF EXISTS memory_records_ad`)
  db.run(`
    CREATE TRIGGER IF NOT EXISTS memory_records_ai AFTER INSERT ON memory_records BEGIN
      INSERT INTO memory_records_fts(rowid, content, summary, tags)
      VALUES (new.rowid, new.content, new.summary, new.tags);
    END
  `)
  db.run(`
    CREATE TRIGGER IF NOT EXISTS memory_records_au AFTER UPDATE ON memory_records BEGIN
      INSERT INTO memory_records_fts(memory_records_fts, rowid, content, summary, tags)
      VALUES ('delete', old.rowid, old.content, old.summary, old.tags);
      INSERT INTO memory_records_fts(rowid, content, summary, tags)
      VALUES (new.rowid, new.content, new.summary, new.tags);
    END
  `)
  db.run(`
    CREATE TRIGGER IF NOT EXISTS memory_records_ad AFTER DELETE ON memory_records BEGIN
      INSERT INTO memory_records_fts(memory_records_fts, rowid, content, summary, tags)
      VALUES ('delete', old.rowid, old.content, old.summary, old.tags);
    END
  `)
}

const widenMemoryRecordsStatus = (db: Database): void => {
  // SQLite does not support ALTER TABLE to modify CHECK constraints.
  // Use the table-recreation pattern to widen the status enum and add thread_context_id.
  db.run(`PRAGMA foreign_keys=OFF`)
  try {
    db.run(`ALTER TABLE memory_records RENAME TO memory_records_old`)
    createNewMemoryRecords(db)
  } finally {
    db.run(`PRAGMA foreign_keys=ON`)
  }
  recreateIndexes(db)
  recreateFtsTriggers(db)
}

const up = (db: Database): void => {
  if (columnExists(db, 'memory_records', 'thread_context_id')) {
    // Already migrated; still ensure the thread index exists
    db.run(`CREATE INDEX IF NOT EXISTS idx_memory_records_thread
      ON memory_records(scope_id, thread_context_id, status)`)
  } else {
    widenMemoryRecordsStatus(db)
  }
  db.run(`CREATE TABLE IF NOT EXISTS memory_extraction_state (
    context_id TEXT PRIMARY KEY,
    context_type TEXT NOT NULL,
    config_context_id TEXT NOT NULL,
    last_activity_at TEXT NOT NULL,
    last_extracted_at TEXT,
    last_history_len INTEGER NOT NULL DEFAULT 0
  )`)
  log.info('migration 056: provisional memory tier + extraction-state added')
}

export const migration056ProvisionalMemory: Migration = {
  id: '056_provisional_memory',
  up,
}

export default migration056ProvisionalMemory
