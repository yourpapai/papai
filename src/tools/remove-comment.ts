// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:remove-comment' })

export function makeRemoveCommentTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Remove a comment from a task.',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID containing the comment'),
      commentId: z.string().describe('Comment ID to remove'),
    }),
    execute: async ({ taskId, commentId }) => {
      try {
        return await provider.removeComment!({ taskId, commentId })
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            taskId,
            commentId,
            tool: 'remove_comment',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
