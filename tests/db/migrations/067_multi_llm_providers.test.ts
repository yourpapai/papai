// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration034SystemConfig } from '../../../src/db/migrations/034_system_config.js'
import { migration067MultiLlmProviders } from '../../../src/db/migrations/067_multi_llm_providers.js'

const tableSql = (db: Database, name: string): string | null =>
  db.query<{ sql: string }, [string]>(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name)
    ?.sql ?? null

const systemConfigValue = (db: Database, key: string): string | null =>
  db.query<{ value: string }, [string]>(`SELECT value FROM system_config WHERE key = ?`).get(key)?.value ?? null

describe('migration067MultiLlmProviders', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
  })
  afterEach(() => {
    db.close()
  })

  test('migration id is 067_multi_llm_providers', () => {
    expect(migration067MultiLlmProviders.id).toBe('067_multi_llm_providers')
  })

  test('creates llm_providers and llm_admin_roles tables', () => {
    migration034SystemConfig.up(db)
    migration067MultiLlmProviders.up(db)

    const providers = tableSql(db, 'llm_providers')
    expect(providers).toContain('id TEXT NOT NULL PRIMARY KEY')
    expect(providers).toContain('encrypted_api_key TEXT NOT NULL')
    expect(providers).toContain("verification_status TEXT NOT NULL DEFAULT 'unverified'")

    const roles = tableSql(db, 'llm_admin_roles')
    expect(roles).toContain('main_provider_id TEXT NOT NULL')
    expect(roles).toContain('small_provider_id TEXT')
  })

  test('migrates legacy system_config keys into one provider bound to all roles', () => {
    migration034SystemConfig.up(db)
    db.run(`INSERT INTO system_config (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)`, [
      'llm_apikey',
      'sk-legacy',
      1,
      'env',
    ])
    db.run(`INSERT INTO system_config (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)`, [
      'llm_baseurl',
      'https://legacy.invalid/v1',
      1,
      'env',
    ])
    db.run(`INSERT INTO system_config (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)`, [
      'main_model',
      'legacy-main',
      1,
      'env',
    ])
    db.run(`INSERT INTO system_config (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)`, [
      'small_model',
      'legacy-small',
      1,
      'env',
    ])

    migration067MultiLlmProviders.up(db)

    const providers = db
      .query<{ id: string; label: string; base_url: string; provider_type: string }, []>(
        `SELECT id, label, base_url, provider_type FROM llm_providers`,
      )
      .all()
    expect(providers).toHaveLength(1)
    expect(providers[0]?.base_url).toBe('https://legacy.invalid/v1')
    expect(providers[0]?.provider_type).toBe('custom')

    const roles = db
      .query<{ main_model: string; small_model: string; embedding_model: string }, []>(
        `SELECT main_model, small_model, embedding_model FROM llm_admin_roles WHERE id = 1`,
      )
      .get()
    expect(roles?.main_model).toBe('legacy-main')
    expect(roles?.small_model).toBe('legacy-small')
    expect(roles?.embedding_model).toBeNull()

    expect(systemConfigValue(db, 'llm_apikey')).toBeNull()
    expect(systemConfigValue(db, 'main_model')).toBeNull()
  })

  test('is idempotent when no legacy keys exist', () => {
    migration034SystemConfig.up(db)
    migration067MultiLlmProviders.up(db)
    expect(db.query(`SELECT id FROM llm_providers`).all()).toEqual([])
    expect(db.query(`SELECT id FROM llm_admin_roles`).all()).toEqual([])
  })
})
