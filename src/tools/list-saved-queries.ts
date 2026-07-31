// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'
import { toolFailureMeta } from './tool-logging.js'

const log = logger.child({ scope: 'tool:list-saved-queries' })

export function makeListSavedQueriesTool(provider: Readonly<TaskProvider>): Tool {
  return tool({
    description: 'List saved YouTrack queries available to the current user.',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const queries = await provider.listSavedQueries!()
        log.info({ count: queries.length }, 'Saved queries listed via tool')
        return queries
      } catch (error) {
        log.error(toolFailureMeta('list_saved_queries', error), 'Tool execution failed')
        throw error
      }
    },
  })
}
