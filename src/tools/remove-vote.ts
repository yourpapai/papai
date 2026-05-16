// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:remove-vote' })

export function makeRemoveVoteTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Remove your vote from a task when it should no longer count toward priority.',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID to remove your vote from'),
    }),
    execute: async ({ taskId }) => {
      try {
        const result = await provider.removeVote!(taskId)
        log.info({ taskId }, 'Vote removed via tool')
        return result
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), taskId, tool: 'remove_vote' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
