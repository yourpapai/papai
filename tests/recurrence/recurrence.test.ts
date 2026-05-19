// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, it, expect } from 'bun:test'

import {
  nextOccurrence,
  occurrencesBetween,
  parseRrule,
  recurrenceSpecToRrule,
} from '../../src/recurrence/recurrence.js'
import type { RecurrenceSpec } from '../../src/types/recurrence.js'

describe('recurrenceSpecToRrule', () => {
  it('serialises a WEEKLY MO/WE/FR at 09:00 spec', () => {
    const spec: RecurrenceSpec = {
      freq: 'WEEKLY',
      byDay: ['MO', 'WE', 'FR'],
      byHour: [9],
      byMinute: [0],
      dtstart: '2026-04-20T09:00:00Z',
    }
    const out = recurrenceSpecToRrule(spec, 'Europe/London')
    expect(out.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=9;BYMINUTE=0')
    expect(out.dtstartUtc).toBe('2026-04-20T09:00:00Z')
    expect(out.timezone).toBe('Europe/London')
  })

  it('omits BYHOUR/BYMINUTE when not provided (DTSTART-time semantics)', () => {
    const spec: RecurrenceSpec = {
      freq: 'DAILY',
      dtstart: '2026-04-20T09:30:00Z',
    }
    const out = recurrenceSpecToRrule(spec, 'UTC')
    expect(out.rrule).toBe('FREQ=DAILY')
  })

  it('serialises INTERVAL and COUNT', () => {
    const spec: RecurrenceSpec = {
      freq: 'DAILY',
      interval: 2,
      count: 10,
      dtstart: '2026-04-20T00:00:00Z',
    }
    const out = recurrenceSpecToRrule(spec, 'UTC')
    expect(out.rrule).toBe('FREQ=DAILY;INTERVAL=2;COUNT=10')
  })

  it('serialises UNTIL with millisecond precision', () => {
    const spec: RecurrenceSpec = {
      freq: 'DAILY',
      until: '2026-12-31T00:00:00.000Z',
      dtstart: '2026-04-20T00:00:00Z',
    }
    const out = recurrenceSpecToRrule(spec, 'UTC')
    expect(out.rrule).toBe('FREQ=DAILY;UNTIL=20261231T000000Z')
  })

  it('serialises UNTIL with sub-millisecond precision without leaving fractional digits', () => {
    const spec: RecurrenceSpec = {
      freq: 'DAILY',
      until: '2026-12-31T00:00:00.123456Z',
      dtstart: '2026-04-20T00:00:00Z',
    }
    const out = recurrenceSpecToRrule(spec, 'UTC')
    expect(out.rrule).toBe('FREQ=DAILY;UNTIL=20261231T000000Z')
  })

  it('serialises BYMONTH, BYMONTHDAY', () => {
    const spec: RecurrenceSpec = {
      freq: 'YEARLY',
      byMonth: [1, 4, 7, 10],
      byMonthDay: [1],
      dtstart: '2026-01-01T09:00:00Z',
    }
    const out = recurrenceSpecToRrule(spec, 'UTC')
    expect(out.rrule).toBe('FREQ=YEARLY;BYMONTH=1,4,7,10;BYMONTHDAY=1')
  })
})

describe('parseRrule', () => {
  it('returns ok for a valid weekly rrule', () => {
    const res = parseRrule({
      rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0',
      dtstartUtc: '2026-04-20T09:00:00Z',
      timezone: 'UTC',
    })
    expect(res.ok).toBe(true)
  })

  it('returns not-ok for a malformed rrule', () => {
    const res = parseRrule({
      rrule: 'NOT_A_RULE',
      dtstartUtc: '2026-04-20T09:00:00Z',
      timezone: 'UTC',
    })
    expect(res.ok).toBe(false)
  })

  it('returns not-ok for an invalid timezone', () => {
    const res = parseRrule({
      rrule: 'FREQ=DAILY',
      dtstartUtc: '2026-04-20T09:00:00Z',
      timezone: 'Not/A_Zone',
    })
    expect(res.ok).toBe(false)
  })
})

describe('nextOccurrence', () => {
  it('returns the next occurrence after a given date', () => {
    const next = nextOccurrence(
      {
        rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0',
        // 2026-04-20 is Monday
        dtstartUtc: '2026-04-20T09:00:00Z',
        timezone: 'UTC',
      },
      new Date('2026-04-20T09:00:01Z'),
    )
    expect(next).not.toBeNull()
    expect(next?.toISOString()).toBe('2026-04-27T09:00:00.000Z')
  })

  it('returns null when the rrule has exhausted its COUNT', () => {
    const next = nextOccurrence(
      {
        rrule: 'FREQ=DAILY;COUNT=1',
        dtstartUtc: '2026-04-20T09:00:00Z',
        timezone: 'UTC',
      },
      new Date('2026-04-20T09:00:01Z'),
    )
    expect(next).toBeNull()
  })

  it('uses DTSTART local time-of-day for non-UTC timezone when BYHOUR/BYMINUTE are absent', () => {
    // dtstartUtc 14:00 UTC = 09:00 EST; next after 14:00:01 UTC is the following day at 09:00 EDT
    const next = nextOccurrence(
      {
        rrule: 'FREQ=DAILY',
        dtstartUtc: '2026-03-07T14:00:00Z',
        timezone: 'America/New_York',
      },
      new Date('2026-03-07T14:00:01Z'),
    )
    expect(next).not.toBeNull()
    // 09:00 EDT on 2026-03-08 = 13:00 UTC (after spring-forward)
    expect(next?.toISOString()).toBe('2026-03-08T13:00:00.000Z')
  })

  it('handles DST spring-forward in America/New_York correctly', () => {
    // 2026-03-08 is spring-forward in America/New_York (2:00 → 3:00)
    const next = nextOccurrence(
      {
        rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
        // 9am EST on 2026-03-07
        dtstartUtc: '2026-03-07T14:00:00Z',
        timezone: 'America/New_York',
      },
      new Date('2026-03-07T14:00:01Z'),
    )
    expect(next).not.toBeNull()
    // 9am EDT on 2026-03-08 = 13:00 UTC
    expect(next?.toISOString()).toBe('2026-03-08T13:00:00.000Z')
  })
})

describe('occurrencesBetween', () => {
  it('returns occurrences inclusive of before, exclusive of after', () => {
    const occ = occurrencesBetween(
      {
        rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0',
        dtstartUtc: '2026-04-20T09:00:00Z',
        timezone: 'UTC',
      },
      new Date('2026-04-20T08:00:00Z'),
      new Date('2026-05-12T00:00:00Z'),
    )
    expect(occ.map((d) => d.toISOString())).toEqual([
      '2026-04-20T09:00:00.000Z',
      '2026-04-27T09:00:00.000Z',
      '2026-05-04T09:00:00.000Z',
      '2026-05-11T09:00:00.000Z',
    ])
  })

  it('excludes an occurrence that falls exactly on after', () => {
    // after equals the first occurrence exactly — must not appear in results
    const occ = occurrencesBetween(
      {
        rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0',
        dtstartUtc: '2026-04-20T09:00:00Z',
        timezone: 'UTC',
      },
      new Date('2026-04-20T09:00:00Z'),
      new Date('2026-05-05T00:00:00Z'),
    )
    expect(occ.map((d) => d.toISOString())).toEqual(['2026-04-27T09:00:00.000Z', '2026-05-04T09:00:00.000Z'])
  })

  it('includes an occurrence that falls exactly on before', () => {
    const occ = occurrencesBetween(
      {
        rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0',
        dtstartUtc: '2026-04-20T09:00:00Z',
        timezone: 'UTC',
      },
      new Date('2026-04-20T08:00:00Z'),
      new Date('2026-04-27T09:00:00Z'),
    )
    expect(occ.map((d) => d.toISOString())).toEqual(['2026-04-20T09:00:00.000Z', '2026-04-27T09:00:00.000Z'])
  })

  it('caps at the supplied limit', () => {
    const occ = occurrencesBetween(
      {
        rrule: 'FREQ=DAILY',
        dtstartUtc: '2026-04-20T09:00:00Z',
        timezone: 'UTC',
      },
      new Date('2026-04-20T08:00:00Z'),
      new Date('2026-12-31T00:00:00Z'),
      3,
    )
    expect(occ.length).toBe(3)
  })
})
