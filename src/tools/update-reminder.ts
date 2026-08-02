// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { executeUpdate, type UpdateInput } from '../deferred-prompts/tool-handlers.js'
import {
  alertConditionSchema,
  cooldownSchema,
  executionInputSchema,
  scheduleSchema,
} from '../deferred-prompts/types.js'
import { logger } from '../logger.js'
import { toolFailureMeta } from './tool-logging.js'

const log = logger.child({ scope: 'tool:update-reminder' })

export function makeUpdateReminderTool(userId: string): Tool {
  return tool({
    description:
      'Update a reminder or alert. For reminders, update the prompt text or schedule. For alerts, update the prompt text, condition, or cooldown.',
    inputSchema: z.object({
      id: z.string().describe('The reminder or alert ID'),
      prompt: z.string().optional().describe('Updated action text'),
      schedule: scheduleSchema.optional().describe('Updated time-based trigger'),
      condition: alertConditionSchema.optional().describe('Updated event-based trigger condition'),
      cooldown_minutes: cooldownSchema,
      execution: executionInputSchema,
    }),
    execute: (input: UpdateInput) => {
      try {
        return executeUpdate(userId, input)
      } catch (error) {
        log.error(toolFailureMeta('update_reminder', error), 'Tool execution failed')
        throw error
      }
    },
  })
}
