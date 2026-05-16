// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import { deleteRecurringTask as defaultDeleteRecurringTask } from '../recurring.js'

const log = logger.child({ scope: 'tool:delete-recurring-task' })

export interface DeleteRecurringTaskDeps {
  deleteRecurringTask: (id: string) => boolean
}

const defaultDeps: DeleteRecurringTaskDeps = {
  deleteRecurringTask: (...args) => defaultDeleteRecurringTask(...args),
}

export function makeDeleteRecurringTaskTool(deps: DeleteRecurringTaskDeps = defaultDeps): ToolSet[string] {
  return tool({
    description: 'Permanently cancel/stop a recurring task series. No further occurrences will be created.',
    inputSchema: z.object({
      recurringTaskId: z.string().describe('ID of the recurring task definition to permanently delete'),
      confidence: z.number().min(0).max(1).describe('Confidence (0–1) that user wants this. Set 1.0 if confirmed.'),
    }),
    execute: ({ recurringTaskId, confidence }) => {
      try {
        log.debug({ recurringTaskId, confidence }, 'Deleting recurring task')

        if (confidence < 0.85) {
          return {
            status: 'confirmation_required',
            message: 'Are you sure you want to permanently stop this recurring task series?',
          }
        }

        const deleted = deps.deleteRecurringTask(recurringTaskId)
        if (!deleted) {
          log.warn({ recurringTaskId }, 'Recurring task not found for deletion')
          return { error: 'Recurring task not found' }
        }

        log.info({ recurringTaskId }, 'Recurring task deleted via tool')
        return { id: recurringTaskId, status: 'deleted', message: 'Recurring task series permanently stopped.' }
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            recurringTaskId,
            tool: 'delete_recurring_task',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
