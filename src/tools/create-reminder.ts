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
import { deliveryPolicySchema, executionInputSchema, scheduleSchema } from '../deferred-prompts/types.js'
import { logger } from '../logger.js'
import { toolFailureMeta } from './tool-logging.js'

const log = logger.child({ scope: 'tool:create-reminder' })

export function makeCreateReminderTool(
  userId: string,
  storageContextId: string,
  contextType: ContextType,
  username?: string | null,
  actorUserIdArg?: string,
): Tool {
  const actorUserId = actorUserIdArg ?? userId
  const inputSchema = z
    .object({
      prompt: z.string().describe('What to do/say when this fires - not scheduling meta-instructions'),
      schedule: scheduleSchema.describe('When it fires: one-time (fire_at) or recurring (rrule)'),
      execution: executionInputSchema,
      delivery: deliveryPolicySchema,
    })
    .strict()
  return tool({
    description:
      'Set up a reminder or scheduled follow-up that fires once (fire_at) or on a recurring schedule (rrule). Use for "remind me…", daily summaries, and any time-based nudge.',
    inputSchema,
    execute: (input: CreateInput) => {
      try {
        const result = executeCreate(userId, input, { userId: actorUserId, storageContextId, contextType, username })
        observeActiveFeatureUsed({ feature: 'deferred', operation: 'create', outcome: 'success' })
        return result
      } catch (error) {
        observeActiveFeatureUsed({ feature: 'deferred', operation: 'create', outcome: 'failure' })
        log.error(toolFailureMeta('create_reminder', error), 'Tool execution failed')
        throw error
      }
    },
  })
}
