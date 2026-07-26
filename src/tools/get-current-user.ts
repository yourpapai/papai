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

const log = logger.child({ scope: 'tool:get-current-user' })

export function makeGetCurrentUserTool(provider: Readonly<TaskProvider>): Tool {
  return tool({
    description: 'Get the current authenticated user from the task provider as a normalized provider user.',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const user = await provider.getCurrentUser!()
        log.info('Current user fetched via tool')
        return user
      } catch (error) {
        log.error(toolFailureMeta('get_current_user', error), 'Tool execution failed')
        throw error
      }
    },
  })
}
