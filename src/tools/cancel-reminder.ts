// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { executeCancel } from '../deferred-prompts/tool-handlers.js'
import { logger } from '../logger.js'
import { toolFailureMeta } from './tool-logging.js'

const log = logger.child({ scope: 'tool:cancel-reminder' })

export function makeCancelReminderTool(userId: string): Tool {
  return tool({
    description: 'Cancel a reminder or alert by ID.',
    inputSchema: z.object({ id: z.string().describe('The reminder or alert ID to cancel') }),
    execute: (input: { id: string }) => {
      try {
        return executeCancel(userId, input)
      } catch (error) {
        log.error(toolFailureMeta('cancel_reminder', error), 'Tool execution failed')
        throw error
      }
    },
  })
}
