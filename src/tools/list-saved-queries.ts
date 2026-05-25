// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:list-saved-queries' })

export function makeListSavedQueriesTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description: 'List saved YouTrack queries available to the current user.',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const queries = await provider.listSavedQueries!()
        log.info({ count: queries.length }, 'Saved queries listed via tool')
        return queries
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            tool: 'list_saved_queries',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
