// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration033StagedFilesUniquePlatformContext } from '../../../src/db/migrations/033_staged_files_unique_platform_context.js'
import { mockLogger } from '../../utils/test-helpers.js'

const getNames = (db: Database, type: 'table' | 'index'): string[] =>
  db
    .query<{ name: string }, [string]>('SELECT name FROM sqlite_master WHERE type = ?')
    .all(type)
    .map((row) => row.name)

describe('migration033StagedFilesUniquePlatformContext', () => {
  let db: Database

  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  test('creates unique index on (platform_file_id, context_id)', () => {
    db.run(`
      CREATE TABLE staged_files (
        staged_id         TEXT PRIMARY KEY,
        context_id        TEXT NOT NULL,
        message_id        TEXT,
        sender_id         TEXT NOT NULL,
        sender_username   TEXT,
        filename          TEXT NOT NULL,
        mime_type         TEXT,
        size              INTEGER,
        platform_file_id  TEXT NOT NULL,
        source_provider   TEXT NOT NULL,
        status            TEXT NOT NULL DEFAULT 'staged',
        created_at        TEXT NOT NULL,
        expires_at        TEXT NOT NULL
      )
    `)

    migration033StagedFilesUniquePlatformContext.up(db)

    expect(getNames(db, 'index')).toContain('idx_staged_platform_context')

    // The index should prevent duplicate (platform_file_id, context_id) pairs
    db.run(
      `INSERT INTO staged_files (
         staged_id, context_id, message_id, sender_id, sender_username,
         filename, mime_type, size, platform_file_id, source_provider,
         status, created_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'stg_1',
        'ctx-1',
        'msg-1',
        'user-1',
        'alice',
        'report.pdf',
        'application/pdf',
        1024,
        'tg_file_123',
        'telegram',
        'staged',
        '2026-05-12T00:00:00Z',
        '2026-05-13T00:00:00Z',
      ],
    )

    expect(() =>
      db.run(
        `INSERT INTO staged_files (
           staged_id, context_id, message_id, sender_id, sender_username,
           filename, mime_type, size, platform_file_id, source_provider,
           status, created_at, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'stg_2',
          'ctx-1',
          'msg-2',
          'user-2',
          'bob',
          'report2.pdf',
          'application/pdf',
          2048,
          'tg_file_123',
          'telegram',
          'staged',
          '2026-05-12T00:00:00Z',
          '2026-05-13T00:00:00Z',
        ],
      ),
    ).toThrow()
  })
})
