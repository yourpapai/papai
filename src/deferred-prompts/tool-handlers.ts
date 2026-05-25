// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { emitUser } from '../debug/event-bus.js'
import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import { logger } from '../logger.js'
import type { CompiledRecurrence } from '../recurrence.js'
import { nextOccurrence, recurrenceSpecToRrule } from '../recurrence.js'
import type { RecurrenceSpec } from '../types/recurrence.js'
import { getUserTimezoneOrError } from '../utils/config-timezone.js'
import { localDatetimeToUtc, midnightUtcForTimezone, utcToLocal } from '../utils/datetime.js'
import { cancelAlertPrompt, createAlertPrompt, getAlertPrompt, listAlertPrompts, updateAlertPrompt } from './alerts.js'
import { buildDeliveryInput, type CreateDeliveryContext, type DeliveryPolicy } from './delivery-input.js'
import { buildScheduleUpdates, type ScheduleFieldUpdates } from './schedule-update-helpers.js'
import {
  cancelScheduledPrompt,
  createScheduledPrompt,
  getScheduledPrompt,
  listScheduledPrompts,
  updateScheduledPrompt,
} from './scheduled.js'
import {
  alertConditionSchema,
  DEFAULT_EXECUTION_METADATA,
  executionMetadataSchema,
  type AlertCondition,
  type CancelResult,
  type CreateResult,
  type DeferredPromptDeliveryInput,
  type ExecutionMetadata,
  type GetResult,
  type ListResult,
  type ScheduleInput,
  type UpdateResult,
} from './types.js'

const log = logger.child({ scope: 'deferred:tools' })

// --- Input types ---

export type CreateInput = {
  prompt: string
} & Partial<
  Readonly<{
    schedule: ScheduleInput
    condition: AlertCondition
    cooldown_minutes: number
    execution: ExecutionInput
    delivery: DeliveryPolicy
  }>
>

type ExecutionInput = { mode: 'lightweight' | 'context' | 'full'; delivery_brief: string } & Partial<
  Readonly<{ context_snapshot: string }>
>

export type UpdateInput = {
  id: string
} & Partial<
  Readonly<{
    prompt: string
    schedule: ScheduleInput
    condition: AlertCondition
    cooldown_minutes: number
    execution: ExecutionInput
  }>
>

export type ListInput = Partial<Readonly<{ type: 'scheduled' | 'alert'; status: 'active' | 'completed' | 'cancelled' }>>

// --- Handlers ---

function validateFutureFireAt(date: string, time: string, timezone: string): string | { error: string } {
  const utcStr = localDatetimeToUtc(date, time, timezone)
  const fireDate = new Date(utcStr)
  if (Number.isNaN(fireDate.getTime())) return { error: `Invalid fire_at date/time: '${date}T${time}'` }
  if (fireDate.getTime() <= Date.now()) return { error: 'fire_at must be a future date and time.' }
  return utcStr
}

function createScheduled(
  userId: string,
  prompt: string,
  schedule: ScheduleInput,
  executionMetadata: ExecutionMetadata,
  delivery: DeferredPromptDeliveryInput | undefined,
): CreateResult {
  const hasFireAt = schedule.fire_at !== undefined
  const hasRrule = schedule.rrule !== undefined
  const timezone = getUserTimezoneOrError(getConfigContextIdFromStorageContextId(userId))
  if (typeof timezone !== 'string') return timezone

  if (hasFireAt) {
    const { date, time } = schedule.fire_at!
    const validatedFireAt = validateFutureFireAt(date, time, timezone)
    if (typeof validatedFireAt !== 'string') return validatedFireAt
  }

  let cronCompiled: CompiledRecurrence | undefined
  if (hasRrule) {
    const { startDate, startTime, ...scheduleRest } = schedule.rrule!
    const dtstart =
      startDate === undefined ? midnightUtcForTimezone(timezone) : localDatetimeToUtc(startDate, startTime, timezone)
    cronCompiled = recurrenceSpecToRrule({ ...scheduleRest, dtstart } as Omit<RecurrenceSpec, 'timezone'>, timezone)
  }

  let fireAt: string
  if (hasFireAt) {
    fireAt = localDatetimeToUtc(schedule.fire_at!.date, schedule.fire_at!.time, timezone)
  } else if (hasRrule) {
    const next = nextOccurrence(cronCompiled!, new Date())
    if (next === null) return { error: 'Could not compute next occurrence for the given rrule spec.' }
    fireAt = next.toISOString()
  } else {
    return { error: 'Schedule must include either fire_at or rrule.' }
  }

  const result = createScheduledPrompt(userId, prompt, { fireAt, cronCompiled }, executionMetadata, delivery)
  log.info({ id: result.id, userId, type: 'scheduled' }, 'Deferred prompt created')
  const localizedFireAt = utcToLocal(result.fireAt, timezone)
  let displayFireAt = result.fireAt
  if (localizedFireAt !== null && localizedFireAt !== undefined) displayFireAt = localizedFireAt
  return {
    status: 'created',
    type: 'scheduled',
    id: result.id,
    fireAt: displayFireAt,
    rrule: result.rrule,
  }
}

