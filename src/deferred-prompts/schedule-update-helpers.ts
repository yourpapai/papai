// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { nextOccurrence, recurrenceSpecToRrule } from '../recurrence.js'
import { getUserTimezoneOrError } from '../utils/config-timezone.js'
import { localDatetimeToUtc } from '../utils/datetime.js'
import { getScheduledPrompt } from './scheduled.js'
import type { ScheduleInput } from './types.js'

export type ScheduleFieldUpdates = {
  fireAt?: string
  rrule?: string | null
  dtstartUtc?: string | null
  timezone?: string | null
}

export function buildScheduleUpdates(
  id: string,
  userId: string,
  schedule: ScheduleInput,
): ScheduleFieldUpdates | { error: string } {
  const timezone = getUserTimezoneOrError(userId)
  if (typeof timezone !== 'string') return timezone
  const updates: ScheduleFieldUpdates = {}
  if (schedule.fire_at !== undefined) {
    const { date, time } = schedule.fire_at
    let utcStr: string
    try {
      utcStr = localDatetimeToUtc(date, time, timezone)
    } catch {
      return { error: `Invalid fire_at: '${date}T${time}'` }
    }
    const fireAtDate = new Date(utcStr)
    if (Number.isNaN(fireAtDate.getTime())) return { error: `Invalid fire_at: '${date}T${time}'` }
    if (fireAtDate.getTime() <= Date.now()) return { error: 'fire_at must be in the future.' }
    updates.fireAt = utcStr
    if (schedule.rrule === undefined) {
      updates.rrule = null
      updates.dtstartUtc = null
      updates.timezone = null
    }
  }
  if (schedule.rrule !== undefined) {
    const existing = getScheduledPrompt(id, userId)
    if (existing === null) return { error: 'Deferred prompt not found.' }
    const { startDate, startTime, ...scheduleRest } = schedule.rrule
    const anchor =
      startDate === undefined
        ? (updates.fireAt ?? existing.dtstartUtc ?? existing.fireAt)
        : localDatetimeToUtc(startDate, startTime, scheduleRest.timezone)
    const compiled = recurrenceSpecToRrule({ ...scheduleRest, dtstart: anchor })
    updates.rrule = compiled.rrule
    updates.dtstartUtc = compiled.dtstartUtc
    updates.timezone = compiled.timezone
    if (updates.fireAt === undefined) {
      const next = nextOccurrence(compiled, new Date())
      if (next === null) return { error: 'Could not compute next occurrence for the given rrule spec.' }
      updates.fireAt = next.toISOString()
    }
  }
  return updates
}
