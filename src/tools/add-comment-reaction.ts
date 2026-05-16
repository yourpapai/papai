// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:add-comment-reaction' })

export function makeAddCommentReactionTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Add a reaction to a task comment.',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID containing the comment'),
      commentId: z.string().describe('Comment ID to react to'),
      reaction: z.string().describe('Reaction name or emoji identifier to add'),
    }),
    execute: async ({ taskId, commentId, reaction }) => {
      try {
        const result = await provider.addCommentReaction!(taskId, commentId, reaction)
        log.info({ taskId, commentId, reaction }, 'Comment reaction added via tool')
        return result
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            taskId,
            commentId,
            reaction,
            tool: 'add_comment_reaction',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
