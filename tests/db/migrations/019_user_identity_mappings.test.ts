import { Database } from 'bun:sqlite'
import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import assert from 'node:assert/strict'

import { migration019UserIdentityMappings } from '../../../src/db/migrations/019_user_identity_mappings.js'
import { mockLogger } from '../../utils/test-helpers.js'

const getTableNames = (db: Database): string[] =>
  db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((row) => row.name)

describe('migration019UserIdentityMappings', () => {
  let db: Database

  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  test('creates user_identity_mappings table', () => {
    migration019UserIdentityMappings.up(db)

    const tableNames = getTableNames(db)
    expect(tableNames).toContain('user_identity_mappings')
  })

  test('creates composite primary key on context_id and provider_name', () => {
    migration019UserIdentityMappings.up(db)

    // Verify by inserting data with same context_id but different provider_name
    db.run(`
      INSERT INTO user_identity_mappings (context_id, provider_name, matched_at)
      VALUES ('user-1', 'kaneo', '2026-01-01T00:00:00Z')
    `)
    db.run(`
      INSERT INTO user_identity_mappings (context_id, provider_name, matched_at)
      VALUES ('user-1', 'youtrack', '2026-01-01T00:00:00Z')
    `)

    const rows = db.query('SELECT * FROM user_identity_mappings').all()
    expect(rows).toHaveLength(2)
  })

  test('prevents duplicate entries with same context_id and provider_name', () => {
    migration019UserIdentityMappings.up(db)

    db.run(`
      INSERT INTO user_identity_mappings (context_id, provider_name, matched_at)
      VALUES ('user-1', 'kaneo', '2026-01-01T00:00:00Z')
    `)

    expect(() => {
      db.run(`
        INSERT INTO user_identity_mappings (context_id, provider_name, matched_at)
        VALUES ('user-1', 'kaneo', '2026-01-02T00:00:00Z')
      `)
    }).toThrow()
  })

  test('creates index on provider_name and provider_user_id', () => {
    migration019UserIdentityMappings.up(db)

    const indexes = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='index'")
      .all()
      .map((row) => row.name)

    expect(indexes).toContain('idx_identity_mappings_provider_user')
  })

  test('supports nullable provider_user_id', () => {
    migration019UserIdentityMappings.up(db)

    db.run(`
      INSERT INTO user_identity_mappings (context_id, provider_name, provider_user_id, matched_at, match_method, confidence)
      VALUES ('user-1', 'kaneo', NULL, '2026-01-01T00:00:00Z', 'unmatched', 0)
    `)

    const row = db
      .query<{ provider_user_id: unknown; match_method: string }, string[]>(
        'SELECT * FROM user_identity_mappings WHERE context_id = ?',
      )
      .get('user-1')

    assert(row)
    expect(row.provider_user_id).toBeNull()
    expect(row.match_method).toBe('unmatched')
  })
})
