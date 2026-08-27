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
} from '../deferred-prompts/types.js'
import { logger } from '../logger.js'
import { toolFailureMeta } from './tool-logging.js'

const log = logger.child({ scope: 'tool:create-alert' })

export function makeCreateAlertTool(
  userId: string,
  storageContextId: string,
  contextType: ContextType,
  username?: string | null,
  actorUserIdArg?: string,
): Tool {
  const actorUserId = actorUserIdArg ?? userId
  const inputSchema = z
    .object({
      prompt: z.string().describe('What to do/say when the alert fires - not the condition'),
      condition: alertConditionSchema.describe(
        'Event-based trigger: watch a specific task (task.id eq <id>) or watch for task changes across all tasks',
      ),
      cooldown_minutes: cooldownSchema,
      execution: executionInputSchema,
      delivery: deliveryPolicySchema,
    })
    .strict()
  return tool({
    description:
      'Set up an alert that fires when a task matches a condition — watch a specific task (condition field task.id, op eq) or any task (e.g. status changes, becomes overdue). Use for "tell me when…" / "let me know if…".',
    inputSchema,
    execute: (input: CreateInput) => {
      try {
        const result = executeCreate(userId, input, { userId: actorUserId, storageContextId, contextType, username })
        observeActiveFeatureUsed({ feature: 'deferred', operation: 'create', outcome: 'success' })
        return result
      } catch (error) {
        observeActiveFeatureUsed({ feature: 'deferred', operation: 'create', outcome: 'failure' })
        log.error(toolFailureMeta('create_alert', error), 'Tool execution failed')
        throw error
      }
    },
  })
}
