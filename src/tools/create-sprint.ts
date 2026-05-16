// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:create-sprint' })
const isoDatetimeSchema = z.iso.datetime({ offset: true })

export function makeCreateSprintTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description: 'Create a sprint on a YouTrack agile board.',
    inputSchema: z.object({
      agileId: z.string().describe('Agile board ID'),
      name: z.string().describe('Sprint name'),
      goal: z.string().optional().describe('Optional sprint goal'),
      start: isoDatetimeSchema.optional().describe('Sprint start timestamp in ISO-8601 format'),
      finish: isoDatetimeSchema.optional().describe('Sprint finish timestamp in ISO-8601 format'),
      previousSprintId: z.string().optional().describe('Optional previous sprint ID'),
      isDefault: z.boolean().optional().describe('Whether the sprint should become the default sprint'),
    }),
    execute: async ({ agileId, ...params }) => {
      try {
        const sprint = await provider.createSprint!(agileId, params)
        log.info({ agileId, sprintId: sprint.id }, 'Sprint created via tool')
        return sprint
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), agileId, tool: 'create_sprint' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
