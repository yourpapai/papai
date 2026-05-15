// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { migration032StagedAttachmentId } from '../../../src/db/migrations/032_staged_attachment_id.js'

describe('migration 032_staged_attachment_id', () => {
  test('has correct id', () => {
    expect(migration032StagedAttachmentId.id).toBe('032_staged_attachment_id')
  })

  test('up adds attachment_id column to staged_files', () => {
    const db = new Database(':memory:')
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

    migration032StagedAttachmentId.up(db)

    const columns = db.query<{ name: string }, []>("SELECT name FROM pragma_table_info('staged_files')").all()
    const columnNames = columns.map((c) => c.name)
    expect(columnNames).toContain('attachment_id')
  })
})
