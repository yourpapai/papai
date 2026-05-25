// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:update-comment' })

export function makeUpdateCommentTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Update an existing comment on a task.',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID the comment belongs to'),
      activityId: z.string().describe('Activity/comment ID'),
      comment: z.string().describe('New comment text'),
    }),
    execute: async ({ taskId, activityId, comment }) => {
      try {
        return await provider.updateComment!({ taskId, commentId: activityId, body: comment })
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            activityId,
            tool: 'update_comment',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
