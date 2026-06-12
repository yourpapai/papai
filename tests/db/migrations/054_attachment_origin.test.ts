// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { migration054AttachmentOrigin } from '../../../src/db/migrations/054_attachment_origin.js'

describe('migration 054_attachment_origin', () => {
  test('has correct id', () => {
    expect(migration054AttachmentOrigin.id).toBe('054_attachment_origin')
  })

  test('up adds origin and forwarded_from to attachments', () => {
    const db = new Database(':memory:')
    db.run(`
      CREATE TABLE attachments (
        attachment_id   TEXT PRIMARY KEY,
        context_id      TEXT NOT NULL,
        source_provider TEXT NOT NULL,
        filename        TEXT NOT NULL,
        checksum        TEXT NOT NULL,
        blob_key        TEXT NOT NULL,
        status          TEXT NOT NULL,
        is_active       INTEGER NOT NULL DEFAULT 1,
        created_at      TEXT NOT NULL
      )
    `)
    db.run(`
      CREATE TABLE staged_files (
        staged_id         TEXT PRIMARY KEY,
        context_id        TEXT NOT NULL,
        sender_id         TEXT NOT NULL,
        filename          TEXT NOT NULL,
        platform_file_id  TEXT NOT NULL,
        source_provider   TEXT NOT NULL,
        status            TEXT NOT NULL DEFAULT 'staged',
        created_at        TEXT NOT NULL,
        expires_at        TEXT NOT NULL
      )
    `)

    migration054AttachmentOrigin.up(db)

    const columns = db.query<{ name: string }, []>("SELECT name FROM pragma_table_info('attachments')").all()
    const columnNames = columns.map((c) => c.name)
    expect(columnNames).toContain('origin')
    expect(columnNames).toContain('forwarded_from')
  })

  test('up adds origin and forwarded_from to staged_files', () => {
    const db = new Database(':memory:')
    db.run(`
      CREATE TABLE attachments (
        attachment_id   TEXT PRIMARY KEY,
        context_id      TEXT NOT NULL,
        source_provider TEXT NOT NULL,
        filename        TEXT NOT NULL,
        checksum        TEXT NOT NULL,
        blob_key        TEXT NOT NULL,
        status          TEXT NOT NULL,
        is_active       INTEGER NOT NULL DEFAULT 1,
        created_at      TEXT NOT NULL
      )
    `)
    db.run(`
      CREATE TABLE staged_files (
        staged_id         TEXT PRIMARY KEY,
        context_id        TEXT NOT NULL,
        sender_id         TEXT NOT NULL,
        filename          TEXT NOT NULL,
        platform_file_id  TEXT NOT NULL,
        source_provider   TEXT NOT NULL,
        status            TEXT NOT NULL DEFAULT 'staged',
        created_at        TEXT NOT NULL,
        expires_at        TEXT NOT NULL
      )
    `)

    migration054AttachmentOrigin.up(db)

    const columns = db.query<{ name: string }, []>("SELECT name FROM pragma_table_info('staged_files')").all()
    const columnNames = columns.map((c) => c.name)
    expect(columnNames).toContain('origin')
    expect(columnNames).toContain('forwarded_from')
  })
})
