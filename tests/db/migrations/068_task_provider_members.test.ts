// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'

import { migration068TaskProviderMembers } from '../../../src/db/migrations/068_task_provider_members.js'

const OLD_DDL = `
  CREATE TABLE kaneo_workspace_members (
    group_context_id TEXT NOT NULL,
    chat_user_id     TEXT NOT NULL,
    provider_name    TEXT NOT NULL DEFAULT 'kaneo',
    provider_user_id TEXT NOT NULL,
    login            TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'active',
    encrypted_password TEXT,
    created_at       TEXT NOT NULL,
    PRIMARY KEY (group_context_id, chat_user_id, provider_name)
  )`

const seedRow = (db: Database, chatUserId: string): void => {
  db.run(
    `INSERT INTO kaneo_workspace_members (group_context_id, chat_user_id, provider_name, provider_user_id, login, status, encrypted_password, created_at) VALUES (?, ?, 'kaneo', ?, ?, 'active', ?, ?)`,
    ['grp-1', chatUserId, `pu-${chatUserId}`, `login-${chatUserId}`, 'enc', '2026-01-01T00:00:00.000Z'],
  )
}

const rows = (db: Database): Array<{ chat_user_id: string; provider_name: string; login: string }> =>
  db
    .query<{ chat_user_id: string; provider_name: string; login: string }, []>(
      `SELECT chat_user_id, provider_name, login FROM task_provider_members ORDER BY chat_user_id`,
    )
    .all()

describe('migration 068 task_provider_members', () => {
  it('creates task_provider_members and copies existing kaneo_workspace_members rows', () => {
    const db = new Database(':memory:')
    db.run(OLD_DDL)
    seedRow(db, 'u1')
    seedRow(db, 'u2')
    migration068TaskProviderMembers.up(db)
    expect(rows(db)).toEqual([
      { chat_user_id: 'u1', provider_name: 'kaneo', login: 'login-u1' },
      { chat_user_id: 'u2', provider_name: 'kaneo', login: 'login-u2' },
    ])
    expect(db.query<{ n: number }, []>(`SELECT count(*) AS n FROM kaneo_workspace_members`).get()?.n).toBe(2)
  })

  it('is a no-op-safe create when the old table is absent (fresh install)', () => {
    const db = new Database(':memory:')
    expect(() => migration068TaskProviderMembers.up(db)).not.toThrow()
    expect(rows(db)).toEqual([])
  })

  it('does not duplicate rows if run again (idempotent copy)', () => {
    const db = new Database(':memory:')
    db.run(OLD_DDL)
    seedRow(db, 'u1')
    migration068TaskProviderMembers.up(db)
    migration068TaskProviderMembers.up(db)
    expect(rows(db)).toEqual([{ chat_user_id: 'u1', provider_name: 'kaneo', login: 'login-u1' }])
  })
})
