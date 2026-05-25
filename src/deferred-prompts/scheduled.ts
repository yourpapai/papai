// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, asc, eq, lte } from 'drizzle-orm'

import { dmTarget } from '../chat/types.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { scheduledPrompts } from '../db/schema.js'
import type { ScheduledPromptRow } from '../db/schema.js'
import { logger } from '../logger.js'
import {
  DEFAULT_EXECUTION_METADATA,
  parseExecutionMetadata,
  type DeferredPromptDelivery,
  type DeferredPromptDeliveryInput,
  type ExecutionMetadata,
  type ScheduledPrompt,
} from './types.js'

const log = logger.child({ scope: 'deferred:scheduled' })

function isValidStatus(value: string): value is ScheduledPrompt['status'] {
  return value === 'active' || value === 'completed' || value === 'cancelled'
}

function toStatus(value: string): ScheduledPrompt['status'] {
  return isValidStatus(value) ? value : 'active'
}

function rowToDeliveryTarget(row: ScheduledPromptRow): DeferredPromptDelivery {
  if (row.deliveryContextId !== null) {
    const contextType = row.deliveryContextType === 'group' ? 'group' : 'dm'
    const audience = row.audience === 'shared' ? 'shared' : 'personal'
    let mentionUserIds: string[] = []
    try {
      const parsed: unknown = JSON.parse(row.mentionUserIds)
      if (Array.isArray(parsed)) mentionUserIds = parsed.filter((x): x is string => typeof x === 'string')
    } catch {
      mentionUserIds = []
    }
    return {
      contextId: row.deliveryContextId,
      contextType,
      threadId: row.deliveryThreadId,
      audience,
      mentionUserIds,
      createdByUserId: row.createdByUserId,
      createdByUsername: row.createdByUsername,
    }
  }
  return {
    ...dmTarget(row.createdByUserId),
    createdByUsername: row.createdByUsername,
  }
}

function toScheduledPrompt(row: ScheduledPromptRow): ScheduledPrompt {
  return {
    type: 'scheduled',
    id: row.id,
    createdByUserId: row.createdByUserId,
    createdByUsername: row.createdByUsername,
    deliveryTarget: rowToDeliveryTarget(row),
    prompt: row.prompt,
    fireAt: row.fireAt,
    rrule: row.rrule,
    dtstartUtc: row.dtstartUtc,
    timezone: row.timezone,
    status: toStatus(row.status),
    createdAt: row.createdAt,
    lastExecutedAt: row.lastExecutedAt,
    executionMetadata: parseExecutionMetadata(row.executionMetadata),
  }
}

export function createScheduledPrompt(
  userId: string,
  prompt: string,
  schedule: {
    fireAt: string
    cronCompiled?: { rrule: string; dtstartUtc: string; timezone?: string }
  },
  executionMetadata?: ExecutionMetadata,
  delivery?: DeferredPromptDeliveryInput,
): ScheduledPrompt {
  log.debug({ userId, hasCron: schedule.cronCompiled !== undefined }, 'createScheduledPrompt called')

  const db = getDrizzleDb()
  const id = crypto.randomUUID()
  const fireAt = new Date(schedule.fireAt).toISOString()
  const translated = schedule.cronCompiled ?? null

  const target = delivery ?? dmTarget(userId)

  db.insert(scheduledPrompts)
    .values({
      id,
      createdByUserId: target.createdByUserId,
      createdByUsername: target.createdByUsername,
      deliveryContextId: target.contextType === 'group' ? target.contextId : null,
      deliveryContextType: target.contextType === 'group' ? 'group' : null,
      deliveryThreadId: target.threadId,
      audience: target.audience,
      mentionUserIds: JSON.stringify(target.mentionUserIds),
      prompt,
      fireAt,
      rrule: translated?.rrule ?? null,
      dtstartUtc: translated?.dtstartUtc ?? null,
      timezone: translated?.timezone ?? null,
      status: 'active',
      executionMetadata: JSON.stringify(executionMetadata ?? DEFAULT_EXECUTION_METADATA),
    })
    .run()

  const row = db.select().from(scheduledPrompts).where(eq(scheduledPrompts.id, id)).get()

  log.info({ id, userId }, 'Scheduled prompt created')
  return toScheduledPrompt(row!)
}

export function listScheduledPrompts(userId: string, status?: string): ScheduledPrompt[] {
  log.debug({ userId, hasStatus: status !== undefined }, 'listScheduledPrompts called')

  const db = getDrizzleDb()

  const conditions = [eq(scheduledPrompts.createdByUserId, userId)]
  if (status !== undefined) {
    conditions.push(eq(scheduledPrompts.status, status))
  }

  const rows = db
    .select()
    .from(scheduledPrompts)
    .where(and(...conditions))
    .all()

  return rows.map(toScheduledPrompt)
}

