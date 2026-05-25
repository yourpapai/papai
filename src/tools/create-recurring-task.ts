// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { rruleInputSchema } from '../deferred-prompts/types.js'
import { logger } from '../logger.js'
import { describeCompiledRecurrence, recurrenceSpecToRrule, type CompiledRecurrence } from '../recurrence.js'
import { createRecurringTask as defaultCreateRecurringTask } from '../recurring.js'
import type { RecurrenceSpec } from '../types/recurrence.js'
import type { RecurringTaskInput, RecurringTaskRecord, TriggerType } from '../types/recurring.js'
import { getUserTimezoneOrDefault } from '../utils/config-timezone.js'
import { localDatetimeToUtc, midnightUtcForTimezone, utcToLocal } from '../utils/datetime.js'

export interface CreateRecurringTaskDeps {
  createRecurringTask: (input: RecurringTaskInput) => RecurringTaskRecord
}

const defaultDeps: CreateRecurringTaskDeps = {
  createRecurringTask: defaultCreateRecurringTask,
}

const log = logger.child({ scope: 'tool:create-recurring-task' })

const inputSchema = z
  .object({
    title: z.string().describe('Title for each generated task'),
    projectId: z.string().describe('Project ID — call list_projects first to obtain this'),
    description: z.string().optional().describe('Description for each generated task'),
    priority: z.enum(['no-priority', 'low', 'medium', 'high', 'urgent']).optional().describe('Priority level'),
    status: z.string().optional().describe("Initial status for each generated task (e.g. 'to-do')"),
    assignee: z.string().optional().describe('Assignee for each generated task'),
    labels: z.array(z.string()).optional().describe('Label IDs to apply to each generated task'),
    triggerType: z
      .enum(['cron', 'on_complete'])
      .describe("'cron' for fixed schedule, 'on_complete' for after-completion"),
    schedule: rruleInputSchema
      .optional()
      .describe("Schedule for 'cron' triggerType in user's local time — the tool handles timezone internally."),
    catchUp: z.boolean().optional().describe('Create missed occurrences on resume. Default: false'),
  })
  .superRefine(({ triggerType, schedule }, ctx) => {
    if (triggerType === 'cron' && schedule === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: "schedule is required when triggerType is 'cron'",
        path: ['schedule'],
      })
    }
    if (triggerType === 'on_complete' && schedule !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: "schedule must not be provided when triggerType is 'on_complete'",
        path: ['schedule'],
      })
    }
  })

type Input = z.infer<typeof inputSchema>

function executeCreate(userId: string, input: Input, deps: CreateRecurringTaskDeps): unknown {
  log.debug({ userId, title: input.title, triggerType: input.triggerType }, 'Creating recurring task')

  const userTimezone = getUserTimezoneOrDefault(userId)

  let compiled: CompiledRecurrence | undefined
  if (input.triggerType === 'cron' && input.schedule !== undefined) {
    const { startDate, startTime, ...scheduleRest } = input.schedule
    const dtstart =
      startDate === undefined
        ? midnightUtcForTimezone(userTimezone)
        : localDatetimeToUtc(startDate, startTime, userTimezone)
    compiled = recurrenceSpecToRrule({ ...scheduleRest, dtstart } as Omit<RecurrenceSpec, 'timezone'>, userTimezone)
  }

  const record = deps.createRecurringTask({
    userId,
    title: input.title,
    projectId: input.projectId,
    description: input.description,
    priority: input.priority,
    status: input.status,
    assignee: input.assignee,
    labels: input.labels,
    triggerType: input.triggerType satisfies TriggerType,
    rrule: compiled?.rrule,
    dtstartUtc: compiled?.dtstartUtc,
    catchUp: input.catchUp,
    timezone: userTimezone,
  })

  const result = buildRecurringTaskResult(record)
  log.info({ id: record.id, title: input.title, schedule: result.schedule }, 'Recurring task created via tool')
  return result
}

function buildRecurringTaskResult(record: RecurringTaskRecord): {
  id: string
  title: string
  projectId: string
  triggerType: TriggerType
  schedule: string
  nextRun: string | null | undefined
  enabled: boolean
} {
  const schedule =
    record.triggerType === 'cron' && record.rrule !== null && record.dtstartUtc !== null
      ? describeCompiledRecurrence({
          rrule: record.rrule,
          dtstartUtc: record.dtstartUtc,
          timezone: record.timezone,
        })
      : 'after completion of current instance'

  return {
    id: record.id,
    title: record.title,
    projectId: record.projectId,
    triggerType: record.triggerType,
    schedule,
    nextRun: utcToLocal(record.nextRun, record.timezone),
    enabled: record.enabled,
  }
}

export function makeCreateRecurringTaskTool(
  userId: string,
  deps: CreateRecurringTaskDeps = defaultDeps,
): ToolSet[string] {
  return tool({
    description:
      'Set up a recurring task that is automatically created on a schedule (cron) or after completion. Call list_projects first.',
    inputSchema,
    execute: (input) => {
      try {
        return executeCreate(userId, input, deps)
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            tool: 'create_recurring_task',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
