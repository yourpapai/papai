// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { userInstructions } from '../../src/db/schema.js'
import { instructionsForSubject } from '../../src/stats/per-table.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('instructionsForSubject', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns zero-shape when subject has no instructions', () => {
    expect(instructionsForSubject('nobody')).toEqual({ total: 0, textBytesTotal: 0 })
  })

  test('aggregates total count and text-byte total', () => {
    getDrizzleDb()
      .insert(userInstructions)
      .values([
        { id: 'i1', contextId: 'u1', text: 'hello' },
        { id: 'i2', contextId: 'u1', text: 'world!' },
        { id: 'i3', contextId: 'other', text: 'leak' },
      ])
      .run()

    const result = instructionsForSubject('u1')

    expect(result.total).toBe(2)
    expect(result.textBytesTotal).toBe(5 + 6)
  })
})
