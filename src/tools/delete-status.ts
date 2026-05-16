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

const log = logger.child({ scope: 'tool:delete-status' })

export function makeDeleteStatusTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Delete a status from a project.',
    inputSchema: z.object({
      projectId: z.string().describe('Project ID'),
      statusId: z.string().describe('Status ID to delete'),
      label: z
        .string()
        .optional()
        .describe('Human-readable status name for the confirmation message (e.g. "In Progress")'),
      confidence: confidenceField,
      confirm: z.boolean().optional().describe('Set to true to confirm changes to shared state bundles'),
    }),
    execute: async ({ projectId, statusId, label, confidence, confirm }) => {
      log.debug({ projectId, statusId, confidence, confirm }, 'delete_status called')
      const gate = checkConfidence(confidence, `Delete status "${label ?? statusId}"`)
      if (gate !== null) {
        log.warn({ projectId, statusId, confidence }, 'delete_status blocked — confirmation required')
        return gate
      }
      try {
        const result = await provider.deleteStatus!(projectId, statusId, confirm)
        if ('status' in result && result.status === 'confirmation_required') {
          log.warn({ projectId, statusId }, 'delete_status blocked — shared bundle confirmation required')
          return result
        }
        log.info({ projectId, statusId }, 'Status deleted')
        return result
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), projectId, statusId, tool: 'delete_status' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
