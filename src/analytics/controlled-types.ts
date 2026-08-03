// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export type Pseudonym = string & z.BRAND<'Pseudonym'>
export const PseudonymSchema = z
  .string()
  .regex(/^v\d+\.[-_A-Za-z0-9]+$/u, 'Pseudonym must be a key-version prefix followed by a base64url suffix')
  .max(128)
  .brand<'Pseudonym'>()

export type KeyVersion = string & z.BRAND<'KeyVersion'>
export const KeyVersionSchema = z
  .string()
  .regex(/^v\d+$/u)
  .max(8)
  .brand<'KeyVersion'>()

export type VersionString = string & z.BRAND<'VersionString'>
export const VersionStringSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/u, 'Version must be a public dotted version string')
  .max(32)
  .brand<'VersionString'>()

export type KnownToolSlug = string & z.BRAND<'KnownToolSlug'>
export const KnownToolSlugSchema = z.string().min(1).max(128).brand<'KnownToolSlug'>()

export const CountBucketSchema = z.enum(['0', '1', '2', '3_5', '6_10', '11_20', '21_plus'])
export type CountBucket = z.infer<typeof CountBucketSchema>

export const LengthBucketSchema = z.enum(['0', '1_32', '33_128', '129_512', '513_2048', '2049_plus'])
export type LengthBucket = z.infer<typeof LengthBucketSchema>

export const ByteBucketSchema = z.enum(['0', '1_256', '257_1024', '1025_8192', '8193_65536', '65537_plus'])
export type ByteBucket = z.infer<typeof ByteBucketSchema>

export const ConfidenceBucketSchema = z.enum(['lt_050', '050_069', '070_084', '085_094', 'ge_095'])
export type ConfidenceBucket = z.infer<typeof ConfidenceBucketSchema>

export const StatusClassSchema = z.enum(['none', '2xx', '3xx', '4xx', '5xx', 'timeout', 'network', 'auth', 'other'])
export type StatusClass = z.infer<typeof StatusClassSchema>

export const ErrorClassSchema = z.enum([
  'configuration',
  'validation',
  'authorization',
  'permission',
  'rate_limit',
  'not_found',
  'conflict',
  'provider_4xx',
  'provider_5xx',
  'timeout',
  'network',
  'mcp_unavailable',
  'llm_provider',
  'cancelled',
  'internal',
  'other',
])
export type ErrorClass = z.infer<typeof ErrorClassSchema>

export const IntentV1Schema = z.enum([
  'I01',
  'I02',
  'I03',
  'I04',
  'I05',
  'I06',
  'I07',
  'I08',
  'I09',
  'I10',
  'I11',
  'I12',
  'I13',
  'I14',
  'I15',
  'I16',
  'I17',
  'I18',
  'I19',
  'I20',
  'I21',
  'I22',
  'I23',
])
export type IntentV1 = z.infer<typeof IntentV1Schema>

export const IntentGoalV1Schema = z.enum([
  'I01',
  'I02',
  'I03',
  'I04',
  'I05',
  'I06',
  'I07',
  'I08',
  'I09',
  'I10',
  'I11',
  'I12',
  'I13',
  'I14',
  'I15',
  'I16',
  'I17',
  'I18',
  'I19',
  'I20',
])
export type IntentGoalV1 = z.infer<typeof IntentGoalV1Schema>

export const EventNameV1Schema = z.enum([
  'chat_message_accepted',
  'auth_checked',
  'turn_started',
  'turn_completed',
  'reply_sent',
  'llm_started',
  'llm_completed',
  'llm_failed',
  'tool_started',
  'tool_completed',
  'confirmation_requested',
  'confirmation_resolved',
  'turn_steered',
  'turn_stop_requested',
  'clarification_requested',
  'rephrase_detected',
  'clarification_abandoned',
  'edit_classified',
  'edit_regen',
  'disclosure_fallback',
  'config_link_issued',
  'settings_opened',
  'task_instance_assigned',
  'intent_classified',
  'feature_opportunity',
  'feature_used',
  'first_visible_feedback',
  'live_status_opportunity',
  'live_status_lifecycle',
  'provider_request_completed',
  'rate_limit_blocked',
  'unconfigured_reply',
  'mcp_availability',
  'guest_turn_aggregate',
])
export type EventNameV1 = z.infer<typeof EventNameV1Schema>

export const AggregateCounterV1Schema = z.enum([
  'message_accepted',
  'auth_granted',
  'auth_denied',
  'turn_started',
  'turn_completed',
  'turn_failed',
  'llm_started',
  'llm_completed',
  'llm_failed',
  'tool_started',
  'tool_semantic_success',
  'tool_failed',
  'provider_failed',
  'rate_limit_blocked',
  'mcp_unavailable',
  'unconfigured_reply',
  'guest_turn',
  'normalization_rejected',
  'edit_classified_w1',
  'edit_classified_w2',
  'edit_classified_w3',
  'edit_prompt_shown',
  'edit_prompt_adjust',
  'edit_prompt_note',
  'edit_regen_started',
  'edit_regen_completed',
  'edit_regen_failed',
  'edit_history_only',
])
export type AggregateCounterV1 = z.infer<typeof AggregateCounterV1Schema>

export const AggregateHistogramV1Schema = z.enum([
  'queue_delay_ms',
  'first_feedback_ms',
  'time_to_first_token_ms',
  'time_to_first_reply_ms',
  'turn_duration_ms',
  'tool_duration_ms',
  'confirmation_latency_ms',
])
export type AggregateHistogramV1 = z.infer<typeof AggregateHistogramV1Schema>