export function getScheduledPrompt(id: string, userId: string): ScheduledPrompt | null {
  log.debug({ id, userId }, 'getScheduledPrompt called')

  const db = getDrizzleDb()

  const row = db
    .select()
    .from(scheduledPrompts)
    .where(and(eq(scheduledPrompts.id, id), eq(scheduledPrompts.createdByUserId, userId)))
    .get()

  if (row === undefined) {
    return null
  }

  return toScheduledPrompt(row)
}

function buildUpdateValues(updates: {
  prompt?: string
  fireAt?: string
  rrule?: string | null
  dtstartUtc?: string | null
  timezone?: string | null
  executionMetadata?: ExecutionMetadata
}): Partial<typeof scheduledPrompts.$inferInsert> {
  const values: Partial<typeof scheduledPrompts.$inferInsert> = {}
  if (updates.prompt !== undefined) values.prompt = updates.prompt
  if (updates.fireAt !== undefined) values.fireAt = new Date(updates.fireAt).toISOString()
  if (updates.rrule !== undefined) values.rrule = updates.rrule
  if (updates.dtstartUtc !== undefined) values.dtstartUtc = updates.dtstartUtc
  if (updates.timezone !== undefined) values.timezone = updates.timezone
  if (updates.executionMetadata !== undefined) values.executionMetadata = JSON.stringify(updates.executionMetadata)
  return values
}

export function updateScheduledPrompt(
  id: string,
  userId: string,
  updates: {
    prompt?: string
    fireAt?: string
    rrule?: string | null
    dtstartUtc?: string | null
    timezone?: string | null
    executionMetadata?: ExecutionMetadata
  },
): ScheduledPrompt | null {
  log.debug({ id, userId }, 'updateScheduledPrompt called')

  const db = getDrizzleDb()
  const ownerFilter = and(eq(scheduledPrompts.id, id), eq(scheduledPrompts.createdByUserId, userId))

  const existing = db.select().from(scheduledPrompts).where(ownerFilter).get()
  if (existing === undefined) return null

  const setValues = buildUpdateValues(updates)
  if (Object.keys(setValues).length > 0) {
    db.update(scheduledPrompts).set(setValues).where(ownerFilter).run()
  }

  const row = db.select().from(scheduledPrompts).where(eq(scheduledPrompts.id, id)).get()
  log.info({ id, userId }, 'Scheduled prompt updated')
  return toScheduledPrompt(row!)
}

export function cancelScheduledPrompt(id: string, userId: string): ScheduledPrompt | null {
  log.debug({ id, userId }, 'cancelScheduledPrompt called')

  const db = getDrizzleDb()

  const existing = db
    .select()
    .from(scheduledPrompts)
    .where(and(eq(scheduledPrompts.id, id), eq(scheduledPrompts.createdByUserId, userId)))
    .get()

  if (existing === undefined) {
    return null
  }

  db.update(scheduledPrompts)
    .set({ status: 'cancelled' })
    .where(and(eq(scheduledPrompts.id, id), eq(scheduledPrompts.createdByUserId, userId)))
    .run()

  const row = db.select().from(scheduledPrompts).where(eq(scheduledPrompts.id, id)).get()

  log.info({ id, userId }, 'Scheduled prompt cancelled')
  return toScheduledPrompt(row!)
}

export function getScheduledPromptsDue(limit = 100): ScheduledPrompt[] {
  log.debug({ limit }, 'getScheduledPromptsDue called')

  const db = getDrizzleDb()
  const now = new Date().toISOString()

  const rows = db
    .select()
    .from(scheduledPrompts)
    .where(and(eq(scheduledPrompts.status, 'active'), lte(scheduledPrompts.fireAt, now)))
    .orderBy(asc(scheduledPrompts.fireAt))
    .limit(limit)
    .all()

  return rows.map(toScheduledPrompt)
}

export function advanceScheduledPrompt(id: string, userId: string, nextFireAt: string, lastExecutedAt: string): void {
  log.debug({ id, userId }, 'advanceScheduledPrompt called')

  const db = getDrizzleDb()

  db.update(scheduledPrompts)
    .set({
      fireAt: new Date(nextFireAt).toISOString(),
      lastExecutedAt: new Date(lastExecutedAt).toISOString(),
    })
    .where(and(eq(scheduledPrompts.id, id), eq(scheduledPrompts.createdByUserId, userId)))
    .run()

  log.info({ id, userId }, 'Scheduled prompt advanced')
}

export function completeScheduledPrompt(id: string, userId: string, lastExecutedAt: string): void {
  log.debug({ id, userId }, 'completeScheduledPrompt called')

  const db = getDrizzleDb()

  db.update(scheduledPrompts)
    .set({
      status: 'completed',
      lastExecutedAt: new Date(lastExecutedAt).toISOString(),
    })
    .where(and(eq(scheduledPrompts.id, id), eq(scheduledPrompts.createdByUserId, userId)))
    .run()

  log.info({ id, userId }, 'Scheduled prompt completed')
}
