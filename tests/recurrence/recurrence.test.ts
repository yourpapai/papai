// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, it, expect, beforeEach, mock } from 'bun:test'

import {
  nextOccurrence,
  occurrencesBetween,
  parseRrule,
  recurrenceSpecToRrule,
} from '../../src/recurrence/recurrence.js'
import type { RecurrenceSpec } from '../../src/types/recurrence.js'
import { createTrackedLoggerMock } from '../utils/logger-mock.js'

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

  it('finds the next occurrence when dtstart is decades in the past', () => {
    // next() jumps to a phase-aligned DTSTART near `after` for unbounded
    // rules, so a ~30-year-old daily rule must stay far under the library's
    // maxIterations cap.
    const next = nextOccurrence(
      {
        rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
        dtstartUtc: '1996-01-01T09:00:00Z',
        timezone: 'UTC',
      },
      new Date('2026-06-15T12:00:00Z'),
    )
    expect(next?.toISOString()).toBe('2026-06-16T09:00:00.000Z')
  })

  it('finds the next occurrence for an aged HOURLY rule (cron */hour translation)', () => {
    const next = nextOccurrence(
      {
        rrule: 'FREQ=HOURLY;BYMINUTE=30',
        dtstartUtc: '2024-01-01T00:30:00Z',
        timezone: 'UTC',
      },
      new Date('2026-06-15T12:00:00Z'),
    )
    expect(next?.toISOString()).toBe('2026-06-15T12:30:00.000Z')
  })

  it('finds the next occurrence for a MINUTELY rule with a recent dtstart', () => {
    const next = nextOccurrence(
      {
        rrule: 'FREQ=MINUTELY',
        dtstartUtc: '2026-06-15T11:50:00Z',
        timezone: 'UTC',
      },
      new Date('2026-06-15T12:00:30Z'),
    )
    expect(next?.toISOString()).toBe('2026-06-15T12:01:00.000Z')
  })

  it('finds the next occurrence for an aged MINUTELY rule', () => {
    // rrule-temporal >=2.1 next() jumps to a phase-aligned DTSTART just
    // before `after` for unbounded rules, so a year-old MINUTELY rule must
    // answer without replaying ~525k occurrences from DTSTART.
    const next = nextOccurrence(
      {
        rrule: 'FREQ=MINUTELY',
        dtstartUtc: '2025-06-15T11:50:00Z',
        timezone: 'UTC',
      },
      new Date('2026-06-15T12:00:30Z'),
    )
    expect(next?.toISOString()).toBe('2026-06-15T12:01:00.000Z')
  })

  it('finds the next occurrence for a COUNT rule with remaining occurrences', () => {
    // COUNT-bound rules answer from lazy query plans since 2.1, so the
    // remaining-occurrence lookup must stay correct past its dtstart.
    const next = nextOccurrence(
      {
        rrule: 'FREQ=DAILY;COUNT=60',
        dtstartUtc: '2026-05-01T09:00:00Z',
        timezone: 'UTC',
      },
      new Date('2026-06-15T12:00:00Z'),
    )
    expect(next?.toISOString()).toBe('2026-06-16T09:00:00.000Z')
  })

  it('returns null for a COUNT rule exhausted long ago', () => {
    const next = nextOccurrence(
      {
        rrule: 'FREQ=DAILY;COUNT=3',
        dtstartUtc: '2020-01-01T09:00:00Z',
        timezone: 'UTC',
      },
      new Date('2026-06-15T12:00:00Z'),
    )
    expect(next).toBeNull()
  })

  it('returns null instead of throwing for a rule that can never match', () => {
    // February 30th never exists; the library's iteration cap fires instead of
    // terminating, and that must surface as a degraded null, not a throw.
    const next = nextOccurrence(
      {
        rrule: 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30',
        dtstartUtc: '2026-01-01T09:00:00Z',
        timezone: 'UTC',
      },
      new Date('2026-06-15T12:00:00Z'),
    )
    expect(next).toBeNull()
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

describe('strict RFC 5545 parsing', () => {
  // The parse-failure warn goes through the module-level child logger, so
  // asserting it needs a tracked logger installed before a fresh module load
  // (a static import would already have bound the real logger). mock.module
  // is process-wide; tests/mock-reset.ts restores the real logger in its
  // global beforeEach — same pattern as tests/plugins/task-provider-youtrack.
  const COUNT_UNTIL = 'FREQ=DAILY;COUNT=5;UNTIL=20260601T000000Z'

  // The module binds `logger.child({ scope: 'recurrence' })` at load, so each
  // test imports a fresh copy (cache-busted) against its own mocks.
  let loadCount = 0
  const freshModule = (): Promise<typeof import('../../src/recurrence/recurrence.js')> => {
    loadCount++
    return import(`../../src/recurrence/recurrence.js?strict=${loadCount}`)
  }

  let tracked: ReturnType<typeof createTrackedLoggerMock>
  let strictRecurrence: typeof import('../../src/recurrence/recurrence.js')

  beforeEach(async () => {
    tracked = createTrackedLoggerMock()
    void mock.module('../../src/logger.js', () => ({
      getLogLevel: tracked.getLogLevel,
      logger: tracked.logger,
    }))
    strictRecurrence = await freshModule()
  })

  it('rejects COUNT combined with UNTIL at parse time', () => {
    const res = strictRecurrence.parseRrule({
      rrule: COUNT_UNTIL,
      dtstartUtc: '2026-04-20T09:00:00Z',
      timezone: 'UTC',
    })
    expect(res).toEqual({ ok: false, reason: 'COUNT and UNTIL MUST NOT occur in the same recurrence rule' })
  })

  it('rejects a DATE-valued UNTIL against a DATE-TIME DTSTART', () => {
    const res = strictRecurrence.parseRrule({
      rrule: 'FREQ=DAILY;UNTIL=20260601',
      dtstartUtc: '2026-04-20T09:00:00Z',
      timezone: 'UTC',
    })
    expect(res).toEqual({ ok: false, reason: 'UNTIL rule part MUST have the same value type as DTSTART' })
  })

  it('degrades COUNT+UNTIL nextOccurrence to null with a warn naming the rule', () => {
    const next = strictRecurrence.nextOccurrence(
      { rrule: COUNT_UNTIL, dtstartUtc: '2026-04-20T09:00:00Z', timezone: 'UTC' },
      new Date('2026-04-21T00:00:00Z'),
    )
    expect(next).toBeNull()
    const warns = tracked.getCallsByLevel('warn')
    expect(warns.length).toBeGreaterThanOrEqual(1)
    expect(warns[0]?.args[0]).toMatchObject({
      rrule: COUNT_UNTIL,
      reason: 'COUNT and UNTIL MUST NOT occur in the same recurrence rule',
    })
  })

  it('degrades COUNT+UNTIL occurrencesBetween to [] without throwing', () => {
    const occ = strictRecurrence.occurrencesBetween(
      { rrule: COUNT_UNTIL, dtstartUtc: '2026-04-20T09:00:00Z', timezone: 'UTC' },
      new Date('2026-04-20T00:00:00Z'),
      new Date('2026-04-24T00:00:00Z'),
    )
    expect(occ).toEqual([])
    const warns = tracked.getCallsByLevel('warn')
    expect(warns.length).toBeGreaterThanOrEqual(1)
  })
})
