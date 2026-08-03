// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { executeList, type ListInput } from '../deferred-prompts/tool-handlers.js'
import { logger } from '../logger.js'
import { toolFailureMeta } from './tool-logging.js'

const log = logger.child({ scope: 'tool:list-reminders' })

export function makeListRemindersTool(userId: string): Tool {
  return tool({
    description: "List the user's active reminders and alerts. Optionally filter by type or status.",
    inputSchema: z.object({
      type: z.enum(['scheduled', 'alert']).optional().describe('Filter by type: scheduled (reminder) or alert'),
      status: z.enum(['active', 'completed', 'cancelled']).optional().describe('Filter by status'),
    }),
    execute: (input: ListInput) => {
      try {
        return executeList(userId, input)
      } catch (error) {
        log.error(toolFailureMeta('list_reminders', error), 'Tool execution failed')
        throw error
      }
    },
  })
}
