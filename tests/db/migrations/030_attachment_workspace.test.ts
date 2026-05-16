// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration030AttachmentWorkspace } from '../../../src/db/migrations/030_attachment_workspace.js'
import { mockLogger } from '../../utils/test-helpers.js'

const getNames = (db: Database, type: 'table' | 'index'): string[] =>
  db
    .query<{ name: string }, [string]>('SELECT name FROM sqlite_master WHERE type = ?')
    .all(type)
    .map((row) => row.name)

describe('migration030AttachmentWorkspace', () => {
  let db: Database

  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  test('creates attachments table and active-state indexes', () => {
    migration030AttachmentWorkspace.up(db)

    expect(getNames(db, 'table')).toContain('attachments')
    expect(getNames(db, 'index')).toContain('idx_attachments_context_active')
    expect(getNames(db, 'index')).toContain('idx_attachments_context_checksum')
  })

  test('rows can store the S3 blob_key and source metadata', () => {
    migration030AttachmentWorkspace.up(db)

    db.run(
      `INSERT INTO attachments (
         attachment_id, context_id, source_provider, source_message_id, source_file_id,
         filename, mime_type, size, checksum, blob_key, status, is_active, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'att_1',
        'ctx-1',
        'telegram',
        'm-1',
        'tg-file-1',
        'photo.jpg',
        'image/jpeg',
        4,
        'deadbeef',
        'ctx-1/att_1',
        'available',
        1,
        '2026-04-25T00:00:00Z',
      ],
    )

    const row = db
      .query<{ blob_key: string; status: string; is_active: number }, [string]>(
        'SELECT blob_key, status, is_active FROM attachments WHERE attachment_id = ?',
      )
      .get('att_1')

    expect(row).not.toBeNull()
    expect(row!.blob_key).toBe('ctx-1/att_1')
    expect(row!.status).toBe('available')
    expect(row!.is_active).toBe(1)
  })
})
