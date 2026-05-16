// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:list-work' })

export function makeListWorkTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'List all work items (time tracking entries) logged on a task.',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID to list work items for'),
      limit: z.number().int().positive().optional().describe('Maximum number of work items to return'),
      offset: z.number().int().min(0).optional().describe('Number of work items to skip before returning results'),
    }),
    execute: async ({ taskId, limit, offset }) => {
      log.debug({ taskId, limit, offset }, 'list_work called')
      try {
        const result =
          limit !== undefined || offset !== undefined
            ? await provider.listWorkItems!(taskId, { limit, offset })
            : await provider.listWorkItems!(taskId)
        log.info({ taskId, count: result.length }, 'Work items listed')
        return result
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), taskId, limit, offset, tool: 'list_work' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
