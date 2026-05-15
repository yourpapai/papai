// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:list-attachments' })

export function makeListAttachmentsTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'List all attachments on a task.',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID to list attachments for'),
    }),
    execute: async ({ taskId }) => {
      log.debug({ taskId }, 'list_attachments called')
      try {
        const result = await provider.listAttachments!(taskId)
        log.info({ taskId, count: result.length }, 'Attachments listed')
        return result
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), taskId, tool: 'list_attachments' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
