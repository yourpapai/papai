// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration052ByokLlmCredentials } from '../../../src/db/migrations/052_byok_llm_credentials.js'

const tableSql = (db: Database, name: string): string | null =>
  db.query<{ sql: string }, [string]>(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name)
    ?.sql ?? null

const indexExists = (db: Database, name: string): boolean =>
  db.query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`).get(name) !==
  null

describe('migration052ByokLlmCredentials', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  test('migration id is 052_byok_llm_credentials', () => {
    expect(migration052ByokLlmCredentials.id).toBe('052_byok_llm_credentials')
  })

  test('creates the BYOK LLM credentials table and index', () => {
    migration052ByokLlmCredentials.up(db)

    const sql = tableSql(db, 'byok_llm_credentials')
    expect(sql).toContain('context_id TEXT PRIMARY KEY')
    expect(sql).toContain('enabled INTEGER NOT NULL DEFAULT 0')
    expect(sql).toContain('encrypted_config TEXT')
    expect(sql).toContain('updated_at INTEGER NOT NULL')
    expect(sql).toContain('updated_by TEXT NOT NULL')
    expect(indexExists(db, 'idx_byok_llm_credentials_updated_at')).toBe(true)
  })

  test('allows enabled rows without encrypted config', () => {
    migration052ByokLlmCredentials.up(db)

    db.run(
      `INSERT INTO byok_llm_credentials (context_id, enabled, encrypted_config, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)`,
      ['ctx-1', 1, null, 1710000000000, 'admin-1'],
    )

    expect(db.query(`SELECT encrypted_config FROM byok_llm_credentials WHERE context_id = 'ctx-1'`).get()).toEqual({
      encrypted_config: null,
    })
  })
})
