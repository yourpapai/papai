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

const log = logger.child({ scope: 'tool:remove-watcher' })

export function makeRemoveWatcherTool(provider: TaskProvider, contextUserId?: string): ToolSet[string] {
  return tool({
    description: 'Remove a watcher from a task when they should no longer follow updates.',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID that currently has the watcher'),
      userId: z.string().describe('User ID to remove from the watcher list'),
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

        if (provider.removeWatcher === undefined) {
          return { status: 'error', message: 'Provider does not support removing watchers' }
        }

        const result = await provider.removeWatcher(taskId, resolvedUserId)
        log.info({ taskId, userId: userIdParam, resolvedUserId }, 'Watcher removed via tool')
        return result
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            taskId,
            userId: userIdParam,
            tool: 'remove_watcher',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
