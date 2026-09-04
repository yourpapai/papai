// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from './db/drizzle.js'
import { recurringTasks } from './db/schema.js'
import { logger } from './logger.js'
import { buildCompiled, computeNextRun } from './recurring-utils.js'

const log = logger.child({ scope: 'recurring' })

/** Sets lastRun to the attempt time and advances nextRun to the next occurrence,
 * consuming the scheduled slot without recording an occurrence. Shared by the
 * success path (`markExecuted`) and the permanent-failure path
 * (`recordFailedExecution`): a consumed failed attempt is not a missed date. */
const advanceRunState = (id: string, event: 'executed' | 'failed'): void => {
  const db = getDrizzleDb()
  const existing = db.select().from(recurringTasks).where(eq(recurringTasks.id, id)).get()
  if (existing === undefined) return

  const attemptedAt = new Date()
  const now = attemptedAt.toISOString()

  const compiled = buildCompiled(existing.rrule, existing.dtstartUtc, existing.timezone)
  const nextRun = existing.triggerType === 'cron' && compiled !== null ? computeNextRun(compiled, attemptedAt) : null

  db.update(recurringTasks).set({ lastRun: now, nextRun, updatedAt: now }).where(eq(recurringTasks.id, id)).run()

  if (event === 'failed') {
    log.warn({ id, lastRun: now, nextRun }, 'Recurring task attempt failed; slot consumed, next attempt scheduled')
    return
  }
  log.info({ id, lastRun: now, nextRun }, 'Recurring task marked as executed')
}

export const markExecuted = (id: string): void => {
  log.debug({ id }, 'markExecuted called')
  advanceRunState(id, 'executed')
}

export const recordFailedExecution = (id: string): void => {
  log.debug({ id }, 'recordFailedExecution called')
  advanceRunState(id, 'failed')
}
