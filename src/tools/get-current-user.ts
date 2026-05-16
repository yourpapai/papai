// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:get-current-user' })

export function makeGetCurrentUserTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description: 'Get the current authenticated user from the task provider as a normalized provider user.',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const user = await provider.getCurrentUser!()
        log.info({ userId: user.id, login: user.login }, 'Current user fetched via tool')
        return user
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), tool: 'get_current_user' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