function createAlert(
  userId: string,
  prompt: string,
  condition: unknown,
  cooldownMinutes: number | undefined,
  executionMetadata: ExecutionMetadata,
  delivery: DeferredPromptDeliveryInput | undefined,
): CreateResult {
  const parseResult = alertConditionSchema.safeParse(condition)
  if (!parseResult.success) return { error: `Invalid condition: ${parseResult.error.message}` }

  const result = createAlertPrompt(userId, prompt, parseResult.data, cooldownMinutes, executionMetadata, delivery)
  log.info({ id: result.id, userId, type: 'alert' }, 'Deferred prompt created')
  return { status: 'created', type: 'alert', id: result.id, cooldownMinutes: result.cooldownMinutes }
}

function parseExecution(input: ExecutionInput | undefined): ExecutionMetadata {
  if (input === undefined) return DEFAULT_EXECUTION_METADATA
  const parseResult = executionMetadataSchema.safeParse(input)
  if (parseResult.success) return parseResult.data
  log.warn({ error: parseResult.error.message }, 'Invalid execution metadata, using default')
  return DEFAULT_EXECUTION_METADATA
}

export function executeCreate(
  userId: string,
  input: CreateInput,
  ...deliveryArgs: readonly [] | readonly [deliveryCtx: CreateDeliveryContext]
): CreateResult {
  const hasSchedule = input.schedule !== undefined
  const hasCondition = input.condition !== undefined
  log.debug({ userId, hasSchedule, hasCondition }, 'create_deferred_prompt called')
  if (hasSchedule && hasCondition) return { error: 'Provide either a schedule or a condition, not both.' }
  if (!hasSchedule && !hasCondition) {
    return { error: 'Provide either a schedule (for time-based) or a condition (for event-based).' }
  }

  const executionMetadata = parseExecution(input.execution)
  const deliveryCtx = deliveryArgs[0]
  const delivery = deliveryCtx === undefined ? undefined : buildDeliveryInput(deliveryCtx, input.delivery)

  if (hasSchedule) {
    const result = createScheduled(userId, input.prompt, input.schedule, executionMetadata, delivery)
    if (result !== undefined && 'id' in result) emitUser('deferred:created', userId, { promptId: result.id })
    return result
  }
  const result = createAlert(userId, input.prompt, input.condition, input.cooldown_minutes, executionMetadata, delivery)
  if (result !== undefined && 'id' in result) emitUser('deferred:created', userId, { promptId: result.id })
  return result
}

export function executeList(
  userId: string,
  input: ListInput,
): ListResult {
  log.debug({ userId, type: input.type, status: input.status }, 'list_deferred_prompts called')
  const prompts: ListResult['prompts'] = []
  if (input.type !== 'alert') prompts.push(...listScheduledPrompts(userId, input.status))
  if (input.type !== 'scheduled') prompts.push(...listAlertPrompts(userId, input.status))
  log.info({ userId, count: prompts.length }, 'Listed deferred prompts')
  return { prompts }
}

