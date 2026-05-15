// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:update-work' })

export function makeUpdateWorkTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Update an existing work item (time tracking entry) on a task.',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID that owns the work item'),
      workItemId: z.string().describe('Work item ID to update'),
      duration: z
        .string()
        .optional()
        .describe('New duration in natural language or ISO-8601 format, e.g. "3h" or "PT3H"'),
      date: z.string().optional().describe('New ISO date string (YYYY-MM-DD)'),
      description: z.string().optional().describe('New description for the work item'),
      type: z.string().optional().describe('New work item type name or ID (provider-specific)'),
    }),
    execute: async ({ taskId, workItemId, duration, date, description, type }) => {
      log.debug({ taskId, workItemId, duration, date }, 'update_work called')
      try {
        const result = await provider.updateWorkItem!(taskId, workItemId, { duration, date, description, type })
        log.info({ taskId, workItemId }, 'Work item updated')
        return result
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), taskId, workItemId, tool: 'update_work' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
