// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:log-work' })

export function makeLogWorkTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Log time worked on a task (create a work item / time tracking entry).',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID to log work against'),
      duration: z
        .string()
        .describe('Time spent, in natural language or ISO-8601 duration format, e.g. "2h 30m", "1h", or "PT2H30M"'),
      date: z
        .string()
        .optional()
        .describe('ISO date string (YYYY-MM-DD) for when the work was done. Defaults to today.'),
      description: z.string().optional().describe('Optional description of the work performed'),
      type: z.string().optional().describe('Work item type name or ID (provider-specific)'),
      author: z.string().optional().describe('Author login. Defaults to the authenticated user.'),
    }),
    execute: async ({ taskId, duration, date, description, type, author }) => {
      log.debug({ taskId, duration, date }, 'log_work called')
      try {
        const result = await provider.createWorkItem!(taskId, {
          duration,
          date,
          description,
          type,
          author,
        })
        log.info({ taskId, workItemId: result.id, duration }, 'Work item created')
        return result
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            taskId,
            tool: 'log_work',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
