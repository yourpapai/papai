// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'
import { writeFileSync } from 'node:fs'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:036' })

const LLM_KEYS = ['llm_apikey', 'llm_baseurl', 'main_model', 'small_model', 'embedding_model'] as const

interface UserConfigLlmRow {
  user_id: string
  key: string
  value: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const getDbFilename = (db: Database): string => {
  const asUnknown: unknown = db
  if (!isRecord(asUnknown)) return ''
  const candidate = asUnknown['filename']
  return typeof candidate === 'string' ? candidate : ''
}

const writeBackup = (dbFilename: string, rows: ReadonlyArray<UserConfigLlmRow>): string => {
  const backupPath = `${dbFilename}.backup-036-${Date.now()}.jsonl`
  const lines = rows.map((r) => JSON.stringify({ ...r, migration: '036' })).join('\n')
  writeFileSync(backupPath, `${lines}\n`, 'utf8')
  return backupPath
}

const up = (db: Database): void => {
  const rows = db
    .query<UserConfigLlmRow, [string, string, string, string, string]>(
      `SELECT user_id, key, value FROM user_config WHERE key IN (?, ?, ?, ?, ?)`,
    )
    .all(...LLM_KEYS)

  if (rows.length === 0) {
    log.info('migration 036: no LLM rows in user_config; nothing to delete')
    return
  }

  const dbFilename = getDbFilename(db)
  if (dbFilename === '' || dbFilename === ':memory:') {
    log.warn({ rows: rows.length }, 'migration 036: in-memory or unnamed DB, skipping backup file')
  } else {
    const backupPath = writeBackup(dbFilename, rows)
    log.info({ backupPath, rows: rows.length }, 'migration 036: wrote pre-deletion backup')
  }

  db.run(
    `DELETE FROM user_config WHERE key IN ('llm_apikey', 'llm_baseurl', 'main_model', 'small_model', 'embedding_model')`,
  )
  log.info({ deleted: rows.length }, 'migration 036: removed LLM keys from user_config')
}

export const migration036DropUserLlmConfig: Migration = {
  id: '036_drop_user_llm_config',
  up,
}

export default migration036DropUserLlmConfig
