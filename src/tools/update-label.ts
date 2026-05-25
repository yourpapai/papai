// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:update-label' })

export function makeUpdateLabelTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Update an existing label.',
    inputSchema: z
      .object({
        labelId: z.string().describe('Label ID'),
        name: z.string().optional().describe('New label name'),
        color: z.string().optional().describe('New label color (hex)'),
      })
      .refine(
        (data) => data.name !== undefined || data.color !== undefined,
        'At least one of name or color must be provided',
      ),
    execute: async ({ labelId, name, color }) => {
      try {
        return await provider.updateLabel!(labelId, { name, color })
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            labelId,
            tool: 'update_label',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
