// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:reorder-statuses' })

export function makeReorderStatusesTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Reorder statuses in a project. Provide the new order of statuses with their positions.',
    inputSchema: z.object({
      projectId: z.string().describe('Project ID'),
      statuses: z
        .array(
          z.object({
            id: z.string().describe('Status ID'),
            position: z.number().describe('New position (0-indexed)'),
          }),
        )
        .describe('Array of statuses with their new positions'),
      confirm: z.boolean().optional().describe('Set to true to confirm changes to shared state bundles'),
    }),
    execute: async ({ projectId, statuses, confirm }) => {
      try {
        const result = await provider.reorderStatuses!(projectId, statuses, confirm)
        if (result !== undefined && 'status' in result && result.status === 'confirmation_required') {
          log.warn({ projectId }, 'reorder_statuses blocked — shared bundle confirmation required')
          return result
        }
        log.info({ projectId, statusCount: statuses.length }, 'Statuses reordered via tool')
        return { success: true }
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            projectId,
            tool: 'reorder_statuses',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
