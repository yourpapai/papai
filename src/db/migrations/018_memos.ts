// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { Migration } from '../migrate.js'

function createMemosTable(db: Database): void {
  db.run(`
    CREATE TABLE memos (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      content     TEXT NOT NULL,
      summary     TEXT,
      tags        TEXT NOT NULL DEFAULT '[]',
      embedding   BLOB,
      status      TEXT NOT NULL DEFAULT 'active',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  db.run(`CREATE INDEX idx_memos_user_status_created ON memos(user_id, status, created_at DESC)`)
}

function createFts5(db: Database): void {
  db.run(`
    CREATE VIRTUAL TABLE memos_fts
      USING fts5(content, summary, tags, content='memos', content_rowid='rowid')
  `)
  db.run(`
    CREATE TRIGGER memos_ai AFTER INSERT ON memos BEGIN
      INSERT INTO memos_fts(rowid, content, summary, tags)
      VALUES (new.rowid, new.content, new.summary, new.tags);
    END
  `)
  db.run(`
    CREATE TRIGGER memos_au AFTER UPDATE ON memos BEGIN
      INSERT INTO memos_fts(memos_fts, rowid, content, summary, tags)
      VALUES ('delete', old.rowid, old.content, old.summary, old.tags);
      INSERT INTO memos_fts(rowid, content, summary, tags)
      VALUES (new.rowid, new.content, new.summary, new.tags);
    END
  `)
  db.run(`
    CREATE TRIGGER memos_ad AFTER DELETE ON memos BEGIN
      INSERT INTO memos_fts(memos_fts, rowid, content, summary, tags)
      VALUES ('delete', old.rowid, old.content, old.summary, old.tags);
    END
  `)
}

function createMemoLinksTable(db: Database): void {
  db.run(`
    CREATE TABLE memo_links (
      id              TEXT PRIMARY KEY,
      source_memo_id  TEXT NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
      target_memo_id  TEXT REFERENCES memos(id) ON DELETE SET NULL,
      target_task_id  TEXT,
      relation_type   TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  db.run(`CREATE INDEX idx_memo_links_source ON memo_links(source_memo_id)`)
  db.run(`CREATE INDEX idx_memo_links_target_memo ON memo_links(target_memo_id)`)
}

export const migration018Memos: Migration = {
  id: '018_memos',
  up(db: Database): void {
    createMemosTable(db)
    createFts5(db)
    createMemoLinksTable(db)
  },
}
