// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:update-status' })

export function makeUpdateStatusTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Update an existing status in a project.',
    inputSchema: z
      .object({
        projectId: z.string().describe('Project ID'),
        statusId: z.string().describe('Status ID'),
        name: z.string().optional().describe('New status name'),
        icon: z.string().optional().describe('New icon name'),
        color: z.string().optional().describe('New hex color code'),
        isFinal: z.boolean().optional().describe('Whether this is a final status'),
        confirm: z.boolean().optional().describe('Set to true to confirm changes to shared state bundles'),
      })
      .refine(
        (data) =>
          data.name !== undefined || data.icon !== undefined || data.color !== undefined || data.isFinal !== undefined,
        'At least one field must be provided to update',
      ),
    execute: async ({ projectId, statusId, name, icon, color, isFinal, confirm }) => {
      try {
        const result = await provider.updateStatus!(projectId, statusId, { name, icon, color, isFinal }, confirm)
        if ('status' in result && result.status === 'confirmation_required') {
          log.warn({ projectId, statusId }, 'update_status blocked — shared bundle confirmation required')
          return result
        }
        log.info({ projectId, statusId }, 'Status updated')
        return result
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), projectId, statusId, tool: 'update_status' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
