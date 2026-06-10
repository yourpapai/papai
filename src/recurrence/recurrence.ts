// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { RRuleTemporal } from 'rrule-temporal'

import { logger } from '../logger.js'
import type { RecurrenceSpec } from '../types/recurrence.js'

const log = logger.child({ scope: 'recurrence' })

export type CompiledRecurrence = {
  rrule: string
  dtstartUtc: string
  timezone: string
}

export const recurrenceSpecToRrule = (spec: RecurrenceSpec, timezone: string): CompiledRecurrence => {
  log.debug({ freq: spec.freq, timezone }, 'recurrenceSpecToRrule called')

  const parts: string[] = [`FREQ=${spec.freq}`]
  if (spec.interval !== undefined) parts.push(`INTERVAL=${spec.interval}`)
  if (spec.count !== undefined) parts.push(`COUNT=${spec.count}`)
  if (spec.until !== undefined) {
    const until = spec.until.replace(/[-:]/gu, '').replace(/\.\d+/u, '')
    parts.push(`UNTIL=${until}`)
  }
  if (spec.byMonth !== undefined) parts.push(`BYMONTH=${spec.byMonth.join(',')}`)
  if (spec.byMonthDay !== undefined) parts.push(`BYMONTHDAY=${spec.byMonthDay.join(',')}`)
  if (spec.byDay !== undefined) parts.push(`BYDAY=${spec.byDay.join(',')}`)
  if (spec.byHour !== undefined) parts.push(`BYHOUR=${spec.byHour.join(',')}`)
  if (spec.byMinute !== undefined) parts.push(`BYMINUTE=${spec.byMinute.join(',')}`)

  return {
    rrule: parts.join(';'),
    dtstartUtc: spec.dtstart,
    timezone,
  }
}

export type ParseResult = { ok: true; iter: RRuleTemporal } | { ok: false; reason: string }

const buildIcs = (args: CompiledRecurrence): string => {
  const date = new Date(args.dtstartUtc)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: args.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00'
  const rawHour = get('hour')
  // Intl.DateTimeFormat hour12:false can yield '24' for midnight in some environments
  const hour = rawHour === '24' ? '00' : rawHour
  const dt = `${get('year')}${get('month')}${get('day')}T${hour}${get('minute')}${get('second')}`
  return `DTSTART;TZID=${args.timezone}:${dt}\nRRULE:${args.rrule}`
}

export const parseRrule = (args: CompiledRecurrence): ParseResult => {
  try {
    const iter = new RRuleTemporal({ rruleString: buildIcs(args) })
    return { ok: true, iter }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    log.warn({ rrule: args.rrule, reason }, 'parseRrule failed')
    return { ok: false, reason }
  }
}

// RRuleTemporal.next() enumerates every occurrence from DTSTART on each call
// and throws past its maxIterations cap (10k), so aged-dtstart rules get slower
// over time and dense ones (DAILY ~27y, HOURLY ~14mo) eventually throw.
// between() instead fast-forwards to the window start when the rule has no
// COUNT, so probe expanding windows anchored at `after` first.  The widest
// window exceeds the sparsest generatable gap (YEARLY incl. leap years);
// COUNT rules must enumerate from DTSTART anyway, as do the no-match cases
// that fall through to next() (e.g. UNTIL in the past), all of which COUNT
// or UNTIL keep bounded.  The first window stays under 7 days so a MINUTELY
// rule (1,440/day) fits inside the same iteration cap.
const NEXT_WINDOW_DAYS = [6, 90, 1464]
const DAY_MS = 24 * 60 * 60 * 1000

export const nextOccurrence = (args: CompiledRecurrence, after: Date): Date | null => {
  const parsed = parseRrule(args)
  if (!parsed.ok) return null
  try {
    if (!/(?:^|;)COUNT=/u.test(args.rrule)) {
      for (const days of NEXT_WINDOW_DAYS) {
        const windowEnd = new Date(after.getTime() + days * DAY_MS)
        const first = parsed.iter.between(after, windowEnd, false)[0]
        if (first !== undefined) return new Date(first.epochMilliseconds)
      }
    }
    const next = parsed.iter.next(after)
    return next === null ? null : new Date(next.epochMilliseconds)
  } catch (error) {
    // Typically the library's maxIterations cap on a rule that never matches
    // (e.g. BYMONTHDAY=30 in February); degrade like a parse failure.
    const reason = error instanceof Error ? error.message : String(error)
    log.warn({ rrule: args.rrule, reason }, 'nextOccurrence failed')
    return null
  }
}

export const occurrencesBetween = (args: CompiledRecurrence, after: Date, before: Date, limit = 100): Date[] => {
  const parsed = parseRrule(args)
  if (!parsed.ok) return []
  const results: Date[] = []
  const afterMs = after.getTime()
  for (const dt of parsed.iter.between(after, before, true)) {
    const d = new Date(dt.epochMilliseconds)
    if (d.getTime() === afterMs) continue
    results.push(d)
    if (results.length >= limit) break
  }
  return results
}
