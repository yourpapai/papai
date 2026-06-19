// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { llmUsageEvents } from '../../src/db/schema.js'
import { tokenUsageByDayForSubject, tokenUsageByDayGlobal } from '../../src/stats/token-usage-series.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

const base = {
  turnId: 't',
  contextType: 'dm',
  chatUserId: 'u1',
  model: 'm',
  durationMs: 1,
} as const

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

describe('tokenUsageByDayGlobal', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns empty series when no rows', () => {
    expect(tokenUsageByDayGlobal('30d')).toEqual([])
  })

  test('buckets tokens and calls by UTC day, ascending, within the window', () => {
    const now = Date.now()
    const fiveDaysAgo = now - 5 * ONE_DAY_MS
    const yesterday = now - ONE_DAY_MS
    const thirtyOneDaysAgo = now - 31 * ONE_DAY_MS

    getDrizzleDb()
      .insert(llmUsageEvents)
      .values([
        {
          eventId: 'a1',
          storageContextId: 'u1',
          occurredAt: fiveDaysAgo,
          modelRole: 'main',
          inputTokens: 100,
          outputTokens: 10,
          ...base,
        },
        {
          eventId: 'a2',
          storageContextId: 'u1',
          occurredAt: fiveDaysAgo + 1000,
          modelRole: 'small',
          inputTokens: 50,
          outputTokens: 5,
          ...base,
        },
        {
          eventId: 'a3',
          storageContextId: 'u2',
          occurredAt: yesterday,
          modelRole: 'main',
          inputTokens: 200,
          outputTokens: 20,
          ...base,
        },
        // older than 30d — excluded by the 30d window
        {
          eventId: 'a4',
          storageContextId: 'u1',
          occurredAt: thirtyOneDaysAgo,
          modelRole: 'main',
          inputTokens: 999,
          outputTokens: 99,
          ...base,
        },
      ])
      .run()

    const series = tokenUsageByDayGlobal('30d', now)

    const five = series.find((p) => p.date === isoDay(fiveDaysAgo))
    const y = series.find((p) => p.date === isoDay(yesterday))
    expect(five).toEqual({ date: isoDay(fiveDaysAgo), inputTokens: 150, outputTokens: 15, calls: 2 })
    expect(y).toEqual({ date: isoDay(yesterday), inputTokens: 200, outputTokens: 20, calls: 1 })
    expect(series.find((p) => p.date === isoDay(thirtyOneDaysAgo))).toBeUndefined()

    const dates = series.map((p) => p.date)
    expect(dates).toEqual([...dates].sort())
  })

  test("window 'all' includes rows older than 30 days", () => {
    const now = Date.now()
    const longAgo = now - 100 * ONE_DAY_MS
    getDrizzleDb()
      .insert(llmUsageEvents)
      .values([
        {
          eventId: 'b1',
          storageContextId: 'u1',
          occurredAt: longAgo,
          modelRole: 'main',
          inputTokens: 7,
          outputTokens: 1,
          ...base,
        },
      ])
      .run()

    const series = tokenUsageByDayGlobal('all', now)
    expect(series).toEqual([{ date: isoDay(longAgo), inputTokens: 7, outputTokens: 1, calls: 1 }])
  })

  test('series is anonymous: only date + numeric fields, no free-form content', () => {
    const now = Date.now()
    getDrizzleDb()
      .insert(llmUsageEvents)
      .values([
        {
          eventId: 'c1',
          storageContextId: 'secret-context',
          occurredAt: now - ONE_DAY_MS,
          modelRole: 'main',
          inputTokens: 1,
          outputTokens: 1,
          ...base,
        },
      ])
      .run()

    const series = tokenUsageByDayGlobal('30d', now)
    for (const point of series) {
      expect(Object.keys(point).sort()).toEqual(['calls', 'date', 'inputTokens', 'outputTokens'])
      expect(point.date).toMatch(/^\d{4}-\d{2}-\d{2}$/u)
    }
    const serialized = JSON.stringify(series)
    expect(serialized).not.toContain('secret-context')
    expect(serialized).not.toContain('u1')
  })
})

describe('tokenUsageByDayForSubject', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('only counts rows for the given storage context', () => {
    const now = Date.now()
    const day = now - 2 * ONE_DAY_MS
    getDrizzleDb()
      .insert(llmUsageEvents)
      .values([
        {
          eventId: 'd1',
          storageContextId: 'mine',
          occurredAt: day,
          modelRole: 'main',
          inputTokens: 100,
          outputTokens: 10,
          ...base,
        },
        {
          eventId: 'd2',
          storageContextId: 'mine',
          occurredAt: day + 1000,
          modelRole: 'small',
          inputTokens: 30,
          outputTokens: 3,
          ...base,
        },
        {
          eventId: 'd3',
          storageContextId: 'other',
          occurredAt: day,
          modelRole: 'main',
          inputTokens: 500,
          outputTokens: 50,
          ...base,
        },
      ])
      .run()

    const series = tokenUsageByDayForSubject('mine', 'all', now)
    expect(series).toEqual([{ date: isoDay(day), inputTokens: 130, outputTokens: 13, calls: 2 }])
  })
})
