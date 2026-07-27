// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createMigratedDbFile } from './test-helpers.js'

describe('createMigratedDbFile', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'migrated-db-file-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('writes an on-disk database another connection can open and read', async () => {
    const dbPath = join(dir, 'test.db')

    await createMigratedDbFile(dbPath)

    // A fresh connection stands in for the subprocess that will open this file via DB_PATH.
    const sqlite = new Database(dbPath)
    const tables = sqlite
      .query<{ name: string }, []>("select name from sqlite_master where type = 'table'")
      .all()
      .map((tableRow) => tableRow.name)
    sqlite.close()

    expect(tables).toContain('memory_recall_shadow_log')
  })
})
