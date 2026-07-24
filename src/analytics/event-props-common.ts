// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { CountBucketSchema, LengthBucketSchema } from './controlled-types.js'

const NonNegativeInt = z.number().int().nonnegative()

const ChatMessageAcceptedPropsSchema = z
  .object({
    input_count: CountBucketSchema,
    length_bucket: LengthBucketSchema,
    attachment_count: CountBucketSchema,
    is_command: z.boolean(),
    command: z.enum(['start', 'config', 'help', 'context', 'dashboard', 'clear', 'stop', 'acp', 'other', 'none']),
  })
  .strict()

const AuthCheckedPropsSchema = z
  .object({
    outcome: z.enum(['granted', 'denied']),
    reason: z.enum([
      'admin',
      'member',
      'open_dm',
      'guest_mode',
      'blocked',
      'group_unauthorized',
      'unknown_user',
      'other',
    ]),
  })
  .strict()

const TurnStartedPropsSchema = z
  .object({
    incoming_message_count: CountBucketSchema,
    attachment_count: CountBucketSchema,
    queue_wait_ms: NonNegativeInt,
  })
  .strict()

const TurnCompletedPropsSchema = z
  .object({
    outcome: z.enum(['ok', 'llm_error', 'forced_stop', 'graceful_stop', 'configuration_block']),
    duration_ms: NonNegativeInt,
    step_count: NonNegativeInt,
    tool_call_count: NonNegativeInt,
    reply_count: CountBucketSchema,
    finish_reason: z.enum(['stop', 'length', 'tool_calls', 'content_filter', 'error', 'other', 'unknown']),
    clarification: z.boolean(),
    live_status_used: z.boolean(),
  })
  .strict()

const ReplySentPropsSchema = z
  .object({
    latency_ms: NonNegativeInt,
    part_count: CountBucketSchema,
    length_bucket: LengthBucketSchema,
    delivery: z.enum(['success', 'partial', 'failed']),
  })
  .strict()

const TurnSteeredPropsSchema = z
  .object({
    ordinal: NonNegativeInt,
    length_bucket: LengthBucketSchema,
    ack_sent: z.boolean(),
  })
  .strict()

const TurnStopRequestedPropsSchema = z
  .object({
    stage: z.enum(['graceful', 'forced']),
  })
  .strict()

const ClarificationRequestedPropsSchema = z
  .object({
    reason: z.enum([
      'missing_required_input',
      'ambiguous_target',
      'ambiguous_action',
      'permission',
      'configuration',
      'other',
    ]),
  })
  .strict()

const RephraseDetectedPropsSchema = z
  .object({
    detector: z.enum(['lexical_v1', 'small_model_v1']),
    similarity: z.enum(['080_089', '090_094', 'ge_095']),
    prior_outcome: z.enum(['clarification', 'failure', 'no_action']),
    gap: z.enum(['le_2m', '2m_10m']),
  })
  .strict()

const ClarificationAbandonedPropsSchema = z
  .object({
    observation_hours: z.literal(24),
  })
  .strict()

const DisclosureFallbackPropsSchema = z
  .object({
    reason: z.enum(['no_real_load', 'meta_tool_churn']),
    step_bucket: z.enum(['1_2', '3_5', '6_plus']),
  })
  .strict()

const ConfigLinkIssuedPropsSchema = z
  .object({
    result: z.enum(['issued', 'not_configured', 'rate_limited']),
  })
  .strict()

const SettingsOpenedPropsSchema = z
  .object({
    entry: z.enum(['config_link', 'existing_session']),
    result: z.enum(['success', 'expired', 'invalid']),
  })
  .strict()

const TaskInstanceAssignedPropsSchema = z
  .object({
    change: z.enum(['first_assignment', 'changed']),
    from_provider: z.enum(['kaneo', 'youtrack', 'none', 'other']),
    to_provider: z.enum(['kaneo', 'youtrack', 'other']),
  })
  .strict()

const RateLimitBlockedPropsSchema = z
  .object({
    limit: z.enum(['web_fetch', 'settings_link', 'provider', 'other']),
  })
  .strict()

const UnconfiguredReplyPropsSchema = z
  .object({
    missing: z.enum([
      'central_llm',
      'task_instance',
      'settings_base_url',
      'provider_credentials',
      'coding_credentials',
      'forge_credentials',
      'other',
    ]),
    surface: z.enum(['chat', 'settings', 'coding']),
  })
  .strict()

const UtcDayStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, 'utc_day must be YYYY-MM-DD')
  .refine((value) => {
    const parsed = Date.parse(value)
    if (Number.isNaN(parsed)) return false
    return new Date(parsed).toISOString().slice(0, 10) === value
  }, 'utc_day must be a valid calendar day')

const GuestTurnAggregatePropsSchema = z
  .object({
    utc_day: UtcDayStringSchema,
    turns: NonNegativeInt,
    successful_turns: NonNegativeInt,
    failed_turns: NonNegativeInt,
    contexts: CountBucketSchema,
  })
  .strict()

export const CommonEventPropsSchemas = {
  chat_message_accepted: ChatMessageAcceptedPropsSchema,
  auth_checked: AuthCheckedPropsSchema,
  turn_started: TurnStartedPropsSchema,
  turn_completed: TurnCompletedPropsSchema,
  reply_sent: ReplySentPropsSchema,
  turn_steered: TurnSteeredPropsSchema,
  turn_stop_requested: TurnStopRequestedPropsSchema,
  clarification_requested: ClarificationRequestedPropsSchema,
  rephrase_detected: RephraseDetectedPropsSchema,
  clarification_abandoned: ClarificationAbandonedPropsSchema,
  disclosure_fallback: DisclosureFallbackPropsSchema,
  config_link_issued: ConfigLinkIssuedPropsSchema,
  settings_opened: SettingsOpenedPropsSchema,
  task_instance_assigned: TaskInstanceAssignedPropsSchema,
  rate_limit_blocked: RateLimitBlockedPropsSchema,
  unconfigured_reply: UnconfiguredReplyPropsSchema,
  guest_turn_aggregate: GuestTurnAggregatePropsSchema,
}
