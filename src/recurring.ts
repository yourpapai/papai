// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq, and, lte, sql } from 'drizzle-orm'

import { getDrizzleDb } from './db/drizzle.js'
import { recurringTasks } from './db/schema.js'
import { logger } from './logger.js'
import { nextOccurrence } from './recurrence.js'
import { buildCompiled, computeMissedDates, computeNextRun, toRecord } from './recurring-utils.js'
import type { RecurringTaskInput, RecurringTaskRecord } from './types/recurring.js'

export type { TriggerType, RecurringTaskInput, RecurringTaskRecord } from './types/recurring.js'
export {
  COMPLETION_STATUSES,
  findTemplateByTaskId,
  isCompletionStatus,
  recordOccurrence,
} from './recurring-occurrences.js'

const log = logger.child({ scope: 'recurring' })
const generateId = (): string => crypto.randomUUID()

export const createRecurringTask = (input: RecurringTaskInput): RecurringTaskRecord => {
  log.debug({ userId: input.userId, title: input.title, triggerType: input.triggerType }, 'createRecurringTask called')

  const id = generateId()
  const now = new Date().toISOString()

  const compiled =
    input.triggerType === 'cron' && input.rrule !== undefined && input.dtstartUtc !== undefined
      ? { rrule: input.rrule, dtstartUtc: input.dtstartUtc, timezone: input.timezone ?? 'UTC' }
      : null

  const nextRun = compiled === null ? null : computeNextRun(compiled)

  const db = getDrizzleDb()
  db.insert(recurringTasks)
    .values({
      id,
      userId: input.userId,
      projectId: input.projectId,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? null,
      status: input.status ?? null,
      assignee: input.assignee ?? null,
      labels: input.labels !== undefined && input.labels.length > 0 ? JSON.stringify(input.labels) : null,
      triggerType: input.triggerType,
      rrule: input.rrule ?? null,
      dtstartUtc: input.dtstartUtc ?? null,
      timezone: input.timezone ?? 'UTC',
      enabled: '1',
      catchUp: input.catchUp === true ? '1' : '0',
      lastRun: null,
      nextRun,
      createdAt: now,
      updatedAt: now,
    })
    .run()

  log.info({ id, userId: input.userId, title: input.title }, 'Recurring task created')

  return getRecurringTask(id)!
}

export const getRecurringTask = (id: string): RecurringTaskRecord | null => {
  log.debug({ id }, 'getRecurringTask called')

  const db = getDrizzleDb()
  const row = db.select().from(recurringTasks).where(eq(recurringTasks.id, id)).get()
  if (row === undefined) return null
  return toRecord(row)
}

export const listRecurringTasks = (userId: string): RecurringTaskRecord[] => {
  log.debug({ userId }, 'listRecurringTasks called')

  const db = getDrizzleDb()
  const rows = db
    .select()
    .from(recurringTasks)
    .where(eq(recurringTasks.userId, userId))
    .orderBy(sql`${recurringTasks.createdAt} ASC`)
    .all()

  log.info({ userId, count: rows.length }, 'Listed recurring tasks')
  return rows.map(toRecord)
}

type UpdateFields = Pick<
  RecurringTaskInput,
  | 'title'
  | 'description'
  | 'priority'
  | 'status'
  | 'assignee'
  | 'labels'
  | 'triggerType'
  | 'rrule'
  | 'dtstartUtc'
  | 'timezone'
  | 'catchUp'
>

export const updateRecurringTask = (id: string, updates: Partial<UpdateFields>): RecurringTaskRecord | null => {
  log.debug({ id, updates: Object.keys(updates) }, 'updateRecurringTask called')

  const db = getDrizzleDb()
  const existing = db.select().from(recurringTasks).where(eq(recurringTasks.id, id)).get()
  if (existing === undefined) {
    log.warn({ id }, 'Recurring task not found for update')
    return null
  }

  const set: Partial<typeof recurringTasks.$inferInsert> = { updatedAt: new Date().toISOString() }

  if (updates.title !== undefined) set.title = updates.title
  if (updates.description !== undefined) set.description = updates.description
  if (updates.priority !== undefined) set.priority = updates.priority
  if (updates.status !== undefined) set.status = updates.status
  if (updates.assignee !== undefined) set.assignee = updates.assignee
  if (updates.labels !== undefined) set.labels = JSON.stringify(updates.labels)
  if (updates.catchUp !== undefined) set.catchUp = updates.catchUp ? '1' : '0'

  if (updates.triggerType !== undefined) {
    set.triggerType = updates.triggerType
    if (updates.triggerType === 'on_complete') {
      set.rrule = null
      set.dtstartUtc = null
      set.nextRun = null
    }
  }
  if (updates.timezone !== undefined) set.timezone = updates.timezone

  if (updates.rrule !== undefined) {
    set.rrule = updates.rrule
    const newDtstart = updates.dtstartUtc ?? existing.dtstartUtc
    const tz = updates.timezone ?? existing.timezone
    if (newDtstart !== null) {
      set.nextRun = computeNextRun({ rrule: updates.rrule, dtstartUtc: newDtstart, timezone: tz })
    }
  }

  if (updates.dtstartUtc !== undefined) {
    set.dtstartUtc = updates.dtstartUtc
  }

  db.update(recurringTasks).set(set).where(eq(recurringTasks.id, id)).run()

  log.info({ id }, 'Recurring task updated')
  return getRecurringTask(id)
}

