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

const log = logger.child({ scope: 'tool:add-comment' })

export function makeAddCommentTool(provider: TaskProvider): Tool {
  return tool({
    description: 'Add a comment to a task.',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID'),
      comment: z.string().describe('Comment text'),
    }),
    execute: async ({ taskId, comment }) => {
      try {
        return await provider.addComment!(taskId, comment)
      } catch (error) {
        log.error(toolFailureMeta('add_comment', error), 'Tool execution failed')
        throw error
      }
    },
  })
}
