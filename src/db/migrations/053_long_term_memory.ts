// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:053' })

const createProfiles = (db: Database): void => {
  db.run(`
    CREATE TABLE memory_profiles (
      scope_id   TEXT NOT NULL PRIMARY KEY,
      scope_type TEXT NOT NULL CHECK (scope_type IN ('personal', 'group')),
      profile    TEXT NOT NULL DEFAULT '',
      enabled    INTEGER NOT NULL DEFAULT 1,
      version    INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    )
  `)
  db.run(`CREATE INDEX idx_memory_profiles_scope ON memory_profiles(scope_type, scope_id)`)
}

const createRecords = (db: Database): void => {
  db.run(`
    CREATE TABLE memory_records (
      id            TEXT PRIMARY KEY,
      scope_id      TEXT NOT NULL,
      scope_type    TEXT NOT NULL CHECK (scope_type IN ('personal', 'group')),
      kind          TEXT NOT NULL CHECK (kind IN ('preference', 'fact', 'decision', 'project_context', 'person_context', 'procedure', 'episode', 'reference')),
      content       TEXT NOT NULL,
      summary       TEXT,
      tags          TEXT NOT NULL DEFAULT '[]',
      confidence    REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      status        TEXT NOT NULL CHECK (status IN ('active', 'stale', 'archived', 'contradicted')),
      source        TEXT NOT NULL CHECK (source IN ('background', 'explicit', 'tool_result', 'admin_edit')),
      evidence      TEXT NOT NULL DEFAULT '{}',
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      last_seen_at  TEXT NOT NULL,
      valid_from    TEXT,
      valid_until   TEXT,
      expires_at    TEXT,
      embedding     BLOB
    )
  `)
  db.run(`CREATE INDEX idx_memory_records_scope_status_seen ON memory_records(scope_id, status, last_seen_at DESC)`)
  db.run(`CREATE INDEX idx_memory_records_scope_kind_status ON memory_records(scope_id, kind, status)`)
}

const createFts = (db: Database): void => {
  db.run(`
    CREATE VIRTUAL TABLE memory_records_fts
      USING fts5(content, summary, tags, content='memory_records', content_rowid='rowid')
  `)
  db.run(`
    CREATE TRIGGER memory_records_ai AFTER INSERT ON memory_records BEGIN
      INSERT INTO memory_records_fts(rowid, content, summary, tags)
      VALUES (new.rowid, new.content, new.summary, new.tags);
    END
  `)
  db.run(`
    CREATE TRIGGER memory_records_au AFTER UPDATE ON memory_records BEGIN
      INSERT INTO memory_records_fts(memory_records_fts, rowid, content, summary, tags)
      VALUES ('delete', old.rowid, old.content, old.summary, old.tags);
      INSERT INTO memory_records_fts(rowid, content, summary, tags)
      VALUES (new.rowid, new.content, new.summary, new.tags);
    END
  `)
  db.run(`
    CREATE TRIGGER memory_records_ad AFTER DELETE ON memory_records BEGIN
      INSERT INTO memory_records_fts(memory_records_fts, rowid, content, summary, tags)
      VALUES ('delete', old.rowid, old.content, old.summary, old.tags);
    END
  `)
}

const up = (db: Database): void => {
  createProfiles(db)
  createRecords(db)
  createFts(db)
  log.info('migration 053: long-term memory tables created')
}

export const migration053LongTermMemory: Migration = {
  id: '053_long_term_memory',
  up,
}

export default migration053LongTermMemory
