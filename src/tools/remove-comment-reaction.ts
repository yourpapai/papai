// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:remove-comment-reaction' })

export function makeRemoveCommentReactionTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Remove a reaction from a task comment.',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID containing the comment'),
      commentId: z.string().describe('Comment ID containing the reaction'),
      reactionId: z.string().describe('Reaction ID to remove'),
    }),
    execute: async ({ taskId, commentId, reactionId }) => {
      try {
        const result = await provider.removeCommentReaction!(taskId, commentId, reactionId)
        log.info({ taskId, commentId, reactionId }, 'Comment reaction removed via tool')
        return result
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            taskId,
            commentId,
            reactionId,
            tool: 'remove_comment_reaction',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
