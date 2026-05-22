// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { SetTaskVisibilityParams, TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:set-visibility' })

const setVisibilityInputSchema = z
  .object({
    taskId: z.string().describe('Task ID whose visibility should be changed'),
    visibility: z
      .enum(['public', 'restricted'])
      .describe('Whether the task should be public to everyone or restricted to specific users or groups'),
    userIds: z.array(z.string()).optional().describe('User IDs allowed to see the task when visibility is restricted'),
    groupIds: z
      .array(z.string())
      .optional()
      .describe('Group IDs allowed to see the task when visibility is restricted'),
  })
  .superRefine(({ visibility, userIds, groupIds }, context) => {
    if (visibility === 'restricted' && (userIds?.length ?? 0) === 0 && (groupIds?.length ?? 0) === 0) {
      context.addIssue({
        code: 'custom',
        message: 'Restricted visibility requires at least one userId or groupId',
        path: ['visibility'],
      })
    }
  })

function toVisibilityParams(input: z.infer<typeof setVisibilityInputSchema>): SetTaskVisibilityParams {
  if (input.visibility === 'public') {
    return { kind: 'public' }
  }

  const [firstUserId, ...remainingUserIds] = input.userIds ?? []
  if (firstUserId !== undefined) {
    return {
      kind: 'restricted',
      userIds: [firstUserId, ...remainingUserIds],
      groupIds: input.groupIds,
    }
  }

  const [firstGroupId, ...remainingGroupIds] = input.groupIds ?? []
  if (firstGroupId !== undefined) {
    return {
      kind: 'restricted',
      userIds: input.userIds,
      groupIds: [firstGroupId, ...remainingGroupIds],
    }
  }

  throw new Error('Restricted visibility requires at least one userId or groupId')
}

export function makeSetVisibilityTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Set task visibility to public or restrict it to selected users and groups.',
    inputSchema: setVisibilityInputSchema,
    execute: async (input) => {
      const { taskId } = input
      const visibilityParams = toVisibilityParams(input)
      try {
        const result = await provider.setVisibility!(taskId, visibilityParams)
        log.info({ taskId, visibility: visibilityParams.kind }, 'Task visibility updated via tool')
        return result
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            taskId,
            visibility: visibilityParams.kind,
            tool: 'set_visibility',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
