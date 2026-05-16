// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Lightweight cron expression parser.
 * Supports standard 5-field cron: minute hour day-of-month month day-of-week
 *
 * Examples:
 *   "0 9 * * 1"     → every Monday at 09:00
 *   "30 14 * * *"   → every day at 14:30
 *   "0 0 1 * *"     → first of every month at midnight
 *   "0 9 * * 1-5"   → weekdays at 09:00
 */

import { logger } from '../../src/logger.js'

const log = logger.child({ scope: 'cron' })

type CronField = {
  type: 'any' | 'values'
  values: number[]
}

type ParsedCron = {
  minute: CronField
  hour: CronField
  dayOfMonth: CronField
  month: CronField
  dayOfWeek: CronField
}

const parseField = (field: string, min: number, max: number): CronField => {
  if (field === '*') {
    return { type: 'any', values: [] }
  }

  const values: number[] = []

  for (const part of field.split(',')) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/u)
    if (stepMatch !== null) {
      const [, range, stepStr] = stepMatch
      const step = Number.parseInt(stepStr!, 10)
      if (step <= 0) {
        log.warn({ field, part }, 'Invalid cron step value: step must be a positive integer')
        continue
      }
      const [start, end] = range === '*' ? [min, max] : parseRange(range!, min, max)
      for (let i = start; i <= end; i += step) {
        values.push(i)
      }
      continue
    }

    if (part.includes('-')) {
      const [start, end] = parseRange(part, min, max)
      for (let i = start; i <= end; i++) {
        values.push(i)
      }
      continue
    }

    const num = Number.parseInt(part, 10)
    if (!Number.isNaN(num) && num >= min && num <= max) {
      values.push(num)
    }
  }

  return { type: 'values', values }
}

const parseRange = (range: string, min: number, max: number): [number, number] => {
  const parts = range.split('-')
  const start = Number.parseInt(parts[0] ?? String(min), 10)
  const end = Number.parseInt(parts[1] ?? String(max), 10)
  return [Math.max(min, Math.min(start, max)), Math.max(min, Math.min(end, max))]
}

export const parseCron = (expression: string): ParsedCron | null => {
  const fields = expression.trim().split(/\s+/u)
  if (fields.length !== 5) {
    log.warn({ expression }, 'Invalid cron expression: expected 5 fields')
    return null
  }

  const [minuteStr, hourStr, domStr, monthStr, dowStr] = fields

  const minute = parseField(minuteStr!, 0, 59)
  const hour = parseField(hourStr!, 0, 23)
  const dayOfMonth = parseField(domStr!, 1, 31)
  const month = parseField(monthStr!, 1, 12)
  const dayOfWeek = parseField(dowStr!, 0, 6)

  const invalidField =
    (minute.type === 'values' && minute.values.length === 0) ||
    (hour.type === 'values' && hour.values.length === 0) ||
    (dayOfMonth.type === 'values' && dayOfMonth.values.length === 0) ||
    (month.type === 'values' && month.values.length === 0) ||
    (dayOfWeek.type === 'values' && dayOfWeek.values.length === 0)

  if (invalidField) {
    log.warn({ expression }, 'Invalid cron expression: field produced no valid values')
    return null
  }

  return {
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek,
  }
}

const fieldMatches = (field: CronField, value: number): boolean => {
  if (field.type === 'any') return true
  return field.values.includes(value)
}

/**
 * Get the local time components for a Date in a given IANA timezone.
 * Falls back to UTC if the timezone is invalid.
 */
const getLocalParts = (
  date: Date,
  tz: string,
): { minute: number; hour: number; day: number; month: number; weekday: number } => {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
      hour12: false,
    })
    const parts = fmt.formatToParts(date)
    const get = (t: Intl.DateTimeFormatPartTypes): number =>
      Number.parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10)

    const weekdayStr = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'
    const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

    return {
      minute: get('minute'),
      hour: get('hour') === 24 ? 0 : get('hour'),
      day: get('day'),
      month: get('month'),
      weekday: weekdayMap[weekdayStr] ?? 0,
    }
  } catch {
    return {
      minute: date.getUTCMinutes(),
      hour: date.getUTCHours(),
      day: date.getUTCDate(),
      month: date.getUTCMonth() + 1,
      weekday: date.getUTCDay(),
    }
  }
}

