// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { rruleInputSchema } from '../deferred-prompts/types.js'
import { logger } from '../logger.js'
import { recurrenceSpecToRrule } from '../recurrence.js'
import {
  getRecurringTask as defaultGetRecurringTask,
  updateRecurringTask as defaultUpdateRecurringTask,
} from '../recurring.js'
import type { RecurringTaskRecord } from '../types/recurring.js'
import { getUserTimezoneOrDefault } from '../utils/config-timezone.js'
import { localDatetimeToUtc, midnightUtcForTimezone, utcToLocal } from '../utils/datetime.js'

const log = logger.child({ scope: 'tool:update-recurring-task' })

export interface UpdateRecurringTaskDeps {
  getRecurringTask: (id: string) => RecurringTaskRecord | null
  updateRecurringTask: (id: string, updates: Record<string, unknown>) => RecurringTaskRecord | null
}

const defaultDeps: UpdateRecurringTaskDeps = {
  getRecurringTask: (...args) => defaultGetRecurringTask(...args),
  updateRecurringTask: (...args) => defaultUpdateRecurringTask(...args),
}

const inputSchema = z
  .object({
    recurringTaskId: z.string().describe('ID of the recurring task definition to update'),
    title: z.string().optional().describe('New title'),
    description: z.string().optional().describe('New description'),
    priority: z.enum(['no-priority', 'low', 'medium', 'high', 'urgent']).optional().describe('New priority'),
    status: z.string().optional().describe('New initial status'),
    assignee: z.string().optional().describe('New assignee'),
    labels: z.array(z.string()).optional().describe('New label IDs'),
    triggerType: z
      .enum(['cron', 'on_complete'])
      .optional()
      .describe(
        "Switch trigger type. Use 'on_complete' to remove the fixed schedule and trigger after completion instead.",
      ),
    schedule: rruleInputSchema
      .optional()
      .describe("Updated schedule. Call get_current_time first to obtain the user's IANA timezone."),
    catchUp: z.boolean().optional().describe('Whether to create missed occurrences on resume'),
  })
  .superRefine(({ triggerType, schedule }, ctx) => {
    if (triggerType === 'on_complete' && schedule !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: "schedule must not be provided when triggerType is 'on_complete'",
        path: ['schedule'],
      })
    }
    if (triggerType === 'cron' && schedule === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: "schedule is required when triggerType is 'cron'",
        path: ['schedule'],
      })
    }
  })

type Input = z.infer<typeof inputSchema>

function buildScheduleUpdates(
  schedule: Input['schedule'],
  triggerType: Input['triggerType'],
  existingDtstart: string | null,
  userTimezone: string,
): Record<string, unknown> {
  if (schedule === undefined) {
    return triggerType === 'on_complete' ? { triggerType: 'on_complete' } : {}
  }
  const { startDate, startTime, ...scheduleRest } = schedule
  const dtstart =
    startDate === undefined
      ? (existingDtstart ?? midnightUtcForTimezone(userTimezone))
      : localDatetimeToUtc(startDate, startTime, userTimezone)
  const compiled = recurrenceSpecToRrule(
    { ...scheduleRest, dtstart } as Omit<Parameters<typeof recurrenceSpecToRrule>[0], 'timezone'>,
    userTimezone,
  )
  return {
    triggerType: 'cron' as const,
    rrule: compiled.rrule,
    dtstartUtc: compiled.dtstartUtc,
    timezone: compiled.timezone,
  }
}

function executeUpdate(userId: string, input: Input, deps: UpdateRecurringTaskDeps): unknown {
  const { recurringTaskId, title, description, priority, status, assignee, labels, schedule, catchUp, triggerType } =
    input
  log.debug({ recurringTaskId }, 'Updating recurring task')

  const existing = deps.getRecurringTask(recurringTaskId)
  if (existing === null) {
    log.warn({ recurringTaskId }, 'Recurring task not found for update')
    return { error: 'Recurring task not found' }
  }

  const userTimezone = getUserTimezoneOrDefault(userId)

  const updated = deps.updateRecurringTask(recurringTaskId, {
    title,
    description,
    priority,
    status,
    assignee,
    labels,
    ...buildScheduleUpdates(schedule, triggerType, existing.dtstartUtc, userTimezone),
    catchUp,
  })

  if (updated === null) {
    log.warn({ recurringTaskId }, 'Recurring task not found for update')
    return { error: 'Recurring task not found' }
  }

  log.info({ id: updated.id, title: updated.title }, 'Recurring task updated via tool')
  return {
    id: updated.id,
    title: updated.title,
    projectId: updated.projectId,
    enabled: updated.enabled,
    nextRun: utcToLocal(updated.nextRun, updated.timezone),
  }
}

export function makeUpdateRecurringTaskTool(
  userId: string,
  deps: UpdateRecurringTaskDeps = defaultDeps,
): ToolSet[string] {
  return tool({
    description:
      'Update a recurring task definition (title, description, priority, assignee, labels, schedule, catch-up setting).',
    inputSchema,
    execute: (input) => {
      try {
        return executeUpdate(userId, input, deps)
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            recurringTaskId: input.recurringTaskId,
            tool: 'update_recurring_task',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
