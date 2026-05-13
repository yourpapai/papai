import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration031StagedFiles } from '../../../src/db/migrations/031_staged_files.js'
import { mockLogger } from '../../utils/test-helpers.js'

const getNames = (db: Database, type: 'table' | 'index'): string[] =>
  db
    .query<{ name: string }, [string]>('SELECT name FROM sqlite_master WHERE type = ?')
    .all(type)
    .map((row) => row.name)

describe('migration031StagedFiles', () => {
  let db: Database

  beforeEach(() => {
    mockLogger()
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  test('creates staged_files table and indexes', () => {
    migration031StagedFiles.up(db)

    expect(getNames(db, 'table')).toContain('staged_files')
    expect(getNames(db, 'index')).toContain('idx_staged_context_sender')
    expect(getNames(db, 'index')).toContain('idx_staged_context_message')
    expect(getNames(db, 'index')).toContain('idx_staged_expires_at')
  })

  test('rows can store staged file metadata with default status', () => {
    migration031StagedFiles.up(db)

    db.run(
      `INSERT INTO staged_files (
         staged_id, context_id, message_id, sender_id, sender_username,
         filename, mime_type, size, platform_file_id, source_provider,
         status, created_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'stg_1',
        'ctx-1',
        'msg-1',
        'user-1',
        'alice',
        'report.pdf',
        'application/pdf',
        1024,
        'tg_file_123',
        'telegram',
        'staged',
        '2026-05-12T00:00:00Z',
        '2026-05-13T00:00:00Z',
      ],
    )

    const row = db
      .query<{ status: string; filename: string; platform_file_id: string }, [string]>(
        'SELECT status, filename, platform_file_id FROM staged_files WHERE staged_id = ?',
      )
      .get('stg_1')

    expect(row).not.toBeNull()
    expect(row!.status).toBe('staged')
    expect(row!.filename).toBe('report.pdf')
    expect(row!.platform_file_id).toBe('tg_file_123')
  })
})
