// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { conversationHistory, memorySummary } from '../../src/db/schema.js'
import { conversationForSubject } from '../../src/stats/per-table-content.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('conversationForSubject', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns zero turns and no summary when nothing seeded', () => {
    expect(conversationForSubject('nobody')).toEqual({ turnCount: 0, summaryPresent: false })
  })

  test('counts JSON array length and detects summary presence', () => {
    getDrizzleDb()
      .insert(conversationHistory)
      .values({ userId: 'u1', messages: JSON.stringify([{ role: 'user' }, { role: 'assistant' }, { role: 'user' }]) })
      .run()
    getDrizzleDb().insert(memorySummary).values({ userId: 'u1', summary: 's', updatedAt: '2026-01-01T00:00:00Z' }).run()

    const result = conversationForSubject('u1')

    expect(result.turnCount).toBe(3)
    expect(result.summaryPresent).toBe(true)
  })

  test('handles empty array and missing summary', () => {
    getDrizzleDb().insert(conversationHistory).values({ userId: 'u1', messages: '[]' }).run()

    const result = conversationForSubject('u1')

    expect(result.turnCount).toBe(0)
    expect(result.summaryPresent).toBe(false)
  })

  test('handles malformed JSON gracefully', () => {
    getDrizzleDb().insert(conversationHistory).values({ userId: 'u1', messages: 'not-json' }).run()

    const result = conversationForSubject('u1')

    expect(result.turnCount).toBe(0)
  })
})
