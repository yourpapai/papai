// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { toolCallEvents, webCache } from '../../src/db/schema.js'
import { toolMixGlobal, webFetchesGlobal } from '../../src/stats/global-web-tools.js'
import { keyedHash } from '../../src/stats/hashing.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('webFetchesGlobal', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns empty list when no cache rows', () => {
    expect(webFetchesGlobal()).toEqual({ topHosts: [] })
  })

  test('groups by keyed-hashed host, never leaks plain hostnames', () => {
    getDrizzleDb()
      .insert(webCache)
      .values([
        {
          urlHash: 'h1',
          url: 'https://example.com/a',
          finalUrl: 'https://example.com/a',
          title: 't',
          summary: 's',
          excerpt: 'e',
          contentType: 'text/html',
          fetchedAt: 1,
          expiresAt: 2,
        },
        {
          urlHash: 'h2',
          url: 'https://example.com/b',
          finalUrl: 'https://example.com/b',
          title: 't',
          summary: 's',
          excerpt: 'e',
          contentType: 'text/html',
          fetchedAt: 1,
          expiresAt: 2,
        },
        {
          urlHash: 'h3',
          url: 'https://example.com/c',
          finalUrl: 'https://example.com/c',
          title: 't',
          summary: 's',
          excerpt: 'e',
          contentType: 'text/html',
          fetchedAt: 1,
          expiresAt: 2,
        },
        {
          urlHash: 'h4',
          url: 'https://other.org/x',
          finalUrl: 'https://other.org/x',
          title: 't',
          summary: 's',
          excerpt: 'e',
          contentType: 'text/html',
          fetchedAt: 1,
          expiresAt: 2,
        },
      ])
      .run()

    const result = webFetchesGlobal()

    expect(result.topHosts[0]?.count).toBe(3)
    expect(result.topHosts[0]?.hostHash).toBe(keyedHash('host:example.com'))
    expect(result.topHosts[1]?.count).toBe(1)
    expect(result.topHosts[1]?.hostHash).toBe(keyedHash('host:other.org'))

    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('example.com')
    expect(serialized).not.toContain('other.org')
  })
})

describe('toolMixGlobal', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns empty mix when no rows', () => {
    expect(toolMixGlobal()).toEqual({
      topTools: [],
      errorTypeCounts: {},
      totalCalls: 0,
      totalSuccessRate: 0,
      toolCallGrowth30d: [],
    })
  })

  test('aggregates tool counts, success rate, and error type counts globally', () => {
    const base = {
      turnId: 't',
      contextType: 'dm',
      chatUserId: 'u1',
      model: 'm',
      modelRole: 'main',
      toolCallId: 'tc',
    } as const

    getDrizzleDb()
      .insert(toolCallEvents)
      .values([
        {
          eventId: 't1',
          storageContextId: 'u1',
          occurredAt: 1,
          toolName: 'search_tasks',
          success: 1,
          ...base,
        },
        {
          eventId: 't2',
          storageContextId: 'u1',
          occurredAt: 2,
          toolName: 'search_tasks',
          success: 1,
          ...base,
        },
        {
          eventId: 't3',
          storageContextId: 'u2',
          occurredAt: 3,
          toolName: 'search_tasks',
          success: 0,
          ...base,
          errorType: 'provider',
        },
        {
          eventId: 't4',
          storageContextId: 'u1',
          occurredAt: 4,
          toolName: 'create_task',
          success: 0,
          ...base,
          errorType: 'network',
        },
        {
          eventId: 't5',
          storageContextId: 'u2',
          occurredAt: 5,
          toolName: 'create_task',
          success: 1,
          ...base,
        },
      ])
      .run()

    const result = toolMixGlobal()

    expect(result.topTools[0]?.toolName).toBe('search_tasks')
    expect(result.topTools[0]?.count).toBe(3)
    expect(result.topTools[0]?.successRate).toBeCloseTo(2 / 3, 5)
    expect(result.topTools[1]?.toolName).toBe('create_task')
    expect(result.topTools[1]?.count).toBe(2)
    expect(result.topTools[1]?.successRate).toBe(0.5)
    expect(result.errorTypeCounts).toEqual({ network: 1, provider: 1 })
  })

  test('totalCalls counts all rows and totalSuccessRate is fraction 0-1', () => {
    const base = {
      turnId: 't',
      contextType: 'dm',
      chatUserId: 'u1',
      model: 'm',
      modelRole: 'main',
      toolCallId: 'tc',
      storageContextId: 'u1',
    } as const

    getDrizzleDb()
      .insert(toolCallEvents)
      .values([
        { eventId: 'r1', occurredAt: 10, toolName: 'create_task', success: 1, ...base },
        { eventId: 'r2', occurredAt: 20, toolName: 'create_task', success: 1, ...base },
        { eventId: 'r3', occurredAt: 30, toolName: 'search_tasks', success: 0, ...base, errorType: 'err' },
      ])
      .run()

    const result = toolMixGlobal()

    expect(result.totalCalls).toBe(3)
    expect(result.totalSuccessRate).toBeCloseTo(2 / 3, 5)
  })

  test('totalSuccessRate is 0 when there are no rows', () => {
    const result = toolMixGlobal()
    expect(result.totalCalls).toBe(0)
    expect(result.totalSuccessRate).toBe(0)
  })

  test('toolCallGrowth30d returns daily buckets within 30 days, excludes older rows, ascending order', () => {
    const now = Date.now()
    const ONE_DAY_MS = 24 * 60 * 60 * 1000
    const base = {
      turnId: 't',
      contextType: 'dm',
      chatUserId: 'u1',
      model: 'm',
      modelRole: 'main',
      toolCallId: 'tc',
      storageContextId: 'u1',
    } as const

    // 2 calls 5 days ago
    const fiveDaysAgo = now - 5 * ONE_DAY_MS
    // 1 call yesterday
    const yesterday = now - ONE_DAY_MS
    // 1 call older than 30 days (should be excluded)
    const thirtyOneDaysAgo = now - 31 * ONE_DAY_MS

    getDrizzleDb()
      .insert(toolCallEvents)
      .values([
        { eventId: 'g1', occurredAt: fiveDaysAgo, toolName: 'create_task', success: 1, ...base },
        { eventId: 'g2', occurredAt: fiveDaysAgo + 1000, toolName: 'search_tasks', success: 1, ...base },
        { eventId: 'g3', occurredAt: yesterday, toolName: 'create_task', success: 0, ...base, errorType: 'e' },
        { eventId: 'g4', occurredAt: thirtyOneDaysAgo, toolName: 'create_task', success: 1, ...base },
      ])
      .run()

    const result = toolMixGlobal()

    // Only rows within 30 days are included in growth
    expect(result.toolCallGrowth30d.length).toBeGreaterThanOrEqual(2)

    const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
    const fiveDayDate = isoDay(fiveDaysAgo)
    const yesterdayDate = isoDay(yesterday)

    const fiveDay = result.toolCallGrowth30d.find((p) => p.date === fiveDayDate)
    const yDay = result.toolCallGrowth30d.find((p) => p.date === yesterdayDate)
    expect(fiveDay?.count).toBe(2)
    expect(yDay?.count).toBe(1)

    // The 31-day-old row must not appear at all
    const thirtyOneDate = isoDay(thirtyOneDaysAgo)
    expect(result.toolCallGrowth30d.find((p) => p.date === thirtyOneDate)).toBeUndefined()

    // Result is sorted ascending
    const dates = result.toolCallGrowth30d.map((p) => p.date)
    expect(dates).toEqual([...dates].sort())
  })
})
