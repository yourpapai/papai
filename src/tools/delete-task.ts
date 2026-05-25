// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'
import { checkConfidence, confidenceField } from './confirmation-gate.js'

const log = logger.child({ scope: 'tool:delete-task' })

export function makeDeleteTaskTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Delete a task permanently. This is a destructive action that requires confirmation.',
    inputSchema: z.object({
      taskId: z.string().describe('The task ID to delete'),
      label: z
        .string()
        .optional()
        .describe('Human-readable task title for the confirmation message (e.g. "Fix login bug")'),
      confidence: confidenceField,
    }),
    execute: async ({ taskId, label, confidence }) => {
      log.debug({ taskId, confidence }, 'delete_task called')
      const gate = checkConfidence(confidence, `Delete "${label ?? taskId}"`)
      if (gate !== null) {
        log.warn({ taskId, confidence }, 'delete_task blocked — confirmation required')
        return gate
      }
      try {
        return await provider.deleteTask!(taskId)
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            taskId,
            tool: 'delete_task',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
