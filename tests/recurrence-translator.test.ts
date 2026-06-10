// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, it, expect } from 'bun:test'

import { cronToRrule } from '../src/recurrence-translator.js'
import { nextOccurrence } from '../src/recurrence.js'
import { nextCronOccurrence, parseCron } from './recurrence/legacy-cron-oracle.js'

const TS = '2025-01-01T00:00:00Z'

const collectNext = (rrule: string, anchor: Date, tz: string, n: number): string[] => {
  const compiled = { rrule, dtstartUtc: TS, timezone: tz }
  const results: string[] = []
  let cursor = anchor
  for (let i = 0; i < n; i++) {
    const next = nextOccurrence(compiled, cursor)
    if (next === null) break
    results.push(next.toISOString())
    cursor = next
  }
  return results
}

const collectOracle = (cron: string, anchor: Date, tz: string, n: number): string[] => {
  const parsed = parseCron(cron)!
  const results: string[] = []
  let cursor = anchor
  for (let i = 0; i < n; i++) {
    const next = nextCronOccurrence(parsed, cursor, tz)
    if (next === null) break
    results.push(next.toISOString())
    cursor = next
  }
  return results
}

const ANCHOR = new Date('2026-06-15T12:00:00Z')

// The oracle-equivalence tests below iterate the legacy cron oracle day-by-day
// (sparse patterns like "15th that is a Monday" scan many days per occurrence).
// They run in well under a second normally, but under parallel-worker CPU
// starvation can exceed Bun's 5s per-test default. A generous explicit timeout
// guards against false flakes while still failing on a genuine hang/regression.
const ORACLE_TIMEOUT_MS = 30_000

describe('cronToRrule — frequency heuristic', () => {
  it('constrained month with wildcard dom produces DAILY+BYMONTH, not YEARLY', () => {
    const out = cronToRrule('0 9 * 1 *', 'UTC', TS)
    expect(out).not.toBeNull()
    expect(out?.rrule).toBe('FREQ=DAILY;BYMONTH=1;BYHOUR=9;BYMINUTE=0')
  })

  it('constrained month with wildcard dom and constrained dow produces WEEKLY+BYMONTH', () => {
    const out = cronToRrule('30 14 * 1 1,3,5', 'UTC', TS)
    expect(out).not.toBeNull()
    expect(out?.rrule).toBe('FREQ=WEEKLY;BYMONTH=1;BYDAY=MO,WE,FR;BYHOUR=14;BYMINUTE=30')
  })

  it('constrained month with constrained dom still produces YEARLY', () => {
    const out = cronToRrule('0 9 1 1,4,7,10 *', 'UTC', TS)
    expect(out).not.toBeNull()
    expect(out?.rrule).toBe('FREQ=YEARLY;BYMONTH=1,4,7,10;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=0')
  })
})

describe('cronToRrule — dom+dow combination (AND semantics)', () => {
  it('constrained dom and dow produces MONTHLY with BYMONTHDAY and BYDAY', () => {
    const out = cronToRrule('0 9 15 * 1', 'UTC', TS)
    expect(out).not.toBeNull()
    expect(out?.rrule).toBe('FREQ=MONTHLY;BYMONTHDAY=15;BYDAY=MO;BYHOUR=9;BYMINUTE=0')
  })

  it('constrained dom, dow, and month produces YEARLY with BYMONTH, BYMONTHDAY, and BYDAY', () => {
    const out = cronToRrule('0 9 15 1 1', 'UTC', TS)
    expect(out).not.toBeNull()
    expect(out?.rrule).toBe('FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=15;BYDAY=MO;BYHOUR=9;BYMINUTE=0')
  })

  // Oracle equivalence only in UTC for MONTHLY: oracle's 366-day limit can't reach YEARLY occurrences
  // (Jan 15 + Monday happens ~every 5-6 years), and the oracle has known issues with non-UTC offsets.
  it(
    'dom+dow 15th-and-Monday oracle equivalence in UTC',
    () => {
      const out = cronToRrule('0 9 15 * 1', 'UTC', TS)!
      expect(collectNext(out.rrule, ANCHOR, 'UTC', 5)).toEqual(collectOracle('0 9 15 * 1', ANCHOR, 'UTC', 5))
    },
    ORACLE_TIMEOUT_MS,
  )
})

describe('cronToRrule — out-of-range field rejection', () => {
  it('rejects minute range entirely above max (61-70)', () => {
    expect(cronToRrule('61-70 9 * * *', 'UTC', TS)).toBeNull()
  })

  it('rejects minute range with out-of-bounds end (50-70)', () => {
    expect(cronToRrule('50-70 9 * * *', 'UTC', TS)).toBeNull()
  })

  it('rejects month range with out-of-bounds end (1-13)', () => {
    expect(cronToRrule('0 9 * 1-13 *', 'UTC', TS)).toBeNull()
  })

  it('rejects step expression with out-of-range base range (61-70/5)', () => {
    expect(cronToRrule('61-70/5 9 * * *', 'UTC', TS)).toBeNull()
  })

  it('accepts valid range at boundary (55-59)', () => {
    const out = cronToRrule('55-59 9 * * *', 'UTC', TS)
    expect(out).not.toBeNull()
    expect(out?.rrule).toBe('FREQ=DAILY;BYHOUR=9;BYMINUTE=55,56,57,58,59')
  })
})

describe('cronToRrule — oracle equivalence for constrained-month patterns', () => {
  for (const tz of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
    it(
      `every day in January 09:00 in ${tz}`,
      () => {
        const out = cronToRrule('0 9 * 1 *', tz, TS)!
        expect(collectNext(out.rrule, ANCHOR, tz, 10)).toEqual(collectOracle('0 9 * 1 *', ANCHOR, tz, 10))
      },
      ORACLE_TIMEOUT_MS,
    )

    it(
      `MWF in January 14:30 in ${tz}`,
      () => {
        const out = cronToRrule('30 14 * 1 1,3,5', tz, TS)!
        expect(collectNext(out.rrule, ANCHOR, tz, 10)).toEqual(collectOracle('30 14 * 1 1,3,5', ANCHOR, tz, 10))
      },
      ORACLE_TIMEOUT_MS,
    )
  }
})
