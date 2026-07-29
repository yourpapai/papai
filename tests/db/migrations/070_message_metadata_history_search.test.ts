// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, test } from 'bun:test'

import { migration017MessageMetadata } from '../../../src/db/migrations/017_message_metadata.js'
import { migration070MessageMetadataHistorySearch } from '../../../src/db/migrations/070_message_metadata_history_search.js'
import { mockLogger } from '../../utils/test-helpers.js'

function columnsOf(db: Database, table: string): string[] {
  return db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((r) => r.name)
}

describe('migration 070_message_metadata_history_search', () => {
  let db: Database

  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
    db.run('PRAGMA foreign_keys=ON')
    migration017MessageMetadata.up(db)
  })

  test('adds group_context_id, drops expires_at, creates FTS table + triggers', () => {
    expect(columnsOf(db, 'message_metadata')).toContain('expires_at')
    migration070MessageMetadataHistorySearch.up(db)

    const cols = columnsOf(db, 'message_metadata')
    expect(cols).toContain('group_context_id')
    expect(cols).not.toContain('expires_at')

    const fts = db
      .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='table' AND name='message_metadata_fts'`)
      .get()
    expect(fts?.name).toBe('message_metadata_fts')

    const triggers = db
      .query<{ name: string }, []>(
        `SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='message_metadata'`,
      )
      .all()
      .map((r) => r.name)
    expect(triggers).toContain('message_metadata_ai')
    expect(triggers).toContain('message_metadata_au')
    expect(triggers).toContain('message_metadata_ad')
  })

  test('preserves existing rows (minus expires_at) and backfills FTS', () => {
    db.run(
      `INSERT INTO message_metadata (context_id, message_id, author_id, author_username, text, reply_to_message_id, timestamp, expires_at)
       VALUES ('c1', 'm1', 'u1', 'alice', 'deploy the thing', NULL, 1000, 9999999999)`,
    )
    migration070MessageMetadataHistorySearch.up(db)

    const row = db
      .query<{ text: string; group_context_id: string | null }, []>(
        `SELECT text, group_context_id FROM message_metadata WHERE context_id='c1' AND message_id='m1'`,
      )
      .get()
    expect(row?.text).toBe('deploy the thing')
    expect(row?.group_context_id).toBeNull()

    const ftsHit = db
      .query<{ rowid: number }, []>(
        `SELECT m.rowid FROM message_metadata m JOIN message_metadata_fts f ON m.rowid=f.rowid WHERE f.message_metadata_fts MATCH 'deploy'`,
      )
      .get()
    expect(ftsHit).toBeDefined()
  })

  test('FTS trigger keeps index in sync on new inserts', () => {
    migration070MessageMetadataHistorySearch.up(db)
    db.run(
      `INSERT INTO message_metadata (context_id, message_id, text, timestamp, group_context_id) VALUES ('c1','m9','release stability check', 2000, NULL)`,
    )
    const hit = db
      .query<{ rowid: number }, []>(
        `SELECT m.rowid FROM message_metadata m JOIN message_metadata_fts f ON m.rowid=f.rowid WHERE f.message_metadata_fts MATCH 'stability'`,
      )
      .get()
    expect(hit).toBeDefined()
  })
})
