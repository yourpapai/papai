import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { migration021WebFetch } from '../../../src/db/migrations/021_web_fetch.js'
import { mockLogger } from '../../utils/test-helpers.js'

const getTableNames = (db: Database): string[] =>
  db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((row) => row.name)

const getIndexNames = (db: Database): string[] =>
  db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='index'")
    .all()
    .map((row) => row.name)

describe('migration021WebFetch', () => {
  let db: Database

  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  test('creates web_cache table', () => {
    migration021WebFetch.up(db)

    const tableNames = getTableNames(db)
    expect(tableNames).toContain('web_cache')
  })

  test('web_cache applies the default truncated flag and enforces url_hash uniqueness', () => {
    migration021WebFetch.up(db)

    db.run(`
      INSERT INTO web_cache (
        url_hash,
        url,
        final_url,
        title,
        summary,
        excerpt,
        content_type,
        fetched_at,
        expires_at
      )
      VALUES (
        'hash-1',
        'https://example.com/article',
        'https://example.com/article',
        'Example title',
        'Example summary',
        'Example excerpt',
        'text/html',
        1,
        2
      )
    `)

    const row = db
      .query<{ truncated: number }, [string]>('SELECT truncated FROM web_cache WHERE url_hash = ?')
      .get('hash-1')
    assert(row)
    expect(row.truncated).toBe(0)

    expect(() => {
      db.run(`
        INSERT INTO web_cache (
          url_hash,
          url,
          final_url,
          title,
          summary,
          excerpt,
          content_type,
          fetched_at,
          expires_at
        )
        VALUES (
          'hash-1',
          'https://example.com/duplicate',
          'https://example.com/duplicate',
          'Duplicate title',
          'Duplicate summary',
          'Duplicate excerpt',
          'text/html',
          3,
          4
        )
      `)
    }).toThrow()
  })

  test('creates web_rate_limit table', () => {
    migration021WebFetch.up(db)

    const tableNames = getTableNames(db)
    expect(tableNames).toContain('web_rate_limit')
  })

  test('web_rate_limit enforces a composite primary key', () => {
    migration021WebFetch.up(db)

    db.run(`
      INSERT INTO web_rate_limit (actor_id, window_start, count)
      VALUES ('actor-1', 0, 1)
    `)
    db.run(`
      INSERT INTO web_rate_limit (actor_id, window_start, count)
      VALUES ('actor-1', 300000, 1)
    `)

    expect(() => {
      db.run(`
        INSERT INTO web_rate_limit (actor_id, window_start, count)
        VALUES ('actor-1', 0, 2)
      `)
    }).toThrow()

    const rows = db.query<{ actor_id: string }, []>('SELECT actor_id FROM web_rate_limit').all()
    expect(rows).toHaveLength(2)
  })

  test('creates index on web_cache expires_at', () => {
    migration021WebFetch.up(db)

    const indexNames = getIndexNames(db)
    expect(indexNames).toContain('idx_web_cache_expires')
  })

  test('is idempotent - can run multiple times without error', () => {
    migration021WebFetch.up(db)
    migration021WebFetch.up(db)
    migration021WebFetch.up(db)

    const tableNames = getTableNames(db)
    expect(tableNames).toContain('web_cache')
    expect(tableNames).toContain('web_rate_limit')

    const indexNames = getIndexNames(db)
    expect(indexNames).toContain('idx_web_cache_expires')
  })
})