/**
 * Compute the next occurrence after `after` that matches the cron expression
 * in the given timezone. Searches minute-by-minute for up to 366 days.
 */
export const nextCronOccurrence = (cron: ParsedCron, after: Date, timezone = 'UTC'): Date | null => {
  const candidate = new Date(after.getTime())
  candidate.setUTCSeconds(0, 0)
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1)

  // Max iterations: ~1 year of minutes
  const limit = 366 * 24 * 60

  for (let i = 0; i < limit; i++) {
    const p = getLocalParts(candidate, timezone)

    if (
      fieldMatches(cron.minute, p.minute) &&
      fieldMatches(cron.hour, p.hour) &&
      fieldMatches(cron.dayOfMonth, p.day) &&
      fieldMatches(cron.month, p.month) &&
      fieldMatches(cron.dayOfWeek, p.weekday)
    ) {
      return candidate
    }

    // Optimize: if hour doesn't match, skip to next hour
    if (!fieldMatches(cron.hour, p.hour)) {
      candidate.setUTCHours(candidate.getUTCHours() + 1)
      candidate.setUTCMinutes(0)
      i += 59
      continue
    }

    // If day doesn't match, skip to next day
    if (
      !fieldMatches(cron.dayOfMonth, p.day) ||
      !fieldMatches(cron.month, p.month) ||
      !fieldMatches(cron.dayOfWeek, p.weekday)
    ) {
      candidate.setUTCDate(candidate.getUTCDate() + 1)
      candidate.setUTCHours(0)
      candidate.setUTCMinutes(0)
      i += 24 * 60
      continue
    }

    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1)
  }

  log.warn({ after: after.toISOString(), timezone }, 'Could not find next cron occurrence within 366 days')
  return null
}

/**
 * Collect all occurrences of a cron expression between `after` (exclusive) and `before` (inclusive).
 * Returns at most `maxResults` dates. Used for retroactive missed-occurrence creation.
 */
export const allOccurrencesBetween = (
  cron: ParsedCron,
  after: Date,
  before: Date,
  maxResults = 100,
  timezone = 'UTC',
): Date[] => {
  const results: Date[] = []
  let cursor = after
  while (results.length < maxResults) {
    const next = nextCronOccurrence(cron, cursor, timezone)
    if (next === null || next.getTime() > before.getTime()) break
    results.push(next)
    cursor = next
  }
  return results
}

/**
 * Describes a cron expression in human-readable form.
 */
export const describeCron = (expression: string, timezone = 'UTC'): string => {
  const cron = parseCron(expression)
  if (cron === null) return expression

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const monthNames = [
    '',
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]

  const parts: string[] = []

  // Time
  if (cron.minute.type === 'values' && cron.hour.type === 'values') {
    const h = cron.hour.values[0] ?? 0
    const m = cron.minute.values[0] ?? 0
    parts.push(`at ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${timezone}`)
  }

  // Day of week
  if (cron.dayOfWeek.type === 'values') {
    const names = cron.dayOfWeek.values.map((d) => dayNames[d] ?? String(d))
    parts.push(`on ${names.join(', ')}`)
  }

  // Day of month
  if (cron.dayOfMonth.type === 'values') {
    parts.push(`on day ${cron.dayOfMonth.values.join(', ')} of the month`)
  }

  // Month
  if (cron.month.type === 'values') {
    const names = cron.month.values.map((m) => monthNames[m] ?? String(m))
    parts.push(`in ${names.join(', ')}`)
  }

  if (parts.length === 0) return 'every minute'
  return parts.join(' ')
}
