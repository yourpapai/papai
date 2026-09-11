// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration084LlmProviderModelHints } from '../../../src/db/migrations/084_llm_provider_model_hints.js'

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
      updated_by TEXT NOT NULL,
      base_provider TEXT,
      base_model TEXT
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

describe('migration 084 llm_provider_model_hints', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    createPreMigrationTable(db)
  })

  afterEach(() => {
    db.close()
  })

  test('migration id is 084_llm_provider_model_hints', () => {
    expect(migration084LlmProviderModelHints.id).toBe('084_llm_provider_model_hints')
  })

  test('adds a nullable model_hints column', () => {
    migration084LlmProviderModelHints.up(db)

    expect(columnInfo(db, 'model_hints')).toEqual({ notnull: 0, type: 'TEXT' })
  })

  test('pre-existing rows keep null model_hints (no backfill)', () => {
    insertLegacyRow(db, 'provider-a')
    insertLegacyRow(db, 'provider-b')

    migration084LlmProviderModelHints.up(db)

    const rows = db
      .query<{ id: string; model_hints: string | null }, []>('SELECT id, model_hints FROM llm_providers ORDER BY id')
      .all()
    expect(rows).toEqual([
      { id: 'provider-a', model_hints: null },
      { id: 'provider-b', model_hints: null },
    ])
  })

  test('re-running the migration is idempotent and keeps stored hints', () => {
    insertLegacyRow(db, 'provider-a')
    migration084LlmProviderModelHints.up(db)
    const storedHints = '{"gateway-model":{"baseProvider":"anthropic","baseModel":"claude-opus-4"}}'
    db.query(`UPDATE llm_providers SET model_hints = ? WHERE id = ?`).run(storedHints, 'provider-a')

    expect(() => migration084LlmProviderModelHints.up(db)).not.toThrow()

    const modelHintsCount = db
      .query<{ name: string }, []>('PRAGMA table_info(llm_providers)')
      .all()
      .filter((row) => row.name === 'model_hints').length
    expect(modelHintsCount).toBe(1)
    const row = db
      .query<{ model_hints: string | null }, [string]>('SELECT model_hints FROM llm_providers WHERE id = ?')
      .get('provider-a')
    expect(row).toEqual({ model_hints: storedHints })
  })
})
