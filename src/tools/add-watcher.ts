// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { resolveMeReference } from '../identity/resolver.js'
import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:add-watcher' })

export function makeAddWatcherTool(provider: TaskProvider, contextUserId?: string): ToolSet[string] {
  return tool({
    description: 'Add a watcher to a task so the specified user is notified about future updates.',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID to watch'),
      userId: z.string().describe('User ID to add as a watcher'),
    }),
    execute: async ({ taskId, userId: userIdParam }) => {
      try {
        let resolvedUserId = userIdParam
        if (userIdParam.toLowerCase() === 'me' && contextUserId !== undefined) {
          const identity = await resolveMeReference(contextUserId, provider)
          if (identity.type === 'found') {
            resolvedUserId =
              provider.preferredUserIdentifier === 'login' ? identity.identity.login : identity.identity.userId
          } else {
            return {
              status: 'identity_required',
              message: identity.message,
            }
          }
        }

        if (provider.addWatcher === undefined) {
          return { status: 'error', message: 'Provider does not support adding watchers' }
        }

        const result = await provider.addWatcher(taskId, resolvedUserId)
        log.info({ taskId, userId: userIdParam, resolvedUserId }, 'Watcher added via tool')
        return result
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            taskId,
            userId: userIdParam,
            tool: 'add_watcher',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
