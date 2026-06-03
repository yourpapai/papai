// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import type { ContextType } from '../chat/types.js'
import { executeCreate, type CreateInput } from '../deferred-prompts/tool-handlers.js'
import {
  alertConditionSchema,
  cooldownSchema,
  deliveryPolicySchema,
  executionInputSchema,
  scheduleSchema,
} from '../deferred-prompts/types.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:create-deferred-prompt' })

type CreateDeferredPromptToolOptions = Readonly<{
  allowTaskConditions?: boolean
}>

function buildInputSchema(allowTaskConditions: boolean): z.ZodType<CreateInput> {
  if (allowTaskConditions) {
    return z.object({
      prompt: z.string().describe('What to do/say when this fires - not scheduling meta-instructions'),
      schedule: scheduleSchema.optional().describe('Time-based trigger (one-time or recurring)'),
      condition: alertConditionSchema.optional().describe('Event-based trigger condition'),
      cooldown_minutes: cooldownSchema,
      execution: executionInputSchema,
      delivery: deliveryPolicySchema,
    })
  }

  return z
    .object({
      prompt: z.string().describe('What to do/say when this fires - not scheduling meta-instructions'),
      schedule: scheduleSchema.optional().describe('Time-based trigger (one-time or recurring)'),
      execution: executionInputSchema,
      delivery: deliveryPolicySchema,
    })
    .strict()
}

function buildToolDescription(allowTaskConditions: boolean): string {
  return allowTaskConditions
    ? 'Create a scheduled task or monitoring alert. Provide either a schedule (for time-based) or a condition (for event-based), not both. Always classify the execution mode based on what the prompt needs at fire time.'
    : 'Create a scheduled prompt. Use this only for time-based reminders or recurring scheduled follow-ups.'
}

function resolveActorUserId(userId: string, actorUserId: string | undefined): string {
  if (actorUserId === undefined) return userId
  return actorUserId
}

export function makeCreateDeferredPromptTool(
  userId: string,
  storageContextId: string,
  contextType: ContextType,
  username?: string | null,
  actorUserIdArg?: string,
  options: CreateDeferredPromptToolOptions = {},
): ToolSet[string] {
  const actorUserId = resolveActorUserId(userId, actorUserIdArg)
  const allowTaskConditions = options.allowTaskConditions ?? true
  const inputSchema = buildInputSchema(allowTaskConditions)

  return tool({
    description: buildToolDescription(allowTaskConditions),
    inputSchema,
    execute: (input: CreateInput) => {
      try {
        if (!allowTaskConditions && input.condition !== undefined) {
          return { error: 'Task-dependent deferred alerts require a task provider.' }
        }
        return executeCreate(userId, input, { userId: actorUserId, storageContextId, contextType, username })
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            tool: 'create_deferred_prompt',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
