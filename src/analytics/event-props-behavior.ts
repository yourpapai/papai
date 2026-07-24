// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { ConfidenceBucketSchema, IntentGoalV1Schema, IntentV1Schema, PseudonymSchema } from './controlled-types.js'

const NonNegativeInt = z.number().int().nonnegative()
const NonNegativeIntNullable = z.number().int().nonnegative().nullable()

const EXCLUDED_COMPONENT_GOALS = new Set<string>(['I21', 'I22', 'I23'])

const intentV1Order = new Map<string, number>(IntentV1Schema.options.map((value, index) => [value, index]))

const IntentGoalsSchema = z
  .array(IntentGoalV1Schema)
  .max(3)
  .superRefine((value, ctx) => {
    const seen = new Set<string>()
    for (const goal of value) {
      if (seen.has(goal)) {
        ctx.addIssue({
          code: 'custom',
          message: 'goals must be deduplicated',
          path: [],
        })
        return
      }
      seen.add(goal)
    }

    for (let index = 1; index < value.length; index++) {
      const previousGoal = value[index - 1]
      const currentGoal = value[index]
      if (previousGoal === undefined || currentGoal === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'goals must be sorted in taxonomy order',
          path: [],
        })
        return
      }
      const previousOrder = intentV1Order.get(previousGoal)
      const currentOrder = intentV1Order.get(currentGoal)
      if (previousOrder === undefined || currentOrder === undefined || previousOrder >= currentOrder) {
        ctx.addIssue({
          code: 'custom',
          message: 'goals must be sorted in taxonomy order',
          path: [],
        })
        return
      }
    }

    for (const [index, goal] of value.entries()) {
      if (EXCLUDED_COMPONENT_GOALS.has(goal)) {
        ctx.addIssue({
          code: 'custom',
          message: `${goal} is not a valid component goal`,
          path: [index],
        })
      }
    }
  })

const IntentClassifiedPropsSchema = z
  .object({
    taxonomy: z.literal('intent.v1'),
    primary: IntentV1Schema,
    goals: IntentGoalsSchema,
    confidence: ConfidenceBucketSchema,
    strategy: z.enum(['tool_trace_v1', 'metadata_v1', 'small_model_v1', 'hybrid_v1']),
    abstained: z.boolean(),
  })
  .strict()
  .refine((value) => value.primary !== 'I23' || (value.goals.length >= 2 && value.goals.length <= 3), {
    message: 'multi_goal primary requires 2 or 3 component goals',
    path: ['goals'],
  })

const FeatureOpportunityPropsSchema = z
  .object({
    feature: z.enum([
      'recurring',
      'deferred',
      'memory_write',
      'memory_search',
      'attachment',
      'coding',
      'mcp',
      'byok',
      'guest_mode',
      'web_fetch',
      'live_status',
    ]),
    available: z.boolean(),
    reason: z.enum([
      'available',
      'capability_missing',
      'provider_missing',
      'role_denied',
      'configuration_missing',
      'platform_unsupported',
      'other',
    ]),
    sampling: z.literal('first_eligible_actor_day'),
  })
  .strict()

const FeatureUsedPropsSchema = z
  .object({
    feature: z.enum([
      'recurring',
      'deferred',
      'memory_write',
      'memory_search',
      'attachment',
      'coding',
      'mcp',
      'byok',
      'guest_mode',
      'web_fetch',
      'live_status',
    ]),
    operation: z.enum([
      'create',
      'read',
      'search',
      'update',
      'delete',
      'start',
      'continue',
      'monitor',
      'review',
      'finish',
      'enable',
    ]),
    outcome: z.enum(['success', 'failure', 'blocked']),
    coding_project_key: PseudonymSchema.optional(),
    coding_session_key: PseudonymSchema.optional(),
  })
  .strict()

const FirstVisibleFeedbackPropsSchema = z
  .object({
    kind: z.enum(['typing', 'live_status', 'steer_ack', 'none']),
    outcome: z.enum(['success', 'failed', 'missing', 'not_applicable']),
    capability_supported: z.boolean(),
    setting_enabled: z.boolean(),
    latency_ms: NonNegativeIntNullable,
  })
  .strict()

const LiveStatusOpportunityPropsSchema = z
  .object({
    eligible: z.boolean(),
    reason: z.enum(['eligible', 'platform_unsupported', 'disabled', 'turn_too_short', 'no_status_surface']),
  })
  .strict()

const LiveStatusLifecyclePropsSchema = z
  .object({
    stage: z.enum(['create', 'update', 'dismiss']),
    outcome: z.enum(['success', 'failed']),
    latency_from_turn_start_ms: NonNegativeInt,
    ordinal: NonNegativeInt,
  })
  .strict()

export const BehaviorEventPropsSchemas = {
  intent_classified: IntentClassifiedPropsSchema,
  feature_opportunity: FeatureOpportunityPropsSchema,
  feature_used: FeatureUsedPropsSchema,
  first_visible_feedback: FirstVisibleFeedbackPropsSchema,
  live_status_opportunity: LiveStatusOpportunityPropsSchema,
  live_status_lifecycle: LiveStatusLifecyclePropsSchema,
}
