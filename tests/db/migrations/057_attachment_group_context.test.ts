// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { MIGRATIONS } from '../../../src/db/index.js'
import { runMigrations } from '../../../src/db/migrate.js'
import { migration057AttachmentGroupContext } from '../../../src/db/migrations/057_attachment_group_context.js'

const cols = (db: Database, table: string): string[] =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((r) => r.name)

describe('migration 057', () => {
  test('has correct id', () => {
    expect(migration057AttachmentGroupContext.id).toBe('057_attachment_group_context')
  })

  test('adds group_context_id to attachments and staged_files', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    expect(cols(db, 'attachments')).toContain('group_context_id')
    expect(cols(db, 'staged_files')).toContain('group_context_id')
  })
})
