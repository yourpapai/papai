// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { allOccurrencesBetween, describeCron, nextCronOccurrence, parseCron } from './recurrence/legacy-cron-oracle.js'
import { mockLogger } from './utils/test-helpers.js'

beforeEach(() => {
  mockLogger()
})

describe('parseCron', () => {
  test('parses a valid 5-field cron expression', () => {
    const result = parseCron('0 9 * * 1')
    expect(result).not.toBeNull()
    expect(result!.minute).toEqual({ type: 'values', values: [0] })
    expect(result!.hour).toEqual({ type: 'values', values: [9] })
    expect(result!.dayOfMonth).toEqual({ type: 'any', values: [] })
    expect(result!.month).toEqual({ type: 'any', values: [] })
    expect(result!.dayOfWeek).toEqual({ type: 'values', values: [1] })
  })

  test('returns null for invalid expression', () => {
    expect(parseCron('invalid')).toBeNull()
    expect(parseCron('1 2 3')).toBeNull()
    expect(parseCron('')).toBeNull()
  })

  test('parses ranges', () => {
    const result = parseCron('0 9 * * 1-5')
    expect(result).not.toBeNull()
    expect(result!.dayOfWeek).toEqual({ type: 'values', values: [1, 2, 3, 4, 5] })
  })

  test('parses comma-separated values', () => {
    const result = parseCron('0,30 * * * *')
    expect(result).not.toBeNull()
    expect(result!.minute).toEqual({ type: 'values', values: [0, 30] })
  })

  test('parses step values', () => {
    const result = parseCron('*/15 * * * *')
    expect(result).not.toBeNull()
    expect(result!.minute).toEqual({ type: 'values', values: [0, 15, 30, 45] })
  })

  test('returns null for zero step (*/0)', () => {
    // Zero step produces no values → parseCron returns null (invalid expression)
    expect(parseCron('*/0 * * * *')).toBeNull()
  })

  test('returns null for negative step (*/-1)', () => {
    // */-1 does not match the step regex so produces no values → parseCron returns null
    expect(parseCron('*/-1 * * * *')).toBeNull()
  })

  test('parses impossible date (Feb 31) without error', () => {
    const result = parseCron('0 0 31 2 *')
    // Parser validates individual field bounds (31 valid for dayOfMonth, 2 valid for month)
    // but does not validate cross-field combos
    expect(result).not.toBeNull()
  })
})

describe('cron matching via nextCronOccurrence', () => {
  test('finds exact match at correct day and time', () => {
    const cron = parseCron('0 9 * * 1')!
    // One minute before Monday 9am — next occurrence should be exactly Monday 9am
    const justBefore = new Date('2026-03-23T08:59:00Z')
    const next = nextCronOccurrence(cron, justBefore)
    expect(next).not.toBeNull()
    expect(next!.toISOString()).toBe('2026-03-23T09:00:00.000Z')
  })

  test('skips wrong day', () => {
    const cron = parseCron('0 9 * * 1')!
    // Tuesday — should skip to next Monday
    const tuesday = new Date('2026-03-24T08:59:00Z')
    const next = nextCronOccurrence(cron, tuesday)
    expect(next).not.toBeNull()
    // Next Monday is March 30
    expect(next!.getUTCDay()).toBe(1)
  })

  test('every-minute cron matches immediately', () => {
    const cron = parseCron('* * * * *')!
    const now = new Date('2026-03-23T10:00:00Z')
    const next = nextCronOccurrence(cron, now)
    expect(next).not.toBeNull()
    // Should be the very next minute
    expect(next!.toISOString()).toBe('2026-03-23T10:01:00.000Z')
  })
})

describe('nextCronOccurrence', () => {
  test('finds next Monday at 9am', () => {
    const cron = parseCron('0 9 * * 1')!
    // Start from Sunday 2026-03-22
    const sunday = new Date('2026-03-22T10:00:00Z')
    const next = nextCronOccurrence(cron, sunday)
    expect(next).not.toBeNull()
    // Monday
    expect(next!.getUTCDay()).toBe(1)
    expect(next!.getUTCHours()).toBe(9)
    expect(next!.getUTCMinutes()).toBe(0)
  })

  test('finds next occurrence for daily cron', () => {
    const cron = parseCron('30 14 * * *')!
    const now = new Date('2026-03-21T15:00:00Z')
    const next = nextCronOccurrence(cron, now)
    expect(next).not.toBeNull()
    expect(next!.getUTCHours()).toBe(14)
    expect(next!.getUTCMinutes()).toBe(30)
    // Should be the next day since 14:30 already passed
    expect(next!.getUTCDate()).toBe(22)
  })

  test('finds next occurrence for first of month', () => {
    const cron = parseCron('0 0 1 * *')!
    const now = new Date('2026-03-15T00:00:00Z')
    const next = nextCronOccurrence(cron, now)
    expect(next).not.toBeNull()
    expect(next!.getUTCDate()).toBe(1)
    // April (0-indexed)
    expect(next!.getUTCMonth()).toBe(3)
  })

  test('returns null for impossible date (Feb 31 — never occurs)', () => {
    const cron = parseCron('0 0 31 2 *')!
    const start = new Date('2026-01-01T00:00:00Z')
    const result = nextCronOccurrence(cron, start)
    // Feb never has 31 days — the scanner should exhaust its limit and return null
    expect(result).toBeNull()
  })
})

