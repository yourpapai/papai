// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from './db/drizzle.js'
import { recurringTaskOccurrences } from './db/schema.js'
import { logger } from './logger.js'
import { getRecurringTask } from './recurring.js'
import type { RecurringTaskRecord } from './types/recurring.js'

const log = logger.child({ scope: 'recurring-occurrences' })
const generateId = (): string => crypto.randomUUID()

/** Status values that indicate a task is completed (case-insensitive substring match). */
export const COMPLETION_STATUSES = ['done', 'completed', 'closed', 'resolved'] as const

/** Record an occurrence linking a template to a created task. */
export const recordOccurrence = (templateId: string, taskId: string): void => {
  log.debug({ templateId, taskId }, 'recordOccurrence called')

  const id = generateId()
  const db = getDrizzleDb()
  db.insert(recurringTaskOccurrences).values({ id, templateId, taskId, createdAt: new Date().toISOString() }).run()

  log.info({ templateId, taskId }, 'Occurrence recorded')
}

/** Find the recurring template that generated a given task (via occurrences table). */
export const findTemplateByTaskId = (taskId: string): RecurringTaskRecord | null => {
  log.debug({ taskId }, 'findTemplateByTaskId called')

  const db = getDrizzleDb()
  const occurrence = db
    .select({ templateId: recurringTaskOccurrences.templateId })
    .from(recurringTaskOccurrences)
    .where(eq(recurringTaskOccurrences.taskId, taskId))
    .get()

  if (occurrence === undefined) {
    log.debug({ taskId }, 'No occurrence found for task')
    return null
  }

  return getRecurringTask(occurrence.templateId)
}

/** Check whether a status string indicates task completion. */
export const isCompletionStatus = (status: string): boolean => {
  const lower = status.toLowerCase()
  return COMPLETION_STATUSES.some((s) => lower.includes(s))
}
