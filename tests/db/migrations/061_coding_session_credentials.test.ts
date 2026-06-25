// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration061CodingSessionCredentials } from '../../../src/db/migrations/061_coding_session_credentials.js'

const tableSql = (db: Database, name: string): string | null =>
  db.query<{ sql: string }, [string]>(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name)
    ?.sql ?? null

const indexExists = (db: Database, name: string): boolean =>
  db.query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`).get(name) !==
  null

describe('migration061CodingSessionCredentials', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  test('migration id is 061_coding_session_credentials', () => {
    expect(migration061CodingSessionCredentials.id).toBe('061_coding_session_credentials')
  })

  test('creates the coding_session_credentials table with composite primary key and index', () => {
    migration061CodingSessionCredentials.up(db)

    const sql = tableSql(db, 'coding_session_credentials')
    expect(sql).toContain('context_id TEXT NOT NULL')
    expect(sql).toContain('namespace TEXT NOT NULL')
    expect(sql).toContain('encrypted_config TEXT NOT NULL')
    expect(sql).toContain('updated_at INTEGER NOT NULL')
    expect(sql).toContain('updated_by TEXT NOT NULL')
    expect(indexExists(db, 'idx_coding_session_credentials_updated_at')).toBe(true)
  })

  test('enforces composite primary key (context_id, namespace)', () => {
    migration061CodingSessionCredentials.up(db)

    db.run(
      `INSERT INTO coding_session_credentials (context_id, namespace, encrypted_config, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)`,
      ['ctx-1', 'agent-provider', 'payload', 1710000000000, 'user-1'],
    )

    expect(() =>
      db.run(
        `INSERT INTO coding_session_credentials (context_id, namespace, encrypted_config, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)`,
        ['ctx-1', 'agent-provider', 'payload2', 1710000000001, 'user-2'],
      ),
    ).toThrow()
  })

  test('allows different namespaces for the same context_id', () => {
    migration061CodingSessionCredentials.up(db)

    db.run(
      `INSERT INTO coding_session_credentials (context_id, namespace, encrypted_config, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)`,
      ['ctx-1', 'agent-provider', 'payload1', 1710000000000, 'user-1'],
    )
    db.run(
      `INSERT INTO coding_session_credentials (context_id, namespace, encrypted_config, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)`,
      ['ctx-1', 'forge', 'payload2', 1710000000001, 'user-1'],
    )

    const rows = db.query(`SELECT namespace FROM coding_session_credentials WHERE context_id = 'ctx-1'`).all()
    expect(rows).toHaveLength(2)
  })
})
