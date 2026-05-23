// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { llmUsageEvents } from '../../src/db/schema.js'
import { llmUsageGlobal } from '../../src/stats/global-llm.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const ONE_DAY = 24 * 60 * 60 * 1000

function rowAt(
  occurredAt: number,
  modelRole: 'main' | 'small' | 'embedding',
  inputTokens: number,
  outputTokens: number,
): typeof llmUsageEvents.$inferInsert {
  return {
    eventId: `e-${occurredAt}-${modelRole}-${Math.random()}`,
    occurredAt,
    storageContextId: 'u1',
    contextType: 'dm',
    chatUserId: 'u1',
    model: modelRole === 'embedding' ? 'embed-1' : modelRole === 'small' ? 'small-1' : 'main-1',
    modelRole,
    inputTokens,
    outputTokens,
    durationMs: 1,
  }
}

describe('llmUsageGlobal', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns zeroes when llm_usage_events is empty', () => {
    const result = llmUsageGlobal('all')
    expect(result).toEqual({
      totalCalls: 0,
      mainCalls: 0,
      smallCalls: 0,
      embeddingCalls: 0,
      inputTokensTotal: 0,
      outputTokensTotal: 0,
    })
  })

  test('aggregates counts and tokens grouped by model role for window=all', () => {
    const now = Date.now()
    getDrizzleDb()
      .insert(llmUsageEvents)
      .values([
        rowAt(now, 'main', 100, 50),
        rowAt(now, 'main', 200, 80),
        rowAt(now, 'small', 30, 10),
        rowAt(now, 'embedding', 0, 0),
      ])
      .run()

    const result = llmUsageGlobal('all')
    expect(result.totalCalls).toBe(4)
    expect(result.mainCalls).toBe(2)
    expect(result.smallCalls).toBe(1)
    expect(result.embeddingCalls).toBe(1)
    expect(result.inputTokensTotal).toBe(330)
    expect(result.outputTokensTotal).toBe(140)
  })

  test('applies window cutoff for 1d/7d/30d', () => {
    const now = Date.now()
    getDrizzleDb()
      .insert(llmUsageEvents)
      .values([
        rowAt(now - 2 * 60 * 60 * 1000, 'main', 10, 5),
        rowAt(now - 3 * ONE_DAY, 'main', 20, 10),
        rowAt(now - 20 * ONE_DAY, 'main', 40, 20),
        rowAt(now - 60 * ONE_DAY, 'main', 80, 40),
      ])
      .run()

    expect(llmUsageGlobal('1d', now).totalCalls).toBe(1)
    expect(llmUsageGlobal('7d', now).totalCalls).toBe(2)
    expect(llmUsageGlobal('30d', now).totalCalls).toBe(3)
    expect(llmUsageGlobal('all', now).totalCalls).toBe(4)
  })

  test('treats null input/output token columns as zero contributions', () => {
    const now = Date.now()
    getDrizzleDb()
      .insert(llmUsageEvents)
      .values([
        {
          eventId: 'n1',
          occurredAt: now,
          storageContextId: 'u1',
          contextType: 'dm',
          chatUserId: 'u1',
          model: 'm',
          modelRole: 'main',
          inputTokens: null,
          outputTokens: null,
          durationMs: 1,
        },
      ])
      .run()

    const r = llmUsageGlobal('all')
    expect(r.totalCalls).toBe(1)
    expect(r.inputTokensTotal).toBe(0)
    expect(r.outputTokensTotal).toBe(0)
  })
})
