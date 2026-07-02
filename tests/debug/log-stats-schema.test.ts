// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { LogBufferStatsSchema, safeParseLogBufferStats } from '../../src/debug/log-stats-schema.js'

describe('LogBufferStatsSchema', () => {
  test('parses valid stats without matchingCount', () => {
    const result = LogBufferStatsSchema.safeParse({
      count: 10,
      capacity: 65535,
      oldest: '2026-06-15T00:00:00.000Z',
      newest: '2026-06-15T00:01:00.000Z',
    })
    expect(result.success).toBe(true)
  })

  test('parses valid stats with matchingCount', () => {
    const result = LogBufferStatsSchema.safeParse({
      count: 10,
      capacity: 65535,
      oldest: '2026-06-15T00:00:00.000Z',
      newest: '2026-06-15T00:01:00.000Z',
      matchingCount: 3,
    })
    expect(result.success).toBe(true)
  })

  test('parsed matchingCount equals input value', () => {
    const stats = safeParseLogBufferStats({
      count: 10,
      capacity: 65535,
      oldest: '2026-06-15T00:00:00.000Z',
      newest: '2026-06-15T00:01:00.000Z',
      matchingCount: 3,
    })
    expect(stats?.matchingCount).toBe(3)
  })

  test('matchingCount is optional', () => {
    const result = LogBufferStatsSchema.safeParse({
      count: 0,
      capacity: 65535,
      oldest: null,
      newest: null,
    })
    expect(result.success).toBe(true)
  })

  test('parsed stats without matchingCount has undefined matchingCount', () => {
    const stats = safeParseLogBufferStats({
      count: 0,
      capacity: 65535,
      oldest: null,
      newest: null,
    })
    expect(stats?.matchingCount).toBeUndefined()
  })

  test('rejects missing required fields', () => {
    const result = LogBufferStatsSchema.safeParse({ count: 5 })
    expect(result.success).toBe(false)
  })
})

describe('safeParseLogBufferStats', () => {
  test('returns parsed stats on valid input', () => {
    const stats = safeParseLogBufferStats({
      count: 5,
      capacity: 100,
      oldest: '2026-01-01T00:00:00.000Z',
      newest: '2026-01-02T00:00:00.000Z',
      matchingCount: 2,
    })
    expect(stats).not.toBeNull()
    expect(stats?.count).toBe(5)
    expect(stats?.matchingCount).toBe(2)
  })

  test('returns null on invalid input', () => {
    expect(safeParseLogBufferStats(null)).toBeNull()
    expect(safeParseLogBufferStats({ count: 'bad' })).toBeNull()
  })
})
