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

const log = logger.child({ scope: 'tool:list-watchers' })

export function makeListWatchersTool(provider: TaskProvider): Tool {
  return tool({
    description: 'List the watchers on a task so you can see who is currently following updates.',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID whose watchers should be listed'),
    }),
    execute: async ({ taskId }) => {
      try {
        const users = await provider.listWatchers!(taskId)
        log.info({ count: users.length }, 'Watchers listed via tool')
        return users
      } catch (error) {
        log.error(toolFailureMeta('list_watchers', error), 'Tool execution failed')
        throw error
      }
    },
  })
}
