// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { recurringTasks } from './db/schema.js'
import { nextOccurrence, occurrencesBetween } from './recurrence.js'
import type { CompiledRecurrence } from './recurrence.js'
import type { RecurringTaskRecord, TriggerType } from './types/recurring.js'

export const parseLabels = (raw: string | null): string[] => {
  if (raw === null || raw === '') return []
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) return []
  return parsed.filter((v): v is string => typeof v === 'string')
}

export const parseTriggerType = (raw: string): TriggerType => {
  if (raw === 'on_complete') return 'on_complete'
  return 'cron'
}

export const toRecord = (row: typeof recurringTasks.$inferSelect): RecurringTaskRecord => ({
  id: row.id,
  userId: row.userId,
  projectId: row.projectId,
  title: row.title,
  description: row.description,
  priority: row.priority,
  status: row.status,
  assignee: row.assignee,
  labels: parseLabels(row.labels),
  triggerType: parseTriggerType(row.triggerType),
  rrule: row.rrule,
  dtstartUtc: row.dtstartUtc,
  timezone: row.timezone,
  enabled: row.enabled === '1',
  catchUp: row.catchUp === '1',
  lastRun: row.lastRun,
  nextRun: row.nextRun,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const computeNextRun = (compiled: CompiledRecurrence, after: Date = new Date()): string | null => {
  const next = nextOccurrence(compiled, after)
  return next === null ? null : next.toISOString()
}

export const computeMissedDates = (compiled: CompiledRecurrence, fromDate: string | null): string[] => {
  const after = fromDate === null ? new Date(0) : new Date(fromDate)
  const before = new Date()
  return occurrencesBetween(compiled, after, before, 100).map((d) => d.toISOString())
}

export const buildCompiled = (
  rrule: string | null,
  dtstartUtc: string | null,
  timezone: string,
): CompiledRecurrence | null => {
  if (rrule === null || dtstartUtc === null) return null
  return { rrule, dtstartUtc, timezone }
}
