// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration076ContextVault } from '../../../src/db/migrations/076_context_vault.js'
import { migration077ContextVaultFileArtifacts } from '../../../src/db/migrations/077_context_vault_file_artifacts.js'

interface ColumnInfo {
  name: string
  notnull: number
}

const getColumns = (db: Database, table: string): ColumnInfo[] =>
  db.query<{ name: string; notnull: number }, []>(`PRAGMA table_info(${table})`).all()

describe('migration 077_context_vault_file_artifacts', () => {
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
    expect(migration077ContextVaultFileArtifacts.id).toBe('077_context_vault_file_artifacts')
    expect(typeof migration077ContextVaultFileArtifacts.up).toBe('function')
  })

  test('adds nullable derived-artifact columns to context_vault_files', () => {
    migration077ContextVaultFileArtifacts.up(db)

    const columns = getColumns(db, 'context_vault_files')
    const byName = new Map(columns.map((c) => [c.name, c]))
    for (const name of ['outline', 'tasks_ticked', 'tasks_total']) {
      const column = byName.get(name)
      expect(column).toBeDefined()
      expect(column?.notnull).toBe(0)
    }
  })

  test('existing file rows survive with null artifacts', () => {
    db.run(
      `INSERT INTO context_vault_files (config_context_id, spec_id, path, kind, hash, mtime)
       VALUES ('ctx', 'papai:x', 'a/proposal.md', 'proposal', 'h1', 1)`,
    )

    migration077ContextVaultFileArtifacts.up(db)

    const row = db
      .query<{ path: string; outline: string | null; tasks_ticked: number | null; tasks_total: number | null }, []>(
        `SELECT path, outline, tasks_ticked, tasks_total FROM context_vault_files`,
      )
      .get()
    expect(row?.path).toBe('a/proposal.md')
    expect(row?.outline).toBeNull()
    expect(row?.tasks_ticked).toBeNull()
    expect(row?.tasks_total).toBeNull()
  })
})