export function executeGet(userId: string, input: { id: string }): GetResult {
  log.debug({ userId, id: input.id }, 'get_deferred_prompt called')
  const scheduled = getScheduledPrompt(input.id, userId)
  if (scheduled !== null) return scheduled
  const alert = getAlertPrompt(input.id, userId)
  if (alert !== null) return alert
  return { error: 'Deferred prompt not found.' }
}

function updateScheduledFields(id: string, userId: string, input: UpdateInput): UpdateResult {
  if (input.condition !== undefined)
    return { error: 'Cannot apply a condition to a scheduled prompt. Use schedule fields instead.' }
  const updates: Partial<{ prompt: string; executionMetadata: ExecutionMetadata }> & ScheduleFieldUpdates = {}
  if (input.prompt !== undefined) updates.prompt = input.prompt
  if (input.schedule !== undefined) {
    const scheduleUpdates = buildScheduleUpdates(id, userId, input.schedule)
    if ('error' in scheduleUpdates) return scheduleUpdates
    Object.assign(updates, scheduleUpdates)
  }
  if (input.execution !== undefined) {
    const parseResult = executionMetadataSchema.safeParse(input.execution)
    if (parseResult.success) updates.executionMetadata = parseResult.data
  }
  const result = updateScheduledPrompt(id, userId, updates)
  if (result === null) return { error: 'Deferred prompt not found.' }
  log.info({ id, userId }, 'Scheduled prompt updated via tool')
  return { ...result, status: 'updated' as const }
}

function updateAlertFields(id: string, userId: string, input: UpdateInput): UpdateResult {
  if (input.schedule !== undefined)
    return { error: 'Cannot apply a schedule to an alert prompt. Use condition fields instead.' }
  const updates: Partial<
    {
      prompt: string
      condition: AlertCondition
      cooldownMinutes: number
      executionMetadata: ExecutionMetadata
    }
  > = {}
  if (input.prompt !== undefined) updates.prompt = input.prompt
  if (input.condition !== undefined) {
    const parseResult = alertConditionSchema.safeParse(input.condition)
    if (!parseResult.success) return { error: `Invalid condition: ${parseResult.error.message}` }
    updates.condition = parseResult.data
  }
  if (input.cooldown_minutes !== undefined) updates.cooldownMinutes = input.cooldown_minutes
  if (input.execution !== undefined) {
    const parseResult = executionMetadataSchema.safeParse(input.execution)
    if (parseResult.success) updates.executionMetadata = parseResult.data
  }
  const result = updateAlertPrompt(id, userId, updates)
  if (result === null) return { error: 'Deferred prompt not found.' }
  log.info({ id, userId }, 'Alert prompt updated via tool')
  return { ...result, status: 'updated' as const }
}

export function executeUpdate(userId: string, input: UpdateInput): UpdateResult {
  log.debug({ userId, id: input.id }, 'update_deferred_prompt called')
  const scheduled = getScheduledPrompt(input.id, userId)
  if (scheduled === null) {
    const alert = getAlertPrompt(input.id, userId)
    if (alert === null) return { error: 'Deferred prompt not found.' }
    const result = updateAlertFields(input.id, userId, input)
    if ('id' in result && !('error' in result)) emitUser('deferred:updated', userId, { promptId: result.id })
    return result
  }
  const result = updateScheduledFields(input.id, userId, input)
  if ('id' in result && !('error' in result)) emitUser('deferred:updated', userId, { promptId: result.id })
  return result
}

export function executeCancel(userId: string, input: { id: string }): CancelResult {
  log.debug({ userId, id: input.id }, 'cancel_deferred_prompt called')
  if (cancelScheduledPrompt(input.id, userId) !== null) {
    log.info({ id: input.id, userId, type: 'scheduled' }, 'Deferred prompt cancelled')
    emitUser('deferred:cancelled', userId, { promptId: input.id })
    return { status: 'cancelled', id: input.id }
  }
  if (cancelAlertPrompt(input.id, userId) !== null) {
    log.info({ id: input.id, userId, type: 'alert' }, 'Deferred prompt cancelled')
    emitUser('deferred:cancelled', userId, { promptId: input.id })
    return { status: 'cancelled', id: input.id }
  }
  return { error: 'Deferred prompt not found.' }
}
