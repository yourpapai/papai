// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { describe, expect, mock, test } from 'bun:test'

import { drizzle } from 'drizzle-orm/bun-sqlite'

import { closeDrizzleDb, setDrizzleDbForTesting } from '../../src/db/drizzle.js'
import * as schema from '../../src/db/schema.js'

describe('closeDrizzleDb', () => {
  test('closes the underlying sqlite handle when present', () => {
    const sqlite = new Database(':memory:')
    const close = mock(sqlite.close.bind(sqlite))
    sqlite.close = close
    const db = drizzle(sqlite, { schema })

    setDrizzleDbForTesting(db)
    closeDrizzleDb()

    expect(close).toHaveBeenCalledTimes(1)
  })
})
