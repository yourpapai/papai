// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:list-statuses' })

export function makeListStatusesTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'List all statuses in a project. Use this to see available statuses before updating a task status.',
    inputSchema: z.object({
      projectId: z.string().describe('Project ID'),
    }),
    execute: async ({ projectId }) => {
      try {
        return await provider.listStatuses!(projectId)
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            projectId,
            tool: 'list_statuses',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
