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

const log = logger.child({ scope: 'tool:list-attachments' })

export function makeListAttachmentsTool(provider: TaskProvider): Tool {
  return tool({
    description: 'List all attachments on a task.',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID to list attachments for'),
    }),
    execute: async ({ taskId }) => {
      log.debug('list_attachments called')
      try {
        const result = await provider.listAttachments!(taskId)
        log.info({ count: result.length }, 'Attachments listed')
        return result
      } catch (error) {
        log.error(toolFailureMeta('list_attachments', error), 'Tool execution failed')
        throw error
      }
    },
  })
}
