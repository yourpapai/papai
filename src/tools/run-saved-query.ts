// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:run-saved-query' })

export function makeRunSavedQueryTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description: 'Run one saved YouTrack query and return normalized task search results.',
    inputSchema: z.object({
      queryId: z.string().describe('Saved query ID'),
    }),
    execute: async ({ queryId }) => {
      try {
        const tasks = await provider.runSavedQuery!(queryId)
        log.info({ queryId, count: tasks.length }, 'Saved query executed via tool')
        return tasks
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), queryId, tool: 'run_saved_query' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
