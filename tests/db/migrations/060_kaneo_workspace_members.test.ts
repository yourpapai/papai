// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'

import { MIGRATIONS } from '../../../src/db/index.js'
import { runMigrations } from '../../../src/db/migrate.js'
import { migration060KaneoWorkspaceMembers } from '../../../src/db/migrations/060_kaneo_workspace_members.js'

const cols = (db: Database, table: string): string[] =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((r) => r.name)

describe('migration 060 kaneo_workspace_members', () => {
  test('has correct id', () => {
    expect(migration060KaneoWorkspaceMembers.id).toBe('060_kaneo_workspace_members')
  })

  test('table exists with required columns after migration', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    const tableCols = cols(db, 'kaneo_workspace_members')
    expect(tableCols).toContain('group_context_id')
    expect(tableCols).toContain('chat_user_id')
    expect(tableCols).toContain('provider_name')
    expect(tableCols).toContain('provider_user_id')
    expect(tableCols).toContain('login')
    expect(tableCols).toContain('status')
    expect(tableCols).toContain('encrypted_password')
    expect(tableCols).toContain('created_at')
  })

  test('up is idempotent (safe to re-run)', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    expect(() => migration060KaneoWorkspaceMembers.up(db)).not.toThrow()
    expect(cols(db, 'kaneo_workspace_members')).toContain('group_context_id')
  })

  test('unique constraint prevents duplicate (group_context_id, chat_user_id, provider_name)', () => {
    const db = new Database(':memory:')
    runMigrations(db, MIGRATIONS)
    db.run(`INSERT INTO kaneo_workspace_members
      (group_context_id, chat_user_id, provider_name, provider_user_id, login, status, created_at)
      VALUES ('g1','u1','kaneo','pid1','u1@pap.ai','active','2026-01-01T00:00:00.000Z')`)
    expect(() =>
      db.run(`INSERT INTO kaneo_workspace_members
        (group_context_id, chat_user_id, provider_name, provider_user_id, login, status, created_at)
        VALUES ('g1','u1','kaneo','pid2','u1b@pap.ai','active','2026-01-01T00:00:01.000Z')`),
    ).toThrow()
  })
})
