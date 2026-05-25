// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ContextType } from '../chat/types.js'
import { dmTarget } from '../chat/types.js'
import { logger } from '../logger.js'
import { nextOccurrence, recurrenceSpecToRrule } from '../recurrence.js'
import { getUserTimezoneOrError } from '../utils/config-timezone.js'
import { localDatetimeToUtc } from '../utils/datetime.js'
import { getScheduledPrompt } from './scheduled.js'
import {
  DEFAULT_EXECUTION_METADATA,
  executionMetadataSchema,
  type DeferredPromptDeliveryInput,
  type ExecutionMetadata,
  type ScheduleInput,
} from './types.js'

const log = logger.child({ scope: 'deferred:schedule-update-helpers' })

export type CreateDeliveryContext = {
  userId: string
  storageContextId: string
  contextType: ContextType
  username?: string | null
}

export function buildDeliveryInput(
  ctx: CreateDeliveryContext,
  policy?: { audience?: 'personal' | 'shared'; mention_user_ids?: string[] },
): DeferredPromptDeliveryInput {
  if (ctx.contextType === 'dm') {
    return { ...dmTarget(ctx.userId), createdByUsername: ctx.username ?? null }
  }
  const colonIdx = ctx.storageContextId.indexOf(':')
  const contextId = colonIdx >= 0 ? ctx.storageContextId.slice(0, colonIdx) : ctx.storageContextId
  const threadId = colonIdx >= 0 ? ctx.storageContextId.slice(colonIdx + 1) : null
  const audience = policy?.audience === 'shared' ? 'shared' : 'personal'
  const mentionUserIds = audience === 'shared' ? [] : (policy?.mention_user_ids ?? [ctx.userId])
  return {
    contextId,
    contextType: 'group',
    threadId,
    audience,
    mentionUserIds,
    createdByUserId: ctx.userId,
    createdByUsername: ctx.username ?? null,
  }
}

export function parseExecution(
  input:
    | {
        mode: 'lightweight' | 'context' | 'full'
        delivery_brief: string
        context_snapshot?: string
      }
    | undefined,
): ExecutionMetadata {
  if (input === undefined) return DEFAULT_EXECUTION_METADATA
  const parseResult = executionMetadataSchema.safeParse(input)
  if (parseResult.success) return parseResult.data
  log.warn({ error: parseResult.error.message }, 'Invalid execution metadata, using default')
  return DEFAULT_EXECUTION_METADATA
}

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
