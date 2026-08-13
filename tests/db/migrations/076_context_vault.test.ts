// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration076ContextVault } from '../../../src/db/migrations/076_context_vault.js'

const getTableNames = (db: Database): string[] =>
  db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name)

const getPrimaryKeyColumns = (db: Database, table: string): string[] =>
  db
    .query<{ name: string; pk: number }, []>(`PRAGMA table_info(${table})`)
    .all()
    .filter((column) => column.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((column) => column.name)

const VAULT_TABLES = [
  'context_vault_tokens',
  'context_vault_specs',
  'context_vault_files',
  'context_vault_indexer_state',
]

describe('migration 076_context_vault', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.run('PRAGMA foreign_keys=ON')
    migration076ContextVault.up(db)
  })

  afterEach(() => {
    db.close()
  })

  test('exports a migration with the expected id', () => {
    expect(migration076ContextVault.id).toBe('076_context_vault')
    expect(typeof migration076ContextVault.up).toBe('function')
  })

  test('creates all four context vault tables', () => {
    const tables = getTableNames(db)
    for (const table of VAULT_TABLES) {
      expect(tables).toContain(table)
    }
  })

  test('tokens are keyed by (config_context_id, token_id)', () => {
    expect(getPrimaryKeyColumns(db, 'context_vault_tokens')).toEqual(['config_context_id', 'token_id'])
  })

  test('specs are keyed by (config_context_id, id)', () => {
    expect(getPrimaryKeyColumns(db, 'context_vault_specs')).toEqual(['config_context_id', 'id'])
  })

  test('files are keyed by (config_context_id, spec_id, path)', () => {
    expect(getPrimaryKeyColumns(db, 'context_vault_files')).toEqual(['config_context_id', 'spec_id', 'path'])
  })

  test('indexer state is keyed by config_context_id', () => {
    expect(getPrimaryKeyColumns(db, 'context_vault_indexer_state')).toEqual(['config_context_id'])
  })

  test('creates an index on token_hash for auth lookup', () => {
    const indexed = db
      .query<{ name: string }, []>(
        `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='context_vault_tokens'`,
      )
      .all()
      .map((row) => row.name)
    const singleColumnIndexColumns = indexed
      .map((name) =>
        db
          .query<{ name: string }, []>(`PRAGMA index_info(${name})`)
          .all()
          .map((column) => column.name),
      )
      .filter((columns) => columns.length === 1)
      .map((columns) => columns[0])
    expect(singleColumnIndexColumns).toContain('token_hash')
    expect(indexed.length).toBeGreaterThan(0)
  })
})
