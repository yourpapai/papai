// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { migration036DropUserLlmConfig } from '../../../src/db/migrations/036_drop_user_llm_config.js'
import { mockLogger } from '../../utils/test-helpers.js'

interface UserConfigRow {
  user_id: string
  key: string
  value: string
}

const seedUserConfigTable = (db: Database): void => {
  db.run(`
    CREATE TABLE user_config (
      user_id TEXT NOT NULL,
      key     TEXT NOT NULL,
      value   TEXT NOT NULL,
      PRIMARY KEY (user_id, key)
    )
  `)
}

const insertRows = (db: Database, rows: ReadonlyArray<UserConfigRow>): void => {
  for (const row of rows) {
    db.run('INSERT INTO user_config (user_id, key, value) VALUES (?, ?, ?)', [row.user_id, row.key, row.value])
  }
}

const selectAll = (db: Database): UserConfigRow[] =>
  db.query<UserConfigRow, []>('SELECT user_id, key, value FROM user_config').all()

const findBackupFile = (dir: string, dbName: string): string | null => {
  const entries = readdirSync(dir)
  const prefix = `${dbName}.backup-036-`
  for (const entry of entries) {
    if (entry.startsWith(prefix) && entry.endsWith('.jsonl')) {
      return join(dir, entry)
    }
  }
  return null
}

const requireBackupFile = (dir: string, dbName: string): string => {
  const path = findBackupFile(dir, dbName)
  if (path === null) throw new Error(`backup file not found in ${dir}`)
  return path
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseBackupLine = (line: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(line)
  if (!isRecord(parsed)) {
    throw new Error(`unexpected backup line shape: ${line}`)
  }
  return parsed
}

describe('migration036DropUserLlmConfig', () => {
  let workDir: string
  let dbPath: string
  let db: Database

  beforeEach(() => {
    mockLogger()
    workDir = mkdtempSync(join(tmpdir(), 'papai-mig036-'))
    dbPath = join(workDir, 'papai.db')
    db = new Database(dbPath)
    seedUserConfigTable(db)
  })

  afterEach(() => {
    db.close()
    rmSync(workDir, { recursive: true, force: true })
  })

  test('deletes the five LLM keys from user_config', () => {
    insertRows(db, [
      { user_id: 'u1', key: 'llm_apikey', value: 'sk-1' },
      { user_id: 'u1', key: 'llm_baseurl', value: 'https://api/v1' },
      { user_id: 'u1', key: 'main_model', value: 'gpt-x' },
      { user_id: 'u1', key: 'small_model', value: 'gpt-x-small' },
      { user_id: 'u1', key: 'embedding_model', value: 'text-emb' },
      { user_id: 'u1', key: 'kaneo_apikey', value: 'kaneo-1' },
      { user_id: 'u1', key: 'timezone', value: 'UTC' },
    ])

    migration036DropUserLlmConfig.up(db)

    const remaining = selectAll(db)
    const remainingKeys = remaining.map((r) => r.key).sort()
    expect(remainingKeys).toEqual(['kaneo_apikey', 'timezone'])
  })

  test('preserves rows for keys outside the LLM set', () => {
    insertRows(db, [
      { user_id: 'u1', key: 'llm_apikey', value: 'sk-1' },
      { user_id: 'u1', key: 'kaneo_apikey', value: 'kaneo-1' },
      { user_id: 'u2', key: 'youtrack_token', value: 'yt-2' },
      { user_id: 'u3', key: 'timezone', value: 'UTC' },
    ])

    migration036DropUserLlmConfig.up(db)

    const remaining = selectAll(db).sort((a, b) => `${a.user_id}:${a.key}`.localeCompare(`${b.user_id}:${b.key}`))
    expect(remaining).toEqual([
      { user_id: 'u1', key: 'kaneo_apikey', value: 'kaneo-1' },
      { user_id: 'u2', key: 'youtrack_token', value: 'yt-2' },
      { user_id: 'u3', key: 'timezone', value: 'UTC' },
    ])
  })

  test('writes a JSONL backup file beside the SQLite DB when LLM rows exist', () => {
    insertRows(db, [
      { user_id: 'u1', key: 'llm_apikey', value: 'sk-1' },
      { user_id: 'u1', key: 'main_model', value: 'gpt-x' },
      { user_id: 'u2', key: 'llm_baseurl', value: 'https://api/v1' },
    ])

    migration036DropUserLlmConfig.up(db)

    const resolvedBackupPath = requireBackupFile(workDir, 'papai.db')

    const stat = statSync(resolvedBackupPath)
    expect(stat.size).toBeGreaterThan(0)

    const content = readFileSync(resolvedBackupPath, 'utf8')
    const lines = content.trim().split('\n')
    expect(lines).toHaveLength(3)
    const parsed = lines.map(parseBackupLine)
    const migrationValues = parsed.map((row) => row['migration'])
    const userIdTypes = parsed.map((row) => typeof row['user_id'])
    const keyTypes = parsed.map((row) => typeof row['key'])
    const valueTypes = parsed.map((row) => typeof row['value'])
    expect(migrationValues).toEqual(['036', '036', '036'])
    expect(userIdTypes).toEqual(['string', 'string', 'string'])
    expect(keyTypes).toEqual(['string', 'string', 'string'])
    expect(valueTypes).toEqual(['string', 'string', 'string'])
    const keys = parsed.map((r) => String(r['key'])).sort((a, b) => a.localeCompare(b))
    expect(keys).toEqual(['llm_apikey', 'llm_baseurl', 'main_model'])
  })

  test('does not write a backup file when there are no LLM rows to delete', () => {
    insertRows(db, [
      { user_id: 'u1', key: 'kaneo_apikey', value: 'kaneo-1' },
      { user_id: 'u2', key: 'timezone', value: 'UTC' },
    ])

    migration036DropUserLlmConfig.up(db)

    const backupPath = findBackupFile(workDir, 'papai.db')
    expect(backupPath).toBeNull()

    const remaining = selectAll(db)
    expect(remaining).toHaveLength(2)
  })

  test('is idempotent on a second run (no-op once LLM rows are already gone)', () => {
    insertRows(db, [{ user_id: 'u1', key: 'llm_apikey', value: 'sk-1' }])

    migration036DropUserLlmConfig.up(db)
    const firstBackup = findBackupFile(workDir, 'papai.db')
    expect(firstBackup).not.toBeNull()

    // Second run: no LLM rows remain, no new backup is written.
    // Capture the set of backup files before the second run so we can verify
    // no NEW backup gets created (existing file should still be present).
    const beforeSecond = new Set(readdirSync(workDir))
    migration036DropUserLlmConfig.up(db)
    const afterSecond = new Set(readdirSync(workDir))
    expect(afterSecond.size).toBe(beforeSecond.size)
  })
})
