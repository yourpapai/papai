// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:get-task-history' })

const isoDatetimeSchema = z.iso
  .datetime({ offset: true })
  .refine((value) => Number.isFinite(Date.parse(value)), 'Expected an ISO datetime with timezone information')

export function makeGetTaskHistoryTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description:
      'Read the activity history for a task, including comments, field changes, links, and visibility changes.',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID'),
      categories: z.array(z.string()).optional().describe('Optional YouTrack activity category names'),
      limit: z.number().int().positive().optional().describe('Maximum number of activity items to return'),
      offset: z.number().int().min(0).optional().describe('Number of activity items to skip'),
      reverse: z.boolean().optional().describe('Whether to return history in reverse chronological order'),
      start: isoDatetimeSchema.optional().describe('Optional inclusive start timestamp in ISO-8601 format'),
      end: isoDatetimeSchema.optional().describe('Optional inclusive end timestamp in ISO-8601 format'),
      author: z.string().optional().describe('Optional author login or user ID filter'),
    }),
    execute: async ({ taskId, ...params }) => {
      try {
        const history = await provider.getTaskHistory!(taskId, params)
        log.info({ taskId, count: history.length }, 'Task history fetched via tool')
        return history
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            taskId,
            tool: 'get_task_history',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
