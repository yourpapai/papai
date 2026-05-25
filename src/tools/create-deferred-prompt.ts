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

function resolveActorUserId(userId: string, actorUserId: string | undefined): string {
  if (actorUserId === undefined) return userId
  return actorUserId
}

export function makeCreateDeferredPromptTool(
  userId: string,
  storageContextId: string,
  contextType: ContextType,
  ...args:
    | readonly []
    | readonly [username: string | null | undefined]
    | readonly [username: string | null | undefined, actorUserId: string]
): ToolSet[string] {
  const username = args[0]
  const actorUserId = resolveActorUserId(userId, args[1])
  return tool({
    description:
      'Create a scheduled task or monitoring alert. Provide either a schedule (for time-based) or a condition (for event-based), not both. Always classify the execution mode based on what the prompt needs at fire time.',
    inputSchema: z.object({
      prompt: z.string().describe('What to do/say when this fires — not scheduling meta-instructions'),
      schedule: scheduleSchema.optional().describe('Time-based trigger (one-time or recurring)'),
      condition: alertConditionSchema.optional().describe('Event-based trigger condition'),
      cooldown_minutes: cooldownSchema,
      execution: executionInputSchema,
      delivery: deliveryPolicySchema,
    }),
    execute: (input: CreateInput) => {
      try {
        return executeCreate(userId, input, { userId: actorUserId, storageContextId, contextType, username })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), tool: 'create_deferred_prompt' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
