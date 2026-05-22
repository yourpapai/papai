// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { describeCompiledRecurrence } from '../src/recurrence.js'

describe('describeCompiledRecurrence', () => {
  it('describes a weekly MO/WE/FR rule at 09:00 Europe/London', () => {
    const result = describeCompiledRecurrence({
      rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=9;BYMINUTE=0',
      dtstartUtc: '2026-04-21T09:00:00Z',
      timezone: 'Europe/London',
    })
    expect(result).toContain('09:00 Europe/London')
    expect(result).toContain('Monday')
    expect(result).toContain('Wednesday')
    expect(result).toContain('Friday')
  })

  it('describes a daily rule at 08:30', () => {
    const result = describeCompiledRecurrence({
      rrule: 'FREQ=DAILY;BYHOUR=8;BYMINUTE=30',
      dtstartUtc: '2026-04-21T08:30:00Z',
      timezone: 'UTC',
    })
    expect(result).toBe('daily at 08:30 UTC')
  })

  it('describes a monthly rule on day 15', () => {
    const result = describeCompiledRecurrence({
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=15;BYHOUR=10;BYMINUTE=0',
      dtstartUtc: '2026-04-15T10:00:00Z',
      timezone: 'America/New_York',
    })
    expect(result).toContain('day 15')
    expect(result).toContain('10:00 America/New_York')
  })

  it('falls back to dtstartUtc time-of-day when BYHOUR/BYMINUTE are absent', () => {
    const result = describeCompiledRecurrence({
      rrule: 'FREQ=DAILY',
      dtstartUtc: '2026-04-21T09:30:00Z',
      timezone: 'UTC',
    })
    expect(result).toBe('daily at 09:30 UTC')
  })

  it('falls back to local time in compiled timezone, not UTC, when BYHOUR/BYMINUTE are absent', () => {
    const result = describeCompiledRecurrence({
      rrule: 'FREQ=DAILY',
      dtstartUtc: '2026-03-07T14:00:00Z',
      timezone: 'America/New_York',
    })
    expect(result).toBe('daily at 09:00 America/New_York')
  })

  it('falls back to dtstartUtc hour when only BYMINUTE is present, listing all minute variants', () => {
    const result = describeCompiledRecurrence({
      rrule: 'FREQ=HOURLY;BYMINUTE=0,15,30,45',
      dtstartUtc: '2026-04-21T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result).toContain('09:00')
    expect(result).toContain('09:15')
    expect(result).toContain('09:30')
    expect(result).toContain('09:45')
  })

  it('lists all times when BYHOUR has multiple values', () => {
    const result = describeCompiledRecurrence({
      rrule: 'FREQ=DAILY;BYHOUR=9,17;BYMINUTE=0',
      dtstartUtc: '2026-04-21T09:00:00Z',
      timezone: 'Europe/Berlin',
    })
    expect(result).toBe('daily at 09:00, 17:00 Europe/Berlin')
  })

  it('emits cartesian product of hours and minutes when both have multiple values', () => {
    const result = describeCompiledRecurrence({
      rrule: 'FREQ=DAILY;BYHOUR=9,17;BYMINUTE=0,30',
      dtstartUtc: '2026-04-21T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result).toBe('daily at 09:00, 09:30, 17:00, 17:30 UTC')
  })
})
