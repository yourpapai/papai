// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { MIGRATIONS } from '../../src/db/index.js'
import type { Migration } from '../../src/db/migrate.js'
import { decryptInstanceConfig, encryptInstanceConfig } from '../../src/instances/encryption.js'
import { mockLogger } from '../utils/test-helpers.js'

const requireDefined = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('expected value to be defined')
  return value
}

const createInstanceTables = (db: Database): void => {
  db.run(`
    CREATE TABLE platform_instances (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      config TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  db.run(`
    CREATE TABLE task_instances (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      config TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
}

const getMigration = (): Migration =>
  requireDefined(MIGRATIONS.find((migration) => migration.id === '045_provider_base_url'))

const insertInstance = (
  db: Database,
  table: 'platform_instances' | 'task_instances',
  id: string,
  type: string,
  config: Record<string, string>,
): void => {
  db.query(`INSERT INTO ${table} (id, type, config, status) VALUES (?, ?, ?, 'active')`).run(
    id,
    type,
    encryptInstanceConfig(config),
  )
}

const readConfig = (
  db: Database,
  table: 'platform_instances' | 'task_instances',
  id: string,
): Record<string, string> => {
  const row = requireDefined(
    db.query<{ config: string }, [string]>(`SELECT config FROM ${table} WHERE id = ?`).get(id) ?? undefined,
  )
  return decryptInstanceConfig(row.config)
}

describe('migration 045 provider baseUrl backfill', () => {
  let db: Database
  let instanceConfigKey: string | undefined

  beforeEach(() => {
    mockLogger()
    instanceConfigKey = process.env['INSTANCE_CONFIG_KEY']
    process.env['INSTANCE_CONFIG_KEY'] = '4'.repeat(64)
    db = new Database(':memory:')
    createInstanceTables(db)
  })

  afterEach(() => {
    db.close()
    if (instanceConfigKey === undefined) Reflect.deleteProperty(process.env, 'INSTANCE_CONFIG_KEY')
    else process.env['INSTANCE_CONFIG_KEY'] = instanceConfigKey
  })

  test('copies legacy url to baseUrl in encrypted platform and task instance configs', () => {
    insertInstance(db, 'platform_instances', 'mattermost-default', 'mattermost', {
      url: 'https://mattermost.invalid',
      token: 'mattermost-token',
    })
    insertInstance(db, 'task_instances', 'youtrack-default', 'youtrack', {
      url: 'https://youtrack.invalid',
      token: 'youtrack-token',
    })

    getMigration().up(db)

    expect(readConfig(db, 'platform_instances', 'mattermost-default')).toMatchObject({
      baseUrl: 'https://mattermost.invalid',
      url: 'https://mattermost.invalid',
    })
    expect(readConfig(db, 'task_instances', 'youtrack-default')).toMatchObject({
      baseUrl: 'https://youtrack.invalid',
      url: 'https://youtrack.invalid',
    })
  })

  test('does not overwrite existing baseUrl values', () => {
    insertInstance(db, 'task_instances', 'kaneo-default', 'kaneo', {
      baseUrl: 'https://new-kaneo.invalid',
      url: 'https://old-kaneo.invalid',
    })

    getMigration().up(db)

    expect(readConfig(db, 'task_instances', 'kaneo-default')).toMatchObject({
      baseUrl: 'https://new-kaneo.invalid',
      url: 'https://old-kaneo.invalid',
    })
  })
})
