// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { resolveMeReference } from '../identity/resolver.js'
import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:search-tasks' })

export function makeSearchTasksTool(provider: TaskProvider, userId?: string): ToolSet[string] {
  return tool({
    description: 'Search for tasks by keyword. Use this when the user asks about existing tasks.',
    inputSchema: z.object({
      query: z.string().describe('Search keyword or phrase'),
      projectId: z.string().optional().describe('Filter by project ID'),
      assigneeId: z.string().optional().describe('Filter by assignee user ID, or "me" to filter by your own tasks'),
      limit: z.number().int().positive().optional().describe('Maximum number of results to return'),
      offset: z.number().int().min(0).optional().describe('Number of matching tasks to skip before returning results'),
    }),
    execute: async ({ query, projectId, assigneeId, limit, offset }) => {
      try {
        let resolvedAssigneeId = assigneeId

        // Resolve "me" reference using preferredUserIdentifier (same pattern as list_tasks)
        if (assigneeId !== undefined && assigneeId.toLowerCase() === 'me' && userId !== undefined) {
          const identity = await resolveMeReference(userId, provider)
          if (identity.type === 'found') {
            resolvedAssigneeId =
              provider.preferredUserIdentifier === 'login' ? identity.identity.login : identity.identity.userId
            log.debug({ userId, resolvedAssigneeId }, 'Resolved identity for assignee filter')
          }
        }

        const tasks = await provider.searchTasks({
          query,
          projectId,
          assigneeId: resolvedAssigneeId,
          limit,
          offset,
        })
        log.info({ query, assigneeId: resolvedAssigneeId, resultCount: tasks.length }, 'Tasks searched via tool')
        return tasks
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            query,
            tool: 'search_tasks',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
