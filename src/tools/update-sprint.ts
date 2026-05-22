// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:update-sprint' })
const isoDatetimeSchema = z.iso.datetime({ offset: true })

export function makeUpdateSprintTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description: 'Update a sprint on a YouTrack agile board.',
    inputSchema: z.object({
      agileId: z.string().describe('Agile board ID'),
      sprintId: z.string().describe('Sprint ID'),
      name: z.string().optional().describe('Updated sprint name'),
      goal: z.string().nullable().optional().describe('Updated sprint goal, or null to clear it'),
      start: isoDatetimeSchema
        .nullable()
        .optional()
        .describe('Updated sprint start timestamp in ISO-8601 format, or null to clear it'),
      finish: isoDatetimeSchema
        .nullable()
        .optional()
        .describe('Updated sprint finish timestamp in ISO-8601 format, or null to clear it'),
      previousSprintId: z.string().nullable().optional().describe('Updated previous sprint ID, or null to clear it'),
      isDefault: z.boolean().optional().describe('Whether the sprint should become the default sprint'),
      archived: z.boolean().optional().describe('Whether the sprint should be archived'),
    }),
    execute: async ({ agileId, sprintId, ...params }) => {
      try {
        const sprint = await provider.updateSprint!(agileId, sprintId, params)
        log.info({ agileId, sprintId: sprint.id }, 'Sprint updated via tool')
        return sprint
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            agileId,
            sprintId,
            tool: 'update_sprint',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
