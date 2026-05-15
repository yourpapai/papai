// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq } from 'drizzle-orm'

import { dmTarget } from '../chat/types.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { alertPrompts, type AlertPromptRow } from '../db/schema.js'
import { logger } from '../logger.js'
import {
  alertConditionSchema,
  DEFAULT_EXECUTION_METADATA,
  parseExecutionMetadata,
  type AlertCondition,
  type AlertPrompt,
  type DeferredPromptDelivery,
  type DeferredPromptDeliveryInput,
  type ExecutionMetadata,
} from './types.js'

const log = logger.child({ scope: 'deferred:alerts' })

// --- Row mapper ---

const parseStatus = (raw: string): AlertPrompt['status'] => (raw === 'cancelled' ? 'cancelled' : 'active')

function rowToDeliveryTarget(row: AlertPromptRow): DeferredPromptDelivery {
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

const toAlertPrompt = (row: AlertPromptRow): AlertPrompt => ({
  type: 'alert',
  id: row.id,
  createdByUserId: row.createdByUserId,
  createdByUsername: row.createdByUsername,
  deliveryTarget: rowToDeliveryTarget(row),
  prompt: row.prompt,
  condition: alertConditionSchema.parse(JSON.parse(row.condition)),
  status: parseStatus(row.status),
  createdAt: row.createdAt,
  lastTriggeredAt: row.lastTriggeredAt,
  cooldownMinutes: row.cooldownMinutes,
  executionMetadata: parseExecutionMetadata(row.executionMetadata),
})

// --- CRUD ---

export const createAlertPrompt = (
  userId: string,
  prompt: string,
  condition: AlertCondition,
  cooldownMinutes?: number,
  executionMetadata?: ExecutionMetadata,
  delivery?: DeferredPromptDeliveryInput,
): AlertPrompt => {
  log.debug({ userId, cooldownMinutes }, 'createAlertPrompt called')
  const id = crypto.randomUUID()
  const db = getDrizzleDb()

  const target = delivery ?? dmTarget(userId)

  db.insert(alertPrompts)
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
      condition: JSON.stringify(condition),
      status: 'active',
      createdAt: new Date().toISOString(),
      lastTriggeredAt: null,
      cooldownMinutes: cooldownMinutes ?? 60,
      executionMetadata: JSON.stringify(executionMetadata ?? DEFAULT_EXECUTION_METADATA),
    })
    .run()

  log.info({ id, userId }, 'Alert prompt created')
  return toAlertPrompt(db.select().from(alertPrompts).where(eq(alertPrompts.id, id)).get()!)
}

export const listAlertPrompts = (userId: string, status?: string): AlertPrompt[] => {
  log.debug({ userId, status }, 'listAlertPrompts called')
  const db = getDrizzleDb()
  const conditions = [eq(alertPrompts.createdByUserId, userId)]
  if (status !== undefined) conditions.push(eq(alertPrompts.status, status))

  const rows = db
    .select()
    .from(alertPrompts)
    .where(and(...conditions))
    .all()
  log.info({ userId, count: rows.length }, 'Listed alert prompts')
  return rows.map(toAlertPrompt)
}

export const getAlertPrompt = (id: string, userId: string): AlertPrompt | null => {
  log.debug({ id, userId }, 'getAlertPrompt called')
  const db = getDrizzleDb()
  const row = db
    .select()
    .from(alertPrompts)
    .where(and(eq(alertPrompts.id, id), eq(alertPrompts.createdByUserId, userId)))
    .get()

  if (row === undefined) {
    log.debug({ id, userId }, 'Alert prompt not found')
    return null
  }
  return toAlertPrompt(row)
}

export const updateAlertPrompt = (
  id: string,
  userId: string,
  updates: {
    prompt?: string
    condition?: AlertCondition
    cooldownMinutes?: number
    executionMetadata?: ExecutionMetadata
  },
): AlertPrompt | null => {
  log.debug({ id, userId, updates: Object.keys(updates) }, 'updateAlertPrompt called')
  const db = getDrizzleDb()
  const existing = db
    .select()
    .from(alertPrompts)
    .where(and(eq(alertPrompts.id, id), eq(alertPrompts.createdByUserId, userId)))
    .get()

  if (existing === undefined) {
    log.warn({ id, userId }, 'Alert prompt not found for update')
    return null
  }

  const set: Partial<typeof alertPrompts.$inferInsert> = {}
  if (updates.prompt !== undefined) set.prompt = updates.prompt
  if (updates.condition !== undefined) {
    alertConditionSchema.parse(updates.condition)
    set.condition = JSON.stringify(updates.condition)
  }
  if (updates.cooldownMinutes !== undefined) set.cooldownMinutes = updates.cooldownMinutes
  if (updates.executionMetadata !== undefined) set.executionMetadata = JSON.stringify(updates.executionMetadata)

  db.update(alertPrompts)
    .set(set)
    .where(and(eq(alertPrompts.id, id), eq(alertPrompts.createdByUserId, userId)))
    .run()
  log.info({ id, userId }, 'Alert prompt updated')
  return getAlertPrompt(id, userId)
}

export const cancelAlertPrompt = (id: string, userId: string): AlertPrompt | null => {
  log.debug({ id, userId }, 'cancelAlertPrompt called')
  const db = getDrizzleDb()
  const existing = db
    .select()
    .from(alertPrompts)
    .where(and(eq(alertPrompts.id, id), eq(alertPrompts.createdByUserId, userId)))
    .get()

  if (existing === undefined) {
    log.warn({ id, userId }, 'Alert prompt not found for cancel')
    return null
  }

  db.update(alertPrompts)
    .set({ status: 'cancelled' })
    .where(and(eq(alertPrompts.id, id), eq(alertPrompts.createdByUserId, userId)))
    .run()
  log.info({ id, userId }, 'Alert prompt cancelled')
  return getAlertPrompt(id, userId)
}

export const updateAlertTriggerTime = (id: string, userId: string, lastTriggeredAt: string): void => {
  log.debug({ id, userId, lastTriggeredAt }, 'updateAlertTriggerTime called')
  const db = getDrizzleDb()
  db.update(alertPrompts)
    .set({ lastTriggeredAt })
    .where(and(eq(alertPrompts.id, id), eq(alertPrompts.createdByUserId, userId)))
    .run()
  log.info({ id, userId }, 'Alert trigger time updated')
}

export const getEligibleAlertPrompts = (): AlertPrompt[] => {
  log.debug('getEligibleAlertPrompts called')
  const db = getDrizzleDb()
  const nowMs = Date.now()

  const rows = db.select().from(alertPrompts).where(eq(alertPrompts.status, 'active')).all()

  const eligible = rows.filter((row) => {
    if (row.lastTriggeredAt === null) return true
    const triggeredMs = new Date(row.lastTriggeredAt).getTime()
    const cooldownMs = row.cooldownMinutes * 60_000
    return nowMs - triggeredMs >= cooldownMs
  })

  if (eligible.length > 0) {
    log.info({ total: rows.length, eligible: eligible.length }, 'Eligible alert prompts found')
  } else {
    log.debug({ total: rows.length }, 'No eligible alert prompts')
  }
  return eligible.map(toAlertPrompt)
}

export { evaluateCondition, describeCondition } from './condition-eval.js'
