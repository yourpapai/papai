// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import { pauseRecurringTask as defaultPauseRecurringTask } from '../recurring.js'
import type { RecurringTaskRecord } from '../types/recurring.js'

const log = logger.child({ scope: 'tool:pause-recurring-task' })

export interface PauseRecurringTaskDeps {
  pauseRecurringTask: (id: string) => RecurringTaskRecord | null
}

const defaultDeps: PauseRecurringTaskDeps = {
  pauseRecurringTask: (...args) => defaultPauseRecurringTask(...args),
}

export function makePauseRecurringTaskTool(deps: PauseRecurringTaskDeps = defaultDeps): ToolSet[string] {
  return tool({
    description: 'Pause a recurring task series. No further occurrences are created until explicitly resumed.',
    inputSchema: z.object({
      recurringTaskId: z.string().describe('ID of the recurring task definition to pause'),
    }),
    execute: ({ recurringTaskId }) => {
      try {
        log.debug({ recurringTaskId }, 'Pausing recurring task')
        const paused = deps.pauseRecurringTask(recurringTaskId)

        if (paused === null) {
          log.warn({ recurringTaskId }, 'Recurring task not found for pause')
          return { error: 'Recurring task not found' }
        }

        log.info({ id: paused.id, title: paused.title }, 'Recurring task paused via tool')
        return { id: paused.id, title: paused.title, enabled: paused.enabled, status: 'paused' }
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            recurringTaskId,
            tool: 'pause_recurring_task',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
