// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { recurringTasks } from '../src/db/schema.js'
import { buildCompiled, computeMissedDates, computeNextRun, parseLabels, toRecord } from '../src/recurring-utils.js'

type RecurringTaskRow = typeof recurringTasks.$inferSelect

const makeRow = (overrides: Partial<RecurringTaskRow>): RecurringTaskRow => ({
  id: 'row-1',
  userId: 'user-1',
  projectId: 'project-1',
  title: 'Title',
  description: null,
  priority: null,
  status: null,
  assignee: null,
  labels: null,
  triggerType: 'cron',
  rrule: null,
  dtstartUtc: null,
  timezone: 'UTC',
  enabled: '1',
  catchUp: '0',
  lastRun: null,
  nextRun: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

describe('parseLabels', () => {
  test('returns an empty array for null and empty-string input', () => {
    expect(parseLabels(null)).toEqual([])
    expect(parseLabels('')).toEqual([])
  })

  test('returns an empty array when the JSON value is not an array', () => {
    expect(parseLabels('{}')).toEqual([])
    expect(parseLabels('5')).toEqual([])
  })

  test('drops elements that are not strings', () => {
    expect(parseLabels('["a",1,true,"b"]')).toEqual(['a', 'b'])
  })

  test('parses a valid string-only array verbatim', () => {
    expect(parseLabels('["x","y"]')).toEqual(['x', 'y'])
  })
})

describe('toRecord', () => {
  test('coerces enabled and catchUp from their TEXT flags', () => {
    const enabled = toRecord(makeRow({ enabled: '1', catchUp: '1' }))
    expect(enabled.enabled).toBe(true)
    expect(enabled.catchUp).toBe(true)

    const disabled = toRecord(makeRow({ enabled: '0', catchUp: '0' }))
    expect(disabled.enabled).toBe(false)
    expect(disabled.catchUp).toBe(false)
  })
})

describe('computeNextRun', () => {
  test('returns null when the recurrence is exhausted past the last occurrence', () => {
    const exhausted = {
      rrule: 'FREQ=DAILY;COUNT=2',
      dtstartUtc: '2025-01-01T00:00:00.000Z',
      timezone: 'UTC',
    }
    const result = computeNextRun(exhausted, new Date('2026-12-31T00:00:00.000Z'))
    expect(result).toBe(null)
  })
})

describe('computeMissedDates', () => {
  const countCompiled = {
    rrule: 'FREQ=DAILY;COUNT=3',
    dtstartUtc: '2026-01-01T00:00:00.000Z',
    timezone: 'UTC',
  }

  test('honours a non-null fromDate window instead of the epoch fallback', () => {
    const result = computeMissedDates(countCompiled, '2026-01-02T12:00:00.000Z')
    expect(result).toEqual(['2026-01-03T00:00:00.000Z'])
  })

  test('maps each missed occurrence to its ISO string', () => {
    const result = computeMissedDates(countCompiled, '2026-01-02T12:00:00.000Z')
    expect(result[0]).toBe('2026-01-03T00:00:00.000Z')
  })
})

describe('buildCompiled', () => {
  test('returns null when exactly one of rrule or dtstartUtc is null', () => {
    expect(buildCompiled(null, '2026-01-01T00:00:00.000Z', 'UTC')).toBe(null)
    expect(buildCompiled('FREQ=DAILY', null, 'UTC')).toBe(null)
  })

  test('builds a compiled recurrence when both rrule and dtstartUtc are set', () => {
    expect(buildCompiled('FREQ=DAILY', '2026-01-01T00:00:00.000Z', 'UTC')).toEqual({
      rrule: 'FREQ=DAILY',
      dtstartUtc: '2026-01-01T00:00:00.000Z',
      timezone: 'UTC',
    })
  })
})
