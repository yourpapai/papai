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

const log = logger.child({ scope: 'tool:remove-work' })

export function makeRemoveWorkTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description:
      'Remove a work item (time tracking entry) from a task permanently. This is a destructive action that requires confirmation.',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID that owns the work item'),
      workItemId: z.string().describe('Work item ID to remove'),
      label: z
        .string()
        .optional()
        .describe('Human-readable description for the confirmation message (e.g. "2h on 2024-01-15")'),
      confidence: confidenceField,
    }),
    execute: async ({ taskId, workItemId, label, confidence }) => {
      log.debug({ taskId, workItemId, confidence }, 'remove_work called')
      const gate = checkConfidence(confidence, `Remove work item "${label ?? workItemId}"`)
      if (gate !== null) {
        log.warn({ taskId, workItemId, confidence }, 'remove_work blocked — confirmation required')
        return gate
      }
      try {
        const result = await provider.deleteWorkItem!(taskId, workItemId)
        log.info({ taskId, workItemId }, 'Work item removed')
        return result
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            taskId,
            workItemId,
            tool: 'remove_work',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
