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

const log = logger.child({ scope: 'tool:update-task-relation' })

export function makeUpdateTaskRelationTool(provider: TaskProvider): Tool {
  return tool({
    description: 'Update the type of an existing relation between two tasks.',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID'),
      relatedTaskId: z.string().describe('Task ID of the related task'),
      type: z
        .enum(['blocks', 'duplicate', 'related', 'parent'])
        .describe(
          "'blocks': this task blocks the other; 'duplicate': marks as duplicate; 'related': general; 'parent': this task is a child of the related task",
        ),
    }),
    execute: async ({ taskId, relatedTaskId, type }) => {
      try {
        return await provider.updateRelation!(taskId, relatedTaskId, type)
      } catch (error) {
        log.error(toolFailureMeta('update_task_relation', error), 'Tool execution failed')
        throw error
      }
    },
  })
}
