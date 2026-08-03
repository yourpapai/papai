// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { executeGet } from '../deferred-prompts/tool-handlers.js'
import { logger } from '../logger.js'
import { toolFailureMeta } from './tool-logging.js'

const log = logger.child({ scope: 'tool:get-reminder' })

export function makeGetReminderTool(userId: string): Tool {
  return tool({
    description: 'Get full details of a reminder or alert by ID.',
    inputSchema: z.object({ id: z.string().describe('The reminder or alert ID') }),
    execute: (input: { id: string }) => {
      try {
        return executeGet(userId, input)
      } catch (error) {
        log.error(toolFailureMeta('get_reminder', error), 'Tool execution failed')
        throw error
      }
    },
  })
}
