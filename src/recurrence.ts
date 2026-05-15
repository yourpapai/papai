// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type { CompiledRecurrence, ParseResult } from './recurrence/recurrence.js'
export { nextOccurrence, occurrencesBetween, parseRrule, recurrenceSpecToRrule } from './recurrence/recurrence.js'

import type { CompiledRecurrence } from './recurrence/recurrence.js'

const DAY_NAMES: Record<string, string> = {
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
  SU: 'Sunday',
}

const MONTH_NAMES = [
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

const pad2 = (n: number): string => String(n).padStart(2, '0')

const parseRruleParts = (rruleStr: string): Record<string, string> => {
  const parts: Record<string, string> = {}
  for (const part of rruleStr.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    parts[part.slice(0, idx).toUpperCase()] = part.slice(idx + 1)
  }
  return parts
}

const FREQ_SINGULAR: Record<string, string> = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
  HOURLY: 'hourly',
  MINUTELY: 'every minute',
  SECONDLY: 'every second',
}

const FREQ_PLURAL_UNIT: Record<string, string> = {
  DAILY: 'days',
  WEEKLY: 'weeks',
  MONTHLY: 'months',
  YEARLY: 'years',
  HOURLY: 'hours',
  MINUTELY: 'minutes',
  SECONDLY: 'seconds',
}

const freqPrefix = (freq: string, interval: number): string => {
  if (interval > 1) return `every ${interval} ${FREQ_PLURAL_UNIT[freq] ?? freq.toLowerCase()}`
  return FREQ_SINGULAR[freq] ?? freq.toLowerCase()
}

export const describeCompiledRecurrence = (compiled: CompiledRecurrence): string => {
  const parts = parseRruleParts(compiled.rrule)
  const descParts: string[] = []

  const byHourStr = parts['BYHOUR']
  const byMinuteStr = parts['BYMINUTE']
  const byDayStr = parts['BYDAY']
  const byMonthDayStr = parts['BYMONTHDAY']
  const byMonthStr = parts['BYMONTH']
  const freq = parts['FREQ']?.toUpperCase()
  const interval = parts['INTERVAL'] === undefined ? 1 : Number.parseInt(parts['INTERVAL'], 10)

  if (freq !== undefined) descParts.push(freqPrefix(freq, interval))

  const dtstartDate = new Date(compiled.dtstartUtc)
  const localParts = new Intl.DateTimeFormat('en-US', {
    timeZone: compiled.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(dtstartDate)
  const localHour = Number.parseInt(localParts.find((p) => p.type === 'hour')?.value ?? '0', 10)
  const localMinute = Number.parseInt(localParts.find((p) => p.type === 'minute')?.value ?? '0', 10)
  const hours = byHourStr === undefined ? [localHour] : byHourStr.split(',').map((h) => Number.parseInt(h, 10))
  const minutes = byMinuteStr === undefined ? [localMinute] : byMinuteStr.split(',').map((m) => Number.parseInt(m, 10))
  const times = hours.flatMap((h) => minutes.map((m) => `${pad2(h)}:${pad2(m)}`)).sort()

  descParts.push(`at ${times.join(', ')} ${compiled.timezone}`)

  if (byDayStr !== undefined) {
    const names = byDayStr.split(',').map((d) => DAY_NAMES[d] ?? d)
    descParts.push(`on ${names.join(', ')}`)
  }

  if (byMonthDayStr !== undefined) {
    descParts.push(`on day ${byMonthDayStr} of the month`)
  }

  if (byMonthStr !== undefined) {
    const nums = byMonthStr.split(',').map((n) => Number.parseInt(n, 10))
    const names = nums.map((m) => MONTH_NAMES[m] ?? String(m))
    descParts.push(`in ${names.join(', ')}`)
  }

  return descParts.join(' ')
}
