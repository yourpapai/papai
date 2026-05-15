// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:count-tasks' })

export function makeCountTasksTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Count tasks matching a query. Returns the total number of matching tasks.',
    inputSchema: z.object({
      query: z.string().describe('Search query string to match tasks, e.g. "State: Open" or "assigned to: me"'),
      projectId: z.string().optional().describe('Optional project ID to scope the query'),
    }),
    execute: async ({ query, projectId }) => {
      try {
        if (provider.countTasks === undefined) {
          throw new Error('countTasks not supported by this provider')
        }
        const count = await provider.countTasks({ query, projectId })
        log.info({ count, query, projectId }, 'Tasks counted')
        return { count, query, projectId }
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), tool: 'count_tasks' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