describe('timezone-aware cron matching', () => {
  test('nextCronOccurrence returns UTC time matching timezone-local 9am', () => {
    const cron = parseCron('0 9 * * *')!
    // Sunday 2026-03-22 at 15:00 UTC = 11:00 EDT — past 9am local
    const after = new Date('2026-03-22T15:00:00Z')
    const next = nextCronOccurrence(cron, after, 'America/New_York')
    expect(next).not.toBeNull()
    // 9am EDT next day = 13:00 UTC
    expect(next!.getUTCHours()).toBe(13)
  })

  test('defaults to UTC when no timezone specified', () => {
    const cron = parseCron('0 9 * * 1')!
    const justBefore = new Date('2026-03-23T08:59:00Z')
    const next = nextCronOccurrence(cron, justBefore)
    expect(next).not.toBeNull()
    expect(next!.getUTCHours()).toBe(9)
  })

  test('falls back to UTC for invalid timezone', () => {
    const cron = parseCron('0 9 * * *')!
    const justBefore = new Date('2026-03-23T08:59:00Z')
    const next = nextCronOccurrence(cron, justBefore, 'Invalid/Timezone')
    expect(next).not.toBeNull()
    expect(next!.getUTCHours()).toBe(9)
  })

  test('handles spring-forward DST gap (2:30 AM does not exist)', () => {
    // March 8, 2026: US clocks spring forward 2:00 AM → 3:00 AM
    const cron = parseCron('30 2 * * *')!
    // 2026-03-08T06:00:00Z = 1:00 AM ET
    const before = new Date('2026-03-08T06:00:00Z')
    const result = nextCronOccurrence(cron, before, 'America/New_York')
    expect(result).not.toBeNull()
    // The function should return a valid date — either skipping Mar 8 or adjusting
    // Document the behavior: result should be after the input
    expect(result!.getTime()).toBeGreaterThan(before.getTime())
  })
})

describe('describeCron', () => {
  test('describes weekly Monday schedule', () => {
    const desc = describeCron('0 9 * * 1')
    expect(desc).toContain('09:00 UTC')
    expect(desc).toContain('Monday')
  })

  test('describes daily schedule', () => {
    const desc = describeCron('30 14 * * *')
    expect(desc).toContain('14:30 UTC')
  })

  test('shows user timezone when provided', () => {
    const desc = describeCron('0 9 * * 1', 'America/New_York')
    expect(desc).toContain('09:00 America/New_York')
    expect(desc).toContain('Monday')
  })

  test('returns expression for invalid input', () => {
    expect(describeCron('invalid')).toBe('invalid')
  })
})

describe('allOccurrencesBetween', () => {
  test('returns all occurrences between two dates', () => {
    // Mondays 9am
    const cron = parseCron('0 9 * * 1')!
    const after = new Date('2026-03-01T00:00:00Z')
    const before = new Date('2026-03-31T23:59:00Z')
    const results = allOccurrencesBetween(cron, after, before)
    // Mar 2, 9, 16, 23, 30
    expect(results).toHaveLength(5)
    for (const d of results) {
      expect(d.getUTCDay()).toBe(1)
      expect(d.getUTCHours()).toBe(9)
      expect(d.getUTCMinutes()).toBe(0)
    }
  })

  test('returns empty array when no occurrences in range', () => {
    // Mondays 9am — after Monday 9am, before end of same day
    const cron = parseCron('0 9 * * 1')!
    const after = new Date('2026-03-23T09:00:00Z')
    const before = new Date('2026-03-23T23:59:00Z')
    const results = allOccurrencesBetween(cron, after, before)
    expect(results).toEqual([])
  })

  test('after is exclusive', () => {
    // Daily 9am — after is exactly at an occurrence (Mar 15 09:00)
    const cron = parseCron('0 9 * * *')!
    const after = new Date('2026-03-15T09:00:00Z')
    const before = new Date('2026-03-17T09:00:00Z')
    const results = allOccurrencesBetween(cron, after, before)
    expect(results).toHaveLength(2)
    expect(results[0]!.getUTCDate()).toBe(16)
    expect(results[1]!.getUTCDate()).toBe(17)
  })

  test('before is inclusive', () => {
    // Daily 9am
    const cron = parseCron('0 9 * * *')!
    const after = new Date('2026-03-14T09:00:00Z')
    const before = new Date('2026-03-15T09:00:00Z')
    const results = allOccurrencesBetween(cron, after, before)
    expect(results).toHaveLength(1)
    expect(results[0]!.getTime()).toBe(before.getTime())
  })

  test('respects maxResults cap', () => {
    // Every minute
    const cron = parseCron('* * * * *')!
    const after = new Date('2026-03-15T00:00:00Z')
    const before = new Date('2026-03-16T00:00:00Z')
    const results = allOccurrencesBetween(cron, after, before, 5)
    expect(results).toHaveLength(5)
  })

  test('start equals end returns empty', () => {
    // Daily 9am
    const cron = parseCron('0 9 * * *')!
    const point = new Date('2026-03-15T09:00:00Z')
    const results = allOccurrencesBetween(cron, point, point)
    expect(results).toEqual([])
  })
})
