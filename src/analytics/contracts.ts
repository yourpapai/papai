// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { AnalyticsAggregateV1Schema } from './aggregate-contract.js'
import type { AnalyticsAggregateV1 } from './aggregate-contract.js'
import {
  EventNameV1Schema,
  KeyVersionSchema,
  KnownToolSlugSchema,
  PseudonymSchema,
  VersionStringSchema,
} from './controlled-types.js'
import type { EventNameV1, Pseudonym, VersionString } from './controlled-types.js'
import { PropsUnionSchema, propsByEventName } from './event-props.js'
import type { PropsByEventName } from './event-props.js'

export { AnalyticsAggregateV1Schema }
export type { AnalyticsAggregateV1, EventNameV1, PropsByEventName, Pseudonym, VersionString }

export const AnalyticsEventV1Schema = z
  .object({
    schema: z
      .object({
        name: z.literal('papai.analytics.event'),
        version: z.literal(1),
      })
      .strict(),
    event: z
      .object({
        id: PseudonymSchema,
        name: EventNameV1Schema,
        version: z.literal(1),
        occurred_at_ms: z.number().int().nonnegative(),
        ingested_at_ms: z.number().int().nonnegative(),
        source: z.enum(['live', 'backfill']),
        attribution_quality: z.enum(['native', 'backfill_snapshot', 'unknown']),
      })
      .strict(),
    app: z
      .object({
        version: VersionStringSchema,
        deployment_key: PseudonymSchema,
      })
      .strict(),
    identity: z
      .object({
        key_version: KeyVersionSchema,
        platform: z.enum(['telegram', 'mattermost', 'discord', 'kontur-talk']),
        platform_instance_key: PseudonymSchema,
        actor_key: PseudonymSchema.nullable(),
        context_key: PseudonymSchema.nullable(),
        thread_key: PseudonymSchema.nullable(),
        task_instance_key: PseudonymSchema.nullable(),
      })
      .strict(),
    context: z
      .object({
        context_type: z.enum(['dm', 'group', 'none']),
        actor_role: z.enum(['admin', 'member', 'guest', 'system']),
        task_provider: z.enum(['kaneo', 'youtrack', 'none', 'other']),
        invocation_mode: z.enum(['normal', 'command', 'settings', 'proactive', 'scheduler']),
      })
      .strict(),
    correlation: z
      .object({
        conversation_key: PseudonymSchema.nullable(),
        turn_key: PseudonymSchema.nullable(),
        session_key: PseudonymSchema.nullable(),
      })
      .strict(),
    governance: z
      .object({
        purpose: z.literal('product_analytics'),
        collection_tier: z.enum(['aggregate', 'pseudonymous']),
        policy_version: z.number().int().nonnegative(),
        eligibility: z.enum(['allowed', 'operator_basis', 'not_applicable']),
      })
      .strict(),
    privacy: z
      .object({
        max_class: z.enum(['C0', 'C1', 'C2']),
      })
      .strict(),
    props: PropsUnionSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const expected = propsByEventName[value.event.name]
    const parsed = expected.safeParse(value.props)
    if (!parsed.success) {
      ctx.addIssue({
        code: 'custom',
        message: `Props do not match schema for event ${value.event.name}`,
        path: ['props'],
      })
    }
  })

export type AnalyticsEventV1 = z.infer<typeof AnalyticsEventV1Schema>

const baseEventEnvelope = {
  schema: { name: 'papai.analytics.event' as const, version: 1 as const },
  app: { version: VersionStringSchema.parse('6.10.0'), deployment_key: PseudonymSchema.parse('v1.p-deploy') },
  identity: {
    key_version: KeyVersionSchema.parse('v1'),
    platform: 'telegram' as const,
    platform_instance_key: PseudonymSchema.parse('v1.p-platform'),
    actor_key: PseudonymSchema.parse('v1.p-actor'),
    context_key: PseudonymSchema.parse('v1.p-context'),
    thread_key: null,
    task_instance_key: null,
  },
  context: {
    context_type: 'dm' as const,
    actor_role: 'admin' as const,
    task_provider: 'none' as const,
    invocation_mode: 'normal' as const,
  },
  correlation: {
    conversation_key: PseudonymSchema.parse('v1.p-conversation'),
    turn_key: PseudonymSchema.parse('v1.p-turn'),
    session_key: null,
  },
  governance: {
    purpose: 'product_analytics' as const,
    collection_tier: 'aggregate' as const,
    policy_version: 1,
    eligibility: 'allowed' as const,
  },
  privacy: { max_class: 'C0' as const },
}

export const llmCompletedFixture = {
  ...baseEventEnvelope,
  event: {
    id: PseudonymSchema.parse('v1.p-llm-completed'),
    name: 'llm_completed' as const,
    version: 1 as const,
    occurred_at_ms: 1700000000000,
    ingested_at_ms: 1700000000001,
    source: 'live' as const,
    attribution_quality: 'native' as const,
  },
  props: {
    attempt_key: PseudonymSchema.parse('v1.p-attempt'),
    model_key: PseudonymSchema.parse('v1.p-model'),
    model_role: 'main' as const,
    duration_ms: 1234,
    time_to_first_token_ms: 456,
    input_tokens: 100,
    output_tokens: 200,
    step_count: 3,
    finish_reason: 'stop' as const,
  },
} satisfies AnalyticsEventV1

export const toolCompletedFixture = {
  ...baseEventEnvelope,
  event: {
    id: PseudonymSchema.parse('v1.p-tool-completed'),
    name: 'tool_completed' as const,
    version: 1 as const,
    occurred_at_ms: 1700000000000,
    ingested_at_ms: 1700000000001,
    source: 'live' as const,
    attribution_quality: 'native' as const,
  },
  props: {
    tool_slug: KnownToolSlugSchema.parse('core_task_create'),
    tool_key: PseudonymSchema.parse('v1.p-tool'),
    origin: 'core' as const,
    domain: 'task' as const,
    risk: 'write' as const,
    model_role: 'main' as const,
    args_bytes: '0' as const,
    duration_ms: 789,
    execution_outcome: 'semantic_success' as const,
    result_bytes: '0' as const,
    error_class: null,
    status_class: '2xx' as const,
    retryable: null,
    recovered_same_turn: false,
  },
} satisfies AnalyticsEventV1

export const intentClassifiedFixture = {
  ...baseEventEnvelope,
  event: {
    id: PseudonymSchema.parse('v1.p-intent-classified'),
    name: 'intent_classified' as const,
    version: 1 as const,
    occurred_at_ms: 1700000000000,
    ingested_at_ms: 1700000000001,
    source: 'live' as const,
    attribution_quality: 'native' as const,
  },
  props: {
    taxonomy: 'intent.v1' as const,
    primary: 'I23',
    goals: ['I01', 'I02'],
    confidence: 'ge_095' as const,
    strategy: 'hybrid_v1' as const,
    abstained: false,
  },
} satisfies AnalyticsEventV1

export const firstVisibleFeedbackFixture = {
  ...baseEventEnvelope,
  event: {
    id: PseudonymSchema.parse('v1.p-first-visible-feedback'),
    name: 'first_visible_feedback' as const,
    version: 1 as const,
    occurred_at_ms: 1700000000000,
    ingested_at_ms: 1700000000001,
    source: 'live' as const,
    attribution_quality: 'native' as const,
  },
  props: {
    kind: 'typing' as const,
    outcome: 'success' as const,
    capability_supported: true,
    setting_enabled: true,
    latency_ms: 120,
  },
} satisfies AnalyticsEventV1
