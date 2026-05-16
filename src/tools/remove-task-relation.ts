// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:remove-task-relation' })

export function makeRemoveTaskRelationTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Remove a relation between two tasks.',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID'),
      relatedTaskId: z.string().describe('Task ID of the related task'),
    }),
    execute: async ({ taskId, relatedTaskId }) => {
      try {
        return await provider.removeRelation!(taskId, relatedTaskId)
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            taskId,
            relatedTaskId,
            tool: 'remove_task_relation',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
