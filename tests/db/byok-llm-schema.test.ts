// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { byokLlmCredentials } from '../../src/db/byok-llm-schema.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { setupTestDb } from '../utils/test-helpers.js'

describe('byokLlmCredentials schema', () => {
  test('inserts and reads a BYOK row', async () => {
    await setupTestDb()

    getDrizzleDb()
      .insert(byokLlmCredentials)
      .values({
        contextId: 'ctx-1',
        enabled: true,
        encryptedConfig: 'payload',
        updatedAt: 1710000000000,
        updatedBy: 'admin-1',
      })
      .run()

    const row = getDrizzleDb().select().from(byokLlmCredentials).get()
    expect(row).toEqual({
      contextId: 'ctx-1',
      enabled: true,
      encryptedConfig: 'payload',
      updatedAt: 1710000000000,
      updatedBy: 'admin-1',
    })
  })
})
