// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { observeActiveFeatureUsed } from '../analytics/feature-observer.js'
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
import { toolFailureMeta } from './tool-logging.js'

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
    ? 'Create a scheduled task or monitoring alert. Provide either a schedule (for time-based) or a condition (for event-based), not both.'
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
): Tool {
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
        const result = executeCreate(userId, input, { userId: actorUserId, storageContextId, contextType, username })
        observeActiveFeatureUsed({ feature: 'deferred', operation: 'create', outcome: 'success' })
        return result
      } catch (error) {
        observeActiveFeatureUsed({ feature: 'deferred', operation: 'create', outcome: 'failure' })
        log.error(toolFailureMeta('create_deferred_prompt', error), 'Tool execution failed')
        throw error
      }
    },
  })
}
