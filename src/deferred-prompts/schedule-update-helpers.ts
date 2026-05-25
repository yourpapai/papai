// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import { logger } from '../logger.js'
import { nextOccurrence, recurrenceSpecToRrule } from '../recurrence.js'
import { getUserTimezoneOrError } from '../utils/config-timezone.js'
import { localDatetimeToUtc } from '../utils/datetime.js'
import { getScheduledPrompt } from './scheduled.js'
import {
  DEFAULT_EXECUTION_METADATA,
  executionMetadataSchema,
  type ExecutionMetadata,
  type ScheduleInput,
} from './types.js'

const log = logger.child({ scope: 'deferred:schedule-update-helpers' })

export function parseExecution(
  input:
    | ({
        mode: 'lightweight' | 'context' | 'full'
        delivery_brief: string
      } & Partial<Readonly<{ context_snapshot: string }>>)
    | undefined,
): ExecutionMetadata {
  if (input === undefined) return DEFAULT_EXECUTION_METADATA
  const parseResult = executionMetadataSchema.safeParse(input)
  if (parseResult.success) return parseResult.data
  log.warn({ error: parseResult.error.message }, 'Invalid execution metadata, using default')
  return DEFAULT_EXECUTION_METADATA
}

export type ScheduleFieldUpdates = Partial<
  Record<'fireAt', string> & Record<'rrule' | 'dtstartUtc' | 'timezone', string | null>
>

const getRecurrenceAnchor = (
  updates: ScheduleFieldUpdates,
  existing: NonNullable<ReturnType<typeof getScheduledPrompt>>,
): string => {
  if (updates.fireAt !== undefined) return updates.fireAt
  if (existing.dtstartUtc !== null) return existing.dtstartUtc
  return existing.fireAt
}

export function buildScheduleUpdates(
  id: string,
  userId: string,
  schedule: ScheduleInput,
): ScheduleFieldUpdates | { error: string } {
  const timezone = getUserTimezoneOrError(getConfigContextIdFromStorageContextId(userId))
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
        ? getRecurrenceAnchor(updates, existing)
        : localDatetimeToUtc(startDate, startTime, timezone)
    const compiled = recurrenceSpecToRrule(
      { ...scheduleRest, dtstart: anchor } as Omit<Parameters<typeof recurrenceSpecToRrule>[0], 'timezone'>,
      timezone,
    )
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
