// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import { skipNextOccurrence as defaultSkipNextOccurrence } from '../recurring.js'
import type { RecurringTaskRecord } from '../types/recurring.js'
import { utcToLocal } from '../utils/datetime.js'

const log = logger.child({ scope: 'tool:skip-recurring-task' })

export interface SkipRecurringTaskDeps {
  skipNextOccurrence: (id: string) => RecurringTaskRecord | null
}

const defaultDeps: SkipRecurringTaskDeps = {
  skipNextOccurrence: (...args) => defaultSkipNextOccurrence(...args),
}

export function makeSkipRecurringTaskTool(deps: SkipRecurringTaskDeps = defaultDeps): ToolSet[string] {
  return tool({
    description:
      'Skip the next occurrence of a recurring task series. The series continues normally after the skipped occurrence.',
    inputSchema: z.object({
      recurringTaskId: z.string().describe('ID of the recurring task definition whose next occurrence to skip'),
    }),
    execute: ({ recurringTaskId }) => {
      try {
        log.debug({ recurringTaskId }, 'Skipping next recurring task occurrence')
        const result = deps.skipNextOccurrence(recurringTaskId)

        if (result === null) {
          log.warn({ recurringTaskId }, 'Recurring task not found for skip')
          return { error: 'Recurring task not found' }
        }

        log.info({ id: result.id, title: result.title, nextRun: result.nextRun }, 'Next occurrence skipped via tool')
        return {
          id: result.id,
          title: result.title,
          nextRun: utcToLocal(result.nextRun, result.timezone),
          status: 'skipped — next occurrence updated',
        }
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            recurringTaskId,
            tool: 'skip_recurring_task',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
