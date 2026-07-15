// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:067' })

type LegacyRow = { key: string; value: string }
type CountRow = { c: number }

const legacyKeys = (): readonly string[] => [
  'llm_apikey',
  'llm_baseurl',
  'main_model',
  'small_model',
  'embedding_model',
]

const readLegacy = (db: Database): Record<string, string> => {
  const rows = db.query<LegacyRow, []>(`SELECT key, value FROM system_config`).all()
  const out: Record<string, string> = {}
  for (const row of rows) {
    if (legacyKeys().includes(row.key)) out[row.key] = row.value
  }
  return out
}

const createTables = (db: Database): void => {
  db.run(`
    CREATE TABLE IF NOT EXISTS llm_providers (
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
  db.run(`
    CREATE TABLE IF NOT EXISTS llm_admin_roles (
      id INTEGER PRIMARY KEY,
      main_provider_id TEXT NOT NULL,
      main_model TEXT NOT NULL,
      small_provider_id TEXT,
      small_model TEXT,
      embedding_provider_id TEXT,
      embedding_model TEXT,
      updated_at INTEGER NOT NULL,
      updated_by TEXT NOT NULL
    )
  `)
}

const migrateLegacyConfig = (db: Database, legacy: Record<string, string>): void => {
  const has = (k: string): boolean => legacy[k] !== undefined && legacy[k].trim() !== ''
  const alreadyMigrated = db.query<CountRow, []>(`SELECT COUNT(*) AS c FROM llm_providers`).get()?.c ?? 0

  if (!has('llm_apikey') || !has('llm_baseurl') || !has('main_model') || alreadyMigrated !== 0) {
    return
  }

  const id = `prov_legacy_${Math.random().toString(36).slice(2, 10)}`
  const now = Date.now()
  const smallModel = has('small_model') ? legacy['small_model']! : null

  db.run(
    `INSERT INTO llm_providers (id, label, provider_type, base_url, encrypted_api_key, verification_status, created_at, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      'Migrated provider',
      'custom',
      legacy['llm_baseurl']!,
      'legacy:' + legacy['llm_apikey'],
      'unverified',
      now,
      now,
      'migration:067',
    ],
  )
  db.run(
    `INSERT INTO llm_admin_roles (id, main_provider_id, main_model, small_provider_id, small_model, embedding_provider_id, embedding_model, updated_at, updated_by)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      legacy['main_model']!,
      smallModel === null ? null : id,
      smallModel,
      has('embedding_model') ? id : null,
      has('embedding_model') ? legacy['embedding_model']! : null,
      now,
      'migration:067',
    ],
  )
  log.info('migration 067: migrated legacy system_config LLM keys into provider registry')
}

const deleteLegacyKeys = (db: Database): void => {
  for (const key of legacyKeys()) {
    db.run(`DELETE FROM system_config WHERE key = ?`, [key])
  }
}

const up = (db: Database): void => {
  createTables(db)
  migrateLegacyConfig(db, readLegacy(db))
  deleteLegacyKeys(db)
}

export const migration067MultiLlmProviders: Migration = {
  id: '067_multi_llm_providers',
  up,
}

export default migration067MultiLlmProviders
