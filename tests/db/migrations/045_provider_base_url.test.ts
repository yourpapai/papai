// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { migration045ProviderBaseUrl } from '../../../src/db/migrations/045_provider_base_url.js'
import { decryptInstanceConfig, encryptInstanceConfig } from '../../../src/instances/encryption.js'

const originalEnv = process.env['INSTANCE_CONFIG_KEY']

describe('migration045ProviderBaseUrl', () => {
  let db: Database

  beforeEach(() => {
    process.env['INSTANCE_CONFIG_KEY'] = '0'.repeat(64)
    db = new Database(':memory:')
    for (const table of ['platform_instances', 'task_instances']) {
      db.run(
        `CREATE TABLE ${table} (id TEXT PRIMARY KEY, type TEXT NOT NULL, config TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT '')`,
      )
    }
  })

  afterEach(() => {
    if (originalEnv === undefined) delete process.env['INSTANCE_CONFIG_KEY']
    else process.env['INSTANCE_CONFIG_KEY'] = originalEnv
    db.close()
  })

  test('backfills readable rows and skips an undecryptable row without throwing', () => {
    const good = encryptInstanceConfig({ url: 'https://kaneo.example' })
    db.run(`INSERT INTO platform_instances (id, type, config) VALUES ('good', 'telegram', ?)`, [good])
    db.run(`INSERT INTO platform_instances (id, type, config) VALUES ('bad', 'telegram', 'not-an-encrypted-blob')`)

    expect(() => migration045ProviderBaseUrl.up(db)).not.toThrow()

    const goodRow = db.query<{ config: string }, []>(`SELECT config FROM platform_instances WHERE id='good'`).get()
    expect(decryptInstanceConfig(goodRow!.config)['baseUrl']).toBe('https://kaneo.example')

    const badRow = db.query<{ config: string }, []>(`SELECT config FROM platform_instances WHERE id='bad'`).get()
    expect(badRow!.config).toBe('not-an-encrypted-blob')
  })
})
