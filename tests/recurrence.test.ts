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

  it('renders TU/TH/SA/SU day names with the exact weekly word and join separator', () => {
    const result = describeCompiledRecurrence({
      rrule: 'FREQ=WEEKLY;BYDAY=TU,TH,SA,SU;BYHOUR=9;BYMINUTE=0',
      dtstartUtc: '2026-04-21T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result).toBe('weekly at 09:00 UTC on Tuesday, Thursday, Saturday, Sunday')
  })

  it('renders the interval>1 plural prefix for weeks with the exact plural unit', () => {
    const result = describeCompiledRecurrence({
      rrule: 'FREQ=WEEKLY;INTERVAL=2;BYHOUR=9;BYMINUTE=0',
      dtstartUtc: '2026-04-21T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result).toBe('every 2 weeks at 09:00 UTC')
  })

  it('renders the MINUTELY singular word from FREQ_SINGULAR', () => {
    const result = describeCompiledRecurrence({
      rrule: 'FREQ=MINUTELY;BYHOUR=9;BYMINUTE=0',
      dtstartUtc: '2026-04-21T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result).toBe('every minute at 09:00 UTC')
  })

  it('renders the SECONDLY singular word from FREQ_SINGULAR', () => {
    const result = describeCompiledRecurrence({
      rrule: 'FREQ=SECONDLY;BYHOUR=9;BYMINUTE=0',
      dtstartUtc: '2026-04-21T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result).toBe('every second at 09:00 UTC')
  })

  it('falls back to the lowercased frequency when FREQ is not in FREQ_SINGULAR', () => {
    const result = describeCompiledRecurrence({
      rrule: 'FREQ=BOGUS;BYHOUR=9;BYMINUTE=0',
      dtstartUtc: '2026-04-21T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result).toBe('bogus at 09:00 UTC')
  })

  it('falls back to the lowercased frequency for an unknown FREQ with interval>1', () => {
    const result = describeCompiledRecurrence({
      rrule: 'FREQ=BOGUS;INTERVAL=2;BYHOUR=9;BYMINUTE=0',
      dtstartUtc: '2026-04-21T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result).toBe('every 2 bogus at 09:00 UTC')
  })

  it('omits the frequency prefix when the RRULE has no FREQ part', () => {
    const result = describeCompiledRecurrence({
      rrule: 'BYHOUR=9;BYMINUTE=0',
      dtstartUtc: '2026-04-21T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result).toBe('at 09:00 UTC')
  })

  it('uses 24-hour formatting for afternoon fallback hours derived from dtstart', () => {
    const result = describeCompiledRecurrence({
      rrule: 'FREQ=DAILY',
      dtstartUtc: '2026-04-21T14:00:00Z',
      timezone: 'UTC',
    })
    expect(result).toBe('daily at 14:00 UTC')
  })

  it('sorts the cartesian time list ascending', () => {
    const result = describeCompiledRecurrence({
      rrule: 'FREQ=DAILY;BYHOUR=17,9;BYMINUTE=0',
      dtstartUtc: '2026-04-21T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result).toBe('daily at 09:00, 17:00 UTC')
  })

  it('renders a single BYMONTH value as a month name with the yearly word', () => {
    const result = describeCompiledRecurrence({
      rrule: 'FREQ=YEARLY;BYMONTH=1;BYHOUR=9;BYMINUTE=0',
      dtstartUtc: '2026-01-15T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result).toBe('yearly at 09:00 UTC in January')
  })

  it('splits and joins multiple BYMONTH values with the exact separator', () => {
    const result = describeCompiledRecurrence({
      rrule: 'FREQ=YEARLY;BYMONTH=1,3;BYHOUR=9;BYMINUTE=0',
      dtstartUtc: '2026-01-15T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result).toBe('yearly at 09:00 UTC in January, March')
  })

  it('renders every MONTH_NAMES entry for all twelve BYMONTH values', () => {
    const result = describeCompiledRecurrence({
      rrule: 'FREQ=YEARLY;BYMONTH=1,2,3,4,5,6,7,8,9,10,11,12;BYHOUR=9;BYMINUTE=0',
      dtstartUtc: '2026-01-15T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result).toBe(
      'yearly at 09:00 UTC in January, February, March, April, May, June, July, August, September, October, November, December',
    )
  })

  it('renders the MONTHLY singular word with the full monthly description', () => {
    const result = describeCompiledRecurrence({
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=15;BYHOUR=10;BYMINUTE=0',
      dtstartUtc: '2026-04-15T10:00:00Z',
      timezone: 'America/New_York',
    })
    expect(result).toBe('monthly at 10:00 America/New_York on day 15 of the month')
  })

  it('renders the HOURLY singular word with the full hourly description', () => {
    const result = describeCompiledRecurrence({
      rrule: 'FREQ=HOURLY;BYMINUTE=0,15,30,45',
      dtstartUtc: '2026-04-21T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result).toBe('hourly at 09:00, 09:15, 09:30, 09:45 UTC')
  })

  it('renders the days plural unit for FREQ=DAILY with interval>1', () => {
    const result = describeCompiledRecurrence({
      rrule: 'FREQ=DAILY;INTERVAL=2;BYHOUR=8;BYMINUTE=30',
      dtstartUtc: '2026-04-21T08:30:00Z',
      timezone: 'UTC',
    })
    expect(result).toBe('every 2 days at 08:30 UTC')
  })

  it('renders the months plural unit for FREQ=MONTHLY with interval>1', () => {
    const result = describeCompiledRecurrence({
      rrule: 'FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=15;BYHOUR=10;BYMINUTE=0',
      dtstartUtc: '2026-04-15T10:00:00Z',
      timezone: 'UTC',
    })
    expect(result).toBe('every 2 months at 10:00 UTC on day 15 of the month')
  })

  it('renders the years plural unit for FREQ=YEARLY with interval>1', () => {
    const result = describeCompiledRecurrence({
      rrule: 'FREQ=YEARLY;INTERVAL=2;BYMONTH=6;BYHOUR=9;BYMINUTE=0',
      dtstartUtc: '2026-06-15T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result).toBe('every 2 years at 09:00 UTC in June')
  })

  it('renders the hours plural unit for FREQ=HOURLY with interval>1', () => {
    const result = describeCompiledRecurrence({
      rrule: 'FREQ=HOURLY;INTERVAL=2;BYMINUTE=0',
      dtstartUtc: '2026-04-21T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result).toBe('every 2 hours at 09:00 UTC')
  })

  it('renders the minutes plural unit for FREQ=MINUTELY with interval>1', () => {
    const result = describeCompiledRecurrence({
      rrule: 'FREQ=MINUTELY;INTERVAL=2;BYMINUTE=0',
      dtstartUtc: '2026-04-21T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result).toBe('every 2 minutes at 09:00 UTC')
  })

  it('renders the seconds plural unit for FREQ=SECONDLY with interval>1', () => {
    const result = describeCompiledRecurrence({
      rrule: 'FREQ=SECONDLY;INTERVAL=2;BYMINUTE=0',
      dtstartUtc: '2026-04-21T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result).toBe('every 2 seconds at 09:00 UTC')
  })

  it('skips a malformed RRULE part that contains no equals sign', () => {
    const result = describeCompiledRecurrence({
      rrule: 'BYHOUR=9;BYMINUTE=0;FREQQ',
      dtstartUtc: '2026-04-21T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result).toBe('at 09:00 UTC')
  })
})
