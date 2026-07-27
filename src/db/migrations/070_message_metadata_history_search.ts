// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:070' })

const up = (db: Database): void => {
  // SQLite cannot relax NOT NULL on expires_at in place; rebuild the table to
  // add group_context_id and drop the now-vestigial expires_at (retention is unlimited).
  db.run(`
    CREATE TABLE message_metadata_new (
      context_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      author_id TEXT,
      author_username TEXT,
      text TEXT,
      reply_to_message_id TEXT,
      group_context_id TEXT,
      timestamp INTEGER NOT NULL,
      PRIMARY KEY (context_id, message_id)
    )
  `)
  db.run(`
    INSERT INTO message_metadata_new (context_id, message_id, author_id, author_username, text, reply_to_message_id, group_context_id, timestamp)
    SELECT context_id, message_id, author_id, author_username, text, reply_to_message_id, NULL, timestamp FROM message_metadata
  `)
  db.run(`DROP TABLE message_metadata`)
  db.run(`ALTER TABLE message_metadata_new RENAME TO message_metadata`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_message_metadata_group_ctx ON message_metadata(group_context_id)`)
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_message_metadata_reply_to ON message_metadata(context_id, reply_to_message_id)`,
  )
  createFtsIndex(db)
  log.info('migration 070: message_metadata rebuilt with group_context_id; expires_at dropped; FTS5 added')
}

// FTS5 external-content index over text only (author/thread/time filter via content-table columns).
const createFtsIndex = (db: Database): void => {
  db.run(
    `CREATE VIRTUAL TABLE message_metadata_fts USING fts5(text, content='message_metadata', content_rowid='rowid')`,
  )
  db.run(`INSERT INTO message_metadata_fts(rowid, text) SELECT rowid, COALESCE(text, '') FROM message_metadata`)

  // External-content sync triggers (COALESCE so NULL text still maps 1:1 by rowid).
  db.run(`
    CREATE TRIGGER message_metadata_ai AFTER INSERT ON message_metadata BEGIN
      INSERT INTO message_metadata_fts(rowid, text) VALUES (new.rowid, COALESCE(new.text, ''));
    END
  `)
  db.run(`
    CREATE TRIGGER message_metadata_au AFTER UPDATE ON message_metadata BEGIN
      INSERT INTO message_metadata_fts(message_metadata_fts, rowid, text) VALUES ('delete', old.rowid, COALESCE(old.text, ''));
      INSERT INTO message_metadata_fts(rowid, text) VALUES (new.rowid, COALESCE(new.text, ''));
    END
  `)
  db.run(`
    CREATE TRIGGER message_metadata_ad AFTER DELETE ON message_metadata BEGIN
      INSERT INTO message_metadata_fts(message_metadata_fts, rowid, text) VALUES ('delete', old.rowid, COALESCE(old.text, ''));
    END
  `)
}

export const migration070MessageMetadataHistorySearch: Migration = {
  id: '070_message_metadata_history_search',
  up,
}

export default migration070MessageMetadataHistorySearch
