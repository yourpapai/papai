// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { codingSessionCredentials } from '../../src/db/coding-credentials-schema.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { setupTestDb } from '../utils/test-helpers.js'

describe('codingSessionCredentials schema', () => {
  test('inserts and reads a coding credential row', async () => {
    await setupTestDb()

    getDrizzleDb()
      .insert(codingSessionCredentials)
      .values({
        contextId: 'pi:telegram:ctx:user-1',
        namespace: 'agent-provider',
        encryptedConfig: 'payload',
        updatedAt: 1710000000000,
        updatedBy: 'user-1',
      })
      .run()

    const row = getDrizzleDb().select().from(codingSessionCredentials).get()
    expect(row).toEqual({
      contextId: 'pi:telegram:ctx:user-1',
      namespace: 'agent-provider',
      encryptedConfig: 'payload',
      updatedAt: 1710000000000,
      updatedBy: 'user-1',
    })
  })
})
