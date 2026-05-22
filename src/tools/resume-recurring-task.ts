// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import { describeCompiledRecurrence } from '../recurrence.js'
import { resumeRecurringTask as defaultResumeRecurringTask } from '../recurring.js'
import type { ResumeResult } from '../recurring.js'
import { createMissedTasks as defaultCreateMissedTasks } from '../scheduler.js'
import type { RecurringTaskRecord } from '../types/recurring.js'
import { utcToLocal } from '../utils/datetime.js'

const log = logger.child({ scope: 'tool:resume-recurring-task' })

export interface ResumeRecurringTaskDeps {
  resumeRecurringTask: (id: string, createMissed: boolean) => ResumeResult | null
  createMissedTasks: (recurringTaskId: string, missedDates: readonly string[]) => Promise<number>
}

const defaultDeps: ResumeRecurringTaskDeps = {
  resumeRecurringTask: (...args) => defaultResumeRecurringTask(...args),
  createMissedTasks: (...args) => defaultCreateMissedTasks(...args),
}

const inputSchema = z.object({
  recurringTaskId: z.string().describe('ID of the recurring task definition to resume'),
  createMissed: z.boolean().optional().describe('If true, creates tasks for missed cycles. Default: false'),
})

type Input = z.infer<typeof inputSchema>

const describeSchedule = (record: RecurringTaskRecord): string => {
  if (record.triggerType === 'cron' && record.rrule !== null && record.dtstartUtc !== null) {
    return describeCompiledRecurrence({
      rrule: record.rrule,
      dtstartUtc: record.dtstartUtc,
      timezone: record.timezone,
    })
  }
  return 'after completion'
}

async function executeResume(input: Input, deps: ResumeRecurringTaskDeps): Promise<unknown> {
  const { recurringTaskId, createMissed } = input
  log.debug({ recurringTaskId, createMissed }, 'Resuming recurring task')
  const result = deps.resumeRecurringTask(recurringTaskId, createMissed ?? false)

  if (result === null) {
    log.warn({ recurringTaskId }, 'Recurring task not found for resume')
    return { error: 'Recurring task not found' }
  }

  const { record, missedDates } = result
  const createdCount = missedDates.length > 0 ? await deps.createMissedTasks(recurringTaskId, missedDates) : 0

  const schedule = describeSchedule(record)

  log.info(
    { id: record.id, title: record.title, createMissed, missedCreated: createdCount },
    'Recurring task resumed via tool',
  )
  return {
    id: record.id,
    title: record.title,
    enabled: record.enabled,
    nextRun: utcToLocal(record.nextRun, record.timezone),
    schedule,
    status: 'active',
    missedTasksCreated: createdCount,
  }
}

export function makeResumeRecurringTaskTool(deps: ResumeRecurringTaskDeps = defaultDeps): ToolSet[string] {
  return tool({
    description: 'Resume a paused recurring task series. Optionally create missed occurrences retroactively.',
    inputSchema,
    execute: async (input) => {
      try {
        return await executeResume(input, deps)
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), tool: 'resume_recurring_task' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
