// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:get-comments' })

export function makeGetCommentsTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Get all comments on a task.',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID'),
      limit: z.number().int().positive().optional().describe('Maximum number of comments to return'),
      offset: z.number().int().min(0).optional().describe('Number of comments to skip before returning results'),
    }),
    execute: async ({ taskId, limit, offset }) => {
      try {
        return await provider.getComments!(taskId, { limit, offset })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), taskId, tool: 'get_comments' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
