// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { getConfig } from '../config.js'
import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:get-task' })

export function makeGetTaskTool(
  provider: Readonly<TaskProvider>,
  userId?: string,
  storageContextId?: string,
): ToolSet[string] {
  return tool({
    description:
      'Fetch complete details of a single task including description, status, priority, assignee, due date, and relations. For a full picture including comments, also call get_comments with the same task ID.',
    inputSchema: z.object({ taskId: z.string().describe('Task ID') }),
    execute: async ({ taskId }) => {
      try {
        const task = await provider.getTask(taskId)
        log.info({ taskId }, 'Task fetched via tool')
        // NI2 Fix: Use storageContextId for config lookup (per-user config stored there)
        // Falls back to userId for backwards compatibility, then UTC
        const configKey = storageContextId ?? userId
        const timezone = configKey === undefined ? 'UTC' : (getConfig(configKey, 'timezone') ?? 'UTC')
        return { ...task, dueDate: provider.formatDueDateOutput(task.dueDate, timezone) }
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), taskId, tool: 'get_task' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
