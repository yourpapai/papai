// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:create-status' })

export function makeCreateStatusTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Create a new status in a project.',
    inputSchema: z.object({
      projectId: z.string().describe('Project ID'),
      name: z.string().describe('Status name (e.g., "In Progress", "Review", "Done")'),
      icon: z.string().optional().describe('Optional icon name for the status'),
      color: z.string().optional().describe('Optional hex color code (e.g., "#ff0000")'),
      isFinal: z.boolean().optional().describe('Whether this is a final/terminal status (default: false)'),
      confirm: z.boolean().optional().describe('Set to true to confirm changes to shared state bundles'),
    }),
    execute: async ({ projectId, name, icon, color, isFinal, confirm }) => {
      try {
        const result = await provider.createStatus!(projectId, { name, icon, color, isFinal }, confirm)
        if ('status' in result && result.status === 'confirmation_required') {
          log.warn({ projectId, name }, 'create_status blocked — shared bundle confirmation required')
          return result
        }
        log.info({ projectId, name }, 'Status created')
        return result
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), projectId, name, tool: 'create_status' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
