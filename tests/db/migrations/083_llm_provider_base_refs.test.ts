// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration083LlmProviderBaseRefs } from '../../../src/db/migrations/083_llm_provider_base_refs.js'

const createPreMigrationTable = (db: Database): void => {
  db.run(`
    CREATE TABLE llm_providers (
      id TEXT NOT NULL PRIMARY KEY,
      label TEXT NOT NULL,
      provider_type TEXT NOT NULL,
      base_url TEXT NOT NULL,
      encrypted_api_key TEXT NOT NULL,
      models_cache TEXT,
      models_fetched_at INTEGER,
      verification_status TEXT NOT NULL DEFAULT 'unverified',
      verification_error TEXT,
      verification_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      updated_by TEXT NOT NULL
    )
  `)
}

const insertLegacyRow = (db: Database, id: string): void => {
  db.query(
    `INSERT INTO llm_providers (id, label, provider_type, base_url, encrypted_api_key, created_at, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, id, 'openai', 'https://api.openai.com/v1', 'encrypted', 1, 1, 'admin-1')
}

const columnInfo = (db: Database, column: string): { notnull: number; type: string } | undefined => {
  const row = db
    .query<{ name: string; notnull: number; type: string }, []>('PRAGMA table_info(llm_providers)')
    .all()
    .find((candidate) => candidate.name === column)
  return row === undefined ? undefined : { notnull: row.notnull, type: row.type }
}

describe('migration 083 llm_provider_base_refs', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    createPreMigrationTable(db)
  })

  afterEach(() => {
    db.close()
  })

  test('migration id is 083_llm_provider_base_refs', () => {
    expect(migration083LlmProviderBaseRefs.id).toBe('083_llm_provider_base_refs')
  })

  test('adds nullable base_provider and base_model columns', () => {
    migration083LlmProviderBaseRefs.up(db)

    const baseProvider = columnInfo(db, 'base_provider')
    const baseModel = columnInfo(db, 'base_model')
    expect(baseProvider).toEqual({ notnull: 0, type: 'TEXT' })
    expect(baseModel).toEqual({ notnull: 0, type: 'TEXT' })
  })

  test('existing rows decode with null base references', () => {
    insertLegacyRow(db, 'provider-a')
    insertLegacyRow(db, 'provider-b')

    migration083LlmProviderBaseRefs.up(db)

    const rows = db
      .query<{ id: string; base_provider: string | null; base_model: string | null }, []>(
        'SELECT id, base_provider, base_model FROM llm_providers ORDER BY id',
      )
      .all()
    expect(rows).toEqual([
      { id: 'provider-a', base_provider: null, base_model: null },
      { id: 'provider-b', base_provider: null, base_model: null },
    ])
  })

  test('re-running the migration is idempotent and keeps stored references', () => {
    insertLegacyRow(db, 'provider-a')
    migration083LlmProviderBaseRefs.up(db)
    db.query(`UPDATE llm_providers SET base_provider = ?, base_model = ? WHERE id = ?`).run(
      'anthropic',
      'claude-opus-4',
      'provider-a',
    )

    expect(() => migration083LlmProviderBaseRefs.up(db)).not.toThrow()

    const baseProviderCount = db
      .query<{ name: string }, []>('PRAGMA table_info(llm_providers)')
      .all()
      .filter((row) => row.name === 'base_provider').length
    expect(baseProviderCount).toBe(1)
    const row = db
      .query<{ base_provider: string | null; base_model: string | null }, [string]>(
        'SELECT base_provider, base_model FROM llm_providers WHERE id = ?',
      )
      .get('provider-a')
    expect(row).toEqual({ base_provider: 'anthropic', base_model: 'claude-opus-4' })
  })
})
