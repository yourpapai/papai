// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'
import { toolFailureMeta } from './tool-logging.js'

const log = logger.child({ scope: 'tool:assign-task-to-sprint' })

export function makeAssignTaskToSprintTool(provider: Readonly<TaskProvider>): Tool {
  return tool({
    description: 'Assign a task to a specific sprint.',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID'),
      sprintId: z.string().describe('Sprint ID'),
    }),
    execute: async ({ taskId, sprintId }) => {
      try {
        const result = await provider.assignTaskToSprint!(taskId, sprintId)
        log.info('Task assigned to sprint via tool')
        return result
      } catch (error) {
        log.error(toolFailureMeta('assign_task_to_sprint', error), 'Tool execution failed')
        throw error
      }
    },
  })
}
