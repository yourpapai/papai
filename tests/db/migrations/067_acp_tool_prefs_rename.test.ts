// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, it } from 'bun:test'

import { migration067AcpToolPrefsRename } from '../../../src/db/migrations/067_acp_tool_prefs_rename.js'

function dbWithToolPrefs(rows: Array<{ userId: string; value: string }>): Database {
  const db = new Database(':memory:')
  db.run(
    `CREATE TABLE user_config (user_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (user_id, key))`,
  )
  for (const r of rows)
    db.run(`INSERT INTO user_config (user_id, key, value) VALUES (?, 'tool_prefs', ?)`, [r.userId, r.value])
  return db
}

const readValue = (db: Database, userId: string): string => {
  const row = db
    .query<{ value: string }, [string]>(`SELECT value FROM user_config WHERE user_id = ? AND key = 'tool_prefs'`)
    .get(userId)
  if (row === null) throw new Error(`no tool_prefs row for ${userId}`)
  return row.value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseRecord(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value)
  if (!isRecord(parsed)) throw new Error('expected a JSON object')
  return parsed
}

describe('migration 067 acp tool_prefs rename', () => {
  it('rewrites plugin_acp__ override keys to module_coding__, preserving permissions and other keys', () => {
    const db = dbWithToolPrefs([
      {
        userId: 'ctx-1',
        value: JSON.stringify({
          riskDefaults: {},
          domainDefaults: { plugin: 'ask' },
          toolOverrides: { plugin_acp__start_session: 'allow', plugin_acp__cancel_session: 'deny', web_fetch: 'ask' },
        }),
      },
    ])
    migration067AcpToolPrefsRename.up(db)
    const parsed = parseRecord(readValue(db, 'ctx-1'))
    expect(parsed['toolOverrides']).toEqual({
      module_coding__start_session: 'allow',
      module_coding__cancel_session: 'deny',
      web_fetch: 'ask',
    })
    expect(parsed['domainDefaults']).toEqual({ plugin: 'ask' })
  })

  it('leaves rows without acp overrides untouched', () => {
    const original = JSON.stringify({ domainDefaults: {}, toolOverrides: { web_fetch: 'deny' } })
    const db = dbWithToolPrefs([{ userId: 'ctx-2', value: original }])
    migration067AcpToolPrefsRename.up(db)
    expect(readValue(db, 'ctx-2')).toBe(original)
  })

  it('tolerates non-JSON / malformed values without throwing', () => {
    const db = dbWithToolPrefs([{ userId: 'ctx-3', value: 'not json' }])
    expect(() => migration067AcpToolPrefsRename.up(db)).not.toThrow()
    expect(readValue(db, 'ctx-3')).toBe('not json')
  })

  it('is a no-op when user_config does not exist', () => {
    const db = new Database(':memory:')
    expect(() => migration067AcpToolPrefsRename.up(db)).not.toThrow()
  })
})
