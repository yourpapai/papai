// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { executeUpdate, type UpdateInput } from '../deferred-prompts/tool-handlers.js'
import {
  alertConditionSchema,
  cooldownSchema,
  executionInputSchema,
  scheduleSchema,
} from '../deferred-prompts/types.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:update-deferred-prompt' })

export function makeUpdateDeferredPromptTool(userId: string): ToolSet[string] {
  return tool({
    description:
      'Update a deferred prompt. For scheduled prompts, update prompt text or schedule. For alerts, update prompt text, condition, or cooldown.',
    inputSchema: z.object({
      id: z.string().describe('The deferred prompt ID'),
      prompt: z.string().optional().describe('Updated prompt text'),
      schedule: scheduleSchema.optional().describe('Updated time-based trigger'),
      condition: alertConditionSchema.optional().describe('Updated event-based trigger condition'),
      cooldown_minutes: cooldownSchema,
      execution: executionInputSchema,
    }),
    execute: (input: UpdateInput) => {
      try {
        return executeUpdate(userId, input)
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), tool: 'update_deferred_prompt' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
