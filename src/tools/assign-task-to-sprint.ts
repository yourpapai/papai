// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:assign-task-to-sprint' })

export function makeAssignTaskToSprintTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description: 'Assign a task to a specific sprint.',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID'),
      sprintId: z.string().describe('Sprint ID'),
    }),
    execute: async ({ taskId, sprintId }) => {
      try {
        const result = await provider.assignTaskToSprint!(taskId, sprintId)
        log.info({ taskId, sprintId }, 'Task assigned to sprint via tool')
        return result
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            taskId,
            sprintId,
            tool: 'assign_task_to_sprint',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