export const pauseRecurringTask = (id: string): RecurringTaskRecord | null => {
  log.debug({ id }, 'pauseRecurringTask called')

  const db = getDrizzleDb()
  db.update(recurringTasks)
    .set({ enabled: '0', updatedAt: new Date().toISOString() })
    .where(eq(recurringTasks.id, id))
    .run()

  log.info({ id }, 'Recurring task paused')
  return getRecurringTask(id)
}

export type ResumeResult = {
  record: RecurringTaskRecord
  missedDates: string[]
}

export const resumeRecurringTask = (id: string, createMissed: boolean): ResumeResult | null => {
  log.debug({ id, createMissed }, 'resumeRecurringTask called')

  const db = getDrizzleDb()
  const existing = db.select().from(recurringTasks).where(eq(recurringTasks.id, id)).get()
  if (existing === undefined) {
    log.warn({ id }, 'Recurring task not found for resume')
    return null
  }

  const compiled = buildCompiled(existing.rrule, existing.dtstartUtc, existing.timezone)
  let missedDates: string[] = []
  const nextRun = compiled === null ? existing.nextRun : computeNextRun(compiled)

  if (createMissed && compiled !== null) {
    missedDates = computeMissedDates(compiled, existing.nextRun)
    log.info({ id, missedCount: missedDates.length }, 'Computed missed occurrences')
  }

  db.update(recurringTasks)
    .set({ enabled: '1', nextRun, updatedAt: new Date().toISOString() })
    .where(eq(recurringTasks.id, id))
    .run()

  log.info({ id, createMissed }, 'Recurring task resumed')
  const record = getRecurringTask(id)!
  return { record, missedDates }
}

export const skipNextOccurrence = (id: string): RecurringTaskRecord | null => {
  log.debug({ id }, 'skipNextOccurrence called')

  const db = getDrizzleDb()
  const existing = db.select().from(recurringTasks).where(eq(recurringTasks.id, id)).get()
  if (existing === undefined) {
    log.warn({ id }, 'Recurring task not found for skip')
    return null
  }

  const compiled = buildCompiled(existing.rrule, existing.dtstartUtc, existing.timezone)
  if (compiled === null) {
    log.warn({ id }, 'Cannot skip on-complete triggered task')
    return null
  }

  const baseDate = existing.nextRun === null ? new Date() : new Date(existing.nextRun)
  const newNext = nextOccurrence(compiled, baseDate)
  const newNextRun = newNext === null ? null : newNext.toISOString()

  db.update(recurringTasks)
    .set({ nextRun: newNextRun, updatedAt: new Date().toISOString() })
    .where(eq(recurringTasks.id, id))
    .run()

  log.info({ id, skippedRun: existing.nextRun, newNextRun: newNext?.toISOString() }, 'Skipped next occurrence')
  return getRecurringTask(id)
}

export const deleteRecurringTask = (id: string): boolean => {
  log.debug({ id }, 'deleteRecurringTask called')

  const db = getDrizzleDb()
  const existing = db.select({ id: recurringTasks.id }).from(recurringTasks).where(eq(recurringTasks.id, id)).get()
  if (existing === undefined) {
    log.warn({ id }, 'Recurring task not found for deletion')
    return false
  }

  db.delete(recurringTasks).where(eq(recurringTasks.id, id)).run()
  log.info({ id }, 'Recurring task deleted')
  return true
}

export const getDueRecurringTasks = (): RecurringTaskRecord[] => {
  log.debug('getDueRecurringTasks called')
  const now = new Date().toISOString()
  const db = getDrizzleDb()
  const rows = db
    .select()
    .from(recurringTasks)
    .where(and(eq(recurringTasks.enabled, '1'), lte(recurringTasks.nextRun, now)))
    .all()

  log.debug({ count: rows.length, now }, 'Due recurring tasks found')
  return rows.map(toRecord)
}

export const markExecuted = (id: string): void => {
  log.debug({ id }, 'markExecuted called')
  const db = getDrizzleDb()
  const existing = db.select().from(recurringTasks).where(eq(recurringTasks.id, id)).get()
  if (existing === undefined) return

  const executedAt = new Date()
  const now = executedAt.toISOString()

  const compiled = buildCompiled(existing.rrule, existing.dtstartUtc, existing.timezone)
  const nextRun = existing.triggerType === 'cron' && compiled !== null ? computeNextRun(compiled, executedAt) : null

  db.update(recurringTasks).set({ lastRun: now, nextRun, updatedAt: now }).where(eq(recurringTasks.id, id)).run()

  log.info({ id, lastRun: now, nextRun }, 'Recurring task marked as executed')
}
